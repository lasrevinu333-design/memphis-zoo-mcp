import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateRecurringNotificationPlan,readRecurringNotificationPlan,exactPlanReceiptInstant} from '../src/recurring-notification-plan.js';
const id=n=>`97000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const target={targetType:'BLOCKED_RECURRING_AUTHORITY',serviceDate:'2026-10-22',employeeId:id(3),deviceId:id(1),credentialId:id(2),assignmentEpoch:7};
const delivery={intentId:id(4),targetDigest:'a'.repeat(64),target},context={delivery,serviceDate:'2026-10-22',devicePk:id(1),deviceId:'KIOSK_08',employeeId:id(3),credentialId:id(2),epoch:7};
const body={schema:'custodial.recurring-current-notification-plan.v1',complete:true,receipt_eligible:false,
 scope:'CURRENT_PRESENTATION_AND_FULL_EFFECTS_REQUIRED_BY_ACCEPTED_TARGET_NOT_FUTURE_ALARM_INVENTORY',source:'AUTHENTICATED_BLOCKED_TARGET',
 plan_read_id:id(5),semantic_digest:'1'.repeat(64),backend_principal_digest:'2'.repeat(64),rendered_digest:delivery.targetDigest,
 service_date:context.serviceDate,intent_id:delivery.intentId,target_digest:delivery.targetDigest,target,device_pk:id(1),canonical_device_id:'KIOSK_08',employee_id:id(3),credential_id:id(2),assignment_epoch:'7',
 observed_at:'2026-10-22T12:00:00.000001Z',valid_until:'2026-10-23T05:00:00.000000Z',
 notification_state:{notifications_silent:true,silent_reason:'blocked_recurring_authority',override_enabled:false},accepted_lunch_intents:[],required_effects:[],required_audio:[],source_counts:{accepted_lunch_intents:0,current_assigned_locations:0}};
const wrap=body=>{const bodyJsonText=JSON.stringify(body);return {schema:'custodial.recurring-current-notification-plan-envelope.v1',body,bodyJsonText,bodyDigest:createHash('sha256').update(bodyJsonText).digest('hex')};};
let checks=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
eq(validateRecurringNotificationPlan(wrap(body),context),wrap(body),'explicit genuine-shape EMPTY/BLOCKED DATA positive');
for(const [label,mutate]of [
 ['token wrong UUID',x=>x.plan_read_id='KIOSK_08'],['missing token',x=>delete x.plan_read_id],['missing semantic digest',x=>delete x.semantic_digest],
 ['changed rendered digest',x=>x.rendered_digest='9'.repeat(64)],['missing complete',x=>delete x.complete],['false coverage',x=>x.complete=false],['extra root',x=>x.extra=true],
 ['different target',x=>x.target={...x.target,assignmentEpoch:8}],['different digest',x=>x.target_digest='b'.repeat(64)],
 ['wrong UUID',x=>x.device_pk=id(99)],['label not UUID',x=>x.device_pk='KIOSK_08'],['wrong credential',x=>x.credential_id=id(99)],
 ['epoch number',x=>x.assignment_epoch=7],['unsafe count',x=>x.source_counts.current_assigned_locations=9007199254740992],
 ['overflow count',x=>x.source_counts.current_assigned_locations=1025],['wrong service day',x=>x.service_date='2026-10-23'],
 ['bad Gregorian instant',x=>x.valid_until='2026-02-31T12:00:00.000000Z'],['same microsecond expiry',x=>x.valid_until=x.observed_at],
 ['earlier fractional expiry',x=>x.valid_until='2026-10-22T12:00:00.000000Z'],['missing audio set',x=>delete x.required_audio],
 ['blocked nonempty',x=>{x.required_effects=[{origin:'FULL_ACCEPTED_LUNCH_DOCUMENT',notification_key:'fake',required_audio:true}];x.required_audio=['fake'];}],
 ]){const value=structuredClone(body);mutate(value);eq(validateRecurringNotificationPlan(wrap(value),context),null,label);}
const changed=wrap(body);changed.bodyDigest='0'.repeat(64);eq(validateRecurringNotificationPlan(changed,context),null,'wire digest differs');
let calls=0;const assignment={canonical_device_pk:id(1),canonical_device_id:'KIOSK_08',assigned_employee_id:id(3),assignment_epoch:7};
const options={delivery:{mode:'RECURRING_TERMINAL',delivery},serviceDate:context.serviceDate,assignment,credentialId:id(2),runRpc:async(name,args)=>{
 calls++;eq(name,'static_weekly_v27_issue_recurring_notification_plan','fixed read RPC');eq(args,{p_date:context.serviceDate,p_device:id(1),p_credential:id(2),p_employee:id(3),p_epoch:7,p_intent:id(4),p_target_digest:'a'.repeat(64)},'exact original tuple');return wrap(body);}};
eq(await readRecurringNotificationPlan(options),wrap(body),'reader returns validated plan');
const before=JSON.stringify(options.delivery);const absent=await readRecurringNotificationPlan({...options,runRpc:async()=>{throw Error('private SQL unavailable');}});
eq([absent.complete,absent.receipt_eligible],[false,false],'RPC failure is unavailable, never empty');eq(JSON.stringify(options.delivery),before,'old target digest/shape unchanged');
eq((await readRecurringNotificationPlan({...options,credentialId:'invalid'})).complete,false,'invalid principal never reads');eq(calls,1,'only supported fixed read called');
for(const value of ['2026-10-22T12:01:02Z','2026-10-22T12:01:02.123Z','2026-10-22T12:01:02.123456Z'])eq(exactPlanReceiptInstant(value),true,'exact receipt instant '+value);
for(const value of [null,1,'2026-02-31T12:00:00Z','2026-10-22T24:00:00Z','2026-10-22 12:00:00','2026-10-22T12:00:00+00:00','2026-10-22T12:00:00.1Z'])eq(exactPlanReceiptInstant(value),false,'noncanonical receipt instant refused');
// Genuine full-source shape, including nonempty required effect/audio. This is
// DATA schema coverage, not a claim that native audio or OS work completed.
const scheduled=structuredClone(body);scheduled.source='FULL_ACCEPTED_LUNCH_AND_EXHAUSTIVE_CURRENT_LOCATION_DERIVATION';
scheduled.target={...scheduled.target,targetType:'SCHEDULE',viewDigest:'c'.repeat(64)};scheduled.rendered_digest='c'.repeat(64);
scheduled.required_effects=[{origin:'FULL_ACCEPTED_LUNCH_DOCUMENT',notification_key:'lunch:one',required_audio:true,
 notification:{title:'Lunch coverage starts now',body:'Synthetic required spoken coverage',data:{kind:'employee_lunch_coverage',notification_type:'lunch_coverage',notification_key:'lunch:one',service_date:context.serviceDate,
 receipt_employee_id:id(3),receipt_credential_id:id(2),receipt_device_id:'KIOSK_08',receipt_assignment_epoch:'7'}}}];
scheduled.required_audio=['lunch:one'];const scheduledContext={...context,delivery:{...delivery,target:scheduled.target,viewDigest:'c'.repeat(64)}};
eq(validateRecurringNotificationPlan(wrap(scheduled),scheduledContext),wrap(scheduled),'full nonempty current plan schema positive');
const duplicate=structuredClone(scheduled);duplicate.required_effects.push(structuredClone(duplicate.required_effects[0]));duplicate.required_audio.push('lunch:one');
eq(validateRecurringNotificationPlan(wrap(duplicate),scheduledContext),null,'duplicate complete-plan effect refused');
const missingAudio=structuredClone(scheduled);missingAudio.required_audio=[];eq(validateRecurringNotificationPlan(wrap(missingAudio),scheduledContext),null,'omitted required audio refused');
console.log(JSON.stringify({ok:true,checks,scope:'pure DATA/server contract checks; no SQL, normal publication, native or send proof'}));
