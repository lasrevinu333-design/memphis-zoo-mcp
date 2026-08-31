import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PostgresNativeOperationRepository } from '../src/native-operation-postgres-repository.mjs';

const migration = await readFile(new URL('../supabase/migrations/20260831010000_native_operation_ledger.sql', import.meta.url), 'utf8');
for (const required of [
  'create table public.native_operation_receipts',
  'operation_id text primary key',
  'raw_request_bytes bytea not null',
  'receipt_bytes bytea not null',
  'alter table public.native_operation_receipts enable row level security',
  'alter table public.native_operation_receipts force row level security',
  'revoke all on table public.native_operation_receipts from anon',
  'revoke all on table public.native_operation_receipts from authenticated',
  'native_operation_receipts_no_update',
  'native_operation_receipts_no_delete',
]) assert.ok(migration.includes(required), `migration missing: ${required}`);

function fakePool({ existing = null, failInsert = null } = {}) {
  const queries = [];
  let released = 0;
  const client = {
    async query(value) {
      const text = typeof value === 'string' ? value : value.text;
      queries.push(value);
      if (/select operation_id/.test(text)) return { rows: existing ? [existing] : [] };
      if (/insert into public\.native_operation_receipts/.test(text) && failInsert) throw failInsert;
      return { rows: [] };
    },
    release() { released += 1; },
  };
  return { pool: { async connect() { return client; } }, queries, released: () => released };
}

{
  const db = fakePool();
  const repository = new PostgresNativeOperationRepository({
    pool: db.pool,
    authenticateDevice: async ({ client, authorization, credentialEpoch }) => {
      assert.equal(client, db.pool ? client : null);
      return authorization === 'Bearer valid' && credentialEpoch === 7
        ? { employeeId: '00000000-0000-0000-0000-000000000001', deviceId: '00000000-0000-0000-0000-000000000002' }
        : null;
    },
    applyOperation: async () => ({ effectId: 'effect-1', canonicalServerDigest: 'digest-1' }),
  });
  await repository.transaction(async tx => {
    assert.equal(await tx.getReceiptForUpdate('operation-1'), null);
    const actor = await tx.authenticateDevice({ authorization: 'Bearer valid', credentialEpoch: 7 });
    await tx.insertReceipt({
      operationId: 'operation-1', operationType: 'START', payloadSha256: 'a'.repeat(64),
      rawRequestBytes: Buffer.from('request'), receiptBytes: Buffer.from('receipt'),
      receiptSha256: 'b'.repeat(64), canonicalServerDigest: 'digest-1', effectId: 'effect-1',
      actor, credentialEpoch: 7, acceptedAtEpochMs: 1234,
    });
  });
  const sql = db.queries.map(x => typeof x === 'string' ? x : x.text).join('\n');
  assert.match(sql, /begin isolation level serializable/i);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /for update/);
  assert.match(sql, /insert into public\.native_operation_receipts/);
  assert.match(sql, /commit/i);
  assert.equal((sql.match(/pg_advisory_xact_lock/g) || []).length, 1);
  assert.equal(db.released(), 1);
}

{
  const error = Object.assign(new Error('serialization'), { code: '40001' });
  const db = fakePool({ failInsert: error });
  const repository = new PostgresNativeOperationRepository({
    pool: db.pool,
    authenticateDevice: async () => ({ employeeId: 'e', deviceId: 'd' }),
    applyOperation: async () => ({ effectId: 'effect', canonicalServerDigest: 'digest' }),
  });
  await assert.rejects(
    repository.transaction(async tx => {
      await tx.insertReceipt({
        operationId: 'operation-2', operationType: 'START', payloadSha256: 'a'.repeat(64),
        rawRequestBytes: Buffer.from('request'), receiptBytes: Buffer.from('receipt'), receiptSha256: 'b'.repeat(64),
        canonicalServerDigest: 'digest', effectId: 'effect', actor: { employeeId: 'e', deviceId: 'd' },
        credentialEpoch: 1, acceptedAtEpochMs: 1,
      });
    }),
    value => value.code === 'OPERATION_RETRY_REQUIRED' && value.status === 503,
  );
  const sql = db.queries.map(x => typeof x === 'string' ? x : x.text).join('\n');
  assert.match(sql, /rollback/i);
  assert.equal(db.released(), 1);
}

console.log(JSON.stringify({ result: 'PASS', tests: 3 }));
