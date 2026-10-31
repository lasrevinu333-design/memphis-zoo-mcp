import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {assertManualScheduleDeliveryOrigin} from '../src/approved-manual-device-delivery.js';
import {readRecurringNotificationPlan} from '../src/recurring-notification-plan.js';
const base=new URL('../release/worker2-manual-recurring-device-continuity-20261030/source01/',import.meta.url);
const before=readFileSync(new URL('before/approved-manual-device-delivery.sql',base),'utf8');
const sql=readFileSync(new URL('../proposals/approved-manual-device-delivery.sql',import.meta.url),'utf8');
const sha=x=>createHash('sha256').update(x).digest('hex');
function functions(text){
 const rows=new Map();
 for(const match of text.matchAll(/^CREATE(?: OR REPLACE)? FUNCTION ([a-z_]+\.[a-z_0-9]+)\(/gm)){
  assert.ok(!rows.has(match[1]),'duplicate function source');
  const start=match.index,rest=text.slice(start),tag=/\bAS\s+(\$(?:[a-z_][a-z_0-9]*)?\$)/i.exec(rest);
  assert.ok(tag,'full dollar-delimited body');
  const bodyStart=start+tag.index+tag[0].length,bodyEnd=text.indexOf(tag[1],bodyStart);
  assert.ok(bodyEnd>=bodyStart);rows.set(match[1],text.slice(start,bodyEnd+tag[1].length));
 }
 return rows;
}
const old=functions(before),now=functions(sql),checks=[];
async function test(name,fn){await fn();checks.push(name);console.log('PASS '+name);}

await test('Main syntax-corrected040812 predecessor is frozen, and every unaffected existing delivery function is byte-literal',()=>{
 assert.equal(sha(before),'040812f6289fcf3a9fc17c5b187aac40bcaad62794c5f5a40269649cbca5ccab');
 const changed=['custodial_coverall.reconcile_manual_application_date','custodial_coverall.read_manual_application_target'];
 for(const [name,definition]of old){assert.ok(now.has(name),name);if(!changed.includes(name))assert.equal(now.get(name),definition,name);}
 assert.deepEqual([...now.keys()].filter(k=>!old.has(k)).sort(),['custodial_coverall.manual_recurring_projection_accepted','custodial_coverall.reconcile_manual_delivery_after_recurring_receipt','public.static_weekly_v27_ack_device_schedule_delivery'].sort());
});
await test('private typed proof requires real operation+receipt ownership and exact native staged envelope/lunch, not a prepared flag',()=>{
 const proof=now.get('custodial_coverall.manual_recurring_projection_accepted');
 for(const fragment of ['JOIN custodial_coverall.recurring_materialization_receipts r USING(operation_id)',
  'WHERE operation_id=o.operation_id','s.envelope_json IS DISTINCT FROM p.projection_envelope',
  's.lunch_json IS DISTINCT FROM l.document_json',"jsonb_build_object('envelope',s.envelope_json,'lunch',s.lunch_json)",
  "receipt->>'candidateDigest' IS DISTINCT FROM s.candidate_digest", "receipt->'employmentRevisionVector' IS DISTINCT FROM o.basis_json->'employmentRevisionVector'",
  "{semantic_snapshot,recurringOperation,operationId}","receipt->'authorityRevision' IS DISTINCT FROM to_jsonb(p_revision)"]){assert.ok(proof.includes(fragment),fragment);}
 assert.ok(proof.indexOf('IF NOT FOUND THEN RETURN false')<proof.indexOf('RETURN true'));
 assert.doesNotMatch(proof,/pg_current_xact_id\(\)|pg_backend_pid\(\)|PERSISTED.*RETURN true/,'post-admission read does not rerun/pretend the original transaction');
});
await test('normal repeat proves its own public original receipt/reference/basis and never pretends native schema',()=>{
 const proof=now.get('custodial_coverall.manual_recurring_projection_accepted');
 const normal=proof.slice(proof.indexOf('ELSIF o.repeat_basis IS NOT NULL'));
 for(const part of ['public.static_weekly_manual_repeat_confirmations',"receipt->'originalRepeatReceipt' IS DISTINCT FROM normal.receipt_json",
  "normal.receipt_json->>'referenceDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(normal.request_json)",
  "normal.request_json->'employmentRevisionVector' IS DISTINCT FROM vector",'custodial.approved-manual-recurring-reference-adapter.v1',
  'custodial.approved-manual-fixed-period-reference.v1',"normal.request_json->'sourceProjectionIdentity' IS DISTINCT FROM o.repeat_basis->'sourceProjectionIdentity'",
  "normal.request_json->'sourceLunchIdentity' IS DISTINCT FROM o.repeat_basis->'sourceLunchIdentity'"]){assert.ok(normal.includes(part),part);}
 assert.doesNotMatch(normal,/period-projection-authority|period-database-adapter/);
});
await test('same stored projection can retain another genuine normal request; NEW receipt trigger remains operation-exact',()=>{
 const proof=now.get('custodial_coverall.manual_recurring_projection_accepted');
 assert.match(proof,/p_operation uuid DEFAULT NULL/);assert.match(proof,/p_operation IS NULL OR operation\.operation_id=p_operation/);
 assert.doesNotMatch(proof,/n<>1|compiled_by_manager_id IS DISTINCT FROM o\.manager_id/);
 const trigger=now.get('custodial_coverall.reconcile_manual_delivery_after_recurring_receipt');
 assert.match(trigger,/NEW\.receipt_json->>'authorityRevision'\)::bigint,NEW\.operation_id/);
 assert.match(trigger,/generate_series\(operation\.frame_start,operation\.frame_start\+6/);
 assert.match(trigger,/a\.projection_id=projection/);
 assert.doesNotMatch(trigger,/materialize_|finalize_|INSERT INTO|UPDATE |DELETE FROM/);
 assert.match(sql,/AFTER INSERT ON custodial_coverall\.recurring_materialization_receipts DEFERRABLE INITIALLY DEFERRED/);
});
await test('old staffing acceptance predicate remains literal while typed current reads recheck actual retained receipts',()=>{
 const oldReconcile=old.get('custodial_coverall.reconcile_manual_application_date'),next=now.get('custodial_coverall.reconcile_manual_application_date');
 const a=oldReconcile.indexOf('  select 1 from public.static_weekly_staffing_commands command'),z=oldReconcile.indexOf("  then raise exception 'Prepared native document",a);
 assert.ok(next.includes(oldReconcile.slice(a,z)));
 assert.match(next,/v_recurring_accepted:=custodial_coverall\.manual_recurring_projection_accepted/);
 assert.match(now.get('custodial_coverall.read_manual_application_target'),/not custodial_coverall\.manual_recurring_projection_accepted\(t\.operation_id,a\.projection_id,a\.projection_authority_revision\)/);
 assert.match(sql,/REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane/);
});
await test('v27 original token/principal/clock/reservations/ACK tail is literal and only the manual table lock branch is added',()=>{
 const original=readFileSync(new URL('static_weekly_v27_ack_device_schedule_delivery.Source301.sql',base),'utf8').trimEnd();
 const changed=now.get('public.static_weekly_v27_ack_device_schedule_delivery');
 const start=original.indexOf(" if p_target_type='SCHEDULE' then\n"),end=original.indexOf(" else\n  perform 1 from public.static_weekly_recurring_terminal_intents",start);
 const added=readFileSync(new URL('V27_ACK_INSERTED_MANUAL_LOCK_BRANCH.txt',base),'utf8');
 assert.equal(changed.replace(added,original.slice(start,end)),original);
 assert.match(added,/custodial_coverall\.manual_application_intents/);assert.match(added,/for share of p nowait/);assert.match(added,/Ambiguous original manual\/recurring intent owner/);
 assert.ok(added.includes(original.slice(start+" if p_target_type='SCHEDULE' then\n".length,end)), 'original legacy locks literal');
});
await test('no old FK/wire/job-state/due-clock/lease/provider changes are introduced',()=>{
 assert.doesNotMatch(sql,/DROP CONSTRAINT|ALTER TABLE public\.static_weekly_recurring|INSERT INTO public\.static_weekly_recurring/);
 assert.doesNotMatch(sql,/UPDATE public\.(?:operational_notification_jobs|employee_native_push|device_auth)|DELETE FROM|TRUNCATE TABLE|due_at\s*=|lease_(?:token|expires_at)\s*=/i);
 assert.ok(sql.includes("'operationId',b.operation_id"));
 assert.match(sql,/ON CONFLICT DO NOTHING|on conflict do nothing/);
 assert.match(sql,/manual_recurring_projection_accepted.*reconcile_manual_application_date/s);
});
await test('real existing transport carries a later-frame13-field manual target to fixed v27 issuer and retains UNKNOWN without retry',async()=>{
 const id=randomUUID,binding=id(),device=id(),credential=id(),employee=id(),projection=id();
 const target={schema:'static-weekly.recurring-application-target.v1',targetType:'SCHEDULE',operationId:binding,
  publicationId:id(),projectionId:projection,serviceDate:'2026-11-06',authorityRevision:31,lunchDocumentIdentity:sha('synthetic lunch'),
  employeeId:employee,deviceId:device,credentialId:credential,assignmentEpoch:7,viewDigest:sha('synthetic view')};
 assert.equal(Object.keys(target).length,13,'unchanged closed13-field target including schema');
 const delivery={schema:'static-weekly.device-schedule-delivery.v1',mode:'RECURRING_SCHEDULE',authorityOrigin:{kind:'MANUAL_INITIAL',bindingId:binding},delivery:{intentId:id(),target,targetDigest:sha(JSON.stringify(target))}};
 const before=JSON.stringify(delivery);assert.equal(assertManualScheduleDeliveryOrigin(delivery),delivery);
 let calls=0;
 const result=await readRecurringNotificationPlan({serviceDate:target.serviceDate,
  assignment:{canonical_device_pk:device,canonical_device_id:'SYNTHETIC_ONLY',assigned_employee_id:employee,assignment_epoch:7},credentialId:credential,delivery,
  runRpc:async(name,args)=>{calls++;assert.equal(name,'static_weekly_v27_issue_recurring_notification_plan');assert.equal(args.p_date,'2026-11-06');assert.equal(args.p_intent,delivery.delivery.intentId);assert.equal(args.p_target_digest,delivery.delivery.targetDigest);throw Error('synthetic UNKNOWN; no retry');}});
 assert.equal(calls,1);assert.equal(JSON.stringify(delivery),before);assert.equal(result.complete,false);assert.equal(result.receipt_eligible,false);
});
console.log(JSON.stringify({status:'PASS',cases:checks.length,SQL:false,scope:'Exact Source/inverse and real transport with explicitly synthetic RPC UNKNOWN; not PostgreSQL acceptance, native reservation, device ACK or delivery proof'}));
