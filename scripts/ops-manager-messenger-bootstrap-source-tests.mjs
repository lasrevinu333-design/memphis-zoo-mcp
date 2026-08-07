import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/messaging-api.js", import.meta.url), "utf8");
const start = source.indexOf("async function getManagerMessagingIdentity");
const end = source.indexOf("async function resolveViewerContext", start);
assert.ok(start >= 0 && end > start, "manager Messenger identity function must exist");
const identitySource = source.slice(start, end);
assert.match(identitySource, /msg_ensure_ops_manager_user/);
assert.doesNotMatch(identitySource, /msg_get_or_create_ops_manager_thread/);
assert.doesNotMatch(identitySource, /ops_manager_thread_id/);
assert.doesNotMatch(identitySource, /Operations Leadership chat is unavailable/);
assert.match(identitySource, /identity_source:\s*"trusted_manager_session"/);
console.log("OPS_MANAGER_MESSENGER_BOOTSTRAP_SOURCE_PASS");
