import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {Pool} from 'pg';
import {canonicalOptimizerAssignmentProjection} from '../src/static-weekly-schedule-program.js';

const container=process.env.SHIFT_END_TEST_CONTAINER,socket=process.env.SHIFT_END_TEST_SOCKET;
assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);
assert.match(socket??'',/^\/tmp\/mz-shift-socket-[a-zA-Z0-9]+$/);
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',timeout:10000}))[0];
assert.equal(info.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(info.HostConfig.PortBindings??{}).length,0);
assert.ok(info.Mounts.some(m=>m.Source===socket&&m.Destination==='/test-socket'));
const pool=new Pool({host:socket,user:'supabase_admin',password:'postgres',database:'postgres',max:1,connectionTimeoutMillis:3000});
const c=await pool.connect(),checks=[];
const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks.push(name);};
const fn='public.static_weekly_v18_canonical_display_assignment',signature=fn+'(jsonb)';
const read=async row=>(await c.query('select '+fn+'($1) as result',[row])).rows[0].result;
const row={planWorkId:'1:fixture',workId:'fixture',dayOfWeek:1,serviceDate:'2026-09-28',
 status:'ASSIGNED',slotId:'slot',personId:'person',displayName:'Synthetic custodian',
 ownerDigest:'a'.repeat(64),exactOwnerIdentity:'b'.repeat(64),baselineSlotId:'slot',
 baselineOwnerPersonId:'person',baselineOwnerName:'Synthetic custodian',originalActorPersonId:'person',
 originalActorName:'Synthetic custodian',optimizedOwnerSlotId:'slot',optimizedOwnerPersonId:'person',
 actualActorPersonId:null,window:{start:'09:45',end:'17:00',startMinute:585,endMinute:1020},
 serviceEffortMinutes:9,locationId:'location',explanation:{hardConstraints:'satisfied'}};
try{
 await c.query('begin');await c.query("set local statement_timeout='5000ms'");
 const expected=canonicalOptimizerAssignmentProjection([row])[0];
 check('SQL exactly matches shared canonical compiler projection',await read(row),expected);
 // The fail-before condition: selecting top-level keys alone retains solver
 // minute expansions inside window, unlike the compiler authority contract.
 const oldProjection=Object.fromEntries(Object.entries(row).filter(([key])=>Object.hasOwn(expected,key)));
 assert.notDeepEqual(oldProjection,expected);checks.push('reproduced old top-level-only window mismatch');
 for(const [label,start,end] of [['start of day','00:00','00:01'],['end of day','23:59','24:00']]){
  const copy=structuredClone(row),minute=s=>Number(s.slice(0,2))*60+Number(s.slice(3));
  copy.window={start,end,startMinute:minute(start),endMinute:minute(end)};
  check('valid boundary '+label,await read(copy),canonicalOptimizerAssignmentProjection([copy])[0]);
 }
 for(const [label,change] of [
  ['missing canonical field',r=>{delete r.actualActorPersonId;}],
  ['missing clock',r=>{delete r.window.start;}],
  ['missing minute',r=>{delete r.window.startMinute;}],
  ['conflicting minute',r=>{r.window.startMinute++;}],
  ['string minute',r=>{r.window.startMinute='585';}],
  ['fractional minute',r=>{r.window.endMinute=1020.5;}],
  ['null minute',r=>{r.window.endMinute=null;}],
  ['clock changes without matching minute',r=>{r.window.end='18:00';}],
  ['malformed clock',r=>{r.window.start='9:45';}],
  ['out of range clock',r=>{r.window.end='25:00';}],
  ['zero length window',r=>{r.window.end=r.window.start;r.window.endMinute=r.window.startMinute;}],
  ['reversed window',r=>{r.window.end='01:00';r.window.endMinute=60;}],
  ['unknown nested field',r=>{r.window.untrustedEnd='19:00';}],
 ]){
  await c.query('savepoint hostile_display');
  try{const copy=structuredClone(row);change(copy);await assert.rejects(()=>read(copy),/recurring displayed/);checks.push(label+' rejected');}
  finally{await c.query('rollback to savepoint hostile_display');}
 }
 for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader']){
  await c.query('savepoint denied_display');
  try{await c.query('set local role '+role);await assert.rejects(()=>read(row),/permission denied/);checks.push('private helper caller denied '+role);}
  finally{await c.query('rollback to savepoint denied_display');}
 }
 const recovery=(await c.query("select object_kind,definition_sql from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and to_regprocedure(case when object_identity like '%(%' then object_identity else null end)=$1::regprocedure order by restore_order",[signature])).rows;
 check('exact function and ACL recovery present',recovery.map(r=>r.object_kind),['function','grant']);
 await c.query('drop function '+signature);for(const entry of recovery)await c.query(entry.definition_sql);
 check('recovered projection unchanged',await read(row),expected);
 check('recovered helper still private',(await c.query("select has_function_privilege('static_weekly_control_plane',$1,'EXECUTE') as allowed",[signature])).rows[0].allowed,false);
 const proof={status:'PASS',checks:checks.length,assertions:checks,production:false,independentAudit:false,
  scope:'Actual PostgreSQL display window canonicalization versus shared JS compiler projection; full publication integration separate'};
 if(process.env.STATIC_WEEKLY_DISPLAY_EVIDENCE)writeFileSync(process.env.STATIC_WEEKLY_DISPLAY_EVIDENCE,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(proof));
}finally{await c.query('rollback');c.release();await pool.end();}
