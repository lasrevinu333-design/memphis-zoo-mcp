#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { compileStaticWeeklySchedule, postgresJsonbContentDigest } from "../src/static-weekly-schedule-compiler.js";
import { prepareStaticWeeklyRegistrationArtifact } from "./static-weekly-schedule-candidate-importer.mjs";

const BACKEND = path.resolve(process.cwd());
const CONFIG_PATH = path.join(BACKEND, "config/custodial-recurring-schedule-20260923.json");
const OUTPUT = process.argv[2];
if (!OUTPUT) throw new Error("Usage: generate-owner-corrected-static-weekly-schedule.mjs <output-packet.json>");
if (fs.existsSync(OUTPUT) || fs.existsSync(`${OUTPUT}.registration.json`)) throw new Error("Refusing to replace existing schedule evidence.");
const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fileHash = (file) => sha256(fs.readFileSync(file));
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const text = (value) => String(value ?? "").trim();
function deterministicUuid(label) {
  const bytes = Buffer.from(sha256(`memphis-zoo-owner-corrected-20260923:${label}`).slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const config = readJson(CONFIG_PATH);
assert.equal(config.schema, "custodial.owner-corrected-recurring-schedule.v1");
assert.equal(fileHash(config.basePacket.path), config.basePacket.sha256, "base schedule packet hash changed");
const base = readJson(config.basePacket.path);
assert.equal(base.packetSchema, "memphis-zoo.static-weekly.verified-schedule-packet.v1");
const input = clone(base.compilerInput);
const version = input.version;
assert.ok(version && !input.versions, "base packet must carry one canonical recurring version");
input.serviceDate = config.effectiveDate;
version.id = deterministicUuid(`version:${config.effectiveDate}:${fileHash(CONFIG_PATH)}`);
version.publicationId = deterministicUuid(`publication:${config.effectiveDate}:${fileHash(CONFIG_PATH)}`);
version.effectiveStart = config.effectiveDate;
version.effectiveEnd = null;
version.status = "published";
const slotEntries = Object.entries(config.slots);
const slotById = new Map(input.slots.map((slot) => [slot.id, slot]));
const keyBySlotId = new Map(slotEntries.map(([key, row]) => [row.slotId, key]));
for (const [key, row] of slotEntries) {
  const slot = slotById.get(row.slotId);
  assert.ok(slot, `stable slot missing: ${key}`);
  if (Array.isArray(row.history)) {
    slot.incumbencies = row.history.map((item) => ({
      personId: item.personId, displayName: item.name,
      effectiveStart: item.start, effectiveEnd: item.end,
    }));
  } else if (row.vacancy === true) slot.incumbencies = [];
  else {
    const active = (slot.incumbencies || []).filter((item) => item.effectiveStart <= config.effectiveDate
      && (!item.effectiveEnd || config.effectiveDate < item.effectiveEnd));
    assert.equal(active.length, 1, `${key} must retain exactly one active incumbent`);
    assert.equal(active[0].personId, row.personId, `${key} person identity changed`);
    assert.equal(active[0].displayName, row.name, `${key} name changed`);
  }
}
const vacancyIds = slotEntries.filter(([,row]) => row.vacancy === true).map(([,row]) => row.slotId).sort();
assert.deepEqual(vacancyIds, [config.slots.OPTION4.slotId,config.slots.OPTION1.slotId,config.slots.OPTION2.slotId].sort());
const baseAssignments = clone(version.assignments);
const phaseOf = (assignment) => assignment.window?.start === "09:45" ? "equalized" : "morning";
const affectedDays = new Set(Object.keys(config.overrides).map(Number));
const corrected = baseAssignments.filter((assignment) => !affectedDays.has(assignment.dayOfWeek));
function indexedOwnerMap(day, phase) {
  const map = new Map();
  for (const [slotKey, families] of Object.entries(config.overrides[String(day)][phase])) {
    const slot = config.slots[slotKey];
    assert.ok(slot.workDays.includes(day), `${slotKey} cannot own ${day}/${phase} while off`);
    for (const family of families) {
      assert.equal(map.has(family), false, `${day}/${phase}/${family} has duplicate owners`);
      map.set(family, slotKey);
    }
  }
  return map;
}
for (const day of [...affectedDays].sort()) for (const phase of ["morning","equalized"]) {
  const source = baseAssignments.filter((row) => row.dayOfWeek === day && phaseOf(row) === phase);
  const groups = new Map();
  for (const row of source) {
    const family = row.locationCodeSnapshot;
    const rows = groups.get(family) || []; rows.push(row); groups.set(family, rows);
  }
  const ownerMap = indexedOwnerMap(day, phase);
  assert.deepEqual([...ownerMap.keys()].sort(), [...groups.keys()].sort(), `${day}/${phase} family coverage changed`);
  for (const [family, rows] of [...groups.entries()].sort(([a],[b]) => a.localeCompare(b))) {
    const slotKey = ownerMap.get(family); const owner = config.slots[slotKey];
    const template = clone(rows[0]); const included = new Map();
    for (const row of rows) for (const loc of row.includedLocations || []) included.set(loc.locationId, clone(loc));
    const serviceEffortMinutes = rows.reduce((sum,row) => sum + Number(row.serviceEffortMinutes), 0);
    const reminderOnly = template.serviceMode === "reminder_only";
    template.workId = `${day}:${family}:${phase}:${owner.slotId.slice(0,8)}`;
    template.ownerSlotId = owner.slotId; template.originSlotId = owner.slotId;
    template.includedLocations = [...included.values()];
    template.locationId = template.includedLocations[0]?.locationId || template.locationId;
    template.window = reminderOnly ? {start:"08:00",end:"08:30"}
      : phase === "morning" ? {start:owner.shift[0],end:"09:45"}
        : {start:"09:45",end:owner.shift[1]};
    template.serviceEffortMinutes = serviceEffortMinutes;
    template.serviceEffortProvenance = `${template.serviceEffortProvenance}; owner-corrected recurring source=${fileHash(CONFIG_PATH)}`;
    corrected.push(template);
  }
}
corrected.sort((a,b) => a.dayOfWeek-b.dayOfWeek || a.window.start.localeCompare(b.window.start)
  || a.locationCodeSnapshot.localeCompare(b.locationCodeSnapshot) || a.workId.localeCompare(b.workId));
version.assignments = corrected;
version.namedAbsentSlotIds = [];
version.vacancyCapableSlotIds = [...vacancyIds];
version.vacantSlotIds = [...vacancyIds];
const baseTemplateBySlot = new Map();
for (const row of base.compilerInput.version.slotAvailability) if (!baseTemplateBySlot.has(row.slotId)) baseTemplateBySlot.set(row.slotId, row);
version.slotAvailability = [];
for (const [slotKey, owner] of slotEntries) for (const dayOfWeek of owner.workDays) {
  const template = clone(baseTemplateBySlot.get(owner.slotId));
  assert.ok(template, `availability template missing: ${slotKey}`);
  template.dayOfWeek = dayOfWeek;
  template.status = owner.vacancy === true ? "vacant_unfilled" : "working";
  template.shift = {start:owner.shift[0],end:owner.shift[1]};
  template.lunch = {start:owner.lunch[0],end:owner.lunch[1]};
  const anchor = version.assignments.find((row) => row.dayOfWeek === dayOfWeek
    && row.originSlotId === owner.slotId && row.serviceMode === "scan_tracked");
  assert.ok(anchor, `${slotKey} weekday ${dayOfWeek} has no physical routing anchor`);
  template.acceptedRouteAnchorLocationId = anchor.locationId;
  template.acceptedRouteProvenance = `owner-corrected recurring assignment anchor; source=${fileHash(CONFIG_PATH)}`;
  version.slotAvailability.push(template);
}
version.slotAvailability.sort((a,b) => a.dayOfWeek-b.dayOfWeek || a.slotId.localeCompare(b.slotId));
const activeBySlot = new Map(slotEntries.map(([key,row]) => [row.slotId,{key,...row}]));
for (const assignment of version.assignments) {
  const owner = activeBySlot.get(assignment.originSlotId);
  assert.ok(owner, `assignment owner is not one of the nine stable positions: ${assignment.workId}`);
  assert.ok(owner.workDays.includes(assignment.dayOfWeek), `${owner.key} owns work on an off day`);
  if ((owner.forbiddenFamilies || []).includes(assignment.locationCodeSnapshot)) {
    throw new Error(`${owner.key} received forbidden family ${assignment.locationCodeSnapshot}`);
  }
}
for (let day=0; day<7; day+=1) for (const phase of ["morning","equalized"]) {
  const oldFamilies = [...new Set(baseAssignments.filter((row) => row.dayOfWeek===day && phaseOf(row)===phase)
    .map((row) => row.locationCodeSnapshot))].sort();
  const newFamilies = [...new Set(version.assignments.filter((row) => row.dayOfWeek===day && phaseOf(row)===phase)
    .map((row) => row.locationCodeSnapshot))].sort();
  assert.deepEqual(newFamilies, oldFamilies, `${day}/${phase} gained or lost recurring location families`);
}
const physical = new Set();
for (const row of version.assignments.filter((item) => item.serviceMode === "scan_tracked")) {
  for (const loc of row.includedLocations || []) {
    const key = `${row.dayOfWeek}\0${phaseOf(row)}\0${loc.locationId}`;
    assert.equal(physical.has(key), false, `duplicate physical ownership: ${key}`);
    physical.add(key);
  }
}
const scheduleLoads = [];
function phaseOwnerFamilies(day, phase) {
  const result = new Map();
  for (const row of version.assignments.filter((item) => item.dayOfWeek===day && phaseOf(item)===phase)) {
    const key = keyBySlotId.get(row.originSlotId); const set = result.get(key) || new Set();
    set.add(row.locationCodeSnapshot); result.set(key,set);
  }
  return result;
}
for (const day of [...affectedDays].sort()) for (const phase of ["morning","equalized"]) {
  const byOwner = phaseOwnerFamilies(day,phase);
  const scheduled = slotEntries.filter(([,row]) => row.workDays.includes(day)).map(([key]) => key);
  assert.deepEqual([...byOwner.keys()].sort(), scheduled.sort(), `${day}/${phase} must use every scheduled position exactly as a position`);
  const rows = [];
  for (const slotKey of scheduled) {
    const families = [...byOwner.get(slotKey)].sort();
    const weightedLoad = families.reduce((sum,family) => sum + Number(config.weights[family] ?? 0),0);
    const restroomSites = families.filter((family) => config.publicRestroomFamilies.includes(family)).length;
    rows.push({slotKey,shiftStart:config.slots[slotKey].shift[0],weightedLoad,restroomSites,families});
  }
  const restroomCounts = rows.map((row) => row.restroomSites);
  assert.ok(Math.max(...restroomCounts)-Math.min(...restroomCounts) <= 1, `${day}/${phase} restroom-site fairness exceeds one site`);
  if (phase === "morning") {
    assert.equal(rows.some((row) => row.families.some((family) => config.adminFamilies.includes(family))), false, `${day} morning contains admin work`);
    const byStart = new Map();
    for (const row of rows) { const values=byStart.get(row.shiftStart)||[]; values.push(row.weightedLoad); byStart.set(row.shiftStart,values); }
    const means = [...byStart].sort(([a],[b]) => a.localeCompare(b)).map(([start,values]) => ({start,mean:values.reduce((a,b)=>a+b,0)/values.length}));
    for (let i=1;i<means.length;i+=1) assert.ok(means[i-1].mean + 1e-9 >= means[i].mean, `${day} morning start-time workload ladder reversed`);
  } else {
    const values=rows.map((row)=>row.weightedLoad);
    assert.ok(Math.max(...values)-Math.min(...values) <= 1.5 + 1e-9, `${day} 09:45 weighted spread exceeds 1.5`);
  }
  scheduleLoads.push({day,phase,rows});
}
for (const row of version.assignments) {
  const mondayOnly = config.mondayOnlyFamilies.includes(row.locationCodeSnapshot);
  if (mondayOnly) {
    assert.equal(row.dayOfWeek,1, `${row.locationCodeSnapshot} escaped Monday`);
    assert.equal(phaseOf(row),"morning", `${row.locationCodeSnapshot} escaped morning opening work`);
    const owner = activeBySlot.get(row.originSlotId);
    assert.ok(["07:00","08:00"].includes(owner.shift[0]) || row.locationCodeSnapshot === "ELEPHANT_TRUNK_RESTROOMS", `${row.locationCodeSnapshot} must stay with later opening staff`);
  }
}
const compileInput = clone(input);
compileInput.versions = [clone(input.version)];
delete compileInput.version;
const compiled = await compileStaticWeeklySchedule(compileInput);
assert.equal(compiled.status, "FEASIBLE", `corrected recurring schedule rejected: ${JSON.stringify(compiled.fatal || compiled.reviewWork || compiled.verifier)}`);
assert.equal(compiled.publicationAuthority, "ACCEPTABLE");
assert.equal(compiled.verifier?.ok, true);
assert.equal(compiled.reviewWork.length, 0, "corrected recurring schedule requires manager review");
const canonicalSource = compiled.canonicalAuthority?.compilerInput;
assert.ok(canonicalSource?.version && !canonicalSource.versions, "compiler did not emit one canonical source");
const sourceId = deterministicUuid(`source:${config.effectiveDate}:${fileHash(CONFIG_PATH)}`);
const rosterSlots = slotEntries.map(([slotKey,row]) => ({
  slotId: row.slotId, personId: row.personId, displayName: row.name,
  slotLabel: slotKey.startsWith("OPTION") ? `${slotKey.replace("OPTION", "Option ")} schedule position` : `${row.name} schedule position`,
  availabilityState: row.vacancy === true ? "vacant_unfilled" : "working",
  shift: {start:row.shift[0],end:row.shift[1]}, lunch:{start:row.lunch[0],end:row.lunch[1]}, days:[...row.workDays],
}));
const evidenceFiles = {
  ownerCorrectedSchedule: CONFIG_PATH,
  generator: path.join(BACKEND,"scripts/generate-owner-corrected-static-weekly-schedule.mjs"),
  baseVerifiedSchedule: config.basePacket.path,
  ownerDirectives: "/home/eric/Documents/Codex/2026-08-27/custodial-foundation-delivery/inputs/LATEST_USER_DIRECTIVES_2026-08-27.md",
  ownerCorrection: "/home/eric/Documents/Codex/2026-09-13/i-x20/outputs/OWNER_CORRECTION_20260920.md",
};
const packet = {
  packetSchema:"memphis-zoo.static-weekly.verified-schedule-packet.v1",
  publicationAuthority:"VERIFIED_SERVER_PACKET",
  effectiveDate:config.effectiveDate, sourceId, compilerInput:canonicalSource, rosterSlots,
  directedProximity:canonicalSource.proximity,
  acceptedRoutes:canonicalSource.version.slotAvailability.map((row)=>({slotId:row.slotId,dayOfWeek:row.dayOfWeek,status:row.status,startLocationId:row.acceptedRouteAnchorLocationId,provenance:row.acceptedRouteProvenance})),
  serviceEffort:canonicalSource.version.assignments.map((row)=>({workId:row.workId,dayOfWeek:row.dayOfWeek,workloadPoints:row.serviceEffortMinutes,unit:"dimensionless_production_workload_points",provenance:row.serviceEffortProvenance})),
  capacity:canonicalSource.version.slotAvailability.map((row)=>({slotId:row.slotId,dayOfWeek:row.dayOfWeek,status:row.status,shift:row.shift,lunch:row.lunch,maxDutyMinutes:row.maxDutyMinutes,maxServiceEffortMinutes:row.maxServiceEffortMinutes,provenance:row.productiveCapacityProvenance})),
  sourceDigest:postgresJsonbContentDigest(canonicalSource),
  verifiedAt:"2026-09-23T02:00:00.000Z",
  verifiedBy:"Eric Operle owner-corrected recurring schedule source verification",
  evidence:Object.entries(evidenceFiles).map(([kind,file])=>({kind,path:file,sha256:fileHash(file)})),
  verification:{
    compilerVersion:compiled.compilerVersion, verifierVersion:compiled.verifier.verifierVersion, verifierOk:true,
    replayDigest:compiled.replayDigest, basePacketSha256:config.basePacket.sha256,
    ownerCorrectedScheduleSha256:fileHash(CONFIG_PATH),
    stablePositions:9, staffedPositions:6, vacantPositions:3,
    preservedBaseDays:[...config.preserveBaseDays], affectedDays:[...affectedDays].sort(),
    scheduleLoads, productionWritten:false,
    note:"Source-only full-week replacement. Production staffing/publication remains separately gated."
  }
};
assert.equal(postgresJsonbContentDigest(packet.compilerInput), packet.sourceDigest);
const registration = await prepareStaticWeeklyRegistrationArtifact(packet);
assert.equal(registration.ok, true, `registration refused: ${registration.errors.join(",")}`);
assert.equal(registration.admissibleForRegistration, true);
assert.equal(registration.registration.sourceDigest, packet.sourceDigest);
fs.writeFileSync(OUTPUT, `${JSON.stringify(packet,null,2)}\n`, {mode:0o600,flag:"wx"});
fs.writeFileSync(`${OUTPUT}.registration.json`, `${JSON.stringify(registration.registration,null,2)}\n`, {mode:0o600,flag:"wx"});
process.stdout.write(`${JSON.stringify({output:OUTPUT,packetSha256:fileHash(OUTPUT),registrationSha256:fileHash(`${OUTPUT}.registration.json`),sourceId,sourceDigest:packet.sourceDigest,replayDigest:compiled.replayDigest,verification:packet.verification})}\n`);
