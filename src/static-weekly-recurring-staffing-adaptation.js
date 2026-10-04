import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalJson, contentDigest, assertServiceDate, serviceDateWeekday,
 snapshotDatedRosterSlot } from "./static-weekly-schedule-model.js";
import { postgresJsonbContentDigest } from "./static-weekly-schedule-compiler.js";
import { normalizeStaticWeeklyAuthority, prepareStaticWeeklySchedulingProblem,
  remainingStaticWeeklyMilliseconds, buildStaticWeeklySchedulingModel, weekdayDate } from "./static-weekly-schedule-program.js";
import {deriveLunchCoverageFromPreparedProblem} from './static-weekly-lunch-derivation.js';
import { recurringPatternAuthority } from "./static-weekly-recurring-repair-basis.js";
import { createShiftEndContinuityPolicy } from "./static-weekly-shift-end-derivation.js";
import { assertNormalOwnerEligibility, hardRestrictedSlots,
  validateOwnerEligibilityConfig,normalGeographyRestrictionApplies } from "./static-weekly-owner-eligibility.js";
import {createRecurringPhaseDescriptor,createRecurringPhaseProspectiveSource,
  enumerateRecurringPhaseMinimum,evaluateRecurringPhaseCanonicalSource,
  solveRecurringPhaseCanonicalMinimum,assertRecurringPhasePreferenceNormalization,
  createRecurringPhaseEvidenceInvocation} from './static-weekly-recurring-phase-authority.js';
import {createRecurringMorningObjectiveContract,createRecurringMorningProspectiveSource,
 solveRecurringMorningCanonicalMinimum,assertRecurringMorningCanonicalProof} from './static-weekly-recurring-morning-solver.js';

const phaseOf = (row) => row.window?.start === "09:45" ? "equalized" : "morning";
const expression = (terms) => terms.length
  ? terms.map(([n, variable]) => `${n < 0 ? "-" : "+"} ${Math.abs(n)} ${variable}`).join(" ").replace(/^\+ /, "")
  : "0";

// Exact existing Oct1/Oct5 handout lineage, not a caller-controlled family
// exception or new catalog authority. Hashes bind lossless primary/member/mode
// tuples from the retained executed current input; names are not ID joins.
const currentHandout={pdf:'925751c37e454e0fadb9d88eb57a46dd6a47c1ffe19deadf85189ad9bba2f0aa',
  json:'4e0f1577b9f8f0b21560e059fde50d6c386aab8a4d7debe0deabb0b20010820d',
  base:'2aab217b29482894b883ce36a3d7a44516d8fc4aa2b329471551b2f4c9a86981',
  packageTuples:'675e16270eca368614a0cecd447687182a4cc3a5c52ea0184f900f128ca5ba94',
  reminder:'9f88759ab63488bbd9f43c1c45c6e915f0a53688216ee0c78911afb8ef8baf4b',
  namedHandoffs:'24191c9c6600786db8dd5d1487d343e8de42778ac5496c4e141c6fdbedbca0ad',
  retired:['BAMBOO_SPRINGS_GIFT_SHOP','ELEPHANT_TRUNK_GIFT_SHOP','ELEPHANT_TRUNK_RESTROOMS','TRADING_POST_GIFT_SHOP']};
const currentReminderId='2:ELEPHANT_TRUNK_RESTROOMS:one-time:55e5939c';
const sorted=input=>[...input].sort();
const reductionAuthority={schema:'custodial.full-nine-reduction-context.v1',
  correctionConfigDigest:'5aded7a189e3fd70faaa8062c1bea9e6f2e09749ae7c4a238acbf9e84010c11a',
  fullConfigDigest:'64855aba8c76e1e8998c01abd8205b6f22dce60130ec9b9ac1bcfae89a2bacda',
  fullOwnersDigest:'b5cee361cc21863eb16223992f7a7ca2bdaaaf0e02d81d1860878f2c6647024f',
  baseSourceId:'a00cdf2a-0623-5e2d-bc65-338c1dd67202',
  baseAssignmentsDigest:'e6019fa1b2c5e0e2852a312a5d0af69ff54985c585977c710a8e0a5791be1efd'};
const byWork=(a,b)=>a.workId<b.workId?-1:a.workId>b.workId?1:0;

// Fixed-pattern mapping is a DIFFERENT contract from the historical optimizer.
// The admittedBindings argument belongs to the authenticated source boundary,
// never to a manager command. This helper produces no publication/solver seal.
// In particular, an APPROVED string on a workbook/config is not admission.
export function mapApprovedStaticTemplateCandidate({ templates, admittedBindings,
  currentSource, currentOwnerConfig, selection, deadline = null }) {
  const refuse = code => Object.assign(new Error(code), { code });
  const require = (value, code) => { if (!value) throw refuse(code); };
  const tick = () => { if (deadline !== null) remainingStaticWeeklyMilliseconds(deadline); };
  const problemFor = input => {
    const wire = structuredClone(input);
    if (wire.version && !wire.versions) { wire.versions = [wire.version]; delete wire.version; }
    return prepareStaticWeeklySchedulingProblem(wire, deadline);
  };
  tick();
  require(selection?.schema === 'custodial.static-template-selection.v1', 'static_template_selection_invalid');
  require(['RECURRING_STAFFING', 'DATED_ABSENCE'].includes(selection.kind), 'static_template_selection_kind_invalid');
  const date = assertServiceDate(selection.serviceDate);
  require(currentSource?.serviceDate === date, 'static_template_target_date_mismatch');
  const target = problemFor(currentSource);
  require(!target.error, 'static_template_target_authority_invalid');
  const day = serviceDateWeekday(date);
  const scopeDays = selection.kind === 'DATED_ABSENCE' ? [day] : [0,1,2,3,4,5,6];
  const ordinary = target.roster.filter(p => p.personId && p.kind !== 'CONTRACTOR_CAPACITY');
  require(new Set(ordinary.map(p => p.personId)).size === ordinary.length, 'static_template_duplicate_person');
  // Weekly employment selects a weekly pattern, preserving ordinary days off.
  // A changed DATED operation instead uses the independently effective working
  // capacity for that date, including hours/partial availability, not a count
  // obtained merely by subtracting explicit absence commands.
  const fullAbsences = new Set(target.states.get(day).fullDayAbsenceSlotIds);
  const available = ordinary.filter(p => !target.version.namedAbsentSlotIds?.includes(p.slotId)
    && (selection.kind !== 'DATED_ABSENCE' || (!fullAbsences.has(p.slotId)
      && target.availabilityByDaySlot.has(`${day}\u0000${p.slotId}`))));
  require(Array.isArray(selection.availablePersonIds)
    && new Set(selection.availablePersonIds).size === selection.availablePersonIds.length
    && canonicalJson(sorted(selection.availablePersonIds)) === canonicalJson(sorted(available.map(p => p.personId))),
  'static_template_available_people_mismatch');
  const count = available.length;
  const choices = (templates || []).filter(t => t.templateId === selection.templateId && t.staffingCount === count);
  require(choices.length === 1, 'static_template_missing_approved_pattern');
  const template = choices[0], digest = contentDigest(template.source);
  const admissions = (admittedBindings || []).filter(b => b.schema === 'custodial.approved-static-template-binding.v1'
    && b.templateId === template.templateId && b.staffingCount === count && b.sourceDigest === digest
    && b.patternAuthority === 'OWNER_APPROVED_OPERATIONAL_PATTERN'
    && typeof b.artifactSha256 === 'string' && /^[a-f0-9]{64}$/.test(b.artifactSha256));
  require(admissions.length === 1, 'static_template_not_independently_admitted');
  const binding = admissions[0];
  require(binding.ownerConfigDigest === contentDigest(currentOwnerConfig), 'static_template_owner_config_not_bound');
  validateOwnerEligibilityConfig(currentOwnerConfig);
  require(Array.isArray(template.source.exceptions) && template.source.exceptions.length === 0,
    'static_template_dated_overlay_not_pattern');
  const approvedInput = structuredClone(template.source);
  approvedInput.serviceDate = date;
  const approved = problemFor(approvedInput);
  require(!approved.error, 'static_template_approved_authority_invalid');
  const sourceVersion = approvedInput.version || approvedInput.versions?.find(v => v.id === approved.version.id);
  const currentVersion = currentSource.version || currentSource.versions?.find(v => v.id === target.version.id);
  require(sourceVersion && currentVersion, 'static_template_version_missing');
  // Approved positions are not historical people. A historical vacancy does
  // not revoke its fixed role geometry, and filling a role never resurrects
  // the person carried in an old packet. Bind the role list independently.
  const patternSlots = sorted(template.roleSlotIds || []);
  require(patternSlots.length === count && new Set(patternSlots).size === count
    && binding.roleSlotIdsDigest === contentDigest(patternSlots)
    && patternSlots.every(id => approved.slots.some(s => s.id === id && !s.contractorCapacity)),
    'static_template_approved_role_binding_invalid');
  const actualById = new Map(available.map(p => [p.slotId, p]));
  require(available.every(p => scopeDays.every(d => target.incumbencyByDaySlot.get(`${d}\u0000${p.slotId}`)?.personId === p.personId)),
    'static_template_scope_incumbency_changed');
  const templateRows = sourceVersion.assignments.filter(r => scopeDays.includes(r.dayOfWeek));
  require(templateRows.every(r => patternSlots.includes(r.ownerSlotId)), 'static_template_nonemployee_owner');
  require(new Set(templateRows.map(r => `${r.dayOfWeek}:${r.workId}`)).size === templateRows.length,
    'static_template_duplicate_work');
  // Compare the independently effective physical responsibility domain before
  // replacing any current row. Slot/group/work IDs are not this domain: an
  // approved six pattern can group the same split nine-person members. Member
  // multiplicity, total effort and every required coverage/eligibility fact
  // remain exact. A new current event/task cannot disappear into a stale plan.
  function coverageDomain(problem) {
    const groups = new Map();
    for (const row of problem.work.filter(r => scopeDays.includes(r.dayOfWeek))) {
      const phase = row.window.end === '09:45' ? 'morning'
        : row.window.start === '09:45' ? 'equalized' : {start:row.window.start,end:row.window.end};
      const declared = problem.states.get(row.dayOfWeek).work.find(r => r.workId === row.workId);
      const key = canonicalJson({day:row.dayOfWeek,family:row.locationCodeSnapshot,phase,
        mode:row.serviceMode ?? null,schedulingMode:row.schedulingMode ?? null,required:row.sourceRequired,
        priority:declared?.priority ?? row.priority,qualifications:row.requiredQualifications,restrictions:row.restrictions,
        restrictedSlotIds:row.restrictedSlotIds || [],coveragePolicy:row.coveragePolicy ?? null,
        coverageOrder:row.coveragePolicyOrder ?? null,custodialCoverageMode:row.custodialCoverageMode ?? null});
      if (!groups.has(key)) groups.set(key,{facts:key,members:[],effort:0});
      const group = groups.get(key);
      group.members.push(...(row.includedLocations?.length ? row.includedLocations :
        [{locationId:row.locationId,locationNameSnapshot:row.locationNameSnapshot}]).map(m => canonicalJson(m)));
      require(Number.isSafeInteger(row.serviceEffortMinutes) && Number.isSafeInteger(group.effort + row.serviceEffortMinutes),
        'static_template_physical_effort_invalid');
      group.effort += row.serviceEffortMinutes;
    }
    return [...groups.values()].map(g=>({...g,members:sorted(g.members)})).sort((a,b)=>a.facts<b.facts?-1:a.facts>b.facts?1:0);
  }
  const coverage = coverageDomain(approved);
  require(canonicalJson(coverage) === canonicalJson(coverageDomain(target)), 'static_template_current_coverage_incompatible');
  // These constraints refer to slot identities outside the work rows. They
  // cannot silently survive an arbitrary role substitution. Until the typed
  // projection seam can rebind their provenance, only identical policies fit.
  require(canonicalJson(sourceVersion.shiftEndContinuityPolicy ?? null)
    === canonicalJson(currentVersion.shiftEndContinuityPolicy ?? null), 'static_template_policy_incompatible');
  require(canonicalJson(approvedInput.proximity) === canonicalJson(currentSource.proximity),
    'static_template_directed_geography_incompatible');
  const compatibilityInput = structuredClone(currentSource);
  const compatibilityVersion = compatibilityInput.version || compatibilityInput.versions.find(v => v.id === target.version.id);
  compatibilityVersion.assignments = [...currentVersion.assignments.filter(r => !scopeDays.includes(r.dayOfWeek)), ...templateRows];
  const compatibility = problemFor(compatibilityInput);
  require(!compatibility.error, 'static_template_compatibility_authority_invalid');
  const roleProfile = a => ({shift:a.shift ?? null,lunch:a.lunch ?? null,
    blockedWindows:a.blockedWindows || [],maxServiceEffortMinutes:a.maxServiceEffortMinutes ?? a.maxLoadPoints ?? null,
    maxDutyMinutes:a.maxDutyMinutes ?? a.max_duty_minutes ?? null,
    acceptedRoute:a.acceptedRoute ?? null,
    startLocationId:a.acceptedRouteStartLocationId ?? a.acceptedRouteAnchorLocationId ?? a.routeAnchorLocationId ?? null,
    acceptedRouteStops:a.acceptedRouteStops ?? null});
  const capacitySame = (roleAvailability, current) => roleAvailability && current && !current.capacity.error
    && canonicalJson(roleProfile(roleAvailability)) === canonicalJson(roleProfile(current.availability));
  const candidates = new Map();
  for (const role of patternSlots) {
    tick();
    const rows = templateRows.filter(r => r.ownerSlotId === role);
    const compatible = [];
    for (const actual of available) {
      let fits = true;
      const configOwner = Object.entries(currentOwnerConfig.slots).find(([,s]) => s.slotId === actual.slotId);
      require(configOwner && configOwner[1].personId === actual.personId && configOwner[1].vacancy !== true,
        'static_template_current_person_config_mismatch');
      for (const row of rows) {
        try { assertNormalOwnerEligibility({ key: configOwner[0], ...configOwner[1] }, row.locationCodeSnapshot); }
        catch { fits = false; break; }
        const roleAvailability = approved.states.get(row.dayOfWeek).availability.get(role);
        const actualContext = target.availabilityByDaySlot.get(`${row.dayOfWeek}\u0000${actual.slotId}`);
        // Equal approved duty/route/lunch capacity makes the fixed pattern's
        // load/travel proof transferable, not a points-to-minutes invention.
        // The candidate universe freshly applies the actual restrictions,
        // qualifications, current locks and dated overlays for every row.
        if (!capacitySame(roleAvailability, actualContext)
          || !compatibility.candidates.some(c => c.item.key === `${row.dayOfWeek}:${row.workId}` && c.slot.id === actual.slotId)) {
          fits = false; break;
        }
      }
      if (fits) compatible.push(actual.slotId);
    }
    compatible.sort((a,b) => Number(b === role) - Number(a === role) || (a < b ? -1 : a > b ? 1 : 0));
    candidates.set(role, compatible);
  }
  // At most nine approved employee roles. Exact bounded matching, with same
  // slot first; no geography/objective regeneration and no solver fallback.
  require(count >= 6 && count <= 9, 'static_template_missing_approved_pattern');
  const mapping = new Map(), used = new Set();
  function match(index) {
    tick();
    if (index === patternSlots.length) return true;
    const role = patternSlots[index];
    for (const actual of candidates.get(role)) {
      if (used.has(actual)) continue;
      used.add(actual); mapping.set(role, actual);
      if (match(index + 1)) return true;
      used.delete(actual); mapping.delete(role);
    }
    return false;
  }
  require(match(0), 'static_template_no_compatible_person_slot_mapping');
  const mappedRows = templateRows.map(row => ({ ...structuredClone(row), ownerSlotId: mapping.get(row.ownerSlotId) }));
  const sourceRows = currentVersion.assignments;
  const unaffected = sourceRows.filter(r => !scopeDays.includes(r.dayOfWeek));
  const unchanged = canonicalJson(mappedRows) === canonicalJson(sourceRows.filter(r => scopeDays.includes(r.dayOfWeek)));
  // A mapped candidate is not an optimized compiler result or a publication.
  // Unchanged source is returned exactly (including array order/absent fields).
  const candidateSource = structuredClone(currentSource);
  if (!unchanged) {
    const candidateVersion = candidateSource.version || candidateSource.versions.find(v => v.id === target.version.id);
    const first = sourceRows.findIndex(r => scopeDays.includes(r.dayOfWeek));
    const before = first < 0 ? unaffected.length : sourceRows.slice(0,first).length;
    candidateVersion.assignments = [...unaffected.slice(0,before), ...mappedRows, ...unaffected.slice(before)];
  }
  const body = { schema: 'custodial.approved-static-template-mapping.v1',
    contract: 'FIXED_APPROVED_GEOMETRY_COMPATIBILITY_NOT_GLOBAL_OPTIMALITY',
    templateId: template.templateId, templateDigest: digest, admissionDigest: contentDigest(binding),
    currentSourceDigest: contentDigest(currentSource), selectionDigest: contentDigest(selection),
    physicalCoverageDigest: contentDigest(coverage),
    staffingCount: count, scopeDays, serviceDate: date,
    slotMapping: patternSlots.map(patternSlotId => ({ patternSlotId, actualSlotId: mapping.get(patternSlotId),
      actualPersonId: actualById.get(mapping.get(patternSlotId)).personId })),
    mappedRowsDigest: contentDigest(mappedRows), unaffectedRowsDigest: contentDigest(unaffected),
    candidateDigest: contentDigest(candidateSource), unchanged,
    admitted: false, published: false, solverInvoked: false,
    publicationStatus: 'TYPED_STATIC_FEASIBILITY_INTEGRATION_REQUIRED',
    patternPublicationStatus: binding.patternPublicationStatus || 'NOT_ASSERTED' };
  return { candidateSource, mappedRows, receipt: { ...body, digest: contentDigest(body) } };
}

// Distinct STATIC feasibility, not a forged optimized solver certificate.
// Both invocations below reconstruct their own source, candidate universe,
// complete hard model, fixed witness and lunch plan. No prepared graph escapes.
export function prepareApprovedStaticTemplateProjection(args) {
  const fail = code => { throw Object.assign(new Error(code), {code}); };
  const tick = () => { if (args.deadline != null) remainingStaticWeeklyMilliseconds(args.deadline); };
  function derive() {
    tick();
    const mapping = mapApprovedStaticTemplateCandidate(args);
    const wire = structuredClone(mapping.candidateSource);
    if (wire.version && !wire.versions) {wire.versions=[wire.version];delete wire.version;}
    const problem = prepareStaticWeeklySchedulingProblem(wire,args.deadline);
    if(problem.error)fail('static_template_feasibility_source_invalid');
    const model = buildStaticWeeklySchedulingModel(problem,[],
      {name:'approved_static_fixed_feasibility',family:'approved_static_fixed_feasibility',terms:[]},args.deadline);
    if(model.error)fail('static_template_feasibility_model_invalid');
    if(model.general.size || model.priorBindings.length)fail('static_template_unexpected_rank_or_binding');
    const values = new Map([...model.binary].map(name=>[name,0]));
    const version= mapping.candidateSource.version || mapping.candidateSource.versions.find(v=>v.id===problem.version.id);
    const rowOwners=new Map(version.assignments.map(row=>[`${row.dayOfWeek}:${row.workId}`,row.ownerSlotId]));
    const assignments=[];
    for(const item of problem.work){
      tick();
      const slotId=rowOwners.get(item.key) || item.originSlotId;
      const variable=model.x.get(`${item.key}\u0000${slotId}`);
      if(!variable){
        // Preserve an already-authorized explicitly permitted OPEN derived
        // vacancy row. This is not permission to drop required work, choose a
        // new owner, or relabel ordinary best-effort work as permitted-open.
        if(item.required!==false || item.coverageClass!=='permitted_open')fail('static_template_fixed_owner_ineligible');
        values.set(model.uncovered.get(item.key),1);
        assignments.push({planWorkId:item.key,workId:item.workId,dayOfWeek:item.dayOfWeek,
          serviceDate:weekdayDate(problem.serviceDate,item.dayOfWeek),locationId:item.locationId,
          slotId:null,personId:null,displayName:null,status:'OPEN',coverageClass:item.coverageClass,
          window:structuredClone(item.window),serviceMode:item.serviceMode,
          serviceEffortMinutes:item.effort.minutes,includedLocations:structuredClone(item.includedLocations)});
        continue;
      }
      const person=problem.incumbencyByDaySlot.get(`${item.dayOfWeek}\u0000${slotId}`);
      if(!person?.personId || person.kind==='CONTRACTOR_CAPACITY')fail('static_template_fixed_person_unavailable');
      values.set(variable,1);
      assignments.push({planWorkId:item.key,workId:item.workId,dayOfWeek:item.dayOfWeek,
        serviceDate:weekdayDate(problem.serviceDate,item.dayOfWeek),locationId:item.locationId,
        slotId,personId:person.personId,displayName:person.displayName,status:'ASSIGNED',
        window:structuredClone(item.window),serviceMode:item.serviceMode,
        serviceEffortMinutes:item.effort.minutes,includedLocations:structuredClone(item.includedLocations)});
    }
    for(const group of model.routeGroups){
      tick();values.set(group.base,1);
      const middle=group.nodes.filter(node=>!['start','end'].includes(node.kind)&&values.get(node.active)===1)
        .sort((a,b)=>a.startMinute-b.startMinute || a.endMinute-b.endMinute || (a.id<b.id?-1:a.id>b.id?1:0));
      const path=[group.nodes.find(n=>n.kind==='start'),...middle,group.nodes.find(n=>n.kind==='end')];
      for(let i=1;i<path.length;i++){
        const arcs=group.arcs.filter(a=>a.from===path[i-1]&&a.to===path[i]);
        if(arcs.length!==1)fail('static_template_fixed_route_incompatible');
        values.set(arcs[0].name,1);
      }
    }
    for(const row of model.modelBasis.constraints.rows){
      tick();
      if(!Number.isSafeInteger(row.value)||row.terms.some(([n,v])=>!Number.isSafeInteger(n)||!values.has(v)))
        fail('static_template_hard_row_not_exact');
      const actual=row.terms.reduce((n,[coefficient,v])=>n+BigInt(coefficient)*BigInt(values.get(v)),0n),bound=BigInt(row.value);
      if(!(row.relation==='='?actual===bound:row.relation==='<='?actual<=bound:row.relation==='>='&&actual>=bound))
        fail('static_template_hard_constraint_violation');
    }
    const lunch=deriveLunchCoverageFromPreparedProblem(problem,assignments);
    if(lunch.status!=='PLANNED')fail('static_template_lunch_coverage_incompatible');
    const byWork=new Map(problem.work.map(work=>[work.key,work]));
    const projectionAssignments=assignments.map(row=>{
      const work=byWork.get(row.planWorkId),baseline=problem.incumbencyByDaySlot.get(`${row.dayOfWeek}\u0000${work.originSlotId}`);
      return {plan_work_id:row.planWorkId,work_id:row.workId,day_of_week:row.dayOfWeek,service_date:row.serviceDate,
        status:row.status.toLowerCase(),reason_code:row.status==='OPEN'?'permitted_open':null,
        owner_slot_id:row.slotId,owner_person_id:row.personId,
        owner_digest:postgresJsonbContentDigest({planWorkId:row.planWorkId,slotId:row.slotId,personId:row.personId,serviceDate:row.serviceDate}),
        exact_owner_identity:postgresJsonbContentDigest({plan_work_id:row.planWorkId,service_date:row.serviceDate,
          optimized_owner_slot_id:row.slotId,optimized_owner_person_id:row.personId,
          baseline_owner_slot_id:work.originSlotId||null,baseline_owner_person_id:baseline?.personId||null}),
        baseline_owner_slot_id:work.originSlotId||null,baseline_owner_person_id:baseline?.personId||null,
        baseline_owner_name:baseline?.displayName||null,original_actor_person_id:baseline?.personId||null,
        original_actor_name:baseline?.displayName||null,
        // Legacy relational names describe the selected effective owner. The
        // typed authority explicitly makes no optimization claim.
        optimized_owner_slot_id:row.slotId,optimized_owner_person_id:row.personId,
        work_snapshot:{workId:work.workId,dayOfWeek:work.dayOfWeek,originSlotId:work.originSlotId||null,
          locationId:work.locationId,locationCodeSnapshot:work.locationCodeSnapshot,
          locationNameSnapshot:work.locationNameSnapshot,serviceMode:work.serviceMode,
          includedLocations:structuredClone(work.includedLocations),window:{start:work.window.start,end:work.window.end},
          serviceEffortMinutes:work.effort.minutes,serviceEffortProvenance:work.effort.provenance,
          priority:work.priority,priorityProvenance:work.priorityProvenance??null,required:work.required,
          coveragePolicy:work.coveragePolicy??null,bestEffortCoverage:work.coverageClass==='best_effort',
          coveragePolicyOrder:work.coverageOrder,coveragePolicyProvenance:work.coveragePolicyProvenance??null,
          requiredQualifications:structuredClone(work.requiredQualifications),qualificationProvenance:work.qualificationProvenance,
          restrictions:structuredClone(work.restrictions),restrictionProvenance:work.restrictionProvenance,
          restrictedSlotIds:structuredClone(work.restrictedSlotIds||[]),manualLock:Boolean(work.manualLock),
          manualLockSlotId:work.manualLock||null,overlayWork:Boolean(work.overlayWork)},
        explanation:{contract:'fixed_approved_pattern',hardConstraints:'satisfied',reasons:row.status==='OPEN'?[{code:'permitted_open'}]:[]}};
    });
    const baseAuthorityDigest=postgresJsonbContentDigest({schema:'custodial.approved-static-feasibility-base.v1',
      mapping:mapping.receipt,inputDigest:problem.inputDigest,basisDigest:model.modelBasisDigest,
      witnessDigest:contentDigest([...values])});
    const baseReplayDigest=postgresJsonbContentDigest({projectionAssignments,lunch});
    const loans=lunch.lunches.map(loan=>({loan_id:loan.loanId,service_date:loan.serviceDate,day_of_week:loan.dayOfWeek,
      normal_owner_slot_id:loan.normalOwnerSlotId,normal_owner_person_id:loan.normalOwnerPersonId,
      coverage_start:loan.window?.start??null,coverage_end:loan.window?.end??null,status:loan.status,
      reason:loan.reason??null,helper_slot_ids:loan.helperSlotIds||[],fallback:loan.fallback??null,total_distance_minutes:loan.totalDistance??null}));
    const responsibilities=lunch.lunches.flatMap(loan=>loan.responsibilities.map(r=>({responsibility_id:r.responsibilityId,
      loan_id:loan.loanId,service_date:loan.serviceDate,day_of_week:loan.dayOfWeek,
      normal_owner_slot_id:r.normalOwnerSlotId,normal_owner_person_id:r.normalOwnerPersonId,
      coverer_slot_id:r.covererSlotId,coverer_person_id:r.covererPersonId,coverage_purpose:r.coveragePurpose,
      coverage_start:loan.window.start,coverage_end:loan.window.end,check_deadline_policy:r.checkDeadlinePolicy,
      creates_deep_clean:r.createsDeepClean,proximity_evidence:r.proximityEvidence||[],segments:r.segments||[]})));
    const notificationIntents=lunch.lunches.flatMap(loan=>loan.notificationIntents.flatMap(r=>['start','end'].map(event=>({
      notification_key:event==='start'?r.startKey:r.endKey,loan_id:loan.loanId,service_date:loan.serviceDate,event,
      scheduled_time:event==='start'?r.startTime:r.endTime,coverer_slot_id:r.covererSlotId,delivery_state:r.deliveryState}))));
    const lunchDocument={schema:'memphis-zoo.static-weekly-lunch-authority-document.v1',persistence_authority:'NOT_PERSISTED',
      verification_status:'VERIFIED',week_start:lunch.weekStart,base_authority_digest:baseAuthorityDigest,
      base_replay_digest:baseReplayDigest,source_input_digest:problem.inputDigest,candidate_digest:contentDigest(lunch),
      loans,responsibilities,notification_intents:notificationIntents,
      semantic_snapshot:{schema:'memphis-zoo.static-weekly-lunch-semantic-snapshot.v1',loans_digest:postgresJsonbContentDigest(loans),
        responsibilities_digest:postgresJsonbContentDigest(responsibilities),notification_intents_digest:postgresJsonbContentDigest(notificationIntents)}};
    lunchDocument.document_identity=postgresJsonbContentDigest(lunchDocument);
    const body={schema:'custodial.approved-static-feasibility.v1',
      contract:'FIXED_APPROVED_PATTERN_COMPLETE_HARD_CONSTRAINTS_NOT_OPTIMALITY',
      mapping: mapping.receipt,sourceDigest:contentDigest(args.currentSource),
      candidateSource:mapping.candidateSource,assignments,projectionAssignments,lunchDocument,baseAuthorityDigest,baseReplayDigest,
      inputDigest:problem.inputDigest,basisDigest:model.modelBasisDigest,
      hardConstraintDigest:model.modelBasis.constraints.digest,
      hardConstraintCount:model.modelBasis.constraints.count,
      witnessDigest:contentDigest([...values]),lunch,
      solverInvoked:false,optimized:false,publicationAuthority:'NOT_PUBLISHED'};
    return {...body,digest:postgresJsonbContentDigest(body)};
  }
  const original=derive(),independent=derive();
  if(canonicalJson(original)!==canonicalJson(independent))fail('static_template_independent_feasibility_changed');
  tick();return original;
}
function assertReductionContext(context){
  assert.equal(context?.schema,reductionAuthority.schema,'typed full-nine reduction context required');
  const {contextDigest,...body}=context;
  assert.equal(contentDigest(body),contextDigest,'full-nine reduction context bytes changed');
  assert.equal(context.correctionAuthorityDigest,reductionAuthority.correctionConfigDigest,'current correction authority changed');
  assert.equal(context.fullConfigDigest,reductionAuthority.fullConfigDigest,'full-nine configuration authority changed');
  assert.equal(context.fullOwnersDigest,reductionAuthority.fullOwnersDigest,'full-nine guidance authority changed');
  assert.equal(contentDigest(context.acceptedSource),context.acceptedSourceDigest,'accepted comparison ledger source changed');
  assert.equal(contentDigest(context.dayAvailabilityReferences),context.dayAvailabilityReferencesDigest,
    'original/current same-day availability provenance changed');
  if(context.registeredCorrectionSource){
    assert.equal(contentDigest(context.registeredCorrectionSource),context.registeredCorrectionSourceDigest,
      'registered current correction source bytes changed');
    assert.equal(postgresJsonbContentDigest(context.registeredCorrectionSource),context.correctionWitness?.hydratedDigest,
      'registered current correction witness bytes changed');
    const {digest:witnessDigest,...witnessBody}=context.correctionWitness;
    assert.equal(postgresJsonbContentDigest(witnessBody),witnessDigest,'locked current correction witness digest changed');
    assert.equal(contentDigest(context.correctionTemplateConfig),context.correctionAuthorityDigest,
      'trusted correction template bytes changed');
    currentHandoutRecurringStructure(context.registeredCorrectionSource,context.correctionTemplateConfig);
  }
  assert.equal(contentDigest(context.currentConfig.namedShiftEndHandoffs),currentHandout.namedHandoffs,'trusted current named owner authority changed');
  assert.equal(canonicalJson(context.source.version.shiftEndContinuityPolicy.namedHandoffs),canonicalJson(context.currentConfig.namedShiftEndHandoffs),'current named source policy binding changed');
  const bindings=mandatoryReductionBindings(context.acceptedSource,context.currentConfig);
  assert.equal(canonicalJson(context.currentConfig.fullNineReductionBinding.mandatoryPrimaryOwnerBindings),canonicalJson(bindings),'mandatory owner/reference/constant changed');
  assert.equal(context.currentConfig.fullNineReductionBinding.mandatoryChangeCostConstant,bindings.reduce((n,b)=>n+b.fixedChangeCost,0),'mandatory constant arithmetic changed');
  return context;
}
function mandatoryReductionBindings(accepted,config){
  return config.namedShiftEndHandoffs.map(h=>{
    const rows=accepted.version.assignments.filter(r=>r.dayOfWeek===h.dayOfWeek&&r.window.start==='09:45'&&r.locationCodeSnapshot===h.locationCode);
    assert.ok(rows.length,'accepted named-handoff comparison family missing');
    const key=id=>Object.keys(config.slots).find(k=>config.slots[k].slotId===id);
    const original=[...rows].sort((a,b)=>b.serviceEffortMinutes-a.serviceEffortMinutes||key(a.originSlotId).localeCompare(key(b.originSlotId)))[0];
    const owner=config.slots[key(h.fromSlotId)];assert.ok(owner&&owner.shift[1]===h.at,'mandatory current primary handoff owner/time binding changed');
    return {dayOfWeek:h.dayOfWeek,family:h.locationCode,originalReferenceSlotId:original.originSlotId,
      mandatoryPrimarySlotId:h.fromSlotId,handoff:structuredClone(h),fixedChangeCost:original.originSlotId===h.fromSlotId?0:100,
      proofScope:'EVERY_FEASIBLE_CANDIDATE_UNDER_EXACT_ACCEPTED_NAMED_PRIMARY_OWNER_CONSTRAINT'};
  });
}
function reductionStructure(source){
  const fixedRows=source.version.assignments.filter(r=>r.workId===currentReminderId);
  assert.equal(fixedRows.length,1,'reduction fixed Tuesday reminder missing');
  assert.equal(contentDigest(fixedRows[0]),currentHandout.reminder,'reduction fixed Tuesday reminder changed');
  return {phaseByWorkId:new Map(source.version.assignments.map(r=>[r.workId,r.workId===currentReminderId?null:phaseOf(r)])),
    fixedRows,fixedRowsDigest:contentDigest(fixedRows)};
}
// Lossless path-level change receipt: array ordering and absent fields are not
// coalesced. This is private authority evidence, never an employee diagnostic.
function sourceDiff(before,after,path='$',out=[]){
  if(before===undefined&&after===undefined)return out;
  if(before!==undefined&&after!==undefined&&canonicalJson(before)===canonicalJson(after))return out;
  if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after)){
    for(const key of sorted(new Set([...Object.keys(before),...Object.keys(after)])))
      sourceDiff(before[key],after[key],`${path}.${key}`,out);
  }else out.push({path,beforePresent:before!==undefined,afterPresent:after!==undefined,
    ...(before!==undefined?{before:structuredClone(before)}:{}),...(after!==undefined?{after:structuredClone(after)}:{})});
  return out;
}
// Validate the exact corrected313 position recipe against the immutable314
// registered base, independently of TARGET occupancy. Original raw split rows
// remain evidence; dominant ownership is ONLY the inherited family cost seed.
export function createFullNineReductionContext({publishedSource,managerSnapshot,correctionConfig,fullConfig,fullOwners,
  fullNineSource,correctionSource=null,correctionWitness=null,effectiveDate,expectedRevision}){
  assert.equal(contentDigest(correctionConfig),reductionAuthority.correctionConfigDigest,'trusted current October correction config binding missing');
  assert.equal(contentDigest(fullConfig),reductionAuthority.fullConfigDigest,'trusted full-nine config binding missing');
  assert.equal(contentDigest(fullOwners),reductionAuthority.fullOwnersDigest,'trusted full-nine family guidance binding missing');
  assert.equal(fullNineSource?.source_id,reductionAuthority.baseSourceId,'trusted registered full-nine base required for reduction');
  const base=fullNineSource.compiler_input,accepted=publishedSource?.compiler_input;
  const registeredCorrection=correctionSource?.compiler_input;
  if(correctionSource||correctionWitness){
    assert.ok(registeredCorrection&&correctionWitness,'locked registered current correction source and witness required together');
    const {digest:witnessDigest,...witnessBody}=correctionWitness;
    assert.equal(postgresJsonbContentDigest(witnessBody),witnessDigest,'locked current correction witness digest changed');
    assert.equal(correctionWitness.schema,'memphis-zoo.recurring-current-correction-witness.v1',
      'typed locked current correction witness required');
    assert.equal(correctionSource.source_id,correctionWitness.sourceId,'current correction registered identity changed');
    assert.notEqual(correctionSource.source_id,publishedSource.source_id,'current correction cannot impersonate historical publication');
    assert.notEqual(correctionSource.source_id,fullNineSource.source_id,'current correction cannot impersonate historical base');
    assert.equal(postgresJsonbContentDigest(registeredCorrection),correctionWitness.hydratedDigest,'current correction hydrated bytes changed');
    assert.equal(correctionWitness.effectiveWeek,effectiveDate,'current correction target week changed');
    assert.equal(correctionWitness.authorityRevision,expectedRevision,'current correction roster revision changed');
    assert.equal(correctionWitness.patternSourceId,publishedSource.source_id,'current correction historical source binding changed');
    assert.equal(correctionWitness.patternPublicationId,publishedSource.publication_id,
      'current correction historical publication binding changed');
    assert.equal(correctionWitness.managerSnapshotDigest,postgresJsonbContentDigest(managerSnapshot),
      'current correction manager roster snapshot changed');
    const active=managerSnapshot?.sources?.filter(row=>row.source_id===correctionSource.source_id);
    assert.equal(active?.length,1,'current correction active registry identity missing or duplicated');
    assert.equal(active[0].source_digest,correctionWitness.canonicalDigest,
      'current correction registered raw digest changed');
    currentHandoutRecurringStructure(registeredCorrection,correctionConfig);
  }
  assert.equal(contentDigest(base?.version?.assignments),reductionAuthority.baseAssignmentsDigest,'registered full-nine base work bytes changed');
  assert.ok(accepted?.version?.assignments?.length===313,'exact historical313 pattern required');
  const authority=recurringPatternAuthority({publishedSource,managerSnapshot,effectiveDate,expectedRevision});
  if(correctionWitness)assert.equal(correctionWitness.effectivePublicationId,authority.publicationId,
    'current correction effective publication binding changed');
  const targetSlots=targetSlotsFromManagerRoster({templateConfig:correctionConfig,managerSnapshot,effectiveDate,expectedRevision});
  const staffed=Object.values(targetSlots).filter(s=>s.vacancy!==true).length;
  assert.ok(staffed>=6&&staffed<=8,'full-nine reduction targets six to eight current people');
  const config=structuredClone(correctionConfig);config.effectiveDate=effectiveDate;config.slots=targetSlots;
  validateOwnerEligibilityConfig(config);
  const policy=accepted.version.shiftEndContinuityPolicy,{policyDigest,...policyBody}=policy||{};
  assert.ok(policy,'historical accepted continuity policy missing');
  assert.equal(policyDigest,postgresJsonbContentDigest(policyBody),'historical accepted continuity policy changed');
  assert.equal(canonicalJson(policy.weights),canonicalJson(fullConfig.weights),'historical accepted weights changed');
  assert.ok(!Object.hasOwn(policy,'namedHandoffs'),'historical313 named-policy authority needs separate classification');
  const sourceConfigSha=policy.provenance?.match(/^owner-configuration-sha256:([a-f0-9]{64})$/)?.[1];
  assert.ok(sourceConfigSha,'historical accepted config provenance missing');
  const baseGroups=new Map();
  for(const row of base.version.assignments){const key=`${row.dayOfWeek}/${phaseOf(row)}/${row.locationCodeSnapshot}`;
    baseGroups.set(key,[...(baseGroups.get(key)||[]),row]);}
  const expectedRows=[];
  for(const [group,rows]of baseGroups){const [dayText,phase,family]=group.split('/'),day=Number(dayText),override=fullConfig.overrides?.[dayText]?.[phase];
    if(!override){expectedRows.push(...structuredClone(rows));continue;}
    const ownerKey=Object.entries(override).find(([,families])=>families.includes(family))?.[0];
    assert.ok(ownerKey,'historical override family binding missing');
    const owner=fullConfig.slots[ownerKey],row=structuredClone(rows[0]),members=rows.flatMap(r=>r.includedLocations);
    assert.equal(new Set(members.map(m=>m.locationId)).size,members.length,'historical split member overlap');
    Object.assign(row,{workId:`${day}:${family}:${phase}:${owner.slotId.slice(0,8)}`,ownerSlotId:owner.slotId,originSlotId:owner.slotId,
      includedLocations:structuredClone(members),locationId:members[0]?.locationId||row.locationId,
      serviceEffortMinutes:rows.reduce((n,r)=>n+r.serviceEffortMinutes,0),window:row.serviceMode==='reminder_only'?{start:'08:00',end:'08:30'}:
        phase==='morning'?{start:owner.shift[0],end:'09:45'}:{start:'09:45',end:owner.shift[1]}});expectedRows.push(row);
  }
  assert.equal(expectedRows.length,313,'trusted full-nine recipe changed');
  const expected=new Map(expectedRows.map(r=>[r.workId,r]));
  assert.equal(new Set(accepted.version.assignments.map(r=>r.workId)).size,313,'duplicate historical work identity');
  for(const row of accepted.version.assignments){
    const original=expected.get(row.workId);assert.ok(original,'foreign historical full-nine work identity');
    const normalized=structuredClone(original);
    // Both existing exact generator and runtime-adapter provenance encodings
    // are retained. No arbitrary wildcard provenance or extra-field tolerance.
    if(row.serviceEffortProvenance===`base:${currentHandout.base}:effort`){
      normalized.serviceEffortProvenance=row.serviceEffortProvenance;
      normalized.priorityProvenance=`base:${currentHandout.base}:priority`;
      normalized.qualificationProvenance=`base:${currentHandout.base}:qualifications`;
    }
    const restriction=`owner:${sourceConfigSha}:hard_place_eligibility;base:${currentHandout.base}`;
    if(row.restrictionProvenance===restriction)normalized.restrictionProvenance=restriction;
    if(Object.hasOwn(row,'restrictedSlotIds'))normalized.restrictedSlotIds=hardRestrictedSlots(fullConfig,row.locationCodeSnapshot,original.restrictedSlotIds||[]);
    assert.equal(canonicalJson(row),canonicalJson(normalized),'historical full-row/physical/workload/provenance drift');
  }
  // Target people must already be represented by the authenticated hydrated
  // source ledger. Do not close/erase incumbencies or import historical people.
  for(const slot of Object.values(targetSlots)){
    const row=accepted.slots.find(r=>r.id===slot.slotId);assert.ok(row&&!row.contractorCapacity,'target stable employee source position missing');
    const current=(row.incumbencies||[]).filter(p=>p.effectiveStart<=effectiveDate&&(!p.effectiveEnd||effectiveDate<p.effectiveEnd));
    assert.equal(current.length,slot.vacancy===true?0:1,'target/source current incumbency binding mismatch');
    if(!slot.vacancy)assert.deepEqual([current[0].personId,current[0].displayName],[slot.personId,slot.name],'target/source current person binding mismatch');
  }
  const source=structuredClone(accepted);source.serviceDate=effectiveDate;source.exceptions=[];
  if(registeredCorrection){
    assert.equal(registeredCorrection.serviceDate,effectiveDate,'registered correction service date changed');
    assert.deepEqual(registeredCorrection.slots.map(s=>s.id).sort(),accepted.slots.map(s=>s.id).sort(),
      'registered correction stable positions changed');
    for(const slot of Object.values(targetSlots)){
      const row=registeredCorrection.slots.find(s=>s.id===slot.slotId);
      const active=(row?.incumbencies||[]).filter(p=>p.effectiveStart<=effectiveDate&&(!p.effectiveEnd||effectiveDate<p.effectiveEnd));
      assert.equal(active.length,slot.vacancy===true?0:1,'registered correction current roster occupancy changed');
      if(!slot.vacancy)assert.deepEqual([active[0].personId,active[0].displayName],[slot.personId,slot.name],
        'registered correction current person changed');
    }
  }
  Object.assign(source.version,{effectiveStart:effectiveDate,effectiveEnd:null,status:'published',namedAbsentSlotIds:[],
    vacantSlotIds:Object.values(targetSlots).filter(s=>s.vacancy===true).map(s=>s.slotId).sort(),
    vacancyCapableSlotIds:Object.values(targetSlots).map(s=>s.slotId).sort()});
  const groups=new Map();
  for(const row of accepted.version.assignments){const key=`${row.dayOfWeek}/${phaseOf(row)}/${row.locationCodeSnapshot}`;
    groups.set(key,[...(groups.get(key)||[]),row]);}
  const comparisonLedger=[],rows=[];
  const mandatoryBindings=mandatoryReductionBindings(accepted,config);
  config.fullNineReductionBinding={schema:'custodial.full-nine-mandatory-current-owner-binding.v1',
    acceptedSourceDigest:contentDigest(accepted),correctionAuthorityDigest:contentDigest(correctionConfig),
    mandatoryPrimaryOwnerBindings:mandatoryBindings,mandatoryChangeCostConstant:mandatoryBindings.reduce((n,b)=>n+b.fixedChangeCost,0)};
  config.overrides={};config.preserveBaseDays=[];
  for(let day=0;day<7;day++)for(const phase of ['morning','equalized']){
    config.overrides[String(day)]||={};config.overrides[String(day)][phase]={};
    const candidates=[...groups].filter(([key])=>key.startsWith(`${day}/${phase}/`));
    if(phase==='morning')for(const family of config.adminFamilies)candidates.push([`${day}/morning/${family}`,groups.get(`${day}/equalized/${family}`)]);
    for(const [group,old]of candidates){const family=group.split('/')[2];if(currentHandout.retired.includes(family))continue;
      assert.ok(old?.length,'current correction physical definition missing');
      const dominant=[...old].sort((a,b)=>b.serviceEffortMinutes-a.serviceEffortMinutes||
        Object.keys(targetSlots).find(k=>targetSlots[k].slotId===a.originSlotId).localeCompare(Object.keys(targetSlots).find(k=>targetSlots[k].slotId===b.originSlotId)))[0];
      const originalKey=Object.keys(targetSlots).find(k=>targetSlots[k].slotId===dominant.originSlotId);assert.ok(originalKey,'accepted reference outside stable positions');
      const mandatory=phase==='equalized'?mandatoryBindings.find(b=>b.dayOfWeek===day&&b.family===family):null;
      const correctedAdmin=phase==='morning'&&config.adminFamilies.includes(family)
        ?registeredCorrection?.version.assignments.filter(r=>r.dayOfWeek===day&&r.locationCodeSnapshot===family&&r.window.end==='09:45') : null;
      if(correctedAdmin)assert.equal(correctedAdmin.length,1,'exact registered Admin morning owner missing');
      const correctedAdminKey=correctedAdmin?Object.keys(targetSlots).find(k=>targetSlots[k].slotId===correctedAdmin[0].originSlotId):null;
      if(correctedAdmin)assert.ok(correctedAdminKey,'registered Admin morning owner outside stable positions');
      const key=mandatory?Object.keys(targetSlots).find(k=>targetSlots[k].slotId===mandatory.mandatoryPrimarySlotId):
        (correctedAdminKey||originalKey);
      const members=old.flatMap(r=>r.includedLocations);assert.equal(new Set(members.map(m=>m.locationId)).size,members.length,'accepted split member overlap');
      const row=structuredClone(old[0]),owner=targetSlots[key];
      Object.assign(row,{workId:`${day}:${family}:${phase}:${owner.slotId.slice(0,8)}`,ownerSlotId:owner.slotId,originSlotId:owner.slotId,
        includedLocations:structuredClone(members),locationId:members[0]?.locationId||row.locationId,
        serviceEffortMinutes:old.reduce((n,r)=>n+r.serviceEffortMinutes,0),window:phase==='morning'?{start:owner.shift[0],end:'09:45'}:{start:'09:45',end:owner.shift[1]},
        serviceEffortProvenance:`base:${currentHandout.base}:effort`,priorityProvenance:`base:${currentHandout.base}:priority`,
        qualificationProvenance:`base:${currentHandout.base}:qualifications`,restrictionProvenance:`owner:40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30:hard_place_eligibility;base:${currentHandout.base}`,
        restrictedSlotIds:hardRestrictedSlots(config,family,old.flatMap(r=>r.restrictedSlotIds||[]))});
      rows.push(row);(config.overrides[String(day)][phase][key]||=[]).push(family);
      comparisonLedger.push({day,phase,family,originalRows:structuredClone(old),originalRowsDigest:contentDigest(old),referenceSlotId:targetSlots[correctedAdminKey||originalKey].slotId,
        comparisonSourceOwnerSlotId:owner.slotId,...(mandatory?{mandatoryCurrentOwnerBinding:mandatory}:{}),
        referenceKind:correctedAdminKey?'AUTHORIZED_ADMIN_MORNING_CURRENT_SOURCE':old.length>1?'EXISTING_DOMINANT_POINT_SHARE_FAMILY_PREFERENCE_ONLY':'EXACT_ACCEPTED_OWNER',
        ...(correctedAdmin?{currentCorrectionRowDigest:contentDigest(correctedAdmin[0])}:{}),
        physicalMemberIds:members.map(m=>m.locationId),inheritedWorkloadPoints:row.serviceEffortMinutes,
        addedMorningByCurrentAuthority:phase==='morning'&&config.adminFamilies.includes(family)});
    }
  }
  const oldReminder=accepted.version.assignments.filter(r=>r.locationCodeSnapshot==='ELEPHANT_TRUNK_RESTROOMS');
  assert.equal(oldReminder.length,1,'historical Elephant reminder correction definition missing');
  const reminder=structuredClone(oldReminder[0]);
  Object.assign(reminder,{dayOfWeek:2,workId:currentReminderId,ownerSlotId:config.slots.KATHY.slotId,originSlotId:config.slots.KATHY.slotId,
    locationNameSnapshot:'Elephant Trunk Gift Shop employee men and women restrooms',window:{start:'10:00',end:'10:30'},
    serviceEffortProvenance:`base:${currentHandout.base}:effort`,priorityProvenance:`base:${currentHandout.base}:priority`,
    qualificationProvenance:`base:${currentHandout.base}:qualifications`,restrictionProvenance:`owner:40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30:hard_place_eligibility;base:${currentHandout.base}`,restrictedSlotIds:[]});
  assert.equal(contentDigest(reminder),currentHandout.reminder,'authorized Tuesday reminder derivation changed');rows.push(reminder);
  if(registeredCorrection){
    const correctedMorning=new Map(registeredCorrection.version.assignments
      .filter(r=>r.window?.end==='09:45').map(r=>[`${r.dayOfWeek}\0${r.locationCodeSnapshot}`,r]));
    const generatedMorning=rows.filter(r=>r.window?.end==='09:45');
    assert.equal(correctedMorning.size,generatedMorning.length,'registered correction morning multiplicity changed');
    const protectedPackage=row=>({family:row.locationCodeSnapshot,day:row.dayOfWeek,
      locationId:row.locationId,memberIds:row.includedLocations.map(m=>m.locationId).sort(),
      serviceMode:row.serviceMode,schedulingMode:row.schedulingMode,
      serviceEffortMinutes:row.serviceEffortMinutes,priority:row.priority});
    rows.splice(0,rows.length,...rows.map(row=>{
      if(row.window?.end!=='09:45')return row;
      const corrected=correctedMorning.get(`${row.dayOfWeek}\0${row.locationCodeSnapshot}`);
      assert.ok(corrected,'registered correction morning package missing');
      assert.equal(canonicalJson(protectedPackage(row)),canonicalJson(protectedPackage(corrected)),
        'registered correction changed protected morning package facts');
      return structuredClone(corrected);
    }));
    const keyBySlot=new Map(Object.entries(targetSlots).map(([key,slot])=>[slot.slotId,key]));
    for(let day=0;day<7;day++)config.overrides[String(day)].morning=Object.fromEntries(Object.keys(targetSlots).sort()
      .map(key=>[key,rows.filter(r=>r.dayOfWeek===day&&r.window?.end==='09:45'&&keyBySlot.get(r.originSlotId)===key)
        .map(r=>r.locationCodeSnapshot).sort()]).filter(([,families])=>families.length));
  }
  source.version.assignments=rows.sort(byWork);
  const availability=new Map(accepted.version.slotAvailability.map(r=>[`${r.dayOfWeek}\0${r.slotId}`,r]));
  assert.equal(availability.size,accepted.version.slotAvailability.length,'duplicate accepted day availability');
  const currentAvailability=registeredCorrection?new Map(registeredCorrection.version.slotAvailability.map(r=>[`${r.dayOfWeek}\0${r.slotId}`,r])):null;
  if(currentAvailability)assert.equal(currentAvailability.size,registeredCorrection.version.slotAvailability.length,'duplicate registered current day availability');
  const dayAvailabilityReferences=[];
  source.version.slotAvailability=[...accepted.version.slotAvailability.filter(r=>!Object.values(targetSlots).some(s=>s.slotId===r.slotId)),
    ...Object.values(targetSlots).flatMap(slot=>slot.workDays.map(day=>{
      const original=availability.get(`${day}\0${slot.slotId}`),current=currentAvailability?.get(`${day}\0${slot.slotId}`);
      if(currentAvailability)assert.ok(current,'registered current target day availability missing');
      const reference=original||current;assert.ok(reference,'current target day has no source-bound capacity template');
      dayAvailabilityReferences.push({day,slotId:slot.slotId,kind:original?'ORIGINAL_ACCEPTED_SAME_DAY':'CURRENT_CORRECTION_NEW_DAY',
        sourceDigest:contentDigest(reference),...(current?{currentCorrectionDigest:contentDigest(current)}:{})});
      return {...structuredClone(reference),status:slot.vacancy===true?'vacant_unfilled':'working',shift:{start:slot.shift[0],end:slot.shift[1]},lunch:recurringOwnerLunch(slot,day)};
    }))];
  source.version.shiftEndContinuityPolicy=createShiftEndContinuityPolicy(config.weights,
    '40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30',postgresJsonbContentDigest,config.namedShiftEndHandoffs);
  const structure=reductionStructure(source);
  for(let day=0;day<7;day++)for(const phase of ['morning','equalized']){
    const tuples=rows.filter(r=>r.dayOfWeek===day&&structure.phaseByWorkId.get(r.workId)===phase).map(r=>({family:r.locationCodeSnapshot,
      locationId:r.locationId,memberIds:r.includedLocations.map(m=>m.locationId),serviceMode:r.serviceMode,schedulingMode:r.schedulingMode}))
      .sort((a,b)=>a.family<b.family?-1:a.family>b.family?1:0);
    assert.equal(contentDigest(tuples),currentHandout.packageTuples,'reduction current package union/identity changed');
  }
  const diff=sourceDiff(accepted,source),body={schema:reductionAuthority.schema,acceptedSource:structuredClone(accepted),
    acceptedSourceDigest:contentDigest(accepted),sourceId:publishedSource.source_id,patternPublicationId:authority.patternPublicationId,
    effectivePublicationId:authority.publicationId,authorityRevision:expectedRevision,effectiveDate,
    managerSnapshotDigest:contentDigest(managerSnapshot),correctionAuthorityDigest:contentDigest(correctionConfig),
    fullConfigDigest:contentDigest(fullConfig),fullOwnersDigest:contentDigest(fullOwners),registeredBaseDigest:contentDigest(base),
    comparisonLedger,comparisonLedgerDigest:contentDigest(comparisonLedger),source,currentConfig:config,
    dayAvailabilityReferences,dayAvailabilityReferencesDigest:contentDigest(dayAvailabilityReferences),
    ...(registeredCorrection?{registeredCorrectionSource:structuredClone(registeredCorrection),
      correctionTemplateConfig:structuredClone(correctionConfig),
      registeredCorrectionSourceDigest:contentDigest(registeredCorrection),correctionWitness:structuredClone(correctionWitness)}:{}),
    correctionReceipt:{schema:'custodial.full-nine-current-owner-correction.v1',historicalRows:313,desiredRows:323,
      historicalNamedPolicy:structuredClone(policy),currentNamedPolicy:structuredClone(source.version.shiftEndContinuityPolicy),
      retiredRows:accepted.version.assignments.filter(r=>currentHandout.retired.includes(r.locationCodeSnapshot)),
      oldElephantReminder:structuredClone(oldReminder[0]),currentTuesdayReminder:structuredClone(reminder),
      diff,diffDigest:contentDigest(diff),newBytesAreHistoricalFacts:false},admitted:false,published:false};
  return {...body,contextDigest:contentDigest(body)};
}
export function currentHandoutRecurringStructure(input,config){
  if(!config.sourceHandout&&!config.dateAuthority)return null;
  // September26 is an independently retained historical312/313 lineage. Its
  // complete trusted handout descriptor, not merely absence of an Oct date,
  // selects the unchanged legacy count/family validation below.
  if(!config.dateAuthority&&canonicalJson(config.sourceHandout)===canonicalJson({
    path:'config/custodial-six-person-handout-20260926.json',
    pdfSha256:'a1f1dbb6826ba09ff3a81332632c0ba433ed6770e9fb48efc009382eccdfdeb1',
    precedence:'areas are a geographic seed; later fixed lunches, restrictions and workload policy control'}))return null;
  assert.equal(config.sourceHandout?.pdfSha256,currentHandout.pdf,'current handout PDF lineage changed');
  assert.equal(config.sourceHandout?.jsonSha256,currentHandout.json,'current handout JSON lineage changed');
  assert.equal(config.basePacket?.sha256,currentHandout.base,'current handout base lineage changed');
  assert.equal(config.dateAuthority?.ownerEffectiveStart,'2026-10-01','current owner date lineage changed');
  assert.equal(config.dateAuthority?.recurringEffectiveStart,'2026-10-05','current recurring date lineage changed');
  assert.equal(config.dateAuthority?.source,'Eric direct October 1 Admin correction relayed in September 30 delegation','current owner correction lineage changed');
  assert.equal(config.allowAdminMorning,true,'current source requires explicit allowed Admin morning lineage');
  assert.deepEqual(sorted(config.adminFamilies||[]),['EAST_ADMIN','WEST_ADMIN'],'current Admin family scope changed');
  assert.deepEqual(sorted(config.retiredAreaFamilies||[]),currentHandout.retired,'current retired family scope changed');
  assert.equal(contentDigest(config.namedShiftEndHandoffs),currentHandout.namedHandoffs,'accepted current named handoff bytes missing/changed');
  const policy=input.version?.shiftEndContinuityPolicy;
  assert.ok(policy&&typeof policy==='object','source-bound continuity policy missing');
  const {policyDigest,...policyBody}=policy;
  assert.equal(policyDigest,postgresJsonbContentDigest(policyBody),'source-bound continuity policy digest changed');
  assert.equal(canonicalJson(policy.weights),canonicalJson(config.weights),'source/config continuity weights changed');
  assert.equal(canonicalJson(input.version?.shiftEndContinuityPolicy?.namedHandoffs||[]),canonicalJson(config.namedShiftEndHandoffs||[]),
    'current named handoff source/config binding changed');
  const rows=input.version?.assignments;
  assert.ok(Array.isArray(rows),'canonical single-version current source required');
  assert.equal(new Set(rows.map(row=>row.workId)).size,rows.length,'duplicate current source work identity');
  const phaseByWorkId=new Map(),fixedRows=[];
  for(const row of rows){
    if(row.workId===currentReminderId){
      assert.equal(contentDigest(row),currentHandout.reminder,'protected fixed Tuesday reminder bytes changed');
      phaseByWorkId.set(row.workId,null);fixedRows.push(structuredClone(row));continue;
    }
    const owner=Object.values(config.slots).find(slot=>slot.slotId===row.ownerSlotId);
    assert.ok(owner&&row.originSlotId===row.ownerSlotId&&owner.workDays.includes(row.dayOfWeek),'current recurring source owner/position changed');
    const phase=row.window?.start==='09:45'?'equalized':row.window?.end==='09:45'?'morning':null;
    assert.ok(phase,'unknown out-of-phase current source row');
    assert.deepEqual(row.window,phase==='morning'?{start:owner.shift[0],end:'09:45'}:{start:'09:45',end:owner.shift[1]},
      'current recurring source window changed');
    assert.equal(row.workId,`${row.dayOfWeek}:${row.locationCodeSnapshot}:${phase}:${owner.slotId.slice(0,8)}`,
      'current recurring source work identity changed');
    phaseByWorkId.set(row.workId,phase);
  }
  assert.equal(fixedRows.length,1,'protected fixed Tuesday reminder missing');
  for(let day=0;day<7;day++)for(const phase of ['morning','equalized']){
    const chosen=rows.filter(row=>row.dayOfWeek===day&&phaseByWorkId.get(row.workId)===phase);
    const tuples=chosen.map(row=>({family:row.locationCodeSnapshot,locationId:row.locationId,
      memberIds:row.includedLocations?.map(member=>member.locationId),serviceMode:row.serviceMode,schedulingMode:row.schedulingMode}))
      .sort((a,b)=>a.family<b.family?-1:a.family>b.family?1:0);
    assert.equal(contentDigest(tuples),currentHandout.packageTuples,`current package identities/multiplicity changed ${day}/${phase}`);
    assert.deepEqual(sorted(chosen.map(row=>row.locationCodeSnapshot)),
      sorted(Object.values(config.overrides?.[String(day)]?.[phase]||{}).flat()),`current config/source families changed ${day}/${phase}`);
  }
  return {schema:'custodial.current-handout-recurring-structure.v1',sourceDigest:contentDigest(input),configDigest:contentDigest(config),
    lineageDigest:contentDigest(currentHandout),packageTupleDigest:currentHandout.packageTuples,phaseByWorkId,fixedRows,
    fixedRowsDigest:contentDigest(fixedRows),retiredFamilyBindings:currentHandout.retired.map(family=>({family,day:1,phase:'morning',
      sourceHandoutJsonSha256:currentHandout.json,sourceHandoutPdfSha256:currentHandout.pdf}))};
}

export function recurringOwnerLunch(slot,day){
  assert.ok(Number.isInteger(day)&&slot.workDays.includes(day),'fixed lunch requested outside current workdays');
  const validTime=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const validate=interval=>{assert.ok(Array.isArray(interval)&&interval.length===2&&interval.every(validTime)
    &&interval[0]<interval[1]&&interval[0]>=slot.shift[0]&&interval[1]<=slot.shift[1],'invalid explicit fixed lunch interval');};
  if(slot.lunchByDay!==undefined){
    assert.ok(slot.lunchByDay&&typeof slot.lunchByDay==='object'&&!Array.isArray(slot.lunchByDay),'invalid explicit lunch day map');
    for(const [key,value]of Object.entries(slot.lunchByDay)){
      // Retain valid historical off-day metadata (e.g. Tammy Sunday after the
      // owner changed her current workweek). It never creates availability:
      // only the explicit currently working day requested above is consumed.
      assert.ok(/^[0-6]$/.test(key),'invalid explicit fixed lunch day key');validate(value);
    }
  }
  const interval=Object.hasOwn(slot.lunchByDay||{},String(day))?slot.lunchByDay[String(day)]:slot.lunch;
  validate(interval);return {start:interval[0],end:interval[1]};
}

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
  templateConfig, fullConfig = null, fullOwners, fullNineSource = null,
  correctionSource = null, correctionWitness = null, effectiveDate, expectedRevision }) {
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
  const legacyNine=fullConfig&&input.version.assignments.length===313;
  if(legacyNine&&Object.values(slots).filter(slot=>slot.vacancy!==true).length<9){
    const reductionContext=createFullNineReductionContext({publishedSource,managerSnapshot,correctionConfig:templateConfig,
      fullConfig,fullOwners,fullNineSource,correctionSource,correctionWitness,effectiveDate,expectedRevision});
    return {currentConfig:reductionContext.currentConfig,reductionContext,sourceId,publicationId,authorityRevision:expectedRevision,
      ...(patternAuthority.repairContext?{patternPublicationId:patternAuthority.patternPublicationId,
        repairContext:patternAuthority.repairContext,repairContextDigest:patternAuthority.repairContextDigest}:{}),
      sourcePatternKind:'FULL_NINE',source:'AUTHORITY_READBACK_ONLY'};
  }
  const currentStructure=legacyNine?null:currentHandoutRecurringStructure(input,templateConfig);
  const observedPhase=row=>currentStructure?currentStructure.phaseByWorkId.get(row.workId):phaseOf(row);
  const keyBySlot = new Map(Object.entries(slots).map(([key, slot]) => [slot.slotId, key]));
  assert.equal(keyBySlot.size, 9, "nine stable employee positions required");
  assert.ok(new Set(input.slots.map((row) => row.id)).size === input.slots.length,
    "published source contains duplicate positions");
  assert.ok(currentStructure||[312, 313].includes(input.version.assignments.length),
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
        && observedPhase(item) === phase)) {
        const key = keyBySlot.get(row.ownerSlotId);
        // A just-vacated position may still own work in the old immutable
        // publication. It is valid *prior* geography, never a candidate owner.
        assert.ok(key && slots[key].workDays.includes(day),
          `published owner unavailable ${day}/${phase}/${row.locationCodeSnapshot}`);
        const family = row.locationCodeSnapshot;
        ownerByFamily.set(family, [...(ownerByFamily.get(family) || []),
          { key, effort: Number(row.serviceEffortMinutes || 0) }]);
      }
      const historical=Object.keys(fullOwners?.[String(day)]?.[phase]||{});
      const expected=currentStructure?historical.filter(family=>!(day===1&&phase==='morning'&&currentHandout.retired.includes(family)))
        .concat(phase==='morning'?templateConfig.adminFamilies:[]):historical;
      assert.deepEqual([...ownerByFamily.keys()].sort(),sorted(expected),
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
  } else if(!currentStructure) {
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
    ...(currentStructure?{currentStructure:{schema:currentStructure.schema,sourceDigest:currentStructure.sourceDigest,
      configDigest:currentStructure.configDigest,lineageDigest:currentStructure.lineageDigest,
      packageTupleDigest:currentStructure.packageTupleDigest,fixedRowsDigest:currentStructure.fixedRowsDigest,
      retiredFamilyBindings:currentStructure.retiredFamilyBindings}}:{}),
    ...(patternAuthority.repairContext ? {patternPublicationId:patternAuthority.patternPublicationId,
      repairContext:patternAuthority.repairContext,repairContextDigest:patternAuthority.repairContextDigest} : {}),
    authorityRevision: expectedRevision, sourcePatternKind: fullNine ? "FULL_NINE" : "UNSPLIT",
    source: "AUTHORITY_READBACK_ONLY" };
}

// Produce a candidate from a supplied canonical compiler document. The caller
// must authenticate its release-registered source identity; this pure helper
// cannot do that or authorize registration/publication by itself.
export function adaptRegisteredRecurringSource({ registeredSource, patternConfig,
  fullNineSource = null, allowSplitSource = false, reductionContext = null }) {
  validateOwnerEligibilityConfig(patternConfig);
  const actual = Object.values(patternConfig?.slots || {}).filter((slot) => slot.vacancy !== true).length;
  assert.ok(actual >= 6 && actual <= 9, "six to nine current people required");
  if(reductionContext){
    assertReductionContext(reductionContext);
    assert.equal(contentDigest(registeredSource),reductionContext.acceptedSourceDigest,'reduction accepted source drift');
    assert.equal(canonicalJson(patternConfig.slots),canonicalJson(reductionContext.currentConfig.slots),'reduction target identity/days/lunch/restriction drift');
    const facts=config=>Object.fromEntries(Object.entries(config).filter(([k])=>!['overrides','correctionNotes'].includes(k)));
    assert.equal(canonicalJson(facts(patternConfig)),canonicalJson(facts(reductionContext.currentConfig)),'reduction current correction configuration drift');
  }
  const input = structuredClone(reductionContext?reductionContext.source:actual === 9 ? fullNineSource : registeredSource);
  assert.ok(input && Array.isArray(input.slots) && Array.isArray(input.version?.assignments)
    && Array.isArray(input.version?.slotAvailability), "registered canonical source required");
  const currentStructure=reductionContext?reductionStructure(input):actual===9?null:currentHandoutRecurringStructure(input,patternConfig);
  const sourcePhase=row=>currentStructure?currentStructure.phaseByWorkId.get(row.workId):phaseOf(row);
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
  const revised = original.filter((row) => !affectedDays.includes(row.dayOfWeek)||sourcePhase(row)===null);
  for (const day of affectedDays) for (const phase of ["morning", "equalized"]) {
    const assignments = patternConfig.overrides[String(day)]?.[phase];
    assert.ok(assignments, `missing candidate assignment ${day}/${phase}`);
    const wanted = new Map();
    for (const [key, families] of Object.entries(assignments)) for (const family of families) {
      assert.ok(!wanted.has(family), `duplicate candidate family ${day}/${phase}/${family}`);
      wanted.set(family, key);
    }
    const groups = new Map();
    for (const row of original.filter((item) => item.dayOfWeek === day && sourcePhase(item) === phase)) {
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
  for (const row of input.version.slotAvailability){
    const key=currentStructure?`${row.dayOfWeek}\0${row.slotId}`:row.slotId;
    if(currentStructure)assert.ok(!availabilityTemplate.has(key),'duplicate registered dated availability template');
    if(!availabilityTemplate.has(key))availabilityTemplate.set(key,row);
  }
  input.version.slotAvailability = [
    ...input.version.slotAvailability.filter((row) => !keyBySlot.has(row.slotId)),
    ...Object.values(patternConfig.slots).flatMap((slot) => slot.workDays.map((dayOfWeek) => {
      const template = availabilityTemplate.get(currentStructure?`${dayOfWeek}\0${slot.slotId}`:slot.slotId);
      assert.ok(template, `registered dated availability template missing ${slot.slotId}/${dayOfWeek}`);
      if(currentStructure)assert.deepEqual(template.lunch,recurringOwnerLunch(slot,dayOfWeek),'registered source fixed day lunch does not match trusted pattern');
      return { ...structuredClone(template), dayOfWeek };
    })),
  ].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.slotId.localeCompare(b.slotId));
  for (const row of input.version.slotAvailability) {
    const key = keyBySlot.get(row.slotId);
    if (!key) continue;
    const slot = patternConfig.slots[key];
    row.status = slot.vacancy === true ? "vacant_unfilled" : "working";
    row.shift = { start: slot.shift[0], end: slot.shift[1] };
    row.lunch = currentStructure?recurringOwnerLunch(slot,row.dayOfWeek):{start:slot.lunch[0],end:slot.lunch[1]};
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
    if(currentStructure?.phaseByWorkId.get(assignment.workId)===null)continue;
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
    patternConfig.weights, fingerprint, postgresJsonbContentDigest,
    currentStructure?patternConfig.namedShiftEndHandoffs||[]:[]);
  // Store and hash the same canonical collection ordering the compiler uses.
  // SQL compares the whole registered structural identity, including array
  // order. Locally sorting by label/UUID is not that canonical identity and
  // otherwise makes a correct preview impossible to admit as a draft.
  const canonicalInput = normalizeStaticWeeklyAuthority(input.version, input.slots,
    input.exceptions, input.proximity, input.serviceDate);
  if(currentStructure)assert.equal(contentDigest(canonicalInput.version.assignments.filter(row=>row.workId===currentReminderId)),
    currentStructure.fixedRowsDigest,'protected fixed reminder changed during candidate normalization');
  return { compilerInput: canonicalInput, patternFingerprint: fingerprint,
    status: "CANDIDATE_ONLY", registrationRequired: true, managerConfirmationRequired: true };
}

// A different day's fixed rows are only a canonical-feasibility scaffold.
// Historical accepted late rows remain the original-owner/100-cost reference;
// their former owners may be vacant in the current target week. The registered
// current correction supplies a feasible owner, never a new preference seed.
export function createReductionFixedOtherDaysSource({source,ownerConfig,reductionContext}){
 assertReductionContext(reductionContext);
 assert.ok(reductionContext.registeredCorrectionSource&&reductionContext.correctionWitness,
  'distinct registered current correction required for fixed-day scaffold');
 const key=row=>`${row.dayOfWeek}\0${row.locationCodeSnapshot}`;
 const originalRows=reductionContext.source.version.assignments.filter(row=>row.window?.start==='09:45');
 const sourceRows=source?.version?.assignments?.filter(row=>row.window?.start==='09:45');
 assert.equal(canonicalJson(sourceRows),canonicalJson(originalRows),
  'morning candidate changed historical late comparison rows');
 const correctedRows=reductionContext.registeredCorrectionSource.version.assignments
  .filter(row=>row.window?.start==='09:45');
 const corrected=new Map(correctedRows.map(row=>[key(row),row]));
 assert.equal(corrected.size,correctedRows.length,'duplicate current correction late family');
 assert.equal(corrected.size,originalRows.length,'current correction late family count changed');
 const slots=new Map(Object.values(ownerConfig.slots).map(slot=>[slot.slotId,slot]));
 const fixedFacts=row=>Object.fromEntries(Object.entries(row)
  .filter(([name])=>!['workId','ownerSlotId','originSlotId','window'].includes(name)));
 const result=structuredClone(source),used=new Set();
 result.version.assignments=result.version.assignments.map(row=>{
  if(row.window?.start!=='09:45')return row;
  const identity=key(row),current=corrected.get(identity);
  assert.ok(current&&!used.has(identity),`registered current late family missing or repeated: ${identity}`);
  used.add(identity);
  assert.equal(canonicalJson(fixedFacts(row)),canonicalJson(fixedFacts(current)),
   `registered current correction changed protected late work facts: ${identity}`);
  const owner=slots.get(current.originSlotId);
  assert.ok(owner&&owner.vacancy!==true&&owner.workDays.includes(row.dayOfWeek)
   &&current.ownerSlotId===owner.slotId&&current.window.end===owner.shift[1]
   &&!row.restrictedSlotIds.includes(owner.slotId),
   `registered current late owner unavailable: ${identity}`);
  return {...row,workId:current.workId,ownerSlotId:current.ownerSlotId,
   originSlotId:current.originSlotId,window:structuredClone(current.window)};
 });
 assert.equal(used.size,corrected.size,'registered current late family left unmatched');
 return result;
}

// The normal generator's pre-balanced09:45 owners are NOT the preference
// baseline. Keep its explicit morning candidate, current roster/availability,
// and exact original accepted09:45 work bytes for the canonical phase query.
export function createRecurringPhaseSourceBasis({registeredSource,patternConfig,reductionContext=null,morningWeek=null,morningBasis=null,fullOwners=null}){
  if(morningWeek){
    assert.ok(morningBasis&&fullOwners,'explicit current morning source basis required');
    if(reductionContext){
      assertReductionContext(reductionContext);
      assert.equal(morningBasis.reductionContextDigest,reductionContext.contextDigest,
        'morning and late historical/current correction contexts differ');
      assert.equal(contentDigest(registeredSource),reductionContext.acceptedSourceDigest,
        'historical late comparison source changed');
    }
    assertRecurringMorningWeekCandidate({week:morningWeek,basis:morningBasis,fullOwners});
    assert.equal(contentDigest(registeredSource),morningBasis.registeredSourceDigest,'morning original source changed');
    assert.equal(contentDigest(patternConfig),morningBasis.ownerConfigDigest,'morning current configuration changed');
    const source=structuredClone(morningWeek.candidateSource),ownerConfig=structuredClone(patternConfig),
      keyBySlot=new Map(Object.entries(ownerConfig.slots).map(([key,slot])=>[slot.slotId,key]));
    for(let day=0;day<7;day++)ownerConfig.overrides[String(day)].morning=Object.fromEntries(Object.keys(ownerConfig.slots).sort()
      .map(key=>[key,source.version.assignments.filter(row=>row.dayOfWeek===day&&row.window.end==='09:45'&&keyBySlot.get(row.originSlotId)===key)
        .map(row=>row.locationCodeSnapshot).sort()]).filter(([,families])=>families.length));
    const structure=currentHandoutRecurringStructure(source,ownerConfig),
      lateReference=reductionContext?.source||registeredSource,
      originals=lateReference.version.assignments.filter(r=>r.window.start==='09:45');
    assert.equal(canonicalJson(source.version.assignments.filter(r=>r.window.start==='09:45')),canonicalJson(originals),'original accepted late reference changed');
    let fixedOtherDaysSource;
    if(reductionContext){
      fixedOtherDaysSource=createReductionFixedOtherDaysSource({source,ownerConfig,reductionContext});
    }
    const body={schema:'custodial.recurring-phase-source-basis.v1',source,ownerConfig,
      registeredSourceDigest:contentDigest(registeredSource),generatedPatternConfigDigest:contentDigest(patternConfig),
      ...(reductionContext?{reductionContext,
        fixedOtherDaysSource,
        historicalAcceptedSourceDigest:reductionContext.acceptedSourceDigest,
        currentCorrectionSourceDigest:reductionContext.registeredCorrectionSourceDigest,
        correctionWitnessDigest:reductionContext.correctionWitness.digest}:{}),
      originalEqualizedRowsDigest:contentDigest(originals),generatedMorningRowsDigest:contentDigest(source.version.assignments.filter(r=>r.window.end==='09:45')),
      fixedRowsDigest:structure.fixedRowsDigest,
      comparisonReference:reductionContext?'EXPLICIT_FULL_NINE_DOMINANT_FAMILY_REFERENCE_WITH_LOSSLESS_SPLIT_LEDGER':'ORIGINAL_ACCEPTED_POST0945_SOURCE',
      morningBasis:'VERIFIED_ORIGINAL_SOURCE_MORNING_OBJECTIVE',morningSourceBasisDigest:morningBasis.basisDigest,
      morningWeekSemanticDigest:contentDigest(recurringMorningWeekSemanticFacts(morningWeek)),admitted:false,published:false};
    return {...body,basisDigest:contentDigest(body)};
  }
  if(reductionContext)assertReductionContext(reductionContext);
  const referenceSource=reductionContext?reductionContext.source:registeredSource;
  const structure=reductionContext?reductionStructure(referenceSource):currentHandoutRecurringStructure(registeredSource,patternConfig);
  assert.ok(structure,'canonical phase source basis requires the exact current handout lineage');
  const generated=adaptRegisteredRecurringSource({registeredSource,patternConfig,reductionContext});
  const source=structuredClone(generated.compilerInput),ownerConfig=structuredClone(patternConfig);
  const keys=new Map(Object.entries(ownerConfig.slots).map(([key,slot])=>[slot.slotId,key]));
  const originals=referenceSource.version.assignments.filter(row=>structure.phaseByWorkId.get(row.workId)==='equalized');
  const originalByFamily=new Map(originals.map(row=>[`${row.dayOfWeek}\0${row.locationCodeSnapshot}`,row]));
  source.version.assignments=source.version.assignments.map(row=>row.window.start==='09:45'
    ?structuredClone(originalByFamily.get(`${row.dayOfWeek}\0${row.locationCodeSnapshot}`)):row);
  for(let day=0;day<7;day++)ownerConfig.overrides[String(day)].equalized=Object.fromEntries(
    Object.keys(ownerConfig.slots).sort().map(key=>[key,originals.filter(row=>row.dayOfWeek===day
      &&keys.get(row.originSlotId)===key).map(row=>row.locationCodeSnapshot).sort()]).filter(([,families])=>families.length));
  const checked=reductionContext?reductionStructure(source):currentHandoutRecurringStructure(source,ownerConfig);
  assert.equal(contentDigest(source.version.assignments.filter(row=>row.window.start==='09:45').sort((a,b)=>a.workId<b.workId?-1:1)),
    contentDigest(structuredClone(originals).sort((a,b)=>a.workId<b.workId?-1:1)),'original accepted09:45 source bytes changed');
  let fixedOtherDaysSource;
  if(reductionContext){
    const seedOwners=new Map(generated.compilerInput.version.assignments.filter(r=>r.window.start==='09:45')
      .map(r=>[`${r.dayOfWeek}/${r.locationCodeSnapshot}`,r]));
    fixedOtherDaysSource=structuredClone(source);
    fixedOtherDaysSource.version.assignments=fixedOtherDaysSource.version.assignments.map(r=>{
      if(r.window.start!=='09:45')return r;
      const seed=seedOwners.get(`${r.dayOfWeek}/${r.locationCodeSnapshot}`);assert.ok(seed,'generated fixed-other-day owner missing');
      return {...r,workId:seed.workId,ownerSlotId:seed.ownerSlotId,originSlotId:seed.originSlotId,window:structuredClone(seed.window)};
    });
  }
  const body={schema:'custodial.recurring-phase-source-basis.v1',source,ownerConfig,
    registeredSourceDigest:contentDigest(registeredSource),generatedPatternConfigDigest:contentDigest(patternConfig),
    originalEqualizedRowsDigest:contentDigest(originals),generatedMorningRowsDigest:contentDigest(source.version.assignments
      .filter(row=>checked.phaseByWorkId.get(row.workId)==='morning')),fixedRowsDigest:checked.fixedRowsDigest,
    comparisonReference:'ORIGINAL_ACCEPTED_POST0945_SOURCE',morningBasis:'EXPLICIT_GENERATED_FIXED_CANDIDATE',
    ...(reductionContext?{reductionContext,fixedOtherDaysSource,
      comparisonReference:'EXPLICIT_FULL_NINE_DOMINANT_FAMILY_REFERENCE_WITH_LOSSLESS_SPLIT_LEDGER'}:{}),
    admitted:false,published:false};
  return {...body,basisDigest:contentDigest(body)};
}

// This first closed source path requires actual current-owner baseline bytes.
// A changed roster/split historical source needs a separate typed original /
// target feasibility context; never substitute a coarse generator as100-cost
// or geographic origin. Missing binding is a capability refusal, not policy.
export function createRecurringMorningWeekSourceBasis({registeredSource,currentConfig,
 reductionContext=null,targetEffectiveDate=currentConfig?.effectiveDate}){
 // The private worker supplies the already-bound command date independently
 // of config. A pure caller supplies facts, not authentication or publication.
 assertServiceDate(targetEffectiveDate,'recurring target effective date');
 assert.equal(serviceDateWeekday(targetEffectiveDate),1,'recurring target Monday required');
 assert.equal(targetEffectiveDate,currentConfig?.effectiveDate,'recurring target/config date changed');
 assertServiceDate(registeredSource?.serviceDate,'original recurring service date');
 assert.ok(targetEffectiveDate>=registeredSource.serviceDate&&targetEffectiveDate>=currentConfig.dateAuthority?.recurringEffectiveStart,
  'recurring target precedes original/current correction authority');
 assert.ok(registeredSource.version&&!registeredSource.versions&&Array.isArray(registeredSource.exceptions),'exact original recurring source shape required');
 // Validate original dated facts BEFORE removing them from the deliberate new
 // recurring candidate. Retain the complete original, including all overlays.
 normalizeStaticWeeklyAuthority(registeredSource.version,registeredSource.slots,registeredSource.exceptions,
  registeredSource.proximity,registeredSource.serviceDate);
 if(reductionContext){
  assertReductionContext(reductionContext);
  assert.equal(contentDigest(registeredSource),reductionContext.acceptedSourceDigest,
   'historical morning source differs from accepted reduction reference');
  assert.equal(contentDigest(currentConfig),contentDigest(reductionContext.currentConfig),
   'reduction current owner configuration changed');
  assert.ok(reductionContext.registeredCorrectionSource&&reductionContext.correctionWitness,
   'reduction requires independently registered current correction source');
 }
 const targetRegisteredSource=reductionContext?reductionContext.source:registeredSource;
 const structure=currentHandoutRecurringStructure(targetRegisteredSource,currentConfig);
 assert.ok(structure,'current source-bound morning lineage required');
 const originalRegisteredSource=structuredClone(registeredSource),source=structuredClone(targetRegisteredSource),
  ownerConfig=structuredClone(currentConfig),days=[];
 source.serviceDate=targetEffectiveDate;source.exceptions=[];
 Object.assign(source.version,{effectiveStart:targetEffectiveDate,effectiveEnd:null,status:'published',namedAbsentSlotIds:[]});
 // Ordinary current-source path changes only the calendar header. The typed
 // reduction path was constructed separately from an exact registered current
 // correction while retaining the complete historical source and split ledger.
 // Both must prove every current incumbent for the explicit target week.
 for(let dayOfWeek=0;dayOfWeek<7;dayOfWeek++){
  const date=new Date(Date.parse(`${targetEffectiveDate}T12:00:00Z`)+((dayOfWeek+6)%7)*86400000).toISOString().slice(0,10);
  for(const slot of Object.values(ownerConfig.slots)){
   const raw=source.slots.find(s=>s.id===slot.slotId);
   assert.ok(raw&&!raw.contractorCapacity&&!raw.kind,'target ordinary source position required');
   const person=snapshotDatedRosterSlot(raw,date,{vacancyCapable:source.version.vacancyCapableSlotIds.includes(slot.slotId),
    declaredVacant:source.version.vacantSlotIds.includes(slot.slotId)});
   assert.equal(person.personId,slot.personId??null,'target current source incumbent changed');
   assert.equal(person.displayName,slot.name??null,'target current source name changed');
   assert.equal(Boolean(person.vacant),Boolean(slot.vacancy),'target current source vacancy changed');
  }
 }
 const header=s=>({serviceDate:s.serviceDate,effectiveStart:s.version.effectiveStart,effectiveEnd:s.version.effectiveEnd,
  status:s.version.status,namedAbsentSlotIds:structuredClone(s.version.namedAbsentSlotIds),exceptions:structuredClone(s.exceptions)});
 const originalHeader=header(originalRegisteredSource),targetHeader=header(source),
  receiptBody={schema:'custodial.recurring-target-calendar-basis.v1',targetEffectiveDate,
   originalSourceDigest:contentDigest(originalRegisteredSource),originalSourceSqlDigest:postgresJsonbContentDigest(originalRegisteredSource),
   targetSourceDigest:contentDigest(source),targetSourceSqlDigest:postgresJsonbContentDigest(source),
   originalHeader,targetHeader,originalHeaderDigest:contentDigest(originalHeader),targetHeaderDigest:contentDigest(targetHeader),
   originalDatedOverlayCount:originalRegisteredSource.exceptions.length,removedOnlyDatedOverlays:true,
   recurringRowsAnchorsAvailabilityAndHistoryPreserved:!reductionContext,
   ...(reductionContext?{typedHistoricalAndCurrentCorrectionTransition:true,
    reductionContextDigest:reductionContext.contextDigest,
    originalSameDayOrCurrentCorrectionNewDayDigest:reductionContext.dayAvailabilityReferencesDigest}:{}),
   newTargetBytesAreHistoricalFacts:false,admitted:false,published:false},
  calendarTransition={...receiptBody,receiptDigest:contentDigest(receiptBody)};
 for(let dayOfWeek=0;dayOfWeek<7;dayOfWeek++){
  const selectedWorkIds=source.version.assignments.filter(r=>r.dayOfWeek===dayOfWeek&&structure.phaseByWorkId.get(r.workId)==='morning').map(r=>r.workId);
  days.push({dayOfWeek,selectedWorkIds});
 }
 const body={schema:'custodial.original-recurring-morning-source-basis.v1',originalRegisteredSource,source,ownerConfig,days,calendarTransition,
  registeredSourceDigest:contentDigest(registeredSource),ownerConfigDigest:contentDigest(currentConfig),
  fixedRowsDigest:structure.fixedRowsDigest,comparisonReference:'ORIGINAL_ACCEPTED_MORNING_ROWS_AND_DIRECTED_ANCHORS',
  sourceAndTargetRosterKind:'UNCHANGED_CURRENT_INCUMBENTS',targetSeedIsOriginalSource:canonicalJson(source)===canonicalJson(originalRegisteredSource),
  ...(reductionContext?{reductionContext,reductionContextDigest:reductionContext.contextDigest,
   comparisonReference:'HISTORICAL_ORIGINAL_SAME_DAY_OR_TYPED_CURRENT_CORRECTION_NEW_DAY',
   dayAvailabilityReferences:structuredClone(reductionContext.dayAvailabilityReferences)}:{}),
  admitted:false,published:false};
 return {...body,basisDigest:contentDigest(body)};
}
export function assertRecurringMorningWeekSourceBasis(basis){
 const {basisDigest,...body}=basis;assert.equal(contentDigest(body),basisDigest,'morning source basis changed');
 assert.equal(canonicalJson(createRecurringMorningWeekSourceBasis({registeredSource:basis.originalRegisteredSource,currentConfig:basis.ownerConfig,
  reductionContext:basis.reductionContext||null,targetEffectiveDate:basis.calendarTransition.targetEffectiveDate})),canonicalJson(basis),'morning source basis independent reconstruction changed');
 return true;
}
function morningInput(basis,fullOwners,dayOfWeek,source=basis.source){
 return {planningInput:{source,ownerConfig:basis.ownerConfig,
  bindings:{sourceDigest:postgresJsonbContentDigest(source),ownerConfigDigest:postgresJsonbContentDigest(basis.ownerConfig)},
  scope:'NEW_RECURRING_MORNING_DESIGN',dayOfWeek,selectedWorkIds:basis.days[dayOfWeek].selectedWorkIds},fullOwners,
  ...(basis.reductionContext?{originalReference:{schema:'custodial.original-target-morning-reference.v1',
    reductionContextDigest:basis.reductionContextDigest,
    historicalSource:basis.originalRegisteredSource,
    currentCorrectionSource:basis.reductionContext.registeredCorrectionSource,
    dayAvailabilityReferences:basis.dayAvailabilityReferences,
    morningComparisonLedger:basis.reductionContext.comparisonLedger.filter(row=>row.phase==='morning')}}:{}),
 };
}
function exactMorningWeekDigest(week){const {proofDigest,...body}=week;assert.equal(contentDigest(body),proofDigest,'morning week proof bytes changed');}
export function recurringMorningWeekSemanticFacts(week){
 exactMorningWeekDigest(week);
 return {schema:'custodial.recurring-morning-deterministic-facts.v1',sourceBasisDigest:week.sourceBasisDigest,
  originalSourceDigest:week.originalSourceDigest,fullOwnersDigest:week.fullOwnersDigest,candidateSourceDigest:week.candidateSourceDigest,
  targetCalendarReceiptDigest:week.targetCalendarReceiptDigest,targetEffectiveDate:week.targetEffectiveDate,
  days:week.proofs.map(p=>({dayOfWeek:p.contract.descriptor.dayOfWeek,contractDigest:p.contract.contractDigest,
   metrics:structuredClone(p.metrics),selection:structuredClone(p.selection),
   identityLayout:structuredClone(p.identityLayout),terminalOptima:p.tiers.map(t=>({name:t.name,modelDigest:t.modelDigest,lpDigest:t.lpDigest,
    primitiveObjective:t.objectiveValue,originalObjective:t.originalObjectiveValue}))})),
  originalAnchorsPreserved:!week.originalTargetReferenceDigest,
  ...(week.originalTargetReferenceDigest?{originalTargetReferenceDigest:week.originalTargetReferenceDigest,
    sourceBoundOriginalSameDayOrCurrentCorrectionNewDay:true}:{}),
  originalLateReferencePreserved:!week.originalTargetReferenceDigest,
  ...(week.originalTargetReferenceDigest?{typedHistoricalLateLedgerPreserved:true}:{}),
  physicalMinuteFeasibilityClaim:false,openingReadinessProven:false};
}
function assertMorningSelectionOnly(basis,week){
 const restored=structuredClone(week.candidateSource),original=basis.source.version.assignments,rows=restored.version.assignments;
 assert.equal(rows.length,original.length,'morning assignment multiplicity changed');
 for(let i=0;i<rows.length;i++){
  const row=original[i],selected=basis.days[row.dayOfWeek].selectedWorkIds.includes(row.workId);
  if(selected){
   const proof=week.proofs[row.dayOfWeek],choice=proof.selection.find(s=>s.workId===row.workId),
    candidate=proof.candidateSource.version.assignments[i];
   assert.ok(choice&&candidate,'morning selected identity missing');assert.equal(canonicalJson(rows[i]),canonicalJson(candidate),'morning selection bytes changed');
   rows[i]=structuredClone(row);
  }
 }
 assert.equal(canonicalJson(restored),canonicalJson(basis.source),'morning changed unselected facts/anchors/roster/history');
}
function morningDayContractFacts(contract){
 const out=structuredClone(contract);delete out.contractDigest;delete out.originalSourceDigest;
 for(const key of ['descriptorDigest','sourceDigest','canonicalAuthorityDigest','fixedSourceRowsDigest'])delete out.descriptor[key];
 return out;
}
// Recheck exact original terminal bounds and current final day facts. The final
// canonical witness is freshly built once; no terminal/optimum cache or client
// skip option. Changed other-day ownership never changes original day origin.
export function assertRecurringMorningWeekCandidate({week,basis,fullOwners,finalSource=week.candidateSource}){
 assertRecurringMorningWeekSourceBasis(basis);
 exactMorningWeekDigest(week);assert.equal(week.status,'UNREGISTERED_VERIFIED_RECURRING_MORNING_WEEK');
 assert.equal(week.sourceBasisDigest,basis.basisDigest);assert.equal(week.fullOwnersDigest,contentDigest(fullOwners));
 assert.equal(week.originalSourceDigest,basis.registeredSourceDigest,'original morning source binding changed');
 assert.equal(week.targetCalendarReceiptDigest,basis.calendarTransition.receiptDigest,'target calendar receipt changed');
 assert.equal(week.targetEffectiveDate,basis.calendarTransition.targetEffectiveDate,'target morning week changed');
 assert.equal(week.originalTargetReferenceDigest,basis.reductionContext?.contextDigest,
  'historical/current morning reference binding changed');
 assert.equal(week.candidateSourceDigest,contentDigest(week.candidateSource),'morning candidate source bytes changed');
 assert.equal(week.proofs.length,7);assertMorningSelectionOnly(basis,week);
 const canonical=evaluateRecurringPhaseCanonicalSource(finalSource);assert.equal(canonical.feasible,true,'combined morning final canonical witness unavailable');
 for(let day=0;day<7;day++){
  const originalInput=morningInput(basis,fullOwners,day),proof=week.proofs[day];assertRecurringMorningCanonicalProof(proof,originalInput);
  const rebound=structuredClone(finalSource),v=rebound.version,original=basis.source.version.assignments;
  v.assignments=v.assignments.map((row,index)=>basis.days[day].selectedWorkIds.includes(original[index]?.workId)?structuredClone(original[index]):row);
  const input=morningInput(basis,fullOwners,day,rebound),contract=createRecurringMorningObjectiveContract(input);
  assert.equal(canonicalJson(morningDayContractFacts(contract)),canonicalJson(morningDayContractFacts(proof.contract)),'final morning objective/reference/day facts changed');
  const matched=createRecurringMorningProspectiveSource(input,proof.selection);
  assert.equal(canonicalJson(matched),canonicalJson(finalSource),'original morning selected minimum does not produce exact combined final source');
  assert.ok(proof.selection.every(s=>{const o=proof.contract.options.find(o=>o.workId===s.workId&&o.slotId===s.slotId);return o&&!canonical.uncoveredWorkIds.includes(o.prospectiveWorkId);}),
   'final morning source-selected responsibility uncovered');
 }
 return canonical;
}
export function deriveVerifiedRecurringMorningWeekCandidate({basis,fullOwners,solver}){
 assertRecurringMorningWeekSourceBasis(basis);
 const proofs=[],started=performance.now(),budgetMs=30_000,boundedSolver={solve(lp,options){
  const remaining=budgetMs-(performance.now()-started);assert.ok(remaining>0,'Recurring morning week time bound exhausted');
  return solver.solve(lp,{...options,timeLimitSeconds:Math.min(options.timeLimitSeconds,remaining/1000)});
 }};
 for(let day=0;day<7;day++){
  const proof=solveRecurringMorningCanonicalMinimum(morningInput(basis,fullOwners,day),boundedSolver);proofs.push(proof);
  if(proof.status!=='PROVEN_SOURCE_PLANNED_MORNING_MINIMUM')return {status:'UNKNOWN_CANONICAL_RECURRING_MORNING_WEEK',stage:'initial_morning_day',dayOfWeek:day,
   proofs,candidateSource:null,admitted:false,published:false};
 }
 const candidateSource=structuredClone(basis.source),original=basis.source.version.assignments;
 candidateSource.version.assignments=original.map((row,index)=>basis.days[row.dayOfWeek].selectedWorkIds.includes(row.workId)
  ?structuredClone(proofs[row.dayOfWeek].candidateSource.version.assignments[index]):structuredClone(row));
 const canonical=evaluateRecurringPhaseCanonicalSource(candidateSource);
 if(!canonical.feasible)return {status:'UNKNOWN_CANONICAL_RECURRING_MORNING_WEEK',stage:'combined_morning_witness',proofs,candidateSource:null,admitted:false,published:false};
 const result={schema:'custodial.verified-original-recurring-morning-week.v1',status:'UNREGISTERED_VERIFIED_RECURRING_MORNING_WEEK',
  sourceBasisDigest:basis.basisDigest,originalSourceDigest:basis.registeredSourceDigest,fullOwnersDigest:contentDigest(fullOwners),
  targetCalendarReceiptDigest:basis.calendarTransition.receiptDigest,targetEffectiveDate:basis.calendarTransition.targetEffectiveDate,
  ...(basis.reductionContext?{originalTargetReferenceDigest:basis.reductionContext.contextDigest}:{}),
  candidateSource,candidateSourceDigest:contentDigest(candidateSource),proofs,canonicalHardWitness:canonical,
  originalAnchorsPreserved:!basis.reductionContext,originalLateReferencePreserved:!basis.reductionContext,
  ...(basis.reductionContext?{typedHistoricalLateLedgerPreserved:true}:{}),solverAdmissionBudgetMs:budgetMs,
  physicalMinuteFeasibilityClaim:false,openingReadinessProven:false,admitted:false,published:false};
 const week={...result,proofDigest:contentDigest(result)};
 // Fresh solver proofs just produced inside this invocation; public consumers
 // still reconstruct/revalidate all raw proof facts through the assertion API.
 assertMorningSelectionOnly(basis,week);return week;
}

export function recurringPatternFromFinalPhaseSource({phaseSourceBasis,finalSource}){
  const {basisDigest,...basisBody}=phaseSourceBasis;
  assert.equal(contentDigest(basisBody),basisDigest,'phase source basis changed');
  const source=phaseSourceBasis.source,config=structuredClone(phaseSourceBasis.ownerConfig);
  const expected=structuredClone(source);expected.version.assignments=expected.version.assignments.filter(row=>row.window.start!=='09:45');
  const actual=structuredClone(finalSource);actual.version.assignments=actual.version.assignments.filter(row=>row.window.start!=='09:45');
  assert.equal(canonicalJson(actual),canonicalJson(expected),'final phase source changed fixed source/roster/availability/history');
  const prior=new Map(source.version.assignments.filter(row=>row.window.start==='09:45')
    .map(row=>[`${row.dayOfWeek}\0${row.locationCodeSnapshot}`,row]));
  const fixedPhaseFacts=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['workId','ownerSlotId','originSlotId','window'].includes(key)));
  for(const row of finalSource.version.assignments.filter(row=>row.window.start==='09:45'))
    assert.equal(canonicalJson(fixedPhaseFacts(row)),canonicalJson(fixedPhaseFacts(prior.get(`${row.dayOfWeek}\0${row.locationCodeSnapshot}`)||{})),
      'final phase changed protected package/workload/provenance fields');
  const keyBySlot=new Map(Object.entries(config.slots).map(([key,slot])=>[slot.slotId,key]));
  for(let day=0;day<7;day++)config.overrides[String(day)].equalized=Object.fromEntries(Object.keys(config.slots).sort()
    .map(key=>[key,finalSource.version.assignments.filter(row=>row.dayOfWeek===day&&row.window.start==='09:45'
      &&keyBySlot.get(row.originSlotId)===key).map(row=>row.locationCodeSnapshot).sort()]).filter(([,families])=>families.length));
  currentHandoutRecurringStructure(finalSource,config);
  return {config,configDigest:contentDigest(config),finalSourceDigest:contentDigest(finalSource),
    phaseSourceBasisDigest:basisDigest,admitted:false,published:false};
}

export function recurringManagerChangesFromSources({originalSource,finalSource,currentConfig}){
 const keys=Object.keys(currentConfig.slots).sort(),keyBySlot=new Map(keys.map(k=>[currentConfig.slots[k].slotId,k])),sites=new Set(currentConfig.publicRestroomFamilies||[]),changes=[];
 for(let day=0;day<7;day++)for(const phase of ['morning','equalized']){
  const choose=s=>s.version.assignments.filter(r=>r.dayOfWeek===day&&(phase==='morning'?r.window.end==='09:45':r.window.start==='09:45')),
   before=choose(originalSource),after=choose(finalSource),ownerMap=rows=>new Map(rows.map(r=>[r.locationCodeSnapshot,keyBySlot.get(r.originSlotId)])),a=ownerMap(before),b=ownerMap(after);
  assert.equal(a.size,before.length,'original manager impact contains split/duplicate family');assert.equal(b.size,after.length,'final manager impact contains split/duplicate family');
  assert.deepEqual([...a.keys()].sort(),[...b.keys()].sort(),'manager impact changed work families');
  changes.push({day,phase,pattern:'source-verified-recurring-morning-and-late',employees:keys.filter(k=>!currentConfig.slots[k].vacancy&&currentConfig.slots[k].workDays.includes(day)).map(owner=>{
   const families=[...b].filter(([,o])=>o===owner).map(([f])=>f).sort(),prior=[...a].filter(([,o])=>o===owner).map(([f])=>f).sort();
   return {owner,weightedLoad:families.reduce((n,f)=>n+currentConfig.weights[f],0),restroomSites:families.filter(f=>sites.has(f)).length,
    gained:families.filter(f=>a.get(f)!==owner),released:prior.filter(f=>b.get(f)!==owner)};
  })});
 }
 return changes;
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
        if(result.fullNineReductionBinding){
          assert.equal(result.fullNineReductionBinding.correctionAuthorityDigest,reductionAuthority.correctionConfigDigest,'normal reduction correction authority changed');
          const mandatory=phase==='equalized'?result.fullNineReductionBinding.mandatoryPrimaryOwnerBindings
            .find(b=>b.dayOfWeek===day&&b.family===family):null;
          if(mandatory&&targetSlots[owner].slotId!==mandatory.mandatoryPrimarySlotId)continue;
        }
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
function phaseInvocationSource({source,currentConfig,dayOfWeek,phaseSourceBasis}){
  if(!phaseSourceBasis?.reductionContext)return source;
  const {basisDigest,...body}=phaseSourceBasis;
  assert.equal(contentDigest(body),basisDigest,'reduction phase basis changed');assertReductionContext(body.reductionContext);
  assert.equal(contentDigest(source),contentDigest(body.source),'reduction comparison source changed');
  assert.equal(contentDigest(currentConfig),contentDigest(body.ownerConfig),'reduction owner comparison config changed');
  const seed=body.fixedOtherDaysSource;assert.ok(seed?.version,'bound current fixed-other-day feasibility scaffold missing');
  const outside=s=>{const x=structuredClone(s);x.version.assignments=x.version.assignments.filter(r=>r.window.start!=='09:45');return x;};
  assert.equal(canonicalJson(outside(source)),canonicalJson(outside(seed)),'fixed-other-day scaffold changed protected source facts');
  const originals=new Map(source.version.assignments.filter(r=>r.window.start==='09:45').map(r=>[`${r.dayOfWeek}/${r.locationCodeSnapshot}`,r]));
  const facts=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['workId','ownerSlotId','originSlotId','window'].includes(k)));
  const seedRows=seed.version.assignments.filter(r=>r.window.start==='09:45');
  assert.equal(seedRows.length,originals.size,'fixed-other-day scaffold multiplicity changed');
  for(const row of seedRows)assert.equal(canonicalJson(facts(row)),canonicalJson(facts(originals.get(`${row.dayOfWeek}/${row.locationCodeSnapshot}`)||{})),
    'fixed-other-day scaffold changed package/budget/provenance');
  // This scaffold is NOT an accepted solution or feasibility receipt. Each
  // actual day result below still requires the complete canonical model,
  // including these fixed other days; final week is checked again. Repeating
  // an extra seed-only model here cannot strengthen that witness and consumes
  // the unchanged30s bound before the real seven phase proofs finish.
  const seedMap=new Map(seedRows.map(r=>[`${r.dayOfWeek}/${r.locationCodeSnapshot}`,r])),out=structuredClone(source);
  out.version.assignments=out.version.assignments.map(r=>r.window.start==='09:45'&&r.dayOfWeek!==dayOfWeek
    ?structuredClone(seedMap.get(`${r.dayOfWeek}/${r.locationCodeSnapshot}`)):r);
  return out;
}
function freezeInvocationFact(x){if(x&&typeof x==='object'){for(const v of Object.values(x))freezeInvocationFact(v);Object.freeze(x);}return x;}
function createScalableInvocation(){
  const evidence=createRecurringPhaseEvidenceInvocation();let basisFact=null;
  return Object.freeze({...evidence,sourceForDay(input){
    if(!input.phaseSourceBasis?.reductionContext)return input.source;
    // Actual bytes, not supplied hashes or an object-identity-only cache.
    const key=contentDigest({source:input.source,currentConfig:input.currentConfig,phaseSourceBasis:input.phaseSourceBasis});
    if(!basisFact||basisFact.key!==key){
      const source=phaseInvocationSource(input);
      basisFact=freezeInvocationFact({key,source:structuredClone(input.source),seed:structuredClone(input.phaseSourceBasis.fixedOtherDaysSource)});
      return source;
    }
    const byFamily=new Map(basisFact.seed.version.assignments.filter(r=>r.window.start==='09:45').map(r=>[`${r.dayOfWeek}/${r.locationCodeSnapshot}`,r])),
      source=structuredClone(basisFact.source);
    source.version.assignments=source.version.assignments.map(r=>r.window.start==='09:45'&&r.dayOfWeek!==input.dayOfWeek
      ?structuredClone(byFamily.get(`${r.dayOfWeek}/${r.locationCodeSnapshot}`)):r);
    return source;
  }});
}
function reductionPreferenceReceipt({phaseSourceBasis,proof,dayOfWeek,fullOwners,evidenceInvocation=null}){
  const context=assertReductionContext(phaseSourceBasis.reductionContext),bindings=context.currentConfig.fullNineReductionBinding
    .mandatoryPrimaryOwnerBindings.filter(b=>b.dayOfWeek===dayOfWeek);
  for(const binding of bindings){
    const pkg=proof.descriptor.packages.find(p=>p.family===binding.family),choice=proof.descriptor.choices.find(c=>c.workId===pkg?.workId);
    assert.ok(choice&&choice.owners.length===1&&choice.owners[0].slotId===binding.mandatoryPrimarySlotId,
      'mandatory constant is not unavoidable for every canonical feasible owner option');
    const direct=proof.descriptor.directNamedHandoffOwnerBindings.find(b=>b.workId===choice.workId);
    assert.ok(direct,'constant lacks exact canonical named primary owner constraint');
    const {workId,...handoff}=direct;assert.equal(canonicalJson(handoff),canonicalJson(binding.handoff),'constant named constraint identity changed');
  }
  const normalized=(evidenceInvocation?.assertPreference||assertRecurringPhasePreferenceNormalization)({proof,source:phaseSourceBasis.source,
    ownerConfig:phaseSourceBasis.ownerConfig,fullOwners});
  assert.equal(proof.descriptor.dayOfWeek,dayOfWeek,'preference receipt day changed');
  assert.ok(Number.isSafeInteger(proof.preferenceCost)&&proof.preferenceCost>=0,'original variable preference bound missing');
  const constant=bindings.reduce((n,b)=>n+b.fixedChangeCost,0),body={schema:'custodial.full-nine-mandatory-preference-cost.v1',
    contextDigest:context.contextDigest,comparisonLedgerDigest:context.comparisonLedgerDigest,descriptorDigest:proof.descriptor.descriptorDigest,
    dayOfWeek,bindings:structuredClone(bindings),rawPrimitiveLpPreferenceCost:normalized.primitiveObjectiveValue,
    originalScaleVariablePreferenceCost:normalized.originalScaleObjectiveValue,objectiveNormalization:normalized.normalization,
    fixedUnavoidableOriginalOwnerChangeCost:constant,fullInheritedPreferenceCost:proof.preferenceCost+constant,
    rawSolverReceiptIncludesConstant:false,costRule:'EXISTING_PER_FAMILY_100_PLUS_4_PLUS_2_WITH_SEPARATE_UNAVOIDABLE_CONSTANT',
    prioritiesChanged:false};
  return {...body,receiptDigest:contentDigest(body)};
}
export function assertFullNineReductionPreferenceReceipt({phaseSourceBasis,proof,dayOfWeek,fullOwners}){
  const expected=reductionPreferenceReceipt({phaseSourceBasis,proof,dayOfWeek,fullOwners});
  assert.equal(canonicalJson(proof.mandatoryCurrentOwnerPreferenceReceipt),canonicalJson(expected),'mandatory preference sum/reference/receipt changed');
  return expected;
}
function derivePhaseInInvocation({source,currentConfig,fullOwners,dayOfWeek,solver,phaseSourceBasis=null},evidenceInvocation){
  source=evidenceInvocation.sourceForDay({source,currentConfig,dayOfWeek,phaseSourceBasis});
  const v=source.version||(source.versions?.length===1?source.versions[0]:null);
  assert.ok(v&&Array.isArray(v.assignments));
  const selectedWorkIds=v.assignments.filter(r=>r.dayOfWeek===dayOfWeek&&r.window?.start==='09:45').map(r=>r.workId);
  const proof=evidenceInvocation.solve({source,ownerConfig:currentConfig,fullOwners,dayOfWeek,selectedWorkIds,solver});
  if(phaseSourceBasis?.reductionContext&&proof.status==='PROVEN_CANONICAL_PHASE_MINIMUM'){
    const {proofDigest,...body}=proof;
    body.mandatoryCurrentOwnerPreferenceReceipt=reductionPreferenceReceipt({phaseSourceBasis,proof,dayOfWeek,fullOwners,evidenceInvocation});
    // Keep the same original private proof identity inside the invocation.
    // The body receives only a new receipt/hash, not a cloned solver proof.
    Object.assign(proof,body,{proofDigest:contentDigest(body)});return proof;
  }
  return proof;
}
export function deriveScalableCanonicalRecurringPhaseCandidate(input){return derivePhaseInInvocation(input,createScalableInvocation());}

// Complete existing-command equalized scope. Morning is explicit and fixed;
// this does not choose or claim an optimum for morning work. Rebind every day
// against final other-day candidate bytes, keeping its ORIGINAL source day as
// the comparison/preference baseline. Never publish a stale per-day witness.
export function deriveScalableCanonicalRecurringWeekCandidate({source,currentConfig,fullOwners,solver,phaseSourceBasis=null}){
  const original=source.version||(source.versions?.length===1?source.versions[0]:null);
  assert.ok(original&&Array.isArray(original.assignments));
  const first=[],started=performance.now(),budgetMs=30_000;
  const evidenceInvocation=createScalableInvocation();
  const boundedSolver={solve(lp,options){
    const remaining=budgetMs-(performance.now()-started);
    assert.ok(remaining>0,'Recurring week total time bound exhausted.');
    return solver.solve(lp,{...options,timeLimitSeconds:Math.min(options.timeLimitSeconds,remaining/1000)});
  }};
  for(let dayOfWeek=0;dayOfWeek<7;dayOfWeek++){
    const proof=derivePhaseInInvocation({source,currentConfig,fullOwners,dayOfWeek,solver:boundedSolver,phaseSourceBasis},evidenceInvocation);first.push(proof);
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
      if(phaseSourceBasis?.reductionContext)body.mandatoryCurrentOwnerPreferenceReceipt=reductionPreferenceReceipt({phaseSourceBasis,proof:body,dayOfWeek,fullOwners,evidenceInvocation});
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
  if(phaseSourceBasis?.reductionContext){
    body.reductionContextDigest=phaseSourceBasis.reductionContext.contextDigest;
    body.preferenceCostMeaning='RAW_VARIABLE_LP_COST_PLUS_SEPARATE_PROVEN_UNAVOIDABLE_CONSTANT';
    body.mandatoryCurrentOwnerPreferenceReceipts=proofs.map((proof,dayOfWeek)=>{
      const receipt=reductionPreferenceReceipt({phaseSourceBasis,proof,dayOfWeek,fullOwners,evidenceInvocation});
      assert.equal(canonicalJson(proof.mandatoryCurrentOwnerPreferenceReceipt),canonicalJson(receipt),'mandatory preference receipt changed');return receipt;
    });
  }
  return {...body,proofDigest:contentDigest(body)};
}
