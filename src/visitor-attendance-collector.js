import { createHash, timingSafeEqual } from "node:crypto";
import { ATTENDANCE_DEFAULT_STALE_AFTER_MS, toNullableNonNegativeInteger } from "./attendance-state.js";

const metrics = ["attendance", "last_year", "planned", "yesterday", "yesterday_plan"];
const digest = value => createHash("sha256").update(value).digest();

// The unattended visitor-count collector has no manager, schedule or employee authority.
export function makeVisitorAttendanceCollectorHandler({ env = process.env, persist, accepted = () => {}, now = Date.now }) {
  if (typeof persist !== "function") throw new Error("attendance persistence is required");
  return async (req, res) => {
    const expected = String(env.ATTENDANCE_COLLECTOR_TOKEN || "").trim();
    if (expected.length < 32) return res.status(503).json({ ok: false, error: "Visitor attendance collector is not configured." });
    const header = String(req.get?.("authorization") || "");
    const supplied = /^Bearer ([^\s]+)$/i.exec(header)?.[1] || "";
    if (!supplied || !timingSafeEqual(digest(supplied), digest(expected))) {
      return res.status(401).json({ ok: false, error: "Visitor attendance collector authentication required." });
    }
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return res.status(422).json({ ok: false, error: "Attendance payload must be an object." });
    const payload = {};
    for (const field of metrics) {
      const value = toNullableNonNegativeInteger(body[field]);
      if ((field === "attendance" && value == null) || (body[field] != null && body[field] !== "" && value == null) || value > 2147483647) {
        return res.status(422).json({ ok: false, error: field + " must be a nonnegative database integer." });
      }
      payload[field] = value;
    }
    const fetched = typeof body.fetched_at === "string" ? Date.parse(body.fetched_at) : NaN;
    const age = now() - fetched;
    if (!Number.isFinite(fetched) || age < -60000 || age > ATTENDANCE_DEFAULT_STALE_AFTER_MS) {
      return res.status(422).json({ ok: false, error: "A valid current source timestamp is required." });
    }
    payload.fetched_at = new Date(fetched).toISOString();
    payload.source = "home-browser-auto-push";
    try {
      const data = await persist(payload);
      if (!data || metrics.some(field => data[field] !== payload[field])
        || data.source !== payload.source || Date.parse(data.fetched_at) !== fetched) {
        return res.status(503).json({ ok: false, error: "Visitor attendance has not been verified in the saved reader." });
      }
      accepted();
      return res.status(200).json({ ok: true, data });
    } catch {
      return res.status(503).json({ ok: false, error: "Visitor attendance could not be saved." });
    }
  };
}
