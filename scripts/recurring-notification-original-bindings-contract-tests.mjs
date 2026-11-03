// Pure DATA codec tests only; no database/native owner/effect/receipt grant.
import assert from 'node:assert/strict';
import {createHash}from'node:crypto';
import {validateRecurringNotificationPlan}from'../src/recurring-notification-plan.js';
const id=n=>`98000000-0000-4000-8000-${String(n).padStart(12,'0')}`,hash=value=>createHash('sha256').update(value).digest('hex');
const context={serviceDate:'2026-10-22',devicePk:id(1),deviceId:'KIOSK_08',employeeId:id(2),credentialId:id(3),epoch:7};
const target={targetType:'SCHEDULE',serviceDate:context.serviceDate,employeeId:id(2),deviceId:id(1),credentialId:id(3),assignmentEpoch:7,viewDigest:'a'.repeat(64)};
context.delivery={intentId:id(4),targetDigest:'b'.repeat(64),target,viewDigest:'a'.repeat(64)};
const nativeSpeech='The actual immutable native job words differ from normal location wording.';
const normalData={kind:'employee_location_status',notification_key:'location:complete:one',service_date:context.serviceDate,
 receipt_employee_id:id(2),receipt_credential_id:id(3),receipt_device_id:context.deviceId,receipt_assignment_epoch:'7'};
const binding={notification_key:normalData.notification_key,receipt_job_id:id(5),generation_id:id(6),registration_id:id(7),
 principal_digest:'c'.repeat(64),token_digest:'d'.repeat(64),reservation_at:'2026-10-22T12:00:00.000000Z',valid_until:'2026-10-22T12:01:00.000000Z',
 content_sha256:'e'.repeat(64),native_kind:'employee_location_status',audio_origin:'ORIGINAL_NATIVE_JOB',speech_sha256:hash(nativeSpeech)};
const body={schema:'custodial.recurring-current-notification-plan.v2',complete:true,receipt_eligible:false,
 scope:'CURRENT_PRESENTATION_AND_FULL_EFFECTS_REQUIRED_BY_ACCEPTED_TARGET_NOT_FUTURE_ALARM_INVENTORY',source:'FULL_ACCEPTED_LUNCH_AND_EXHAUSTIVE_CURRENT_LOCATION_DERIVATION',
 plan_read_id:id(8),semantic_digest:'1'.repeat(64),backend_principal_digest:'2'.repeat(64),rendered_digest:target.viewDigest,
 service_date:context.serviceDate,intent_id:context.delivery.intentId,target_digest:context.delivery.targetDigest,target,
 device_pk:id(1),canonical_device_id:context.deviceId,employee_id:id(2),credential_id:id(3),assignment_epoch:'7',
 observed_at:'2026-10-22T12:00:00.000001Z',valid_until:'2026-10-22T12:01:00.000000Z',
 notification_state:{notifications_silent:false,silent_reason:'',override_enabled:false},accepted_lunch_intents:[],
 required_effects:[{origin:'EXHAUSTIVE_NORMAL_CURRENT_LOCATION_CYCLES',notification_key:normalData.notification_key,required_audio:true,data:normalData}],
 required_audio:[normalData.notification_key],source_counts:{accepted_lunch_intents:0,current_assigned_locations:1},
 delivery_bindings:{schema:'custodial.recurring-original-native-delivery-bindings.v1',state:'ORIGINAL_NATIVE_RESERVATIONS',entries:[binding]}};
const wrap=value=>{const bodyJsonText=JSON.stringify(value);return{schema:value.schema.endsWith('.v2')?'custodial.recurring-current-notification-plan-envelope.v2':'custodial.recurring-current-notification-plan-envelope.v1',body:value,bodyJsonText,bodyDigest:hash(bodyJsonText)};};
let checks=0;const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
eq(validateRecurringNotificationPlan(wrap(body),context),wrap(body),'explicit nonempty v2 binding DATA positive; no actual native authority');
const unavailable=structuredClone(body);unavailable.delivery_bindings={schema:body.delivery_bindings.schema,state:'UNAVAILABLE',entries:[]};
eq(validateRecurringNotificationPlan(wrap(unavailable),context),wrap(unavailable),'explicit unavailable stays distinguishable from empty obligations');
for(const[label,mutate]of[
 ['missing bindings',x=>delete x.delivery_bindings],['null bindings',x=>x.delivery_bindings=null],['extra binding root',x=>x.delivery_bindings.extra=true],
 ['unknown binding schema',x=>x.delivery_bindings.schema='arbitrary'],['unknown binding state',x=>x.delivery_bindings.state='READY'],
 ['unavailable with entries',x=>x.delivery_bindings.state='UNAVAILABLE'],['missing entry',x=>x.delivery_bindings.entries=[]],
 ['extra entry',x=>x.delivery_bindings.entries.push(structuredClone(binding))],['missing key',x=>delete x.delivery_bindings.entries[0].notification_key],
 ['different key',x=>x.delivery_bindings.entries[0].notification_key='other'],['extra secret',x=>x.delivery_bindings.entries[0].receipt_token='must-never-be-projected'],
 ['extra payload',x=>x.delivery_bindings.entries[0].original_payload={}],['nonstring job',x=>x.delivery_bindings.entries[0].receipt_job_id=7],
 ['invalid job',x=>x.delivery_bindings.entries[0].receipt_job_id='KIOSK_08'],['uppercase generation',x=>x.delivery_bindings.entries[0].generation_id=id(6).replace('98000000','ABCDEF00')],
 ['invalid registration',x=>x.delivery_bindings.entries[0].registration_id=''],['malformed principal',x=>x.delivery_bindings.entries[0].principal_digest='0'],
 ['malformed token digest',x=>x.delivery_bindings.entries[0].token_digest='NOT_TOKEN'],['malformed content',x=>x.delivery_bindings.entries[0].content_sha256=1],
 ['unknown kind',x=>x.delivery_bindings.entries[0].native_kind='employee_message'],['mismatched kind',x=>x.delivery_bindings.entries[0].native_kind='employee_lunch_coverage'],
 ['browser audio origin',x=>x.delivery_bindings.entries[0].audio_origin='BROWSER_COMPLETED'],['missing speech digest',x=>delete x.delivery_bindings.entries[0].speech_sha256],
 ['numeric speech digest',x=>x.delivery_bindings.entries[0].speech_sha256=7],['bad date',x=>x.delivery_bindings.entries[0].reservation_at='2026-02-31T00:00:00.000000Z'],
 ['unqualified timezone',x=>x.delivery_bindings.entries[0].valid_until='2026-10-22T12:01:00+00:00'],['future original reservation',x=>x.delivery_bindings.entries[0].reservation_at='2026-10-22T12:00:00.000002Z'],
 ['expired original',x=>x.delivery_bindings.entries[0].valid_until=x.observed_at],['body outlives original',x=>x.valid_until='2026-10-22T12:01:00.000001Z'],
 ['unsafe body epoch',x=>x.assignment_epoch=9007199254740992],['v2 empty omission',x=>{x.required_effects=[];x.required_audio=[];x.delivery_bindings.entries=[];}],
]){const copy=structuredClone(body);mutate(copy);eq(validateRecurringNotificationPlan(wrap(copy),context),null,label);}
const lexical=structuredClone(body);lexical.required_effects[0].data={...normalData,body:'Actual normal formatter words are independent.'};
eq(validateRecurringNotificationPlan(wrap(lexical),context),wrap(lexical),'normal location words are not equated to native speech hash');
const sameJob=structuredClone(body);sameJob.required_effects.push({...sameJob.required_effects[0],notification_key:'second',data:{...normalData,notification_key:'second'}});sameJob.required_audio.push('second');sameJob.delivery_bindings.entries.push({...binding,notification_key:'second'});
eq(validateRecurringNotificationPlan(wrap(sameJob),context),null,'one original job cannot be adopted for two different effect keys');
const badWire=wrap(body);badWire.bodyDigest='0'.repeat(64);eq(validateRecurringNotificationPlan(badWire,context),null,'changed wire hash refuses');
const wrongEnvelope=wrap(body);wrongEnvelope.schema='custodial.recurring-current-notification-plan-envelope.v1';eq(validateRecurringNotificationPlan(wrongEnvelope,context),null,'v2 body cannot use old envelope');
const old=structuredClone(body);old.schema='custodial.recurring-current-notification-plan.v1';delete old.delivery_bindings;
eq(validateRecurringNotificationPlan(wrap(old),context),wrap(old),'existing v1 behavior remains compatible; native v1 EMPTY eligibility unchanged separately');
console.log(JSON.stringify({ok:true,checks,scope:'pure v2 metadata DATA; no SQL/native/OS/audio/receipt authority'}));
