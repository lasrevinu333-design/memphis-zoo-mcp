import { createHmac, timingSafeEqual } from "node:crypto";

export const GUEST_ISSUE_TYPES = new Set([
  "Trash overflowing",
  "Restroom needs cleaning",
  "Spill or wet floor",
  "Odor issue",
  "Supplies empty",
  "General cleanliness concern",
]);

export const FEEDBACK_CATEGORIES = new Set([
  "app_problem",
  "schedule_wrong",
  "location_or_nfc",
  "device_problem",
  "memphis_bad_answer",
  "improvement_idea",
  "need_help",
  "other",
]);

function text(value, { name, maximum, required = false } = {}) {
  const normalized = String(value ?? "").trim();
  if (required && !normalized) throw Object.assign(new Error(`${name} is required.`), { status: 422 });
  if (normalized.length > maximum) throw Object.assign(new Error(`${name} must be ${maximum} characters or fewer.`), { status: 422 });
  return normalized || null;
}

function oneOf(value, allowed, { name, fallback = null } = {}) {
  const normalized = String(value ?? fallback ?? "").trim().toLowerCase();
  if (!allowed.has(normalized)) throw Object.assign(new Error(`${name} is invalid.`), { status: 422 });
  return normalized;
}

export function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

export function guestFeatureState(env = process.env) {
  const enabled = truthy(env.GUEST_ISSUES_FEATURE_APPROVED);
  return {
    enabled,
    approval_state: enabled ? "approved" : "awaiting_zoo_approval",
    qr_rollout_ready: enabled,
    marketing_review_required: true,
    dispatch_after_marketing_approval: ["operations_managers", "current_location_custodian"],
  };
}

export function normalizeGuestReportInput(payload = {}) {
  const issueType = text(payload.issue_type ?? payload.issue, { name: "issue_type", maximum: 160, required: true });
  if (!GUEST_ISSUE_TYPES.has(issueType)) throw Object.assign(new Error("issue_type is invalid."), { status: 422 });
  const severity = oneOf(payload.severity, new Set(["normal", "high", "urgent"]), { name: "severity", fallback: "normal" });
  const email = text(payload.guest_email ?? payload.email, { name: "guest_email", maximum: 320 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("guest_email is invalid."), { status: 422 });
  return {
    locationCode: text(payload.location_code ?? payload.code, { name: "location_code", maximum: 64, required: true }).toUpperCase(),
    issueType,
    severity,
    notes: text(payload.notes, { name: "notes", maximum: 2000 }),
    reporter: {
      name: text(payload.guest_name ?? payload.name, { name: "guest_name", maximum: 160 }),
      phone: text(payload.guest_phone ?? payload.phone, { name: "guest_phone", maximum: 40 }),
      email: email?.toLowerCase() || null,
    },
  };
}

export function normalizeFeedbackInput(payload = {}) {
  const category = oneOf(payload.category, FEEDBACK_CATEGORIES, { name: "category", fallback: "other" });
  const priority = oneOf(payload.priority, new Set(["low", "normal", "high", "urgent"]), { name: "priority", fallback: "normal" });
  return {
    category,
    priority,
    message: text(payload.message ?? payload.body, { name: "message", maximum: 12000, required: true }),
    submittedBy: text(payload.submitted_by ?? payload.name, { name: "submitted_by", maximum: 160 }),
    hubContext: text(payload.hub_context ?? payload.hub ?? "unknown", { name: "hub_context", maximum: 80, required: true }).toLowerCase(),
    deviceId: text(payload.device_id ?? payload.device, { name: "device_id", maximum: 160 }),
    pageUrl: text(payload.page_url ?? payload.url, { name: "page_url", maximum: 1000 }),
  };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signExpiringFeedbackToken({ secret, feedbackId, purpose, now = Date.now(), ttlMs = 7 * 24 * 60 * 60 * 1000 }) {
  const id = String(feedbackId || "").trim();
  if (!secret || !id || !purpose) return "";
  const issuedAt = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({
    v: 2,
    purpose,
    feedback_id: id,
    iat: issuedAt,
    exp: issuedAt + Math.max(60, Math.floor(ttlMs / 1000)),
  }), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyExpiringFeedbackToken({ secret, token, feedbackId, purpose, now = Date.now() }) {
  const [payload, signature, extra] = String(token || "").trim().split(".");
  if (!secret || !payload || !signature || extra !== undefined) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const nowSeconds = Math.floor(now / 1000);
    return decoded?.v === 2
      && decoded?.purpose === purpose
      && String(decoded?.feedback_id || "") === String(feedbackId || "")
      && Number.isInteger(decoded?.iat)
      && Number.isInteger(decoded?.exp)
      && decoded.exp >= nowSeconds
      && decoded.iat <= nowSeconds + 60;
  } catch {
    return false;
  }
}
