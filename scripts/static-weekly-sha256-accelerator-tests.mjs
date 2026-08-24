import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  installStaticWeeklySha256HexAccelerator,
  sha256Hex,
} from "../src/static-weekly-schedule-model.js";

const nativeSha256Hex = (text) => createHash("sha256").update(text, "utf8").digest("hex");

assert.equal(sha256Hex("abc"), nativeSha256Hex("abc"), "the portable authority agrees with Node SHA-256 before acceleration");
installStaticWeeklySha256HexAccelerator(nativeSha256Hex);
for (const input of ["", "abc", "Memphis Zoo Custodial 📱", "\u0000\ud800\udc00\n"]) {
  assert.equal(sha256Hex(input), nativeSha256Hex(input), "the validated accelerator preserves exact digest identity");
}
assert.throws(
  () => installStaticWeeklySha256HexAccelerator(nativeSha256Hex),
  (error) => error?.code === "sha256_accelerator_already_installed",
  "the process-wide digest implementation cannot change after installation",
);

const moduleUrl = new URL("../src/static-weekly-schedule-model.js", import.meta.url).href;
const mismatchProbe = `
  import assert from "node:assert/strict";
  import { installStaticWeeklySha256HexAccelerator } from ${JSON.stringify(moduleUrl)};
  assert.throws(
    () => installStaticWeeklySha256HexAccelerator(() => "0".repeat(64)),
    (error) => error?.code === "sha256_accelerator_disagreement",
  );
`;
execFileSync(process.execPath, ["--input-type=module", "-e", mismatchProbe], { stdio: "inherit" });

console.log("static weekly SHA-256 accelerator contract tests: PASS");
