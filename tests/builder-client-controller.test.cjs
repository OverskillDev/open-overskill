const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const output = fs.mkdtempSync(path.join(os.tmpdir(), 'open-overskill-controller-'));
for (const name of ['builder-client', 'builder-controller', 'credit-account']) {
  const source = fs.readFileSync(path.join(__dirname, '../lib', `${name}.ts`), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  fs.writeFileSync(path.join(output, `${name}.js`), compiled.outputText);
}
const { createBuilderClient } = require(path.join(output, 'builder-client.js'));
const { createBuilderController } = require(path.join(output, 'builder-controller.js'));
after(() => fs.rmSync(output, { recursive: true, force: true }));
const ok = (json, status = 200) => ({ ok: true, status, json });
const expired = () => ({ ok: false, status: 401, json: { error: 'Session ended', code: 'operator_session_required' } });
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('Controller did not reach the expected state');
}
function fixture(overrides = {}, mock = true) {
  const calls = { generate: [], provision: 0, auth: 0, deploy: 0, recover: 0, credit: 0 };
  const client = {
    config: async () => ok({ mock, hasKey: false, partnerSlug: 'test' }),
    creator: async () => ok({ creator: { brand: 'Test creator' }, contextMarkdown: 'Context', suggestions: ['Portal'] }),
    authenticate: async () => { calls.auth++; return ok({ authenticated: true }); },
    unlock: async () => ok({ authenticated: true }),
    lock: async () => ok({ authenticated: false }),
    provision: async () => { calls.provision++; return ok({ team: { id: 1 } }, 201); },
    recoverCreatorKey: async () => { calls.recover++; return ok({ team: { id: 1 }, recoveryRequired: false }); },
    creditAccount: async () => { calls.credit++; return ok({ creditAccount: { type: 'creator_workspace', teamId: 1, partnerSponsorshipSupported: false }, balance: { status: 'reported', credits: 0 }, telemetry: 'partial_legacy', meter: null, spendingCap: null }); },
    generate: async (input) => { calls.generate.push(input); return ok({ app_id: 'app-1', job_id: `job-${calls.generate.length}`, message_id: calls.generate.length }, 202); },
    status: async (id) => ok({ app_id: 'app-1', job_id: id, status: 'completed', progress: 100, message: 'Done', app: { preview_url: '/preview/app-1' } }),
    messages: async () => ok({ messages: [{ role: 'assistant', content: 'Done', flow: [] }] }),
    deploy: async () => { calls.deploy++; return ok({ status: 'queued', production_url: 'https://example.invalid/app' }, 202); },
    ...overrides,
  };
  const controller = createBuilderController(client, { pollIntervalMs: 1, pollTimeoutMs: 1000 });
  return { client, controller, calls };
}
async function ready(controller) { controller.start(); await until(() => controller.getSnapshot().ready); }
async function build(controller, prompt = 'Build a portal') { controller.setPrompt(prompt); await controller.build(); }

test('transport rejects remote, protocol-relative and ambiguous token destinations', () => {
  let fetched = false;
  for (const basePath of ['https://remote.invalid/api', '//remote.invalid', '/\\remote.invalid', '/api?token=secret', '/api\n/other']) {
    assert.throws(() => createBuilderClient({ basePath, fetch: async () => { fetched = true; } }), /same-origin/);
  }
  assert.equal(fetched, false);
});

test('transport uses same-origin credentials, refuses redirects and forwards cancellation', async () => {
  const requests = [];
  const client = createBuilderClient({ basePath: '/custom/builder/', fetch: async (url, options) => { requests.push({ url, options }); return Response.json({ authenticated: true }); } });
  const abort = new AbortController();
  await client.unlock('local-operator-token', { signal: abort.signal });
  assert.equal(requests[0].url, '/custom/builder/session');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.signal, abort.signal);
  assert.equal(JSON.parse(requests[0].options.body).token, 'local-operator-token');
  await client.status('job/with?symbols');
  assert.equal(requests[1].url, '/custom/builder/status?id=job%2Fwith%3Fsymbols');
});

test('malformed successful responses fail closed and transport exceptions cannot echo tokens', async () => {
  for (const response of [new Response('<html>failed</html>'), Response.json(null), Response.json([])]) {
    const result = await createBuilderClient({ fetch: async () => response }).authenticate();
    assert.equal(result.ok, false);
    assert.equal(result.status, 502);
  }
  const result = await createBuilderClient({ fetch: async () => { throw new Error('private-token-in-exception'); } }).unlock('private-token-in-exception');
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes('private-token-in-exception'));
});

test('controller provisions once and sends later prompts to the same app', async () => {
  const { controller, calls } = fixture();
  await ready(controller);
  await build(controller);
  assert.equal(controller.getSnapshot().stage, 'Demo preview ready');
  await build(controller, 'Add events');
  assert.deepEqual(calls.generate, [{ prompt: 'Build a portal', creditResponsibility: 'creator_workspace' }, { prompt: 'Add events', appId: 'app-1', creditResponsibility: 'creator_workspace' }]);
  assert.equal(calls.provision, 1);
  assert.equal(controller.getSnapshot().appId, 'app-1');
  controller.stop();
});

test('synchronous duplicate build actions cannot queue duplicate provisioning or generation', async () => {
  const pending = deferred();
  let provisions = 0;
  const { controller, calls } = fixture({ provision: async () => { provisions++; return pending.promise; } });
  await ready(controller);
  controller.setPrompt('Build once');
  const first = controller.build();
  await controller.build();
  assert.equal(provisions, 1);
  pending.resolve(ok({ team: { id: 1 } }));
  await first;
  assert.equal(calls.generate.length, 1);
  controller.stop();
});

test('locking aborts generation and late results cannot resurrect an old session app', async () => {
  const pending = deferred();
  let signal;
  const { controller } = fixture({ generate: async (_input, options) => { signal = options.signal; return pending.promise; } }, false);
  await ready(controller);
  controller.setPrompt('Build privately');
  const building = controller.build();
  await until(() => signal);
  await controller.lock();
  assert.equal(signal.aborted, true);
  pending.resolve(ok({ app_id: 'old-private-app', job_id: 'old-job' }));
  await building;
  assert.equal(controller.getSnapshot().appId, null);
  assert.equal(controller.getSnapshot().locked, true);
  assert.equal(controller.getSnapshot().ready, false);
  assert.equal(controller.getSnapshot().prompt, '');
  assert.equal(controller.getSnapshot().submitted, '');
  controller.stop();
});

test('late deploy and authentication responses cannot unlock or repopulate a locked view', async () => {
  const pendingDeploy = deferred();
  const { controller } = fixture({ deploy: async () => pendingDeploy.promise }, false);
  await ready(controller);
  await build(controller);
  const deploying = controller.deploy();
  await controller.lock();
  pendingDeploy.resolve(ok({ production_url: 'https://example.invalid/private' }));
  await deploying;
  assert.equal(controller.getSnapshot().publishedUrl, null);
  assert.equal(controller.getSnapshot().deployState, 'idle');
  controller.stop();

  const pendingAuth = deferred();
  let requested = false;
  const next = fixture({ authenticate: async () => { requested = true; return pendingAuth.promise; } }, false).controller;
  next.start();
  await until(() => requested);
  await next.lock();
  pendingAuth.resolve(ok({ authenticated: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(next.getSnapshot().ready, false);
  assert.equal(next.getSnapshot().locked, true);
  next.stop();
});

test('live session expiry clears app ownership and never retries a billable generation', async () => {
  let generated = 0;
  const { controller } = fixture({ generate: async () => { generated++; return expired(); } }, false);
  await ready(controller);
  await build(controller, 'Keep this unsubmitted prompt');
  const state = controller.getSnapshot();
  assert.equal(state.locked, true);
  assert.equal(state.ready, false);
  assert.equal(state.appId, null);
  assert.equal(state.provisioned, false);
  assert.equal(state.prompt, 'Keep this unsubmitted prompt');
  assert.equal(generated, 1);
  controller.stop();
});

test('demo expiry reconnects only authentication and unlock tokens never enter controller state', async () => {
  const { controller, calls } = fixture({ generate: async () => expired() });
  await ready(controller);
  await build(controller);
  await until(() => calls.auth === 2 && controller.getSnapshot().ready);
  assert.equal(controller.getSnapshot().appId, null);
  await controller.unlock('private-operator-token');
  assert.ok(!JSON.stringify(controller.getSnapshot()).includes('private-operator-token'));
  controller.stop();
});

test('unmount stops tracking and a live deploy remains requested rather than published', async () => {
  const live = fixture({}, false).controller;
  await ready(live);
  await build(live);
  await live.deploy();
  assert.equal(live.getSnapshot().deployState, 'queued');
  live.stop();

  const pending = deferred();
  let requested = false;
  const tracked = fixture({ status: async () => { requested = true; return pending.promise; } }).controller;
  await ready(tracked);
  tracked.setPrompt('A build');
  const building = tracked.build();
  await until(() => requested);
  tracked.stop();
  const snapshot = tracked.getSnapshot();
  pending.resolve(ok({ status: 'completed', app_id: 'app-1', message: 'Late result' }));
  await building;
  assert.equal(tracked.getSnapshot(), snapshot);
});

test('uncertain mutations tell callers to check state before retrying, while reads remain read-only', async () => {
  const disconnected = createBuilderClient({ fetch: async () => { throw new Error('disconnected'); } });
  for (const operation of [() => disconnected.provision(), () => disconnected.generate({ prompt: 'An app' }), () => disconnected.deploy('app-1'), () => disconnected.lock()]) {
    const result = await operation();
    assert.equal(result.ok, false);
    assert.match(result.json.error, /may have reached the server/);
    assert.match(result.json.error, /Check its state before retrying/);
    assert.doesNotMatch(result.json.error, /try again/);
  }
  const read = await disconnected.status('job-1');
  assert.equal(read.ok, false);
  assert.doesNotMatch(read.json.error, /may have reached/);
  assert.match(read.json.error, /Check the local server connection/);
});

test('malformed, aborted and server-error mutation responses preserve uncertainty', async () => {
  for (const response of [new Response('<html>unknown outcome</html>'), Response.json(null), Response.json({ error: 'Gateway timeout' }, { status: 504 })]) {
    const result = await createBuilderClient({ fetch: async () => response }).generate({ prompt: 'An app' });
    assert.equal(result.ok, false);
    assert.match(result.json.error, /may have reached the server/);
  }
  const abort = new AbortController();
  abort.abort();
  const aborted = await createBuilderClient({ fetch: async () => { throw new Error('aborted'); } }).deploy('app-1', { signal: abort.signal });
  assert.equal(aborted.json.code, 'request_aborted');
  assert.match(aborted.json.error, /Check its state before retrying/);
  const denied = await createBuilderClient({ fetch: async () => Response.json({ error: 'Session ended' }, { status: 401 }) }).generate({ prompt: 'An app' });
  assert.equal(denied.json.error, 'Session ended');
});

test('credit reads and explicit recovery use scoped same-origin routes without payer IDs', async () => {
  const requests = [];
  const client = createBuilderClient({ fetch: async (url, options) => { requests.push({ url, options }); return Response.json({}); } });
  await client.creditAccount();
  await client.recoverCreatorKey();
  assert.equal(requests[0].url, '/api/credit-account');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.body, undefined);
  assert.equal(requests[1].url, '/api/creator/recover');
  assert.equal(requests[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[1].options.body), {});
});

test('existing creator key recovery is explicit, preserves the prompt and never auto-generates', async () => {
  const { controller, calls } = fixture({ provision: async () => ok({ team: { id: 1 }, recoveryRequired: true }) }, false);
  await ready(controller);
  await build(controller, 'Keep my next change');
  assert.equal(controller.getSnapshot().needsKeyRecovery, true);
  assert.equal(controller.getSnapshot().busy, false);
  assert.equal(controller.getSnapshot().prompt, 'Keep my next change');
  assert.equal(calls.recover, 0);
  assert.equal(calls.credit, 0);
  await controller.build();
  assert.equal(calls.generate.length, 0);
  await controller.recoverCreatorKey();
  assert.equal(calls.recover, 1);
  assert.equal(controller.getSnapshot().needsKeyRecovery, false);
  assert.equal(calls.generate.length, 0);
  assert.equal(controller.getSnapshot().prompt, 'Keep my next change');
  await controller.build();
  assert.equal(calls.generate.length, 1);
  assert.equal(calls.recover, 1);
  controller.stop();
});

test('duplicate recovery is suppressed and a late recovery cannot restore a locked session', async () => {
  const pending = deferred();
  let recoveries = 0;
  let signal;
  const { controller, calls } = fixture({
    provision: async () => ok({ team: { id: 1 }, recoveryRequired: true }),
    recoverCreatorKey: async (options) => { recoveries++; signal = options.signal; return pending.promise; },
  }, false);
  await ready(controller);
  await build(controller);
  const recovery = controller.recoverCreatorKey();
  await controller.recoverCreatorKey();
  assert.equal(recoveries, 1);
  await controller.lock();
  assert.equal(signal.aborted, true);
  pending.resolve(ok({ team: { id: 1 }, recoveryRequired: false }));
  await recovery;
  const state = controller.getSnapshot();
  assert.equal(state.locked, true);
  assert.equal(state.provisioned, false);
  assert.equal(state.creditAccount, null);
  assert.equal(state.recoveringKey, false);
  assert.equal(calls.credit, 0);
  assert.equal(calls.generate.length, 0);
  controller.stop();
});

test('conflicting recovery stays explicit and instructs credential reconciliation instead of silent rotation', async () => {
  let recoveries = 0;
  const { controller, calls } = fixture({
    provision: async () => ok({ team: { id: 1 }, recoveryRequired: true }),
    recoverCreatorKey: async () => { recoveries++; return { ok: false, status: 409, json: { error: 'Key changed', code: 'key_changed' } }; },
  }, false);
  await ready(controller);
  await build(controller);
  await controller.recoverCreatorKey();
  assert.equal(recoveries, 1);
  assert.equal(controller.getSnapshot().needsKeyRecovery, true);
  assert.match(controller.getSnapshot().error, /Reconcile the stored creator credentials/);
  assert.equal(calls.generate.length, 0);
  controller.stop();
});

test('unavailable telemetry blocks generation and requires a successful explicit refresh', async () => {
  for (const response of [
    {ok:false,status:503,json:{error:'Unavailable'}},
    ok({telemetry:'creator_usage_v1',meter:{status:'unavailable'},balance:{credits:null}}),
    ok({telemetry:'unavailable',meter:null,balance:{credits:null}}),
  ]) {
    const { controller, client, calls } = fixture({ creditAccount: async () => response }, false);
    await ready(controller);
    await build(controller, 'Keep this prompt');
    assert.equal(calls.generate.length, 0);
    assert.equal(controller.getSnapshot().creditAccountBlocked, true);
    assert.equal(controller.getSnapshot().stage, 'Builds paused: usage unavailable');
    assert.equal(controller.getSnapshot().prompt, 'Keep this prompt');
    assert.equal(controller.getSnapshot().busy, false);
    await controller.build();
    assert.equal(calls.generate.length, 0);
    client.creditAccount = async () => ok({telemetry:'partial_legacy',meter:null,balance:{credits:0}});
    await controller.refreshCreditAccount();
    assert.equal(controller.getSnapshot().creditAccountBlocked, false);
    assert.equal(controller.getSnapshot().error, '');
    assert.equal(calls.generate.length, 0);
    await controller.build();
    assert.equal(calls.generate.length, 1);
    controller.stop();
  }
});

test('a thrown credit read and a server preflight failure both pause generation', async () => {
  const offline=fixture({creditAccount:async()=>{throw new Error('Offline');}},false);
  await ready(offline.controller); await build(offline.controller);
  assert.equal(offline.calls.generate.length,0);
  assert.equal(offline.controller.getSnapshot().creditAccountBlocked,true);
  offline.controller.stop();
  const raced=fixture({generate:async()=>({ok:false,status:503,json:{code:'credit_usage_unavailable',error:'Refresh credits'}})},false);
  await ready(raced.controller); await build(raced.controller);
  assert.equal(raced.controller.getSnapshot().creditAccountBlocked,true);
  assert.equal(raced.controller.getSnapshot().prompt,'Build a portal');
  raced.controller.stop();
});

test('credit account mismatch and expired sessions cannot queue a build', async () => {
  for (const result of [
    { ok: false, status: 502, json: { error: 'Wrong account', code: 'credit_account_mismatch' } },
    expired(),
  ]) {
    const { controller, calls } = fixture({ creditAccount: async () => result }, false);
    await ready(controller);
    await build(controller);
    assert.equal(calls.generate.length, 0);
    assert.equal(controller.getSnapshot().creditAccount, null);
    assert.equal(controller.getSnapshot().busy, false);
    if (result.status === 401) assert.equal(controller.getSnapshot().locked, true);
    else assert.match(controller.getSnapshot().error, /No build was requested/);
    controller.stop();
  }
});

test('late credit snapshots cannot repopulate a locked session', async () => {
  const { controller, client } = fixture({}, false);
  await ready(controller);
  await build(controller);
  const pending = deferred();
  let signal;
  client.creditAccount = async (options) => { signal = options.signal; return pending.promise; };
  const reading = controller.refreshCreditAccount();
  await until(() => signal);
  await controller.lock();
  assert.equal(signal.aborted, true);
  pending.resolve(ok({ creditAccount: { teamId: 998 }, balance: { credits: 99 } }));
  await reading;
  assert.equal(controller.getSnapshot().creditAccount, null);
  assert.equal(controller.getSnapshot().creditAccountLoading, false);
  assert.equal(controller.getSnapshot().locked, true);
  controller.stop();
});
