import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  guestFeatureState,
  normalizeFeedbackInput,
  normalizeGuestReportInput,
  signExpiringFeedbackToken,
  verifyExpiringFeedbackToken,
} from "../src/public-submission-controls.js";

const root = resolve(import.meta.dirname, "..");
const api = readFileSync(resolve(root, "src/index.js"), "utf8");
const migration = readFileSync(resolve(root, "supabase/migrations/20260729225858_audit5_feedback_guest_approval_lifecycle.sql"), "utf8");

assert.deepEqual(guestFeatureState({}).enabled, false, "guest reporting must default off until zoo approval");
assert.deepEqual(guestFeatureState({ GUEST_ISSUES_FEATURE_APPROVED: "true" }).enabled, true);
assert.deepEqual(guestFeatureState({}).dispatch_after_marketing_approval, ["operations_managers", "current_location_custodian"]);

assert.equal(normalizeGuestReportInput({ location_code: " tetm ", issue_type: "Spill or wet floor" }).locationCode, "TETM");
assert.throws(() => normalizeGuestReportInput({ location_code: "TETM", issue_type: "anything" }), /issue_type is invalid/);
assert.throws(() => normalizeGuestReportInput({ location_code: "TETM", issue_type: "Spill or wet floor", notes: "x".repeat(2001) }), /2000/);
assert.throws(() => normalizeGuestReportInput({ location_code: "TETM", issue_type: "Spill or wet floor", guest_email: "not-email" }), /guest_email is invalid/);
assert.equal(normalizeFeedbackInput({ category: "app_problem", message: "hello" }).priority, "normal");
assert.throws(() => normalizeFeedbackInput({ category: "not-real", message: "hello" }), /category is invalid/);
assert.throws(() => normalizeFeedbackInput({ category: "app_problem", message: "x".repeat(12001) }), /12000/);

const now = Date.UTC(2026, 6, 29, 12, 0, 0);
const token = signExpiringFeedbackToken({ secret: "test-secret", feedbackId: "feedback-id", purpose: "ack", now, ttlMs: 60_000 });
assert.equal(verifyExpiringFeedbackToken({ secret: "test-secret", token, feedbackId: "feedback-id", purpose: "ack", now: now + 59_000 }), true);
assert.equal(verifyExpiringFeedbackToken({ secret: "test-secret", token, feedbackId: "feedback-id", purpose: "ack", now: now + 61_000 }), false);
assert.equal(verifyExpiringFeedbackToken({ secret: "test-secret", token, feedbackId: "feedback-id", purpose: "image", now }), false);

assert.match(api, /app\.get\("\/guest-api\/status"/);
assert.match(api, /app\.post\("\/guest-api\/report-cleanliness", requireGuestIssuesApproved, publicSubmissionRateLimit\("guest"\)/);
assert.match(api, /app\.post\("\/feedback-api\/submit", publicSubmissionRateLimit\("feedback"\)/);
assert.match(api, /public_submission_rate_limits/);
assert.doesNotMatch(api, /const rateLimitBuckets = new Map/);
assert.match(api, /\/marketing-api\/guest-cleanliness-issues/);
assert.match(api, /GUEST_MARKETING_REVIEW_SECRET/);
assert.match(api, /marketingReviewStatus: "approved"/);

const getAck = api.slice(api.indexOf('app.get("/feedback-api/acknowledge/:feedbackId"'), api.indexOf('app.post("/feedback-api/acknowledge/:feedbackId"'));
assert.match(getAck, /Confirm acknowledgement/);
assert.doesNotMatch(getAck, /acknowledgeSystemFeedbackItem/);
const postAck = api.slice(api.indexOf('app.post("/feedback-api/acknowledge/:feedbackId"'), api.indexOf('app.post("/feedback-api/reminders/run"'));
assert.match(postAck, /confirmed_signed_feedback_link/);
assert.doesNotMatch(postAck, /req\.query\.by|req\.body\?\.by/);
assert.match(api, /dashboard-api\/system-feedback\/:feedbackId\/status/);

for (const required of [
  "guest_issues_feature_approved",
  "marketing_review_status",
  "trg_redact_guest_report_contact_on_terminal",
  "redact_stale_guest_report_contact",
  "mz-guest-contact-retention-daily",
  "public_submission_rate_limits",
  "force row level security",
  "mz-public-submission-rate-limit-cleanup-hourly",
  "system_feedback_items_message_length_check",
]) assert.ok(migration.includes(required), `migration should include ${required}`);
assert.match(migration, /revoke all on table public\.public_submission_rate_limits from public,anon,authenticated/);

console.log("audit 5 feedback and guest contract tests passed");
