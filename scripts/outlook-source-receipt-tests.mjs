import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {callOutlookEventSync,outlookSyncSchema,OUTLOOK_SYNC_CONTRACT} from '../src/outlook-event-sync.js';
import {SCHOOL_HEADERS} from '../src/operations-mail-contract.js';
import {registerOutlookEventTools} from '../src/mcp/outlook-event-tools.js';
import {configureMcpToolAuth} from '../src/mcp/register.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?'['+value.map(canonical).join(',')+']'
  :'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const sid='81000000-0000-4000-8000-000000000001',eid='82000000-0000-4000-8000-000000000001';
const message='synthetic-original-event-message';
const statusValue={schema:'custodial.outlook-event-sync.v1',writer_ready:true,mailbox:'eoperle@memphiszoo.org',
  cursor:null,checkpoint_at:null,last_import_at:null};
const auth=()=>({authInfo:{clientId:'synthetic-oauth-client',scopes:['mcp:read','mcp:write'],
  extra:{authSource:'self_contained_oauth',issuer:'https://issuer.invalid',subject:'synthetic-owner'}}});
const schoolSelector=()=>({kind:'school_attachment',original_source_read:true,attachment_read_complete:true,attachment_sha256:'b'.repeat(64)});
const eventSelector=()=>({kind:'event_notice',original_source_read:true,message_id:message});
const input=selector=>({contract_version:OUTLOOK_SYNC_CONTRACT,request:{action:'status',observation:{source_receipt:selector}}});
function schoolRow(){
  const observation={source:{mailbox:'eoperle@memphiszoo.org',sender:'aferguson@memphiszoo.org',
    message_id:'synthetic-stored-original-school-message',content_sha256:'a'.repeat(64),source_at:'2026-11-04T18:36:58Z'},
    attachment:{id:'synthetic-stored-original-attachment',sha256:'b'.repeat(64)},headers:[...SCHOOL_HEADERS],
    rows:[[100,'Synthetic school',1,'Field Trip Elem Student 1-5','2026-11-13','09:30',10],
      [null,null,null,'Field Trip Teacher',null,null,1],[null,null,null,null,null,null,11]],complete_for_dates:['2026-11-13']};
  const payload={schema:'custodial.operations-mail-record.v1',kind:'school',observation};
  return{id:sid,event_id:null,outlook_message_id:observation.source.message_id,
    source_event_key:'custodial-operations-v1/school/'+sha(observation.attachment.id),
    received_at:observation.source.source_at,created_at:'2026-11-11T03:29:10.947Z',
    payload_hash:sha(canonical(payload)),sync_status:'APPLIED',source_payload:payload};
}
const eventObservation=()=>({source:{mailbox:'eoperle@memphiszoo.org',message_id:message,content_sha256:'c'.repeat(64),
  evidence_kind:'original_event_notice',source_at:'2026-11-09T12:00:00Z',received_at:'2026-11-09T12:00:00Z',subject:'PRIVATE SUBJECT'},
  source_event_key:'synthetic-ended-event',event:{event_name:'Synthetic ended event',event_scope:'OFFSITE',
    event_date:'2026-11-11',end_date:'2026-11-11',start_time:'09:00:00',end_time:'10:00:00',
    start_instant_utc:'2026-11-11T15:00:00Z',end_instant_utc:'2026-11-11T16:00:00Z'}});
function eventRow({review=false}={}){
  const observation=eventObservation();
  if(review){delete observation.event;observation.reason='PRIVATE REVIEW DETAIL';}
  return{id:sid,event_id:review?null:eid,outlook_message_id:message,
    source_event_key:'custodial-outlook-events-v1/event/'+observation.source_event_key,
    payload_hash:'d'.repeat(64),sync_status:review?'NEEDS_REVIEW':'APPLIED',source_payload:observation,
    received_at:observation.source.received_at,created_at:'2026-11-11T03:32:28.292Z'};
}
const canonicalEvent=()=>({id:eid,revision:2,event_name:'Synthetic ended event',display_location:'Synthetic public venue',
  event_date:'2026-11-11',end_date:'2026-11-11',start_time:'09:00:00',end_time:'10:00:00',
  start_instant_utc:'2026-11-11T15:00:00Z',end_instant_utc:'2026-11-11T16:00:00Z',attendee_count:20,
  status:'SCHEDULED',audience_scope:'assigned_location',needs_review:false,custodial_public_notes:'Safe cleaning note.',
  notes:'PRIVATE MAIL',source_payload:{body:'PRIVATE RAW SOURCE'},access_note:'PRIVATE KEY',audience_employee_ids:['PRIVATE EMPLOYEE']});
function fixture({rows=[schoolRow()],events=[canonicalEvent()],patch={},eventPatch={},afterStatus=()=>{},afterSource=()=>{},afterCanonical=()=>{}}={}){
  const calls=[];
  const client={rpc(name,args){calls.push({rpc:name,args});assert.equal(name,'custodial_outlook_event_sync_v1');assert.equal(args.p_action,'status');
    return{abortSignal(signal){assert.ok(signal instanceof AbortSignal);return{retry(value){assert.equal(value,false);
      return Promise.resolve().then(()=>{afterStatus();return{data:structuredClone(statusValue),error:null};});}};}};},
  from(table){const call={table};calls.push(call);const q={
    select(columns,options){call.columns=columns;assert.deepEqual(options,{count:'exact'});return q;},
    like(key,value){call.like={key,value};return q;},contains(key,value){call.contains={key,value};return q;},
    eq(key,value){call.eq={key,value};return q;},in(key,value){call.in={key,value};return q;},
    order(key){assert.equal(key,'id');return q;},range(from,to){call.range=[from,to];return q;},
    abortSignal(signal){assert.ok(signal instanceof AbortSignal);call.signal=signal;return q;},
    retry(value){assert.equal(value,false);return Promise.resolve().then(async()=>{
      if(table==='events_app_outlook_sync'){await afterSource();return{data:structuredClone(rows),error:null,count:rows.length,...patch};}
      assert.fail('Direct event REST reads would bypass canonical place projection.');
    });},};return q;}};
  const readSql=async({sql})=>{calls.push({sql});assert.match(sql,/app_event_place_authority/);assert.match(sql,/e\.id in \(/);
    assert.match(sql,/order by e\.id limit 501/);await afterCanonical();
    return{ok:true,rowCount:events.length,row_limit_truncated:false,response_truncated:false,rows:structuredClone(events),...eventPatch};};
  return{client,calls,readSql};
}
const invoke=(f,selector=schoolSelector(),extra=auth(),options={})=>callOutlookEventSync(input(selector),extra,{client:f.client,
  sourceReceiptReaders:{now:()=>new Date('2026-11-14T08:00:00Z'),readSql:f.readSql},...options});

test('legacy status and the existing public selector retain their exact behavior without a private query',async()=>{
  const f=fixture();assert.deepEqual(await callOutlookEventSync({contract_version:OUTLOOK_SYNC_CONTRACT,request:{action:'status',observation:{}}},auth(),{client:f.client}),statusValue);
  assert.equal(f.calls.length,1);
});
test('exact workbook bytes recover the stored original provenance without claiming a forwarded copy has the same ID',async()=>{
  const f=fixture(),result=await invoke(f);assert.equal(result.source_receipt.state,'found');
  const r=result.source_receipt.records[0];assert.equal(r.ledger_id,sid);assert.equal(r.source.message_id,'synthetic-stored-original-school-message');
  assert.equal(r.attachment.sha256,'b'.repeat(64));assert.equal(r.binding,'exact_raw_attachment_sha256');
  assert.equal(r.integrity,'canonical_payload_digest_verified');assert.deepEqual(r.complete_for_dates,['2026-11-13']);
  assert.equal(result.source_receipt.original_write_call_receipt_recreated,false);
  assert.equal(result.source_receipt.mailbox_completeness_verified,false);
  assert.doesNotMatch(JSON.stringify(result),/Synthetic school|source_payload|PRIVATE|"rows"|"headers"/);
  assert.deepEqual(f.calls[1].contains,{key:'source_payload',value:{schema:'custodial.operations-mail-record.v1',kind:'school',observation:{attachment:{sha256:'b'.repeat(64)}}}});
  assert.equal(f.calls[1].like.value,'custodial-operations-v1/school/%');assert.deepEqual(f.calls[1].range,[0,9999]);
});
test('a complete exact lookup can be not_found; it never proves global absence or instructs a replay',async()=>{
  const f=fixture({rows:[]}),r=(await invoke(f)).source_receipt;assert.equal(r.state,'not_found');assert.deepEqual(r.records,[]);
  assert.equal(r.original_write_call_receipt_recreated,false);assert.equal(r.collector_activation_verified,false);
});
for(const [name,patch] of [['missing count',{count:null}],['wrong count',{count:2}],['truncated source',{count:10001}],
  ['not an array',{data:null}],['denied',{error:{message:'PRIVATE DB ERROR'}}]]){
  test('incomplete school lookup remains unavailable: '+name,async()=>{
    const r=await invoke(fixture({patch}));assert.equal(r.source_receipt.state,'unavailable');assert.equal(r.source_receipt.records,undefined);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
  });
}
for(const [name,mutate] of [['payload digest',r=>r.payload_hash='f'.repeat(64)],['source message binding',r=>r.outlook_message_id='wrong-original'],
  ['source key binding',r=>r.source_event_key='custodial-operations-v1/school/wrong'],['record state',r=>r.sync_status='NEEDS_REVIEW'],
  ['invalid id',r=>r.id='not-a-uuid'],['invalid timestamp',r=>r.created_at='not-an-instant']]){
  test('tampered school record is not a receipt: '+name,async()=>{
    const row=schoolRow();mutate(row);const r=await invoke(fixture({rows:[row]}));assert.equal(r.source_receipt.state,'unavailable');
  });
}
test('a correctly hashed different workbook cannot escape the exact selected-document binding',async()=>{
  const row=schoolRow();row.source_payload.observation.attachment.sha256='e'.repeat(64);row.payload_hash=sha(canonical(row.source_payload));
  assert.equal((await invoke(fixture({rows:[row]}))).source_receipt.state,'unavailable');
});
test('duplicate stored IDs and oversized source payloads are refused without partial metadata',async()=>{
  assert.equal((await invoke(fixture({rows:[schoolRow(),schoolRow()]}))).source_receipt.state,'unavailable');
  const row=schoolRow();row.extra='PRIVATE'.repeat(1500000);
  assert.equal((await invoke(fixture({rows:[row]}))).source_receipt.state,'unavailable');
});
test('case aliases of the same UUID cannot masquerade as distinct school or formal receipts',async()=>{
  const a=schoolRow();a.id='8a000000-0000-4000-8000-000000000001';const b=structuredClone(a);b.id=b.id.toUpperCase();
  assert.equal((await invoke(fixture({rows:[a,b]}))).source_receipt.state,'unavailable');
  const c=eventRow();c.id=a.id;const d=structuredClone(c);d.id=d.id.toUpperCase();
  assert.equal((await invoke(fixture({rows:[c,d]}),eventSelector())).source_receipt.state,'unavailable');
});
test('ended formal source bindings return safe current canonical metadata without claiming current board visibility',async()=>{
  const f=fixture({rows:[eventRow()]}),r=(await invoke(f,eventSelector())).source_receipt;
  assert.equal(r.state,'found');assert.equal(r.records[0].event_id,eid);assert.equal(r.records[0].publication_verified,false);
  assert.equal(r.canonical_events.state,'snapshot');assert.equal(r.canonical_events.events[0].revision,2);
  assert.equal(r.canonical_events.events[0].date,'2026-11-11');assert.equal(r.canonical_events.current_public_feed_visibility_verified,false);
  assert.match(r.canonical_events.consistency,/not_an_atomic/);
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE|source_payload|"reason"|access_note|audience_employee_ids/);
  assert.deepEqual(f.calls[1].eq,{key:'outlook_message_id',value:message});assert.equal(f.calls[1].like.value,'custodial-outlook-events-v1/event/%');
  assert.match(f.calls[2].sql,new RegExp("e\\.id in \\('"+eid+"'\\)"));
});
test('durable NEEDS_REVIEW is reported as staged; no event, fake publication or writer action is created',async()=>{
  const f=fixture({rows:[eventRow({review:true})]}),r=(await invoke(f,eventSelector())).source_receipt;
  assert.equal(r.state,'found');assert.equal(r.records[0].state,'NEEDS_REVIEW');assert.equal(r.records[0].review_required,true);
  assert.equal(r.records[0].event_id,null);assert.equal(r.records[0].publication_verified,false);
  assert.equal(r.canonical_events.state,'not_applicable');assert.equal(f.calls.length,2);
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);assert.equal(r.records[0].reason,undefined);
});
test('one original event notice can have multiple separately bound review observations',async()=>{
  const a=eventRow({review:true}),b=structuredClone(a);b.id='83000000-0000-4000-8000-000000000001';
  b.source_payload.source_event_key='second-event-in-same-original';b.source_event_key='custodial-outlook-events-v1/event/'+b.source_payload.source_event_key;
  assert.equal((await invoke(fixture({rows:[a,b]}),eventSelector())).source_receipt.records.length,2);
});
for(const [name,mutate] of [['wrong original',r=>r.source_payload.source.message_id='different-message'],
  ['wrong namespace',r=>r.source_event_key='unapproved/'+r.source_payload.source_event_key],
  ['invalid observation',r=>r.source_payload.sql='select private'],['wrong received instant',r=>r.received_at='2026-11-10T00:00:00Z'],
  ['invalid payload hash',r=>r.payload_hash='invalid'],['claimed applied without event',r=>r.event_id=null]]){
  test('formal binding rejects malformed stored authority: '+name,async()=>{
    const row=eventRow();mutate(row);assert.equal((await invoke(fixture({rows:[row]}),eventSelector())).source_receipt.state,'unavailable');
  });
}
test('canonical-event failure is explicit and does not discard a valid immutable source binding',async()=>{
  const r=(await invoke(fixture({rows:[eventRow()],eventPatch:{rowCount:null}}),eventSelector())).source_receipt;
  assert.equal(r.state,'found');assert.equal(r.records.length,1);assert.equal(r.canonical_events.state,'unavailable');assert.equal(r.canonical_events.events,undefined);
});
test('a canonical row outside the receipt-bound IDs is unavailable; private audiences remain withheld',async()=>{
  const wrong=canonicalEvent();wrong.id='84000000-0000-4000-8000-000000000001';
  assert.equal((await invoke(fixture({rows:[eventRow()],events:[wrong]}),eventSelector())).source_receipt.canonical_events.state,'unavailable');
  const privateEvent=canonicalEvent();privateEvent.audience_scope='employees';privateEvent.event_name='PRIVATE EMPLOYEE MESSAGE';
  const r=(await invoke(fixture({rows:[eventRow()],events:[privateEvent]}),eventSelector())).source_receipt;
  assert.deepEqual(r.canonical_events.events,[]);assert.deepEqual(r.canonical_events.not_exposed_event_ids,[eid]);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
});
test('canonical row absence remains visible as a missing bound ID, not proof of a public empty feed',async()=>{
  const r=(await invoke(fixture({rows:[eventRow()],events:[]}),eventSelector())).source_receipt;
  assert.deepEqual(r.canonical_events.not_exposed_event_ids,[eid]);assert.equal(r.canonical_events.current_public_feed_visibility_verified,false);
});
test('exact private lookup can accompany the existing safe public feed without adding private fields to that feed',async()=>{
  const f=fixture(),args=input(schoolSelector());args.request.observation.include_public_feed=true;
  const r=await callOutlookEventSync(args,auth(),{client:f.client,publishedFeedReaders:{
    readSql:async()=>({ok:true,rowCount:0,row_limit_truncated:false,response_truncated:false,rows:[]}),
    readMail:async()=>({schools:{state:'snapshot',rows:[]}})}});
  assert.equal(r.public_feed.state,'snapshot');assert.equal(r.source_receipt.state,'found');
  assert.doesNotMatch(JSON.stringify(r.public_feed),/ledger_id|message_id|attachment|payload_sha256|source_key/);
});
for(const [name,mutate] of [['principal replacement',a=>a.authInfo={...a.authInfo}],['scope withdrawal',a=>a.authInfo.scopes.pop()],
  ['expiry',a=>a.authInfo.expiresAt=1],['context replacement',a=>a.authInfo.extra={...a.authInfo.extra}]]){
  test('authority withdrawal across protected read refuses the entire status: '+name,async()=>{
    const a=auth(),f=fixture({afterSource:()=>mutate(a)});await assert.rejects(invoke(f,schoolSelector(),a),/outlook_sync_status_unavailable/);
  });
}
test('cancellation during canonical read returns no late receipt and does not retry any query',async()=>{
  const controller=new AbortController();let finish;const pending=new Promise(r=>{finish=r;});
  const f=fixture({rows:[eventRow()],afterCanonical:()=>pending}),promise=invoke(f,eventSelector(),auth(),{signal:controller.signal});
  await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(promise,/outlook_sync_status_unavailable/);finish();
  await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,3);
});
test('private metadata selector stays strict and cannot be placed on a write/checkpoint',()=>{
  for(const selector of [{...schoolSelector(),sql:'select private'},{...schoolSelector(),manager_id:sid},
    {...schoolSelector(),attachment_read_complete:false},{...eventSelector(),original_source_read:false},
    {kind:'event_id',event_id:eid},{...eventSelector(),message_id:'bad\nmessage'}])assert.equal(outlookSyncSchema.safeParse(input(selector)).success,false);
  const args={contract_version:OUTLOOK_SYNC_CONTRACT,request:{action:'checkpoint',observation:{mailbox:'eoperle@memphiszoo.org',
    run_id:sid,from:'2026-11-07T08:00:00Z',through:'2026-11-14T08:00:00Z',complete:true,pages_read:4,evidence_sha256:'e'.repeat(64),source_receipt:schoolSelector()}}};
  assert.equal(outlookSyncSchema.safeParse(args).success,false);
});
test('same registered privileged tool accepts the selector; anonymous callers never open a source query',async()=>{
  const f=fixture();let handler,definition;
  const server={registerTool(name,value,call){assert.equal(name,'custodial_outlook_events_sync');definition=value;handler=call;}};
  configureMcpToolAuth(server,{securitySchemes:[{type:'noauth'},{type:'oauth2',scopes:['mcp:read','mcp:write']}]});
  registerOutlookEventTools(server,{client:f.client});
  assert.match(JSON.stringify(definition.inputSchema),/source_receipt/);
  assert.deepEqual(definition._meta.securitySchemes,[{type:'oauth2',scopes:['mcp:read','mcp:write']}]);
  assert.equal((await handler(input(schoolSelector()),{})).isError,true);assert.equal(f.calls.length,0);
  const result=await handler(input(schoolSelector()),auth());assert.equal(JSON.parse(result.content[0].text).source_receipt.state,'found');
});
test('actual Supabase SDK sends a read-only exact-document query with exact-count metadata and no imported replay',async()=>{
  const row=schoolRow(),requests=[];
  const client=createClient('https://synthetic.example.invalid','synthetic-not-a-real-service-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,init={})=>{
    const u=new URL(url),headers=new Headers(init.headers);requests.push({url:u.toString(),method:init.method||'GET'});
    assert.equal(u.origin,'https://synthetic.example.invalid');
    if(u.pathname==='/rest/v1/rpc/custodial_outlook_event_sync_v1'){
      assert.equal(init.method,'POST');assert.equal(JSON.parse(init.body).p_action,'status');
      return new Response(JSON.stringify(statusValue),{status:200,headers:{'content-type':'application/json'}});
    }
    assert.equal(init.method,'GET');assert.equal(u.pathname,'/rest/v1/events_app_outlook_sync');
    assert.equal(u.searchParams.get('source_event_key'),'like.custodial-operations-v1/school/%');
    assert.deepEqual(JSON.parse(u.searchParams.get('source_payload').slice(3)),{schema:'custodial.operations-mail-record.v1',kind:'school',observation:{attachment:{sha256:'b'.repeat(64)}}});
    assert.match(headers.get('prefer'),/count=exact/);
    return new Response(JSON.stringify([row]),{status:200,headers:{'content-type':'application/json','content-range':'0-0/1'}});
  }}});
  const r=await callOutlookEventSync(input(schoolSelector()),auth(),{client});assert.equal(r.source_receipt.state,'found');assert.equal(requests.length,2);
});
test('an established exact event key retrieves original/correction bindings without merging by names or choosing a latest source',async()=>{
  const a=eventRow(),b=eventRow();b.id='85000000-0000-4000-8000-000000000001';
  b.outlook_message_id=b.source_payload.source.message_id='synthetic-later-original-message';
  const selector={kind:'event_key',original_source_read:true,source_event_key:'synthetic-ended-event'};
  const f=fixture({rows:[a,b]}),r=(await invoke(f,selector)).source_receipt;
  assert.equal(r.records.length,2);assert.equal(r.records[0].binding,'exact_established_event_key');
  assert.deepEqual(f.calls[1].eq,{key:'source_event_key',value:'custodial-outlook-events-v1/event/synthetic-ended-event'});
  assert.equal(f.calls[1].like,undefined);assert.equal(r.canonical_events.events.length,1);
});
test('an event-key response containing a different source key is refused even when its own record shape is valid',async()=>{
  const r=await invoke(fixture({rows:[eventRow()]}),{kind:'event_key',original_source_read:true,source_event_key:'different-established-key'});
  assert.equal(r.source_receipt.state,'unavailable');
});
for(const [name,patch] of [['missing count',{count:null}],['wrong count',{count:2}],['row cap',{count:10001}],['transport/permission failure',{error:{message:'PRIVATE'}}]]){
  test('formal source read is complete or unavailable: '+name,async()=>{
    const r=await invoke(fixture({rows:[eventRow()],patch}),eventSelector());assert.equal(r.source_receipt.state,'unavailable');assert.equal(r.source_receipt.records,undefined);
  });
}
test('canonical 500-event cap remains explicit while independently valid source bindings are retained',async()=>{
  const rows=Array.from({length:501},(_,i)=>{const row=eventRow();row.id='86000000-0000-4000-8000-'+i.toString(16).padStart(12,'0');
    row.event_id='87000000-0000-4000-8000-'+i.toString(16).padStart(12,'0');row.source_payload.source_event_key+='-'+i;
    row.source_event_key='custodial-outlook-events-v1/event/'+row.source_payload.source_event_key;return row;});
  const f=fixture({rows}),r=(await invoke(f,eventSelector())).source_receipt;
  assert.equal(r.state,'found');assert.equal(r.records.length,501);assert.equal(r.canonical_events.state,'unavailable');assert.equal(f.calls.length,2);
});
test('authority withdrawal during the additional canonical read cannot be hidden by an unavailable-data fallback',async()=>{
  const a=auth(),f=fixture({rows:[eventRow()],afterCanonical:()=>{a.authInfo.scopes=[];}});
  await assert.rejects(invoke(f,eventSelector(),a),/outlook_sync_status_unavailable/);
});
test('internal receipt-reader reference replacement after admission cannot redirect the generated snapshot',async()=>{
  const readers={now:()=>new Date('2026-11-14T08:00:00Z')},f=fixture({rows:[eventRow()],afterStatus:()=>{readers.now=()=>{throw Error('PRIVATE successor');};}});
  readers.readSql=f.readSql;
  const r=await invoke(f,eventSelector(),auth(),{sourceReceiptReaders:readers});
  assert.equal(r.source_receipt.canonical_events.generated_at,'2026-11-14T08:00:00.000Z');
});
