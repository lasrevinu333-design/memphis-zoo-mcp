import assert from 'node:assert/strict';
import test from 'node:test';
import {createMemphisResponder} from '../src/memphis-ai.js';
import {getGeminiEnvOrder} from '../src/utils/gemini-config.js';

// Real responder, synthetic database adapter; no external model or database.
for (const name of getGeminiEnvOrder()) delete process.env[name];
globalThis.fetch = async () => { throw Error('Unexpected external request'); };
const E='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const base={event_scope:'SINGLE_VENUE',status:'SCHEDULED',needs_review:false,place_admissible:true,
  event_date:'2026-11-01',end_date:'2026-11-01',display_location:'Synthetic venue',
  start_time:'10:00:00',end_time:'11:00:00',attendee_count:0};
const rows=[
  {...base,event_name:'General event',audience_scope:'all_working_employees'},
  {...base,event_name:'Assigned location event',audience_scope:'assigned_location'},
  {...base,event_name:'Own addressed event',audience_scope:'specific_employees',audience_employee_ids:[E]},
  {...base,event_name:'OTHER EMPLOYEE PRIVATE EVENT',audience_scope:'specific_employees',audience_employee_ids:[OTHER]},
  {...base,event_name:'UNRESOLVED AUDIENCE',audience_scope:null},
];
function fixture({role='employee',active=true,result=rows}={}) {
  const reads=[],writes=[];
  const responder=createMemphisResponder({runReadOnlySql:async sql=>{
    reads.push(sql);
    if(sql.includes('msg_get_user_by_device'))return[{role,display_name:'Synthetic employee'}];
    if(sql.includes('from public.devices d'))return[{assigned_employee_id:E,device_active:active,employee_active:active}];
    if(sql.includes('sch_service_date'))return[{service_date:'2026-10-31'}];
    if(sql.includes('from public.events_app_events')){
      if(result instanceof Error)throw result;
      return result;
    }
    return[];
  },runRpc:async(name,args)=>{writes.push({name,args});return null;}});
  return {reads,writes,reply:()=>responder.generateReply({deviceId:'SYNTHETIC_PHONE',userMessage:'What events are coming up?'})};
}
test('employee Events answer applies same audience restriction as shared page',async()=>{
  const f=fixture(),r=await f.reply();
  assert.match(r.text,/General event/);assert.match(r.text,/Assigned location event/);assert.match(r.text,/Own addressed event/);
  assert.doesNotMatch(r.text,/OTHER EMPLOYEE PRIVATE EVENT|UNRESOLVED AUDIENCE/);
  const sql=f.reads.find(s=>s.includes('from public.events_app_events'));
  assert.match(sql,/e\.audience_scope/);assert.match(sql,/e\.audience_employee_ids/);assert.ok(sql.includes(E));
  assert.equal(f.writes.length,0);
});
test('manager Events answer retains manager visibility',async()=>{
  const f=fixture({role:'manager'}),r=await f.reply();
  assert.match(r.text,/OTHER EMPLOYEE PRIVATE EVENT/);assert.match(r.text,/Own addressed event/);
});
for(const options of [{role:''},{role:'employee',active:false}])test('unresolved or inactive employee cannot read addressed events '+JSON.stringify(options),async()=>{
  const f=fixture(options),r=await f.reply();
  assert.doesNotMatch(r.text,/Own addressed event|OTHER EMPLOYEE PRIVATE EVENT|UNRESOLVED AUDIENCE/);
});
test('published event snapshot discloses completeness uncertainty and retrieval time',async()=>{
  const r=await fixture().reply();
  assert.match(r.text,/Outlook collection completeness is not verified/);
  assert.match(r.text,/records checked/);assert.ok(Number.isFinite(Date.parse(r.meta.source_checked_at)));
  assert.equal(r.meta.mailbox_completeness_verified,false);assert.equal(r.meta.source_state,'snapshot');
});
for(const result of [null,{},new Error('PRIVATE SQL OR PROVIDER DETAILS')])test('missing or failed event source is unavailable, never empty '+String(result),async()=>{
  const r=await fixture({result}).reply();
  assert.match(r.text,/couldn't verify.*event/i);
  assert.doesNotMatch(r.text,/PRIVATE|don't see any upcoming|No upcoming/);
  assert.equal(r.meta.source_state,'unavailable');
});
test('valid empty source remains an explicitly limited published snapshot',async()=>{
  const r=await fixture({result:[]}).reply();
  assert.match(r.text,/no upcoming events in the retrieved published records/i);
  assert.match(r.text,/Outlook collection completeness is not verified/);
});
