import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {CURRENT_MANAGER_218_MIGRATION_MANIFEST,CURRENT_MANAGER_218_MIGRATION}
  from './current-manager-publication-source.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
export const CURRENT_MANAGER_219_MIGRATION_MANIFEST='4795b9525622e1512005f85ae1c5994971dccc3d54a987a743bdcfef8bf9ce32';
export const CURRENT_MANAGER_219_MESSAGE_MIGRATION=Object.freeze({
  file:'20261003121757_employee_message_source_admission.sql',
  sha256:'20ff06f8c0c5e82814189e1e2969b928ffa48eb1181098a73156962dc9ac1e7f',
});

// Explicitly inserted MESSAGE migration, not a suffix/count override. Keep the
// old216/217/218 helper byte-identical and independently usable on those trees.
export function assertCurrentManager219Manifest(manifest) {
  assert.ok(Array.isArray(manifest),'ordered migration rows required');
  assert.equal(manifest.length,219,'current manager 219 fixture requires all219 migrations');
  for(const row of manifest) {
    assert.ok(row&&typeof row==='object'&&!Array.isArray(row));
    assert.deepEqual(Object.keys(row).sort(),['file','sha256']);
    assert.match(row.file,/^\d{14}_[a-zA-Z0-9_]+\.sql$/);
    assert.match(row.sha256,/^[0-9a-f]{64}$/);
  }
  assert.deepEqual(manifest.map(row=>row.file),[...new Set(manifest.map(row=>row.file))].sort(),
    'unique exact ordered migration names required');
  const inserted=manifest.filter(row=>row.file===CURRENT_MANAGER_219_MESSAGE_MIGRATION.file);
  assert.deepEqual(inserted,[CURRENT_MANAGER_219_MESSAGE_MIGRATION],'exact MESSAGE insertion required');
  const predecessor=manifest.filter(row=>row.file!==CURRENT_MANAGER_219_MESSAGE_MIGRATION.file);
  assert.equal(sha(JSON.stringify(predecessor)),CURRENT_MANAGER_218_MIGRATION_MANIFEST,
    'exact218 predecessor bytes/order must survive removal of only MESSAGE');
  assert.deepEqual(manifest.at(-1),CURRENT_MANAGER_218_MIGRATION,'current219 still has the native-event-decision head');
  assert.equal(sha(JSON.stringify(manifest)),CURRENT_MANAGER_219_MIGRATION_MANIFEST,
    'complete219 ordered migration bytes required');
  return manifest;
}
export function assertCurrentManager219MigrationSet(root=new URL('../../',import.meta.url)) {
  const directory=new URL('supabase/migrations/',root);
  const manifest=readdirSync(directory).filter(file=>file.endsWith('.sql')).sort()
    .map(file=>({file,sha256:sha(readFileSync(new URL(file,directory)))}));
  return assertCurrentManager219Manifest(manifest);
}
