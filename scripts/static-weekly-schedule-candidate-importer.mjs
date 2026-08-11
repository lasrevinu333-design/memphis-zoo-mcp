#!/usr/bin/env node
/*
 * Deterministic boundary between the supplied workbook candidate and a later
 * verified schedule packet.  It never infers missing roster identities,
 * routes, capacity, or publication readiness from presentation data.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKBOOK_SHA256 = "f9eba54e274cd1b792545770de6fb17e9e25fee989aca18f65250d433f599e40";
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function validateStaticWeeklyPacket(packet) {
  const errors = [];
  if (!packet || typeof packet !== "object") return { ok: false, classification: "INVALID", errors: ["packet_object_required"] };
  if (packet.packetSchema === "memphis-zoo.static-weekly.candidate-workbook.v1") {
    if (packet.classification !== "CANDIDATE_WORKBOOK_EVIDENCE_NOT_PRODUCTION_OR_PUBLICATION_AUTHORITY") errors.push("candidate_classification_required");
    if (packet.publicationAuthority !== "REVIEW_REQUIRED" || packet.admission?.canaryReady !== false || packet.admission?.requiresVerifiedSchedulePacket !== true) errors.push("candidate_must_fail_closed");
    if (packet.source?.sha256 !== WORKBOOK_SHA256) errors.push("candidate_workbook_hash_mismatch");
    if (!Array.isArray(packet.candidateRoster) || !packet.candidateRoster.length || packet.candidateRoster.some((row) => !UUID.test(row.slotId || "") || !UUID.test(row.personId || "") || !String(row.displayName || "").trim())) errors.push("candidate_roster_requires_uuid_source_facts");
    if (!Array.isArray(packet.unresolved?.absentUntilReplacedStableSlots) || packet.unresolved.absentUntilReplacedStableSlots.length !== 2) errors.push("two_departed_slot_identities_must_remain_unresolved");
    return { ok: errors.length === 0, classification: "CANDIDATE_ONLY", errors, contentDigest: hash(JSON.stringify(packet)) };
  }
  if (packet.packetSchema !== "memphis-zoo.static-weekly.verified-schedule-packet.v1") errors.push("unknown_packet_schema");
  if (packet.publicationAuthority !== "VERIFIED_SERVER_PACKET") errors.push("verified_packet_authority_required");
  for (const field of ["effectiveDate", "baseline", "rosterSlots", "directedProximity", "acceptedRoutes", "serviceEffort", "capacity", "sourceDigest"]) if (packet[field] == null) errors.push(`verified_packet_missing_${field}`);
  if (packet.sourceDigest && !/^[0-9a-f]{64}$/i.test(packet.sourceDigest)) errors.push("verified_packet_source_digest_required");
  if (Array.isArray(packet.rosterSlots) && packet.rosterSlots.some((row) => !UUID.test(row.slotId || "") || !UUID.test(row.personId || ""))) errors.push("verified_packet_uuid_identity_required");
  return { ok: errors.length === 0, classification: "VERIFIED_PACKET", errors, contentDigest: hash(JSON.stringify(packet)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const candidatePath = process.argv[2];
  if (!candidatePath) throw new Error("Usage: static-weekly-schedule-candidate-importer.mjs <candidate-or-verified-packet.json>");
  const packet = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
  const result = validateStaticWeeklyPacket(packet);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
