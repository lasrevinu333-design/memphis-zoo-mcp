// A source-validation ledger, not a second scheduler or a unit conversion.
import ledgerDocument from '../config/custodial-component-weight-authority-v1.json' with {type:'json'};
import {contentDigest,sha256Hex} from './static-weekly-schedule-model.js';
import {postgresJsonbContentDigest} from './static-weekly-schedule-program.js';

export const COMPONENT_WEIGHT_UNIT='dimensionless_owner_component_weight';
export const INHERITED_WORKLOAD_UNIT='dimensionless_production_workload_points';
export const COMPONENT_WEIGHT_LEDGER_DIGEST='26b1ca41c9cfd6335f99d4522027810a614efa81ddec403596ce3d9bea5930d4';
export const COMPONENT_WEIGHT_RECEIPT_SCHEMA='custodial.schedule-component-weight-validation.v1';
const clone=x=>structuredClone(x);
const fail=message=>{throw Object.assign(new Error(message),{code:'invalid_component_weight_authority'});};
const fact=(ok,message)=>{if(!ok)fail(message);};
const freeze=x=>{for(const v of Object.values(x))if(v&&typeof v==='object')freeze(v);return Object.freeze(x);};
const trusted=freeze(ledgerDocument);
const foreignWeightFields=['weight','unit','weightUnit','componentWeight','componentWeightUnit','serviceEffortUnit','workloadUnit'];

export function assertScheduleComponentWeightLedger(ledger){
 fact(ledger?.schema==='custodial.schedule-component-weight-authority.v1'&&ledger.revision===1,'Unknown component ledger revision.');
 fact(ledger.componentWeightUnit===COMPONENT_WEIGHT_UNIT&&ledger.inheritedEffortUnit===INHERITED_WORKLOAD_UNIT
  &&ledger.physicalDurationUnit==='NOT_ESTABLISHED','Component weight, inherited budget and physical duration are distinct units.');
 fact(contentDigest(ledger)===COMPONENT_WEIGHT_LEDGER_DIGEST,'Ledger is not the exact reviewed owner/member authority.');
 return true;
}
assertScheduleComponentWeightLedger(trusted);
export function getScheduleComponentWeightLedger(){return clone(trusted);}

function rejectForeignWeights(value){
 fact(!foreignWeightFields.some(k=>Object.hasOwn(value,k)),'Source cannot substitute caller-supplied component weights or units.');
}

export function validateScheduleComponentWeightSource(options){
 fact(options&&Object.keys(options).every(k=>['source','ownerConfig','ledger'].includes(k)),'Unknown component validation input.');
 const {source,ownerConfig,ledger=trusted}=options;
 assertScheduleComponentWeightLedger(ledger);
 fact(source&&ownerConfig?.weights,'Explicit source and owner aggregate configuration are required.');
 fact(!(source.version&&source.versions),'Ambiguous source version namespace.');
 const version=source.version||(source.versions?.length===1?source.versions[0]:null);
 fact(Array.isArray(version?.assignments),'One explicit recurring source is required.');
 rejectForeignWeights(source);rejectForeignWeights(version);rejectForeignWeights(ownerConfig);rejectForeignWeights(ownerConfig.weights);
 const beforeSource=JSON.stringify(source),beforeConfig=JSON.stringify(ownerConfig);
 const bindings=[],workIds=new Set(),phaseKeys=new Set();
 const familyByCode=new Map(ledger.families.map(x=>[x.code,x]));
 const memberById=new Map(ledger.families.flatMap(f=>f.components.map(c=>[c.locationId,f.code])));
 for(const family of ledger.families){
  fact(ownerConfig.weights[family.code]===family.aggregateWeight,`${family.code}: aggregate weight differs from owner authority.`);
  fact(family.components.reduce((sum,c)=>sum+c.weight,0)===family.aggregateWeight,'Invalid component aggregate.');
 }
 for(const row of version.assignments){
  const family=familyByCode.get(row.locationCodeSnapshot);
  const included=row.includedLocations||[];
  fact(Array.isArray(included),'Physical member list must be an array.');
  // A known physical UUID cannot evade validation by changing its family code.
  if(!family){
   fact(!memberById.has(row.locationId)&&!included.some(m=>memberById.has(m.locationId)), 'Known component placed in a wrong family namespace.');
   continue;
  }
  rejectForeignWeights(row);
  fact(typeof row.workId==='string'&&row.workId&&!workIds.has(row.workId),'Duplicate or absent component work identity.');workIds.add(row.workId);
  fact(row.locationId===family.primaryLocationId,`${family.code}: wrong primary identity.`);
  fact(row.serviceMode===family.serviceMode,`${family.code}: cleaning/response-only capability changed.`);
  fact(row.schedulingMode==='flexible_coverage_ownership','Component responsibility cannot be interpreted as timed physical service.');
  fact(Number.isSafeInteger(row.serviceEffortMinutes)&&row.serviceEffortMinutes>0&&typeof row.serviceEffortProvenance==='string'&&row.serviceEffortProvenance.trim(), 'Inherited budget requires its existing integer value and provenance.');
  const expected=family.serviceMode==='response_only_no_clean'?[]:family.components.map(c=>c.locationId).sort();
  const actual=included.map(m=>{rejectForeignWeights(m);return m.locationId;}).sort();
  fact(actual.length===expected.length&&actual.every((id,i)=>id===expected[i]),`${family.code}: missing, duplicate, foreign or substituted member.`);
  fact(Number.isInteger(row.dayOfWeek)&&row.dayOfWeek>=0&&row.dayOfWeek<=6,'Invalid source weekday.');
  const phase=row.window?.start==='09:45'?'equalized':'morning';
  fact(row.window&&typeof row.window.start==='string'&&typeof row.window.end==='string','Missing source responsibility window.');
  const phaseKey=`${row.dayOfWeek}:${phase}:${family.code}`;
  fact(!phaseKeys.has(phaseKey),'Duplicate family responsibility in the selected source phase.');phaseKeys.add(phaseKey);
  bindings.push({workId:row.workId,dayOfWeek:row.dayOfWeek,phase,ownerSlotId:row.ownerSlotId,
   locationCode:family.code,primaryLocationId:row.locationId,serviceMode:row.serviceMode,
   componentIds:family.components.map(c=>c.locationId),componentWeights:family.components.map(c=>c.weight),
   aggregateWeight:family.aggregateWeight,componentWeightUnit:COMPONENT_WEIGHT_UNIT,
   inheritedEffortValue:row.serviceEffortMinutes,inheritedEffortProvenance:row.serviceEffortProvenance,inheritedEffortUnit:INHERITED_WORKLOAD_UNIT});
 }
 for(const family of ledger.families)for(let day=0;day<7;day++)for(const phase of ['morning','equalized'])
  fact(phaseKeys.has(`${day}:${phase}:${family.code}`),`${family.code}: selected complete week lacks a responsibility phase.`);
 fact(JSON.stringify(source)===beforeSource&&JSON.stringify(ownerConfig)===beforeConfig,'Validation must not mutate source/config.');
 bindings.sort((a,b)=>a.workId.localeCompare(b.workId));
 const body={schema:COMPONENT_WEIGHT_RECEIPT_SCHEMA,scope:ledger.scope,ledgerDigest:COMPONENT_WEIGHT_LEDGER_DIGEST,
  sourceDigest:postgresJsonbContentDigest(source),sourceSerializationSha256:sha256Hex(beforeSource),ownerConfigDigest:postgresJsonbContentDigest(ownerConfig),ownerConfigSerializationSha256:sha256Hex(beforeConfig),
  componentWeightUnit:COMPONENT_WEIGHT_UNIT,inheritedEffortUnit:INHERITED_WORKLOAD_UNIT,physicalDurationUnit:'NOT_ESTABLISHED',
  knownFamilies:ledger.families.length,validatedSourceRows:bindings.length,bindings,
  sourceMutated:false,effortBudgetsRecomputed:false,physicalMinuteFeasibilityProven:false,admitted:false,published:false,
  historicalPayloadValidationClaim:false,uncoveredFamilyValidationClaim:false};
 return {...body,receiptDigest:contentDigest(body)};
}

// The existing packet's wire-unit declaration is checked, not changed.
export function validateScheduleComponentWeightPacket({packet,ownerConfig,ledger=trusted}){
 fact(packet&&typeof packet==='object','Explicit packet required.');rejectForeignWeights(packet);
 const receipt=validateScheduleComponentWeightSource({source:packet?.compilerInput,ownerConfig,ledger});
 fact(packet.sourceDigest===receipt.sourceDigest,'Packet/source digest mismatch.');
 const rows=packet.compilerInput.version?.assignments||packet.compilerInput.versions[0].assignments;
 fact(Array.isArray(packet.serviceEffort)&&packet.serviceEffort.length===rows.length,'Packet effort list must preserve exact multiplicity.');
 const byId=new Map(rows.map(r=>[r.workId,r]));const seen=new Set();
 fact(byId.size===rows.length,'Duplicate source work identity.');
 for(const wire of packet.serviceEffort){
  const row=byId.get(wire.workId);
  fact(row&&!seen.has(wire.workId),'Duplicate, missing or foreign effort identity.');seen.add(wire.workId);
  fact(wire.unit===INHERITED_WORKLOAD_UNIT,'Packet effort unit cannot be replaced by component weight or physical minutes.');
  fact(wire.dayOfWeek===row.dayOfWeek&&wire.workloadPoints===row.serviceEffortMinutes&&wire.provenance===row.serviceEffortProvenance,'Packet effort differs from unchanged source budget.');
 }
 const {receiptDigest,...sourceReceipt}=receipt;
 const body={...sourceReceipt,packetEffortRowsChecked:seen.size,packetSerializationSha256:sha256Hex(JSON.stringify(packet))};
 return {...body,receiptDigest:contentDigest(body)};
}

// Only recurring source phase-load reporting. This does not replace dated
// optimizer budgets, load ratios, physical durations or publication controls.
export function createScheduleComponentWeightPhaseLoads(options){
 const receipt=validateScheduleComponentWeightSource(options),loads=new Map();
 for(const row of receipt.bindings){const key=`${row.dayOfWeek}:${row.phase}:${row.ownerSlotId}`;
  const load=loads.get(key)||{dayOfWeek:row.dayOfWeek,phase:row.phase,ownerSlotId:row.ownerSlotId,weight:0,unit:COMPONENT_WEIGHT_UNIT,workIds:[]};
  load.weight+=row.aggregateWeight;load.workIds.push(row.workId);loads.set(key,load);}
 return {scope:'TEN_CLAUSE_SELECTED_RECURRING_PHASE_LOADS_NOT_DATED_OPTIMIZER_BUDGET',sourceDigest:receipt.sourceDigest,ledgerDigest:receipt.ledgerDigest,
  loads:[...loads.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,x])=>x),admitted:false,published:false};
}
