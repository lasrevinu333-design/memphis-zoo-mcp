import assert from "node:assert/strict";
import { validateRuntimeEnv } from "../src/config/env.js";
import { redactSecrets } from "../src/utils/redact-secrets.js";
import { summarizeTextDiff, makeUnifiedDiff } from "../src/utils/diff.js";
import { createMemphisResponder } from "../src/services/index.js";
import {
  createMessagingRouter,
  createScheduleRouter,
  createEventsAdminRouter,
  createEventsPublicRouter,
  createEventMaintenanceController,
  EVENTS_CONTRACT_VERSION,
} from "../src/routes/index.js";
import { createGithubClient } from "../src/github/client.js";
import { listDirectory, readFile, batchReadFiles } from "../src/github/read.js";
import { previewFullReplacement, previewTextReplacement } from "../src/github/patch.js";
import { writeFile, updateFile, replaceTextInFile } from "../src/github/write.js";
import { sanitizeReadOnlySql } from "../src/supabase/read.js";
import { applyMigration, normalizeMigrationInput } from "../src/supabase/migrations.js";
import { getToolManifest } from "../src/mcp/tool-manifest.js";
import { createMcpServer } from "../src/mcp/create-mcp-server.js";
import {
  addMinutesToTime,
  computeWeekdayDate,
  esc,
  extractExplicitDate,
  extractTimeWindow,
  normalizeDate,
  normalizeLoose,
  sqlLikeLiteral,
  toSafeInt,
  findLocationCode,
  isSystemSpecificQuestion,
} from "../src/ai/index.js";

const envResult = validateRuntimeEnv({ strict: false });
assert.equal(typeof envResult.ok, "boolean");
assert.ok(envResult.redacted_env);

const redacted = redactSecrets({ GITHUB_TOKEN: "ghp_example_secret_value_1234567890", nested: { normal: "ok" } });
assert.equal(redacted.nested.normal, "ok");
assert.notEqual(redacted.GITHUB_TOKEN, "ghp_example_secret_value_1234567890");

const diffSummary = summarizeTextDiff("a\nb\n", "a\nc\n");
assert.equal(diffSummary.changed, true);
assert.equal(typeof makeUnifiedDiff({ oldText: "a\n", newText: "b\n", path: "x.txt" }), "string");

assert.equal(esc("Bob's"), "Bob''s");
assert.equal(sqlLikeLiteral("Zoo"), "'%Zoo%'");
assert.equal(normalizeLoose("Teton Pavilion!"), "teton pavilion");
assert.equal(normalizeDate("2026-04-25"), "2026-04-25");
assert.equal(normalizeDate("04/25/2026"), null);
assert.equal(extractExplicitDate("on 2026-04-25 please"), "2026-04-25");
assert.deepEqual(extractTimeWindow("9am to 1030am"), { start: "09:00", end: "10:30" });
assert.equal(addMinutesToTime("09:30", 45), "10:15");
assert.equal(toSafeInt("100", 14, 1, 60), 60);
assert.equal(computeWeekdayDate("2026-04-25", "sunday", "this"), "2026-04-26");

const fullPreview = previewFullReplacement({ oldText: "a\n", newText: "b\n", path: "x.txt" });
assert.equal(fullPreview.changed, true);
const replacePreview = previewTextReplacement({ oldText: "hello world", find: "world", replace: "zoo", path: "x.txt" });
assert.equal(replacePreview.changed, true);

assert.equal(typeof createGithubClient, "function");
assert.equal(typeof listDirectory, "function");
assert.equal(typeof readFile, "function");
assert.equal(typeof batchReadFiles, "function");
assert.equal(typeof writeFile, "function");
assert.equal(typeof updateFile, "function");
assert.equal(typeof replaceTextInFile, "function");

const sanitizedSql = sanitizeReadOnlySql("select 1 as ok;");
assert.equal(sanitizedSql.sql, "select 1 as ok");
assert.throws(() => sanitizeReadOnlySql("delete from public.foo"));
const normalizedMigration = normalizeMigrationInput({ name: "test_migration", sql: "select 1;" });
assert.equal(normalizedMigration.name, "test_migration");
assert.equal(normalizedMigration.sql_bytes, 9);
const migrationDryRun = await applyMigration({ name: "test_migration", sql: "select 1;" });
assert.equal(migrationDryRun.audit.action, "would_apply_migration");
assert.equal(migrationDryRun.audit.log_table, "public.migration_log");
assert.equal(migrationDryRun.migration.name, "test_migration");

const manifest = getToolManifest();
assert.equal(manifest.ok, true);
assert.equal(manifest.version, "mcp-tools.v2");
const toolByName = new Map(manifest.tools.map((tool) => [tool.name, tool]));
for (const toolName of [
  "server_tool_manifest",
  "server_deep_health",
  "github_repo_tree",
  "github_batch_read",
  "github_replace_text",
]) {
  assert.equal(toolByName.get(toolName)?.status, "current");
}
assert.equal(toolByName.get("github_search_files")?.status, "current-via-compatibility-command");

const modularMcpServer = createMcpServer({ version: "smoke", releaseId: "smoke" });
assert.ok(modularMcpServer);

const responder = createMemphisResponder({
  runReadOnlySql: async () => [],
  runRpc: async () => ({}),
});
assert.equal(typeof responder.generateReply, "function");

assert.equal(typeof createMessagingRouter, "function");
assert.equal(typeof createScheduleRouter, "function");
assert.equal(typeof createEventsAdminRouter, "function");
assert.equal(typeof createEventsPublicRouter, "function");
assert.equal(typeof createEventMaintenanceController, "function");
assert.equal(EVENTS_CONTRACT_VERSION, "events.v1");

console.log(JSON.stringify({ ok: true, smoke: "passed" }, null, 2));
