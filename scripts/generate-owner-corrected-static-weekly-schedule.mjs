#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { compileStaticWeeklySchedule, postgresJsonbContentDigest } from "../src/static-weekly-schedule-compiler.js";
import { prepareStaticWeeklyRegistrationArtifact } from "./static-weekly-schedule-candidate-importer.mjs";
import { createShiftEndContinuityPolicy } from "../src/static-weekly-shift-end-derivation.js";
import {validateOwnerEligibilityConfig,assertNormalOwnerEligibility,hardRestrictedSlots,verifiedBaseRestrictionInventory} from '../src/static-weekly-owner-eligibility.js';

const BACKEND = path.resolve(process.cwd());
const CONFIG_PATH = process.env.STATIC_WEEKLY_OWNER_CONFIG_PATH
  ? path.resolve(process.env.STATIC_WEEKLY_OWNER_CONFIG_PATH)
  : path.join(BACKEND, "config/custodial-recurring-schedule-20260924.json");
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
const BASE_PACKET_PATH = process.env.STATIC_WEEKLY_BASE_PACKET_PATH
  ? path.resolve(process.env.STATIC_WEEKLY_BASE_PACKET_PATH)
  : config.basePacket.path;
assert.equal(new Date(`${config.effectiveDate}T00:00:00Z`).getUTCDay(),1,"new recurring publication must start on a Monday");
validateOwnerEligibilityConfig(config);
assert.equal(fileHash(BASE_PACKET_PATH), config.basePacket.sha256, "base schedule packet hash changed");
const base = readJson(BASE_PACKET_PATH);
assert.equal(base.packetSchema, "memphis-zoo.static-weekly.verified-schedule-packet.v1");
const input = clone(base.compilerInput);
const baseRestrictionInventory=verifiedBaseRestrictionInventory(input,config.basePacket.sha256);
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
assert.equal(slotEntries.length, 9, "exactly nine stable employee positions required");
assert.ok(vacancyIds.length <= 3, "this release supports six through nine actual employees");
const baseAssignments = clone(version.assignments);
const retiredAreaFamilies = new Set(config.retiredAreaFamilies || []);
if (retiredAreaFamilies.size) {
  assert.equal(config.sourceHandout?.pdfSha256,
    '925751c37e454e0fadb9d88eb57a46dd6a47c1ffe19deadf85189ad9bba2f0aa',
    'retiring recurring families requires the exact approved September 28 handout');
  assert.deepEqual([...retiredAreaFamilies].sort(), [
    'BAMBOO_SPRINGS_GIFT_SHOP', 'ELEPHANT_TRUNK_GIFT_SHOP',
    'ELEPHANT_TRUNK_RESTROOMS', 'TRADING_POST_GIFT_SHOP',
  ], 'only the four historical gift-shop family codes may be retired');
}
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
  if (phase === 'morning' && config.allowAdminMorning === true) {
    // The reviewed base contained Admin upkeep only after 09:45. The exact
    // September 28 handout also authorizes a first clean before opening.
    // Reuse only the same day's physical Admin family definitions; the owned
    // work ID/window are recreated below and cannot alias the upkeep phase.
    source.push(...baseAssignments.filter((row) => row.dayOfWeek === day
      && phaseOf(row) === 'equalized' && config.adminFamilies.includes(row.locationCodeSnapshot)));
  }
  const groups = new Map();
  for (const row of source) {
    const family = row.locationCodeSnapshot;
    if (retiredAreaFamilies.has(family)) continue;
    const rows = groups.get(family) || []; rows.push(row); groups.set(family, rows);
  }
  const ownerMap = indexedOwnerMap(day, phase);
  assert.deepEqual([...ownerMap.keys()].sort(), [...groups.keys()].sort(), `${day}/${phase} family coverage changed`);
  for (const [family, rows] of [...groups.entries()].sort(([a],[b]) => a.localeCompare(b))) {
    const slotKey = ownerMap.get(family); const owner = config.slots[slotKey];
    const template = clone(rows[0]); const included = new Map();
    for (const row of rows) for (const loc of row.includedLocations || []) included.set(loc.locationId, clone(loc));
    let serviceEffortMinutes = rows.reduce((sum,row) => sum + Number(row.serviceEffortMinutes), 0);
    // Saturday Cat Country has four real shift-end responsibility segments
    // (Karen, Kathy, Alijah, Gregory) but the inherited dimensionless work
    // budget is three points. The compiler requires one positive point per
    // segment. This exact handout-bound accounting floor does not alter a
    // shift, area owner, service requirement, or cleaning history.
    const fourSegmentCatCountry = config.sourceHandout?.pdfSha256 ===
      '925751c37e454e0fadb9d88eb57a46dd6a47c1ffe19deadf85189ad9bba2f0aa'
      && day === 6 && phase === 'equalized' && family === 'CAT_COUNTRY';
    if (fourSegmentCatCountry) {
      assert.equal(serviceEffortMinutes, 3, 'unexpected Saturday Cat Country source budget');
      serviceEffortMinutes = 4;
    }
    const reminderOnly = template.serviceMode === "reminder_only";
    template.workId = `${day}:${family}:${phase}:${owner.slotId.slice(0,8)}`;
    template.ownerSlotId = owner.slotId; template.originSlotId = owner.slotId;
    template.includedLocations = [...included.values()];
    template.locationId = template.includedLocations[0]?.locationId || template.locationId;
    template.window = reminderOnly ? {start:"08:00",end:"08:30"}
      : phase === "morning" ? {start:owner.shift[0],end:"09:45"}
        : {start:"09:45",end:owner.shift[1]};
    template.serviceEffortMinutes = serviceEffortMinutes;
    template.serviceEffortProvenance = `${template.serviceEffortProvenance}; owner-corrected recurring source=${fileHash(CONFIG_PATH)}`
      + (fourSegmentCatCountry ? '; one-point positive four-segment continuity accounting floor' : '');
    corrected.push(template);
  }
}
corrected.sort((a,b) => a.dayOfWeek-b.dayOfWeek || a.window.start.localeCompare(b.window.start)
  || a.locationCodeSnapshot.localeCompare(b.locationCodeSnapshot) || a.workId.localeCompare(b.workId));
version.assignments = corrected;
version.namedAbsentSlotIds = [];
// Every stable employee position can become vacant on a later separation.
// Capability is not current vacancy. Only currently unfilled positions below
// are marked vacant in this immutable recurring source.
version.vacancyCapableSlotIds = slotEntries.map(([, row]) => row.slotId).sort();
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
  const lunch = owner.lunchByDay?.[String(dayOfWeek)] || owner.lunch;
  template.lunch = {start:lunch[0],end:lunch[1]};
  const anchor = version.assignments.find((row) => row.dayOfWeek === dayOfWeek
    && row.originSlotId === owner.slotId && row.serviceMode === "scan_tracked");
  if (owner.vacancy !== true) {
    assert.ok(anchor, `${slotKey} weekday ${dayOfWeek} has no physical routing anchor`);
    template.acceptedRouteAnchorLocationId = anchor.locationId;
    template.acceptedRouteProvenance = `owner-corrected recurring assignment anchor; source=${fileHash(CONFIG_PATH)}`;
  } else {
    assert.equal(anchor, undefined, `${slotKey} vacant position must not own a cleaning area`);
  }
  version.slotAvailability.push(template);
}
version.slotAvailability.sort((a,b) => a.dayOfWeek-b.dayOfWeek || a.slotId.localeCompare(b.slotId));
const activeBySlot = new Map(slotEntries.map(([key,row]) => [row.slotId,{key,...row}]));
for (const assignment of version.assignments) {
  const owner = activeBySlot.get(assignment.originSlotId);
  assert.ok(owner, `assignment owner is not one of the nine stable positions: ${assignment.workId}`);
  assert.ok(owner.workDays.includes(assignment.dayOfWeek), `${owner.key} owns work on an off day`);
  assertNormalOwnerEligibility(owner,assignment.locationCodeSnapshot);
}
for (let day=0; day<7; day+=1) for (const phase of ["morning","equalized"]) {
  const oldSource = baseAssignments.filter((row) => row.dayOfWeek===day && phaseOf(row)===phase);
  if (phase === 'morning' && config.allowAdminMorning === true) oldSource.push(...baseAssignments.filter((row) =>
    row.dayOfWeek===day && phaseOf(row)==='equalized' && config.adminFamilies.includes(row.locationCodeSnapshot)));
  const oldFamilies = [...new Set(oldSource
    .map((row) => row.locationCodeSnapshot).filter((family) => !retiredAreaFamilies.has(family)))].sort();
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
const exactSixPersonHandout = config.sourceHandout?.pdfSha256 ===
  '925751c37e454e0fadb9d88eb57a46dd6a47c1ffe19deadf85189ad9bba2f0aa';
let sourceHandout = null;
if (exactSixPersonHandout) {
  const sourcePath = path.resolve(BACKEND, config.sourceHandout.path);
  assert.equal(config.sourceHandout.jsonSha256,
    '4e0f1577b9f8f0b21560e059fde50d6c386aab8a4d7debe0deabb0b20010820d',
    'owner handout source identity changed');
  assert.equal(fileHash(sourcePath), config.sourceHandout.jsonSha256,
    'owner handout JSON changed');
  sourceHandout = readJson(sourcePath);
  assert.equal(sourceHandout.source_pdf_sha256, config.sourceHandout.pdfSha256);
  assert.deepEqual(config.sourceHandout.boundedCorrections, [{
    dayOfWeek: 5, phases: ['morning','equalized'], from: 'KAREN', to: 'KATHY',
    families: ['CATHOUSE_CAFE_RESTROOMS','EXPO'],
    reason: "Capacity-adjusted Friday workload correction using verified 1- and 4-minute proximity from Kathy's retained core route",
  }], 'only the exact reviewed Friday transfer is accepted');
  for (let day=0; day<7; day+=1) for (const [key, row] of Object.entries(sourceHandout.days[String(day)])) {
    assert.deepEqual(config.slots[key].shift,row.shift,`${day}/${key} approved shift changed`);
    assert.deepEqual(config.slots[key].lunchByDay[String(day)],row.lunch,`${day}/${key} approved lunch changed`);
    for (const phase of ['morning','equalized']) {
      const expected=[...(phase==='morning'?row.morning:row.checks)];
      if (day===5 && key==='KAREN') {
        for (const family of ['CATHOUSE_CAFE_RESTROOMS','EXPO']) {
          assert.ok(expected.includes(family),`Friday source is missing ${family}`);
          expected.splice(expected.indexOf(family),1);
        }
      }
      if (day===5 && key==='KATHY') expected.push('CATHOUSE_CAFE_RESTROOMS','EXPO');
      assert.deepEqual(new Set(config.overrides[String(day)][phase][key]),new Set(expected),
        `${day}/${phase}/${key} differs from handout beyond the exact Friday transfer`);
    }
  }
}
const minutes = (clock) => { const [h,m]=clock.split(':').map(Number);return h*60+m; };
const overlap = (a,b,c,d) => Math.max(0,Math.min(b,d)-Math.max(a,c));
function phaseHours(slotKey,day,phase) {
  const slot=config.slots[slotKey],lunch=slot.lunchByDay?.[String(day)]||slot.lunch;
  const a=phase==='morning'?minutes(slot.shift[0]):minutes('09:45');
  const b=phase==='morning'?minutes('09:45'):minutes(slot.shift[1]);
  const hours=(b-a-overlap(a,b,minutes(lunch[0]),minutes(lunch[1])))/60;
  assert.ok(Number.isFinite(hours)&&hours>0,`${day}/${phase}/${slotKey} lacks working capacity`);
  return hours;
}
const spread = (values) => Math.max(...values)-Math.min(...values);
function handoutRates(day,phase) {
  const records=Object.entries(sourceHandout.days[String(day)]);
  return {
    work: records.map(([key,row]) => (phase==='morning'?row.morning:row.checks)
      .reduce((sum,family) => sum+Number(config.weights[family]),0)/phaseHours(key,day,phase)),
    restrooms: records.map(([key,row]) => (phase==='morning'?row.morning:row.checks)
      .filter((family) => config.publicRestroomFamilies.includes(family)).length/phaseHours(key,day,phase)),
  };
}
const nonFridayEqualizedBound=exactSixPersonHandout
  ?Math.max(...[0,1,2,3,4,6].map((day) => spread(handoutRates(day,'equalized').work))):null;
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
  const scheduled = slotEntries.filter(([,row]) => row.vacancy !== true && row.workDays.includes(day)).map(([key]) => key);
  assert.deepEqual([...byOwner.keys()].sort(), scheduled.sort(), `${day}/${phase} must use every actual working employee`);
  const rows = [];
  for (const slotKey of scheduled) {
    const families = [...byOwner.get(slotKey)].sort();
    const weightedLoad = families.reduce((sum,family) => sum + Number(config.weights[family] ?? 0),0);
    const restroomSites = families.filter((family) => config.publicRestroomFamilies.includes(family)).length;
    rows.push({slotKey,shiftStart:config.slots[slotKey].shift[0],weightedLoad,restroomSites,families});
  }
  if (exactSixPersonHandout) {
    const baseline=handoutRates(day,phase);
    const currentWork=rows.map((row) => row.weightedLoad/phaseHours(row.slotKey,day,phase));
    const currentRestrooms=rows.map((row) => row.restroomSites/phaseHours(row.slotKey,day,phase));
    assert.ok(spread(currentWork)<=spread(baseline.work)+1e-9,
      `${day}/${phase} capacity-weighted workload regressed from the approved handout`);
    assert.ok(spread(currentRestrooms)<=spread(baseline.restrooms)+1e-9,
      `${day}/${phase} capacity-weighted restroom-site fairness regressed from the approved handout`);
    if (day===5 && phase==='equalized') assert.ok(spread(currentWork)<=nonFridayEqualizedBound+1e-9,
      'Friday post-09:45 must be no less balanced than the other approved days');
  } else {
    const restroomCounts = rows.map((row) => row.restroomSites);
    assert.ok(spread(restroomCounts) <= 1, `${day}/${phase} restroom-site fairness exceeds one site`);
  }
  if (phase === "morning") {
    if (config.allowAdminMorning === true) {
      assert.equal(config.sourceHandout?.pdfSha256,
        '925751c37e454e0fadb9d88eb57a46dd6a47c1ffe19deadf85189ad9bba2f0aa',
        'morning Admin ownership requires the exact owner-approved handout');
    } else assert.equal(rows.some((row) => row.families.some((family) => config.adminFamilies.includes(family))), false, `${day} morning contains admin work`);
    const byStart = new Map();
    for (const row of rows) { const values=byStart.get(row.shiftStart)||[]; values.push(row.weightedLoad); byStart.set(row.shiftStart,values); }
    const means = [...byStart].sort(([a],[b]) => a.localeCompare(b)).map(([start,values]) => ({start,mean:values.reduce((a,b)=>a+b,0)/values.length}));
    if (exactSixPersonHandout) {
      const baselineByStart=new Map();
      for (const [key,record] of Object.entries(sourceHandout.days[String(day)])) {
        const start=config.slots[key].shift[0],values=baselineByStart.get(start)||[];
        values.push(record.morning.reduce((sum,family) => sum+Number(config.weights[family]),0));
        baselineByStart.set(start,values);
      }
      const baselineMeans=[...baselineByStart].sort(([a],[b]) => a.localeCompare(b))
        .map(([start,values]) => ({start,mean:values.reduce((a,b)=>a+b,0)/values.length}));
      assert.deepEqual(means.map(({start}) => start),baselineMeans.map(({start}) => start));
      for (let i=1;i<means.length;i+=1) {
        const current=means[i-1].mean-means[i].mean;
        const accepted=baselineMeans[i-1].mean-baselineMeans[i].mean;
        assert.ok(current+1e-9>=Math.min(0,accepted),
          `${day} morning start-time workload ladder regressed from the approved handout`);
      }
    } else for (let i=1;i<means.length;i+=1)
      assert.ok(means[i-1].mean + 1e-9 >= means[i].mean, `${day} morning start-time workload ladder reversed`);
  } else {
    if (!exactSixPersonHandout) {
      const values=rows.map((row)=>row.weightedLoad);
      assert.ok(spread(values) <= 1.5 + 1e-9, `${day} 09:45 weighted spread exceeds 1.5`);
    }
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
// Keep all exact graph edges and capacity facts. Their full derivation is
// in the retained hash-bound source artifacts, not duplicated per edge/row.
for (const edge of input.proximity) edge.provenance = `base:${config.basePacket.sha256}`;
for (const availability of version.slotAvailability) {
  for (const key of Object.keys(availability).filter(key => key.endsWith("Provenance"))) {
    const ownerFact = ["productiveCapacityProvenance","maxDutyProvenance","restrictionProvenance","acceptedRouteProvenance"].includes(key);
    availability[key] = ownerFact ? `owner:${fileHash(CONFIG_PATH)}` : `base:${config.basePacket.sha256}`;
  }
}
// Only hard eligibility is global. Normal geography was validated above and
// must not prohibit legitimate nearby temporary lunch coverage.
for (const assignment of version.assignments) {
  assignment.restrictedSlotIds=hardRestrictedSlots(config,assignment.locationCodeSnapshot,assignment.restrictedSlotIds||[]);
  // The packet carries exact hash-bound source artifacts. Repeat references,
  // not the same long explanatory prose, inside every certificate work row.
  const adjustedSaturdayCatCountry = exactSixPersonHandout && assignment.dayOfWeek === 6
    && phaseOf(assignment) === 'equalized' && assignment.locationCodeSnapshot === 'CAT_COUNTRY';
  if (adjustedSaturdayCatCountry) assert.equal(assignment.serviceEffortMinutes, 4);
  assignment.serviceEffortProvenance = adjustedSaturdayCatCountry
    ? `base:${config.basePacket.sha256}:effort;owner:${fileHash(CONFIG_PATH)}:one-point positive four-segment continuity accounting floor`
    : `base:${config.basePacket.sha256}:effort`;
  assignment.priorityProvenance = `base:${config.basePacket.sha256}:priority`;
  assignment.qualificationProvenance = `base:${config.basePacket.sha256}:qualifications`;
  assignment.restrictionProvenance = `owner:${fileHash(CONFIG_PATH)}:hard_place_eligibility;base:${config.basePacket.sha256}`;

  assert.ok(!assignment.restrictedSlotIds.includes(assignment.ownerSlotId),
    `normal owner violates established area restriction: ${assignment.workId}`);
}
// Register the full immutable position template, not this roster's clipped
// closing rows. The canonical program derives the dated closing responsibilities
// after roster hydration; later fills never require a replacement source.
version.shiftEndContinuityPolicy = createShiftEndContinuityPolicy(config.weights, fileHash(CONFIG_PATH), postgresJsonbContentDigest);
const compileInput = clone(input);
compileInput.versions = [clone(input.version)];
delete compileInput.version;
const compiled = await compileStaticWeeklySchedule(compileInput);
if (process.env.STATIC_WEEKLY_DIAGNOSTIC === '1' && compiled.status !== 'FEASIBLE') {
  console.error(JSON.stringify({status:compiled.status,fatal:compiled.fatal,
    reviewWork:compiled.reviewWork,verifier:compiled.verifier},null,2));
}
assert.equal(compiled.status, "FEASIBLE", `corrected recurring schedule rejected: ${JSON.stringify(compiled.fatal || compiled.reviewWork || compiled.verifier)}`);
assert.equal(compiled.publicationAuthority, "ACCEPTABLE");
assert.equal(compiled.verifier?.ok, true);
assert.equal(compiled.reviewWork.length, 0, "corrected recurring schedule requires manager review");
const canonicalSource = compiled.canonicalAuthority?.compilerInput;
assert.ok(canonicalSource?.version && !canonicalSource.versions, "compiler did not emit one canonical source");
const shiftEndDerivation = compiled.canonicalAuthority.shiftEndDerivation;
assert.equal(compiled.canonicalAuthority.schema, "memphis-zoo.static-weekly-authority.v4");
assert.equal(shiftEndDerivation?.templateDigest, postgresJsonbContentDigest(canonicalSource));
assert.equal(canonicalSource.version.assignments.length,
  input.version.assignments.filter((row) => !retiredAreaFamilies.has(row.locationCodeSnapshot)).length,
  "registration must retain every non-retired source row");
const sourceId = deterministicUuid(`source:${config.effectiveDate}:${postgresJsonbContentDigest(canonicalSource)}`);
const rosterSlots = slotEntries.map(([slotKey,row]) => ({
  slotId: row.slotId, personId: row.personId, displayName: row.name,
  slotLabel: slotKey.startsWith("OPTION") ? `${slotKey.replace("OPTION", "Option ")} schedule position` : `${row.name} schedule position`,
  availabilityState: row.vacancy === true ? "vacant_unfilled" : "working",
  shift: {start:row.shift[0],end:row.shift[1]}, lunch:{start:row.lunch[0],end:row.lunch[1]}, days:[...row.workDays],
}));
const evidenceFiles = {
  ownerCorrectedSchedule: CONFIG_PATH,
  ...(config.sourceHandout?.path ? { correctedSixPersonAreaMap: path.resolve(BACKEND, config.sourceHandout.path) } : {}),
  eligibilityScope: path.join(BACKEND,'src/static-weekly-owner-eligibility.js'),
  generator: path.join(BACKEND,"scripts/generate-owner-corrected-static-weekly-schedule.mjs"),
  compiler: path.join(BACKEND,"src/static-weekly-schedule-compiler.js"),
  canonicalProgram: path.join(BACKEND,"src/static-weekly-schedule-program.js"),
  verifier: path.join(BACKEND,"src/static-weekly-schedule-verifier.js"),
  shiftEndCoverage: path.join(BACKEND,"src/static-weekly-shift-end-coverage.js"),
  shiftEndDerivation: path.join(BACKEND,"src/static-weekly-shift-end-derivation.js"),
  baseVerifiedSchedule: BASE_PACKET_PATH,
  ownerDirectives: process.env.STATIC_WEEKLY_OWNER_DIRECTIVES_PATH
    || "/home/eric/Documents/Codex/2026-08-27/custodial-foundation-delivery/inputs/LATEST_USER_DIRECTIVES_2026-08-27.md",
  ownerCorrection: process.env.STATIC_WEEKLY_OWNER_CORRECTION_PATH
    || "/home/eric/Documents/Codex/2026-09-13/i-x20/outputs/OWNER_CORRECTION_20260920.md",
  ownerClarificationsOC24: process.env.STATIC_WEEKLY_OWNER_CLARIFICATIONS_PATH
    || "/home/eric/Documents/Codex/2026-09-13/i-x20/outputs/OWNER_CLARIFICATIONS_20260924_OC24.md",
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
  verifiedAt:new Date().toISOString(),
  verifiedBy:"ChatGPT compiler/verifier against owner requirements; operational review separate",
  evidence:Object.entries(evidenceFiles).map(([kind,file])=>({kind,path:file,sha256:fileHash(file)})),
  verification:{
    compilerVersion:compiled.compilerVersion, verifierVersion:compiled.verifier.verifierVersion, verifierOk:true,
    replayDigest:compiled.replayDigest, basePacketSha256:config.basePacket.sha256,
    ownerCorrectedScheduleSha256:fileHash(CONFIG_PATH),
    stablePositions:9, staffedPositions:9-vacancyIds.length, vacantPositions:vacancyIds.length,
    preservedBaseDays:[...config.preserveBaseDays], affectedDays:[...affectedDays].sort(),
    scheduleLoads, shiftEndDerivation,
    continuityVerification:shiftEndDerivation.continuity, productionWritten:false,
    operationalReviewRequired:true,
    preHandoffSourceDigest:postgresJsonbContentDigest(input),
    provenanceReferences:{base:config.basePacket.sha256,owner:fileHash(CONFIG_PATH)},
    eligibilityScope:{baseRestrictionInventory,normalAssignmentGeography:slotEntries.filter(([,s])=>s.normalAssignmentFamilies)
      .map(([key,s])=>({slotKey:key,slotId:s.slotId,families:s.normalAssignmentFamilies,scope:'normal_assignment_geography'})),
      hardPlaceEligibility:slotEntries.filter(([,s])=>s.hardForbiddenFamilies)
      .map(([key,s])=>({slotKey:key,slotId:s.slotId,families:s.hardForbiddenFamilies,scope:'hard_place_eligibility'}))},
    note:"Full immutable position template with canonical dated closing derivation. Local compiler verification only; independent review and production staffing/publication remain separately gated."
  }
};
assert.equal(postgresJsonbContentDigest(packet.compilerInput), packet.sourceDigest);
const registration = await prepareStaticWeeklyRegistrationArtifact(packet);
assert.equal(registration.ok, true, `registration refused: ${registration.errors.join(",")}`);
assert.equal(registration.admissibleForRegistration, true);
assert.equal(registration.registration.sourceDigest, packet.sourceDigest);
fs.writeFileSync(`${OUTPUT}.pre-handoff.json`, `${JSON.stringify({compilerInput:input,classification:"UNPUBLISHED_SOURCE_TEMPLATE"},null,2)}\n`, {mode:0o600,flag:"wx"});
fs.writeFileSync(OUTPUT, `${JSON.stringify(packet,null,2)}\n`, {mode:0o600,flag:"wx"});
fs.writeFileSync(`${OUTPUT}.registration.json`, `${JSON.stringify(registration.registration,null,2)}\n`, {mode:0o600,flag:"wx"});
process.stdout.write(`${JSON.stringify({output:OUTPUT,packetSha256:fileHash(OUTPUT),registrationSha256:fileHash(`${OUTPUT}.registration.json`),sourceId,sourceDigest:packet.sourceDigest,replayDigest:compiled.replayDigest,verification:packet.verification})}\n`);
