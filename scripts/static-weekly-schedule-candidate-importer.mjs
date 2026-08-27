#!/usr/bin/env node
/*
 * Deterministic boundary between the supplied workbook candidate and a later
 * verified schedule packet.  It never infers missing roster identities,
 * routes, capacity, or publication readiness from presentation data.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { compileStaticWeeklySchedule, postgresJsonbContentDigest } from "../src/static-weekly-schedule-compiler.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKBOOK_SHA256 = "f9eba54e274cd1b792545770de6fb17e9e25fee989aca18f65250d433f599e40";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const KNOWN_CANDIDATE_UUID_PREFIXES = ["4b99b100-", "5b99b100-"];
const CANDIDATE_SCHEDULE_RETAINED_STATES = new Set(["LAST_KNOWN_ACTIVE", "ORIGINAL_SCHEDULE_RETAINED_STATUS_UNCONFIRMED"]);
const isCandidatePlaceholder = (value) => KNOWN_CANDIDATE_UUID_PREFIXES.some((prefix) => String(value || "").toLowerCase().startsWith(prefix));
const text = (value) => typeof value === "string" ? value.trim() : "";

function activeIncumbent(slot, effectiveDate) {
  const matches = Array.isArray(slot?.incumbencies) ? slot.incumbencies.filter((item) => (
    text(item?.effectiveStart) <= effectiveDate && (!text(item?.effectiveEnd) || text(item.effectiveEnd) > effectiveDate)
  )) : [];
  return matches.length === 1 ? matches[0] : null;
}

function validAvailabilityTemplate(item, status) {
  return item?.status === status
    && Number.isInteger(item?.dayOfWeek) && item.dayOfWeek >= 0 && item.dayOfWeek <= 6
    && text(item?.shift?.start) && text(item?.shift?.end)
    && text(item?.productiveCapacityProvenance)
    && Number.isSafeInteger(item?.maxServiceEffortMinutes) && item.maxServiceEffortMinutes >= 1
    && text(item?.maxServiceEffortProvenance)
    && Array.isArray(item?.qualifications) && text(item?.qualificationProvenance)
    && Array.isArray(item?.restrictions) && text(item?.restrictionProvenance)
    && text(item?.acceptedRouteAnchorLocationId) && text(item?.acceptedRouteProvenance);
}

export function validateStaticWeeklyPacket(packet) {
  const errors = [];
  if (!packet || typeof packet !== "object") return { ok: false, classification: "INVALID", errors: ["packet_object_required"] };
  if (packet.packetSchema === "memphis-zoo.static-weekly.candidate-workbook.v1") {
    if (packet.classification !== "CANDIDATE_WORKBOOK_EVIDENCE_NOT_PRODUCTION_OR_PUBLICATION_AUTHORITY") errors.push("candidate_classification_required");
    if (packet.publicationAuthority !== "REVIEW_REQUIRED" || packet.admission?.canaryReady !== false || packet.admission?.requiresVerifiedSchedulePacket !== true) errors.push("candidate_must_fail_closed");
    if (packet.source?.sha256 !== WORKBOOK_SHA256) errors.push("candidate_workbook_hash_mismatch");
    if (!Array.isArray(packet.candidateRoster) || !packet.candidateRoster.length || packet.candidateRoster.some((row) => !UUID.test(row.slotId || "") || !UUID.test(row.personId || "") || !String(row.displayName || "").trim())) errors.push("candidate_roster_requires_uuid_source_facts");
    const unavailableRosterSlots = packet.candidateRoster.filter((row) => !CANDIDATE_SCHEDULE_RETAINED_STATES.has(row.staffingState)).map((row) => row.slotId).sort();
    const unresolvedSlots = Array.isArray(packet.unresolved?.absentUntilReplacedStableSlots) ? [...new Set(packet.unresolved.absentUntilReplacedStableSlots)].sort() : [];
    if (!unavailableRosterSlots.length || JSON.stringify(unavailableRosterSlots) !== JSON.stringify(unresolvedSlots)) errors.push("unavailable_roster_slots_must_remain_unresolved");
    const statusUnconfirmedSlots = Array.isArray(packet.unresolved?.statusUnconfirmedRetainOriginalScheduleSlots) ? [...new Set(packet.unresolved.statusUnconfirmedRetainOriginalScheduleSlots)].sort() : [];
    const retainedUnconfirmedSlots = packet.candidateRoster.filter((row) => row.staffingState === "ORIGINAL_SCHEDULE_RETAINED_STATUS_UNCONFIRMED").map((row) => row.slotId).sort();
    if (JSON.stringify(statusUnconfirmedSlots) !== JSON.stringify(retainedUnconfirmedSlots)) errors.push("unconfirmed_status_slots_must_retain_original_schedule");
    const dutyWindow = /^([01]\d|2[0-3]):[0-5]\d-(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
    if (packet.candidateRoster.some((row) => !dutyWindow.test(row.shift || "") || !dutyWindow.test(row.lunch || ""))) errors.push("candidate_roster_shift_and_lunch_required");
    const slotPolicy = packet.operationalCorrections?.scheduleSlotPolicy;
    if (slotPolicy?.currentSchedule !== "PRESERVE_ALL_ORIGINAL_NAMES_LOCATIONS_DAYS_SHIFTS_AND_LUNCHES"
      || slotPolicy?.uncertainStaffing !== "RETAIN_ORIGINAL_SCHEDULE_UNTIL_A_CONFIRMED_CHANGE"
      || slotPolicy?.replacementIdentity !== "APPEND_NEW_INCUMBENT_WITH_NEW_PERSON_ID_AND_PRESERVE_HISTORY"
      || JSON.stringify(slotPolicy?.stableAcrossReplacement) !== JSON.stringify(["SLOT_ID", "LOCATION_ASSIGNMENTS"])
      || JSON.stringify(slotPolicy?.replacementMayChange) !== JSON.stringify(["DISPLAY_NAME", "WORK_DAYS", "SHIFT_START", "LUNCH_START", "LUNCH_END", "SHIFT_END"])) errors.push("current_schedule_slot_replacement_policy_required");
    if (packet.operationalCorrections?.coverAllPolicy?.firstAbsence !== "EVENLY_REDISTRIBUTE_AMONG_REMAINING_ZOO_EMPLOYEES" || packet.operationalCorrections?.coverAllPolicy?.secondAndLaterAbsences !== "CALL_COVERALL_ONE_PERSON_PER_ABSENCE") errors.push("current_coverall_policy_required");
    return { ok: errors.length === 0, classification: "CANDIDATE_ONLY", admissibleForRegistration: false, errors, contentDigest: hash(JSON.stringify(packet)) };
  }
  if (packet.packetSchema !== "memphis-zoo.static-weekly.verified-schedule-packet.v1") errors.push("unknown_packet_schema");
  if (packet.publicationAuthority !== "VERIFIED_SERVER_PACKET") errors.push("verified_packet_authority_required");
  for (const field of ["effectiveDate", "compilerInput", "rosterSlots", "directedProximity", "acceptedRoutes", "serviceEffort", "capacity", "sourceDigest", "verifiedAt", "verifiedBy", "evidence"]) if (packet[field] == null) errors.push(`verified_packet_missing_${field}`);
  if (packet.sourceDigest && !/^[0-9a-f]{64}$/i.test(packet.sourceDigest)) errors.push("verified_packet_source_digest_required");
  if (!UUID.test(packet.sourceId || "") || isCandidatePlaceholder(packet.sourceId)) errors.push("verified_packet_source_id_required");
  if (Array.isArray(packet.rosterSlots)) {
    const rosterSlotIds = packet.rosterSlots.map((row) => row?.slotId);
    if (new Set(rosterSlotIds).size !== rosterSlotIds.length) errors.push("verified_packet_roster_slot_identity_unique");
    if (packet.rosterSlots.some((row) => {
      const vacant = row?.availabilityState === "vacant_unfilled";
      return !UUID.test(row?.slotId || "") || isCandidatePlaceholder(row?.slotId)
        || (vacant
          ? row?.personId != null || text(row?.displayName)
          : !UUID.test(row?.personId || "") || isCandidatePlaceholder(row?.personId) || !text(row?.displayName));
    })) errors.push("verified_packet_production_uuid_identity_required");
  }
  if (!Array.isArray(packet.evidence) || !packet.evidence.length || packet.evidence.some((item) => !String(item?.kind || "").trim() || !/^[0-9a-f]{64}$/i.test(item?.sha256 || ""))) errors.push("verified_packet_hash_bound_evidence_required");
  if (!packet.compilerInput || typeof packet.compilerInput !== "object" || Array.isArray(packet.compilerInput)) errors.push("verified_packet_compiler_input_required");
  else {
    if (!Array.isArray(packet.compilerInput.exceptions) || packet.compilerInput.exceptions.length !== 0) errors.push("verified_packet_recurring_source_must_be_exception_free");
    const singularVersion = packet.compilerInput.version && typeof packet.compilerInput.version === "object" && !Array.isArray(packet.compilerInput.version)
      ? packet.compilerInput.version : null;
    const pluralVersion = Array.isArray(packet.compilerInput.versions) && packet.compilerInput.versions.length === 1
      ? packet.compilerInput.versions[0] : null;
    const version = singularVersion || pluralVersion;
    if (!version || Boolean(singularVersion) === Boolean(pluralVersion)) errors.push("verified_packet_exactly_one_recurring_version_required");
    if (packet.sourceDigest && postgresJsonbContentDigest(packet.compilerInput) !== packet.sourceDigest) errors.push("verified_packet_source_digest_mismatch");
    if (JSON.stringify(packet.compilerInput).match(/"[45]b99b100-/i)) errors.push("verified_packet_candidate_placeholder_forbidden");
    const rawAbsentSlotIds = Array.isArray(version?.namedAbsentSlotIds) ? version.namedAbsentSlotIds : [];
    const rawVacancyCapableSlotIds = Array.isArray(version?.vacancyCapableSlotIds) ? version.vacancyCapableSlotIds : [];
    const rawVacantSlotIds = Array.isArray(version?.vacantSlotIds) ? version.vacantSlotIds : [];
    const absentSlotIds = [...new Set(rawAbsentSlotIds)];
    const vacancyCapableSlotIds = [...new Set(rawVacancyCapableSlotIds)];
    const vacantSlotIds = [...new Set(rawVacantSlotIds)];
    if (absentSlotIds.length !== rawAbsentSlotIds.length || absentSlotIds.some((id) => !UUID.test(id || "") || isCandidatePlaceholder(id))) errors.push("verified_packet_named_absent_slot_identity_required");
    if (vacancyCapableSlotIds.length !== rawVacancyCapableSlotIds.length || vacancyCapableSlotIds.some((id) => !UUID.test(id || "") || isCandidatePlaceholder(id))) errors.push("verified_packet_vacancy_capable_slot_identity_required");
    if (vacantSlotIds.length !== rawVacantSlotIds.length || vacantSlotIds.some((id) => !UUID.test(id || "") || isCandidatePlaceholder(id))) errors.push("verified_packet_vacant_slot_identity_required");
    if (vacantSlotIds.some((id) => !vacancyCapableSlotIds.includes(id))) errors.push("verified_packet_active_vacancy_not_capable");
    if (absentSlotIds.some((id) => vacantSlotIds.includes(id))) errors.push("verified_packet_staffing_state_conflict");
    const slots = Array.isArray(packet.compilerInput.slots) ? packet.compilerInput.slots : [];
    const roster = Array.isArray(packet.rosterSlots) ? packet.rosterSlots : [];
    const availability = Array.isArray(version?.slotAvailability) ? version.slotAvailability : [];
    for (const slotId of absentSlotIds) {
      const slot = slots.find((item) => item?.id === slotId);
      const incumbent = activeIncumbent(slot, text(packet.effectiveDate));
      const rosterRow = roster.find((item) => item?.slotId === slotId);
      const templates = availability.filter((item) => item?.slotId === slotId);
      if (!slot || !incumbent || !UUID.test(incumbent.personId || "") || !text(incumbent.displayName)
        || rosterRow?.personId !== incumbent.personId || text(rosterRow?.displayName) !== text(incumbent.displayName)
        || rosterRow?.availabilityState !== "departed_named_absent"
        || templates.length === 0
        || templates.some((item) => !validAvailabilityTemplate(item, "departed_named_absent"))) {
        errors.push("verified_packet_named_absent_roster_identity_mismatch");
        break;
      }
    }
    for (const slotId of vacantSlotIds) {
      const slot = slots.find((item) => item?.id === slotId);
      const rosterRow = roster.find((item) => item?.slotId === slotId);
      const templates = availability.filter((item) => item?.slotId === slotId);
      if (!slot || activeIncumbent(slot, text(packet.effectiveDate)) != null
        || rosterRow?.personId != null || text(rosterRow?.displayName)
        || rosterRow?.availabilityState !== "vacant_unfilled"
        || templates.length === 0
        || templates.some((item) => !validAvailabilityTemplate(item, "vacant_unfilled"))) {
        errors.push("verified_packet_vacant_roster_identity_mismatch");
        break;
      }
    }
  }
  return { ok: errors.length === 0, classification: "VERIFIED_PACKET", admissibleForRegistration: errors.length === 0, errors, contentDigest: hash(JSON.stringify(packet)) };
}

function executableCompilerInput(packet) {
  const input = JSON.parse(JSON.stringify(packet.compilerInput));
  if (input.version && !input.versions) {
    input.versions = [input.version];
    delete input.version;
  }
  input.serviceDate = packet.effectiveDate;
  input.exceptions = [];
  return input;
}

export async function prepareStaticWeeklyRegistrationArtifact(packet) {
  const result = validateStaticWeeklyPacket(packet);
  if (!result.admissibleForRegistration) return result;
  const compiled = await compileStaticWeeklySchedule(executableCompilerInput(packet));
  const canonicalSource = compiled.canonicalAuthority?.compilerInput;
  if (compiled.status !== "FEASIBLE" || compiled.publicationAuthority !== "ACCEPTABLE" || compiled.verifier?.ok !== true
    || !canonicalSource || postgresJsonbContentDigest(canonicalSource) !== packet.sourceDigest) {
    result.ok = false;
    result.admissibleForRegistration = false;
    result.errors.push("verified_packet_compiler_rejected");
    return result;
  }
  result.registration = {
    schema: "memphis-zoo.static-weekly-source-registration.v1",
    sourceId: packet.sourceId,
    sourceDigest: postgresJsonbContentDigest(canonicalSource),
    packetContentDigest: result.contentDigest,
    compilerVersion: compiled.compilerVersion,
    replayDigest: compiled.replayDigest,
    verifierOk: true,
    canonicalSource,
  };
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const candidatePath = process.argv[2];
  const outputPath = process.argv[3] || null;
  if (!candidatePath) throw new Error("Usage: static-weekly-schedule-candidate-importer.mjs <candidate-or-verified-packet.json> [registration-artifact.json]");
  if (fs.statSync(candidatePath).size > 8 * 1024 * 1024) throw new Error("Static weekly source packet exceeds the 8 MiB release boundary.");
  const packet = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
  const result = await prepareStaticWeeklyRegistrationArtifact(packet);
  const rendered = `${JSON.stringify(result, null, outputPath ? 2 : 0)}\n`;
  if (outputPath) {
    if (!result.registration) throw new Error(`Registration artifact refused: ${result.errors.join(", ")}`);
    fs.writeFileSync(outputPath, rendered, { mode: 0o600, flag: "wx" });
  } else process.stdout.write(rendered);
  process.exitCode = result.ok && (!outputPath || Boolean(result.registration)) ? 0 : 1;
}
