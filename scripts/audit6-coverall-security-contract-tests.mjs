import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import { createScheduleRouter } from "../src/schedule-api.js";

const schedule = fs.readFileSync("src/schedule-api.js", "utf8");
const index = fs.readFileSync("src/index.js", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260730142940_audit6_coverall_assignment_link_security.sql", "utf8");
const policyMigration = fs.readFileSync("supabase/migrations/20260730143853_audit6_coverall_assignment_link_service_policy.sql", "utf8");
const boundedScheduleMigration = fs.readFileSync("supabase/migrations/20260810170000_finish_offline_authority_operational_closure.sql", "utf8");

const assignmentRoute = schedule.match(/router\.get\("\/coverall\/assignment"[\s\S]*?\n  \}\);/)?.[0] || "";
const slotRead = schedule.match(/async function getCoverAllSlots\(\)[\s\S]*?\n  \}/)?.[0] || "";

assert.match(schedule, /router\.post\("\/coverall\/links", requireSchedulePin/);
assert.match(schedule, /router\.post\("\/coverall\/links\/revoke", requireSchedulePin/);
assert.match(schedule, /randomBytes\(32\)\.toString\("base64url"\)/);
assert.match(schedule, /createHash\("sha256"\).*digest\("hex"\)/);
assert.match(schedule, /ttl_hours must be between 1 and 168/);
assert.match(schedule, /revoked_at is null[\s\S]*expires_at > now\(\)/);
assert.match(schedule, /runCommand\("coverall_assignment_link_revoke"/);
assert.match(boundedScheduleMigration, /elsif v_command = 'coverall_assignment_link_revoke' then[\s\S]*set revoked_at=now\(\),revoked_by=/);
assert.match(schedule, /router\.get\("\/coverall\/assignment", limitPublicCoverAll/);
assert.match(assignmentRoute, /authorizeCoverAllAssignmentLink/);
assert.match(assignmentRoute, /setCoverAllAssignmentSecurityHeaders/);
assert.match(assignmentRoute, /Cache-Control|setCoverAllAssignmentSecurityHeaders/);
assert.match(schedule, /Content-Security-Policy/);
assert.match(schedule, /frame-ancestors 'none'/);
assert.doesNotMatch(assignmentRoute, /onclick=/);
assert.doesNotMatch(slotRead, /runWriteSql/);
assert.doesNotMatch(schedule, /async function ensureCoverAllSlots/);
assert.doesNotMatch(schedule, /assignment_url_en: coverAllPublicPath/);

assert.match(index, /app\.disable\("x-powered-by"\)/);
assert.match(index, /X-Content-Type-Options/);
assert.match(index, /Strict-Transport-Security/);
assert.match(index, /publicTrafficRateLimit: publicSubmissionRateLimit/);
assert.match(index, /coverall-assignments\.v2\.secure-links/);

assert.match(migration, /create table if not exists public\.coverall_assignment_links/i);
assert.match(migration, /token_hash text not null unique/i);
assert.match(migration, /expires_at > created_at and expires_at <= created_at \+ interval '7 days'/i);
assert.match(migration, /enable row level security/i);
assert.match(migration, /force row level security/i);
assert.match(migration, /revoke all on table public\.coverall_assignment_links from public,anon,authenticated/i);
assert.match(migration, /scope in \('feedback','guest','coverall_assignment'\)/i);
assert.doesNotMatch(migration, /access_token|raw_token|token_plaintext/i);
assert.match(policyMigration, /create policy coverall_assignment_links_service_all/i);
assert.match(policyMigration, /to service_role/i);
assert.match(policyMigration, /using \(true\)[\s\S]*with check \(true\)/i);
assert.doesNotMatch(policyMigration, /to (anon|authenticated|public)/i);

let writeCount = 0;
const app = express();
app.use(express.json());
app.use("/schedule-api", createScheduleRouter({
  runReadOnlySql: async (sql) => {
    if (/from public\.coverall_assignment_links/i.test(sql)) return [{ id: "00000000-0000-4000-8000-000000000001" }];
    if (/from public\.employees/i.test(sql)) return [1, 2, 3, 4].map((number) => ({
      employee_id: `00000000-0000-4000-8000-00000000000${number}`,
      display_name: `CoverAll_0${number}`,
      employee_code: `COVERALL_0${number}`,
    }));
    return [];
  },
  runRpc: async () => ({}),
  runCommand: async () => { writeCount += 1; return []; },
  buildHealthPayload: () => ({ ok: true }),
  requireAdminApiAuth: (_req, res) => res.status(401).json({ ok: false, error: "Unauthorized" }),
  requireOpsManagerAuth: (_req, res) => res.status(401).json({ ok: false, error: "Unauthorized" }),
  requireDeviceAccess: (_req, res) => res.status(401).json({ ok: false, error: "Unauthorized" }),
  publicTrafficRateLimit: () => (_req, _res, next) => next(),
  appVersion: "test",
  releaseId: "test",
  contractVersion: "schedule.v2",
}));

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
try {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/schedule-api`;
  const unsigned = await fetch(`${base}/coverall/assignment?service_date=2026-07-30&slot=COVERALL_01&lang=en`);
  assert.equal(unsigned.status, 403, "unsigned CoverAll assignment requests must fail closed");
  assert.match(unsigned.headers.get("cache-control") || "", /no-store/);
  assert.match(unsigned.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);

  const token = "A".repeat(43);
  const authorized = await fetch(`${base}/coverall/assignment?service_date=2026-07-30&slot=COVERALL_01&lang=en&access_token=${token}`);
  assert.equal(authorized.status, 200, "a matching unexpired token should render the assignment");
  assert.equal(writeCount, 0, "public CoverAll assignment GET must not call the application write path");

  const createAttempt = await fetch(`${base}/coverall/links`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ service_date: "2026-07-30", slot_code: "COVERALL_01" }),
  });
  assert.equal(createAttempt.status, 401, "secure CoverAll links must be manager-issued");
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

console.log(JSON.stringify({ ok: true, audit6_coverall_security_contract: "passed" }, null, 2));
