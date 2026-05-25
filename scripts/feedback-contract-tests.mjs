import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const apiSource = readFileSync(resolve(repoRoot, "src/index.js"), "utf8");
const feedbackHtml = readFileSync(resolve(repoRoot, "../Engine/system-feedback.html"), "utf8");

function assertContains(source, needle, message) {
  assert.ok(source.includes(needle), message || `Expected source to include ${needle}`);
}

function assertMatches(source, pattern, message) {
  assert.match(source, pattern, message);
}

// Frontend: custodial program feedback must allow an optional image attachment.
assertMatches(feedbackHtml, /type=["']file["'][^>]+accept=["']image\//i, "feedback form should expose an image-only file input");
assertMatches(feedbackHtml, /Import image/i, "feedback form should label the upload action as Import image");
assertContains(feedbackHtml, "image_attachment", "feedback submit payload should include optional image_attachment");
assertContains(feedbackHtml, "readAsDataURL", "feedback image upload should encode the selected image for JSON submit");

// Backend: image attachment must be validated, persisted in metadata, and retrievable.
assertContains(apiSource, "validateSystemFeedbackImageAttachment", "backend should validate optional feedback image attachments");
assertContains(apiSource, "image_attachment", "backend should persist image attachment metadata/data");
assertMatches(apiSource, /feedback-api\/image\/:feedbackId/, "backend should expose a feedback image retrieval endpoint");

// Backend: feedback should keep reminding ops every 10 minutes until acknowledgement.
assertContains(apiSource, "last_feedback_reminder_at", "schema should track the last feedback reminder timestamp");
assertContains(apiSource, "feedback_reminder_count", "schema should track repeated feedback reminder count");
assertMatches(apiSource, /interval\s+'10 minutes'/i, "reminder sweep should use a 10 minute cadence per unacknowledged item");
assertContains(apiSource, "runSystemFeedbackReminderSweep", "backend should run a reminder sweep for unacknowledged feedback");
assertMatches(apiSource, /feedback-api\/acknowledge\/:feedbackId/, "backend should expose an acknowledgement endpoint");
assertMatches(apiSource, /status\s*=\s*'acknowledged'/i, "acknowledgement should mark the feedback item as acknowledged");

console.log("feedback contract tests passed");
