import assert from 'node:assert/strict';
import test from 'node:test';
import {createMemphisResponder} from '../src/memphis-ai.js';
import {getGeminiEnvOrder} from '../src/utils/gemini-config.js';
for(const key of getGeminiEnvOrder()) delete process.env[key];
process.env.MEMPHIS_GEMINI_API_KEY='synthetic-key-no-network';
let modelCalls=0;
globalThis.fetch=async()=>{modelCalls++;return{ok:true,json:async()=>({candidates:[{content:{parts:[{text:'FABRICATED LIVE WORK FACT'}]}}]})};};
function fixture({role='manager',snapshot={snapshot_at:'2026-10-31T12:00:00Z',overdue_locations:3}}={}){
  const reads=[];
  return{reads,reply:text=>createMemphisResponder({runReadOnlySql:async sql=>{
    reads.push(sql);
    if(sql.includes('msg_get_user_by_device'))return[{role}];
    if(sql.includes('sch_service_date'))return[{service_date:'2026-10-31'}];
    if(sql.includes('v_admin_health_snapshot'))return snapshot===null?[]:[snapshot];
    return[];
  },runRpc:async()=>null}).generateReply({deviceId:'SYNTHETIC_PHONE',userMessage:text})};
}
for(const text of ['What is overdue?','What is due soon?'])test('operational work status never escapes to general model: '+text,async()=>{
  const f=fixture(),before=modelCalls,r=await f.reply(text);
  assert.equal(modelCalls,before);assert.doesNotMatch(r.text,/FABRICATED/);assert.match(r.text,/3 overdue locations/);
  assert.match(r.text,/2026-10-31T12:00:00/);assert.ok(f.reads.some(sql=>sql.includes('v_admin_health_snapshot')));
});
test('employee operational question stays in existing role boundary without model facts',async()=>{
  const f=fixture({role:'employee'}),before=modelCalls,r=await f.reply('What is overdue?');
  assert.equal(modelCalls,before);assert.doesNotMatch(r.text,/FABRICATED|3 overdue/);
  assert.equal(f.reads.some(sql=>sql.includes('v_admin_health_snapshot')),false);
});
for(const snapshot of [null,{}, {overdue_locations:3}])test('missing unqualified dashboard snapshot never claims availability '+JSON.stringify(snapshot),async()=>{
  const r=await fixture({snapshot}).reply('Dashboard summary');
  assert.match(r.text,/cannot verify|can't verify|unavailable/i);
  assert.doesNotMatch(r.text,/snapshot is available|3 overdue/);
});
