import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
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
const recoveryFenceMigration = readFileSync(resolve(root, "supabase/migrations/20260827150000_disaster_recovery_global_mutation_fence.sql"), "utf8");

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
assert.match(api, /guest_reports: GUEST_REPORTS_CONTRACT_VERSION/);
assert.match(api, /app\.post\("\/guest-api\/report-cleanliness", requireGuestIssuesApproved, publicSubmissionRateLimit\("guest"\)/);
assert.match(api, /app\.post\("\/feedback-api\/submit", publicSubmissionRateLimit\("feedback"\)/);
function inspectPublicRateLimiter(apiSource) {
  const publicRateLimiterStart = apiSource.indexOf("function publicSubmissionRateLimit");
  const publicRateLimiterEnd = apiSource.indexOf("// Purge stale rate limit buckets periodically");
  assert.ok(publicRateLimiterStart >= 0 && publicRateLimiterEnd > publicRateLimiterStart, "the public submission limiter must remain inspectable");
  assert.doesNotMatch(
    apiSource,
    /\bfrom\s+(?:"?public"?\s*\.\s*)?"?public_submission_rate_limits"?\b/i,
    "application runtime source must not directly read the FORCE-RLS public submission bucket table",
  );
  const source = apiSource.slice(publicRateLimiterStart, publicRateLimiterEnd);
  assert.match(source, /runOperationalCommand\("public_rate_limit"/);
  assert.match(source, /public\.app_get_public_rate_limit_count/);
  return source;
}

async function exercisePublicRateLimiter(limiterSource, { requestCount, expectedStatus = null, expectedNextCount } = {}) {
  const commands = [];
  const reads = [];
  const responses = [];
  let nextCount = 0;
  const buildLimiter = Function(
    "createHmac",
    "getFeedbackLinkSecret",
    "runOperationalCommand",
    "runReadOnlySql",
    "sqlLiteral",
    `"use strict"; const RATE_LIMIT_MAX = 10; ${limiterSource}; return publicSubmissionRateLimit;`,
  );
  const publicSubmissionRateLimit = buildLimiter(
    createHmac,
    () => "audit5-public-rate-secret",
    async (name, payload) => { commands.push({ name, payload }); },
    async (sql) => { reads.push(sql); return [{ request_count: requestCount }]; },
    (value) => `'${String(value).replaceAll("'", "''")}'`,
  );
  const response = {
    setHeader(name, value) { responses.push({ type: "header", name, value }); },
    status(value) { responses.push({ type: "status", value }); return this; },
    json(value) { responses.push({ type: "json", value }); return this; },
  };
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await publicSubmissionRateLimit("feedback")(
      { ip: "192.0.2.5", socket: {} },
      response,
      () => { nextCount += 1; },
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
  assert.equal(nextCount, expectedNextCount);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, "public_rate_limit");
  assert.equal(reads.length, 1, "the limiter must have exactly one count reader");
  assert.match(reads[0], /^\s*select public\.app_get_public_rate_limit_count\('[0-9a-f]{64}','feedback'\) as request_count\s*$/);
  assert.doesNotMatch(reads[0], /public_submission_rate_limits/i);
  if (expectedStatus === null) {
    assert.deepEqual(responses, []);
  } else {
    assert.deepEqual(responses, [
      { type: "header", name: "Retry-After", value: "60" },
      { type: "status", value: expectedStatus },
      { type: "json", value: { ok: false, error: "Rate limit exceeded. Try again in a minute." } },
    ]);
  }
}

const publicRateLimiter = inspectPublicRateLimiter(api);
await exercisePublicRateLimiter(publicRateLimiter, { requestCount: 1, expectedNextCount: 1 });
await exercisePublicRateLimiter(publicRateLimiter, { requestCount: 10, expectedNextCount: 1 });
await exercisePublicRateLimiter(publicRateLimiter, { requestCount: 11, expectedStatus: 429, expectedNextCount: 0 });
const directHelperMutant = api.replace(
  "function publicSubmissionRateLimit",
  "async function directRateBucketRead(runReadOnlySql) { return runReadOnlySql(`select request_count FROM public.public_submission_rate_limits`); }\nfunction publicSubmissionRateLimit",
);
assert.notEqual(directHelperMutant, api);
assert.throws(() => inspectPublicRateLimiter(directHelperMutant), /must not directly read/);
const uppercaseDirectReadMutant = api.replace(
  "`select public.app_get_public_rate_limit_count(${sqlLiteral(bucketKey)},${sqlLiteral(scope)}) as request_count`",
  "`select request_count FROM public.public_submission_rate_limits where bucket_key=${sqlLiteral(bucketKey)}`",
);
assert.notEqual(uppercaseDirectReadMutant, api);
assert.throws(() => inspectPublicRateLimiter(uppercaseDirectReadMutant), /must not directly read/);
const productionOnlyDirectReadMutant = publicRateLimiter.replace(
  "const rows = await runReadOnlySql(\n        `select public.app_get_public_rate_limit_count(${sqlLiteral(bucketKey)},${sqlLiteral(scope)}) as request_count`\n      );",
  `const countSql = process.env.NODE_ENV === "production"
        ? \`select request_count FROM public.\${"public_submission_" + "rate_limits"} where bucket_key=\${sqlLiteral(bucketKey)} and scope=\${sqlLiteral(scope)}\`
        : \`select public.app_get_public_rate_limit_count(\${sqlLiteral(bucketKey)},\${sqlLiteral(scope)}) as request_count\`;
      const rows = await runReadOnlySql(countSql);`,
);
assert.notEqual(productionOnlyDirectReadMutant, publicRateLimiter);
await assert.rejects(
  () => exercisePublicRateLimiter(productionOnlyDirectReadMutant, { requestCount: 1, expectedNextCount: 1 }),
  /app_get_public_rate_limit_count/,
);
const constantCountMutant = publicRateLimiter.replace(
  "const count = Number(rows?.[0]?.request_count);",
  "const count = 1;",
);
assert.notEqual(constantCountMutant, publicRateLimiter);
await assert.rejects(
  () => exercisePublicRateLimiter(constantCountMutant, { requestCount: 11, expectedStatus: 429, expectedNextCount: 0 }),
);
const inclusiveThresholdMutant = publicRateLimiter.replace(
  "count > RATE_LIMIT_MAX",
  "count >= RATE_LIMIT_MAX",
);
assert.notEqual(inclusiveThresholdMutant, publicRateLimiter);
await assert.rejects(
  () => exercisePublicRateLimiter(inclusiveThresholdMutant, { requestCount: 10, expectedNextCount: 1 }),
);
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
assert.match(recoveryFenceMigration, /create or replace function public\.app_get_public_rate_limit_count/);
assert.match(recoveryFenceMigration, /where bucket_key=p_bucket_key and scope=btrim\(p_scope\)/);
assert.match(recoveryFenceMigration, /revoke all on function public\.app_get_public_rate_limit_count\(text,text\) from public,anon,authenticated,service_role/);
assert.match(recoveryFenceMigration, /grant execute on function public\.app_get_public_rate_limit_count\(text,text\) to custodial_application_reader/);

console.log("audit 5 feedback and guest contract tests passed");
