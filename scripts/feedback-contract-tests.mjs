import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const apiSource = readFileSync(resolve(repoRoot, "src/index.js"), "utf8");
const reliabilityMigration = readFileSync(resolve(repoRoot, "supabase/migrations/20260718103215_custodial_v3_reliability_and_retention.sql"), "utf8");
const engineRoot = [process.env.ENGINE_FIXTURE_ROOT, resolve(repoRoot, "../frontend"), resolve(repoRoot, "../Engine")]
  .filter(Boolean)
  .find((candidate) => existsSync(resolve(candidate, "system-feedback.html")));
const feedbackHtml = engineRoot ? readFileSync(resolve(engineRoot, "system-feedback.html"), "utf8") : "";

function assertContains(source, needle, message) {
  assert.ok(source.includes(needle), message || `Expected source to include ${needle}`);
}

function assertMatches(source, pattern, message) {
  assert.match(source, pattern, message);
}

// Frontend: owner deferred NEW Feedback photos. Preserve read-only historical
// attachment visibility without exposing capture or upload on either page.
// The backend contract suite remains independently runnable in CI; Engine owns
// its complete frontend regression gate.
if (feedbackHtml) {
  assert.doesNotMatch(feedbackHtml, /type=["']file["']|readAsDataURL|Add Image|capture=["']/i, "manager feedback must not offer new photo acquisition");
  assertContains(feedbackHtml, "row.metadata_json?.image_attachment", "historical protected feedback images remain visible to authorized managers");
  const employeePath = resolve(engineRoot, "employee-feedback.html");
  if (existsSync(employeePath)) {
    const employeeHtml = readFileSync(employeePath, "utf8");
    assert.doesNotMatch(employeeHtml, /type=["']file["']|readAsDataURL|Add Image|capture=["']/i, "employee feedback must be text-only");
    assertContains(employeeHtml, "historical attachments", "protected employee feedback outbox history remains retained");
    assert.ok(!employeeHtml.includes("new FormData"), "employee feedback submit must not send unsupported multipart form data");
  }
}

// Backend: retain legacy image validation/private-storage/recovery and
// authorized retrieval for historical records; this does not enable new UI
// capture in the current program.
assertContains(apiSource, "validateSystemFeedbackImageAttachment", "backend should validate optional feedback image attachments");
assertContains(apiSource, "persistedSystemFeedbackImageMetadata", "backend should exclude internal upload state from persisted metadata");
assertContains(apiSource, "removeUnreferencedSystemFeedbackImage", "backend should clean a newly uploaded object when database persistence fails");
assertContains(apiSource, "feedback_image_migration", "backend should migrate retained legacy inline images through the durable worker");
assertContains(reliabilityMigration, "system_feedback_legacy_image_backups", "migration should preserve exact legacy metadata before removing inline image data");
assertContains(reliabilityMigration, "feedback-image-migration:", "migration should enqueue an idempotent private-storage migration job");
assertMatches(apiSource, /feedback-api\/image\/:feedbackId/, "backend should expose a feedback image retrieval endpoint");

// OC24-09 selects a fixed-recipient email relay; persistence and actual email
// evidence are separate. The existing no-Messenger requirement is unchanged.
assertContains(apiSource, "last_feedback_reminder_at", "schema may retain legacy reminder timestamp for compatibility");
assertContains(apiSource, "feedback_reminder_count", "schema may retain legacy reminder count for compatibility");
assertMatches(apiSource, /feedback-api\/acknowledge\/:feedbackId/, "backend should expose an acknowledgement endpoint");
assertMatches(apiSource, /dashboard-api\/system-feedback\/:feedbackId\/status/, "backend should expose manager feedback triage actions");
assertMatches(
  apiSource,
  /async function acknowledgeSystemFeedbackItem[\s\S]*?runOperationalCommand\("feedback_status",\s*\{[\s\S]*?status:\s*"acknowledged"/,
  "acknowledgement should use the canonical operational command to mark the item as acknowledged",
);
const feedbackSubmitBlock = apiSource.slice(apiSource.indexOf('app.post("/feedback-api/submit"'), apiSource.indexOf('app.get("/guest-api/locations'));
assert.ok(feedbackSubmitBlock.includes("attachFeedbackDelivery([item]"), "feedback submit must read the exact persisted item's email evidence");
assert.ok(feedbackSubmitBlock.includes("email_delivery: deliveryItem.email_delivery"), "mail evidence must remain separate from persistence/triage");
assert.ok(!feedbackSubmitBlock.includes('runOperationalCommand("feedback_dashboard_only"'), "submit must not overwrite real email handling with historical dashboard-only status");
assert.ok(!/notifySystemFeedbackRecipients\s*\(/.test(feedbackSubmitBlock), "feedback submit must not notify ops managers in Messenger");
assert.ok(!/msg_send_message/.test(feedbackSubmitBlock), "feedback submit must not send Messenger messages");
const feedbackReminderBlock = apiSource.slice(apiSource.indexOf("async function runSystemFeedbackReminderSweep"), apiSource.indexOf("async function runPublicDashboardSummary"));
assert.ok(feedbackReminderBlock.includes("dashboard_only"), "feedback reminder sweep should be dashboard-only");
assert.ok(!/notifySystemFeedbackRecipients\s*\(/.test(feedbackReminderBlock), "feedback reminder sweep must not notify ops managers in Messenger");
assert.ok(!/msg_send_message/.test(feedbackReminderBlock), "feedback reminder sweep must not send Messenger messages");

console.log("feedback contract tests passed");
