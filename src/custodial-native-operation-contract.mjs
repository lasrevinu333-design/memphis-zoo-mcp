import { createHash, timingSafeEqual } from 'node:crypto';

const OPERATION_ID = /^[A-Za-z0-9._~-]{8,160}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ALLOWED_TYPES = new Set(['START', 'FINISH', 'SUPPORT_REQUEST', 'FEEDBACK', 'MESSAGE', 'ACK']);

export class NativeOperationContractError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'NativeOperationContractError';
    this.status = status;
    this.code = code;
  }
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function requiredHeader(headers, name) {
  const value = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  if (typeof value !== 'string' || !value.trim()) {
    throw new NativeOperationContractError(400, 'HEADER_REQUIRED', `${name} is required.`);
  }
  return value.trim();
}

function equalText(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseNativeOperationCommand({ method, pathOperationId, headers, body }) {
  const normalizedMethod = String(method ?? '').toUpperCase();
  const operationId = String(pathOperationId ?? '');
  if (!OPERATION_ID.test(operationId)) {
    throw new NativeOperationContractError(400, 'OPERATION_ID_INVALID', 'Operation identity is invalid.');
  }
  const headerOperationId = requiredHeader(headers, 'x-mz-operation-id');
  const idempotencyKey = requiredHeader(headers, 'idempotency-key');
  if (!equalText(headerOperationId, operationId) || !equalText(idempotencyKey, operationId)) {
    throw new NativeOperationContractError(409, 'OPERATION_ID_MISMATCH', 'Operation identity does not match the request path.');
  }
  const credentialEpochRaw = requiredHeader(headers, 'x-mz-credential-epoch');
  const credentialEpoch = Number(credentialEpochRaw);
  if (!Number.isSafeInteger(credentialEpoch) || credentialEpoch < 0) {
    throw new NativeOperationContractError(400, 'CREDENTIAL_EPOCH_INVALID', 'Credential epoch is invalid.');
  }
  if (normalizedMethod === 'GET') {
    if (body && Buffer.byteLength(body) > 0) {
      throw new NativeOperationContractError(400, 'STATUS_BODY_FORBIDDEN', 'Status reads cannot contain a body.');
    }
    return { kind: 'STATUS', operationId, credentialEpoch };
  }
  if (normalizedMethod !== 'POST') {
    throw new NativeOperationContractError(405, 'METHOD_NOT_ALLOWED', 'Only POST and GET are allowed.');
  }
  const operationType = requiredHeader(headers, 'x-mz-operation-type').toUpperCase();
  if (!ALLOWED_TYPES.has(operationType)) {
    throw new NativeOperationContractError(422, 'OPERATION_TYPE_INVALID', 'Operation type is not supported.');
  }
  const expectedHash = requiredHeader(headers, 'x-mz-payload-sha256').toLowerCase();
  if (!SHA256.test(expectedHash)) {
    throw new NativeOperationContractError(400, 'PAYLOAD_HASH_INVALID', 'Payload hash is invalid.');
  }
  const exactBody = Buffer.isBuffer(body) ? Buffer.from(body) : Buffer.from(body ?? '');
  if (exactBody.length === 0 || exactBody.length > 1_048_576) {
    throw new NativeOperationContractError(413, 'PAYLOAD_SIZE_INVALID', 'Operation payload size is invalid.');
  }
  const actualHash = sha256(exactBody);
  if (!equalText(expectedHash, actualHash)) {
    throw new NativeOperationContractError(409, 'PAYLOAD_HASH_MISMATCH', 'Payload hash does not match the exact request bytes.');
  }
  return { kind: 'COMMAND', operationId, operationType, credentialEpoch, payloadSha256: actualHash, exactBody };
}

function canonicalReceipt(record) {
  return {
    operation_id: record.operationId,
    expected_payload_sha256: record.payloadSha256,
    canonical_server_digest: record.canonicalServerDigest,
    server_effect_id: record.serverEffectId,
    accepted_at_epoch_ms: record.acceptedAtEpochMs,
  };
}

export function createNativeOperationService({ authenticate, store, applyOperation, clock = () => Date.now() }) {
  if (typeof authenticate !== 'function') throw new TypeError('authenticate is required');
  if (!store || typeof store.read !== 'function' || typeof store.transact !== 'function') throw new TypeError('transactional store is required');
  if (typeof applyOperation !== 'function') throw new TypeError('applyOperation is required');

  return async function handle(request) {
    try {
      const parsed = parseNativeOperationCommand(request);
      const actor = await authenticate({ headers: request.headers, credentialEpoch: parsed.credentialEpoch });
      if (!actor || !actor.employeeId || !actor.deviceInstallationId) {
        throw new NativeOperationContractError(401, 'DEVICE_AUTHENTICATION_REQUIRED', 'Device authentication failed.');
      }
      if (parsed.kind === 'STATUS') {
        const existing = await store.read(parsed.operationId);
        if (!existing) return { status: 404, body: { code: 'CANONICAL_STATUS_NOT_FOUND' } };
        if (existing.employeeId !== actor.employeeId || existing.deviceInstallationId !== actor.deviceInstallationId) {
          throw new NativeOperationContractError(403, 'OPERATION_OWNER_MISMATCH', 'Operation belongs to another device or employee.');
        }
        return { status: 200, body: canonicalReceipt(existing) };
      }

      const record = await store.transact(parsed.operationId, async existing => {
        if (existing) {
          if (
            existing.payloadSha256 !== parsed.payloadSha256 ||
            existing.operationType !== parsed.operationType ||
            existing.employeeId !== actor.employeeId ||
            existing.deviceInstallationId !== actor.deviceInstallationId ||
            existing.credentialEpoch !== parsed.credentialEpoch
          ) {
            throw new NativeOperationContractError(409, 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'Operation identity was already used for different work.');
          }
          return existing;
        }
        const effect = await applyOperation({ parsed, actor });
        if (!effect?.serverEffectId || !effect?.canonicalServerDigest) {
          throw new Error('Operation application did not return a canonical effect.');
        }
        return {
          operationId: parsed.operationId,
          operationType: parsed.operationType,
          payloadSha256: parsed.payloadSha256,
          employeeId: actor.employeeId,
          deviceInstallationId: actor.deviceInstallationId,
          credentialEpoch: parsed.credentialEpoch,
          serverEffectId: effect.serverEffectId,
          canonicalServerDigest: effect.canonicalServerDigest,
          acceptedAtEpochMs: Number(effect.acceptedAtEpochMs ?? clock()),
        };
      });
      return { status: 200, body: canonicalReceipt(record) };
    } catch (error) {
      if (error instanceof NativeOperationContractError) {
        return { status: error.status, body: { code: error.code, message: error.message } };
      }
      throw error;
    }
  };
}

export class InMemoryNativeOperationStore {
  #records = new Map();
  #locks = new Map();

  async read(operationId) {
    const value = this.#records.get(operationId);
    return value ? structuredClone(value) : null;
  }

  async transact(operationId, work) {
    const prior = this.#locks.get(operationId) ?? Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    this.#locks.set(operationId, prior.then(() => current));
    await prior;
    try {
      const existing = this.#records.get(operationId);
      const result = await work(existing ? structuredClone(existing) : null);
      if (!existing) this.#records.set(operationId, structuredClone(result));
      return structuredClone(this.#records.get(operationId));
    } finally {
      release();
      if (this.#locks.get(operationId) === current) this.#locks.delete(operationId);
    }
  }

  get size() { return this.#records.size; }
}
