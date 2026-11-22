import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extendCurrentLiveDataSnapshot, extendIndexedOrdinaryStage, extendTypedOrdinarySetInsert, removeCurrentFinishReleaseHistoryCount, removeCurrentLiveDataSnapshot } from './immutable-current-live-data-source.mjs';

const document = JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json', import.meta.url)));
const prior = removeCurrentLiveDataSnapshot(document);
const sql = document.statements[0].sql;
const predecessor = prior.statements[0].sql;
const exactFunction = (source, name, delimiter = 'fn') =>
  source.match(new RegExp('CREATE FUNCTION custodial_dr\\.' + name + '\\([\\s\\S]*?\\$' + delimiter + '\\$;'))?.[0];

test('the measured live-data projection changes only the original first statement and has an exact predecessor', () => {
  assert.equal(createHash('sha256').update(JSON.stringify(prior, null, 2) + '\n').digest('hex'),
    '46ca2ea40882ac2c2d649462cceaf558011f9dbeab3d4d40703b5c821c0a1ae5');
  const lockedDataProgram = extendCurrentLiveDataSnapshot(prior);
  assert.equal(createHash('sha256').update(JSON.stringify(lockedDataProgram, null, 2) + '\n').digest('hex'),
    '39cf55e18a69f41c3f53cdb122dd6245b33cc35a9a2967d85f4be6adbbceb4be');
  const indexed = extendIndexedOrdinaryStage(lockedDataProgram);
  const typed = removeCurrentFinishReleaseHistoryCount(document);
  assert.deepEqual(extendTypedOrdinarySetInsert(indexed), typed);
  const insert = 'insert_staged_immutable_ordinary_table';
  assert.equal(typed.statements[0].sql.replace(exactFunction(sql, insert), () => exactFunction(indexed.statements[0].sql, insert)),
    indexed.statements[0].sql);
  assert.deepEqual(document.statements.slice(1), prior.statements.slice(1));
  assert.deepEqual(document.recipes, prior.recipes);
  for (const name of ['immutable_import_target_shape', 'insert_immutable_ordinary_row', 'immutable_import_source_inventory_state']) {
    const actual = exactFunction(sql, name);
    assert.ok(actual, name);
    if (name !== 'immutable_import_source_inventory_state') assert.equal(actual, exactFunction(predecessor, name));
  }
});

test('the same sealed snapshot supplies every expected live field and cannot be changed during phase updates', () => {
  assert.match(sql, /expected_live_data jsonb NOT NULL/);
  const guard = exactFunction(sql, 'immutable_import_context_source_immutable');
  assert.match(guard, /NEW\.target_shape,NEW\.catalog_epoch,NEW\.expected_live_data/);
  assert.match(guard, /OLD\.target_shape,OLD\.catalog_epoch,OLD\.expected_live_data/);
  const source = exactFunction(sql, 'immutable_import_source_inventory_state');
  assert.equal(source.replace("jsonb_agg(c.expected_live_data->'recovery_inventory')", "jsonb_agg(c.target_shape->'recovery_inventory')")
    .replace(/='[a-f0-9]{64}'/, "='0c21afd420913d3caa766942fd0df66f29dfe8e5a85bc070ca5802a20f3fbfe4'"),
  exactFunction(predecessor, 'immutable_import_source_inventory_state'));
  const begin = exactFunction(sql, 'begin_immutable_private_import');
  assert.match(begin, /catalog_certificate,\s*jsonb_build_object\('migration_head',target->'migration_head','release',target->'release',\s*'recovery_inventory',target->'recovery_inventory'\)\)/);
});

test('the current epoch compares fresh data and a stale epoch retains the complete target shape comparison', () => {
  const name = 'immutable_import_catalog_matches';
  const before = exactFunction(predecessor, name, 'catalog');
  const after = exactFunction(sql, name, 'catalog');
  assert.equal(after
    .replace('expected_epoch jsonb,expected_data jsonb', 'expected_epoch jsonb')
    .replace('after_epoch jsonb;live_data jsonb;', 'after_epoch jsonb;live_data jsonb;expected_data jsonb;')
    .replace(" -- The expected fields were projected from the same full target shape at\n -- begin and sealed by the original context's immutable source guard.",
      " expected_data:=jsonb_build_object('migration_head',expected_shape->'migration_head',\n  'release',expected_shape->'release','recovery_inventory',expected_shape->'recovery_inventory');"),
    before);
});
