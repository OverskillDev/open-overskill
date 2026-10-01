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
