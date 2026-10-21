// Synthetic local process topology only. No compiler, SQL, network, or secrets.
import { spawn } from "node:child_process";
import { once } from "node:events";

const mode = process.env.STATIC_WEEKLY_OWNER_TEST_MODE || "normal";
if (mode === "crash-before-fork") process.exit(91);
const descendant = new Set(["normal", "wrong-source", "crash-after-fork-before-report", "crash-after-report"]).has(mode)
  ? spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: false }) : null;
if (mode === "crash-after-fork-before-report") process.exit(92);
async function stopDescendant() {
  if (!descendant) return;
  descendant.kill("SIGKILL");
  await once(descendant, "exit");
}
process.on("message", async (message) => {
  if (message?.type === "cancel-before-work") {
    await stopDescendant();
    process.exit(0);
  }
  if (message?.type === "init") {
    process.send?.({ type: "ready", nonce: message.nonce, sourceDigest: message.sourceDigest });
    if (mode === "duplicate-ready") process.send?.({ type: "ready", nonce: message.nonce, sourceDigest: message.sourceDigest });
    return;
  }
  if (message?.type !== "run") return;
  if (mode === "hang") return;
  if (mode === "wrong-source") {
    await stopDescendant();
    return process.send?.({ type: "result", nonce: message.nonce, sourceDigest: "0".repeat(64), status: "ok", receipt: { operationId: "invalid" } });
  }
  if (mode === "duplicate-result") {
    const response = { type: "result", nonce: message.nonce, sourceDigest: message.sourceDigest, status: "ok", receipt: { operationId: "synthetic-owned" } };
    process.send?.(response);
    return process.send?.(response, () => process.exit(0));
  }
  if (mode === "crash-after-report") { await stopDescendant(); process.exit(93); }
  await stopDescendant();
  process.send?.({ type: "result", nonce: message.nonce, sourceDigest: message.sourceDigest, status: "ok", receipt: { operationId: "synthetic-owned", descendantPid: descendant.pid } }, () => process.exit(0));
});
