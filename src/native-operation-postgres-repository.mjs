import { NativeOperationError } from './native-operation-contract.mjs';

function requireMethod(value, name) {
  if (!value || typeof value[name] !== 'function') throw new TypeError(`${name} is required`);
}

export class PostgresNativeOperationRepository {
  constructor({ pool, authenticateDevice, applyOperation }) {
    requireMethod(pool, 'connect');
    if (typeof authenticateDevice !== 'function') throw new TypeError('authenticateDevice is required');
    if (typeof applyOperation !== 'function') throw new TypeError('applyOperation is required');
    this.pool = pool;
    this.authenticateDeviceFn = authenticateDevice;
    this.applyOperationFn = applyOperation;
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('begin isolation level serializable');
      const transaction = new PostgresNativeOperationTransaction({
        client,
        authenticateDevice: this.authenticateDeviceFn,
        applyOperation: this.applyOperationFn,
      });
      const result = await callback(transaction);
      await client.query('commit');
      return result;
    } catch (error) {
      try { await client.query('rollback'); } catch { /* original error controls */ }
      throw mapPostgresConflict(error);
    } finally {
      client.release();
    }
  }
}

class PostgresNativeOperationTransaction {
  constructor({ client, authenticateDevice, applyOperation }) {
    this.client = client;
    this.authenticateDeviceFn = authenticateDevice;
    this.applyOperationFn = applyOperation;
    this.lockedOperationIds = new Set();
  }

  async getReceiptForUpdate(operationId) {
    await this.#lockOperation(operationId);
    const result = await this.client.query({
      name: 'native-operation-receipt-by-id',
      text: `
        select operation_id, operation_type, payload_sha256, raw_request_bytes,
               receipt_bytes, receipt_sha256, canonical_server_digest,
               server_effect_id, employee_id, device_id, credential_epoch,
               accepted_at_epoch_ms
          from public.native_operation_receipts
         where operation_id = $1
         for update
      `,
      values: [operationId],
    });
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  async authenticateDevice(request) {
    return this.authenticateDeviceFn({ client: this.client, ...request });
  }

  async applyOperation(request) {
    return this.applyOperationFn({ client: this.client, ...request });
  }

  async insertReceipt(receipt) {
    const actor = receipt.actor;
    if (!actor?.employeeId || !actor?.deviceId) {
      throw new Error('Receipt insertion requires authenticated employee and device identity.');
    }
    await this.#lockOperation(receipt.operationId);
    await this.client.query({
      name: 'native-operation-receipt-insert',
      text: `
        insert into public.native_operation_receipts (
          operation_id, operation_type, payload_sha256, raw_request_bytes,
          receipt_bytes, receipt_sha256, canonical_server_digest,
          server_effect_id, employee_id, device_id, credential_epoch,
          accepted_at_epoch_ms
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `,
      values: [
        receipt.operationId,
        receipt.operationType,
        receipt.payloadSha256,
        Buffer.from(receipt.rawRequestBytes),
        Buffer.from(receipt.receiptBytes),
        receipt.receiptSha256,
        receipt.canonicalServerDigest,
        receipt.effectId,
        actor.employeeId,
        actor.deviceId,
        receipt.credentialEpoch,
        receipt.acceptedAtEpochMs,
      ],
    });
  }

  async #lockOperation(operationId) {
    if (this.lockedOperationIds.has(operationId)) return;
    await this.client.query({
      name: 'native-operation-advisory-lock',
      text: 'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      values: [operationId],
    });
    this.lockedOperationIds.add(operationId);
  }
}

function fromRow(row) {
  return {
    operationId: row.operation_id,
    operationType: row.operation_type,
    payloadSha256: row.payload_sha256,
    rawRequestBytes: Buffer.from(row.raw_request_bytes),
    receiptBytes: Buffer.from(row.receipt_bytes),
    receiptSha256: row.receipt_sha256,
    canonicalServerDigest: row.canonical_server_digest,
    effectId: row.server_effect_id,
    actor: { employeeId: row.employee_id, deviceId: row.device_id },
    credentialEpoch: Number(row.credential_epoch),
    acceptedAtEpochMs: Number(row.accepted_at_epoch_ms),
  };
}

function mapPostgresConflict(error) {
  if (error instanceof NativeOperationError) return error;
  if (error?.code === '23505') {
    return new NativeOperationError(409, 'OPERATION_CONFLICT', 'The operation already exists with a different canonical effect.');
  }
  if (error?.code === '40001' || error?.code === '40P01') {
    return new NativeOperationError(503, 'OPERATION_RETRY_REQUIRED', 'The operation was safely rolled back and may be retried.');
  }
  return error;
}
