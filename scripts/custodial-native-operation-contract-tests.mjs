import assert from 'node:assert/strict';
import {
  InMemoryNativeOperationStore,
  createNativeOperationService,
  parseNativeOperationCommand,
  sha256,
} from '../src/custodial-native-operation-contract.mjs';

const body = Buffer.from('{"operation_id":"operation-0001","type":"START"}');
const baseHeaders = {
  authorization: 'Bearer test-only',
  'idempotency-key': 'operation-0001',
  'x-mz-operation-id': 'operation-0001',
  'x-mz-operation-type': 'START',
  'x-mz-payload-sha256': sha256(body),
  'x-mz-credential-epoch': '7',
};
const actor = { employeeId: 'employee-1', deviceInstallationId: 'installation-1' };

{
  const parsed = parseNativeOperationCommand({ method: 'POST', pathOperationId: 'operation-0001', headers: baseHeaders, body });
  assert.equal(parsed.payloadSha256, sha256(body));
  assert.deepEqual(parsed.exactBody, body);
}

{
  assert.throws(() => parseNativeOperationCommand({
    method: 'POST', pathOperationId: 'operation-0001', headers: { ...baseHeaders, 'x-mz-payload-sha256': '0'.repeat(64) }, body,
  }), error => error.code === 'PAYLOAD_HASH_MISMATCH');
}

{
  const store = new InMemoryNativeOperationStore();
  let effects = 0;
  const service = createNativeOperationService({
    authenticate: async () => actor,
    store,
    clock: () => 1_900_000_000_000,
    applyOperation: async () => {
      effects += 1;
      return { serverEffectId: 'effect-1', canonicalServerDigest: 'digest-1' };
    },
  });
  const request = { method: 'POST', pathOperationId: 'operation-0001', headers: baseHeaders, body };
  const [first, duplicate] = await Promise.all([service(request), service(request)]);
  assert.equal(first.status, 200);
  assert.deepEqual(duplicate.body, first.body);
  assert.equal(effects, 1);
  assert.equal(store.size, 1);

  const status = await service({ method: 'GET', pathOperationId: 'operation-0001', headers: baseHeaders, body: null });
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, first.body);

  const mismatchBody = Buffer.from('{"operation_id":"operation-0001","type":"FINISH"}');
  const mismatch = await service({
    method: 'POST', pathOperationId: 'operation-0001',
    headers: { ...baseHeaders, 'x-mz-operation-type': 'FINISH', 'x-mz-payload-sha256': sha256(mismatchBody) },
    body: mismatchBody,
  });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');
  assert.equal(effects, 1);
}

{
  const store = new InMemoryNativeOperationStore();
  const service = createNativeOperationService({
    authenticate: async () => actor,
    store,
    applyOperation: async () => ({ serverEffectId: 'effect-2', canonicalServerDigest: 'digest-2', acceptedAtEpochMs: 123 }),
  });
  const missing = await service({ method: 'GET', pathOperationId: 'operation-0001', headers: baseHeaders, body: null });
  assert.equal(missing.status, 404);
}

{
  const store = new InMemoryNativeOperationStore();
  const service = createNativeOperationService({
    authenticate: async () => null,
    store,
    applyOperation: async () => { throw new Error('must not run'); },
  });
  const denied = await service({ method: 'POST', pathOperationId: 'operation-0001', headers: baseHeaders, body });
  assert.equal(denied.status, 401);
  assert.equal(store.size, 0);
}

console.log('custodial native operation contract tests: PASS');
