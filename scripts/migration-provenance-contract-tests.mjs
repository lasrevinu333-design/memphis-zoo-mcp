import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const migrationDir = new URL('supabase/migrations/', root);
const files = (await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort();
const versions = files.map((name) => {
  const match = name.match(/^(\d{14})_[a-z0-9_]+\.sql$/);
  assert.ok(match, `migration filename is not canonical: ${name}`);
  return match[1];
});
assert.equal(new Set(versions).size, versions.length, 'migration versions must be unique');
assert.equal(files.includes('00000000000000_production_baseline.sql'), false, 'production snapshot must not be deployable as a migration');
assert.ok((await readFile(new URL('supabase/baseline/production_baseline.sql', root), 'utf8')).length > 1000);

const authoritativeRecentVersions = [
  '20260717170035','20260717170136','20260717175320','20260717203456','20260717211212',
  '20260718002000','20260718021910','20260718022648','20260718070417','20260718072634',
  '20260718081916','20260718083335','20260718084607','20260718085603','20260718124426',
  '20260718124433','20260718131734','20260718143726','20260718160914','20260718181345',
  '20260718194840','20260718195342','20260719235243','20260721212246','20260721212339',
  '20260721212406','20260721212552','20260721214714','20260722210339','20260722210533',
  '20260722210620','20260722210658','20260722230915','20260723004728','20260723004749',
  '20260723111542','20260724015534','20260724020041',
];
for (const version of authoritativeRecentVersions) {
  assert.ok(versions.includes(version), `repository is missing authoritative Supabase migration ${version}`);
}
const markerVersions = [];
for (const file of files) {
  const source = await readFile(new URL(`supabase/migrations/${file}`, root), 'utf8');
  if (/^-- Ledger marker: schema is contained in supabase\/baseline\/production_baseline\.sql\.\s*$/i.test(source.trim())) {
    markerVersions.push(file.slice(0, 14));
  }
}
assert.equal(markerVersions.length, 97, 'all 97 squashed production ledger versions must retain a CLI marker');
assert.equal(new Set([...markerVersions, ...authoritativeRecentVersions]).size, 135, 'the repository must model all 135 authoritative production ledger versions exactly once');
assert.equal(versions.length, 139, 'only native-delivery reconciliation, lifecycle integrity, shared-scan recovery, and authorized message deletion may be pending beyond the 135-version production ledger');

const nativeDelivery = await readFile(new URL('supabase/migrations/20260724010000_native_employee_event_delivery.sql', root), 'utf8');
assert.match(nativeDelivery, /if not exists \([\s\S]*devices_assignment_epoch_positive/i);
assert.match(nativeDelivery, /if not exists \([\s\S]*events_app_events_audience_scope_check/i);
assert.ok(versions.includes('20260724010000'), 'native employee delivery ledger reconciliation must remain deployable and idempotent');
assert.ok(versions.includes('20260724145808'), 'lifecycle integrity migration must follow the reconciled historical chain');
assert.ok(versions.includes('20260724173912'), 'shared scan and recovery integrity migration must follow lifecycle integrity');
assert.ok(versions.includes('20260724223021'), 'authorized message deletion must follow the third-audit candidate migration chain');

console.log('MIGRATION_PROVENANCE_CONTRACT_PASS');
