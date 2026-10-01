const assert = require('node:assert/strict');
const { test, beforeEach, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

// Compile the real normalizer, guard and route. Only the provider adapter is
// stubbed: this suite cannot provision, bill, reconcile or call a provider.
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'open-overskill-credit-account-'));
for (const file of ['lib/credit-account.ts', 'lib/pilot-security.ts', 'app/api/credit-account/route.ts']) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    .replace(/(["'])@\/([^"']+)\1/g, (_, quote, name) => JSON.stringify(path.join(output, name)));
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const destination = path.join(output, file.replace(/\.ts$/, '.js'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, compiled.outputText);
}
fs.writeFileSync(path.join(output, 'lib/overskill.js'), 'exports.getUsage = async () => { throw new Error("No simulated usage response configured"); };');
const { normalizeCreditAccountUsage, normalizeCreatorUsage, unavailableCreditAccount, creatorCreditTeamId, workspaceFundingState } = require(path.join(output, 'lib/credit-account.js'));
const security = require(path.join(output, 'lib/pilot-security.js'));
const adapter = require(path.join(output, 'lib/overskill.js'));
const route = require(path.join(output, 'app/api/credit-account/route.js'));
const originalEnv = { ...process.env };
const originalFetch = global.fetch;
const origin = 'http://127.0.0.1:3577';
const request = (cookie, headers = {}) => new Request(`${origin}/api/credit-account`, { headers: { ...(cookie ? { cookie } : {}), ...headers } });
function creatorSession(teamId = 21) {
  const session = security.createSession(request());
  session.provisioned = { team: { id: teamId } };
  session.creatorKey = 'simulated-creator-secret';
  return { session, cookie: security.sessionCookie(session, request()).split(';')[0] };
}
beforeEach(() => {
  delete global.__openOverskillPilot;
  process.env.OVERSKILL_MOCK = '1';
  process.env.OVERSKILL_API_BASE = 'http://localhost:3000';
  global.fetch = async () => { throw new Error('Network is forbidden in simulated credit tests'); };
  adapter.getCreatorUsage = async () => ({ok:false, status:404, json:{}});
  adapter.getUsage = async () => { throw new Error('Unexpected usage request'); };
});
after(() => {
  global.fetch = originalFetch;
  for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
  Object.assign(process.env, originalEnv);
  fs.rmSync(output, { recursive: true, force: true });
});

test('normalizer retains zero, fractional and negative balances with explicit partial provenance', () => {
  for (const credits of [0, 15.5, -250]) {
    const snapshot = normalizeCreditAccountUsage({ team_id: 21, credits: { balance: credits } }, 21, { observedAt: '2026-09-29T15:00:00.000Z' });
    assert.equal(snapshot.balance.credits, credits);
    assert.equal(snapshot.balance.status, 'reported');
    assert.equal(snapshot.balance.source, 'overskill_usage_team_credit_balance');
    assert.equal(snapshot.balance.includesPendingReservations, false);
    assert.equal(snapshot.balance.providerAuthoritative, false);
    assert.equal(snapshot.creditAccount.partnerSponsorshipSupported, false);
    assert.equal(snapshot.autoBilling.status, 'not_reported');
    assert.equal(snapshot.whop.providerWalletIsolation, 'unverified');
    assert.equal(snapshot.spendingCap, null);
  }
});

test('missing and malformed balances stay unknown instead of coercing to zero', () => {
  for (const balance of [undefined, null, '500', NaN, Infinity, -Infinity, {}, Number.MAX_SAFE_INTEGER + 1]) {
    const snapshot = normalizeCreditAccountUsage({ team_id: 21, credits: { balance } }, 21);
    assert.equal(snapshot.balance.credits, null);
    assert.equal(snapshot.balance.status, 'unavailable');
    assert.equal(snapshot.balance.source, null);
    assert.equal(snapshot.balance.observedAt, null);
  }
  assert.equal(unavailableCreditAccount(21).balance.credits, null);
});

test('team validation rejects absent, string, unsafe and foreign account identities', () => {
  for (const teamId of [undefined, '21', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => creatorCreditTeamId({ team: { id: teamId } }), { code: 'creator_team_unknown' });
  }
  for (const usage of [null, [], {}, { team_id: '21' }]) {
    assert.throws(() => normalizeCreditAccountUsage(usage, 21), { code: 'invalid_credit_usage' });
  }
  assert.throws(() => normalizeCreditAccountUsage({ team_id: 22, credits: { balance: 500 } }, 21), { code: 'credit_account_mismatch' });
});

test('allowlist drops key metadata, incomplete spend totals and claimed sponsorship', () => {
  const snapshot = normalizeCreditAccountUsage({
    team_id: 21, api_key: { key: 'sensitive-provider-key', prefix: 'secret-prefix' },
    credits: { balance: 15, used_in_period: 999, breakdown: { generation: 999 } },
    payer_team_id: 88, spending_cap: 15, autoBilling: { enabled: true },
  }, 21);
  const json = JSON.stringify(snapshot);
  assert.doesNotMatch(json, /sensitive-provider-key|secret-prefix|used_in_period|breakdown|payer_team_id/);
  assert.equal(snapshot.spendingCap, null);
  assert.equal(snapshot.autoBilling.status, 'not_reported');
});

test('route rejects unauthenticated, unprovisioned and cross-origin reads before using the adapter', async () => {
  let called = 0;
  adapter.getUsage = async () => { called++; return {}; };
  assert.equal((await route.GET(request())).status, 401);
  const session = security.createSession(request());
  const cookie = security.sessionCookie(session, request()).split(';')[0];
  assert.equal((await route.GET(request(cookie))).status, 409);
  const authorized = creatorSession();
  assert.equal((await route.GET(request(authorized.cookie, { origin: 'https://elsewhere.invalid' }))).status, 403);
  assert.equal(called, 0);
});

test('route uses its session account, marks demo data simulated and does not mutate the session', async () => {
  const { cookie, session } = creatorSession();
  const before = JSON.stringify(session);
  let calls = 0;
  adapter.getUsage = async (selected) => {
    calls++;
    assert.equal(selected, session);
    assert.equal(selected.creatorKey, 'simulated-creator-secret');
    return { ok: true, status: 200, json: { team_id: 21, credits: { balance: 500 }, api_key: { key: selected.creatorKey } } };
  };
  const response = await route.GET(request(cookie));
  const snapshot = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(snapshot.creditAccount.teamId, 21);
  assert.equal(snapshot.balance.status, 'simulated');
  assert.equal(snapshot.balance.source, 'simulated');
  assert.doesNotMatch(JSON.stringify(snapshot), /simulated-creator-secret/);
  assert.equal(JSON.stringify(session), before);
  assert.equal(calls, 1);
});

test('upstream failure returns an unknown snapshot and never leaks provider errors', async () => {
  const { cookie } = creatorSession();
  adapter.getUsage = async () => ({ ok: false, status: 502, json: { error: 'provider-private-secret', credits: { balance: 0 } } });
  const response = await route.GET(request(cookie));
  const snapshot = await response.json();
  assert.equal(response.status, 200);
  assert.equal(snapshot.balance.status, 'unavailable');
  assert.equal(snapshot.balance.credits, null);
  assert.doesNotMatch(JSON.stringify(snapshot), /provider-private-secret/);
});

test('foreign account responses fail closed and do not expose their balances', async () => {
  const { cookie } = creatorSession();
  adapter.getUsage = async () => ({ ok: true, status: 200, json: { team_id: 99, credits: { balance: 7654321 } } });
  const response = await route.GET(request(cookie));
  const json = await response.json();
  assert.equal(response.status, 502);
  assert.equal(json.code, 'credit_account_mismatch');
  assert.doesNotMatch(JSON.stringify(json), /7654321/);
});

test('live provenance follows the authenticated session and does not trust an upstream mocked field', async () => {
  process.env.OVERSKILL_MOCK = '0';
  process.env.OVERSKILL_LIVE_ENABLED = '1';
  process.env.OVERSKILL_PARTNER_API_KEY = 'only-a-simulated-fixture';
  process.env.OPEN_OVERSKILL_OPERATOR_TOKEN = 'simulated-operator-token-over-32-characters';
  const { cookie } = creatorSession();
  adapter.getUsage = async () => ({ ok: true, status: 200, mocked: true, json: { team_id: 21, credits: { balance: 500 } } });
  const response = await route.GET(request(cookie));
  const snapshot = await response.json();
  assert.equal(response.status, 200);
  assert.equal(snapshot.balance.status, 'reported');
  assert.equal(snapshot.balance.source, 'overskill_usage_team_credit_balance');
});

function meterFixture() {
  const metric = (value, source) => ({ status: 'known', value, unit: 'credits', source });
  return {
    schema_version:1, team_id:21, status:'ready', period:'30d',
    window:{from:'2026-08-30T15:00:00Z', through:'2026-09-29T15:00:00Z'}, observed_at:'2026-09-29T15:00:00Z', snapshot_consistency:'request_local_non_atomic',
    metrics:{
      gross_recorded_generation_debits:metric(25.5, 'credit_transaction_and_token_ledger_entry'),
      spendable:metric(100, 'team_credit_balance_excluding_expired_sources'),
      reservations:metric(10, 'credit_transaction_pending_reservations'),
      available_for_admission:metric(90, 'team_spendable_minus_pending_reservations'),
    },
    whop:{ cached_balance:metric(120, 'token_balance_cache'), pending_sync:metric(20, 'token_balance_pending_deductions'), last_synced_at:null, provider_authoritative:false, wallet_isolation:'unverified' },
    auto_billing:{status:'reported', topup_enabled:false, tier_upgrade_enabled:true, overage_enabled:false},
    trial:{status:'requires_app_context'}, refunds:{status:'not_reported'}, net_charge:{status:'not_reported'}, spending_cap:null,
  };
}
const unknown = item => ({ ...item, status:'unknown', value:null, reason:'missing_record' });

test('customer funding distinguishes no credits, unknown telemetry and reserved credits without changing balances', () => {
  assert.equal(workspaceFundingState(null), 'unknown');
  assert.equal(workspaceFundingState(unavailableCreditAccount(21)), 'unknown');
  for (const balance of [0, -25, 0.5, 500]) {
    const snapshot = normalizeCreditAccountUsage({ team_id: 21, credits: { balance } }, 21);
    const original = JSON.stringify(snapshot);
    assert.equal(workspaceFundingState(snapshot), balance > 0 ? 'ready' : 'empty');
    assert.equal(JSON.stringify(snapshot), original);
  }
  assert.equal(workspaceFundingState(normalizeCreditAccountUsage({ team_id: 21, credits: { balance: 1000 } }, 21, { simulated: true })), 'ready');
  const held = meterFixture();
  held.metrics.reservations.value = 100;
  held.metrics.available_for_admission.value = 0;
  assert.equal(workspaceFundingState(normalizeCreatorUsage(held, 21)), 'reserved');
  const missingAdmission = meterFixture();
  missingAdmission.metrics.available_for_admission = unknown(missingAdmission.metrics.available_for_admission);
  missingAdmission.status = 'partial';
  assert.equal(workspaceFundingState(normalizeCreatorUsage(missingAdmission, 21)), 'unknown');
  assert.equal(workspaceFundingState(normalizeCreatorUsage(meterFixture(), 21)), 'ready');
});

test('versioned meter allowlists fields and keeps gross usage, holds and cached provider values separate', () => {
  const input = meterFixture();
  input.secret = 'do-not-expose'; input.metrics.spendable.api_key = 'do-not-expose'; input.whop.private_id = 'do-not-expose';
  const account = normalizeCreatorUsage(input, 21);
  assert.equal(account.telemetry, 'creator_usage_v1');
  assert.equal(account.balance.credits, 100);
  assert.equal(account.meter.metrics.gross_recorded_generation_debits.value, 25.5);
  assert.equal(account.meter.metrics.available_for_admission.value, 90);
  assert.equal(account.meter.whop.cached_balance.value, 120);
  assert.equal(account.meter.whop.pending_sync.value, 20);
  assert.equal(account.spendingCap, null);
  assert.doesNotMatch(JSON.stringify(account), /do-not-expose|private_id|api_key/);
});

test('versioned meter validates schema, provenance, timestamps, team and numeric bounds', () => {
  const changes = [
    x=>{x.schema_version=2;}, x=>{x.team_id='21';}, x=>{x.period='forever';}, x=>{x.window.from='bad';},
    x=>{x.window.from='2027-01-01T00:00:00Z';}, x=>{x.metrics.spendable.source='secret';},
    x=>{x.whop.provider_authoritative=true;}, x=>{x.auto_billing.topup_enabled=null;},
    x=>{x.spending_cap=100;}, x=>{x.status='partial';},
  ];
  for(const change of changes) {const input=meterFixture(); change(input); assert.throws(()=>normalizeCreatorUsage(input,21),{code:'invalid_credit_usage'});}
  for(const number of ['100', null, NaN, Infinity, Number.MAX_SAFE_INTEGER+1]) {
    const input=meterFixture(); input.metrics.spendable.value=number;
    assert.throws(()=>normalizeCreatorUsage(input,21),{code:'invalid_credit_usage'});
  }
  for(const path of [['metrics','gross_recorded_generation_debits'],['metrics','reservations'],['whop','pending_sync']]) {
    const input=meterFixture(); input[path[0]][path[1]].value=-1;
    assert.throws(()=>normalizeCreatorUsage(input,21),{code:'invalid_credit_usage'});
  }
  const foreign=meterFixture(); foreign.team_id=99;
  assert.throws(()=>normalizeCreatorUsage(foreign,21),{code:'credit_account_mismatch'});
});

test('known zero and signed balances remain distinct from unknown metrics', () => {
  const input=meterFixture(); input.metrics.gross_recorded_generation_debits.value=0;
  input.metrics.spendable.value=-1; input.metrics.available_for_admission.value=-11; input.whop.cached_balance.value=-2;
  input.whop.pending_sync=unknown(input.whop.pending_sync); input.status='partial';
  const normalized=normalizeCreatorUsage(input,21);
  assert.equal(normalized.meter.metrics.gross_recorded_generation_debits.value,0);
  assert.equal(normalized.balance.credits,-1);
  assert.equal(normalized.meter.whop.pending_sync.value,null);
});

test('route consumes supported creator meter without requesting legacy usage or mutating session', async () => {
  const {cookie,session}=creatorSession(); const before=JSON.stringify(session); let calls=0;
  adapter.getCreatorUsage=async selected=>{assert.equal(selected,session); calls++; return {ok:true,status:200,json:meterFixture()};};
  const response=await route.GET(request(cookie)); const result=await response.json();
  assert.equal(response.status,200); assert.equal(result.meter.schema_version,1); assert.equal(result.telemetry,'simulated');
  assert.equal(result.balance.status,'simulated'); assert.equal(calls,1); assert.equal(JSON.stringify(session),before);
});

test('only a 404 permits legacy fallback; auth, transport and server failures stay unavailable without retries', async () => {
  const {cookie}=creatorSession();
  for(const status of [401,403,429,500,502,503]) {
    let calls=0;
    adapter.getCreatorUsage=async()=>{calls++; return {ok:false,status,json:{error:'private-provider-error',credits:{balance:0}}};};
    const response=await route.GET(request(cookie)); const result=await response.json();
    assert.equal(response.status,200); assert.equal(result.telemetry,'unavailable'); assert.equal(result.balance.credits,null);
    assert.doesNotMatch(JSON.stringify(result),/private-provider-error/); assert.equal(calls,1);
  }
});

test('valid 503 meter preserves explicit unknown reasons; malformed or mismatched meter never falls back', async () => {
  const {cookie}=creatorSession(); const input=meterFixture();
  for(const key of Object.keys(input.metrics)) input.metrics[key]=unknown(input.metrics[key]);
  input.whop.cached_balance=unknown(input.whop.cached_balance); input.whop.pending_sync=unknown(input.whop.pending_sync); input.status='unavailable';
  adapter.getCreatorUsage=async()=>({ok:false,status:503,json:input});
  const response=await route.GET(request(cookie)); const result=await response.json();
  assert.equal(result.meter.status,'unavailable'); assert.equal(result.meter.metrics.spendable.reason,'missing_record'); assert.equal(result.balance.credits,null);
  for(const invalid of [{...input,schema_version:2},{...input,team_id:99}]) {
    adapter.getCreatorUsage=async()=>({ok:true,status:200,json:invalid});
    assert.equal((await route.GET(request(cookie))).status,502);
  }
});

test('meter validates admission dependencies and arithmetic without rejecting decimal rounding', () => {
  const invalid=meterFixture(); invalid.metrics.available_for_admission.value=100;
  assert.throws(()=>normalizeCreatorUsage(invalid,21),{code:'invalid_credit_usage'});
  const unknownInput=meterFixture(); unknownInput.metrics.spendable=unknown(unknownInput.metrics.spendable); unknownInput.status='partial';
  assert.throws(()=>normalizeCreatorUsage(unknownInput,21),{code:'invalid_credit_usage'});
  const decimal=meterFixture(); decimal.metrics.spendable.value=0.3; decimal.metrics.reservations.value=0.1; decimal.metrics.available_for_admission.value=0.2;
  assert.equal(normalizeCreatorUsage(decimal,21).meter.metrics.available_for_admission.value,0.2);
  decimal.metrics.gross_recorded_generation_debits=unknown(decimal.metrics.gross_recorded_generation_debits);
  delete decimal.metrics.gross_recorded_generation_debits.reason; decimal.status='partial';
  assert.equal(normalizeCreatorUsage(decimal,21).meter.metrics.gross_recorded_generation_debits.value,null);
});

test('legacy fallback is labeled partial and invents no provider balance or meter', async () => {
  process.env.OVERSKILL_MOCK='0'; process.env.OVERSKILL_LIVE_ENABLED='1';
  process.env.OVERSKILL_PARTNER_API_KEY='only-a-simulated-fixture';
  process.env.OPEN_OVERSKILL_OPERATOR_TOKEN='simulated-operator-token-over-32-characters';
  const {cookie}=creatorSession(); let meterCalls=0, legacyCalls=0;
  adapter.getCreatorUsage=async()=>{meterCalls++; return {ok:false,status:404,json:{}};};
  adapter.getUsage=async()=>{legacyCalls++; return {ok:true,status:200,json:{team_id:21,credits:{balance:500},whop:{balance:999}}};};
  const result=await (await route.GET(request(cookie))).json();
  assert.equal(result.telemetry,'partial_legacy'); assert.equal(result.meter,null);
  assert.equal(result.whop.cached_balance,undefined); assert.equal(result.balance.credits,500);
  assert.equal(meterCalls,1); assert.equal(legacyCalls,1);
});
