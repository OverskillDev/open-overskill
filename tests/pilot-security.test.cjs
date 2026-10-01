const assert = require('node:assert/strict');
const { test, beforeEach, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

// Compile the actual route handlers and their dependencies into an isolated
// CommonJS tree. Tests use Node's native Request/Response and never call a real
// provider, provision accounts, spend credits, or deploy anything.
const project = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'open-overskill-security-'));
function compileDir(relative) {
  for (const entry of fs.readdirSync(path.join(project, relative), { withFileTypes: true })) {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) { compileDir(file); continue; }
    if (!file.endsWith('.ts')) continue;
    const destination = path.join(output, file.replace(/\.ts$/, '.js'));
    const source = fs.readFileSync(path.join(project, file), 'utf8').replace(/(["'])@\/([^"']+)\1/g, (_, quote, name) => JSON.stringify(path.join(output, name)));
    const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, result.outputText);
  }
}
compileDir('lib');
compileDir('app/api');
compileDir('app/preview');

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
process.env.OVERSKILL_PARTNER_API_KEY = 'test-partner-key-never-real';
process.env.OVERSKILL_API_BASE = 'http://localhost:3000';
process.env.OVERSKILL_MOCK = '1';
const security = require(path.join(output, 'lib/pilot-security.js'));
const adapter = require(path.join(output, 'lib/overskill.js'));
const route = (name) => require(path.join(output, 'app/api', name, 'route.js'));
const preview = require(path.join(output, 'app/preview/[appId]/route.js'));
const origin = 'http://localhost:3577';
function request(url, { method = 'GET', cookie, body, raw, headers = {} } = {}) {
  return new Request(`${origin}${url}`, {
    method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : raw,
  });
}
async function session() {
  const response = await route('auth').GET(request('/api/auth'));
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
async function provision(cookie) {
  return route('provision').POST(request('/api/provision', { method: 'POST', cookie, body: {} }));
}
async function build(cookie, prompt = 'A members portal') {
  const response = await route('generate').POST(request('/api/generate', { method: 'POST', cookie, body: { prompt } }));
  assert.equal(response.status, 202);
  return response.json();
}
beforeEach(() => {
  delete global.__openOverskillPilot;
  delete global.__fmMock;
  process.env.OVERSKILL_MOCK = '1';
  delete process.env.OVERSKILL_LIVE_ENABLED;
  delete process.env.OPEN_OVERSKILL_OPERATOR_TOKEN;
  delete process.env.OPEN_OVERSKILL_CREATOR_EMAIL;
  delete process.env.OVERSKILL_CREATOR_ID;
  global.fetch = async () => { throw new Error('Unexpected network request in security tests'); };
});

test('tracked deployment adapter uses creator credentials and the exact receipt query', async () => {
  process.env.OVERSKILL_MOCK = '0';
  process.env.OVERSKILL_LIVE_ENABLED = '1';
  process.env.OPEN_OVERSKILL_OPERATOR_TOKEN = 'test-operator-token-at-least-32-characters';
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json(options.method === 'POST' ? { deployment_id: 88, tracking: 'request-v1' } : { app_id: 'app/id', deployment: null });
  };
  const scoped = { creatorKey: 'test-only-creator-key' };
  await adapter.getDeploymentStatus(scoped, 'app/id');
  await adapter.deployTracked(scoped, 'app/id');
  await adapter.getDeploymentStatus(scoped, 'app/id', 88);
  assert.deepEqual(calls.map(c => c.url), [
    'http://localhost:3000/api/v1/managed_apps/app%2Fid/status',
    'http://localhost:3000/api/v1/managed_apps/app%2Fid/deploy',
    'http://localhost:3000/api/v1/managed_apps/app%2Fid/status?deployment_id=88',
  ]);
  for (const call of calls) assert.equal(call.options.headers['X-API-Key'], scoped.creatorKey);
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), { track_deployment: true });
});
after(() => {
  global.fetch = originalFetch;
  for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
  Object.assign(process.env, originalEnv);
  fs.rmSync(output, { recursive: true, force: true });
});

test('partner credentials alone never enable live billing calls', () => {
  assert.equal(security.isDemoMode({ OVERSKILL_PARTNER_API_KEY: 'present' }), true);
  assert.equal(security.isDemoMode({ OVERSKILL_MOCK: 'auto', OVERSKILL_PARTNER_API_KEY: 'present' }), true);
  assert.throws(() => security.requireLiveConfiguration({ OVERSKILL_MOCK: '0', OVERSKILL_PARTNER_API_KEY: 'present' }), { code: 'live_not_configured' });
});

test('sessions and origin checks block unauthenticated, remote and cross-origin mutations', async () => {
  const unauthenticated = await provision(undefined);
  assert.equal(unauthenticated.status, 401);
  const cookie = await session();
  const remote = await route('provision').POST(new Request('http://attacker.example/api/provision', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' }));
  assert.equal(remote.status, 403);
  const crossOrigin = await route('provision').POST(request('/api/provision', { method: 'POST', cookie, body: {}, headers: { origin: 'https://attacker.example' } }));
  assert.equal(crossOrigin.status, 403);
  const sameSite = await route('provision').POST(request('/api/provision', { method: 'POST', cookie, body: {}, headers: { 'sec-fetch-site': 'same-site' } }));
  assert.equal(sameSite.status, 403);
});

test('provision is session-bound, idempotent and strips generated keys', async () => {
  const first = await session();
  const second = await session();
  const firstResponse = await provision(first);
  assert.equal(firstResponse.status, 201);
  const firstJson = await firstResponse.json();
  assert.equal(firstJson.api_key.key, '[REDACTED]');
  const cached = await provision(first);
  assert.equal(cached.status, 200);
  assert.deepEqual(await cached.json(), firstJson);
  const secondJson = await (await provision(second)).json();
  assert.notEqual(secondJson.team.id, firstJson.team.id);
  const firstSession = security.requireSession(request('/api/status', { cookie: first }));
  const secondSession = security.requireSession(request('/api/status', { cookie: second }));
  assert.notEqual(firstSession.creatorKey, secondSession.creatorKey);
});

test('foreign sessions cannot read, refine, deploy or preview another session app', async () => {
  const owner = await session();
  await provision(owner);
  const app = await build(owner);
  const stranger = await session();
  await provision(stranger);
  for (const name of ['status', 'messages']) {
    assert.equal((await route(name).GET(request(`/api/${name}?id=${app.job_id}`, { cookie: stranger }))).status, 404);
  }
  assert.equal((await route('deploy').POST(request('/api/deploy', { method: 'POST', cookie: stranger, body: { appId: app.app_id } }))).status, 404);
  assert.equal((await route('generate').POST(request('/api/generate', { method: 'POST', cookie: stranger, body: { appId: app.app_id, prompt: 'Steal app' } }))).status, 404);
  assert.equal((await route('webhooks/events').GET(request(`/api/webhooks/events?appId=${app.app_id}`, { cookie: stranger }))).status, 404);
  assert.equal((await preview.GET(request(`/preview/${app.app_id}`, { cookie: stranger }), { params: Promise.resolve({ appId: app.app_id }) })).status, 404);
  assert.equal((await route('status').GET(request(`/api/status?id=${app.job_id}`, { cookie: owner }))).status, 200);
});

test('invalid JSON, nulls, oversized payloads and invalid values return bounded client errors', async () => {
  const cookie = await session();
  for (const raw of ['{', 'null', '[]', '"text"']) {
    assert.equal((await route('generate').POST(request('/api/generate', { method: 'POST', cookie, raw }))).status, 400);
  }
  assert.equal((await route('generate').POST(request('/api/generate', { method: 'POST', cookie, body: { prompt: 'x'.repeat(21_000) } }))).status, 413);
  assert.equal((await route('generate').POST(request('/api/generate', { method: 'POST', cookie, body: { prompt: { arbitrary: 'object' } } }))).status, 400);
  assert.equal((await route('generate').POST(request('/api/generate', { method: 'POST', cookie, raw: '{}', headers: { 'content-type': 'text/plain' } }))).status, 415);
  assert.equal((await route('generate').POST(request('/api/generate', { method: 'POST', cookie, body: { prompt: 'Valid prompt' } }))).status, 409);
});

test('preview escapes prompt HTML, sets a restrictive sandbox and rejects unknown apps', async () => {
  const cookie = await session();
  await provision(cookie);
  const app = await build(cookie, '<script>alert(document.cookie)</script>');
  const response = await preview.GET(request(`/preview/${app.app_id}`, { cookie }), { params: Promise.resolve({ appId: app.app_id }) });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /&lt;script&gt;alert\(document.cookie\)&lt;\/script&gt;/);
  assert.ok(!html.includes('<script>'));
  assert.match(response.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await preview.GET(request('/preview/missing', { cookie }), { params: Promise.resolve({ appId: 'missing' }) })).status, 404);
});

test('unverified callbacks are disabled, even when a payload looks valid', async () => {
  const response = await route('webhooks/overskill').POST(request('/api/webhooks/overskill', { method: 'POST', body: { app_id: 'app', event: 'app.generation.completed' } }));
  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, 'callbacks_disabled');
});

test('live requires token unlock; old demo sessions cannot become live sessions', async () => {
  const demoCookie = await session();
  process.env.OVERSKILL_MOCK = '0';
  assert.equal((await route('auth').GET(request('/api/auth', { cookie: demoCookie }))).status, 503);
  process.env.OVERSKILL_LIVE_ENABLED = '1';
  process.env.OPEN_OVERSKILL_OPERATOR_TOKEN = 'test-operator-token-with-32-plus-characters';
  assert.equal((await route('auth').GET(request('/api/auth', { cookie: demoCookie }))).status, 401);
  assert.equal((await route('session').POST(request('/api/session', { method: 'POST', body: { token: 'wrong' } }))).status, 401);
  const unlocked = await route('session').POST(request('/api/session', { method: 'POST', body: { token: process.env.OPEN_OVERSKILL_OPERATOR_TOKEN } }));
  assert.equal(unlocked.status, 200);
  assert.match(unlocked.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const cookie = unlocked.headers.get('set-cookie').split(';')[0];
  assert.equal(security.requireSession(request('/api/status', { cookie })).mode, 'live');
  process.env.OPEN_OVERSKILL_OPERATOR_TOKEN = 'rotated-operator-token-with-32-plus-characters';
  assert.throws(() => security.requireSession(request('/api/status', { cookie })), { code: 'operator_session_required' });
});

test('creator API never falls back to partner key and sends no callback URL', async () => {
  process.env.OVERSKILL_MOCK = '0';
  process.env.OVERSKILL_LIVE_ENABLED = '1';
  process.env.OPEN_OVERSKILL_OPERATOR_TOKEN = 'test-operator-token-with-32-plus-characters';
  const session = security.createSession(request('/api/session'));
  await assert.rejects(adapter.generate(session, { prompt: 'A build' }), { code: 'creator_required' });
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ app_id: 'live-app', job_id: 'live-job' }, { status: 202 });
  };
  session.creatorKey = 'isolated-creator-secret';
  await adapter.generate(session, { prompt: 'A build' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers['X-API-Key'], session.creatorKey);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(JSON.parse(calls[0].options.body).callback_url, undefined);
});

test('provider errors cannot leak known keys or nested credential fields', async () => {
  const response = security.apiResponse({ api_key: { key: 'new-secret', scope: 'read_write' }, nested: { access_token: 'bearer-secret' }, error: `contains ${process.env.OVERSKILL_PARTNER_API_KEY} and isolated-creator-secret` }, 400, { creatorKey: 'isolated-creator-secret' });
  const serialized = await response.text();
  for (const secret of ['new-secret', 'bearer-secret', process.env.OVERSKILL_PARTNER_API_KEY, 'isolated-creator-secret']) assert.ok(!serialized.includes(secret));
  assert.match(serialized, /read_write/);
});

test('logout deletes server-side keys and immediately revokes resource access', async () => {
  const cookie = await session();
  await provision(cookie);
  const app = await build(cookie);
  assert.equal((await route('session').DELETE(request('/api/session', { method: 'DELETE', cookie }))).status, 200);
  assert.equal((await route('status').GET(request(`/api/status?id=${app.job_id}`, { cookie }))).status, 401);
});

test('malformed isolated creator response fails closed and blocks generation', async () => {
  process.env.OVERSKILL_MOCK = '0';
  process.env.OVERSKILL_LIVE_ENABLED = '1';
  process.env.OPEN_OVERSKILL_OPERATOR_TOKEN = 'test-operator-token-with-32-plus-characters';
  process.env.OPEN_OVERSKILL_CREATOR_EMAIL = 'operator@example.invalid';
  process.env.OVERSKILL_CREATOR_ID = 'pilot-creator-1';
  const unlocked = await route('session').POST(request('/api/session', { method: 'POST', body: { token: process.env.OPEN_OVERSKILL_OPERATOR_TOKEN } }));
  const cookie = unlocked.headers.get('set-cookie').split(';')[0];
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/capabilities')) return Response.json({ creator_identity: { version: 1, key_recovery: 'compare_and_swap', onboarding_profile: 'api_creator_paid_v1' } });
    return Response.json({ team: { id: 123 }, api_key: null }, { status: 201 });
  };
  const response = await provision(cookie);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, 'invalid_creator_response');
  const generate = await route('generate').POST(request('/api/generate', { method: 'POST', cookie, body: { prompt: 'Should not spend credits' } }));
  assert.equal(generate.status, 409);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers['X-API-Key'], process.env.OVERSKILL_PARTNER_API_KEY);
});

test('expired sessions are rejected and removed with their creator credentials', async () => {
  const cookie = await session();
  await provision(cookie);
  const active = security.requireSession(request('/api/status', { cookie }));
  active.expiresAt = Date.now() - 1;
  assert.equal((await route('provision').POST(request('/api/provision', { method: 'POST', cookie, body: {} }))).status, 401);
  assert.equal(global.__openOverskillPilot.sessions.has(active.id), false);
});

test('invalid API origins and plaintext remote API connections fail closed', () => {
  const enabled = { OVERSKILL_MOCK: '0', OVERSKILL_LIVE_ENABLED: '1', OVERSKILL_PARTNER_API_KEY: 'fake', OPEN_OVERSKILL_OPERATOR_TOKEN: 'test-operator-token-with-32-plus-characters' };
  for (const base of ['http://public.example', 'not a URL', 'https://user:secret@example.com', 'https://example.com?token=secret', 'file:///private/secret']) {
    assert.throws(() => security.requireLiveConfiguration({ ...enabled, OVERSKILL_API_BASE: base }), { code: 'invalid_api_base' });
  }
  assert.doesNotThrow(() => security.requireLiveConfiguration({ ...enabled, OVERSKILL_API_BASE: 'https://api.example.com' }));
});

test('Next normalized URL uses validated direct Host for origin, never forwarded host', async () => {
  // Next builds req.url with localhost even for a direct 127.0.0.1 browser URL.
  const valid = request('/api/session', { method: 'POST', body: {}, headers: { host: '127.0.0.1:3577', origin: 'http://127.0.0.1:3577' } });
  assert.equal((await route('session').POST(valid)).status, 200);
  const otherPort = request('/api/session', { method: 'POST', body: {}, headers: { host: '127.0.0.1:3577', origin: 'http://127.0.0.1:9999' } });
  assert.equal((await route('session').POST(otherPort)).status, 403);
  const forgedForwarding = request('/api/session', { method: 'POST', body: {}, headers: { host: '127.0.0.1:3577', origin: 'https://attacker.example', 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'https' } });
  assert.equal((await route('session').POST(forgedForwarding)).status, 403);
  const hostileHost = request('/api/session', { method: 'POST', body: {}, headers: { host: 'attacker.example', origin: 'http://attacker.example', 'x-forwarded-host': 'localhost:3577' } });
  assert.equal((await route('session').POST(hostileHost)).status, 403);
});

test('editing keeps the app identity while preserving each generation transcript', async () => {
  const cookie = await session();
  await provision(cookie);
  const original = await build(cookie, 'Original creator portal');
  const response = await route('generate').POST(request('/api/generate', { method: 'POST', cookie, body: { appId: original.app_id, prompt: 'Add an events section' } }));
  assert.equal(response.status, 202);
  const edited = await response.json();
  assert.equal(edited.app_id, original.app_id);
  assert.notEqual(edited.job_id, original.job_id);
  const originalMessages = await (await route('messages').GET(request(`/api/messages?id=${original.job_id}`, { cookie }))).json();
  const editedMessages = await (await route('messages').GET(request(`/api/messages?id=${edited.job_id}`, { cookie }))).json();
  assert.equal(originalMessages.job_id, original.job_id);
  assert.equal(originalMessages.messages[0].content, 'Original creator portal');
  assert.equal(editedMessages.job_id, edited.job_id);
  assert.equal(editedMessages.messages[0].content, 'Add an events section');
  const originalStatus = await (await route('status').GET(request(`/api/status?id=${original.job_id}`, { cookie }))).json();
  assert.equal(originalStatus.job_id, original.job_id);
});

async function liveSession() {
  process.env.OVERSKILL_MOCK = '0';
  process.env.OVERSKILL_LIVE_ENABLED = '1';
  process.env.OPEN_OVERSKILL_OPERATOR_TOKEN = 'test-operator-token-with-32-plus-characters';
  process.env.OPEN_OVERSKILL_CREATOR_EMAIL = 'operator@example.invalid';
  process.env.OVERSKILL_CREATOR_ID = 'pilot-creator-1';
  const response = await route('session').POST(request('/api/session', { method: 'POST', body: { token: process.env.OPEN_OVERSKILL_OPERATOR_TOKEN } }));
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
const capabilityResponse = () => Response.json({ creator_identity: { version: 1, key_recovery: 'compare_and_swap', onboarding_profile: 'api_creator_paid_v1' } });
const creatorResponse = (overrides = {}) => ({
  team: { id: 123, name: 'Creator workspace', subscription_tier: 'free', credit_tier: 'tier_500', created_at: '2026-09-29T00:00:00Z' },
  creator: { id: 12, external_creator_id: 'pilot-creator-1' },
  user_added: true, replayed: false,
  api_key: { id: 24, key: 'creator-private-first-key', scope: 'read_write', name: 'Creator key', recovery_required: false },
  ...overrides,
});

test('stable identity is required and an old backend cannot receive a create POST', async () => {
  const cookie = await liveSession();
  let calls = [];
  global.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({}, { status: 404 }); };
  delete process.env.OVERSKILL_CREATOR_ID;
  assert.equal((await provision(cookie)).status, 503);
  assert.equal(calls.length, 0);
  process.env.OVERSKILL_CREATOR_ID = 'pilot-creator-1';
  const unavailable = await provision(cookie);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).code, 'creator_identity_unavailable');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.match(calls[0].url, /creators\/capabilities$/);
});

test('live provisioning sends stable server identity, keeps a stored key and never rotates on replay', async () => {
  const cookie = await liveSession();
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/capabilities') ? capabilityResponse() : Response.json(creatorResponse(), { status: 201 });
  };
  const response = await provision(cookie);
  assert.equal(response.status, 201);
  const json = await response.json();
  assert.equal(json.recoveryRequired, false);
  assert.equal(json.api_key.key, '[REDACTED]');
  assert.equal(JSON.parse(calls[1].options.body).external_creator_id, 'pilot-creator-1');
  assert.equal(JSON.parse(calls[1].options.body).expected_onboarding_profile, 'api_creator_paid_v1');
  assert.equal(JSON.parse(calls[1].options.body).user_email, 'operator@example.invalid');
  await provision(cookie);
  assert.equal(calls.length, 2);
  const recover = await route('creator/recover').POST(request('/api/creator/recover', { method: 'POST', cookie, body: {} }));
  assert.equal(recover.status, 409);
  assert.equal(calls.length, 2);
});

test('identity support alone cannot provision before zero-credit onboarding is advertised', async () => {
  await liveSession();
  for (const profile of [undefined, 'standard_signup', { profile: 'api_creator_paid_v1' }]) {
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, method: options.method });
      return Response.json({ creator_identity: { version: 1, key_recovery: 'compare_and_swap', onboarding_profile: profile } });
    };
    await assert.rejects(() => adapter.provisionCreator({ name: 'New customer', userEmail: 'new@example.invalid' }), e => e.code === 'creator_onboarding_unavailable');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.match(calls[0].url, /creators\/capabilities$/);
  }
});

test('replayed creator without raw key requires explicit CAS recovery before any build', async () => {
  const cookie = await liveSession();
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/capabilities')) return capabilityResponse();
    if (url.endsWith('/recover_api_key')) return Response.json(creatorResponse({ replayed: true, api_key: { id: 25, key: 'creator-private-recovered-key', scope: 'read_write', name: 'Creator key' } }));
    return Response.json(creatorResponse({ replayed: true, api_key: { id: 24, key: null, scope: 'read_write', recovery_required: true } }));
  };
  const response = await provision(cookie);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).recoveryRequired, true);
  const blocked = await route('generate').POST(request('/api/generate', { method: 'POST', cookie, body: { prompt: 'Build' } }));
  assert.equal(blocked.status, 409);
  assert.equal(calls.length, 2);
  const recovered = await route('creator/recover').POST(request('/api/creator/recover', { method: 'POST', cookie, body: {} }));
  assert.equal(recovered.status, 200);
  const json = await recovered.json();
  assert.equal(json.recoveryRequired, false);
  assert.equal(json.api_key.key, '[REDACTED]');
  assert.deepEqual(JSON.parse(calls[2].options.body), { expected_key_id: 24 });
  assert.match(calls[2].url, /creators\/12\/recover_api_key$/);
  assert.equal(calls[2].options.headers['X-API-Key'], process.env.OVERSKILL_PARTNER_API_KEY);
  assert.equal(security.requireSession(request('/api/status', { cookie })).creatorKey, 'creator-private-recovered-key');
});

test('uncertain recovery never discovers and rotates a new key automatically', async () => {
  const cookie = await liveSession();
  const recoveryIds = [];
  global.fetch = async (url, options) => {
    if (url.endsWith('/capabilities')) return capabilityResponse();
    if (url.endsWith('/recover_api_key')) {
      recoveryIds.push(JSON.parse(options.body).expected_key_id);
      if (recoveryIds.length === 1) throw new Error('Response lost');
      return Response.json({ error: 'creator_key_changed', message: 'Reconcile credential storage before recovery.' }, { status: 409 });
    }
    return Response.json(creatorResponse({ replayed: true, api_key: { id: 24, key: null, scope: 'read_write', recovery_required: true } }));
  };
  await provision(cookie);
  const recover = () => route('creator/recover').POST(request('/api/creator/recover', { method: 'POST', cookie, body: {} }));
  assert.equal((await recover()).status, 502);
  assert.equal(recoveryIds.length, 1);
  assert.equal((await recover()).status, 409);
  assert.deepEqual(recoveryIds, [24, 24]);
  assert.equal(security.requireSession(request('/api/status', { cookie })).creatorKey, undefined);
});

test('wrong identity responses and browser identity overrides fail closed', async () => {
  const cookie = await liveSession();
  let calls = 0;
  global.fetch = async (url) => {
    calls++;
    return url.endsWith('/capabilities') ? capabilityResponse() : Response.json(creatorResponse({ creator: { id: 12, external_creator_id: 'another-creator' } }), { status: 201 });
  };
  const override = await route('provision').POST(request('/api/provision', { method: 'POST', cookie, body: { userEmail: 'another@example.invalid' } }));
  assert.equal(override.status, 400);
  assert.equal(calls, 0);
  assert.equal((await provision(cookie)).status, 502);
  assert.equal(security.requireSession(request('/api/status', { cookie })).creatorKey, undefined);
  const foreign = await route('creator/recover').POST(request('/api/creator/recover', { method: 'POST', cookie, body: { creatorId: 99, expectedKeyId: 100 } }));
  assert.equal(foreign.status, 400);
  assert.equal(calls, 2);
});

test('unsupported partner payer selections are rejected before any generation', async () => {
  const cookie = await session();
  await provision(cookie);
  for (const selection of [{creditResponsibility:'partner'}, {sponsorTeamId:42}, {payerTeamId:42}]) {
    const response = await route('generate').POST(request('/api/generate', { method: 'POST', cookie, body: { prompt: 'Build', ...selection } }));
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, 'unsupported_credit_responsibility');
  }
  assert.equal(global.__fmMock.apps.size, 0);
});

test('usage adapter uses only creator credentials and never falls back to partner key', async () => {
  await liveSession();
  const active = security.createSession(request('/api/session'));
  await assert.rejects(adapter.getUsage(active), { code: 'creator_required' });
  const calls = [];
  global.fetch = async (url, options) => { calls.push({url, options}); return Response.json({team_id:123, credits:{balance:500}}); };
  active.creatorKey = 'creator-usage-private-key';
  assert.equal((await adapter.getUsage(active)).ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /api\/v1\/usage$/);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers['X-API-Key'], active.creatorKey);
});

test('creator meter adapter is a single read with the creator key, including failure responses', async () => {
  await liveSession();
  const active = security.createSession(request('/api/session'));
  await assert.rejects(adapter.getCreatorUsage(active), { code: 'creator_required' });
  active.creatorKey = 'creator-meter-private-key';
  for (const status of [200, 404, 429, 503]) {
    const calls = [];
    global.fetch = async (url, options) => { calls.push({url,options}); return Response.json({}, {status}); };
    const result = await adapter.getCreatorUsage(active);
    assert.equal(result.status, status); assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/v1\/creator_usage\?period=30d$/);
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.headers['X-API-Key'], active.creatorKey);
    assert.equal(calls[0].options.cache, 'no-store');
    assert.equal(calls[0].options.redirect, 'error');
  }
});

function unavailableMeter(teamId=123) {
  const unknown=source=>({status:'unknown',value:null,unit:'credits',source,reason:'read_failed'});
  return {schema_version:1,team_id:teamId,status:'unavailable',period:'30d',
    window:{from:'2026-08-30T15:00:00Z',through:'2026-09-29T15:00:00Z'},observed_at:'2026-09-29T15:00:00Z',snapshot_consistency:'request_local_non_atomic',
    metrics:{gross_recorded_generation_debits:unknown('credit_transaction_and_token_ledger_entry'),spendable:unknown('team_credit_balance_excluding_expired_sources'),reservations:unknown('credit_transaction_pending_reservations'),available_for_admission:unknown('team_spendable_minus_pending_reservations')},
    whop:{cached_balance:unknown('token_balance_cache'),pending_sync:unknown('token_balance_pending_deductions'),last_synced_at:null,provider_authoritative:false,wallet_isolation:'unverified'},
    auto_billing:{status:'not_reported',topup_enabled:null,tier_upgrade_enabled:null,overage_enabled:null},trial:{status:'requires_app_context'},refunds:{status:'not_reported'},net_charge:{status:'not_reported'},spending_cap:null};
}

test('direct generation POST fails closed for unavailable meter and only accepts usable legacy fallback', async () => {
  for(const mode of ['typed503','server500','offline','foreign','legacyMissing','legacyKnownZero','partial']) {
    delete global.__openOverskillPilot;
    const cookie=await liveSession();
    const state=security.requireSession(request('/api/generate',{cookie}));
    state.creatorKey='creator-only-fixture'; state.provisioned={team:{id:123}};
    const calls=[];
    global.fetch=async(url,options)=>{
      calls.push({url,method:options.method,key:options.headers['X-API-Key']});
      if(url.includes('/creator_usage')) {
        if(mode==='offline')throw new Error('No connection');
        if(mode.startsWith('legacy'))return Response.json({}, {status:404});
        if(mode==='server500')return Response.json({}, {status:500});
        const meter=unavailableMeter(mode==='foreign'?999:123);
        if(mode==='partial') {meter.status='partial';meter.metrics.gross_recorded_generation_debits={status:'known',value:0,unit:'credits',source:'credit_transaction_and_token_ledger_entry'};}
        return Response.json(meter,{status:mode==='partial'?200:503});
      }
      if(url.endsWith('/usage'))return Response.json({team_id:123,credits:{balance:mode==='legacyKnownZero'?0:null}});
      assert.match(url,/generation_queue$/);
      return Response.json({app_id:'fixture-app',job_id:'fixture-job',status:'queued'},{status:202});
    };
    const response=await route('generate').POST(request('/api/generate',{method:'POST',cookie,body:{prompt:'Keep scoped'}}));
    const allowed=['legacyKnownZero','partial'].includes(mode);
    assert.equal(response.status,allowed?202:mode==='foreign'?502:503,mode);
    assert.equal(calls.filter(x=>x.method==='POST').length,allowed?1:0,mode);
    assert.equal(calls.filter(x=>x.url.endsWith('/usage')).length,mode.startsWith('legacy')?1:0,mode);
    assert.ok(calls.every(x=>x.key==='creator-only-fixture'));
  }
});

test('locking the session during meter preflight prevents provider dispatch', async () => {
  const cookie=await liveSession();
  const state=security.requireSession(request('/api/generate',{cookie}));
  state.creatorKey='creator-only-fixture';state.provisioned={team:{id:123}};
  let releaseRead, started;
  const pending=new Promise(resolve=>{releaseRead=resolve});
  const reading=new Promise(resolve=>{started=resolve});
  const calls=[];
  global.fetch=async(url,options)=>{
    calls.push({url,method:options.method});
    started();await pending;
    if(url.includes('/creator_usage'))return Response.json({}, {status:404});
    return Response.json({team_id:123,credits:{balance:10}});
  };
  const generating=route('generate').POST(request('/api/generate',{method:'POST',cookie,body:{prompt:'Cancelled'}}));
  await reading;
  await route('session').DELETE(request('/api/session',{method:'DELETE',cookie}));
  releaseRead();
  assert.equal((await generating).status,401);
  assert.ok(calls.every(x=>x.method==='GET'));
});
