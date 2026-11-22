import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const serialize = value => JSON.stringify(value, null, 2) + '\n';
const marker = 'expected_live_data jsonb NOT NULL';
const inverse = () => {
  const bytes = readFileSync(new URL('../release/installed-source/20261120_locked_context_live_data_inverse.json', import.meta.url));
  assert.equal(sha256(bytes), '6ec0a8460252fff649c490f12394625306d3037322cc85dbba985d51357cbe87');
  return JSON.parse(bytes);
};

const indexedStageMarker = '-- Read the last staged ordinal from the existing composite primary key.';
const indexedStageInverse = () => {
  const bytes = readFileSync(new URL('../release/installed-source/20261120_indexed_ordinary_stage_inverse.json', import.meta.url));
  assert.equal(sha256(bytes), '9155c5ee50e63db11ca19d2dfc28430706904eb46e3871581be0035364ce4489');
  return JSON.parse(bytes);
};

const typedInsertMarker = '-- Choose the fixed codec once from the authenticated member.';
const typedInsertInverse = () => {
  const bytes = readFileSync(new URL('../release/installed-source/20261120_typed_ordinary_set_insert_inverse.json', import.meta.url));
  assert.equal(sha256(bytes), 'f71a56f032f10989f2c9481235bd8d4f8bd51317f10db50efed3d8e2d73b8c20');
  return JSON.parse(bytes);
};

const releaseHistoryCountMarker = '-- The initializer retains every signed release-history row.';
const releaseHistoryCountInverse = () => {
  const bytes = readFileSync(new URL('../release/installed-source/20261122_current_finish_release_history_inverse.json', import.meta.url));
  assert.equal(sha256(bytes), '15c9f1cc258a303feca800d43e06db325b6b120aeefbd7ce9367702e97a2b5c9');
  return JSON.parse(bytes);
};

function transform(original, reverse, proof) {
  const { previousProgramSha256, currentProgramSha256, previousStatementSha256, currentStatementSha256, hunks } = proof;
  assert.equal(sha256(serialize(original)), reverse ? currentProgramSha256 : previousProgramSha256);
  const program = structuredClone(original);
  const statement = program.statements[0];
  assert.equal(sha256(statement.sql), reverse ? currentStatementSha256 : previousStatementSha256);
  for (const { before, after } of reverse ? hunks.toReversed() : hunks) {
    const [from, to] = reverse ? [after, before] : [before, after];
    assert.equal(statement.sql.split(from).length, 2);
    statement.sql = statement.sql.replace(from, () => to);
  }
  statement.sourceSha256 = sha256(statement.sql);
  assert.equal(statement.sourceSha256, reverse ? previousStatementSha256 : currentStatementSha256);
  assert.equal(sha256(serialize(program)), reverse ? previousProgramSha256 : currentProgramSha256);
  return program;
}

export function extendCurrentLiveDataSnapshot(program) {
  return transform(program, false, inverse());
}

export function extendIndexedOrdinaryStage(program) {
  return transform(program, false, indexedStageInverse());
}

export function extendTypedOrdinarySetInsert(program) {
  return transform(program, false, typedInsertInverse());
}

export function extendCurrentFinishReleaseHistoryCount(program) {
  return transform(program, false, releaseHistoryCountInverse());
}

export function removeCurrentFinishReleaseHistoryCount(program) {
  return program.statements[0].sql.includes(releaseHistoryCountMarker)
    ? transform(program, true, releaseHistoryCountInverse())
    : program;
}

export function removeCurrentLiveDataSnapshot(program) {
  const typed = removeCurrentFinishReleaseHistoryCount(program);
  const indexed = typed.statements[0].sql.includes(typedInsertMarker)
    ? transform(typed, true, typedInsertInverse())
    : typed;
  const prior = indexed.statements[0].sql.includes(indexedStageMarker)
    ? transform(indexed, true, indexedStageInverse())
    : indexed;
  return prior.statements[0].sql.includes(marker) ? transform(prior, true, inverse()) : prior;
}
