const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'open-overskill-cli-'));
let sequence = 0;
function fixture(files = {}) {
  const directory = path.join(temporary, String(++sequence));
  fs.mkdirSync(directory);
  for (const [name, contents] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), contents);
  return directory;
}
function run(command, directory, env = {}, args = []) {
  const cleanEnv = { ...process.env };
  for (const key of Object.keys(cleanEnv)) {
    if (/^(OVERSKILL_|OPEN_OVERSKILL_|__NEXT_)/.test(key) || key === 'NODE_ENV') delete cleanEnv[key];
  }
  return spawnSync(process.execPath, [path.join(root, 'scripts', `${command}.mjs`), ...args], {
    cwd: directory, env: { ...cleanEnv, ...env }, encoding: 'utf8', timeout: 10_000,
  });
}
const secret = 'private-partner-credential-never-print';
const token = 'private-operator-token-never-print-' + 'x'.repeat(40);
const email = 'private-creator@example.invalid';
function live(overrides = {}) {
  return Object.entries({
    OVERSKILL_MOCK: '0', OVERSKILL_LIVE_ENABLED: '1', OVERSKILL_PARTNER_API_KEY: secret,
    OPEN_OVERSKILL_OPERATOR_TOKEN: token, OPEN_OVERSKILL_CREATOR_EMAIL: email,
    OVERSKILL_CREATOR_ID: 'private-stable-creator-id',
    OVERSKILL_API_BASE: 'https://www.overskill.com', ...overrides,
  }).map(([key, value]) => `${key}=${value}`).join('\n');
}
function noSecrets(result, extra = []) {
  for (const value of [secret, token, email, 'private-stable-creator-id', ...extra]) {
    assert.ok(!(result.stdout + result.stderr).includes(value), 'A configuration value appeared in CLI output');
  }
}
const customerKey = Buffer.alloc(32, 7).toString('base64');
const customerIssuer = 'https://identity.example.invalid/tenant';
const customerOrigin = 'https://builder.example.invalid';
const customerClient = 'private-customer-client-id';
const customerSecret = 'private-customer-client-secret';
function customerLive(directory, overrides = {}) {
  const dataDirectory = path.join(directory, 'customer-data');
  if (!fs.existsSync(dataDirectory)) fs.mkdirSync(dataDirectory, { mode: 0o700 });
  return {
    OVERSKILL_MOCK: '0', OVERSKILL_LIVE_ENABLED: '1', OVERSKILL_PARTNER_API_KEY: secret,
    OPEN_OVERSKILL_OPERATOR_TOKEN: token, OVERSKILL_API_BASE: 'https://www.overskill.com',
    OPEN_OVERSKILL_ORIGIN: customerOrigin, OPEN_OVERSKILL_HOSTED: '1',
    OPEN_OVERSKILL_OIDC_ISSUER: customerIssuer, OPEN_OVERSKILL_OIDC_CLIENT_ID: customerClient,
    OPEN_OVERSKILL_OIDC_CLIENT_SECRET: customerSecret, OPEN_OVERSKILL_ENCRYPTION_KEY: customerKey,
    OPEN_OVERSKILL_DATA_DIR: dataDirectory, ...overrides,
  };
}
function noCustomerSecrets(result, extra = []) {
  noSecrets(result, [customerKey, customerIssuer, customerOrigin, customerClient, customerSecret, ...extra]);
}
after(() => fs.rmSync(temporary, { recursive: true, force: true }));

test('setup creates a private demo file and generates a fresh token without printing it', () => {
  const directory = fixture({ '.env.example': live() });
  const result = run('setup', directory);
  assert.equal(result.status, 0, result.stderr);
  const contents = fs.readFileSync(path.join(directory, '.env.local'), 'utf8');
  assert.match(contents, /^OVERSKILL_MOCK=1$/m);
  assert.match(contents, /^OVERSKILL_LIVE_ENABLED=0$/m);
  const generated = contents.match(/^OPEN_OVERSKILL_OPERATOR_TOKEN=([a-f0-9]{64})$/m)?.[1];
  assert.ok(generated);
  assert.notEqual(generated, token);
  assert.equal(fs.statSync(path.join(directory, '.env.local')).mode & 0o777, 0o600);
  noSecrets(result, [generated]);
});

test('setup never replaces or chmods an existing file, even without an example file', () => {
  const contents = `# Keep exactly\nOVERSKILL_PARTNER_API_KEY=${secret}\n`;
  const directory = fixture({ '.env.local': contents });
  const filename = path.join(directory, '.env.local');
  fs.chmodSync(filename, 0o640);
  const before = fs.statSync(filename);
  const result = run('setup', directory);
  assert.equal(result.status, 0);
  assert.equal(fs.readFileSync(filename, 'utf8'), contents);
  assert.equal(fs.statSync(filename).mtimeMs, before.mtimeMs);
  assert.equal(fs.statSync(filename).mode & 0o777, 0o640);
  noSecrets(result);
});

test('setup preserves symlink destinations and never writes through them', () => {
  const directory = fixture({ '.env.example': 'OVERSKILL_MOCK=1\n', 'keep.txt': secret });
  fs.symlinkSync(path.join(directory, 'keep.txt'), path.join(directory, '.env.local'));
  const result = run('setup', directory);
  assert.equal(result.status, 0);
  assert.equal(fs.readFileSync(path.join(directory, 'keep.txt'), 'utf8'), secret);
  assert.ok(fs.lstatSync(path.join(directory, '.env.local')).isSymbolicLink());
  noSecrets(result);
});

test('doctor accepts keyless demo and does not create or modify configuration files', () => {
  const directory = fixture({ '.env.local': 'OVERSKILL_MOCK=1\n' });
  const before = fs.statSync(path.join(directory, '.env.local')).mtimeMs;
  const result = run('doctor', directory);
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).missing, []);
  assert.equal(JSON.parse(result.stdout).demo, true);
  assert.equal(JSON.parse(result.stdout).ready, true);
  assert.deepEqual(fs.readdirSync(directory), ['.env.local']);
  assert.equal(fs.statSync(path.join(directory, '.env.local')).mtimeMs, before);
});

test('doctor identifies missing live fields without making a connection', () => {
  const directory = fixture({ '.env.local': 'OVERSKILL_MOCK=0\n' });
  const result = run('doctor', directory);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ready, false);
  assert.equal(report.demo, false);
  assert.deepEqual(report.missing, ['OVERSKILL_LIVE_ENABLED', 'OVERSKILL_PARTNER_API_KEY', 'OPEN_OVERSKILL_OPERATOR_TOKEN', 'OPEN_OVERSKILL_CREATOR_EMAIL', 'OVERSKILL_CREATOR_ID']);
  noSecrets(result);
});

test('doctor reports configured live settings but never prints credentials or creator identity', () => {
  const directory = fixture({ '.env.local': live() });
  const result = run('doctor', directory);
  assert.equal(result.status, 0, result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ready, true);
  assert.equal(report.demo, false);
  assert.match(report.hints.join(' '), /were not checked/);
  noSecrets(result);
});

test('doctor rejects invalid mode, token, email and API URL using the server rules', () => {
  const cases = [
    [{ OVERSKILL_MOCK: 'unexpected' }, 'OVERSKILL_MOCK'],
    [{ OPEN_OVERSKILL_OPERATOR_TOKEN: 'short-secret' }, 'OPEN_OVERSKILL_OPERATOR_TOKEN'],
    [{ OVERSKILL_LIVE_ENABLED: 'true' }, 'OVERSKILL_LIVE_ENABLED'],
    [{ OPEN_OVERSKILL_CREATOR_EMAIL: 'not-an-email' }, 'OPEN_OVERSKILL_CREATOR_EMAIL'],
    [{ OVERSKILL_CREATOR_ID: 'creator_demo_001' }, 'OVERSKILL_CREATOR_ID'],
    [{ OVERSKILL_API_BASE: 'http://remote.example.invalid' }, 'OVERSKILL_API_BASE'],
    [{ OVERSKILL_API_BASE: 'https://user:url-secret@example.invalid' }, 'OVERSKILL_API_BASE'],
  ];
  for (const [overrides, invalidField] of cases) {
    const result = run('doctor', fixture({ '.env.local': live(overrides) }));
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).invalid.includes(invalidField));
    noSecrets(result, ['short-secret', 'url-secret', 'not-an-email']);
  }
});

test('doctor uses Next development precedence and variable expansion; shell wins', () => {
  const directory = fixture({
    '.env': 'OVERSKILL_MOCK=0\n',
    '.env.development': 'OVERSKILL_MOCK=0\n',
    '.env.local': 'OVERSKILL_MOCK=1\n',
    '.env.development.local': live({ OPEN_OVERSKILL_OPERATOR_TOKEN: '$PRIVATE_TOKEN_SEED' }) + `\nPRIVATE_TOKEN_SEED=${token}\n`,
  });
  const filesOnly = run('doctor', directory);
  assert.equal(filesOnly.status, 0, filesOnly.stdout);
  assert.equal(JSON.parse(filesOnly.stdout).demo, false);
  const shellOverride = run('doctor', directory, { OVERSKILL_MOCK: '1' });
  assert.equal(shellOverride.status, 0);
  assert.equal(JSON.parse(shellOverride.stdout).demo, true);
  noSecrets(filesOnly);
  noSecrets(shellOverride);
});

test('doctor --production loads production files and NODE_ENV=test skips .env.local', () => {
  const directory = fixture({
    '.env.local': 'OVERSKILL_MOCK=0\n',
    '.env.development.local': 'OVERSKILL_MOCK=1\n',
    '.env.production.local': live(),
    '.env.test': 'OVERSKILL_MOCK=1\n',
  });
  const production = run('doctor', directory, {}, ['--production']);
  assert.equal(production.status, 0, production.stdout);
  assert.equal(JSON.parse(production.stdout).environment, 'production');
  assert.equal(JSON.parse(production.stdout).demo, false);
  const testing = run('doctor', directory, { NODE_ENV: 'test' });
  assert.equal(testing.status, 0);
  assert.equal(JSON.parse(testing.stdout).demo, true);
  noSecrets(production);
  noSecrets(testing);
});

test('doctor retains auto as explicit demo and fails cleanly for unsupported arguments', () => {
  const directory = fixture({ '.env.local': `OVERSKILL_MOCK=auto\nOVERSKILL_PARTNER_API_KEY=${secret}\n` });
  const result = run('doctor', directory);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).demo, true);
  const bad = run('doctor', directory, {}, ['--token=' + token]);
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).ready, false);
  noSecrets(result);
  noSecrets(bad);
});

test('doctor fails with redacted guidance before dependencies are installed', () => {
  const directory = fixture({ 'doctor.mjs': fs.readFileSync(path.join(root, 'scripts/doctor.mjs'), 'utf8') });
  const result = spawnSync(process.execPath, [path.join(directory, 'doctor.mjs')], {
    cwd: directory, env: { ...process.env, OPEN_OVERSKILL_OPERATOR_TOKEN: token }, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).ready, false);
  assert.match(JSON.parse(result.stdout).hints.join(' '), /npm ci/);
  assert.equal(result.stderr, '');
  noSecrets(result);
});

test('customer doctor accepts explicit live configuration without operator creator fixtures or remote discovery', () => {
  const directory = fixture();
  const env = customerLive(directory);
  const result = run('doctor', directory, env, ['--customer']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ready, true);
  assert.equal(report.target, 'customer');
  assert.equal(report.demo, false);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.invalid, []);
  assert.match(report.hints.join(' '), /provider registration.*were not checked/);
  assert.deepEqual(fs.readdirSync(env.OPEN_OVERSKILL_DATA_DIR), []);
  noCustomerSecrets(result, [env.OPEN_OVERSKILL_DATA_DIR]);
  const operator = run('doctor', directory, env);
  assert.equal(operator.status, 1);
  assert.deepEqual(JSON.parse(operator.stdout).missing, ['OPEN_OVERSKILL_CREATOR_EMAIL', 'OVERSKILL_CREATOR_ID']);
  assert.equal(JSON.parse(operator.stdout).target, undefined);
});

test('customer and production flags compose in either order with Next environment precedence', () => {
  const directory = fixture({ '.env.development.local': 'OVERSKILL_MOCK=0\n' });
  const env = customerLive(directory);
  fs.writeFileSync(path.join(directory, '.env.production.local'), Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n'));
  for (const args of [['--customer', '--production'], ['--production', '--customer']]) {
    const result = run('doctor', directory, {}, args);
    assert.equal(result.status, 0, result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.environment, 'production');
    assert.equal(report.target, 'customer');
    assert.equal(report.demo, false);
    noCustomerSecrets(result, [env.OPEN_OVERSKILL_DATA_DIR]);
  }
});

test('customer doctor lists required live customer settings without legacy identity fixtures', () => {
  const directory = fixture({ '.env.local': 'OVERSKILL_MOCK=0\n' });
  const result = run('doctor', directory, {}, ['--customer']);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.missing, [
    'OVERSKILL_LIVE_ENABLED', 'OVERSKILL_PARTNER_API_KEY', 'OPEN_OVERSKILL_OPERATOR_TOKEN',
    'OVERSKILL_API_BASE', 'OPEN_OVERSKILL_ORIGIN', 'OPEN_OVERSKILL_OIDC_ISSUER',
    'OPEN_OVERSKILL_OIDC_CLIENT_ID', 'OPEN_OVERSKILL_ENCRYPTION_KEY', 'OPEN_OVERSKILL_DATA_DIR',
  ]);
  assert.deepEqual(fs.readdirSync(directory), ['.env.local']);
  noCustomerSecrets(result);
});

test('customer doctor rejects unsafe issuer, origin, encryption and hosted opt-in settings without printing values', () => {
  const directory = fixture();
  const env = customerLive(directory);
  const cases = [
    ['OPEN_OVERSKILL_OIDC_ISSUER', 'http://insecure-issuer.example.invalid'],
    ['OPEN_OVERSKILL_OIDC_ISSUER', 'https://user:issuer-password@issuer.example.invalid'],
    ['OPEN_OVERSKILL_OIDC_ISSUER', 'https://issuer.example.invalid?bad=issuer-query'],
    ['OPEN_OVERSKILL_OIDC_ISSUER', 'https://issuer.example.invalid#issuer-fragment'],
    ['OPEN_OVERSKILL_OIDC_CLIENT_ID', ' invalid-client-whitespace '],
    ['OPEN_OVERSKILL_OIDC_CLIENT_ID', 'invalid\tclient'],
    ['OPEN_OVERSKILL_ORIGIN', 'http://insecure-builder.example.invalid'],
    ['OPEN_OVERSKILL_ORIGIN', 'https://builder.example.invalid/private-path'],
    ['OPEN_OVERSKILL_ORIGIN', 'https://user:origin-password@builder.example.invalid'],
    ['OPEN_OVERSKILL_ORIGIN', 'https://builder.example.invalid?bad=origin-query'],
    ['OPEN_OVERSKILL_ORIGIN', ' https://builder.example.invalid'],
    ['OPEN_OVERSKILL_ENCRYPTION_KEY', Buffer.alloc(31, 9).toString('base64')],
    ['OPEN_OVERSKILL_ENCRYPTION_KEY', customerKey.slice(0, -1)],
    ['OPEN_OVERSKILL_HOSTED', 'true'],
  ];
  for (const [name, value] of cases) {
    const result = run('doctor', directory, { ...env, [name]: value }, ['--customer']);
    assert.equal(result.status, 1, `Expected invalid ${name}`);
    assert.ok(JSON.parse(result.stdout).invalid.includes(name), `Missing field error for ${name}`);
    noCustomerSecrets(result, [env.OPEN_OVERSKILL_DATA_DIR, value]);
  }
  const withoutHosted = { ...env }; delete withoutHosted.OPEN_OVERSKILL_HOSTED;
  const missing = run('doctor', directory, withoutHosted, ['--customer']);
  assert.equal(missing.status, 1);
  assert.ok(JSON.parse(missing.stdout).missing.includes('OPEN_OVERSKILL_HOSTED'));
  const local = run('doctor', directory, {
    ...withoutHosted, OPEN_OVERSKILL_ORIGIN: 'http://127.0.0.1:3577', OVERSKILL_API_BASE: 'http://127.0.0.1:3000',
  }, ['--customer']);
  assert.equal(local.status, 0, local.stdout);
  assert.deepEqual(fs.readdirSync(env.OPEN_OVERSKILL_DATA_DIR), []);
});

test('customer doctor validates existing storage metadata without creating, opening or repairing storage', () => {
  const directory = fixture();
  const env = customerLive(directory);
  const dataDirectory = env.OPEN_OVERSKILL_DATA_DIR;
  fs.symlinkSync(dataDirectory, path.join(directory, 'linked-data'));
  const publicDirectory = path.join(directory, 'public-data');
  fs.mkdirSync(publicDirectory, { mode: 0o755 });
  for (const value of [path.join(directory, 'absent-data'), 'relative-data', path.join(directory, 'linked-data'), publicDirectory]) {
    const result = run('doctor', directory, { ...env, OPEN_OVERSKILL_DATA_DIR: value }, ['--customer']);
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).invalid.includes('OPEN_OVERSKILL_DATA_DIR'));
    noCustomerSecrets(result, [value]);
  }
  assert.equal(fs.existsSync(path.join(directory, 'absent-data')), false);
  assert.equal(fs.existsSync(path.join(directory, 'relative-data')), false);
  assert.equal(fs.statSync(publicDirectory).mode & 0o777, 0o755);
  const database = path.join(dataDirectory, 'customers-live.sqlite');
  fs.writeFileSync(database, 'not a database: doctor must not open this', { mode: 0o640 });
  const before = fs.statSync(database);
  const unsafeFile = run('doctor', directory, env, ['--customer']);
  assert.equal(unsafeFile.status, 1);
  assert.ok(JSON.parse(unsafeFile.stdout).invalid.includes('OPEN_OVERSKILL_DATA_DIR'));
  assert.equal(fs.statSync(database).mtimeMs, before.mtimeMs);
  assert.equal(fs.statSync(database).mode & 0o777, 0o640);
  fs.chmodSync(database, 0o600);
  const privateFile = run('doctor', directory, env, ['--customer']);
  assert.equal(privateFile.status, 0, privateFile.stdout);
  assert.equal(fs.readFileSync(database, 'utf8'), 'not a database: doctor must not open this');
  fs.renameSync(database, path.join(dataDirectory, 'existing.sqlite'));
  fs.symlinkSync(path.join(dataDirectory, 'existing.sqlite'), database);
  const linkedFile = run('doctor', directory, env, ['--customer']);
  assert.equal(linkedFile.status, 1);
  assert.ok(JSON.parse(linkedFile.stdout).invalid.includes('OPEN_OVERSKILL_DATA_DIR'));
  assert.ok(fs.lstatSync(database).isSymbolicLink());
});

test('customer doctor completes under write, SQLite and network sentinels and leaves no state', () => {
  const directory = fixture({ 'readonly.cjs': `
    const fs = require('node:fs');
    const moduleApi = require('node:module');
    const deny = () => { process.stderr.write('UNEXPECTED_SIDE_EFFECT'); throw new Error('blocked'); };
    for (const name of ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'chmod', 'chown', 'rename', 'rm', 'unlink', 'symlink', 'copyFile', 'truncate']) {
      fs[name] = deny; fs[name + 'Sync'] = deny; fs.promises[name] = deny;
    }
    const openSync = fs.openSync;
    fs.openSync = (filename, flags, ...args) => flags === 'r' || flags === 0 ? openSync(filename, flags, ...args) : deny();
    const open = fs.promises.open;
    fs.promises.open = (filename, flags, ...args) => flags === 'r' || flags === 0 ? open(filename, flags, ...args) : deny();
    for (const name of ['node:http', 'node:https']) {
      const network = require(name); network.request = deny; network.get = deny;
    }
    const net = require('node:net'); net.connect = deny; net.createConnection = deny;
    global.fetch = deny;
    const load = moduleApi._load;
    moduleApi._load = function(name, ...args) { return name === 'node:sqlite' ? deny() : load.call(this, name, ...args); };
    moduleApi.syncBuiltinESMExports();
  ` });
  const env = customerLive(directory);
  const before = fs.statSync(env.OPEN_OVERSKILL_DATA_DIR);
  const result = run('doctor', directory, { ...env, NODE_OPTIONS: `--require=${path.join(directory, 'readonly.cjs')}` }, ['--customer']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(fs.readdirSync(directory).sort(), ['customer-data', 'readonly.cjs']);
  assert.deepEqual(fs.readdirSync(env.OPEN_OVERSKILL_DATA_DIR), []);
  assert.equal(fs.statSync(env.OPEN_OVERSKILL_DATA_DIR).mtimeMs, before.mtimeMs);
  assert.equal(fs.statSync(env.OPEN_OVERSKILL_DATA_DIR).mode, before.mode);
  noCustomerSecrets(result, [env.OPEN_OVERSKILL_DATA_DIR]);
});

test('customer doctor validates the runtime and keeps local demo read-only', () => {
  const directory = fixture({ 'old-node.cjs': "Object.defineProperty(process.versions, 'node', { value: '20.0.0' });" });
  const demo = run('doctor', directory, {}, ['--customer']);
  assert.equal(demo.status, 0, demo.stdout);
  assert.equal(JSON.parse(demo.stdout).demo, true);
  assert.equal(fs.existsSync(path.join(directory, '.data')), false);
  const publicDemo = run('doctor', directory, { OPEN_OVERSKILL_ORIGIN: customerOrigin, OPEN_OVERSKILL_HOSTED: '1' }, ['--customer']);
  assert.equal(publicDemo.status, 1);
  assert.ok(JSON.parse(publicDemo.stdout).invalid.includes('OPEN_OVERSKILL_ORIGIN'));
  const oldRuntime = run('doctor', directory, { NODE_OPTIONS: `--require=${path.join(directory, 'old-node.cjs')}` }, ['--customer']);
  assert.equal(oldRuntime.status, 1);
  assert.ok(JSON.parse(oldRuntime.stdout).invalid.includes('node_sqlite_runtime'));
  const duplicate = run('doctor', directory, {}, ['--customer', '--customer']);
  assert.equal(duplicate.status, 1);
  assert.deepEqual(JSON.parse(duplicate.stdout).invalid, ['doctor_environment']);
});
