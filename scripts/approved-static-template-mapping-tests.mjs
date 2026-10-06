import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {contentDigest,installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {createStaticWeeklyDeadline,prepareStaticWeeklySchedulingProblem} from '../src/static-weekly-schedule-program.js';
import {mapApprovedStaticTemplateCandidate as map,prepareApprovedStaticTemplateProjection} from '../src/static-weekly-recurring-staffing-adaptation.js';
import {loadSixPersonAbsenceSource} from './fixtures/six-person-absence-source.mjs';
import {loadFullNineV6Source} from './fixtures/full-nine-v6-source.mjs';

const started=performance.now(),deadline=createStaticWeeklyDeadline(60_000);
const sha=x=>createHash('sha256').update(x).digest('hex');
installStaticWeeklySha256HexAccelerator(sha);
const configBytes=fs.readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url));
assert.equal(sha(configBytes),'40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30');
const config=JSON.parse(configBytes),clone=structuredClone;
let checks=0;
const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const filled=Object.entries(config.slots).filter(([,s])=>!s.vacancy);
function tiny(){
 const source={serviceDate:'2026-10-05',slots:filled.map(([key,s])=>({id:s.slotId,label:key,incumbencies:[{personId:s.personId,displayName:s.name,effectiveStart:'2026-10-01',effectiveEnd:null}]})),exceptions:[],proximity:[],
 version:{id:'synthetic-approved-six',publicationId:'synthetic-published-six',status:'published',effectiveStart:'2026-10-05',effectiveEnd:null,objective:{requireVerifiedProximity:true},assignments:[],slotAvailability:[],vacancyCapableSlotIds:[],vacantSlotIds:[],namedAbsentSlotIds:[]}};
 for(let day=0;day<7;day++)for(const [index,[key,s]]of filled.entries()){
  const loc=`synthetic-location-${index}`,family=s.normalAssignmentFamilies?.[0]||'CHINA';
  source.version.assignments.push({workId:`fixed-${day}-${key}`,dayOfWeek:day,locationId:loc,locationCodeSnapshot:family,locationNameSnapshot:loc,ownerSlotId:s.slotId,originSlotId:s.slotId,window:{start:'09:00',end:'09:30'},serviceEffortMinutes:10,serviceEffortProvenance:'synthetic-reviewed',priority:1,priorityProvenance:'synthetic-reviewed',required:true,requiredQualifications:[`q${index}`],qualificationProvenance:'synthetic-reviewed',restrictedSlotIds:[],restrictionProvenance:'synthetic-reviewed',includedLocations:[{locationId:loc,locationNameSnapshot:loc}]});
  source.version.assignments.at(-1).restrictions=[];
  source.version.slotAvailability.push({dayOfWeek:day,slotId:s.slotId,status:'working',shift:{start:'08:00',end:'17:00'},lunch:{start:'12:00',end:'13:00'},qualifications:[`q${index}`],qualificationProvenance:'synthetic-reviewed',restrictions:[],restrictionProvenance:'synthetic-reviewed',productiveCapacityProvenance:'synthetic-reviewed',maxServiceEffortMinutes:480,maxServiceEffortProvenance:'synthetic-reviewed',acceptedRouteAnchorLocationId:loc,acceptedRouteProvenance:'synthetic-reviewed'});
 }
 for(let i=0;i<6;i++)for(let j=0;j<6;j++)if(i!==j)source.proximity.push({fromLocationId:`synthetic-location-${i}`,toLocationId:`synthetic-location-${j}`,minutes:1,verified:true,provenance:'synthetic-directed'});
 return source;
}
function args(source,ownerConfig=config){
 const templateId='approved-six-pattern',roleSlotIds=filled.map(([,s])=>s.slotId).sort(),binding={schema:'custodial.approved-static-template-binding.v1',templateId,staffingCount:6,sourceDigest:contentDigest(source),roleSlotIdsDigest:contentDigest(roleSlotIds),patternAuthority:'OWNER_APPROVED_OPERATIONAL_PATTERN',artifactSha256:sha(configBytes),ownerConfigDigest:contentDigest(ownerConfig),patternPublicationStatus:'UNPUBLISHED_LOCAL_CANDIDATE'};
 return {templates:[{templateId,staffingCount:6,source:clone(source),roleSlotIds}],admittedBindings:[binding],currentSource:clone(source),currentOwnerConfig:clone(ownerConfig),selection:{schema:'custodial.static-template-selection.v1',kind:'RECURRING_STAFFING',templateId,serviceDate:source.serviceDate,availablePersonIds:filled.map(([,s])=>s.personId)},deadline};
}
const source=tiny(),base=args(source);
check('synthetic source domain admission is valid without engine',()=>{const x=clone(source);x.versions=[x.version];delete x.version;assert.equal(prepareStaticWeeklySchedulingProblem(x,deadline).error,undefined);});
const same=map(base);
check('unchanged assignments and complete source are byte/order unchanged',()=>{assert.deepEqual(same.candidateSource,source);assert.equal(same.receipt.unchanged,true);});
check('available people are an unordered set across database JSON object key order',()=>{
 const reordered=clone(base);reordered.selection.availablePersonIds.reverse();
 assert.deepEqual(map(reordered),same,'reordering the same people cannot change the admitted feasibility identity');
 for(let i=1;i<base.selection.availablePersonIds.length;i++){const a=clone(base);a.selection.availablePersonIds=[...a.selection.availablePersonIds.slice(i),...a.selection.availablePersonIds.slice(0,i)];assert.deepEqual(map(a),same);}
});
check('distinct compatibility contract cannot claim solver/publication',()=>{assert.equal(same.receipt.solverInvoked,false);assert.equal(same.receipt.admitted,false);assert.equal(same.receipt.published,false);assert.equal(same.receipt.patternPublicationStatus,'UNPUBLISHED_LOCAL_CANDIDATE');});
check('caller approval label alone is refused',()=>{const a=clone(base);a.admittedBindings=[];assert.throws(()=>map(a),{code:'static_template_not_independently_admitted'});});
check('changed template bytes are refused rather than reapproved',()=>{const a=clone(base);a.templates[0].source.version.assignments[0].serviceEffortMinutes++;assert.throws(()=>map(a),{code:'static_template_not_independently_admitted'});});
check('current eligibility config must be independently digest-bound',()=>{const a=clone(base);a.currentOwnerConfig.slots.ALIJAH.hardForbiddenFamilies=[];assert.throws(()=>map(a),{code:'static_template_owner_config_not_bound'});});
check('duplicate actual person cannot occupy two roles',()=>{const a=clone(base);a.currentSource.slots[1].incumbencies[0].personId=a.currentSource.slots[0].incumbencies[0].personId;assert.throws(()=>map(a),{code:'static_template_duplicate_person'});});
const changed=clone(base),kaili=config.slots.KAILI.slotId,gregory=config.slots.GREGORY.slotId;
for(const day of [0,1,2,3,4,5,6]){
 const a=changed.currentSource.version.slotAvailability.find(r=>r.dayOfWeek===day&&r.slotId===kaili),b=changed.currentSource.version.slotAvailability.find(r=>r.dayOfWeek===day&&r.slotId===gregory);
 for(const field of ['qualifications','acceptedRouteAnchorLocationId'])[a[field],b[field]]=[b[field],a[field]];
}
const swapped=map(changed);
check('compatible actual people map to fixed roles without work regeneration',()=>{assert.equal(swapped.receipt.slotMapping.find(r=>r.patternSlotId===kaili).actualSlotId,gregory);assert.equal(swapped.receipt.slotMapping.find(r=>r.patternSlotId===gregory).actualSlotId,kaili);});
check('all physical members/windows/IDs and field order retained except ownerSlotId',()=>{
 assert.equal(swapped.mappedRows.length,source.version.assignments.length);
 for(let i=0;i<swapped.mappedRows.length;i++){const a=clone(swapped.mappedRows[i]),b=clone(source.version.assignments[i]);delete a.ownerSlotId;delete b.ownerSlotId;assert.deepEqual(a,b);}
});
const dated=clone(changed);dated.selection.kind='DATED_ABSENCE';const datedResult=map(dated);
check('dated mapping preserves all unrelated days and original exceptions',()=>{assert.deepEqual(datedResult.candidateSource.version.assignments.filter(r=>r.dayOfWeek!==1),source.version.assignments.filter(r=>r.dayOfWeek!==1));assert.deepEqual(datedResult.candidateSource.exceptions,source.exceptions);});
for(const field of ['lunch','shift','acceptedRouteAnchorLocationId','qualifications','restrictions'])check(`${field} incompatibility fails without solver fallback`,()=>{
 const a=clone(base);for(const r of a.currentSource.version.slotAvailability.filter(r=>r.slotId===kaili)){
  if(field==='lunch')r.lunch={start:'11:00',end:'12:00'};else if(field==='shift')r.shift={start:'10:00',end:'17:00'};
  else if(field==='acceptedRouteAnchorLocationId')r[field]='unknown-anchor';else if(field==='qualifications')r[field]=[];else r[field]=[source.version.assignments.find(w=>w.ownerSlotId===kaili).locationId];
 }
 assert.throws(()=>map(a));
});
check('Karen dated absence produces five available: no invented six fallback',()=>{
 const a=clone(base);a.selection.kind='DATED_ABSENCE';a.selection.availablePersonIds=a.selection.availablePersonIds.filter(p=>p!==config.slots.KAREN.personId);
 a.currentSource.exceptions=[{id:'synthetic-karen-absence',type:'daily_absence',serviceDate:'2026-10-05',baseVersionId:source.version.id,publicationId:source.version.publicationId,actorId:'synthetic-manager',reason:'Explicit synthetic dated absence',idempotencyKey:'synthetic-karen-absence',expectedRevision:1,payload:{slotId:config.slots.KAREN.slotId}}];
 assert.throws(()=>map(a),{code:'static_template_missing_approved_pattern'});
});
check('ordinary days off do not select a smaller template',()=>{
 const a=clone(base);a.currentSource.version.assignments=a.currentSource.version.assignments.filter(r=>r.dayOfWeek!==1||r.ownerSlotId!==kaili);
 a.templates[0].source=clone(a.currentSource);for(const r of a.currentSource.version.slotAvailability.filter(r=>r.slotId===kaili&&r.dayOfWeek===1))r.status='not_working';
 a.templates[0].source=clone(a.currentSource);a.admittedBindings[0].sourceDigest=contentDigest(a.templates[0].source);
 assert.equal(map(a).receipt.staffingCount,6);
});
for(const count of [7,8])check(`missing approved ${count} is explicit, no John activation`,()=>{
 const a=clone(base);a.selection.templateId=`approved-${count}-pattern`;assert.throws(()=>map(a),{code:'static_template_missing_approved_pattern'});
});
check('source/selection/template arguments are not mutated',()=>{const before=clone(changed);map(changed);assert.deepEqual(changed,before);});
check('expired inherited absolute deadline refuses before work',()=>{assert.throws(()=>map({...base,deadline:performance.now()-1}),{code:'solver_timeout'});});
check('new currently required work cannot be dropped by stale template',()=>{
 const a=clone(base),row=clone(a.currentSource.version.assignments.find(r=>r.dayOfWeek===1));row.workId='new-current-required-row';
 a.currentSource.version.assignments.push(row);assert.throws(()=>map(a),{code:'static_template_current_coverage_incompatible'});
});
check('changed current qualifications cannot be weakened by approved older rows',()=>{
 const a=clone(base);a.currentSource.version.assignments[0].requiredQualifications.push('new-current-requirement');
 assert.throws(()=>map(a),{code:'static_template_current_coverage_incompatible'});
});
check('approved role survives old vacancy without resurrecting historic people',()=>{
 const a=clone(base),s=a.templates[0].source;s.slots.find(r=>r.id===kaili).incumbencies=[];
 s.version.vacancyCapableSlotIds=[kaili];s.version.vacantSlotIds=[kaili];
 for(const r of s.version.slotAvailability.filter(r=>r.slotId===kaili))r.status='vacant_unfilled';
 a.admittedBindings[0].sourceDigest=contentDigest(s);
 const result=map(a);assert.equal(result.receipt.staffingCount,6);assert.deepEqual(result.candidateSource,source);
 assert.equal(result.receipt.slotMapping.find(r=>r.patternSlotId===kaili).actualPersonId,config.slots.KAILI.personId);
 assert.equal(s.slots.find(r=>r.id===kaili).incumbencies.length,0);
});

const nineSource=clone(source),nineConfig=clone(config),ninePeople=[];
for(const [i,key]of ['OPTION1','OPTION2','OPTION4'].entries()){
 const s=nineConfig.slots[key],personId=`74000000-0000-4000-8000-00000000000${i+1}`;
 s.personId=personId;s.name=`Synthetic compatible person ${i+1}`;s.vacancy=false;
 ninePeople.push(personId);nineSource.slots.push({id:s.slotId,label:key,incumbencies:[{personId,displayName:s.name,effectiveStart:'2026-10-01',effectiveEnd:null}]});
 for(let day=0;day<7;day++)nineSource.version.slotAvailability.push({slotId:s.slotId,dayOfWeek:day,status:'not_working'});
}
const nineArgs=args(nineSource,nineConfig);
nineArgs.templates[0].templateId='synthetic-approved-nine';nineArgs.templates[0].staffingCount=9;
nineArgs.templates[0].roleSlotIds=nineSource.slots.map(s=>s.id).sort();nineArgs.admittedBindings[0].roleSlotIdsDigest=contentDigest(nineArgs.templates[0].roleSlotIds);
nineArgs.admittedBindings[0].templateId='synthetic-approved-nine';nineArgs.admittedBindings[0].staffingCount=9;
nineArgs.selection.templateId='synthetic-approved-nine';nineArgs.selection.availablePersonIds.push(...ninePeople);
check('approved nine-position pattern preserves unchanged assignment geometry',()=>{const x=map(nineArgs);assert.equal(x.receipt.staffingCount,9);assert.deepEqual(x.candidateSource,nineSource);});
const nineToSix=args(source,nineConfig);nineToSix.currentSource=clone(nineSource);nineToSix.selection.kind='DATED_ABSENCE';
nineToSix.currentSource.exceptions=['OPTION1','OPTION2','OPTION4'].map((key,index)=>({id:`synthetic-extra-absence-${index}`,sequence:index+1,type:'daily_absence',serviceDate:'2026-10-05',baseVersionId:source.version.id,publicationId:source.version.publicationId,actorId:'synthetic-manager',reason:'Explicit synthetic dated absence',idempotencyKey:`synthetic-extra-absence-${index}`,expectedRevision:1,payload:{slotId:nineConfig.slots[key].slotId}}));
check('nine employed, three explicit dated absences selects admitted six not nine',()=>{const x=map(nineToSix);assert.equal(x.receipt.staffingCount,6);assert.deepEqual(x.mappedRows,source.version.assignments.filter(r=>r.dayOfWeek===1));assert.deepEqual(x.candidateSource.exceptions,nineToSix.currentSource.exceptions);});
check('changed dated nine roster uses actual working availability even without explicit absences',()=>{const a=clone(nineToSix);a.currentSource.exceptions=[];assert.equal(map(a).receipt.staffingCount,6);});
check('unchanged weekly nine pattern keeps ordinary days off',()=>{const a=clone(nineArgs);assert.equal(map(a).receipt.staffingCount,9);});
check('partial dated working hours count only when fresh proven capacity exists, then compatibility still checks full role',()=>{
 const a=clone(base);a.selection.kind='DATED_ABSENCE';
 const row=a.currentSource.version.slotAvailability.find(r=>r.dayOfWeek===1&&r.slotId===kaili);row.shift={start:'10:00',end:'17:00'};
 assert.throws(()=>map(a),{code:'static_template_no_compatible_person_slot_mapping'});
});
check('static feasibility checks complete hard rows and independent lunch without optimizer tiers',()=>{
 const x=prepareApprovedStaticTemplateProjection(base);
 assert.equal(x.schema,'custodial.approved-static-feasibility.v1');assert.equal(x.assignments.length,42);
 assert.equal(x.solverInvoked,false);assert.equal(x.optimized,false);assert.ok(x.hardConstraintCount>42);
 assert.equal(x.lunch.status,'PLANNED');assert.equal(Object.hasOwn(x,'solver'),false);
 assert.ok(x.baselineAssignments.every(r=>r.payload_json.authority_facts.service_mode==='scan_tracked'));
 assert.ok(x.baselineAssignments.every(r=>r.payload_json.authority_facts.included_locations.length===1));
});

// Actual retained corrected six-pattern rows, not extrapolation from tiny rows.
// The fixture's legacy contractor capacity has no owned work. Removing only
// those inactive slots/availability for this employee-pattern compatibility
// proof is explicit; no employee, assignment or accepted geometry is invented.
const packet=loadSixPersonAbsenceSource(),actual=clone(packet.compilerInput);
const removed=new Set(actual.slots.filter(s=>s.contractorCapacity).map(s=>s.id));
assert.equal(actual.version.assignments.filter(r=>removed.has(r.ownerSlotId)).length,0);
actual.slots=actual.slots.filter(s=>!removed.has(s.id));
actual.version.slotAvailability=actual.version.slotAvailability.filter(r=>!removed.has(r.slotId));
for(const key of ['namedAbsentSlotIds','vacancyCapableSlotIds','vacantSlotIds'])actual.version[key]=(actual.version[key]||[]).filter(id=>!removed.has(id));
const actualArgs=args(actual),actualBefore=clone(actual),real=map(actualArgs);
check('actual artifact-bound operational six returns all 323 approved rows unchanged',()=>{assert.equal(real.mappedRows.length,323);assert.ok(isDeepStrictEqual(real.mappedRows,actual.version.assignments));assert.ok(isDeepStrictEqual(real.candidateSource,actualBefore));});
check('future local six publication is not falsely claimed',()=>{assert.equal(config.dateAuthority.classification,'UNPUBLISHED_LOCAL_CANDIDATE');assert.equal(real.receipt.published,false);});
check('actual six fixed pattern independently satisfies hard model and lunch, without a solver',()=>{
 const x=prepareApprovedStaticTemplateProjection(actualArgs);
 assert.equal(x.mapping.mappedRowsDigest,real.receipt.mappedRowsDigest);assert.ok(x.assignments.length>=323);
 assert.equal(x.lunch.status,'PLANNED');assert.equal(x.solverInvoked,false);
});
const originalPath=process.env.CUSTODIAL_FULL_NINE_BASE_PACKET||null;
const historical=loadFullNineV6Source({retainedPacketPath:originalPath});
check('historical approved V6 wrapper and 314-row geometry bind exactly, not new nine generation',()=>{
 assert.equal(historical.provenance.originalPacketSha256,'2aab217b29482894b883ce36a3d7a44516d8fc4aa2b329471551b2f4c9a86981');
 assert.equal(historical.originalWrapperVerified,Boolean(originalPath));assert.equal(historical.compilerInput.version.assignments.length,314);
});
check('historical nine cannot masquerade as compatible current six authority',()=>{
 const a=args(actual);a.templates[0]={templateId:'historical-approved-nine',staffingCount:9,source:historical.compilerInput};a.selection.templateId='historical-approved-nine';
 a.admittedBindings=[{...a.admittedBindings[0],templateId:'historical-approved-nine',staffingCount:9,sourceDigest:contentDigest(historical.compilerInput),artifactSha256:historical.provenance.originalPacketSha256}];
 assert.throws(()=>map(a),{code:'static_template_missing_approved_pattern'});assert.ok(isDeepStrictEqual(historical.compilerInput.version.assignments,loadFullNineV6Source().compilerInput.version.assignments));
});
check('actual V6 nine ROLE geometry is bound independently of old incumbencies; current hours may refuse it',()=>{
 const pattern=clone(historical.compilerInput),nonemployee=new Set(pattern.slots.filter(s=>s.contractorCapacity).map(s=>s.id));
 assert.equal(pattern.version.assignments.filter(r=>nonemployee.has(r.ownerSlotId)).length,0);
 pattern.slots=pattern.slots.filter(s=>!nonemployee.has(s.id));pattern.version.slotAvailability=pattern.version.slotAvailability.filter(r=>!nonemployee.has(r.slotId));
 for(const field of ['namedAbsentSlotIds','vacantSlotIds','vacancyCapableSlotIds'])pattern.version[field]=(pattern.version[field]||[]).filter(id=>!nonemployee.has(id));
 const current=clone(pattern);current.serviceDate='2026-10-05';current.version.vacantSlotIds=[];
 for(const s of current.slots){
  const person=Object.values(nineConfig.slots).find(p=>p.slotId===s.id);assert.ok(person);
  s.incumbencies=s.incumbencies.filter(h=>h.effectiveStart<'2026-10-01').map(h=>({...h,effectiveEnd:h.effectiveEnd&&h.effectiveEnd<'2026-10-01'?h.effectiveEnd:'2026-10-01'}));
  s.incumbencies.push({personId:person.personId,displayName:person.name,effectiveStart:'2026-10-01',effectiveEnd:null});
 }
 for(const r of current.version.slotAvailability){const p=Object.values(nineConfig.slots).find(s=>s.slotId===r.slotId);r.status=p.workDays.includes(r.dayOfWeek)?'working':'not_working';r.shift={start:p.shift[0],end:p.shift[1]};const lunch=p.lunchByDay?.[String(r.dayOfWeek)]||p.lunch;r.lunch={start:lunch[0],end:lunch[1]};}
 const a=args(current,nineConfig),roles=[...new Set(pattern.version.assignments.map(r=>r.ownerSlotId))].sort();assert.equal(roles.length,9);
 a.templates=[{templateId:'artifact-approved-nine-roles',staffingCount:9,roleSlotIds:roles,source:pattern}];
 a.admittedBindings=[{...a.admittedBindings[0],templateId:'artifact-approved-nine-roles',staffingCount:9,roleSlotIdsDigest:contentDigest(roles),sourceDigest:contentDigest(pattern),artifactSha256:historical.provenance.originalPacketSha256}];
 a.selection.templateId='artifact-approved-nine-roles';a.selection.availablePersonIds.push(...ninePeople);
 assert.throws(()=>map(a),{code:'static_template_no_compatible_person_slot_mapping'});
 assert.ok(isDeepStrictEqual(pattern.version.assignments,historical.compilerInput.version.assignments));
});
console.log(JSON.stringify({status:'PASS',checks,elapsedMilliseconds:performance.now()-started,solver:false,production:false,publication:false,actualPatternRows:323,
 actualFixtureSha256:packet.fixtureSha256,originalSourceDigest:packet.sourceDigest,configSha256:sha(configBytes),privateCustodyPreserved:true,
 actualPatternScope:'OWNER_CORRECTED_OPERATIONAL_PATTERN_COMPATIBILITY_NOT_FUTURE_PUBLICATION',historicalWrapperVerified:historical.originalWrapperVerified,
 historicalNineTestScope:'EXACT_APPROVED_314_ROW_PATTERN_WITH_SYNTHETIC_CURRENT_NINE_COMPATIBILITY_REFUSAL_NOT_ACTIVATION',missingApprovedTemplates:[5,7,8]}));
