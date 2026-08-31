import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NativeOperationError, canonicalReceiptBytes, parseNativeOperationRequest } from '../src/native-operation-contract.mjs';
import { NativeOperationService } from '../src/native-operation-service.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const operationId = 'operation-1';
const rawBody = Buffer.from(JSON.stringify({ operation_id: operationId, operation_type: 'START', employee_id: 'employee-1' }));
const headers = {
  'idempotency-key': operationId,
  'x-mz-operation-id': operationId,
  'x-mz-operation-type': 'START',
  'x-mz-payload-sha256': sha256(rawBody),
  'x-mz-credential-epoch': '7',
};

function createRepository() {
  const receipts = new Map();
  let effects = 0;
  const repository = {
    async transaction(callback) {
      const snapshot = new Map(receipts);
      try {
        return await callback({
          async getReceiptForUpdate(id) { return receipts.get(id) || null; },
          async authenticateDevice({ authorization, credentialEpoch }) {
            return authorization === 'Bearer valid-token' && credentialEpoch === 7 ? { deviceId: 'device-1', employeeId: 'employee-1' } : null;
          },
          async applyOperation({ operation, actor }) {
            assert.equal(operation.body.employee_id, actor.employeeId);
            effects += 1;
            return { effectId: `effect-${effects}`, canonicalServerDigest: `server-${effects}` };
          },
          async insertReceipt(receipt) {
            if (receipts.has(receipt.operationId)) throw new Error('duplicate receipt');
            receipts.set(receipt.operationId, receipt);
          },
        });
      } catch (error) {
        receipts.clear();
        for (const [key, value] of snapshot) receipts.set(key, value);
        throw error;
      }
    },
  };
  return { repository, receipts, effectCount: () => effects };
}

{
  const parsed = parseNativeOperationRequest({ method: 'POST', headers, rawBody, pathOperationId: operationId });
  assert.equal(parsed.operationId, operationId);
  assert.deepEqual(parsed.rawBody, rawBody);
  assert.equal(parsed.credentialEpoch, 7);
}

{
  const state = createRepository();
  const service = new NativeOperationService({ repository: state.repository, clock: () => 1234 });
  const first = await service.submit({ headers, rawBody, pathOperationId: operationId, authorization: 'Bearer valid-token' });
  const replay = await service.submit({ headers, rawBody, pathOperationId: operationId, authorization: 'Bearer valid-token' });
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.equal(state.effectCount(), 1);
  assert.deepEqual(replay.bytes, first.bytes);
  const receipt = JSON.parse(first.bytes);
  assert.equal(receipt.operation_id, operationId);
  assert.equal(receipt.expected_payload_sha256, sha256(rawBody));
  assert.equal(receipt.server_effect_id, 'effect-1');
  assert.equal(receipt.accepted_at_epoch_ms, 1234);
}

{
  const state = createRepository();
  const service = new NativeOperationService({ repository: state.repository });
  await assert.rejects(
    service.submit({ headers, rawBody, pathOperationId: operationId, authorization: 'Bearer wrong' }),
    error => error instanceof NativeOperationError && error.status === 403 && error.code === 'AUTHORIZATION_REJECTED',
  );
  assert.equal(state.effectCount(), 0);
  assert.equal(state.receipts.size, 0);
}

{
  const state = createRepository();
  const service = new NativeOperationService({ repository: state.repository, clock: () => 1234 });
  await service.submit({ headers, rawBody, pathOperationId: operationId, authorization: 'Bearer valid-token' });
  const conflictingBody = Buffer.from(JSON.stringify({ operation_id: operationId, operation_type: 'START', employee_id: 'other' }));
  const conflictingHeaders = { ...headers, 'x-mz-payload-sha256': sha256(conflictingBody) };
  await assert.rejects(
    service.submit({ headers: conflictingHeaders, rawBody: conflictingBody, pathOperationId: operationId, authorization: 'Bearer valid-token' }),
    error => error instanceof NativeOperationError && error.status === 409 && error.code === 'OPERATION_ID_CONFLICT',
  );
  assert.equal(state.effectCount(), 1);
}

{
  const state = createRepository();
  const service = new NativeOperationService({ repository: state.repository, clock: () => 1234 });
  const missing = await service.status({ pathOperationId: operationId, authorization: 'Bearer valid-token', credentialEpoch: 7 });
  assert.equal(missing.status, 404);
  await service.submit({ headers, rawBody, pathOperationId: operationId, authorization: 'Bearer valid-token' });
  const present = await service.status({ pathOperationId: operationId, authorization: 'Bearer valid-token', credentialEpoch: 7 });
  assert.equal(present.status, 200);
}

{
  const corruptedHeaders = { ...headers, 'x-mz-payload-sha256': '0'.repeat(64) };
  assert.throws(
    () => parseNativeOperationRequest({ method: 'POST', headers: corruptedHeaders, rawBody, pathOperationId: operationId }),
    error => error instanceof NativeOperationError && error.code === 'PAYLOAD_HASH_MISMATCH',
  );
}

{
  const receipt = canonicalReceiptBytes({
    operation_id: operationId,
    expected_payload_sha256: sha256(rawBody),
    canonical_server_digest: 'server-1',
    server_effect_id: 'effect-1',
    accepted_at_epoch_ms: 1234,
    replayed: false,
  });
  assert.equal(receipt.toString('utf8'), `{"operation_id":"${operationId}","expected_payload_sha256":"${sha256(rawBody)}","canonical_server_digest":"server-1","server_effect_id":"effect-1","accepted_at_epoch_ms":1234,"replayed":false}`);
}

console.log(JSON.stringify({ result: 'PASS', tests: 7 }));
