// Private, authenticated-parent-to-operation-child contract. Neither bearer
// credentials nor a manager supplied through HTTP belong in this envelope.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_INPUT_BYTES = 64 * 1024;
// The retained full recurring compiler result is 22,739,579 bytes. A 2 MiB
// IPC limit would silently reject a legitimate complete preview; keep a
// finite envelope above that witnessed size without truncating proof fields.
const MAX_RESULT_BYTES = 32 * 1024 * 1024;

function invalid() { throw Object.assign(new Error("The private recurring-operation envelope is invalid."), {
  code: "static_weekly_operation_protocol_invalid",
}); }
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  return value;
}
function keys(value, expected) {
  const actual = Object.keys(object(value)).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid();
}
function uuid(value) { if (typeof value !== "string" || !UUID.test(value)) invalid(); return value; }
function digest(value) { if (typeof value !== "string" || !DIGEST.test(value)) invalid(); return value; }
function monday(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || parsed.getUTCDay() !== 1) invalid();
  return value;
}
function plainJson(value, maxBytes) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { invalid(); }
  if (typeof serialized !== "string" || Buffer.byteLength(serialized) > maxBytes) invalid();
  const copy = JSON.parse(serialized);
  if (JSON.stringify(copy) !== serialized) invalid();
  return copy;
}

export function assertClosedRecurringOperationInput(value) {
  keys(value, ["body", "kind", "manager"]);
  if (!new Set(["preview", "confirm"]).has(value.kind)) invalid();
  keys(value.manager, ["manager_display_name", "manager_id"]);
  const manager = {
    manager_id: uuid(value.manager.manager_id),
    manager_display_name: value.manager.manager_display_name,
  };
  if (typeof manager.manager_display_name !== "string" || !manager.manager_display_name.trim()
    || manager.manager_display_name.length > 200) invalid();
  const body = object(value.body);
  const required = value.kind === "preview"
    ? ["effective_start", "expected_revision"]
    : ["confirmation_key", "effective_start", "expected_revision", "preview_digest"];
  const actual = Object.keys(body);
  if (actual.some(key => ![...required, "full_nine_source_id"].includes(key))
    || required.some(key => !Object.hasOwn(body, key))) invalid();
  if (actual.length !== required.length && (actual.length !== required.length + 1
    || !Object.hasOwn(body, "full_nine_source_id"))) invalid();
  monday(body.effective_start);
  if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0) invalid();
  if (Object.hasOwn(body, "full_nine_source_id") && body.full_nine_source_id !== null) uuid(body.full_nine_source_id);
  if (value.kind === "confirm") { uuid(body.confirmation_key); digest(body.preview_digest); }
  return plainJson({ kind: value.kind, manager, body: { ...body } }, MAX_INPUT_BYTES);
}

export function assertClosedRecurringOperationReceipt(value, input) {
  const request = assertClosedRecurringOperationInput(input);
  keys(value, ["data", "kind"]);
  if (value.kind !== request.kind) invalid();
  const data = object(value.data);
  if (request.kind === "preview") {
    if (data.source !== "AUTHENTICATED_MANAGER_READBACK" || data.admitted !== false
      || data.published !== false || data.affectedPhonesUpdated !== false) invalid();
    digest(data.previewDigest);
  } else {
    if (data.state !== "ACCEPTED" || !data.receipt || typeof data.receipt !== "object") invalid();
    uuid(data.operationId);
    if (data.receipt.accepted !== true || data.receipt.operationId !== data.operationId
      || data.receipt.managerId !== request.manager.manager_id
      || data.receipt.confirmationKey !== request.body.confirmation_key
      || data.receipt.previewDigest !== request.body.preview_digest
      || data.receipt.effectiveStart !== request.body.effective_start
      || data.receipt.phoneDeliveryState !== "PENDING" || data.receipt.affectedPhonesUpdated !== false) invalid();
    for (const field of ["sourceId", "publicationId", "projectionId"]) uuid(data.receipt[field]);
    digest(data.receipt.sourceDigest);
    if (!Number.isSafeInteger(data.receipt.authorityRevision) || data.receipt.authorityRevision < 0) invalid();
  }
  return plainJson({ kind: value.kind, data }, MAX_RESULT_BYTES);
}
