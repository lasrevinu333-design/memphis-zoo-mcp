import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateNativeProviderEventsRequest as request,validateNativeProviderEventsResponse as response} from '../src/native-provider-events.js';
const id=n=>`55000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const e={schema:'custodial.native-provider-event.v2',event_id:id(1),generation_id:id(2),receipt_job_id:id(3),notification_key:'synthetic-location-key',
 action:'received',receipt_credential_id:id(4),receipt_employee_id:id(5),receipt_device_id:'KIOSK_08',receipt_assignment_epoch:1,
 principal_digest:'a'.repeat(64),token_digest:'b'.repeat(64),content_sha256:'c'.repeat(64),admission_bounds:{earliest_at:'2026-10-02T15:00:02.123456Z',latest_at:'2026-10-02T15:00:02.123456Z',clock_profile_id:'SYNTHETIC_ONLY_PC01',elapsed_realtime_ms:150,boot_count:1},
 original_observation:{earliest_at:null,latest_at:null,clock_profile_id:null,boot_count:null,elapsed_realtime_ms:null}};
e.record_id=createHash('sha256').update(e.generation_id+'\n'+e.receipt_job_id+'\n'+e.notification_key).digest('hex');
const batch=events=>({schema:'custodial.native-provider-events.v2',events});
const envelope=results=>({ok:true,data:{schema:'custodial.native-provider-event-receipts.v2',results}});
const accepted={...e,schema:'custodial.native-provider-event-receipt.v2',admitted_state:'ACCEPTED',server_received_at:'2026-10-02T15:00:04.123456Z',replayed:false};
let checks=0;
const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
check('exact unknown original observation retained',()=>assert.deepEqual(request(batch([e])),batch([e])));
check('deep frozen request across async SQL',()=>{const b=batch([structuredClone(e)]),r=request(b);b.events[0].original_observation.boot_count=10;assert.equal(r.events[0].original_observation.boot_count,null);assert.ok(Object.isFrozen(r.events[0].original_observation));});
for(const [field,value] of [['action','dismissed'],['schema','other'],['event_id',1],['generation_id',null],['record_id','d'.repeat(64)],['receipt_assignment_epoch','1'],['receipt_assignment_epoch',0],
 ['receipt_device_id','KIOSK_01'],['notification_key','newline\n'],['admission_bounds','2026-02-30T01:00:00.000000Z'],['admission_bounds','2026-10-02T15:00:02.123Z'],['extra',true],
 ['original_observation',{...e.admission_bounds,boot_count:null,elapsed_realtime_ms:1}],['original_observation',{earliest_at:null,latest_at:null,clock_profile_id:null,boot_count:2147483648,elapsed_realtime_ms:0}],
 ['original_observation',{earliest_at:null,latest_at:null,clock_profile_id:null,boot_count:1,elapsed_realtime_ms:1.5}],['original_observation',{earliest_at:null,latest_at:null,clock_profile_id:null,boot_count:1,elapsed_realtime_ms:0,extra:true}]])
 check('strict event '+field+' '+JSON.stringify(value),()=>assert.throws(()=>request(batch([{...e,[field]:value}]))));
for(const b of [batch([]),batch(Array.from({length:17},()=>e)),batch([e,e]),batch([e,{...e,event_id:id(9)}]),{...batch([e]),extra:true},batch([e,{...e,event_id:id(8),action:'opened',receipt_employee_id:id(7)}])])
 check('strict batch '+JSON.stringify(b).length,()=>assert.throws(()=>request(b)));
check('display requires qualified observation value',()=>assert.throws(()=>request(batch([{...e,action:'displayed'}]))));
check('exact admitted response',()=>assert.deepEqual(response(envelope([accepted]),batch([e])),envelope([accepted])));
check('missing result stays empty pending',()=>assert.deepEqual(response(envelope([]),batch([e])).data.results,[]));
check('bounded rejected result stays rejected',()=>assert.equal(response(envelope([{event_id:e.event_id,admitted_state:'REJECTED',code:'native_provider_transition_pending'}]),batch([e])).data.results[0].admitted_state,'REJECTED'));
for(const k of Object.keys(accepted))check('every exact receipt field '+k,()=>assert.throws(()=>response(envelope([{...accepted,[k]:'invalid'}]),batch([e]))));
for(const v of [envelope([accepted,accepted]),envelope([{...accepted,event_id:id(9)}]),envelope([{...accepted,extra:true}]),
 envelope([{...accepted,server_received_at:'2026-10-02T15:00:02.123455Z'}]),envelope([{...accepted,original_observation:{...e.original_observation,boot_count:1}}]),
 {ok:false,data:envelope([]).data},envelope([{event_id:e.event_id,admitted_state:'REJECTED',code:'secret'}])])
 check('invalid response stays pending '+JSON.stringify(v).length,()=>assert.throws(()=>response(v,batch([e]))));
for(const original of [
 {...e.admission_bounds,earliest_at:null}, {...e.original_observation,clock_profile_id:'claimed'},
 {...e.admission_bounds,latest_at:'2026-10-02T15:00:02.123455Z'},
 {...e.admission_bounds,clock_profile_id:'a'.repeat(129)},
 {...e.admission_bounds,boot_count:null},
 {authenticated_at:e.admission_bounds.earliest_at,boot_count:1,elapsed_realtime_ms:150}])
 check('strict interval fields remain explicit',()=>assert.throws(()=>request(batch([{...e,original_observation:original}]))));
check('original point batch rejected',()=>assert.throws(()=>request({...batch([e]),schema:'custodial.native-provider-events.v1'})));
check('admission interval frozen across async SQL',()=>{const b=batch([structuredClone(e)]),v=request(b);b.events[0].admission_bounds.latest_at='changed';assert.equal(v.events[0].admission_bounds.latest_at,e.admission_bounds.latest_at);});
console.log(JSON.stringify({status:'PASS',checks,sourceOnly:true,providerClock:false,delivery:false}));
