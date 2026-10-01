const assert = require('node:assert/strict');
const { test, beforeEach, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'open-overskill-workspace-'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(out, 'node_modules'), 'dir');
for (const name of ['customer-store', 'customer-auth', 'customer-configuration', 'customer-workspace', 'customer-purchases', 'pilot-security', 'creator-provisioning', 'credit-account', 'builder-config']) {
  const source = fs.readFileSync(path.join(root, 'lib', `${name}.ts`), 'utf8');
  fs.writeFileSync(path.join(out, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText);
}
fs.writeFileSync(path.join(out, 'overskill.js'), 'module.exports = {};');
const provider = require(path.join(out, 'overskill.js'));
const auth = require(path.join(out, 'customer-auth.js'));
const persistence = require(path.join(out, 'customer-store.js'));
const workspace = require(path.join(out, 'customer-workspace.js'));
const purchases = require(path.join(out, 'customer-purchases.js'));
const origin = 'http://127.0.0.1:3577';
const oldEnv = { ...process.env };
const oldFetch = global.fetch;
const tempDirs = [];
function request(cookie, body) {
  return new Request(`${origin}/api/workspace`, { method: body === undefined ? 'GET' : 'POST', headers: { cookie: cookie || '', origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function demo(persona) {
  const response = await auth.createDemoCustomer(request('', { persona }));
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const req = request(cookie); const user = auth.requireCustomer(req);
  await workspace.provisionWorkspace(req, user);
  return { req, user, cookie };
}
function complete(user, id) {
  const db = persistence.getCustomerStore(); const app = db.getApp(user.id, id);
  db.saveApp(user.id, { ...app, status: { ...app.status, started_at: new Date(Date.now() - 7000).toISOString() } });
  return workspace.readWorkspaceApp(user, id);
}
function live() {
  process.env.OVERSKILL_MOCK = '0';
  process.env.OVERSKILL_LIVE_ENABLED = '1';
  process.env.OVERSKILL_PARTNER_API_KEY = 'fixture-partner-key';
  process.env.OPEN_OVERSKILL_OPERATOR_TOKEN = 'fixture-operator-token-at-least-32-characters';
  process.env.OPEN_OVERSKILL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  const db = persistence.getCustomerStore();
  const user = db.upsertIdentity({ issuer: 'https://fixture.invalid', subject: 'one', email: 'one@example.invalid', emailVerified: true, name: 'One' });
  db.saveCreator(user.id, { key: 'secret-creator-key', binding: { id: 1, keyId: 3, externalId: user.externalCreatorId, teamId: 21 }, provisioned: { team: { id: 21 } } });
  const token = db.createSession(user.id, Date.now() + 60_000);
  provider.getCreatorUsage = async () => ({ ok: false, status: 404, json: {} });
  provider.getUsage = async () => ({ ok: true, status: 200, json: { team_id: 21, credits: { balance: 1000 } } });
  return { db, user, req: request(`open_overskill_customer=${token}`) };
}
function readyApp(db, user, overrides = {}) {
  const stamp = new Date().toISOString();
  const app = { id: 'local-app', userId: user.id, appId: 'core-app', jobId: 'job-old', name: 'App', prompt: 'First prompt', status: { app_id: 'core-app', job_id: 'job-old', status: 'completed', progress: 100, message: 'Ready', app: null, started_at: stamp, completed_at: stamp }, messages: [], publishedUrl: null, deployState: 'idle', createdAt: stamp, updatedAt: stamp, simulated: false, submissionState: 'confirmed', ...overrides };
  db.saveApp(user.id, app); return app;
}
beforeEach(() => {
  process.env.OVERSKILL_MOCK = '1';
  process.env.OPEN_OVERSKILL_ORIGIN = origin;
  delete process.env.OPEN_OVERSKILL_ENCRYPTION_KEY;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-overskill-customers-')); tempDirs.push(dir);
  process.env.OPEN_OVERSKILL_DATA_DIR = dir;
  global.fetch = async () => { throw new Error('Provider network is forbidden in this suite'); };
  for (const name of Object.keys(provider)) delete provider[name];
});
after(() => {
  global.fetch = oldFetch;
  for (const store of global.__openOverskillCustomers?.values() || []) store.close();
  delete global.__openOverskillCustomers;
  for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
  Object.assign(process.env, oldEnv);
  for (const dir of [...tempDirs, out]) fs.rmSync(dir, { recursive: true, force: true });
});

test('two customer journeys persist independently and deny cross-customer read/edit/deploy/preview', async () => {
  const alice = await demo('alice');
  const app = await workspace.generateWorkspaceApp(alice.req, alice.user, { prompt: 'An agency client portal' });
  assert.equal(app.simulated, true); assert.equal(app.status.status, 'queued');
  assert.equal('operationToken' in app, false);
  await complete(alice.user, app.id);
  const published = await workspace.deployWorkspaceApp(alice.req, alice.user, app.id);
  assert.equal(published.deployState, 'demo');
  const bob = await demo('bob');
  assert.equal(workspace.workspaceHome(bob.user).apps.length, 0);
  for (const action of [() => workspace.readWorkspaceApp(bob.user, app.id), () => workspace.generateWorkspaceApp(bob.req, bob.user, { prompt: 'Steal', appId: app.id }), () => workspace.deployWorkspaceApp(bob.req, bob.user, app.id)]) {
    await assert.rejects(action, e => e.status === 404);
  }
  assert.throws(() => workspace.demoPreview(bob.user, app.id), e => e.status === 404);
  auth.logoutCustomer(request(alice.cookie, {}));
  assert.throws(() => auth.requireCustomer(alice.req), e => e.status === 401);
  const returned = await demo('alice');
  assert.equal(returned.user.id, alice.user.id);
  assert.equal(workspace.workspaceHome(returned.user).apps[0].id, app.id);
  const edit = await workspace.generateWorkspaceApp(returned.req, returned.user, { appId: app.id, prompt: 'Add project milestones' });
  assert.equal(edit.id, app.id); assert.equal(edit.deployState, 'idle');
  await complete(returned.user, app.id);
  const reopened = new persistence.CustomerStore(process.env.OPEN_OVERSKILL_DATA_DIR, 'demo');
  assert.equal(reopened.listApps(returned.user.id)[0].prompt, 'Add project milestones');
  assert.equal(reopened.listApps(bob.user.id).length, 0); reopened.close();
});

test('a forged payer is rejected and the local demo has no checkout or real balance changes', async () => {
  const { req, user } = await demo('alice');
  await assert.rejects(() => workspace.generateWorkspaceApp(req, user, { prompt: 'App', payerTeamId: 999 }), e => e.status === 400);
  const credits = await workspace.workspaceCredits(user); assert.equal(credits.telemetry, 'simulated');
  const packs = await workspace.workspacePacks(user); assert.equal(packs.checkoutAvailable, false); assert.deepEqual(packs.packs, []);
});

test('slow old-job reads cannot overwrite a newer edit or deployment state', async () => {
  const { db, user } = live(); const original = readyApp(db, user);
  let resolve;
  provider.getStatus = () => new Promise(r => { resolve = r; });
  provider.getMessages = async () => ({ ok: true, status: 200, json: { app_id: original.appId, job_id: original.jobId, messages: [] } });
  const reading = workspace.readWorkspaceApp(user, original.id);
  db.saveApp(user.id, { ...original, prompt: 'New edit', jobId: 'job-new', status: { ...original.status, job_id: 'job-new', status: 'queued' } });
  resolve({ ok: true, status: 200, json: original.status });
  const result = await reading;
  assert.equal(result.jobId, 'job-new'); assert.equal(result.prompt, 'New edit');
  assert.equal(db.getApp(user.id, original.id).jobId, 'job-new');
});

test('publication requires the returned attempt, production environment and deployed terminal state', async () => {
  const { db, user } = live(); const original = readyApp(db, user, { deployState: 'queued', deploymentId: 88 });
  provider.getStatus = async () => ({ ok: true, status: 200, json: original.status });
  provider.getMessages = async () => ({ ok: true, status: 200, json: { app_id: original.appId, job_id: original.jobId, messages: [] } });
  const response = { app_id: original.appId, deployment: { id: 87, environment: 'production', status: 'deployed', deployed_at: new Date().toISOString() }, urls: { production: 'https://published.example.invalid' } };
  provider.getDeploymentStatus = async (_session, appId, deploymentId) => {
    assert.equal(appId, original.appId); assert.equal(deploymentId, 88);
    return { ok: true, status: 200, json: response };
  };
  assert.equal((await workspace.readWorkspaceApp(user, original.id)).deployState, 'queued');
  response.deployment.id = 88; response.deployment.status = 'verifying';
  assert.equal((await workspace.readWorkspaceApp(user, original.id)).deployState, 'queued');
  response.deployment.status = 'deployed'; response.deployment.environment = 'preview';
  assert.equal((await workspace.readWorkspaceApp(user, original.id)).deployState, 'queued');
  response.deployment.environment = 'production';
  assert.equal((await workspace.readWorkspaceApp(user, original.id)).deployState, 'published');
});

test('publication refuses legacy backends before dispatch and requires a tracked receipt', async () => {
  const { db, user, req } = live(); const original = readyApp(db, user);
  let calls = 0;
  const readiness = { app_id: original.appId, deployment: null, urls: {} };
  provider.getDeploymentStatus = async () => ({ ok: true, status: 200, json: readiness });
  provider.deployTracked = async () => { calls++; return { ok: true, status: 202, json: { deployment_id: 88, tracking: 'request-v1' } }; };
  await assert.rejects(() => workspace.deployWorkspaceApp(req, user, original.id), e => e.code === 'publication_unavailable');
  assert.equal(calls, 0); assert.equal(db.getApp(user.id, original.id).deployState, 'idle');
  readiness.capabilities = { deployment_tracking: 'request-v1' };
  const accepted = await workspace.deployWorkspaceApp(req, user, original.id);
  assert.equal(calls, 1); assert.equal(accepted.deployState, 'queued'); assert.equal(accepted.publishedUrl, null);
  await workspace.deployWorkspaceApp(req, user, original.id);
  assert.equal(calls, 1, 'a confirmed request is not dispatched twice');
});

test('an untracked or lost deployment acknowledgement holds the request without retry', async () => {
  const { db, user, req } = live(); const original = readyApp(db, user);
  provider.getDeploymentStatus = async () => ({ ok: true, status: 200, json: { app_id: original.appId, capabilities: { deployment_tracking: 'request-v1' } } });
  let calls = 0;
  provider.deployTracked = async () => { calls++; return { ok: true, status: 202, json: { deployment_id: 88 } }; };
  await assert.rejects(() => workspace.deployWorkspaceApp(req, user, original.id), e => e.code === 'deployment_unconfirmed');
  assert.equal(db.getApp(user.id, original.id).deploymentId, undefined);
  const retry = await workspace.deployWorkspaceApp(req, user, original.id);
  assert.equal(retry.deployState, 'queued'); assert.match(retry.attention, /unconfirmed/); assert.equal(calls, 1);
});

test('ambiguous generation remains durable and cannot be blindly retried', async () => {
  const { db, user, req } = live();
  let calls = 0;
  provider.generate = async () => { calls++; return { ok: false, status: 502, json: {} }; };
  await assert.rejects(() => workspace.generateWorkspaceApp(req, user, { prompt: 'First build' }), e => e.code === 'submission_unconfirmed');
  const pending = db.listApps(user.id)[0]; assert.equal(pending.submissionState, 'unknown');
  await assert.rejects(() => workspace.generateWorkspaceApp(req, user, { prompt: 'Repeat' }), e => e.code === 'submission_unresolved');
  assert.equal(calls, 1);
});

test('a definitive build rejection preserves prior work and does not strand a new app', async () => {
  const { db, user, req } = live(); const original = readyApp(db, user);
  provider.generate = async () => ({ ok: false, status: 402, json: { error: 'No credits' } });
  await assert.rejects(() => workspace.generateWorkspaceApp(req, user, { appId: original.id, prompt: 'Rejected edit' }), e => e.status === 402 && e.code === 'build_rejected');
  assert.deepEqual(db.getApp(user.id, original.id), original);
  await assert.rejects(() => workspace.generateWorkspaceApp(req, user, { prompt: 'Rejected new app' }), e => e.code === 'build_rejected');
  assert.equal(db.listApps(user.id).length, 1);
  provider.generate = async () => ({ ok: true, status: 202, json: { app_id: original.appId, job_id: 'new-job' } });
  const retry = await workspace.generateWorkspaceApp(req, user, { appId: original.id, prompt: 'Explicit later edit' });
  assert.equal(retry.jobId, 'new-job');
});

test('progress and conversation must identify the exact current job, including message-ID fallback', async () => {
  const { db, user } = live(); const original = readyApp(db, user, { jobId: '12345' });
  const response = { ...original.status, job_id: 'older-job' };
  const transcript = { app_id: original.appId, job_id: '12345', messages: [] };
  provider.getStatus = async () => ({ ok: true, status: 200, json: response });
  provider.getMessages = async () => ({ ok: true, status: 200, json: transcript });
  await assert.rejects(() => workspace.readWorkspaceApp(user, original.id), e => e.code === 'workspace_response_mismatch');
  assert.deepEqual(db.getApp(user.id, original.id), original);
  response.job_id = '12345'; transcript.job_id = 'older-job';
  await assert.rejects(() => workspace.readWorkspaceApp(user, original.id), e => e.code === 'workspace_response_mismatch');
  transcript.job_id = '12345';
  assert.equal((await workspace.readWorkspaceApp(user, original.id)).status.job_id, '12345');
});

test('credit latency cannot admit an edit against a stale completed snapshot', async () => {
  const { db, user, req } = live(); const original = readyApp(db, user);
  let resolve;
  provider.getUsage = () => new Promise(r => { resolve = r; });
  let calls = 0; provider.generate = async () => { calls++; throw new Error('Should not submit'); };
  const submitting = workspace.generateWorkspaceApp(req, user, { prompt: 'Late edit', appId: original.id });
  // readCreditAccountSnapshot first awaits creator usage, then calls legacy usage.
  await new Promise(r => setImmediate(r));
  db.saveApp(user.id, { ...original, jobId: 'other-job', status: { ...original.status, status: 'processing' } });
  resolve({ ok: true, status: 200, json: { team_id: 21, credits: { balance: 1000 } } });
  await assert.rejects(() => submitting, e => e.code === 'workspace_changed');
  assert.equal(calls, 0);
});

function packFixture() {
  provider.getCreatorPackCapability = async () => ({ ok: true, status: 200, json: {
    available: true, version: 'creator-credit-packs-v1', packs: [{ id: 'starter', name: 'Starter', total_credits: 1000, discounted_price_cents: 1000 }],
  } });
  return { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', pack_id: 'starter', checkout_state: 'open', purchase_status: 'pending',
    total_credits: 1000, price_cents: 1000, currency: 'usd', checkout_url: 'https://whop.com/checkout/ch_fixture', credits_granted: false };
}

test('checkout persists its intent before one creator-key dispatch and treats open as unpaid', async () => {
  const { db, user, req } = live(); const receipt = packFixture(); let calls = 0;
  provider.createCreatorPackPurchase = async (session, packId, key) => {
    calls++; const saved = db.latestPurchase(user.id);
    assert.equal(saved.idempotencyKey, key); assert.equal(saved.checkoutState, 'submitting');
    assert.equal(session.creatorKey, 'secret-creator-key'); assert.equal(packId, 'starter');
    return { ok: true, status: 200, json: { purchase: receipt } };
  };
  provider.getCreatorPackPurchase = async (_session, id, byKey) => { assert.equal(id, receipt.id); assert.equal(byKey, false); return { ok: true, status: 200, json: { purchase: receipt } }; };
  const purchase = await purchases.createWorkspacePurchase(req, user, { packId: 'starter' });
  assert.equal(purchase.checkoutState, 'open'); assert.equal(purchase.creditsGranted, false);
  assert.equal('idempotencyKey' in purchase, false); assert.equal('userId' in purchase, false);
  await purchases.createWorkspacePurchase(req, user, { packId: 'starter' });
  assert.equal(calls, 1);
  receipt.purchase_status = 'completed'; receipt.credits_granted = true; receipt.checkout_url = null;
  const confirmed = await purchases.readWorkspacePurchase(user);
  assert.equal(confirmed.checkoutState, 'resolved'); assert.equal(confirmed.checkoutUrl, null);
  assert.equal(confirmed.creditsGranted, true);
  receipt.purchase_status = 'refunded'; receipt.credits_granted = false;
  assert.equal((await purchases.readWorkspacePurchase(user)).purchaseStatus, 'refunded');
});

test('lost checkout responses recover only with read-by-key and a 404 never dispatches again', async () => {
  const { db, user, req } = live(); const receipt = packFixture(); let calls = 0; let known = false;
  provider.createCreatorPackPurchase = async () => { calls++; return { ok: false, status: 502, json: {} }; };
  provider.getCreatorPackPurchase = async (session, key, byKey) => {
    assert.equal(session.creatorKey, 'secret-creator-key'); assert.equal(key, db.latestPurchase(user.id).idempotencyKey); assert.equal(byKey, true);
    return known ? { ok: true, status: 200, json: { purchase: receipt } } : { ok: false, status: 404, json: {} };
  };
  assert.equal((await purchases.createWorkspacePurchase(req, user, { packId: 'starter' })).checkoutState, 'unknown');
  assert.equal((await purchases.createWorkspacePurchase(req, user, { packId: 'starter' })).checkoutState, 'unknown');
  assert.equal(calls, 1); known = true;
  assert.equal((await purchases.readWorkspacePurchase(user)).checkoutState, 'open'); assert.equal(calls, 1);
});

test('checkout rejects forged pricing/payers, unavailable capability and demo payments', async () => {
  const { user, req } = live(); packFixture(); let calls = 0;
  provider.createCreatorPackPurchase = async () => { calls++; throw new Error('Must not dispatch'); };
  await assert.rejects(() => purchases.createWorkspacePurchase(req, user, { packId: 'starter', teamId: 99 }), e => e.status === 400);
  await assert.rejects(() => purchases.createWorkspacePurchase(req, user, { packId: 'unknown' }), e => e.code === 'purchase_unavailable');
  provider.getCreatorPackCapability = async () => ({ ok: true, status: 200, json: { available: false, version: 'creator-credit-packs-v1', packs: [] } });
  await assert.rejects(() => purchases.createWorkspacePurchase(req, user, { packId: 'starter' }), e => e.code === 'purchase_unavailable');
  assert.equal(calls, 0);
  process.env.OVERSKILL_MOCK = '1'; const alice = await demo('alice');
  await assert.rejects(() => purchases.createWorkspacePurchase(alice.req, alice.user, { packId: 'starter' }), e => e.code === 'demo_purchase_unavailable');
  assert.equal(await purchases.readWorkspacePurchase(alice.user), null);
});

test('purchase ownership and receipt validation reject foreign identities and unsafe checkout links', async () => {
  const { db, user, req } = live(); const receipt = packFixture();
  provider.createCreatorPackPurchase = async () => ({ ok: true, status: 200, json: { purchase: { ...receipt, checkout_url: 'https://whop.com.attacker.invalid/checkout' } } });
  const unsafe = await purchases.createWorkspacePurchase(req, user, { packId: 'starter' });
  assert.equal(unsafe.checkoutState, 'unknown'); assert.equal(unsafe.checkoutUrl, null);
  const other = db.upsertIdentity({ issuer: 'https://fixture.invalid', subject: 'two', emailVerified: true, name: 'Two' });
  assert.equal(db.latestPurchase(other.id), undefined); assert.equal(await purchases.readWorkspacePurchase(other), null);
  provider.getCreatorPackPurchase = async () => ({ ok: true, status: 200, json: { purchase: { ...receipt, pack_id: 'another-pack' } } });
  assert.equal((await purchases.readWorkspacePurchase(user)).checkoutState, 'unknown');
});

test('concurrent checkout submissions and a restarted store cannot duplicate provider dispatch', async () => {
  const { db, user, req } = live(); const receipt = packFixture(); let calls = 0; let release;
  provider.createCreatorPackPurchase = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  provider.getCreatorPackPurchase = async () => ({ ok: false, status: 404, json: {} });
  const first = purchases.createWorkspacePurchase(req, user, { packId: 'starter' });
  await new Promise(resolve => setImmediate(resolve));
  const reopened = new persistence.CustomerStore(process.env.OPEN_OVERSKILL_DATA_DIR, 'live');
  assert.equal(reopened.latestPurchase(user.id).checkoutState, 'submitting'); reopened.close();
  await purchases.createWorkspacePurchase(req, user, { packId: 'starter' });
  release({ ok: true, status: 200, json: { purchase: receipt } }); await first;
  assert.equal(calls, 1);
  provider.getCreatorPackPurchase = async () => ({ ok: true, status: 200, json: { purchase: receipt } });
  assert.equal((await purchases.readWorkspacePurchase(user)).checkoutState, 'open');
  assert.equal(db.latestPurchase(user.id).coreId, receipt.id);
});

test('a stale failed purchase read preserves settlement while a newer purchase is active', async () => {
  const { db, user, req } = live(); const receipt = packFixture();
  receipt.purchase_status = 'completed'; receipt.credits_granted = true; receipt.checkout_url = null;
  provider.createCreatorPackPurchase = async () => ({ ok: true, status: 200, json: { purchase: receipt } });
  const first = await purchases.createWorkspacePurchase(req, user, { packId: 'starter' });
  let finishRead;
  provider.getCreatorPackPurchase = () => new Promise(resolve => { finishRead = resolve; });
  const staleRead = purchases.readWorkspacePurchase(user);
  receipt.id = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'; receipt.purchase_status = 'pending'; receipt.credits_granted = false; receipt.checkout_url = 'https://whop.com/checkout/ch_second';
  const second = await purchases.createWorkspacePurchase(req, user, { packId: 'starter' });
  finishRead({ ok: false, status: 503, json: {} });
  const old = await staleRead;
  assert.equal(old.id, first.id); assert.equal(old.checkoutState, 'resolved'); assert.equal(old.purchaseStatus, 'completed');
  assert.equal(old.creditsGranted, true); assert.equal(old.readAvailable, false); assert.equal(old.checkoutUrl, null);
  assert.equal(db.latestPurchase(user.id).id, second.id);
  assert.equal(db.latestPurchase(user.id).checkoutState, 'open');
});

test('delayed catalog preflight cannot create another checkout after a competing request settles', async () => {
  const { user, req } = live(); const receipt = packFixture();
  const capability = provider.getCreatorPackCapability; let finishCatalog; let calls = 0;
  provider.getCreatorPackCapability = () => new Promise(resolve => { finishCatalog = resolve; });
  provider.createCreatorPackPurchase = async () => { calls++; return { ok: true, status: 200, json: { purchase: { ...receipt, purchase_status: 'completed', credits_granted: true, checkout_url: null } } }; };
  const slow = purchases.createWorkspacePurchase(req, user, { packId: 'starter' });
  provider.getCreatorPackCapability = capability;
  const fast = await purchases.createWorkspacePurchase(req, user, { packId: 'starter' });
  provider.getCreatorPackPurchase = async () => ({ ok: true, status: 200, json: { purchase: { ...receipt, purchase_status: 'completed', credits_granted: true, checkout_url: null } } });
  finishCatalog(await capability());
  assert.equal((await slow).id, fast.id); assert.equal(calls, 1);
});

test('catalog latency cannot bypass a same-receipt availability hold', async () => {
  const { db, user, req } = live(); const receipt = packFixture(); let calls = 0;
  receipt.purchase_status = 'completed'; receipt.credits_granted = true; receipt.checkout_url = null;
  provider.createCreatorPackPurchase = async () => { calls++; return { ok: true, status: 200, json: { purchase: receipt } }; };
  const first = await purchases.createWorkspacePurchase(req, user, { packId: 'starter' });
  const capability = provider.getCreatorPackCapability; let finish;
  provider.getCreatorPackCapability = () => new Promise(resolve => { finish = resolve; });
  const next = purchases.createWorkspacePurchase(req, user, { packId: 'starter' });
  const old = db.latestPurchase(user.id); db.savePurchase(old, { ...old, readAvailable: false });
  provider.getCreatorPackPurchase = async () => ({ ok: true, status: 200, json: { purchase: receipt } });
  finish(await capability());
  assert.equal((await next).id, first.id); assert.equal(calls, 1);
});
