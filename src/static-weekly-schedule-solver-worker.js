import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
// output_flag is part of the solver evidence contract: the final report is the
// only pinned-boundary source for bounds, gap, and solution violations.
const OPTIONS = Object.freeze({ threads: 1, random_seed: 0, mip_rel_gap: 0, mip_abs_gap: 0, mip_feasibility_tolerance: 1e-9, presolve: "on", parallel: "off", output_flag: true });
const MAX_WASM_MEMORY_PAGES = 2048;
const MAX_SEMI_SPACE_MB = 24;
const TERMINAL_REPORT_PARSER_VERSION = "highs-terminal-report-v1";
const TERMINAL_REPORT_REPRESENTATION = "highs-terminal-report-records-json-utf8-v1";
const RAW_SOLVER_RECEIPT_SCHEMA = "memphis-zoo.static-weekly-raw-solver-receipt.v1";
const REPORT_START = "Solving report";
const REPORT_END = "Writing the solution to solution.txt";
const MAX_COLLECTED_OUTPUT_BYTES = 256 * 1024;
const PINNED_IDENTITY = Object.freeze({
  packageJsonSha256: "21e76a89d13d636f56d5cdda7dde590acd48d6fb683c97a327c10d43e74d9c56",
  wrapperJavaScriptSha256: "6d5be3ed3cbd1ce1924cc66cc9302b50753dabdb8c6e0e815845dce7f1890033",
  wasmSha256: "7e6432b2b26f4fab9f6d9bac55da43307c7a4b1b071cb204cb4d23e1901bc4d0",
  embeddedRuntimeBanner: "HiGHS 1.15.1 (git hash: 04024d7)",
});
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
let runtime;
let activeCollector = null;

function reportError(code, detail = {}) { return { code, ...detail }; }
function reportRepresentation(records) {
  // This is deliberately a fixed-order JSON representation rather than a
  // newline join: callback channel and every UTF-8 callback payload remain
  // unambiguous, even if a future pinned runtime emits embedded newlines.
  return JSON.stringify({ representation: TERMINAL_REPORT_REPRESENTATION, records: records.map(({ channel, text }) => ({ channel, text })) });
}
function rawReceiptRepresentation(options, terminalReport) {
  return JSON.stringify({ schema: RAW_SOLVER_RECEIPT_SCHEMA, options, terminalReport });
}
function captureOutput(channel, value) {
  if (!activeCollector) return;
  const text = String(value); const bytes = Buffer.byteLength(text, "utf8");
  if (activeCollector.bytes + bytes > MAX_COLLECTED_OUTPUT_BYTES) { activeCollector.truncated = true; return; }
  activeCollector.bytes += bytes; activeCollector.records.push({ channel, text });
}
function beginCollector() {
  if (activeCollector) throw new Error("Static weekly solver attempted overlapping report collection.");
  const collector = { records: [], bytes: 0, truncated: false };
  activeCollector = collector;
  return collector;
}
function finalizeCollector(collector) {
  if (activeCollector === collector) activeCollector = null;
  collector.records.length = 0;
}
function collectTerminalReport(records) {
  const starts = [];
  const ends = [];
  records.forEach((record, index) => {
    if (record.text === REPORT_START) starts.push(index);
    if (record.text === REPORT_END) ends.push(index);
  });
  if (starts.length !== 1) return { error: reportError(starts.length ? "duplicate_terminal_report_start" : "missing_terminal_report_start", { count: starts.length }) };
  const start = starts[0];
  const matchingEnds = ends.filter((index) => index > start);
  if (matchingEnds.length !== 1 || ends.some((index) => index < start)) return { error: reportError(matchingEnds.length ? "duplicate_or_misordered_terminal_report_end" : "missing_terminal_report_end", { start, endCount: ends.length }) };
  const end = matchingEnds[0];
  const reportRecords = records.slice(start, end + 1).map(({ channel, text }) => ({ channel, text }));
  const utf8 = Buffer.from(reportRepresentation(reportRecords), "utf8");
  return {
    records: reportRecords,
    representation: TERMINAL_REPORT_REPRESENTATION,
    utf8Base64: utf8.toString("base64"),
    utf8Sha256: sha256(utf8),
  };
}
function normalizedMalformed(raw, code) { return { kind: "malformed", raw, code }; }
function normalizeFiniteDecimal(raw, { percentage = false } = {}) {
  const source = String(raw ?? "");
  const trimmed = source.trim();
  const nonfinite = /^[+-]?(?:inf|infinity|nan)$/i;
  let token = trimmed;
  if (percentage) {
    if (nonfinite.test(token)) return { kind: "nonfinite", raw: source };
    if (!token.endsWith("%")) return normalizedMalformed(source, "missing_percent_suffix");
    token = token.slice(0, -1).trim();
  }
  if (nonfinite.test(token)) return { kind: "nonfinite", raw: source };
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) return normalizedMalformed(source, "malformed_decimal");
  const digits = `${match[2] || ""}${match[3] || match[4] || ""}`.replace(/^0+/, "") || "0";
  if (digits.length > 128) return normalizedMalformed(source, "decimal_precision_overflow");
  const exponentText = match[5] || "0";
  let exponent;
  try { exponent = BigInt(exponentText); } catch { return normalizedMalformed(source, "decimal_exponent_malformed"); }
  if (exponent > 10000n || exponent < -10000n) return normalizedMalformed(source, "decimal_exponent_overflow");
  if (digits === "0") return { kind: "finite_decimal", coefficient: "0", power10: "0", canonical: "0e0", raw: source };
  let coefficient = BigInt(`${match[1] === "-" ? "-" : ""}${digits}`);
  let power10 = exponent - BigInt((match[3] || match[4] || "").length);
  while (coefficient % 10n === 0n) { coefficient /= 10n; power10 += 1n; }
  return { kind: "finite_decimal", coefficient: coefficient.toString(), power10: power10.toString(), canonical: `${coefficient}e${power10}`, raw: source };
}
function normalizedIsZero(value) { return value?.kind === "finite_decimal" && value.coefficient === "0"; }
function normalizedEquals(left, right) { return left?.kind === "finite_decimal" && right?.kind === "finite_decimal" && left.coefficient === right.coefficient && left.power10 === right.power10; }
function normalizedEqualsSafeInteger(value, integer) {
  if (!Number.isSafeInteger(integer) || value?.kind !== "finite_decimal") return false;
  let power;
  try { power = BigInt(value.power10); } catch { return false; }
  if (power < 0n || power > 16n) return false;
  try { return BigInt(value.coefficient) * (10n ** power) === BigInt(integer); } catch { return false; }
}
function parseTerminalReport(report) {
  if (!report?.records || !Array.isArray(report.records)) return { ok: false, errors: [reportError("missing_terminal_report")], raw: {}, normalized: {} };
  const fields = [
    ["status", /^\s*Status\s{2,}(.+)$/],
    ["primalBound", /^\s*Primal bound\s{2,}(.+)$/],
    ["dualBound", /^\s*Dual bound\s{2,}(.+)$/],
    ["gap", /^\s*Gap\s{2,}(.+)$/],
    ["solutionStatus", /^\s*Solution status\s{2,}(.+)$/],
    ["objective", /^\s+(.+?)\s+\(objective\)\s*$/],
    ["boundViolation", /^\s+(.+?)\s+\(bound viol\.\)\s*$/],
    ["integerViolation", /^\s+(.+?)\s+\(int\. viol\.\)\s*$/],
    ["rowViolation", /^\s+(.+?)\s+\(row viol\.\)\s*$/],
  ];
  const found = new Map(fields.map(([name]) => [name, []]));
  report.records.forEach((record, index) => {
    for (const [name, pattern] of fields) {
      const match = pattern.exec(record.text);
      if (match) found.get(name).push({ index, raw: match[1] });
    }
  });
  const errors = [];
  const raw = {};
  const positions = [];
  for (const [name] of fields) {
    const matches = found.get(name);
    if (matches.length !== 1) { errors.push(reportError(matches.length ? "duplicate_report_field" : "missing_report_field", { field: name, count: matches.length })); continue; }
    raw[name] = matches[0].raw;
    positions.push(matches[0].index);
  }
  if (positions.length === fields.length && positions.some((position, index) => index && position <= positions[index - 1])) errors.push(reportError("reordered_report_fields"));
  const normalized = {
    primalBound: normalizeFiniteDecimal(raw.primalBound),
    dualBound: normalizeFiniteDecimal(raw.dualBound),
    gap: normalizeFiniteDecimal(raw.gap, { percentage: true }),
    objective: normalizeFiniteDecimal(raw.objective),
    boundViolation: normalizeFiniteDecimal(raw.boundViolation),
    integerViolation: normalizeFiniteDecimal(raw.integerViolation),
    rowViolation: normalizeFiniteDecimal(raw.rowViolation),
  };
  for (const [name, value] of Object.entries(normalized)) if (value.kind !== "finite_decimal") errors.push(reportError(value.kind === "nonfinite" ? "nonfinite_report_number" : "malformed_report_number", { field: name, detail: value.code || null }));
  return { ok: errors.length === 0, errors, raw, normalized };
}
function normalizeResultEvidence(result, collector) {
  const ownProperties = result && typeof result === "object" ? Object.getOwnPropertyNames(result).sort() : [];
  const own = (name) => Object.prototype.hasOwnProperty.call(result || {}, name) ? result[name] : null;
  const report = collectTerminalReport(collector.records);
  const parsed = report.error ? { ok: false, errors: [report.error], raw: {}, normalized: {} } : parseTerminalReport(report);
  const initializationRecords = collector.records.filter((record) => /^Running HiGHS .+: Copyright/.test(record.text));
  const banners = initializationRecords.map((record) => record.text.match(/^Running (HiGHS .+): Copyright/)?.[1]).filter(Boolean);
  const embeddedRuntimeBanner = banners.length === 0 ? runtime?.identity?.embeddedRuntimeBanner || null : banners.length === 1 && banners[0] === runtime?.identity?.embeddedRuntimeBanner ? banners[0] : null;
  return {
    evidenceSource: "terminal_solver_report",
    parserVersion: TERMINAL_REPORT_PARSER_VERSION,
    ownProperties,
    objectStatus: own("Status"),
    objectPrimalObjective: own("ObjectiveValue"),
    embeddedRuntimeBanner,
    terminalReport: report.error ? { representation: TERMINAL_REPORT_REPRESENTATION, parserVersion: TERMINAL_REPORT_PARSER_VERSION, error: report.error } : { ...report, parserVersion: TERMINAL_REPORT_PARSER_VERSION },
    parsedRaw: parsed.raw,
    normalized: parsed.normalized,
    parserOk: parsed.ok,
    parserErrors: parsed.errors,
    outputBytes: collector.bytes,
    outputTruncated: collector.truncated,
    initializationRecords,
    reportStatus: parsed.raw.status ?? null,
    reportPrimalBound: parsed.raw.primalBound ?? null,
    reportDualBound: parsed.raw.dualBound ?? null,
    reportGap: parsed.raw.gap ?? null,
    reportSolutionStatus: parsed.raw.solutionStatus ?? null,
  };
}
const send = (message) => {
  if (typeof process.send !== "function") throw new Error("Static weekly solver requires a private IPC parent.");
  process.send(message);
};

async function initialize() {
  if (!process.execArgv.includes(`--wasm-max-mem-pages=${MAX_WASM_MEMORY_PAGES}`)) throw new Error("Static weekly solver requires an enforced V8 WebAssembly memory-page limit.");
  if (!process.execArgv.includes(`--max-semi-space-size=${MAX_SEMI_SPACE_MB}`)) throw new Error("Static weekly solver requires an enforced V8 semi-space limit.");
  const packagePath = resolve(dirname(require.resolve("highs")), "../package.json");
  const wrapperPath = require.resolve("highs");
  const wasmPath = require.resolve("highs/runtime");
  const packageJsonBytes = await readFile(packagePath);
  const packageJson = JSON.parse(packageJsonBytes.toString("utf8"));
  if (packageJson.version !== "1.15.2") throw new Error(`Pinned HiGHS version mismatch: ${packageJson.version}`);
  const wasm = await readFile(wasmPath);
  const wrapper = await readFile(wrapperPath);
  const observedIdentity = { packageJsonSha256: sha256(packageJsonBytes), wrapperJavaScriptSha256: sha256(wrapper), wasmSha256: sha256(wasm) };
  for (const [field, expected] of Object.entries(PINNED_IDENTITY)) if (field !== "embeddedRuntimeBanner" && observedIdentity[field] !== expected) throw new Error(`Pinned HiGHS ${field} mismatch.`);
  const loader = require("highs");
  // The callbacks are private to this child process.  activeCollector is set
  // only around one serialized solve, so initialization/progress output cannot
  // become a later tier's evidence.
  const solver = await loader({ locateFile: () => wasmPath, print: (value) => captureOutput("print", value), printErr: (value) => captureOutput("printErr", value) });
  if (!solver || typeof solver.solve !== "function") throw new Error("HiGHS WebAssembly module did not expose solve().");
  // This interface emits the initialization record when the runtime executes
  // its first model, not while it constructs the module.  The first accepted
  // solve below captures the raw callback record and fails closed if it is not
  // exposed exactly once; no expected banner is ever substituted for it.
  return { solver, identity: { package: "highs@1.15.2", packageVersion: packageJson.version, wasmSha256: observedIdentity.wasmSha256, packageJsonSha256: observedIdentity.packageJsonSha256, wrapperJavaScriptSha256: observedIdentity.wrapperJavaScriptSha256, runtime: "local WebAssembly", embeddedRuntimeBanner: PINNED_IDENTITY.embeddedRuntimeBanner, initializationRecord: null, initializationBannerUtf8Sha256: null, wasmMemoryLimitPages: MAX_WASM_MEMORY_PAGES, wasmMemoryLimitBytes: MAX_WASM_MEMORY_PAGES * 65_536, v8SemiSpaceLimitMb: MAX_SEMI_SPACE_MB, resultEvidenceCapabilities: { bestBound: true, mipGap: true, distinctTermination: true, source: "terminal_solver_report" } } };
}

try {
  runtime = await initialize();
  send({ type: "ready", identity: runtime.identity });
} catch (cause) {
  send({ type: "init_error", error: { code: "solver_unavailable", message: cause.message } });
  throw cause;
}

process.on("disconnect", () => process.exit(0));
process.on("message", (message) => {
  if (!message || message.type !== "solve") return;
  if (message.behavior === "hang") {
    const wait = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(wait, 0, 0, 60_000);
    return;
  }
  if (message.behavior === "crash") process.exit(91);
  const collector = beginCollector();
  try {
    const result = runtime.solver.solve(message.lp, { ...OPTIONS, time_limit: message.timeLimitSeconds });
    if (message.behavior === "non_optimal") result.Status = "Feasible";
    if (message.behavior === "malformed") delete result.Columns;
    // Test-only adversary: safely above the pinned 1e-9 integer tolerance.
    if (message.behavior === "tolerance_edge") { const first = Object.keys(result.Columns || {})[0]; if (first) result.Columns[first].Primal = 0.999999998; }
    const evidence = normalizeResultEvidence(result, collector);
    if (!runtime.identity.initializationRecord) {
      if (evidence.initializationRecords.length !== 1) throw new Error(`Expected exactly one observed HiGHS initialization callback record; observed ${evidence.initializationRecords.length}.`);
      const initializationRecord = evidence.initializationRecords[0]; const initializationUtf8 = Buffer.from(JSON.stringify({ channel: initializationRecord.channel, text: initializationRecord.text }), "utf8");
      const observedBanner = /^Running (HiGHS .+): Copyright/.exec(initializationRecord.text)?.[1] || null;
      if (observedBanner !== PINNED_IDENTITY.embeddedRuntimeBanner) throw new Error("Observed HiGHS initialization banner did not match the pinned runtime.");
      runtime.identity = { ...runtime.identity, initializationRecord: { channel: initializationRecord.channel, text: initializationRecord.text, utf8Base64: initializationUtf8.toString("base64"), utf8Sha256: sha256(initializationUtf8) }, initializationBannerUtf8Sha256: sha256(initializationUtf8) };
    }
    // Evidence has copied the report representation before the private
    // collector is cleared in finally.  Nothing from one solve remains live.
    if (evidence.outputTruncated) throw new Error("HiGHS terminal output exceeded the pinned collector bound.");
    const options = { ...OPTIONS, time_limit: message.timeLimitSeconds };
    const rawReceiptDigest = sha256(Buffer.from(rawReceiptRepresentation(options, evidence.terminalReport), "utf8"));
    send({ type: "result", id: message.id, result, evidence: { ...evidence, rawReceiptDigest }, identity: runtime.identity, modelAttestation: message.modelAttestation || null, options });
  } catch (cause) {
    send({ type: "result", id: message.id, error: { code: "solver_unavailable", message: cause.message } });
  } finally {
    finalizeCollector(collector);
  }
});
