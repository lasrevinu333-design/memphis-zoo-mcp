#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createStaticWeeklyCompilerRuntime } from "../src/static-weekly-schedule-compiler-runtime.js";

const packetPath = process.env.STATIC_WEEKLY_TEST_SIX_PACKET;
assert.ok(packetPath, "exact frozen six-person source packet required");
const source = structuredClone(JSON.parse(readFileSync(packetPath)).compilerInput);
const template = JSON.parse(readFileSync(new URL("../config/custodial-six-person-static-20260926.json", import.meta.url)));
const effectiveDate = template.effectiveDate;
const publicationId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const staffedCount = Number(process.env.STATIC_WEEKLY_PREVIEW_COUNT || 7);
assert.ok([7, 9].includes(staffedCount), "focused worker preview is seven or nine positions");
const target = structuredClone(template.slots);
const choices = ["OPTION1", "OPTION2", "OPTION4"];
for (let i = 0; i < staffedCount - 6; i += 1) {
  const slot = target[choices[i]];
  slot.vacancy = false;
  slot.personId = `12345678-1234-4234-8234-123456789ab${i + 1}`;
  slot.name = `Synthetic New Hire ${i + 1}`;
  slot.history = [...(slot.history || []),
    { personId: slot.personId, name: slot.name, start: effectiveDate, end: null }];
  source.slots.find((row) => row.id === slot.slotId).incumbencies.push({
    personId: slot.personId, displayName: slot.name,
    effectiveStart: effectiveDate, effectiveEnd: null,
  });
}
const managerSnapshot = { week_start: effectiveDate, authority_revision: 42,
  current_publication: { publication_id: publicationId },
  roster: Object.values(target).map((slot) => ({
    slot_id: slot.slotId, contractor_capacity: false,
    incumbencies: slot.vacancy ? [] : [{ person_id: slot.personId, person_name: slot.name,
      effective_start: slot.history?.at(-1)?.start || "2020-01-01", effective_end: null }],
    week_staffing: slot.workDays.map((day) => ({ service_date: new Date(Date.parse(`${effectiveDate}T00:00:00Z`)
      + ((day + 6) % 7) * 86400000).toISOString().slice(0, 10),
      person_id: slot.personId, employee_active: slot.vacancy ? null : true })),
  })) };
const request = { publishedSource: { source_id: sourceId, publication_id: publicationId,
  authority_revision: 42, compiler_input: source }, managerSnapshot,
  effectiveDate, expectedRevision: 42 };
if (staffedCount === 9) {
  const fullPath = process.env.STATIC_WEEKLY_TEST_FULL_PACKET;
  assert.ok(fullPath, "exact original full-nine packet required for nine-position preview");
  const full = structuredClone(JSON.parse(readFileSync(fullPath)).compilerInput);
  for (const slot of Object.values(target)) {
    const row = full.slots.find((item) => item.id === slot.slotId);
    assert.ok(row);
    row.incumbencies = [{ personId: slot.personId, displayName: slot.name,
      effectiveStart: effectiveDate, effectiveEnd: null }];
  }
  request.fullNineSource = { source_id: "a00cdf2a-0623-5e2d-bc65-338c1dd67202",
    compiler_input: full };
}
const runtime = createStaticWeeklyCompilerRuntime();
try {
  const result = await runtime.prepareRecurringCandidate(request);
  assert.equal(result.status, "CANDIDATE_ONLY");
  assert.equal(result.staffedPositions, staffedCount);
  assert.equal(result.assignmentCount, staffedCount === 9 ? 313 : 312);
  assert.equal(result.sourceId, sourceId);
  assert.equal(result.publicationId, publicationId);
  assert.equal(result.authorityRevision, 42);
  assert.equal(result.compilerStatus, "FEASIBLE");
  assert.equal(result.publicationAuthority, "ACCEPTABLE");
  assert.equal(result.verifierOk, true);
  assert.equal(result.reviewWorkCount, 0);
  assert.equal(result.changes.length, staffedCount === 9 ? 1 : 14,
    "the nine-position branch restores the exact full template instead of rebalancing fourteen phases");
  assert.equal(result.managerConfirmationRequired, true);
  if (staffedCount === 7) {
    assert.equal(result.readbackPatternDigest,
      "bdfbf560d2b1cfd2feae7cb66accd088d4f01d8a9fd4ad690a556e28e04a95e5",
      "isolated worker must receive the identical source/roster basis as direct Node");
    assert.equal(result.patternFingerprint,
      "8a6997edfc0431abd40adc6d9471cda9f669ca5fb83160f06d0f2f43804e7335",
      "isolated worker must select the identical owner pattern");
    assert.equal(result.candidateSourceDigest,
      "31efa8f2525e45fecbe4bf882df7136008194b806525508256e9cdc70462bd5f",
      "isolated worker must compile the identical candidate source");
  } else {
    assert.equal(result.candidateSourceDigest,
      "a6dbd58578fc4892e55c25b3fdeace7f5e4ffd622670777d7836f396ede8d9d8",
      "nine-position worker must compile the exact full-template candidate");
    await assert.rejects(() => runtime.prepareRecurringCandidate({ ...request,
      fullNineSource: { ...request.fullNineSource, source_id: "33333333-3333-4333-8333-333333333333" } }),
    /exact approved nine-position source/);
  }
  await assert.rejects(() => runtime.prepareRecurringCandidate({ ...request, expectedRevision: 41 }),
    /revision changed/);
  console.log(JSON.stringify({ status: "PASS", checks: staffedCount === 7 ? 16 : 15,
    staffedCount,
    candidateSourceDigest: result.candidateSourceDigest,
    patternFingerprint: result.patternFingerprint,
    readbackPatternDigest: result.readbackPatternDigest,
    worker: "isolated fused compiler", productionWritten: false,
    managerConfirmation: "NOT IMPLEMENTED" }));
} finally {
  await runtime.shutdown();
}
