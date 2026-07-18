import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const apiSource = readFileSync(resolve(repoRoot, "src/index.js"), "utf8");
const reliabilityMigration = readFileSync(resolve(repoRoot, "supabase/migrations/20260718103215_custodial_v3_reliability_and_retention.sql"), "utf8");
const engineRoot = [process.env.ENGINE_FIXTURE_ROOT, resolve(repoRoot, "../Engine"), "/home/eric/Projects/memphis-zoo/Engine"]
  .filter(Boolean)
  .find((candidate) => existsSync(resolve(candidate, "system-feedback.html")));
const feedbackHtml = engineRoot ? readFileSync(resolve(engineRoot, "system-feedback.html"), "utf8") : "";

function assertContains(source, needle, message) {
  assert.ok(source.includes(needle), message || `Expected source to include ${needle}`);
}

function assertMatches(source, pattern, message) {
  assert.match(source, pattern, message);
}

// Frontend: validate the sibling Engine fixture when it is available. The backend
// contract suite remains independently runnable in CI; Engine owns its own complete
// frontend regression gate.
if (feedbackHtml) {
  assertMatches(feedbackHtml, /type=["']file["'][^>]+accept=["']image\//i, "feedback form should expose an image-only file input");
  assertMatches(feedbackHtml, /Import image/i, "feedback form should label the upload action as Import image");
  assertContains(feedbackHtml, "image_attachment", "feedback submit payload should include optional image_attachment");
  assertContains(feedbackHtml, "readAsDataURL", "feedback image upload should encode the selected image for JSON submit");
}

// Backend: image attachment must be validated, stored privately, referenced by
// metadata, recoverable from a private backup, and retrievable only through the
// authorized application route.
assertContains(apiSource, "validateSystemFeedbackImageAttachment", "backend should validate optional feedback image attachments");
assertContains(apiSource, "persistedSystemFeedbackImageMetadata", "backend should exclude internal upload state from persisted metadata");
assertContains(apiSource, "removeUnreferencedSystemFeedbackImage", "backend should clean a newly uploaded object when database persistence fails");
assertContains(apiSource, "feedback_image_migration", "backend should migrate retained legacy inline images through the durable worker");
assertContains(reliabilityMigration, "system_feedback_legacy_image_backups", "migration should preserve exact legacy metadata before removing inline image data");
assertContains(reliabilityMigration, "feedback-image-migration:", "migration should enqueue an idempotent private-storage migration job");
assertMatches(apiSource, /feedback-api\/image\/:feedbackId/, "backend should expose a feedback image retrieval endpoint");

// Backend: feedback should be dashboard-only and must not DM ops managers in Messenger.
assertContains(apiSource, "last_feedback_reminder_at", "schema may retain legacy reminder timestamp for compatibility");
assertContains(apiSource, "feedback_reminder_count", "schema may retain legacy reminder count for compatibility");
assertMatches(apiSource, /feedback-api\/acknowledge\/:feedbackId/, "backend should expose an acknowledgement endpoint");
assertMatches(apiSource, /status\s*=\s*'acknowledged'/i, "acknowledgement should mark the feedback item as acknowledged");
const feedbackSubmitBlock = apiSource.slice(apiSource.indexOf('app.post("/feedback-api/submit"'), apiSource.indexOf('app.get("/guest-api/locations'));
assert.ok(feedbackSubmitBlock.includes("dashboard_only"), "feedback submit should report dashboard-only notification handling");
assert.ok(!/notifySystemFeedbackRecipients\s*\(/.test(feedbackSubmitBlock), "feedback submit must not notify ops managers in Messenger");
assert.ok(!/msg_send_message/.test(feedbackSubmitBlock), "feedback submit must not send Messenger messages");
const feedbackReminderBlock = apiSource.slice(apiSource.indexOf("async function runSystemFeedbackReminderSweep"), apiSource.indexOf("async function runPublicDashboardSummary"));
assert.ok(feedbackReminderBlock.includes("dashboard_only"), "feedback reminder sweep should be dashboard-only");
assert.ok(!/notifySystemFeedbackRecipients\s*\(/.test(feedbackReminderBlock), "feedback reminder sweep must not notify ops managers in Messenger");
assert.ok(!/msg_send_message/.test(feedbackReminderBlock), "feedback reminder sweep must not send Messenger messages");

console.log("feedback contract tests passed");
