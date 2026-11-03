#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileAndPrepareStaticWeeklyScheduleIsolated, shutdownStaticWeeklyCompiler } from "../src/static-weekly-schedule-compiler-runtime.js";
import { postgresJsonbContentDigest } from "../src/static-weekly-schedule-program.js";

const file = process.env.STATIC_WEEKLY_SIX_PERSON_PACKET;
assert.ok(file, "explicit local six-person packet required");
const packet = JSON.parse(fs.readFileSync(file, "utf8"));
const source = packet.compilerInput;
const inputDigest = postgresJsonbContentDigest(source);
const { version, ...rest } = structuredClone(source);
const actor = { managerId: "10000000-0000-4000-8000-000000000026",
  managerName: "Synthetic Six-Person Lunch Check", idempotencyKey: "synthetic-six-person-lunch" };
try {
  const prepared = await compileAndPrepareStaticWeeklyScheduleIsolated(
    { ...rest, versions: [version] },
    { kind: "projection", publicationId: version.publicationId, expectedRevision: 0, actor },
  );
  const loans = prepared.lunchDocument.loans;
  assert.equal(prepared.lunchDocument.verification_status, "VERIFIED");
  assert.equal(loans.length, 30);
  assert.equal(loans.filter((loan) => loan.status === "REVIEW_REQUIRED").length, 0);
  assert.equal(postgresJsonbContentDigest(source), inputDigest, "source was mutated");
  console.log(JSON.stringify({ status: "PASS", loans: loans.length,
    reviewRequired: 0, fallbacks: loans.filter((loan) => loan.fallback).length,
    inputDigest, replayDigest: prepared.replayDigest,
    sourceRows: source.version.assignments.length,
    derivedRows: prepared.envelope.authority.overlayCompilerInput.version.assignments.length,
    productionWritten: false }));
} finally {
  await shutdownStaticWeeklyCompiler();
}
