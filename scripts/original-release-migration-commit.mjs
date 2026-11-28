import { closeSync, fsyncSync, mkdtempSync, openSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function readOriginalMigrationCommitStatus(query, transactionId) {
  if (typeof transactionId !== "string" || !/^[1-9][0-9]{0,19}$/.test(transactionId)
      || BigInt(transactionId) > 18446744073709551615n) {
    throw new Error("An exact original PostgreSQL transaction ID is required.");
  }
  const result = await query("select pg_catalog.pg_xact_status($1::pg_catalog.xid8) as status", [transactionId]);
  const status = result.rowCount === 1 ? result.rows[0]?.status : null;
  if (status === "committed") return "COMMITTED";
  if (status === "aborted") return "ROLLED_BACK";
  return "UNRESOLVED";
}

// pg rejects the pending query and also emits an error on the Client. Keep the
// listener installed through end(), including late errors after a deadline.
const transportFailures = new WeakMap();
export function watchMigrationTransport(client) {
  if (!transportFailures.has(client)) {
    const failure = new AbortController();
    transportFailures.set(client, failure);
    client.on?.("error", error => failure.abort(error));
  }
  return transportFailures.get(client).signal;
}

function receiptPrefix(attempt) {
  return attempt.schema === "custodial.current429-original-migration-commit.v1" ? "current429" : "build52";
}

export function writePrivateReceipt(directory, name, receipt) {
  writeFileSync(join(directory, name), JSON.stringify(receipt, null, 2) + "\n",
    { flag: "wx", mode: 0o600, flush: true });
  const dir = openSync(directory, "r");
  try { fsyncSync(dir); } finally { closeSync(dir); }
}

export function prepareOriginalMigrationReceipt(attempt, directory) {
  directory ||= mkdtempSync(join(tmpdir(), "custodial-original-migration-"));
  writePrivateReceipt(directory, `${receiptPrefix(attempt)}-production-migration-commit-attempt.json`,
    { ...attempt, phase: "PREPARED_FOR_COMMIT" });
  return directory;
}

export async function withConnectionDeadline(client, operation, timeoutMs, transport) {
  const controller = new AbortController();
  let clock;
  const deadline = new Promise((_, reject) => {
    clock = setTimeout(() => {
      controller.abort();
      reject(new Error("Original migration connection deadline exceeded."));
      // The pg client owns this socket. A transport that never receives another
      // packet must not keep the operator process waiting after its deadline.
      client.connection?.stream?.destroy();
    }, timeoutMs);
  });
  let disconnect;
  try {
    transport?.throwIfAborted();
    const pending = [deadline];
    if (transport) pending.push(new Promise((_, reject) => {
      disconnect = () => { controller.abort(); reject(transport.reason); };
      transport.addEventListener("abort", disconnect, { once: true });
    }));
    pending.push(operation(controller.signal));
    return await Promise.race(pending);
  } finally {
    clearTimeout(clock);
    if (disconnect) transport.removeEventListener("abort", disconnect);
  }
}

// One submission. A client-side deadline also fires when the transport never settles.
export async function submitOriginalMigrationCommit(client, timeoutMs = 10_000) {
  const reply = await withConnectionDeadline(client, () => client.query("commit"), timeoutMs, watchMigrationTransport(client));
  if (reply?.command !== "COMMIT") throw new Error("Original migration COMMIT was not acknowledged.");
  return reply;
}

export async function observeUnacknowledgedMigration({
  attempt, directory, original, observer, assertIdentity, report = value => console.error(JSON.stringify(value)),
  timeoutMs = 10_000,
}) {
  const initial = { ...attempt, original_transaction_readback: "UNRESOLVED" };
  report(initial);
  const closing = withConnectionDeadline(original, () => original.end(), timeoutMs).catch(() => {});
  let readback = "UNRESOLVED";
  try {
    readback = await withConnectionDeadline(observer, async signal => {
      await observer.connect();
      signal.throwIfAborted();
      await assertIdentity(observer, { migrationAuthority: true });
      signal.throwIfAborted();
      return readOriginalMigrationCommitStatus((query, values) => observer.query(query, values), attempt.postgres_transaction_id);
    }, timeoutMs, watchMigrationTransport(observer));
  } catch {
    // An unavailable observer cannot decide whether the original committed.
  }
  try {
    const receipt = { ...attempt, original_transaction_readback: readback };
    report(receipt);
    writePrivateReceipt(directory, `${receiptPrefix(attempt)}-production-migration-commit-unknown.json`, receipt);
  } finally {
    await Promise.all([closing, withConnectionDeadline(observer, () => observer.end(), timeoutMs).catch(() => {})]);
  }
  return readback;
}
