// Synthetic local process topology only. No compiler, SQL, network, or secrets.
import { spawn } from "node:child_process";

const mode = process.env.STATIC_WEEKLY_OWNER_TEST_MODE || "normal";
if (mode === "crash-before-fork") process.exit(91);
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: false });
if (mode === "crash-after-fork-before-report") process.exit(92);
process.on("message", (message) => {
  if (message?.type === "init") {
    process.send?.({ type: "ready", nonce: message.nonce, sourceDigest: message.sourceDigest });
    if (mode === "duplicate-ready") process.send?.({ type: "ready", nonce: message.nonce, sourceDigest: message.sourceDigest });
    return;
  }
  if (message?.type !== "run") return;
  if (mode === "hang") return;
  if (mode === "wrong-source") return process.send?.({ type: "result", nonce: message.nonce, sourceDigest: "0".repeat(64), status: "ok", receipt: { operationId: "invalid" } });
  if (mode === "crash-after-report") process.exit(93);
  process.send?.({ type: "result", nonce: message.nonce, sourceDigest: message.sourceDigest, status: "ok", receipt: { operationId: "synthetic-owned", descendantPid: descendant.pid } });
});
