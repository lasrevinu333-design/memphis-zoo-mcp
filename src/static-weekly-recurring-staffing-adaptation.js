import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalJson, contentDigest } from "./static-weekly-schedule-model.js";
import { postgresJsonbContentDigest } from "./static-weekly-schedule-compiler.js";
import { normalizeStaticWeeklyAuthority } from "./static-weekly-schedule-program.js";
import { recurringPatternAuthority } from "./static-weekly-recurring-repair-basis.js";
import { createShiftEndContinuityPolicy } from "./static-weekly-shift-end-derivation.js";
import { assertNormalOwnerEligibility, hardRestrictedSlots,
  validateOwnerEligibilityConfig,normalGeographyRestrictionApplies } from "./static-weekly-owner-eligibility.js";
import {createRecurringPhaseDescriptor,createRecurringPhaseProspectiveSource,
  enumerateRecurringPhaseMinimum,evaluateRecurringPhaseCanonicalSource,
  solveRecurringPhaseCanonicalMinimum} from './static-weekly-recurring-phase-authority.js';

const phaseOf = (row) => row.window?.start === "09:45" ? "equalized" : "morning";
const expression = (terms) => terms.length
  ? terms.map(([n, variable]) => `${n < 0 ? "-" : "+"} ${Math.abs(n)} ${variable}`).join(" ").replace(/^\+ /, "")
  : "0";

// The nine-person source is a POSITION pattern. Its former incumbents are never
// imported into a new roster. A manager must separately confirm the current
// people, protected-work transition, and publication revision.
export function fullPositionOwnerMap(fullConfig, basePacket) {
  const result = {};
  const slotById = new Map(Object.entries(fullConfig.slots).map(([key, row]) => [row.slotId, key]));
  const assignments = basePacket.compilerInput.version.assignments;
  for (let day = 0; day < 7; day += 1) {
    result[String(day)] = {};
    for (const phase of ["morning", "equalized"]) {
      const chosen = {};
      const effortByFamily = new Map();
      for (const row of assignments.filter((item) => item.dayOfWeek === day && phaseOf(item) === phase)) {
        const owner = slotById.get(row.ownerSlotId);
        assert.ok(owner, `unknown full-staff owner ${row.ownerSlotId}`);
        const family = row.locationCodeSnapshot;
        const efforts = effortByFamily.get(family) || new Map();
        efforts.set(owner, (efforts.get(owner) || 0) + Number(row.serviceEffortMinutes || 0));
        effortByFamily.set(family, efforts);
      }
      // The nine-position source can split one family among positions. The
      // adapted pattern keeps that family together, so use its largest actual
      // nine-position effort share as the geographical preference only.
      for (const [family, efforts] of effortByFamily) chosen[family] = [...efforts]
        .sort(([a, effortA], [b, effortB]) => effortB - effortA || a.localeCompare(b))[0][0];
      const override = fullConfig.overrides?.[String(day)]?.[phase];
      if (override) {
        const replacement = {};
        for (const [owner, families] of Object.entries(override)) for (const family of families) {
          assert.ok(!replacement[family], `duplicate full-staff family ${day}/${phase}/${family}`);
          replacement[family] = owner;
        }
        assert.deepEqual(Object.keys(replacement).sort(), Object.keys(chosen).sort(), `full-staff family coverage ${day}/${phase}`);
        result[String(day)][phase] = replacement;
      } else result[String(day)][phase] = chosen;
    }
  }
  return result;
}

// Construct a candidate only from the authenticated manager snapshot's dated
// append-only roster view. The release template supplies position rules, not
// current people. Older dynamic incumbencies remain in the database ledger;
// this config carries only the current person needed by the compiler.
export function targetSlotsFromManagerRoster({ templateConfig, managerSnapshot, effectiveDate, expectedRevision }) {
  assert.match(String(effectiveDate || ""), /^\d{4}-\d{2}-\d{2}$/, "effective Monday required");
  assert.equal(new Date(`${effectiveDate}T12:00:00Z`).getUTCDay(), 1, "effective Monday required");
  assert.equal(managerSnapshot?.week_start, effectiveDate, "manager snapshot week mismatch");
  assert.ok(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, "expected manager revision required");
  assert.equal(managerSnapshot?.authority_revision, expectedRevision, "manager roster revision changed");
  assert.ok(Array.isArray(managerSnapshot?.roster), "authoritative manager roster required");
  const byId = new Map();
  for (const row of managerSnapshot.roster) {
    const id = String(row?.slot_id || "");
    assert.ok(id && !byId.has(id), "duplicate or unidentified manager roster position");
    byId.set(id, row);
  }
  const result = structuredClone(templateConfig.slots);
  for (const [key, slot] of Object.entries(result)) {
    const row = byId.get(slot.slotId);
    assert.ok(row && row.contractor_capacity !== true, `missing employee position ${key}`);
    const current = (row.incumbencies || []).filter((item) => item.effective_start <= effectiveDate
      && (!item.effective_end || effectiveDate < item.effective_end));
    assert.ok(current.length <= 1, `overlapping incumbent in ${key}`);
    const incumbent = current[0];
    if (!incumbent) {
      slot.vacancy = true; slot.personId = null; slot.name = null;
      continue;
    }
    const personId = String(incumbent.person_id || "");
    const name = String(incumbent.person_name || "").trim();
    assert.match(personId, /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i, `current person identity missing in ${key}`);
    assert.ok(name, `current person name missing in ${key}`);
    const staffing = new Map();
    for (const item of row.week_staffing || []) {
      const date = String(item.service_date || "");
      assert.ok(date && !staffing.has(date), `duplicate dated employee authority in ${key}`);
      staffing.set(date, item);
    }
    for (const day of slot.workDays) {
      const date = new Date(Date.parse(`${effectiveDate}T00:00:00Z`)
        + ((day + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
      const scheduled = staffing.get(date);
      assert.ok(scheduled?.person_id === personId && scheduled.employee_active === true,
        `current employee authority not confirmed in ${key}/${date}`);
    }
    slot.vacancy = false; slot.personId = personId; slot.name = name;
    slot.history = [...(slot.history || []).filter((item) => item.personId !== personId),
      { personId, name, start: incumbent.effective_start, end: null }];
  }
  return result;
}

// Reconstruct the currently published recurring pattern from an authority
// readback, never from a browser-supplied or workstation-local assignment map.
// An unsplit publication reconstructs its exact owner map. The one known
// split-family nine-position publication additionally requires the exact
// full-nine template and dominant-owner binding before adaptation.
export function currentPatternFromPublishedReadback({ publishedSource, managerSnapshot,
  templateConfig, fullConfig = null, fullOwners, effectiveDate, expectedRevision }) {
  const sourceId = String(publishedSource?.source_id || "");
  const patternAuthority = recurringPatternAuthority({publishedSource,managerSnapshot,effectiveDate,expectedRevision});
  const publicationId = patternAuthority.publicationId;
  assert.match(sourceId, /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i, "registered source identity required");
  assert.match(publicationId, /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i, "effective publication identity required");
  assert.equal(publishedSource.authority_revision, expectedRevision, "published source revision changed");
  assert.equal(managerSnapshot?.current_publication?.publication_id, publicationId,
    "manager snapshot publication changed");
  const slots = targetSlotsFromManagerRoster({ templateConfig, managerSnapshot,
    effectiveDate, expectedRevision });
  const input = publishedSource.compiler_input;
  assert.ok(input && Array.isArray(input.slots) && Array.isArray(input.version?.assignments),
    "published canonical compiler source required");
  const keyBySlot = new Map(Object.entries(slots).map(([key, slot]) => [slot.slotId, key]));
  assert.equal(keyBySlot.size, 9, "nine stable employee positions required");
  assert.ok(new Set(input.slots.map((row) => row.id)).size === input.slots.length,
    "published source contains duplicate positions");
  assert.ok([312, 313].includes(input.version.assignments.length),
    "published source assignment count changed");
  assert.ok(input.version.assignments.every((row) => Number.isInteger(row.dayOfWeek)
    && row.dayOfWeek >= 0 && row.dayOfWeek <= 6),
  "published source assignment day invalid");
  for (const [slotId, key] of keyBySlot) {
    const row = input.slots.find((item) => item.id === slotId);
    assert.ok(row, `published stable position missing ${slotId}`);
    const incumbent = (row.incumbencies || []).filter((person) => person.effectiveStart <= effectiveDate
      && (!person.effectiveEnd || effectiveDate < person.effectiveEnd));
    assert.equal(incumbent.length, slots[key].vacancy === true ? 0 : 1,
      `published roster occupancy changed ${key}`);
    if (slots[key].vacancy !== true) {
      assert.equal(incumbent[0].personId, slots[key].personId,
        `published roster person changed ${key}`);
      assert.equal(incumbent[0].displayName, slots[key].name,
        `published roster name changed ${key}`);
    }
  }
  const observed = {};
  let splitFamilyCount = 0;
  for (let day = 0; day < 7; day += 1) {
    observed[String(day)] = {};
    for (const phase of ["morning", "equalized"]) {
      const ownerByFamily = new Map();
      for (const row of input.version.assignments.filter((item) => item.dayOfWeek === day
        && phaseOf(item) === phase)) {
        const key = keyBySlot.get(row.ownerSlotId);
        // A just-vacated position may still own work in the old immutable
        // publication. It is valid *prior* geography, never a candidate owner.
        assert.ok(key && slots[key].workDays.includes(day),
          `published owner unavailable ${day}/${phase}/${row.locationCodeSnapshot}`);
        const family = row.locationCodeSnapshot;
        ownerByFamily.set(family, [...(ownerByFamily.get(family) || []),
          { key, effort: Number(row.serviceEffortMinutes || 0) }]);
      }
      assert.deepEqual([...ownerByFamily.keys()].sort(),
        Object.keys(fullOwners?.[String(day)]?.[phase] || {}).sort(),
        `published family coverage changed ${day}/${phase}`);
      for (const [family, owners] of ownerByFamily) {
        assert.ok(owners.length <= 2 && new Set(owners.map((owner) => owner.key)).size === owners.length,
          `published duplicate family ${day}/${phase}/${family}`);
        if (owners.length > 1) splitFamilyCount += 1;
      }
      observed[String(day)][phase] = ownerByFamily;
    }
  }
  const fullNine = splitFamilyCount > 0;
  if (fullNine) {
    assert.ok(fullConfig && input.version.assignments.length === 313 && splitFamilyCount === 1,
      "published split family requires the exact full-nine position pattern");
    for (let day = 0; day < 7; day += 1) for (const phase of ["morning", "equalized"]) {
      const override = fullConfig.overrides?.[String(day)]?.[phase];
      for (const [family, owners] of observed[String(day)][phase]) {
        if (override) {
          const expected = Object.entries(override).find(([, families]) => families.includes(family))?.[0];
          assert.deepEqual(owners.map((owner) => owner.key), [expected],
            `published full-template override changed ${day}/${phase}/${family}`);
        } else {
          const dominant = [...owners].sort((a, b) => b.effort - a.effort
            || a.key.localeCompare(b.key))[0]?.key;
          assert.equal(dominant, fullOwners[String(day)][phase][family],
            `published full-template base owner changed ${day}/${phase}/${family}`);
        }
      }
    }
  } else {
    assert.equal(input.version.assignments.length, 312,
      "published unsplit source assignment count changed");
  }
  const current = structuredClone(fullNine ? fullConfig : templateConfig);
  current.effectiveDate = effectiveDate;
  current.slots = slots;
  if (!fullNine) {
    current.preserveBaseDays = [];
    current.overrides = {};
    for (let day = 0; day < 7; day += 1) {
      current.overrides[String(day)] = {};
      for (const phase of ["morning", "equalized"]) {
        const ownerByFamily = observed[String(day)][phase];
        current.overrides[String(day)][phase] = Object.fromEntries(
          Object.keys(slots).map((key) => [key, [...ownerByFamily]
            .filter(([, owners]) => owners[0].key === key)
            .map(([family]) => family).sort()]).filter(([, families]) => families.length));
      }
    }
  }
  return { currentConfig: current, sourceId, publicationId,
    ...(patternAuthority.repairContext ? {patternPublicationId:patternAuthority.patternPublicationId,
      repairContext:patternAuthority.repairContext,repairContextDigest:patternAuthority.repairContextDigest} : {}),
    authorityRevision: expectedRevision, sourcePatternKind: fullNine ? "FULL_NINE" : "UNSPLIT",
    source: "AUTHORITY_READBACK_ONLY" };
}

// Produce a candidate from a supplied canonical compiler document. The caller
// must authenticate its release-registered source identity; this pure helper
// cannot do that or authorize registration/publication by itself.
export function adaptRegisteredRecurringSource({ registeredSource, patternConfig,
  fullNineSource = null, allowSplitSource = false }) {
  validateOwnerEligibilityConfig(patternConfig);
  const actual = Object.values(patternConfig?.slots || {}).filter((slot) => slot.vacancy !== true).length;
  assert.ok(actual >= 6 && actual <= 9, "six to nine current people required");
  const input = structuredClone(actual === 9 ? fullNineSource : registeredSource);
  assert.ok(input && Array.isArray(input.slots) && Array.isArray(input.version?.assignments)
    && Array.isArray(input.version?.slotAvailability), "registered canonical source required");
  const week = patternConfig.effectiveDate;
  assert.equal(new Date(`${week}T12:00:00Z`).getUTCDay(), 1, "candidate must start Monday");
  const bySlot = new Map(input.slots.map((row) => [row.id, row]));
  const keyBySlot = new Map(Object.entries(patternConfig.slots).map(([key, slot]) => [slot.slotId, key]));
  assert.equal(keyBySlot.size, 9, "nine stable employee positions required");
  for (const [key, slot] of Object.entries(patternConfig.slots)) {
    const row = bySlot.get(slot.slotId);
    assert.ok(row && row.contractorCapacity !== true, `registered position missing: ${key}`);
    const current = (row.incumbencies || []).filter((person) => person.effectiveStart <= week
      && (!person.effectiveEnd || week < person.effectiveEnd));
    assert.equal(current.length, slot.vacancy === true ? 0 : 1, `current registered incumbent mismatch: ${key}`);
    if (slot.vacancy !== true) {
      assert.equal(current[0].personId, slot.personId, `registered person mismatch: ${key}`);
      assert.equal(current[0].displayName, slot.name, `registered name mismatch: ${key}`);
    }
  }
  const fingerprint = createHash("sha256").update(canonicalJson(patternConfig)).digest("hex");
  const affectedDays = Object.keys(patternConfig.overrides || {}).map(Number);
  assert.ok(affectedDays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  if (actual !== 9) assert.equal(affectedDays.length, 7, "all seven days must be adapted below full staffing");
  else assert.deepEqual([...affectedDays, ...(patternConfig.preserveBaseDays || [])].sort(),
    [0,1,2,3,4,5,6], "full-position template must account for every day");
  const original = input.version.assignments;
  const revised = original.filter((row) => !affectedDays.includes(row.dayOfWeek));
  for (const day of affectedDays) for (const phase of ["morning", "equalized"]) {
    const assignments = patternConfig.overrides[String(day)]?.[phase];
    assert.ok(assignments, `missing candidate assignment ${day}/${phase}`);
    const wanted = new Map();
    for (const [key, families] of Object.entries(assignments)) for (const family of families) {
      assert.ok(!wanted.has(family), `duplicate candidate family ${day}/${phase}/${family}`);
      wanted.set(family, key);
    }
    const groups = new Map();
    for (const row of original.filter((item) => item.dayOfWeek === day && phaseOf(item) === phase)) {
      const family = row.locationCodeSnapshot;
      const group = groups.get(family) || []; group.push(row); groups.set(family, group);
    }
    assert.deepEqual([...wanted.keys()].sort(), [...groups.keys()].sort(),
      `candidate must preserve every source family ${day}/${phase}`);
    for (const [family, rows] of groups) {
      if (actual !== 9 && !allowSplitSource) assert.equal(rows.length, 1,
        `source splits one family; explicit full-nine source required: ${day}/${phase}/${family}`);
      const ownerKey = wanted.get(family), owner = patternConfig.slots[ownerKey];
      assert.ok(owner && owner.workDays.includes(day) && owner.vacancy !== true,
        `candidate owner unavailable: ${day}/${phase}/${family}`);
      const row = structuredClone(rows[0]);
      const included = new Map();
      for (const old of rows) for (const place of old.includedLocations || [])
        included.set(place.locationId, structuredClone(place));
      row.includedLocations = [...included.values()];
      row.locationId = row.includedLocations[0]?.locationId || row.locationId;
      row.serviceEffortMinutes = rows.reduce((sum, old) => sum + Number(old.serviceEffortMinutes), 0);
      row.workId = `${day}:${family}:${phase}:${owner.slotId.slice(0, 8)}`;
      row.ownerSlotId = owner.slotId; row.originSlotId = owner.slotId;
      row.window = row.serviceMode === "reminder_only" ? { start: "08:00", end: "08:30" }
        : phase === "morning" ? { start: owner.shift[0], end: "09:45" }
          : { start: "09:45", end: owner.shift[1] };
      revised.push(row);
    }
  }
  revised.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.window.start.localeCompare(b.window.start)
    || a.locationCodeSnapshot.localeCompare(b.locationCodeSnapshot) || a.workId.localeCompare(b.workId));
  input.version.assignments = revised;
  input.serviceDate = week;
  input.version.effectiveStart = week;
  input.version.effectiveEnd = null;
  input.version.status = "published";
  // The readback includes accepted date-specific exceptions for execution.
  // A new recurring pattern must not inherit PTO, call-outs, manual CoverAll,
  // lunch overrides or reversals. Keep the original ledger/source untouched;
  // the dated projection reapplies its own accepted overlays after publication.
  input.exceptions = [];
  input.version.namedAbsentSlotIds = [];
  input.version.vacancyCapableSlotIds = [...keyBySlot.keys()].sort();
  input.version.vacantSlotIds = Object.values(patternConfig.slots)
    .filter((slot) => slot.vacancy === true).map((slot) => slot.slotId).sort();
  const availabilityTemplate = new Map();
  for (const row of input.version.slotAvailability) if (!availabilityTemplate.has(row.slotId))
    availabilityTemplate.set(row.slotId, row);
  input.version.slotAvailability = [
    ...input.version.slotAvailability.filter((row) => !keyBySlot.has(row.slotId)),
    ...Object.values(patternConfig.slots).flatMap((slot) => slot.workDays.map((dayOfWeek) => {
      const template = availabilityTemplate.get(slot.slotId);
      assert.ok(template, `registered availability template missing ${slot.slotId}`);
      return { ...structuredClone(template), dayOfWeek };
    })),
  ].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.slotId.localeCompare(b.slotId));
  for (const row of input.version.slotAvailability) {
    const key = keyBySlot.get(row.slotId);
    if (!key) continue;
    const slot = patternConfig.slots[key];
    row.status = slot.vacancy === true ? "vacant_unfilled" : "working";
    row.shift = { start: slot.shift[0], end: slot.shift[1] };
    row.lunch = { start: slot.lunch[0], end: slot.lunch[1] };
    if (slot.vacancy !== true) {
      const anchor = input.version.assignments.find((assignment) => assignment.dayOfWeek === row.dayOfWeek
        && assignment.originSlotId === slot.slotId && assignment.serviceMode === "scan_tracked");
      assert.ok(anchor, `missing accepted route anchor ${key}/${row.dayOfWeek}`);
      row.acceptedRouteAnchorLocationId = anchor.locationId;
      row.acceptedRouteProvenance = `manager-preview candidate ${fingerprint}`;
    }
  }
  const baseHash = patternConfig.basePacket?.sha256;
  assert.match(String(baseHash || ""), /^[a-f0-9]{64}$/, "verified base packet identity required");
  for (const edge of input.proximity || []) edge.provenance = `base:${baseHash}`;
  for (const availability of input.version.slotAvailability) {
    for (const key of Object.keys(availability).filter((item) => item.endsWith("Provenance"))) {
      availability[key] = ["productiveCapacityProvenance", "maxDutyProvenance",
        "restrictionProvenance", "acceptedRouteProvenance"].includes(key)
        ? `owner:${fingerprint}` : `base:${baseHash}`;
    }
  }
  for (const assignment of input.version.assignments) {
    const ownerKey = keyBySlot.get(assignment.originSlotId);
    assert.ok(ownerKey, `assignment owner outside stable positions ${assignment.workId}`);
    assertNormalOwnerEligibility({ key: ownerKey, ...patternConfig.slots[ownerKey] },
      assignment.locationCodeSnapshot);
    assignment.restrictedSlotIds = hardRestrictedSlots(patternConfig, assignment.locationCodeSnapshot,
      assignment.restrictedSlotIds || []);
    assert.ok(!assignment.restrictedSlotIds.includes(assignment.ownerSlotId),
      `hard-restricted source owner ${assignment.workId}`);
    assignment.serviceEffortProvenance = `base:${baseHash}:effort`;
    assignment.priorityProvenance = `base:${baseHash}:priority`;
    assignment.qualificationProvenance = `base:${baseHash}:qualifications`;
    assignment.restrictionProvenance = `owner:${fingerprint}:hard_place_eligibility;base:${baseHash}`;
  }
  input.version.shiftEndContinuityPolicy = createShiftEndContinuityPolicy(
    patternConfig.weights, fingerprint, postgresJsonbContentDigest);
  // Store and hash the same canonical collection ordering the compiler uses.
  // SQL compares the whole registered structural identity, including array
  // order. Locally sorting by label/UUID is not that canonical identity and
  // otherwise makes a correct preview impossible to admit as a draft.
  const canonicalInput = normalizeStaticWeeklyAuthority(input.version, input.slots,
    input.exceptions, input.proximity, input.serviceDate);
  return { compilerInput: canonicalInput, patternFingerprint: fingerprint,
    status: "CANDIDATE_ONLY", registrationRequired: true, managerConfirmationRequired: true };
}

// Secondary geography reference, not permission to create work. The caller's
// current pattern is reconstructed from authenticated publication readback.
// Only the two explicitly authorized Admin morning families may be absent
// from the frozen historical map; all other absent references remain errors.
export function recurringSecondaryOwnerReference({currentConfig,fullOwners,day,phase,family,sourceOwner}){
  const historical=fullOwners?.[String(day)]?.[phase]?.[family];
  if(historical!==undefined){
    assert.ok(currentConfig.slots[historical],`unknown nine-position guidance ${day}/${phase}/${family}`);
    return {owner:historical,kind:'HISTORICAL_FULL_POSITION'};
  }
  const prior=sourceOwner.get(family),equalized=fullOwners?.[String(day)]?.equalized?.[family];
  assert.ok(phase==='morning'&&currentConfig.allowAdminMorning===true
    &&['EAST_ADMIN','WEST_ADMIN'].includes(family)&&currentConfig.adminFamilies?.includes(family)
    &&typeof equalized==='string'&&currentConfig.slots[equalized]
    &&typeof prior==='string'&&currentConfig.slots[prior],
  `missing nine-position guidance ${day}/${phase}/${family}`);
  const configured=Object.entries(currentConfig.overrides?.[String(day)]?.morning||{})
    .filter(([,families])=>families.includes(family)).map(([key])=>key);
  assert.deepEqual(configured,[prior],`Admin morning reference differs from exact current pattern ${day}/${family}`);
  return {owner:prior,kind:'AUTHORIZED_ADMIN_MORNING_CURRENT_SOURCE',family,day,
    sourceOwnerSlotId:currentConfig.slots[prior].slotId,currentConfigDigest:contentDigest(currentConfig),
    historicalEqualizedOwner:equalized};
}

export function deriveRecurringStaffingPattern({ currentConfig, targetSlots, fullOwners, fullConfig, highs }) {
  assert.ok(currentConfig && targetSlots && fullOwners && highs?.solve);
  validateOwnerEligibilityConfig({...currentConfig,slots:targetSlots});
  const keys = Object.keys(currentConfig.slots).sort();
  assert.deepEqual(Object.keys(targetSlots).sort(), keys, "nine stable positions must be retained");
  assert.equal(keys.length, 9, "nine employee positions required");
  const activeKeys = keys.filter((key) => targetSlots[key].vacancy !== true);
  assert.ok(activeKeys.length >= 6 && activeKeys.length <= 9, "supported staffing is six to nine");
  const incumbentIds = activeKeys.map((key) => String(targetSlots[key].personId || "").toLowerCase());
  assert.equal(new Set(incumbentIds).size, activeKeys.length, "one current employee may occupy only one position");
  for (const key of keys) {
    assert.equal(targetSlots[key].slotId, currentConfig.slots[key].slotId, `stable position changed: ${key}`);
    assert.deepEqual(targetSlots[key].workDays, currentConfig.slots[key].workDays, `work pattern changed: ${key}`);
    assert.deepEqual(targetSlots[key].shift, currentConfig.slots[key].shift, `shift changed: ${key}`);
    assert.deepEqual(targetSlots[key].lunch, currentConfig.slots[key].lunch, `fixed lunch changed: ${key}`);
    if (targetSlots[key].vacancy !== true) {
      assert.match(String(targetSlots[key].personId || ""), /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i, `incumbent identity required: ${key}`);
      assert.ok(String(targetSlots[key].name || "").trim(), `incumbent name required: ${key}`);
    }
  }
  if (activeKeys.length === 9) {
    assert.ok(fullConfig, "approved full nine-position source required for nine staff");
    // All positions staffed: return the owner's existing nine-position source
    // exactly, including its intentionally split families. Change only the
    // current incumbencies; former people in the base packet are not revived.
    assert.deepEqual(Object.keys(fullConfig.slots).sort(), keys);
    const restored = structuredClone(fullConfig);
    restored.slots = structuredClone(targetSlots);
    restored.effectiveDate = currentConfig.effectiveDate;
    restored.correctionNotes = [
      "Nine staffed positions use the existing approved full-staff position pattern without re-optimization.",
      "Incumbents are current roster identities only; historical people are not restored from the pattern."
    ];
    return { config: restored, preview: [{ pattern: "existing-nine-position-template", publicationRequired: true }] };
  }
  const result = structuredClone(currentConfig);
  result.slots = structuredClone(targetSlots);
  result.preserveBaseDays = [];
  result.overrides = {};
  const preview = [];
  const restroom = new Set(result.publicRestroomFamilies);
  const isFullPositionPattern = currentConfig.preserveBaseDays?.length > 0;
  if (isFullPositionPattern) {
    assert.ok(fullConfig, "full-position source required when reducing from nine staff");
    assert.deepEqual(currentConfig.overrides, fullConfig.overrides, "current full-position overrides changed");
    assert.deepEqual(currentConfig.preserveBaseDays, fullConfig.preserveBaseDays,
      "current full-position base days changed");
  }
  for (let day = 0; day < 7; day += 1) {
    result.overrides[String(day)] = {};
    for (const phase of ["morning", "equalized"]) {
      const previous = currentConfig.overrides?.[String(day)]?.[phase]
        || (isFullPositionPattern && Object.fromEntries(keys.map((owner) => [owner,
          Object.entries(fullOwners[String(day)]?.[phase] || {})
            .filter(([, preferred]) => preferred === owner).map(([family]) => family)])));
      assert.ok(previous, `current static baseline missing ${day}/${phase}`);
      const sourceOwner = new Map();
      for (const [owner, families] of Object.entries(previous)) for (const family of families) {
        assert.ok(!sourceOwner.has(family), `duplicate current family ${day}/${phase}/${family}`);
        sourceOwner.set(family, owner);
      }
      const families = [...sourceOwner.keys()].sort();
      const owners = activeKeys.filter((key) => targetSlots[key].workDays.includes(day));
      assert.ok(owners.length >= 3, `insufficient working custodians ${day}`);
      const vars = new Map();
      const all = [];
      for (let f = 0; f < families.length; f += 1) for (let o = 0; o < owners.length; o += 1) {
        const family = families[f], owner = owners[o];
        if (targetSlots[owner].hardForbiddenFamilies?.includes(family)) continue;
        if (normalGeographyRestrictionApplies({key:owner,...targetSlots[owner]})
          && !targetSlots[owner].normalAssignmentFamilies.includes(family)) continue;
        // Monday-only route packages stay with their actual handout owner.
        if (result.mondayOnlyFamilies.includes(family) && sourceOwner.get(family) !== owner) continue;
        const variable = `x_${f}_${o}`;
        vars.set(`${family}\0${owner}`, variable); all.push(variable);
      }
      const termsFor = (owner, weighted, sitesOnly = false) => families.flatMap((family) => {
        const variable = vars.get(`${family}\0${owner}`);
        return variable && (!sitesOnly || restroom.has(family))
          ? [[weighted ? result.weights[family] * 2 : 1, variable]] : [];
      });
      const constraints = families.map((family, index) => {
        const options = owners.map((owner) => vars.get(`${family}\0${owner}`)).filter(Boolean);
        assert.ok(options.length, `unassignable family ${day}/${phase}/${family}`);
        return ` cover_${index}: ${expression(options.map((variable) => [1, variable]))} = 1`;
      });
      for (let a = 0; a < owners.length; a += 1) for (let b = 0; b < owners.length; b += 1) if (a !== b) {
        constraints.push(` sites_${a}_${b}: ${expression([...termsFor(owners[a], false, true), ...termsFor(owners[b], false, true).map(([n,v]) => [-n,v])])} <= 1`);
        if (phase === "equalized") constraints.push(` load_${a}_${b}: ${expression([...termsFor(owners[a], true), ...termsFor(owners[b], true).map(([n,v]) => [-n,v])])} <= 3`);
      }
      const groups = new Map();
      if (phase === "morning") {
        for (const owner of owners) {
          const start = targetSlots[owner].shift[0];
          groups.set(start, [...(groups.get(start) || []), owner]);
        }
        const starts = [...groups.keys()].sort();
        for (let i = 1; i < starts.length; i += 1) {
          const early = groups.get(starts[i - 1]), late = groups.get(starts[i]);
          constraints.push(` ladder_${i}: ${expression([
            ...early.flatMap((owner) => termsFor(owner, true).map(([n,v]) => [-n * late.length,v])),
            ...late.flatMap((owner) => termsFor(owner, true).map(([n,v]) => [n * early.length,v])),
          ])} <= 0`);
        }
      }
      const costs = new Map();
      const secondaryReferences=new Map(families.map(family=>[family,recurringSecondaryOwnerReference({currentConfig,fullOwners,
        day,phase,family,sourceOwner})]));
      for (const family of families) for (const owner of owners) {
        const variable = vars.get(`${family}\0${owner}`);
        if (!variable) continue;
        const fullOwner = secondaryReferences.get(family).owner;
        // Preserve current geography first. Within balanced solutions, prefer
        // the approved nine-position area and that position's normal region.
        const cost = (sourceOwner.get(family) !== owner ? 100 : 0)
          + (fullOwner !== owner ? 4 : 0)
          + (targetSlots[owner].normalAssignmentFamilies?.includes(family) ? 0 : 2);
        costs.set(variable, cost);
      }
      const primary = [...costs].map(([variable, cost]) => [cost, variable]);
      const fixed = [];
      const solve = (objective, extra = []) => highs.solve(
        `Minimize\n obj: ${expression(objective)}\nSubject To\n${[...constraints, ...fixed, ...extra].join("\n")}\nBinary\n ${all.join(" ")}\nEnd`,
        { time_limit: 30, mip_rel_gap: 0 },
      );
      const selected = (solution) => families.map((family) => {
        const choices = owners.map((owner) => vars.get(`${family}\0${owner}`))
          .filter((variable) => variable && solution.Columns[variable]?.Primal > 0.5);
        assert.equal(choices.length, 1, `non-unique owner ${day}/${phase}/${family}`);
        return choices[0];
      });
      let solved = solve(primary);
      assert.equal(solved.Status, "Optimal", `no balanced ${activeKeys.length}-person plan ${day}/${phase}: ${solved.Status}`);
      const optimum = selected(solved).reduce((sum, variable) => sum + costs.get(variable), 0);
      fixed.push(` primary_opt: ${expression(primary)} = ${optimum}`);
      for (let offset = 0; offset < families.length; offset += 10) {
        const chunk = families.slice(offset, offset + 10);
        const objective = chunk.flatMap((family, index) => owners.flatMap((owner, ownerIndex) => {
          const variable = vars.get(`${family}\0${owner}`);
          const coefficient = ownerIndex * (owners.length ** (chunk.length - index - 1));
          return variable && coefficient ? [[coefficient, variable]] : [];
        }));
        solved = solve(objective);
        assert.equal(solved.Status, "Optimal", `tie selection failed ${day}/${phase}/${offset}`);
        const value = objective.reduce((sum, [n, variable]) => sum + (solved.Columns[variable]?.Primal > 0.5 ? n : 0), 0);
        assert.ok(Number.isSafeInteger(value));
        fixed.push(` lex_${offset}: ${expression(objective)} = ${value}`);
      }
      const exact = selected(solved);
      const alternate = solve(primary, [` no_alternate: ${expression(exact.map((variable) => [1,variable]))} <= ${families.length - 1}`]);
      assert.equal(alternate.Status, "Infeasible", `plan not proven unique ${day}/${phase}`);
      const chosen = Object.fromEntries(owners.map((owner) => [owner, []]));
      for (const family of families) {
        const owner = owners.find((key) => {
          const variable = vars.get(`${family}\0${key}`);
          return variable && solved.Columns[variable]?.Primal > 0.5;
        });
        assert.ok(owner); chosen[owner].push(family);
      }
      assert.ok(owners.every((owner) => chosen[owner].length), `empty staffed shift ${day}/${phase}`);
      result.overrides[String(day)][phase] = chosen;
      preview.push({ day, phase, secondaryPreferenceBindings:[...secondaryReferences.values()].filter(row=>row.kind!=='HISTORICAL_FULL_POSITION'),
        employees: owners.map((owner) => ({ owner,
        weightedLoad: chosen[owner].reduce((n,family) => n + result.weights[family], 0),
        restroomSites: chosen[owner].filter((family) => restroom.has(family)).length,
        gained: chosen[owner].filter((family) => sourceOwner.get(family) !== owner),
        released: [...sourceOwner].filter(([family, prior]) => prior === owner && !chosen[owner].includes(family)).map(([family]) => family),
      })) });
    }
  }
  result.correctionNotes = [
    `${activeKeys.length} actual incumbents in nine stable positions; source is a manager-preview candidate, not an automatic daily reshuffle.`,
    "Six-person current and approved nine-position geographic patterns bound redistribution; fixed lunches and hard restrictions retained.",
    "Publication must be independently reviewed, revision-bound, protected-work safe and explicitly manager-confirmed."
  ];
  return { config: result, preview };
}

// Pure bounded phase adapter for the EXISTING deliberate recurring-replacement
// command. Scope is derived from its complete candidate, never an employee
// selector or a caller-controlled canonical owner unlock. Runtime command/CP
// coupling remains separate until authority/source/receipt hooks are bound.
export function deriveCanonicalRecurringPhaseCandidate({source,currentConfig,fullOwners,dayOfWeek}) {
  const sourceVersion=source.version||(source.versions?.length===1?source.versions[0]:null);
  assert.ok(sourceVersion&&Array.isArray(sourceVersion.assignments));
  const selectedWorkIds=sourceVersion.assignments.filter(row=>row.dayOfWeek===dayOfWeek
    &&row.window?.start==='09:45').map(row=>row.workId);
  const input={source,ownerConfig:currentConfig,dayOfWeek,selectedWorkIds};
  const proof=enumerateRecurringPhaseMinimum(input);
  const basis={sourceDigest:contentDigest(source),configDigest:contentDigest(currentConfig),
    fullOwnersDigest:contentDigest(fullOwners),dayOfWeek,phase:'equalized',
    scope:'DERIVED_FROM_COMPLETE_RECURRING_REPLACEMENT_CANDIDATE_OTHER_DAYS_AND_MORNING_FIXED',
    publication:false,admitted:false};
  if(proof.status!=='PROVEN_MINIMUM_COMPLETE_SELECTED_SCOPE')return {...basis,status:proof.status,proof,candidateSource:null};
  const descriptor=createRecurringPhaseDescriptor(input);
  const keys=Object.keys(currentConfig.slots).sort();
  const keyBySlot=new Map(keys.map(key=>[currentConfig.slots[key].slotId,key]));
  const ownerKeys=keys.filter(key=>descriptor.owners.some(o=>o.slotId===currentConfig.slots[key].slotId));
  const byId=new Map(descriptor.packages.map(p=>[p.workId,p]));
  const sourceOwner=new Map(sourceVersion.assignments.map(r=>[r.workId,keyBySlot.get(r.originSlotId||r.ownerSlotId)]));
  const candidates=proof.receipts.filter(r=>r.canonicalFeasible&&r.publicSiteValid&&r.nonemptyPhaseOwners&&r.selectedPackagesCovered&&r.doubledSpread===proof.minimumDoubledSpread)
    .map(r=>{
      // Match the inherited families.sort() code-unit ordering, not a locale.
      const byFamily=[...r.selection].sort((a,b)=>{
        const x=byId.get(a.workId).family,y=byId.get(b.workId).family;return x<y?-1:x>y?1:0;
      });
      let cost=0;
      const identity=[];
      for(const row of byFamily){
        const family=byId.get(row.workId).family,owner=keyBySlot.get(row.slotId),fullOwner=fullOwners[String(dayOfWeek)]?.equalized?.[family];
        assert.ok(fullOwner,'Exact existing full-position guidance required for phase preference.');
        // Exact inherited 100/4/2 preference and owner-key identity order.
        cost+=(sourceOwner.get(row.workId)!==owner?100:0)+(fullOwner!==owner?4:0)
          +(currentConfig.slots[owner].normalAssignmentFamilies?.includes(family)?0:2);
        identity.push(ownerKeys.indexOf(owner));
      }
      return {receipt:r,cost,identity};
    });
  candidates.sort((a,b)=>a.cost-b.cost||a.identity.reduce((delta,x,i)=>delta||x-b.identity[i],0));
  assert.ok(candidates.length);
  const chosen=candidates[0],candidateSource=createRecurringPhaseProspectiveSource({...input,descriptor,selection:chosen.receipt.selection});
  const canonical=evaluateRecurringPhaseCanonicalSource(candidateSource);
  assert.equal(canonical.feasible,true);
  assert.equal(canonical.sourceDigest,chosen.receipt.sourceDigest);
  const body={...basis,status:'UNREGISTERED_CANONICAL_PHASE_CANDIDATE',proof,candidateSource,
    candidateSourceDigest:contentDigest(candidateSource),selectedOwnership:chosen.receipt.selection,
    preferenceCost:chosen.cost,stableIdentity:chosen.identity,canonicalHardWitness:canonical,
    existingPreferenceCostsPreserved:[100,4,2],datedPriorityChange:false};
  return {...body,candidateDigest:contentDigest(body)};
}

// The same existing-command scope, using an owned pinned engine. A relaxed
// answer alone is never returned as a canonical candidate or admission.
export function deriveScalableCanonicalRecurringPhaseCandidate({source,currentConfig,fullOwners,dayOfWeek,solver}){
  const v=source.version||(source.versions?.length===1?source.versions[0]:null);
  assert.ok(v&&Array.isArray(v.assignments));
  const selectedWorkIds=v.assignments.filter(r=>r.dayOfWeek===dayOfWeek&&r.window?.start==='09:45').map(r=>r.workId);
  return solveRecurringPhaseCanonicalMinimum({source,ownerConfig:currentConfig,fullOwners,dayOfWeek,selectedWorkIds,solver});
}

// Complete existing-command equalized scope. Morning is explicit and fixed;
// this does not choose or claim an optimum for morning work. Rebind every day
// against final other-day candidate bytes, keeping its ORIGINAL source day as
// the comparison/preference baseline. Never publish a stale per-day witness.
export function deriveScalableCanonicalRecurringWeekCandidate({source,currentConfig,fullOwners,solver}){
  const original=source.version||(source.versions?.length===1?source.versions[0]:null);
  assert.ok(original&&Array.isArray(original.assignments));
  const first=[],started=performance.now(),budgetMs=30_000;
  const boundedSolver={solve(lp,options){
    const remaining=budgetMs-(performance.now()-started);
    assert.ok(remaining>0,'Recurring week total time bound exhausted.');
    return solver.solve(lp,{...options,timeLimitSeconds:Math.min(options.timeLimitSeconds,remaining/1000)});
  }};
  for(let dayOfWeek=0;dayOfWeek<7;dayOfWeek++){
    const proof=deriveScalableCanonicalRecurringPhaseCandidate({source,currentConfig,fullOwners,dayOfWeek,solver:boundedSolver});first.push(proof);
    if(proof.status!=='PROVEN_CANONICAL_PHASE_MINIMUM')return {status:'UNKNOWN_CANONICAL_RECURRING_WEEK',stage:'initial_day',dayOfWeek,
      proofs:first,candidateSource:null,published:false,admitted:false};
  }
  const finalSource=structuredClone(source),finalVersion=finalSource.version||finalSource.versions[0];
  finalVersion.assignments=original.assignments.map(row=>{
    if(row.window?.start!=='09:45')return structuredClone(row);
    const day=first[row.dayOfWeek],v=day.candidateSource.version||day.candidateSource.versions[0];
    const index=original.assignments.indexOf(row);return structuredClone(v.assignments[index]);
  });
  const finalDigest=contentDigest(finalSource),proofs=[];
  // These proofs were produced and checked inside THIS invocation, not supplied
  // by a caller. The day relaxation depends only on exact current-day source
  // rows/config/availability/options. Changing other days can shrink canonical
  // feasibility, but cannot invalidate that unchanged relaxation's lower bound.
  // A complete final-week canonical witness must still attain every bound.
  for(let dayOfWeek=0;dayOfWeek<7;dayOfWeek++){
    const basis=structuredClone(finalSource),v=basis.version||basis.versions[0];
    v.assignments=v.assignments.map((row,index)=>row.dayOfWeek===dayOfWeek?structuredClone(original.assignments[index]):row);
    try{
      const prior=first[dayOfWeek],descriptor=createRecurringPhaseDescriptor({source:basis,ownerConfig:currentConfig,
        dayOfWeek,selectedWorkIds:prior.descriptor.selectedWorkIds});
      const dayBasis=input=>{const out=structuredClone(input),version=out.version||out.versions[0];
        version.assignments=version.assignments.filter(row=>row.dayOfWeek===dayOfWeek);return out;};
      assert.equal(canonicalJson(dayBasis(basis)),canonicalJson(dayBasis(source)),'day relaxation source facts changed');
      const semantic=input=>{const out=structuredClone(input);delete out.sourceDigest;delete out.descriptorDigest;
        delete out.fixedSourceRowsDigest;return out;};
      assert.equal(canonicalJson(semantic(descriptor)),canonicalJson(semantic(prior.descriptor)),'day relaxation descriptor changed');
      const candidate=createRecurringPhaseProspectiveSource({source:basis,ownerConfig:currentConfig,descriptor,selection:prior.selectedOwnership});
      assert.equal(contentDigest(candidate),finalDigest,'bound selection does not produce exact final source');
      const body={status:'PROVEN_CANONICAL_PHASE_MINIMUM',descriptor,candidateSourceDigest:finalDigest,
        minimumDoubledSpread:prior.minimumDoubledSpread,halfUnitFeasible:prior.halfUnitFeasible,
        preferenceCost:prior.preferenceCost,stableIdentity:prior.stableIdentity,
        lowerBoundEvidence:prior,originalLowerBoundProofDigest:prior.proofDigest,
        originalSolverSourceDigest:prior.descriptor.sourceDigest,freshCanonicalSourceBasisDigest:contentDigest(basis),
        unchangedRelaxationDayFactsDigest:contentDigest(dayBasis(basis)),unchangedRelaxationDescriptorDigest:contentDigest(semantic(descriptor)),
        proofMethod:'UNCHANGED_DAY_RELAXATION_BOUND_PLUS_MATCHING_FINAL_WHOLE_WEEK_CANONICAL_WITNESS',
        freshSolverRunClaim:false,published:false,admitted:false};
      proofs.push({...body,proofDigest:contentDigest(body)});
    }catch(error){return {status:'UNKNOWN_CANONICAL_RECURRING_WEEK',stage:'final_other_days_rebinding',dayOfWeek,
      reason:error.message,proofs,candidateSource:null,published:false,admitted:false};}
  }
  const canonical=evaluateRecurringPhaseCanonicalSource(finalSource);
  if(!canonical.feasible)return {status:'UNKNOWN_CANONICAL_RECURRING_WEEK',stage:'final_whole_week_witness',proofs,candidateSource:null,published:false,admitted:false};
  // Exact same selected allocation attains each recorded raw-spread, cost and
  // stable-rank bound; no selected package may be an optional uncovered row.
  for(const proof of proofs){
    const prior=proof.lowerBoundEvidence;
    if(prior.descriptor.choices.some(choice=>{
      const selected=prior.selectedOwnership.find(row=>row.workId===choice.workId);
      return canonical.uncoveredWorkIds.includes(choice.owners.find(owner=>owner.slotId===selected.slotId).prospectiveWorkId);
    }))return {status:'UNKNOWN_CANONICAL_RECURRING_WEEK',stage:'final_selected_coverage',proofs,candidateSource:null,published:false,admitted:false};
    proof.finalCanonicalWitnessDigest=canonical.witnessDigest;
    const {proofDigest,...body}=proof;proof.proofDigest=contentDigest(body);
  }
  const body={status:'UNREGISTERED_CANONICAL_RECURRING_WEEK_CANDIDATE',sourceDigest:contentDigest(source),configDigest:contentDigest(currentConfig),
    fullOwnersDigest:contentDigest(fullOwners),candidateSource:finalSource,candidateSourceDigest:finalDigest,proofs,canonicalHardWitness:canonical,
    morningPreserved:true,originalPreferenceBaselinePreserved:true,allOtherDaysBoundToFinalCandidate:true,
    normalMorningOptimumClaim:false,datedPriorityChange:false,published:false,admitted:false};
  return {...body,proofDigest:contentDigest(body)};
}
