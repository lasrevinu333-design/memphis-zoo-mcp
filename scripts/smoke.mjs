import assert from "node:assert/strict";
import { validateRuntimeEnv } from "../src/config/env.js";
import { redactSecrets } from "../src/utils/redact-secrets.js";
import { summarizeTextDiff, makeUnifiedDiff } from "../src/utils/diff.js";
import { createMemphisResponder } from "../src/memphis-ai.js";
import { createMessagingRouter } from "../src/messaging-api.js";
import { createScheduleRouter } from "../src/schedule-api.js";
import {
  createEventsAdminRouter,
  createEventsPublicRouter,
  createEventMaintenanceController,
  EVENTS_CONTRACT_VERSION,
} from "../src/events-api.js";

const envResult = validateRuntimeEnv({ strict: false });
assert.equal(typeof envResult.ok, "boolean");
assert.ok(envResult.redacted_env);

const redacted = redactSecrets({ GITHUB_TOKEN: "ghp_example_secret_value_1234567890", nested: { normal: "ok" } });
assert.equal(redacted.nested.normal, "ok");
assert.notEqual(redacted.GITHUB_TOKEN, "ghp_example_secret_value_1234567890");

const diffSummary = summarizeTextDiff("a\nb\n", "a\nc\n");
assert.equal(diffSummary.changed, true);
assert.equal(typeof makeUnifiedDiff({ oldText: "a\n", newText: "b\n", path: "x.txt" }), "string");

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
