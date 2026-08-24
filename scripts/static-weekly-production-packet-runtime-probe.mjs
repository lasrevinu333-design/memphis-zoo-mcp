#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS,
  createStaticWeeklyCompilerRuntime,
} from "../src/static-weekly-schedule-compiler-runtime.js";

const packetPath = process.argv[2];
if (!packetPath) throw new Error("Usage: static-weekly-production-packet-runtime-probe.mjs <verified-packet.json>");

async function processChildren(pid) {
  try {
    const text = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
    return text.trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isSafeInteger);
  } catch {
    return [];
  }
}

async function residentKiB(pid) {
  try {
    const text = await readFile(`/proc/${pid}/status`, "utf8");
    return Number(/^VmRSS:\s+(\d+)\s+kB$/m.exec(text)?.[1] || 0);
  } catch {
    return 0;
  }
}

async function processTree(rootPid) {
  const seen = new Set();
  const pending = [rootPid];
  while (pending.length) {
    const pid = pending.pop();
    if (!Number.isSafeInteger(pid) || pid < 2 || seen.has(pid)) continue;
    seen.add(pid);
    pending.push(...await processChildren(pid));
  }
  return [...seen];
}

const packetBytes = await readFile(packetPath);
const packet = JSON.parse(packetBytes.toString("utf8"));
const input = structuredClone(packet.compilerInput);
if (input.version && !input.versions) {
  input.versions = [input.version];
  delete input.version;
}
input.serviceDate = packet.effectiveDate;
input.exceptions = [];

const runtime = createStaticWeeklyCompilerRuntime({ exposeProcessIdentityForTest: true });
let pulseCount = 0;
let samples = 0;
let peakTreeRssKiB = 0;
let peakCompilerTreeRssKiB = 0;
let maximumCompilerDescendants = 0;
let timer;
try {
  await runtime.initialize();
  const compilerPid = Number(runtime.getReadiness().worker.processId);
  assert.equal(Number.isSafeInteger(compilerPid) && compilerPid > 1, true, "compiler process identity is required for the measured probe");
  timer = setInterval(async () => {
    pulseCount += 1;
    const fullTree = await processTree(process.pid);
    const compilerTree = await processTree(compilerPid);
    samples += 1;
    maximumCompilerDescendants = Math.max(maximumCompilerDescendants, compilerTree.length - 1);
    peakTreeRssKiB = Math.max(peakTreeRssKiB, (await Promise.all(fullTree.map(residentKiB))).reduce((sum, value) => sum + value, 0));
    peakCompilerTreeRssKiB = Math.max(peakCompilerTreeRssKiB, (await Promise.all(compilerTree.map(residentKiB))).reduce((sum, value) => sum + value, 0));
  }, 25);
  const startedAt = performance.now();
  const prepared = await runtime.compileAndPrepare(input, {
    kind: "draft",
    expectedRevision: 0,
    actor: {
      managerId: "00000000-0000-4000-8000-000000000001",
      managerName: "Eric",
      idempotencyKey: "local-production-packet-resource-probe",
    },
  });
  const elapsedMilliseconds = Math.round(performance.now() - startedAt);
  clearInterval(timer);
  timer = null;
  assert.equal(prepared.document?.validation?.status, "FEASIBLE");
  assert.equal(prepared.document?.validation?.publication_authority, "ACCEPTABLE");
  assert.equal(prepared.document?.receipt?.compiler?.verifier?.ok, true);
  assert.equal(prepared.document?.receipt?.compiler?.independentVerification?.ok, true);
  assert.equal(maximumCompilerDescendants, 0, "the fused compiler isolate must not spawn a nested solver process");
  assert.equal(pulseCount > 0 && samples > 0, true, "the parent event loop must remain responsive during the exact production compile");
  const conservativeServicePeakKiB = peakCompilerTreeRssKiB + (96 * 1024);
  assert.equal(conservativeServicePeakKiB < 512 * 1024, true, "the compiler isolate plus conservative resident-service allowance must fit the approved Starter instance");
  process.stdout.write(`${JSON.stringify({
    schema: "memphis-zoo.static-weekly-production-packet-runtime-probe.v1",
    packetSha256: createHash("sha256").update(packetBytes).digest("hex"),
    sourceId: packet.sourceId,
    sourceDigest: packet.sourceDigest,
    status: prepared.document.validation.status,
    verifierOk: prepared.document.receipt.compiler.verifier.ok,
    independentVerificationOk: prepared.document.receipt.compiler.independentVerification.ok,
    elapsedMilliseconds,
    pulseCount,
    samples,
    maximumCompilerDescendants,
    peakProbeTreeRssKiB: peakTreeRssKiB,
    peakCompilerTreeRssKiB,
    conservativeResidentServiceAllowanceKiB: 96 * 1024,
    conservativeServicePeakKiB,
    starterLimitKiB: 512 * 1024,
    conservativeHeadroomKiB: (512 * 1024) - conservativeServicePeakKiB,
    resourceLimits: STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS,
    topology: runtime.getReadiness().worker.processTopology,
  }, null, 2)}\n`);
} finally {
  if (timer) clearInterval(timer);
  await runtime.shutdown();
}
