import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL(
  "../supabase/functions/temporary-repair-payload/index.ts",
  import.meta.url,
), "utf8");
const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");

assert.match(source, /status:\s*410/);
assert.match(source, /Temporary repair surface retired/);
assert.doesNotMatch(source, /service_role|SUPABASE_SERVICE_ROLE_KEY|bearer|temporary_repair_payload_chunks/i);
assert.match(config, /\[functions\.temporary-repair-payload\]\s*\nverify_jwt\s*=\s*true/);

console.log("Temporary repair payload retirement tests passed.");
