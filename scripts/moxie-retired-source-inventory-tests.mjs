// Retirement inventory, not a live route/server/DB or absence-of-secrets proof.
// Only src/public source assets are read. History, SQL, env files, credentials,
// backups, private data and operator OAuth configuration values are not scanned.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const removed = new Set([
  'src/annie-moxie-bootstrap.js', 'src/routes/moxie.js', 'src/routes/moxie-templates.js',
  ...['contacts-creekside-animal.png', 'frog-on-log-writing-pad.png', 'moxie-avatar.jpg',
    'ops-dashboard.png', 'ops-events.png', 'ops-messaging.png', 'ops-schedule.png',
    'reminders-woodland-animal.png', 'settings-woodland-cog.png'].map(name => 'public/moxie-assets/' + name),
]);
function literal(value) {
  let result = value;
  for (let pass = 0; pass < 2; pass += 1) result = result.replace(/\\\//g, '/')
    .replace(/\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi,
      (_match, wide, short) => String.fromCharCode(parseInt(wide || short, 16)))
    .replace(/%([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
  return result;
}
function inventoryFindings(records) {
  assert.ok(records.length > 0 && records.length <= 4096, 'bounded source inventory');
  const findings = [], seen = new Set();
  let total = 0;
  for (const record of records) {
    assert.ok(/^(src|public)\//.test(record.path)
      && !/[\u0000-\u001f\u007f\\]/.test(record.path)
      && record.path.length <= 512
      && record.path.split('/').every(part => part && part !== '.' && part !== '..'), 'bounded source path');
    assert.ok(record.bytes instanceof Uint8Array, 'source bytes required');
    assert.ok(record.bytes.length <= 16 * 1024 * 1024 && (total += record.bytes.length) <= 64 * 1024 * 1024,
      'bounded source bytes');
    const add = rule => findings.push({ path: record.path, rule, sha256: hash(record.bytes) });
    const path = literal(record.path).normalize('NFC').toLowerCase();
    if (seen.has(path)) add('duplicate-or-case-colliding-source-path');
    seen.add(path);
    if (removed.has(record.path) || /(?:^|\/)(?:moxie(?:[-_.\/]|$)|annie-moxie-bootstrap\.)/i.test(path)) {
      add('retired-moxie-source-path');
    }
    if (/\.(?:js|mjs|cjs|ts|html|css|json|svg)$/i.test(path)) {
      const source = literal(Buffer.from(record.bytes).toString('utf8'));
      if (/\/moxie(?:[\/?#\s"'`]|$)|\/moxie-mobile-api(?:[\/?#\s"'`]|$)|moxie-assets|createMoxieRouter|installAnnieMoxieRoutes|MOXIE_MOUNT_PATH/i.test(source)) {
        add('retired-moxie-source-surface');
      }
    }
  }
  return findings.sort((a, b) => a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule));
}
function requireNoRetired(records) {
  const findings = inventoryFindings(records);
  if (findings.length) throw new Error(JSON.stringify(findings));
}

let checks = 0;
const record = (path, text = '') => ({ path, bytes: Buffer.from(text) });
function rejected(value, rule) {
  const findings = inventoryFindings([value]);
  assert.ok(findings.some(item => item.rule === rule), rule); checks += 1;
  assert.throws(() => requireNoRetired([value])); checks += 1;
  for (const item of findings) {
    assert.deepEqual(Object.keys(item).sort(), ['path', 'rule', 'sha256']); checks += 1;
    assert.equal(item.sha256, hash(value.bytes)); checks += 1;
  }
}
for (const path of removed) rejected(record(path), 'retired-moxie-source-path');
for (const text of ['app.use("/moxie", handler)', '"/moxie-mobile-api/health"',
  'createMoxieRouter()', 'installAnnieMoxieRoutes(app)', 'MOXIE_MOUNT_PATH',
  String.raw`"\/moxie\/health"`, '%2fmoxie%2fhealth', '%252fmoxie%252fhealth',
  String.raw`"\u002fmoxie\u002fhealth"`]) {
  rejected(record('src/new-route-installer.js', text), 'retired-moxie-source-surface');
}
for (const path of ['public/MOXIE-ASSETS/new.webp', 'src/routes/%6doxie.js']) {
  rejected(record(path), 'retired-moxie-source-path');
}
rejected(record('src/encoded%2ejs', '"/moxie/health"'), 'retired-moxie-source-surface');
const permitted = [record('src/config/env.js', 'export const password = process.env.MOXIE_WEB_PASSWORD;'),
  record('src/auth/shared-access-auth.js', 'const value = env.MOXIE_WEB_PASSWORD;'),
  record('src/auth/mcp-self-contained-oauth.js', 'const value = env.MOXIE_WEB_PASSWORD;'),
  record('src/leadership-bootstrap.js', '"/leadership-api/health"; "/viewer-api/events";'),
  record('src/messaging-api.js', '"/messaging-api"; "/memphis/thread";'),
  record('src/recovery.js', 'preserveProtectedWorkAndHistoricalAttachments();'),
  record('public/native.json', '"https://localhost/employee-schedule.html";')];
assert.deepEqual(inventoryFindings(permitted), []); checks += 1;
const canary = record('src/new-route.js', '"/moxie/health"; "DO_NOT_LOG_CANARY";');
let failure = '';
try { requireNoRetired([canary]); } catch (error) { failure = error.message; }
assert.equal(failure.includes('DO_NOT_LOG_CANARY'), false); checks += 1;
assert.equal(failure.includes('/moxie/health'), false); checks += 1;
assert.deepEqual(Object.keys(JSON.parse(failure)[0]).sort(), ['path', 'rule', 'sha256']); checks += 1;
assert.throws(() => inventoryFindings([record('../outside.js')]), /bounded source path/); checks += 1;
assert.throws(() => inventoryFindings([]), /bounded source inventory/); checks += 1;
assert.equal(inventoryFindings([record('src/one.js'), record('src/ONE.js')])[0].rule,
  'duplicate-or-case-colliding-source-path'); checks += 1;

// Enumerate ONLY the two application source roots. No runtime index import,
// listening server, git object dependency, .env read or symlink traversal.
const paths = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name), local = relative(root, path).replaceAll('\\', '/');
    const stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink(), 'source inventory refuses symlinks');
    assert.ok(!/(?:^|\/)(?:\.env(?:\.|$)|id_(?:rsa|ed25519)(?:\.|$))|\.(?:key|p12|pfx|jks|keystore)$/i.test(local),
      'private configuration path requires separate authorized review');
    if (stat.isDirectory()) walk(path);
    else { assert.ok(stat.isFile(), 'regular source asset required'); paths.push(local); }
    assert.ok(paths.length <= 4096, 'bounded source inventory');
  }
}
walk(resolve(root, 'src'));
if (existsSync(resolve(root, 'public'))) walk(resolve(root, 'public'));
const actual = paths.sort().map(path => ({ path, bytes: readFileSync(resolve(root, path)) }));
requireNoRetired(actual); checks += 1;
for (const path of removed) { assert.equal(existsSync(resolve(root, path)), false, 'retired source path'); checks += 1; }
console.log(JSON.stringify({ ok: true, checks, source_assets: actual.length, retired_paths: removed.size,
  scope: 'src/public source retirement only', live_route_verified: false, absence_of_secrets_proven: false }));
