import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRecurringOperationChildProtocol } from "../src/static-weekly-recurring-operation-child.js";
import { assertClosedRecurringOperationInput, assertClosedRecurringOperationReceipt } from "../src/static-weekly-recurring-operation-envelope.js";
import { recurringOperationSourceManifest, assertMatchingRecurringOperationSource } from "../src/static-weekly-recurring-operation-source.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";
const DIGEST = "a".repeat(64);
const NONCE = "b".repeat(48);
const input = { kind: "preview", manager: { manager_id: UUID, manager_display_name: "Named Manager" },
  body: { effective_start: "2026-10-05", expected_revision: 4 } };
const preview = { kind: "preview", data: { source: "AUTHENTICATED_MANAGER_READBACK", admitted: false,
  published: false, affectedPhonesUpdated: false, previewDigest: DIGEST } };
const confirmInput = { ...input, kind: "confirm", body: { ...input.body, confirmation_key: KEY, preview_digest: DIGEST } };
const confirmation = { kind: "confirm", data: { state: "ACCEPTED", operationId: KEY, receipt: {
  accepted: true, operationId: KEY, managerId: UUID, confirmationKey: KEY,
  previewDigest: DIGEST, effectiveStart: "2026-10-05", phoneDeliveryState: "PENDING",
  affectedPhonesUpdated: false, sourceId: UUID, publicationId: UUID, projectionId: UUID,
  sourceDigest: DIGEST, authorityRevision: 5,
} } };
assert.deepEqual(assertClosedRecurringOperationInput(input), input);
assert.deepEqual(assertClosedRecurringOperationReceipt(preview, input), preview);
assert.deepEqual(assertClosedRecurringOperationReceipt(confirmation, confirmInput), confirmation);
for (const hostile of [
  { ...input, token: "secret" },
  { ...input, body: { ...input.body, manager_id: UUID } },
  { ...input, manager: { ...input.manager, read_only: false } },
  { ...input, body: { ...input.body, effective_start: "2026-10-06" } },
  { ...input, body: { ...input.body, expected_revision: "4" } },
]) assert.throws(() => assertClosedRecurringOperationInput(hostile));
for (const hostile of [
  { ...confirmation, data: { ...confirmation.data, receipt: { ...confirmation.data.receipt, managerId: KEY } } },
  { ...confirmation, data: { ...confirmation.data, receipt: { ...confirmation.data.receipt, phoneDeliveryState: "DELIVERED" } } },
  { ...confirmation, data: { ...confirmation.data, receipt: { ...confirmation.data.receipt, accepted: false } } },
  { ...preview, data: { ...preview.data, published: true } },
]) assert.throws(() => assertClosedRecurringOperationReceipt(hostile, hostile.kind === "confirm" ? confirmInput : input));

const source = recurringOperationSourceManifest();
assert.equal(source.files.length > 100, true);
assert.equal(source.files.some(row => row.path === "src/static-weekly-control-plane.js"), true);
assert.equal(source.files.some(row => row.path === "src/static-weekly-recurring-operation-child.js"), true);
assert.equal(source.files.some(row => row.path === "package-lock.json"), true);
for (const row of source.files) assert.equal(createHash("sha256").update(readFileSync(new URL(`../${row.path}`, import.meta.url))).digest("hex"), row.sha256);
assert.equal(assertMatchingRecurringOperationSource(source).digest, source.digest);
assert.throws(() => assertMatchingRecurringOperationSource({ ...source, digest: "0".repeat(64) }));

function protocol({ execute = async () => preview, digest = source.digest, timer = null } = {}) {
  const messages = [];
  let closed = 0;
  let calls = 0;
  const receive = createRecurringOperationChildProtocol({
    sourceManifest: () => ({ digest }),
    execute: async (...args) => { calls++; return execute(...args); },
    send: async value => { messages.push(value); }, close: async () => { closed++; },
    ...(timer ? { setTimer: timer.set, clearTimer: timer.clear } : {}),
  });
  return { receive, messages, get closed() { return closed; }, get calls() { return calls; } };
}
const ok = protocol();
await ok.receive({ type: "init", nonce: NONCE, sourceDigest: source.digest });
assert.deepEqual(ok.messages, [{ type: "ready", nonce: NONCE, sourceDigest: source.digest }]);
await ok.receive({ type: "run", nonce: NONCE, sourceDigest: source.digest, input, remainingMilliseconds: 100 });
assert.equal(ok.calls, 1);
assert.equal(ok.closed, 1);
assert.deepEqual(ok.messages[1], { type: "result", nonce: NONCE, sourceDigest: source.digest, status: "ok", receipt: preview });
await ok.receive({ type: "run", nonce: NONCE, sourceDigest: source.digest, input, remainingMilliseconds: 100 });
assert.equal(ok.calls, 1, "late duplicate IPC cannot begin work");

for (const first of [
  { type: "init", nonce: NONCE, sourceDigest: "0".repeat(64) },
  { type: "init", nonce: "wrong", sourceDigest: source.digest },
  { type: "run", nonce: NONCE, sourceDigest: source.digest, input, remainingMilliseconds: 100 },
  { type: "cancel-before-work", nonce: NONCE, sourceDigest: source.digest },
]) {
  const bad = protocol(); await bad.receive(first);
  assert.equal(bad.closed, 1); assert.equal(bad.calls, 0); assert.equal(bad.messages.length, 0);
}
const invalid = protocol();
await invalid.receive({ type: "init", nonce: NONCE, sourceDigest: source.digest });
await invalid.receive({ type: "run", nonce: NONCE, sourceDigest: source.digest, input: { ...input, access_token: "secret" }, remainingMilliseconds: 100 });
assert.equal(invalid.calls, 0); assert.equal(invalid.closed, 1);

let sourceReads = 0, driftWork = 0, driftClosed = 0;
const drift = createRecurringOperationChildProtocol({
  sourceManifest: () => ({ digest: ++sourceReads === 1 ? source.digest : "0".repeat(64) }),
  execute: async () => { driftWork++; return preview; }, send: async () => {}, close: async () => { driftClosed++; },
});
await drift({ type: "init", nonce: NONCE, sourceDigest: source.digest });
await drift({ type: "run", nonce: NONCE, sourceDigest: source.digest, input, remainingMilliseconds: 100 });
assert.equal(driftWork, 0, "source change between readiness and work cannot begin a CP/database action");
assert.equal(driftClosed, 1);

const unknown = protocol({ execute: async () => { throw Object.assign(new Error("raw secret"), { code: "static_weekly_recurring_confirmation_outcome_unknown" }); } });
await unknown.receive({ type: "init", nonce: NONCE, sourceDigest: source.digest });
await unknown.receive({ type: "run", nonce: NONCE, sourceDigest: source.digest, input, remainingMilliseconds: 100 });
assert.deepEqual(unknown.messages[1], { type: "result", nonce: NONCE, sourceDigest: source.digest,
  status: "unknown", failureCode: "static_weekly_recurring_confirmation_outcome_unknown" });
assert.equal(JSON.stringify(unknown.messages).includes("raw secret"), false);

const cap = 32 * 1024 * 1024;
const oversizedBase = { kind: "preview", data: { ...preview.data, proof: "" } };
const oversized = { kind: "preview", data: { ...preview.data,
  proof: "x".repeat(cap - Buffer.byteLength(JSON.stringify(oversizedBase)) + 1) } };
assert.equal(Buffer.byteLength(JSON.stringify(oversized)), cap + 1, "the hostile receipt is exactly one byte above the private cap");
assert.throws(() => assertClosedRecurringOperationReceipt(oversized, input),
  "one byte beyond the finite private receipt cap refuses a truncated proof");
const tooLarge = protocol({ execute: async () => oversized });
await tooLarge.receive({ type: "init", nonce: NONCE, sourceDigest: source.digest });
await tooLarge.receive({ type: "run", nonce: NONCE, sourceDigest: source.digest, input, remainingMilliseconds: 10_000 });
assert.equal(tooLarge.closed, 1, "oversized result still closes the owned child protocol");
assert.equal(tooLarge.messages[1].status, "failed");
assert.equal(tooLarge.messages[1].receipt, undefined, "oversized source data never enters public IPC");

console.log("static-weekly recurring private child/source/envelope checks PASS");
