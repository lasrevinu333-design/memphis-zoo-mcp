import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
import {deriveDatedShiftEndCoverage} from '../src/static-weekly-shift-end-derivation.js';
import {loadCurrentManagerPublicationFixture} from './fixtures/current-manager-publication-source.mjs';

const id='public.static_weekly_v9_assert_shift_end_derivation(jsonb)';
const functionName='public.static_weekly_v9_assert_shift_end_derivation';
const clone=value=>structuredClone(value);
const file=url=>readFileSync(fileURLToPath(url),'utf8');
const currentFixture=()=>loadCurrentManagerPublicationFixture().packet;
const namedHandoff=source=>source.version.shiftEndContinuityPolicy.namedHandoffs[0];

// Cheap pinned source/contract proof. The SQL fixture below is run separately
// against the persisted current-manager projection, never an invented row.
export function assertNamedHandoffSourceContract(){
 const packet=currentFixture(),source=packet.compilerInput,named=namedHandoff(source);
 assert.equal(packet.classification,'SYNTHETIC_CURRENT323_PLUS_IMMUTABLE_ORIGINAL314_NOT_PRODUCTION_REGISTRATION');
 assert.equal(digest(source),packet.sourceDigest);
 assert.deepEqual(Object.keys(named).sort(),['at','dayOfWeek','fromSlotId','locationCode','source','toSlotId'].sort());
 assert.deepEqual([named.dayOfWeek,named.locationCode,named.at],[6,'CAT_COUNTRY','14:00']);
 const parent=source.version.assignments.filter(r=>r.dayOfWeek===named.dayOfWeek
  &&r.locationCodeSnapshot===named.locationCode&&r.window.start==='09:45');
 assert.equal(parent.length,1);
 assert.equal(parent[0].ownerSlotId,named.fromSlotId);
 assert.equal(parent[0].window.end,named.at);
 const actual=deriveDatedShiftEndCoverage(source,digest);
 const chain=actual.receipt?.parentChains?.find(c=>c.dayOfWeek===named.dayOfWeek&&c.parentWorkId===parent[0].workId)
  ??actual.shiftEndDerivation?.parentChains?.find(c=>c.dayOfWeek===named.dayOfWeek&&c.parentWorkId===parent[0].workId);
 assert.ok(chain,'named handoff must be in the actual source-derived chain');
 assert.ok(chain.segments.some((s,i)=>i>0&&s.kind==='handoff'&&s.window.start===named.at
  &&s.ownerSlotId===named.toSlotId&&chain.segments[i-1].ownerSlotId===named.fromSlotId));
 const old=file(new URL('../supabase/migrations/20260924042758_static_weekly_canonical_shift_end_derivation.sql',import.meta.url));
 const forward=file(new URL('../supabase/migrations/20261003230000_static_weekly_named_handoff_derivation.sql',import.meta.url));
 for(const token of ["array['schema','algorithm','normalPhaseStart','weights','provenance','policyDigest'],'shift-end source policy'",
  'minute_samples integer:=0; location_samples integer:=0; location_count integer; span integer;',
  '-- OPEN may retain a stable baseline position, never a fictitious execution']){
  assert.ok(old.includes(token),'the original v9 predecessor seam remains present');
  assert.ok(forward.includes(token),'the forward migration pins the unchanged predecessor');
 }
 assert.match(forward,/named handoff does not match exactly one derived segment/);
 assert.match(forward,/named handoff lacks verified directed source proximity/);
 assert.match(forward,/named handoff source or recipient is not current and eligible/);
 return {sourceId:packet.sourceId,sourceDigest:packet.sourceDigest,parentWorkId:parent[0].workId,
  namedHandoff:named,classification:'SOURCE_ONLY_NO_DATABASE_EXECUTION'};
}

const dateForDay=(week,day)=>{
 const value=new Date(week+'T12:00:00Z');
 value.setUTCDate(value.getUTCDate()+(day-value.getUTCDay()+7)%7);
 return value.toISOString().slice(0,10);
};
function datedRoster(source){
 const capable=new Set(source.version.vacancyCapableSlotIds||[]),rows=[];
 for(const availability of source.version.slotAvailability){
  const slot=source.slots.find(s=>s.id===availability.slotId);
  if(!slot||slot.contractorCapacity)continue;
  const serviceDate=dateForDay(source.serviceDate,availability.dayOfWeek);
  const incumbents=slot.incumbencies.filter(i=>i.effectiveStart<=serviceDate
   &&(!i.effectiveEnd||serviceDate<i.effectiveEnd));
  assert.ok(incumbents.length<=1);
  assert.equal(incumbents.length===0,capable.has(slot.id)&&availability.status==='vacant_unfilled');
  rows.push({serviceDate,dayOfWeek:availability.dayOfWeek,slotId:slot.id,
   personId:incumbents[0]?.personId??null,vacant:incumbents.length===0,
   status:availability.status,shift:availability.shift,lunch:availability.lunch});
 }
 return rows.sort((a,b)=>a.dayOfWeek-b.dayOfWeek||a.slotId.localeCompare(b.slotId));
}
function rebindNamedAuthority(authority,{roster=false}={}){
 const source=authority.compilerInput,effective=authority.overlayCompilerInput,
  receipt=authority.shiftEndDerivation,policy=source.version.shiftEndContinuityPolicy;
 const body=clone(policy);delete body.policyDigest;
 policy.policyDigest=digest(body);
 effective.version.shiftEndContinuityPolicy=clone(policy);
 effective.version.shiftEndDerivationApplied=policy.policyDigest;
 receipt.policyDigest=policy.policyDigest;
 receipt.templateDigest=digest(source);
 if(roster)receipt.datedRosterDigest=digest(datedRoster(source));
 const baseline=clone(effective);baseline.exceptions=[];
 authority.derivedBaselineDigest=receipt.derivedBaselineDigest=digest(baseline);
 receipt.outputWorkDigest=digest(effective.version.assignments);
 return authority;
}

// Call immediately after the exact current323 draft is published and its
// stored projection.authority is read. The caller owns synthetic DB lifecycle.
export async function testNamedHandoffSql({pool,authority,check}){
 assert.ok(pool&&authority&&typeof check==='function');
 const sourceContract=assertNamedHandoffSourceContract(),stored=clone(authority),
  named=namedHandoff(stored.compilerInput),parent=stored.compilerInput.version.assignments.find(r=>
   r.workId===sourceContract.parentWorkId&&r.dayOfWeek===named.dayOfWeek);
 assert.ok(parent);
 check('stored source is exact current323 fixture',digest(stored.compilerInput),sourceContract.sourceDigest);
 check('stored named source identity is exact',named,sourceContract.namedHandoff);
 const call=async value=>pool.query(`select ${functionName}($1::jsonb)`,[value]);
 await call(stored);check('actual SQL admits persisted current named handoff',true,true);
 async function denied(label,mutate,pattern,{rebind=true,roster=false}={}){
  const value=clone(stored);mutate(value);
  if(rebind)rebindNamedAuthority(value,{roster});
  await assert.rejects(()=>call(value),error=>error.code==='23514'&&pattern.test(error.message),label);
  check(label,true,true);
 }
 await denied('named fields cannot add unrecognized data',a=>{
  namedHandoff(a.compilerInput).recipientHint='invented';
 },/shift-end named handoff/);
 await denied('named list must be an array',a=>{
  a.compilerInput.version.shiftEndContinuityPolicy.namedHandoffs={};
 },/named handoffs must be one array/);
 await denied('duplicate named handoff refused',a=>{
  const list=a.compilerInput.version.shiftEndContinuityPolicy.namedHandoffs;list.push(clone(list[0]));
 },/named handoff duplicated/);
 await denied('named source statement cannot change without policy digest',a=>{
  namedHandoff(a.compilerInput).source+=' changed';
 },/shift-end source, policy, derived baseline and receipt identities must be exact/,{rebind:false});
 await denied('changed handoff time cannot bind old chain',a=>{
  namedHandoff(a.compilerInput).at='14:01';
 },/named handoff does not match exactly one derived segment/);
 await denied('different current recipient cannot bind old chain',a=>{
  const other=a.compilerInput.version.slotAvailability.find(s=>s.dayOfWeek===named.dayOfWeek
   &&s.status==='working'&&s.slotId!==named.fromSlotId&&s.slotId!==named.toSlotId
   &&s.shift.start<=named.at&&named.at<s.shift.end);
  assert.ok(other,'fixture requires a distinct real on-duty position');
  namedHandoff(a.compilerInput).toSlotId=other.slotId;
 },/named handoff does not match exactly one derived segment/);
 await denied('unknown recipient cannot bind old chain',a=>{
  namedHandoff(a.compilerInput).toSlotId='10000000-0000-4000-8000-000000000099';
 },/named handoff does not match exactly one derived segment/);
 await denied('missing directed proximity cannot be inferred',a=>{
  a.compilerInput.proximity=[];a.overlayCompilerInput.proximity=[];
 },/named handoff lacks verified directed source proximity/);
 await denied('named recipient lunch cannot be ignored',a=>{
  for(const input of [a.compilerInput,a.overlayCompilerInput]){
   const availability=input.version.slotAvailability.find(s=>s.dayOfWeek===named.dayOfWeek&&s.slotId===named.toSlotId);
   assert.ok(availability);availability.lunch={start:'13:30',end:'14:30'};
  }
 },/physical handoff or explicit OPEN segment identity invalid|named handoff source or recipient is not current and eligible/,{roster:true});
 await denied('named recipient restriction cannot be ignored',a=>{
  for(const input of [a.compilerInput,a.overlayCompilerInput]){
   const availability=input.version.slotAvailability.find(s=>s.dayOfWeek===named.dayOfWeek&&s.slotId===named.toSlotId);
   assert.ok(availability);availability.restrictions=[parent.includedLocations[0]?.locationId??parent.locationId];
  }
 },/derived normal responsibility has off-duty or ineligible position|named handoff source or recipient is not current and eligible/);
 const historical=clone(stored);
 delete historical.compilerInput.version.shiftEndContinuityPolicy.namedHandoffs;
 rebindNamedAuthority(historical);
 await call(historical);check('historical six-key policy still admits the same already-valid chain',true,true);
 for(const role of ['anon','authenticated','service_role','static_weekly_control_plane',
  'static_weekly_release_operator','custodial_application_reader']){
  const client=await pool.connect();
  try{
   await client.query('begin');await client.query('set local role '+role);
   await assert.rejects(()=>client.query(`select ${functionName}('{}'::jsonb)`),e=>e.code==='42501');
   check('direct private validator denied '+role,true,true);
  }finally{await client.query('rollback');client.release();}
 }
 const inventory=await pool.query(`select object_kind,definition_sql,definition_sha256
  from public.custodial_release_authority_restore_inventory
  where object_kind in ('function','grant') and case when position('(' in object_identity)>0
   then to_regprocedure(object_identity) end=$1::regprocedure order by object_kind`,[id]);
 assert.deepEqual(inventory.rows.map(r=>r.object_kind),['function','grant']);
 for(const row of inventory.rows){
  const actual=await pool.query(`select ${row.object_kind==='function'?'pg_get_functiondef($1::regprocedure)':'public.custodial_release_authority_current_grant_definition($1)'} as definition`,[id]);
  check('exact '+row.object_kind+' recovery definition',row.definition_sql,actual.rows[0].definition);
  const hash=await pool.query('select public.static_weekly_digest_text($1) as value',[row.definition_sql]);
  check('exact '+row.object_kind+' recovery hash',row.definition_sha256,hash.rows[0].value);
 }
 const recovery=await pool.connect();
 try{
  await recovery.query('begin');
  await recovery.query(`create or replace function ${functionName}(p_authority jsonb)
   returns void language plpgsql immutable as $synthetic$begin return;end$synthetic$`);
  await recovery.query(`grant execute on function ${functionName}(jsonb) to anon`);
  const changed=(await recovery.query('select pg_get_functiondef($1::regprocedure) as value',[id])).rows[0].value;
  assert.notEqual(changed,inventory.rows.find(r=>r.object_kind==='function').definition_sql);
  for(const row of inventory.rows)await recovery.query(row.definition_sql);
  const restoredDefinition=(await recovery.query('select pg_get_functiondef($1::regprocedure) as value',[id])).rows[0].value;
  const restoredGrant=(await recovery.query('select public.custodial_release_authority_current_grant_definition($1) as value',[id])).rows[0].value;
  check('synthetic drift restores exact private function definition',restoredDefinition,
   inventory.rows.find(r=>r.object_kind==='function').definition_sql);
  check('synthetic drift removes accidental anon grant',restoredGrant,
   inventory.rows.find(r=>r.object_kind==='grant').definition_sql);
 }finally{await recovery.query('rollback');recovery.release();}
 await call(stored);check('persisted authority still admitted after rolled-back recovery challenge',true,true);
 return {classification:'SYNTHETIC_PERSISTED_CURRENT323_SQL_ONLY',sourceId:sourceContract.sourceId,
  sourceDigest:sourceContract.sourceDigest,positive:true,historyPreserved:true,production:false};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 console.log(JSON.stringify(assertNamedHandoffSourceContract()));
}
