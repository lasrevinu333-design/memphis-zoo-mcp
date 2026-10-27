import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {outcomeCredentialSeed,testOriginalDeliveryOutcomeHttp} from './original-delivery-outcome-http-tests.mjs';

// Actual migrated PostgreSQL functions/tables/roles. The original intent and
// receipt rows below are explicit synthetic boundary fixtures, not publication
// or native-send evidence. Foreign keys are bypassed ONLY while seeding those
// isolated rows; every read, refusal, grant and restore check uses normal roles.
const socket=process.env.ORIGINAL_OUTCOME_TEST_SOCKET;
assert.match(socket??'',/^\/tmp\/mz-original-outcome-[a-zA-Z0-9_-]+$/);
const pool=new Pool({host:socket,database:'postgres',user:'supabase_admin',password:'postgres',max:1,connectionTimeoutMillis:3000});
let devicePk=null,originalDevice=null;
const c=await pool.connect(),id=n=>n===1&&devicePk?devicePk:`96000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const signature='public.static_weekly_v26_read_original_delivery_outcome(uuid,text,uuid,uuid,uuid,bigint)';
let checks=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const q=async(sql,args=[])=>(await c.query(sql,args)).rows[0]?.result;
let args;
const read=async(a=args)=>{
 await c.query('set local role service_role');
 const result=await q('select public.static_weekly_v26_read_original_delivery_outcome($1,$2,$3,$4,$5,$6) as result',a);
 await c.query('reset role');return result;
};
async function refuse(label,work,pattern){
 await c.query('savepoint refuse');
 try{await assert.rejects(work,pattern,label);checks++;}
 finally{await c.query('rollback to savepoint refuse');}
}
const counts=()=>q(`select jsonb_build_array(
 (select count(*) from public.static_weekly_recurring_application_intents),
 (select count(*) from public.static_weekly_recurring_application_receipts),
 (select count(*) from public.static_weekly_recurring_terminal_intents),
 (select count(*) from public.static_weekly_recurring_terminal_receipts)) as result`);
try{
 await c.query('begin');await c.query("set local statement_timeout='10000ms'");
 originalDevice=await q("select to_jsonb(d) as result from public.devices d where device_id='KIOSK_08'")??null;
 devicePk=originalDevice?.id??id(1);args=[id(10),'SCHEDULE',id(1),id(2),id(3),7];
 await c.query('set local session_replication_role=replica');
 await c.query("insert into public.employees(id,employee_code,display_name,active) values($1,'EMP960001','Synthetic outcome employee',true)",[id(3)]);
 if(originalDevice)await c.query('update public.devices set active=true,assigned_employee_id=$2,assignment_epoch=7 where id=$1',[id(1),id(3)]);
 else await c.query("insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch) values($1,'KIOSK_08','Synthetic outcome phone',true,$2,7)",[id(1),id(3)]);
 const seed=outcomeCredentialSeed();
 await c.query("insert into public.device_auth_credentials(credential_id,device_id,token_hash,metadata_json,confirmed_at,expires_at) values($1,$2,$3,$4,statement_timestamp(),statement_timestamp()+interval '1 day')",[id(2),id(1),seed.hash,seed.metadata]);
 await c.query(`insert into public.static_weekly_recurring_application_intents
 (intent_id,operation_id,publication_id,projection_id,service_date,employee_id,device_id,credential_id,assignment_epoch,authority_revision,lunch_document_identity,view_json,view_digest,target_json,target_digest)
 values($1,$2,$3,$4,current_date,$5,$6,$7,7,1,repeat('b',64),'{}',repeat('c',64),'{}',repeat('d',64))`,[id(10),id(11),id(12),id(13),id(3),id(1),id(2)]);
 await c.query(`insert into public.static_weekly_recurring_terminal_intents
 (intent_id,invalidation_id,service_date,employee_id,device_id,credential_id,assignment_epoch,authority_revision,target_json,target_digest)
 values($1,$2,current_date,$3,$4,$5,7,2,'{}',repeat('e',64))`,[id(20),id(21),id(3),id(1),id(2)]);
 await c.query('set local session_replication_role=origin');
 const initial=await counts();
 const pending=await read();
 eq([pending.status,pending.receiptId,pending.appliedAt,pending.receivedAt,pending.retryAuthorized],['NO_RECORDED_RECEIPT',null,null,null,false],'missing receipt never authorizes retry');
 eq([pending.intentId,pending.authorityRevision,pending.targetDigest,pending.renderedDigest,pending.currentAuthorityNotInferred],[id(10),1,'d'.repeat(64),'c'.repeat(64),true],'exact original fields');
 eq(await read(),pending,'repeated read is stable');eq(await counts(),initial,'reads never create intents or receipts');
 const at='2026-10-21T23:01:02.123Z';
 await c.query("insert into public.static_weekly_recurring_application_receipts(intent_id,receipt_id,rendered_digest,applied_at) values($1,$2,repeat('c',64),$3)",[id(10),id(14),at]);
 const applied=await read();
 eq([applied.status,applied.receiptId,Date.parse(applied.appliedAt),applied.retryAuthorized],['RECEIPT_RECORDED',id(14),Date.parse(at),false],'exact immutable receipt readback');
 eq(await read(),applied,'repeat never changes applied timestamp');
 const blockedArgs=[id(20),'BLOCKED_RECURRING_AUTHORITY',...args.slice(2)];
 eq((await read(blockedArgs)).status,'NO_RECORDED_RECEIPT','terminal initially pending');
 await c.query("insert into public.static_weekly_recurring_terminal_receipts(intent_id,receipt_id,rendered_digest,applied_at) values($1,$2,repeat('e',64),$3)",[id(20),id(22),at]);
 const blocked=await read(blockedArgs);
 eq([blocked.status,blocked.targetDigest,blocked.renderedDigest,blocked.receiptId],['RECEIPT_RECORDED','e'.repeat(64),'e'.repeat(64),id(22)],'terminal receipt exact target render digest');
 eq(await read(),applied,'newer terminal does not hide older original schedule receipt');
 for(const a of [[id(99),...args.slice(1)],[args[0],'BLOCKED_RECURRING_AUTHORITY',...args.slice(2)],
  [...args.slice(0,2),id(99),...args.slice(3)], [...args.slice(0,3),id(99),...args.slice(4)],
  [...args.slice(0,4),id(99),7],[...args.slice(0,5),8]]){
  await refuse('foreign/missing original or principal refused',()=>read(a),/exact (current terminal schedule|original delivery) principal/);
 }
 for(const type of [null,'APPLIED','SCHEDULE '])await refuse('invalid target type',()=>read([args[0],type,...args.slice(2)]),/exact original delivery identity/);
 for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader']){
  eq(await q("select has_function_privilege($1,$2,'EXECUTE') as result",[role,signature]),role==='service_role','minimum execute '+role);
  if(role!=='service_role')await refuse('actual denied caller '+role,async()=>{await c.query('set local role '+role);await q('select public.static_weekly_v26_read_original_delivery_outcome($1,$2,$3,$4,$5,$6) as result',args);},/permission denied/);
 }
 await c.query('savepoint revoked');await c.query('update public.device_auth_credentials set revoked_at=statement_timestamp() where credential_id=$1',[id(2)]);
 await refuse('revoked principal cannot query history',()=>read(),/exact current terminal schedule principal/);await c.query('rollback to savepoint revoked');
 await c.query('savepoint inactive');await c.query('update public.employees set active=false where id=$1',[id(3)]);
 await refuse('inactive employee cannot query history',()=>read(),/exact original delivery principal/);await c.query('rollback to savepoint inactive');
 await refuse('immutable original receipt cannot be retimestamped',()=>c.query('update public.static_weekly_recurring_application_receipts set applied_at=clock_timestamp() where intent_id=$1',[id(10)]),/immutable|append-only/);
 const recovery=(await c.query(`select object_kind,definition_sql from public.custodial_release_authority_restore_inventory
 where object_kind in ('function','grant') and to_regprocedure(object_identity)=$1::regprocedure order by restore_order`,[signature])).rows;
 eq(recovery.map(x=>x.object_kind),['function','grant'],'function and minimum grants captured');
 eq(recovery[0].definition_sql,await q('select pg_get_functiondef($1::regprocedure) as result',[signature]),'exact recoverable source');
 await c.query('drop function '+signature);for(const row of recovery)await c.query(row.definition_sql);
 eq(await read(),applied,'restored original receipt unchanged');eq(await read(blockedArgs),blocked,'restored terminal receipt unchanged');
 eq(await q("select has_function_privilege('anon',$1,'EXECUTE') as result",[signature]),false,'restore has no anonymous grant');
 const http=await testOriginalDeliveryOutcomeHttp({client:c,id,applied,blocked,check:eq});
 console.log(JSON.stringify({status:'PASS',checks,actualMigratedPostgres:true,syntheticIntentAndReceiptFixtures:true,http,
  publicationNativeSendOrPhysicalEvidence:false,scope:'Original-intent outcome-only read, exact current principal, immutable timestamp, denied callers, no resend and exact function/grant recovery'}));
}finally{
 try{
  await c.query('rollback');
  assert.deepEqual(await q("select to_jsonb(d) as result from public.devices d where device_id='KIOSK_08'")??null,originalDevice,'exact original isolated kiosk row restored by rollback');
 }finally{c.release();await pool.end();}
}
