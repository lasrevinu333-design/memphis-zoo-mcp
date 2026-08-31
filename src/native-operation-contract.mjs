import { createHash } from 'node:crypto';

export const NATIVE_OPERATION_MAX_BYTES = 256 * 1024;
export const NATIVE_OPERATION_TYPES = new Set(['START', 'FINISH', 'SUPPORT_REQUEST']);

export class NativeOperationError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'NativeOperationError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function header(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '').trim();
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
}

function requiredHeader(headers, name, pattern = null) {
  const value = header(headers, name);
  if (!value) throw new NativeOperationError(400, 'HEADER_REQUIRED', `${name} is required.`);
  if (pattern && !pattern.test(value)) throw new NativeOperationError(400, 'HEADER_INVALID', `${name} is invalid.`);
  return value;
}

function safeJson(bytes) {
  try {
    const value = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('body is not an object');
    return value;
  } catch (error) {
    throw new NativeOperationError(400, 'BODY_INVALID', 'The operation body is not valid JSON.');
  }
}

export function parseNativeOperationRequest({ method, headers, rawBody, pathOperationId }) {
  const operationId = requiredHeader(headers, 'x-mz-operation-id', /^[A-Za-z0-9._~-]{1,160}$/);
  const idempotencyKey = requiredHeader(headers, 'idempotency-key', /^[A-Za-z0-9._~-]{1,160}$/);
  if (operationId !== idempotencyKey || operationId !== pathOperationId) {
    throw new NativeOperationError(409, 'OPERATION_ID_MISMATCH', 'Operation identity does not match the request path.');
  }
  const payloadSha256 = requiredHeader(headers, 'x-mz-payload-sha256', /^[0-9a-fA-F]{64}$/).toLowerCase();
  const operationType = requiredHeader(headers, 'x-mz-operation-type', /^[A-Z_]+$/);
  if (!NATIVE_OPERATION_TYPES.has(operationType)) {
    throw new NativeOperationError(422, 'OPERATION_TYPE_UNSUPPORTED', 'This operation type is not supported.');
  }
  const credentialEpochText = requiredHeader(headers, 'x-mz-credential-epoch', /^\d+$/);
  const credentialEpoch = Number(credentialEpochText);
  if (!Number.isSafeInteger(credentialEpoch) || credentialEpoch < 0) {
    throw new NativeOperationError(400, 'CREDENTIAL_EPOCH_INVALID', 'Credential epoch is invalid.');
  }
  const body = Buffer.from(rawBody || []);
  if (method !== 'POST') throw new NativeOperationError(405, 'METHOD_NOT_ALLOWED', 'POST is required.');
  if (body.length === 0 || body.length > NATIVE_OPERATION_MAX_BYTES) {
    throw new NativeOperationError(413, 'BODY_SIZE_INVALID', 'Operation body size is invalid.');
  }
  const actualSha256 = sha256(body);
  if (actualSha256 !== payloadSha256) {
    throw new NativeOperationError(409, 'PAYLOAD_HASH_MISMATCH', 'Operation body does not match its saved hash.');
  }
  const json = safeJson(body);
  const bodyOperationId = String(json.operation_id || json.operationId || '');
  const bodyOperationType = String(json.operation_type || json.operationType || '');
  if (bodyOperationId !== operationId) {
    throw new NativeOperationError(409, 'BODY_OPERATION_ID_MISMATCH', 'Operation body belongs to a different operation.');
  }
  if (bodyOperationType !== operationType) {
    throw new NativeOperationError(409, 'BODY_OPERATION_TYPE_MISMATCH', 'Operation body type does not match its request identity.');
  }
  return Object.freeze({
    operationId,
    operationType,
    credentialEpoch,
    payloadSha256,
    rawBody: Buffer.from(body),
    body: Object.freeze({ ...json }),
  });
}

export function canonicalReceiptObject({ operation, effectId, canonicalServerDigest, acceptedAtEpochMs, replayed }) {
  return {
    operation_id: operation.operationId,
    expected_payload_sha256: operation.payloadSha256,
    canonical_server_digest: canonicalServerDigest,
    server_effect_id: effectId,
    accepted_at_epoch_ms: acceptedAtEpochMs,
    replayed: Boolean(replayed),
  };
}

export function canonicalReceiptBytes(receipt) {
  const order = [
    'operation_id',
    'expected_payload_sha256',
    'canonical_server_digest',
    'server_effect_id',
    'accepted_at_epoch_ms',
    'replayed',
  ];
  const entries = order.map(key => [key, receipt[key]]);
  return Buffer.from(JSON.stringify(Object.fromEntries(entries)), 'utf8');
}

export function classifyNativeOperationError(error) {
  if (error instanceof NativeOperationError) {
    return { status: error.status, body: { error: error.code, message: error.message, ...error.details } };
  }
  return { status: 500, body: { error: 'NATIVE_OPERATION_FAILED', message: 'The operation could not be completed.' } };
}
