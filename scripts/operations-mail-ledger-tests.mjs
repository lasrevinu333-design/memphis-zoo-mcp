import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {recordOperationsMail,readOperationsMailLedger,projectOperationsMailRows} from '../src/operations-mail-ledger.js';
import {makeOperationsBoardHandler} from '../src/operations-board.js';
import {SCHOOL_HEADERS} from '../src/operations-mail-contract.js';
const at='2026-10-05T12:00:00Z';
const source=(id='m1',time=at,sender='help@memzoomaint.on.spiceworks.com')=>({mailbox:'eoperle@memphiszoo.org',sender,message_id:id,content_sha256:'a'.repeat(64),source_at:time});
const ticket=(id='m1',time=at,change_lines=['set category to Custodial','changed status from Closed -> Open'])=>({source:source(id,time),ticket_id:'6914',title:'Synthetic gate',change_lines});
const school=(id='s1',time=at,rows=[[123,'Synthetic school',1,'Field Trip Elem Student 1-5','2026-10-05','09:00',20],[null,null,null,'Field Trip Paid Chaperone',null,null,2]])=>({source:source(id,time,'aferguson@memphiszoo.org'),attachment:{id:'att1',sha256:'b'.repeat(64)},headers:[...SCHOOL_HEADERS],rows,complete_for_dates:['2026-10-05']});
function fixture(){
 const rows=[],requests=[];let fault=null,cap=null,next=0;
 const client=createClient('https://synthetic.example.invalid','not-a-real-service-credential',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,init={})=>{
  const u=new URL(url),method=init.method||'GET',headers=new Headers(init.headers);requests.push({method,url:u.toString(),prefer:headers.get('prefer'),signal:!!init.signal});
  assert.equal(u.origin,'https://synthetic.example.invalid');
  if(u.pathname.startsWith('/rest/v1/rpc/')){
   const name=u.pathname.split('/').at(-1);assert.ok(['custodial_begin_application_mutation_lease','custodial_release_application_mutation_lease'].includes(name));
   if(fault==='release-denied'&&name.includes('release'))return new Response(JSON.stringify({message:'PRIVATE'}),{status:503,headers:{'content-type':'application/json'}});
   const data=name.includes('begin')?{mutations_paused:fault==='restore-paused',authority_generation:1}:true;
   return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
  }
  assert.equal(u.pathname,'/rest/v1/events_app_outlook_sync');
  if(fault==='transport')throw Error('PRIVATE transport detail');
  if(fault==='denied')return new Response(JSON.stringify({message:'PRIVATE database error'}),{status:403,headers:{'content-type':'application/json'}});
  if(method==='POST'){
   assert.equal(u.searchParams.get('on_conflict'),'outlook_message_id,source_event_key');assert.match(headers.get('prefer'),/resolution=ignore-duplicates/);
   const row=JSON.parse(init.body),found=rows.find(r=>r.outlook_message_id===row.outlook_message_id&&r.source_event_key===row.source_event_key);
   if(!found)rows.push({...row,id:`fixture-${++next}`,created_at:'2026-10-05T12:01:00Z'});
   if(fault==='lost-write-ack')throw Error('PRIVATE lost response');return new Response(null,{status:201});
  }
  assert.equal(method,'GET');assert.ok(init.signal);
  const single=u.searchParams.has('outlook_message_id');
  let data=rows.filter(row=>single?`eq.${row.outlook_message_id}`===u.searchParams.get('outlook_message_id')&&`eq.${row.source_event_key}`===u.searchParams.get('source_event_key'):row.source_event_key.startsWith('custodial-operations-v1/'));
  if(!single){assert.equal(u.searchParams.get('source_event_key'),'like.custodial-operations-v1/%');assert.match(headers.get('prefer'),/count=exact/);}
  const count=data.length;if(cap!==null&&!single)data=data.slice(0,cap);
  if(fault==='readback-tamper')data=data.map(row=>({...row,payload_hash:'f'.repeat(64)}));
  return new Response(JSON.stringify(single?data[0]:data),{status:200,headers:{'content-type':'application/json','content-range':`0-${Math.max(0,data.length-1)}/${fault==='missing-count'?'*':count}`}});
 }}});
 return {client,rows,requests,setFault:x=>{fault=x;},setCap:x=>{cap=x;},save:(kind,observation)=>recordOperationsMail({client,kind,observation})};
}
test('actual SDK insert-ignore and saved readback bind exact source; duplicate is unchanged',async()=>{
 const f=fixture(),a=await f.save('spiceworks',ticket()),b=await f.save('spiceworks',ticket());
 assert.deepEqual(a,b);assert.equal(f.rows.length,1);assert.equal(a.state,'SAVED_READBACK');assert.equal(a.mailbox_completeness_verified,false);
 assert.equal(f.rows[0].event_id,null);assert.equal(f.rows[0].source_subject,null);assert.equal(f.rows[0].sync_note,null);
 assert.ok(f.requests.every(r=>r.signal));
});
test('conflicting retry cannot overwrite original observation',async()=>{
 const f=fixture();await f.save('spiceworks',ticket());const original=structuredClone(f.rows);
 await assert.rejects(f.save('spiceworks',{...ticket(),title:'changed same message'}),/replay_conflict/);assert.deepEqual(f.rows,original);
});
test('lost write acknowledgment is unknown; same-source retry resolves without duplication',async()=>{
 const f=fixture();f.setFault('lost-write-ack');await assert.rejects(f.save('spiceworks',ticket()),/write_unconfirmed|write_outcome_unknown/);
 assert.equal(f.rows.length,1);f.setFault(null);assert.equal((await f.save('spiceworks',ticket())).state,'SAVED_READBACK');assert.equal(f.rows.length,1);
});
test('unauthenticated source shape and raw mail fields are refused before I/O',async()=>{
 const f=fixture();for(const observation of [null,{...ticket(),body:'private body'},{...ticket(),source:{...ticket().source,sender:'other@example.invalid'}},{...ticket(),source:{...ticket().source,headers:{authorization:'not allowed'}}}])
  await assert.rejects(f.save('spiceworks',observation));assert.equal(f.requests.length,0);
});
test('input mutation during await cannot change the persisted observation',async()=>{
 const f=fixture(),input=ticket(),promise=f.save('spiceworks',input);input.title='mutated';input.source.message_id='different';await promise;
 assert.equal(f.rows[0].source_payload.observation.title,'Synthetic gate');assert.equal(f.rows[0].outlook_message_id,'m1');
});
test('existing restore lease blocks paused imports and brackets successful readback',async()=>{
 const f=fixture();f.setFault('restore-paused');await assert.rejects(f.save('spiceworks',ticket()),/mutation_unavailable/);
 assert.equal(f.rows.length,0);assert.equal(f.requests.length,1);
 f.setFault(null);await f.save('spiceworks',ticket());assert.match(f.requests[1].url,/custodial_begin_application_mutation_lease/);
 assert.match(f.requests.at(-1).url,/custodial_release_application_mutation_lease/);
});
test('unconfirmed restore-lease release retains request identity and is not a successful import receipt',async()=>{
 const f=fixture();f.setFault('release-denied');await assert.rejects(f.save('spiceworks',ticket()),error=>{
  assert.equal(error.message,'operations_mail_cleanup_unconfirmed');assert.match(error.request_id,/^[a-f0-9-]{36}$/);return true;
 });assert.equal(f.rows.length,1);
});
test('database denial and poisoned readback are not successful persistence',async()=>{
 for(const fault of ['denied','readback-tamper']){const f=fixture();f.setFault(fault);await assert.rejects(f.save('spiceworks',ticket()),error=>!error.message.includes('PRIVATE'));}
});
test('durable out-of-order close/reopen/assignment observations survive a new reader instance',async()=>{
 const f=fixture();await f.save('spiceworks',ticket('new','2026-10-05T14:00:00Z',['changed status from Closed -> Open']));
 await f.save('spiceworks',ticket('old',at));await f.save('spiceworks',ticket('close','2026-10-05T13:00:00Z',['changed status from Open -> Closed']));
 const a=await readOperationsMailLedger({client:f.client});assert.equal(a.spiceworks.state,'snapshot');assert.equal(a.spiceworks.rows[0].active,true);
 await f.save('spiceworks',ticket('reassign','2026-10-05T15:00:00Z',['set category to Maintenance']));
 const b=await readOperationsMailLedger({client:f.client});assert.equal(b.spiceworks.rows[0].custodial,false);assert.equal(b.spiceworks.mailbox_completeness_verified,false);
});
test('partial response or missing count cannot omit closure and look current',async()=>{
 const f=fixture();await f.save('spiceworks',ticket());await f.save('spiceworks',ticket('close','2026-10-05T13:00:00Z',['changed status from Open -> Closed']));
 f.setCap(1);let result=await readOperationsMailLedger({client:f.client});assert.equal(result.spiceworks.reason,'operations_mail_snapshot_incomplete');assert.deepEqual(result.spiceworks.rows,[]);
 f.setCap(null);f.setFault('missing-count');result=await readOperationsMailLedger({client:f.client});assert.equal(result.schools.state,'unavailable');
});
test('no imported record is unavailable, not a live zero or empty mailbox',async()=>{
 const f=fixture(),result=await readOperationsMailLedger({client:f.client});assert.equal(result.schools.state,'unavailable');assert.equal(result.spiceworks.state,'unavailable');
 assert.equal((await readOperationsMailLedger()).schools.reason,'operations_mail_service_not_configured');
});
test('raw ledger source identities and email payload never leave the projection',async()=>{
 const f=fixture();await f.save('spiceworks',ticket());await f.save('school',school());const result=await readOperationsMailLedger({client:f.client});
 assert.doesNotMatch(JSON.stringify(result),/message_id|outlook_message|content_sha256|source_payload|memphiszoo\.org|change_lines|attachment_id/);
 assert.match(result.schools.rows[0].source_revision,/^[a-f0-9]{64}$/);assert.equal(result.schools.rows[0].departure_at,null);assert.equal(result.schools.rows[0].departure_source,null);
});
test('school corrections and absence from explicit complete lists reconcile; old import cannot resurrect',async()=>{
 const f=fixture();await f.save('school',school('new','2026-10-05T14:00:00Z',[]));await f.save('school',school());
 const result=await readOperationsMailLedger({client:f.client});assert.equal(result.schools.rows[0].status,'CANCELLED');
});
test('multiple attachments from one message have distinct stable keys',async()=>{
 const f=fixture(),a=school(),b=school();b.attachment.id='att2';b.complete_for_dates=['2026-10-06'];b.rows[0][4]='2026-10-06';
 await f.save('school',a);await f.save('school',b);assert.equal(f.rows.length,2);assert.notEqual(f.rows[0].source_event_key,f.rows[1].source_event_key);
 assert.equal((await readOperationsMailLedger({client:f.client})).schools.rows.length,2);
});
test('binding corruption, wrong status and duplicate records fail closed',async()=>{
 const f=fixture();await f.save('spiceworks',ticket());const row=f.rows[0];
 for(const patch of [{event_id:'foreign'},{outlook_message_id:'other'},{payload_hash:'f'.repeat(64)},{source_event_key:'other'},{sync_status:'ERROR'},{created_at:'yesterday'}])assert.throws(()=>projectOperationsMailRows([{...row,...patch}]));
 assert.throws(()=>projectOperationsMailRows([row,row]),/duplicate/);
});
test('named manager only: unauthorized requests never read mail; projection failure does not hide Events',async()=>{
 let reads=0;const handler=makeOperationsBoardHandler({readEvents:async()=>[],readMail:async()=>{reads++;throw Error('PRIVATE');}});
 const response=()=>({status(n){this.code=n;return this;},setHeader(){},json(data){this.body=data;return this;}});
 const denied=response();await handler({memphisAuth:{role:'employee'}},denied);assert.equal(denied.code,403);assert.equal(reads,0);
 const ok=response();await handler({memphisAuth:{role:'ops_manager',manager_id:'m',credential_id:'c'}},ok);assert.equal(ok.code,200);assert.equal(reads,1);assert.equal(ok.body.data.schools.state,'unavailable');assert.equal(ok.body.data.school_departure_policy,null);assert.doesNotMatch(JSON.stringify(ok.body),/PRIVATE/);
});
test('bootstrap uses the existing service client and manager gate; no new ingestion route or grant',()=>{
 const index=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');assert.match(index,/app\.get\("\/dashboard-api\/operations", requireOpsManagerAuth,[\s\S]{0,220}readMail: \(\) => readOperationsMailLedger\(\{client:supabaseAdmin\}\)/);
 assert.doesNotMatch(index,/app\.post\([^\n]*(?:operations|outlook)/);assert.doesNotMatch(index,/recordOperationsMail/);
});
