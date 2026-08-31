import {
  NativeOperationError,
  canonicalReceiptBytes,
  canonicalReceiptObject,
  parseNativeOperationRequest,
  sha256,
} from './native-operation-contract.mjs';

/**
 * Repository methods execute against one database transaction supplied by the caller:
 * getReceiptForUpdate(operationId), authenticateDevice(...), applyOperation(...), insertReceipt(...).
 */
export class NativeOperationService {
  constructor({ repository, clock = () => Date.now() }) {
    if (!repository || typeof repository.transaction !== 'function') throw new TypeError('repository.transaction is required');
    this.repository = repository;
    this.clock = clock;
  }

  async submit({ headers, rawBody, pathOperationId, authorization }) {
    const operation = parseNativeOperationRequest({ method: 'POST', headers, rawBody, pathOperationId });
    return this.repository.transaction(async transaction => {
      const existing = await transaction.getReceiptForUpdate(operation.operationId);
      if (existing) return this.#replay(existing, operation);
      const actor = await transaction.authenticateDevice({
        authorization,
        credentialEpoch: operation.credentialEpoch,
        operationId: operation.operationId,
      });
      if (!actor) throw new NativeOperationError(403, 'AUTHORIZATION_REJECTED', 'This phone is not authorized.');
      const effect = await transaction.applyOperation({ operation, actor });
      if (!effect?.effectId || !effect?.canonicalServerDigest) {
        throw new Error('Operation repository returned an incomplete canonical effect.');
      }
      const acceptedAtEpochMs = this.clock();
      const receiptObject = canonicalReceiptObject({
        operation,
        effectId: effect.effectId,
        canonicalServerDigest: effect.canonicalServerDigest,
        acceptedAtEpochMs,
        replayed: false,
      });
      const receiptBytes = canonicalReceiptBytes(receiptObject);
      const receipt = {
        operationId: operation.operationId,
        operationType: operation.operationType,
        payloadSha256: operation.payloadSha256,
        rawRequestBytes: Buffer.from(operation.rawBody),
        receiptBytes,
        receiptSha256: sha256(receiptBytes),
        canonicalServerDigest: effect.canonicalServerDigest,
        effectId: effect.effectId,
        acceptedAtEpochMs,
      };
      await transaction.insertReceipt(receipt);
      return { status: 201, bytes: receiptBytes, replayed: false };
    });
  }

  async status({ pathOperationId, authorization, credentialEpoch }) {
    if (!/^[A-Za-z0-9._~-]{1,160}$/.test(pathOperationId)) {
      throw new NativeOperationError(400, 'OPERATION_ID_INVALID', 'Operation identity is invalid.');
    }
    return this.repository.transaction(async transaction => {
      const actor = await transaction.authenticateDevice({
        authorization,
        credentialEpoch,
        operationId: pathOperationId,
      });
      if (!actor) throw new NativeOperationError(403, 'AUTHORIZATION_REJECTED', 'This phone is not authorized.');
      const receipt = await transaction.getReceiptForUpdate(pathOperationId);
      if (!receipt) return { status: 404, bytes: Buffer.from('{"error":"NOT_FOUND"}', 'utf8'), replayed: false };
      return { status: 200, bytes: Buffer.from(receipt.receiptBytes), replayed: true };
    });
  }

  #replay(existing, operation) {
    if (existing.payloadSha256 !== operation.payloadSha256 || existing.operationType !== operation.operationType) {
      throw new NativeOperationError(409, 'OPERATION_ID_CONFLICT', 'A different operation already uses this identity.');
    }
    if (!Buffer.from(existing.rawRequestBytes).equals(operation.rawBody)) {
      throw new NativeOperationError(409, 'OPERATION_BYTES_CONFLICT', 'A different request already uses this operation identity.');
    }
    return { status: 200, bytes: Buffer.from(existing.receiptBytes), replayed: true };
  }
}
