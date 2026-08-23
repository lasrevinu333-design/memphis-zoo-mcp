import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import { STATIC_WEEKLY_WORKER_LIMITS, getStaticWeeklySolverReadiness, initializeStaticWeeklySolver, setStaticWeeklySolverTestOverride, solveStaticWeeklyMip } from "../src/static-weekly-schedule-solver.js";

const execFileAsync = promisify(execFile);
const lp = "Minimize\n objective: + 1 x\nSubject To\n c: + 1 x >= 1\nBounds\n 0 <= x <= 1\nBinary\n x\nEnd\n";
async function waitForSolverRecovery(timeoutMilliseconds = 5_000) {
  const deadline = performance.now() + timeoutMilliseconds;
  while (!getStaticWeeklySolverReadiness().available && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(getStaticWeeklySolverReadiness().available, true, "replacement worker must complete its measured readiness preflight");
}
await initializeStaticWeeklySolver();
const ready = getStaticWeeklySolverReadiness();
assert.equal(ready.available, true);
assert.equal(ready.identity.package, "highs@1.15.2");
assert.match(ready.identity.packageJsonSha256, /^[0-9a-f]{64}$/);
assert.match(ready.identity.wrapperJavaScriptSha256, /^[0-9a-f]{64}$/);
assert.match(ready.identity.wasmSha256, /^[0-9a-f]{64}$/);
assert.equal(ready.identity.embeddedRuntimeBanner, "HiGHS 1.15.1 (git hash: 04024d7)");
assert.equal(ready.identity.v8OldGenerationLimitMb, STATIC_WEEKLY_WORKER_LIMITS.maxOldGenerationSizeMb, "the worker proves the exact parent-enforced old-generation ceiling");
assert.equal(ready.identity.v8SemiSpaceLimitMb, STATIC_WEEKLY_WORKER_LIMITS.maxSemiSpaceSizeMb, "the worker proves the exact parent-enforced semi-space ceiling");
assert.equal(ready.identity.wasmMemoryLimitBytes, STATIC_WEEKLY_WORKER_LIMITS.maxWasmMemoryMb * 1024 * 1024, "the worker proves the exact parent-enforced WebAssembly ceiling");
assert.equal(ready.identity.initializationRecord.channel, "print", "readiness requires a completed measured solver preflight");
assert.match(ready.identity.initializationRecord.text, /^Running HiGHS 1\.15\.1 \(git hash: 04024d7\): Copyright/);
assert.equal(ready.identity.initializationRecord.utf8Sha256, ready.identity.initializationBannerUtf8Sha256);
assert.deepEqual(ready.identity.resultEvidenceCapabilities, { bestBound: true, mipGap: true, distinctTermination: true, source: "terminal_solver_report" });

const optimal = await solveStaticWeeklyMip(lp, { timeLimitSeconds: 1 });
assert.equal(optimal.result.Status, "Optimal");
assert.equal(optimal.identity.initializationRecord.channel, "print");
assert.match(optimal.identity.initializationRecord.text, /^Running HiGHS 1\.15\.1 \(git hash: 04024d7\): Copyright/);
assert.equal(optimal.identity.initializationRecord.utf8Sha256, optimal.identity.initializationBannerUtf8Sha256, "the observed callback bytes, rather than an expected banner constant, bind solver identity");
assert.equal(optimal.evidence.evidenceSource, "terminal_solver_report");
assert.equal(optimal.evidence.parserVersion, "highs-terminal-report-v1");
assert.equal(optimal.evidence.parserOk, true);
assert.equal(optimal.evidence.objectStatus, "Optimal"); assert.equal(optimal.evidence.reportStatus, "Optimal");
assert.equal(optimal.evidence.parsedRaw.primalBound, "1"); assert.equal(optimal.evidence.parsedRaw.dualBound, "1"); assert.equal(optimal.evidence.parsedRaw.gap, "0%");
assert.equal(optimal.evidence.parsedRaw.solutionStatus, "feasible");
assert.equal(optimal.evidence.normalized.gap.canonical, "0e0");
assert.equal(optimal.evidence.terminalReport.records[0].text, "Solving report");
assert.equal(optimal.evidence.terminalReport.records.at(-1).text, "Writing the solution to solution.txt");
assert.match(optimal.evidence.terminalReport.utf8Sha256, /^[0-9a-f]{64}$/);
const secondOptimal = await solveStaticWeeklyMip(lp, { timeLimitSeconds: 1 });
assert.equal(secondOptimal.evidence.terminalReport.records.filter((record) => record.text === "Solving report").length, 1, "one collector prevents cross-solve report carry-over");
assert.equal(secondOptimal.evidence.terminalReport.records.filter((record) => record.text === "Writing the solution to solution.txt").length, 1, "one collector clears after each normalized evidence copy");

// Admission time applies while a previous solve owns the child.  Abort kills
// and replaces the active worker, and any late IPC result is ignored.
setStaticWeeklySolverTestOverride("hang");
const firstQueued = solveStaticWeeklyMip(lp, { timeLimitSeconds: 0.05 });
const queuedAbsoluteDeadline = performance.now() + 10;
const queuedExpired = solveStaticWeeklyMip(lp, { deadline: queuedAbsoluteDeadline, timeLimitSeconds: 1 });
await assert.rejects(() => firstQueued, (error) => error.code === "solver_timeout");
await assert.rejects(() => queuedExpired, (error) => error.code === "solver_timeout");
assert.equal(performance.now() >= queuedAbsoluteDeadline, true, "time spent behind queued solver work consumes the same absolute monotonic deadline");
await new Promise((resolve) => setTimeout(resolve, 150));
const controller = new AbortController();
const aborted = solveStaticWeeklyMip(lp, { timeLimitSeconds: 1, signal: controller.signal });
setTimeout(() => controller.abort(), 10);
await assert.rejects(() => aborted, (error) => error.code === "solver_aborted");
await new Promise((resolve) => setTimeout(resolve, 150));
setStaticWeeklySolverTestOverride(null);
const replacementOptimal = await solveStaticWeeklyMip(lp, { timeLimitSeconds: 1 });
assert.equal(replacementOptimal.result.Status, "Optimal", "replacement worker rejects stale results and recovers ready state");

// Each probe is a fresh process so it begins genuinely cold.  The test-only
// interceptor stops the exact owned child before ready IPC; the worker module
// must settle the caller at its own deadline/abort, reap that child, ignore
// synthetic late events, then initialize a new serial worker for later solves.
async function runColdInitializationProbe(mode) {
  const source = `
    import assert from "node:assert/strict";
    import { getStaticWeeklySolverReadiness, setStaticWeeklySolverTestChildInterceptor, solveStaticWeeklyMip } from "./src/static-weekly-schedule-solver.js";
    const lp = "Minimize\\n objective: + 1 x\\nSubject To\\n c: + 1 x >= 1\\nBounds\\n 0 <= x <= 1\\nBinary\\n x\\nEnd\\n";
    const mode = ${JSON.stringify(mode)};
    let stopped = null;
    const reap = async (child) => {
      if (!child || child.exitCode != null || child.signalCode != null) return;
      await new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill("SIGKILL");
      });
    };
    setStaticWeeklySolverTestChildInterceptor((child) => {
      stopped = child;
      assert.equal(child.kill("SIGSTOP"), true, "the owned cold child is stopped before readiness");
    });
    try {
      if (mode === "deadline") {
        await assert.rejects(() => solveStaticWeeklyMip(lp, { timeLimitSeconds: 0.05 }), (error) => error.code === "solver_timeout");
      } else {
        const controller = new AbortController();
        const aborted = solveStaticWeeklyMip(lp, { timeLimitSeconds: 1, signal: controller.signal });
        setTimeout(() => controller.abort(), 20);
        await assert.rejects(() => aborted, (error) => error.code === "solver_aborted");
      }
      assert.ok(stopped, "the interceptor observed the owned initializing child");
      assert.equal(stopped.exitCode != null || stopped.signalCode != null, true, "timed-out or aborted cold child is reaped before request settlement");
      stopped.emit("message", { type: "ready", identity: { forged: true } });
      stopped.emit("error", new Error("late superseded worker error"));
      stopped.emit("exit", 0);
      assert.equal(getStaticWeeklySolverReadiness().available, false, "late superseded child events cannot make readiness true");
      setStaticWeeklySolverTestChildInterceptor(null);
      const [first, second] = await Promise.all([
        solveStaticWeeklyMip(lp, { timeLimitSeconds: 1 }),
        solveStaticWeeklyMip(lp, { timeLimitSeconds: 1 }),
      ]);
      assert.equal(first.result.Status, "Optimal");
      assert.equal(second.result.Status, "Optimal", "a recovered worker continues to serialize later requests");
      assert.equal(getStaticWeeklySolverReadiness().available, true);
      console.log("COLD_INITIALIZATION_" + mode.toUpperCase() + "_PASS");
    } finally {
      setStaticWeeklySolverTestChildInterceptor(null);
      await reap(stopped);
    }
  `;
  const result = await execFileAsync(process.execPath, ["--input-type=module", "-e", source], { cwd: process.cwd(), timeout: 7_000 });
  assert.match(result.stdout, new RegExp(`COLD_INITIALIZATION_${mode.toUpperCase()}_PASS`), `${mode} cold initialization leaves no stopped child or referenced process`);
}
await runColdInitializationProbe("deadline");
await runColdInitializationProbe("abort");

const infeasibleLp = "Minimize\n objective: + 1 x\nSubject To\n low: + 1 x >= 1\n high: + 1 x <= 0\nBounds\n 0 <= x <= 1\nBinary\n x\nEnd\n";
const infeasible = await solveStaticWeeklyMip(infeasibleLp, { timeLimitSeconds: 1 });
assert.equal(infeasible.result.Status, "Infeasible");
assert.equal(infeasible.evidence.parserOk, false);
assert.equal(infeasible.evidence.normalized.primalBound.kind, "nonfinite");
assert.equal(infeasible.evidence.parsedRaw.gap, "inf");

const resultShape = JSON.parse(fs.readFileSync(new URL("./fixtures/static-weekly-scheduler/highs-1.15.2-result-shape.json", import.meta.url), "utf8"));
assert.equal(resultShape.schema, "memphis-zoo.static-weekly.highs-terminal-report-result-shape.v2");
assert.deepEqual(resultShape.capabilities, ready.identity.resultEvidenceCapabilities);
for (const name of ["optimal", "infeasible", "immediateTimeoutNoSolution", "timeLimitedFeasibleNonzeroGap"]) {
  const fixture = resultShape.cases[name];
  assert.deepEqual(fixture.ownProperties, ["Columns", "ObjectiveValue", "Rows", "Status"]);
  assert.equal(fixture.terminalReportLines[0], "Solving report");
  assert.equal(fixture.terminalReportLines.at(-1), "Writing the solution to solution.txt");
}
assert.equal(resultShape.cases.immediateTimeoutNoSolution.terminalReportLines.includes("  Gap               0%"), true, "displayed zero gap with no solution is never authority");
assert.equal(resultShape.cases.timeLimitedFeasibleNonzeroGap.terminalReportLines.some((line) => /^  Gap\s+(?!0%)/.test(line)), true, "feasible time limit retains its nonzero terminal gap");

setStaticWeeklySolverTestOverride("non_optimal");
const nonOptimal = await solveStaticWeeklyMip(lp, { timeLimitSeconds: 1 }); assert.equal(nonOptimal.result.Status, "Feasible");
setStaticWeeklySolverTestOverride("malformed");
const malformed = await solveStaticWeeklyMip(lp, { timeLimitSeconds: 1 }); assert.equal(malformed.result.Columns, undefined);
setStaticWeeklySolverTestOverride("hang");
let pulse = false;
const responsive = new Promise((resolve) => setTimeout(() => { pulse = true; resolve(); }, 10));
await assert.rejects(() => solveStaticWeeklyMip(lp, { timeLimitSeconds: 0.05 }), (error) => error.code === "solver_timeout");
await responsive;
assert.equal(pulse, true, "the parent event loop remains responsive while a worker blocks");
await waitForSolverRecovery();
setStaticWeeklySolverTestOverride("crash");
await assert.rejects(() => solveStaticWeeklyMip(lp, { timeLimitSeconds: 1 }), (error) => error.code === "solver_unavailable");
await waitForSolverRecovery();
setStaticWeeklySolverTestOverride(null);

const initializeOnly = await execFileAsync(process.execPath, ["--input-type=module", "-e", "import { initializeStaticWeeklySolver } from './src/static-weekly-schedule-solver.js'; await initializeStaticWeeklySolver(); console.log('INITIALIZE_ONLY_PASS');"], { cwd: process.cwd(), timeout: 5_000 });
assert.match(initializeOnly.stdout, /INITIALIZE_ONLY_PASS/, "initialization leaves no referenced child process");
const preExpired = await execFileAsync(process.execPath, ["--input-type=module", "-e", "import { initializeStaticWeeklySolver, solveStaticWeeklyMip } from './src/static-weekly-schedule-solver.js'; await initializeStaticWeeklySolver(); try { await solveStaticWeeklyMip('Minimize\\n objective: 0\\nSubject To\\nBounds\\nEnd\\n',{timeLimitSeconds:0}); } catch (error) { if(error.code!=='solver_timeout') throw error; } console.log('PRE_EXPIRED_PASS');"], { cwd: process.cwd(), timeout: 3_000 });
assert.match(preExpired.stdout, /PRE_EXPIRED_PASS/, "pre-expired work retains no child, IPC, timer, or promise");
console.log("static weekly solver lifecycle tests: PASS");
