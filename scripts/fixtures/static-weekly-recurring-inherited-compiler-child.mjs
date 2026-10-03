// Synthetic compiler topology only. The compiler test worker forks an idle
// descendant; neither the real solver nor database is loaded.
import { createStaticWeeklyCompilerRuntime } from "../../src/static-weekly-schedule-compiler-runtime.js";
import { readFileSync } from "node:fs";

function groupId(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]);
}

const runtime = createStaticWeeklyCompilerRuntime({
  workerUrl: new URL("./static-weekly-compiler-runtime-test-worker.mjs", import.meta.url),
  workerDetached: false,
  exposeProcessIdentityForTest: true,
  initializationMilliseconds: 1_000,
  requestMilliseconds: 3_000,
  resourceLimits: { maxOldGenerationSizeMb: 32, maxSemiSpaceSizeMb: 8, maxWasmMemoryMb: 32, stackSizeKb: 2 * 1024 },
});
const mode = process.env.STATIC_WEEKLY_OWNER_TEST_MODE || "normal";
process.on("message", async (message) => {
  if (message?.type === "init") {
    const readiness = await runtime.initialize();
    if (mode === "crash-after-compiler-fork-before-report") process.exit(94);
    process.send?.({ type: "ready", nonce: message.nonce, sourceDigest: message.sourceDigest });
    return;
  }
  if (message?.type !== "run") return;
  const readiness = runtime.getReadiness();
  const result = await runtime.compile({ value: "synthetic-inherited" });
  const compilerGroupId = groupId(readiness.worker.processId);
  const descendantGroupId = groupId(readiness.worker.nestedPid);
  if (mode === "shutdown-before-result") await runtime.shutdown();
  process.send?.({
    type: "result", nonce: message.nonce, sourceDigest: message.sourceDigest,
    status: "ok", receipt: {
      operationId: "synthetic-inherited",
      compilerPid: readiness.worker.processId,
      descendantPid: readiness.worker.nestedPid,
      compilerGroupId,
      descendantGroupId,
      result: result.value,
    },
  });
});
