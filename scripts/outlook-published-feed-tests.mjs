import assert from 'node:assert/strict';
import {test} from 'node:test';
import {callOutlookEventSync,outlookSyncSchema,OUTLOOK_SYNC_CONTRACT} from '../src/outlook-event-sync.js';
import {readOutlookPublishedFeed,OUTLOOK_PUBLISHED_FEED_SCHEMA} from '../src/outlook-published-feed.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registerOutlookEventTools} from '../src/mcp/outlook-event-tools.js';
import {configureMcpToolAuth,finalizeMcpToolAuth} from '../src/mcp/register.js';

const eventId='12000000-0000-4000-8000-000000000001';
const statusValue={schema:'custodial.outlook-event-sync.v1',writer_ready:true,
  mailbox:'eoperle@memphiszoo.org',cursor:null,checkpoint_at:null,last_import_at:null};
const input=observation=>({contract_version:OUTLOOK_SYNC_CONTRACT,request:{action:'status',observation}});
const auth=()=>({authInfo:{clientId:'memphis-mcp-connector-token',extra:{authSource:'connector_token'}}});
const event=()=>({id:eventId,revision:3,event_name:'Synthetic Birthday',event_date:'2026-11-14',end_date:'2026-11-14',
  start_time:'13:00:00',end_time:'15:00:00',start_instant_utc:'2026-11-14T19:00:00Z',end_instant_utc:'2026-11-14T21:00:00Z',
  event_timezone:'America/Chicago',audience_scope:'assigned_location',status:'SCHEDULED',display_location:'Safari Basecamp',
  attendee_count:19,custodial_public_notes:'Clean before/after; empty trash.',notes:'PRIVATE SOURCE',
  source_payload:{private:'RAW MAIL'},access_note:'PRIVATE KEY',audience_employee_ids:['PRIVATE EMPLOYEE']});
const mail=()=>({schools:{state:'snapshot',coverage:'imported_only',mailbox_completeness_verified:false,rows:[{
  id:'100:2026-11-17',order_id:'100',name:'Synthetic School',date:'2026-11-17',arrival_at:'2026-11-17T15:30:00Z',
  departure_at:null,departure_source:null,status:'SCHEDULED',students:95,teachers:9,chaperones:0,unclassified:0,buses:4,total:104,adults:9,
  provenance:{message_id:'PRIVATE MESSAGE'},attachment_id:'PRIVATE ATTACHMENT',content_sha256:'PRIVATE HASH'}]}});
function fixture({events=[event()],mailValue=mail(),sqlPatch={},afterStatus=()=>{},afterSql=()=>{},afterMail=()=>{}}={}){
  const calls=[];
  const client={rpc(name,args){calls.push({name,args});assert.equal(name,'custodial_outlook_event_sync_v1');
    assert.equal(args.p_action,'status');return{abortSignal(signal){assert.ok(signal instanceof AbortSignal);return{retry(value){
      assert.equal(value,false);return Promise.resolve().then(()=>{afterStatus();return{data:structuredClone(statusValue),error:null};});
    }};}};}};
  const readers={readSql:async({sql})=>{calls.push({sql});assert.match(sql,/select e\.id/);assert.doesNotMatch(sql,/events_app_outlook_sync/);
    await afterSql();return{ok:true,rowCount:events.length,row_limit_truncated:false,response_truncated:false,rows:events,...sqlPatch};},
  readMail:async({client:boundClient,signal})=>{assert.equal(boundClient,client);assert.ok(signal instanceof AbortSignal);
    calls.push({mail:true});await afterMail();return mailValue;},now:()=>new Date('2026-11-14T06:00:00Z')};
  return{calls,client,readers};
}

test('legacy status is unchanged and never opens a published-feed reader',async()=>{
  const f=fixture();const result=await callOutlookEventSync(input({}),auth(),{client:f.client,publishedFeedReaders:f.readers});
  assert.deepEqual(result,statusValue);assert.equal(f.calls.length,1);
});
test('explicit existing status selector returns canonical safe current event IDs/revisions and school facts',async()=>{
  const f=fixture();const result=await callOutlookEventSync(input({include_public_feed:true}),auth(),{client:f.client,publishedFeedReaders:f.readers});
  assert.equal(result.writer_ready,true);assert.equal(result.cursor,null);
  assert.equal(result.public_feed.schema,OUTLOOK_PUBLISHED_FEED_SCHEMA);assert.equal(result.public_feed.state,'snapshot');
  assert.equal(result.public_feed.events[0].id,eventId);assert.equal(result.public_feed.events[0].revision,3);
  assert.equal(result.public_feed.schools.rows[0].total,104);assert.equal(result.public_feed.schools.rows[0].departure_at,null);
  assert.equal(result.public_feed.mailbox_completeness_verified,false);assert.equal(result.public_feed.collector_activation_verified,false);
  assert.doesNotMatch(JSON.stringify(result.public_feed),/PRIVATE|source_payload|message_id|attachment_id|access_note|content_sha256|audience_employee_ids/);
  assert.equal(f.calls.filter(c=>c.name).length,1);assert.equal(f.calls.filter(c=>c.sql).length,1);
});
test('the optional reader uses the same employee audience exclusion as the public dashboard',async()=>{
  const f=fixture({events:[event(),{...event(),id:'13000000-0000-4000-8000-000000000001',audience_scope:'employees',event_name:'PRIVATE ADDRESSED MESSAGE'}]});
  const result=await callOutlookEventSync(input({include_public_feed:true}),auth(),{client:f.client,publishedFeedReaders:f.readers});
  assert.equal(result.public_feed.events.length,1);assert.equal(result.public_feed.events[0].id,eventId);
});
for(const [name,patch] of [['row truncation',{row_limit_truncated:true}],['byte truncation',{response_truncated:true}],
  ['failed reader',{ok:false}],['missing complete count',{rowCount:undefined}],['wrong count',{rowCount:2}],['non-array rows',{rows:null}]]){
  test('incomplete published data is explicitly unavailable: '+name,async()=>{
    const f=fixture({sqlPatch:patch});const result=await callOutlookEventSync(input({include_public_feed:true}),auth(),{client:f.client,publishedFeedReaders:f.readers});
    assert.equal(result.writer_ready,true);assert.equal(result.public_feed.state,'unavailable');assert.equal(result.public_feed.events,undefined);
  });
}
test('source reader exceptions are redacted and never become an authoritative empty feed',async()=>{
  const f=fixture({afterSql:()=>{throw Error('PRIVATE database credentials');}});
  const result=await callOutlookEventSync(input({include_public_feed:true}),auth(),{client:f.client,publishedFeedReaders:f.readers});
  assert.equal(result.public_feed.state,'unavailable');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});
test('school source unavailability stays explicit while independently readable events remain visible',async()=>{
  const f=fixture({mailValue:{schools:{state:'unavailable',reason:'PRIVATE cause',rows:[]}}});
  const result=await callOutlookEventSync(input({include_public_feed:true}),auth(),{client:f.client,publishedFeedReaders:f.readers});
  assert.equal(result.public_feed.events.length,1);assert.equal(result.public_feed.schools.state,'unavailable');
  assert.equal(result.public_feed.schools.reason,'source_unavailable');assert.doesNotMatch(JSON.stringify(result),/PRIVATE cause/);
});
test('a complete empty snapshot is distinct from unavailable or a complete mailbox claim',async()=>{
  const f=fixture({events:[],mailValue:{schools:{state:'snapshot',coverage:'imported_only',mailbox_completeness_verified:false,rows:[]}}});
  const result=await callOutlookEventSync(input({include_public_feed:true}),auth(),{client:f.client,publishedFeedReaders:f.readers});
  assert.equal(result.public_feed.state,'snapshot');assert.deepEqual(result.public_feed.events,[]);assert.deepEqual(result.public_feed.schools.rows,[]);
  assert.equal(result.public_feed.mailbox_completeness_verified,false);
});
for(const [name,mutate] of [
  ['principal object replacement',e=>e.authInfo={...e.authInfo}],
  ['context replacement',e=>e.authInfo.extra={...e.authInfo.extra}],
  ['client replacement',e=>e.authInfo.clientId='different'],
  ['expiry',e=>e.authInfo.expiresAt=1],
])test('authority withdrawal during published read refuses the entire status result: '+name,async()=>{
  const extra=auth(),f=fixture({afterSql:()=>mutate(extra)});
  await assert.rejects(callOutlookEventSync(input({include_public_feed:true}),extra,{client:f.client,publishedFeedReaders:f.readers}),/outlook_sync_status_unavailable/);
});
test('caller cancellation returns no late result and never triggers a retry or source mutation',async()=>{
  const controller=new AbortController();let finish;
  const pending=new Promise(resolve=>{finish=resolve;});const f=fixture({afterSql:()=>pending});
  const result=callOutlookEventSync(input({include_public_feed:true}),auth(),{client:f.client,signal:controller.signal,publishedFeedReaders:f.readers});
  await new Promise(resolve=>setImmediate(resolve));controller.abort();
  await assert.rejects(result,/outlook_sync_status_unavailable/);finish();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.filter(c=>c.name).length,1);
});
test('internal reader reference replacement after status admission cannot redirect the snapshot',async()=>{
  const f=fixture({afterStatus:()=>{f.readers.readSql=()=>{throw Error('PRIVATE successor');};}});
  const result=await callOutlookEventSync(input({include_public_feed:true}),auth(),{client:f.client,publishedFeedReaders:f.readers});
  assert.equal(result.public_feed.state,'snapshot');
});
test('only the explicit true status selector is added; arbitrary SQL, IDs, URLs and mutation-side flags remain refused',()=>{
  assert.equal(outlookSyncSchema.safeParse(input({include_public_feed:true})).success,true);
  for(const observation of [{include_public_feed:false},{include_public_feed:true,sql:'select private'},
    {event_id:eventId},{url:'https://private.invalid'},{include_public_feed:'true'}])
    assert.equal(outlookSyncSchema.safeParse(input(observation)).success,false);
  const apply={contract_version:OUTLOOK_SYNC_CONTRACT,request:{action:'apply',observation:{
    source:{mailbox:'eoperle@memphiszoo.org',message_id:'synthetic-original',content_sha256:'a'.repeat(64),
      evidence_kind:'original_event_notice',source_at:'2026-11-13T18:00:00Z',received_at:'2026-11-13T18:00:00Z'},
    source_event_key:'synthetic-party',event:{event_name:'Synthetic Party',event_scope:'SINGLE_VENUE',
      primary_venue_id:eventId,event_date:'2026-11-14',end_date:'2026-11-14',start_time:'13:00:00',end_time:'15:00:00',
      start_instant_utc:'2026-11-14T19:00:00Z',end_instant_utc:'2026-11-14T21:00:00Z'}}}};
  assert.equal(outlookSyncSchema.safeParse(apply).success,true);
  apply.request.observation.include_public_feed=true;assert.equal(outlookSyncSchema.safeParse(apply).success,false);
});
test('public event cap remains complete-or-unavailable at the existing 500-row boundary',async()=>{
  const f=fixture({events:Array.from({length:501},(_,i)=>({...event(),id:String(i)}))});
  const result=await callOutlookEventSync(input({include_public_feed:true}),auth(),{client:f.client,publishedFeedReaders:f.readers});
  assert.equal(result.public_feed.state,'unavailable');
});
test('an oversized published snapshot is refused without returning partial rows or source content',async()=>{
  const f=fixture({mailValue:{schools:{state:'snapshot',rows:[{id:'synthetic-large',name:'x'.repeat(8*1024*1024)}]}}});
  const result=await callOutlookEventSync(input({include_public_feed:true}),auth(),{client:f.client,publishedFeedReaders:f.readers});
  assert.equal(result.writer_ready,true);assert.equal(result.public_feed.state,'unavailable');assert.equal(result.public_feed.events,undefined);
  assert.ok(JSON.stringify(result).length<1000);
});
test('the same registered authenticated tool exposes the optional feed without adding a tool or auth scope',async()=>{
  const f=fixture();let handler,definition;
  const server={registerTool(name,value,call){assert.equal(name,'custodial_outlook_events_sync');definition=value;handler=call;}};
  configureMcpToolAuth(server,{securitySchemes:[{type:'noauth'},{type:'oauth2',scopes:['mcp:read','mcp:write']}]});
  registerOutlookEventTools(server,{client:f.client,publishedFeedReaders:f.readers});
  assert.deepEqual(definition._meta.securitySchemes,[{type:'oauth2',scopes:['mcp:read','mcp:write']}]);
  const denied=await handler(input({include_public_feed:true}),{});assert.equal(denied.isError,true);assert.equal(f.calls.length,0);
  const response=await handler(input({include_public_feed:true}),auth());
  assert.equal(JSON.parse(response.content[0].text).public_feed.events[0].id,eventId);
});
test('actual SDK lists one existing tool with the explicit selector and refuses anonymous optional-feed execution',async()=>{
  const f=fixture(),server=new McpServer({name:'synthetic-outlook-feed',version:'1'}),client=new Client({name:'synthetic-observer',version:'1'});
  configureMcpToolAuth(server,{securitySchemes:[{type:'noauth'},{type:'oauth2',scopes:['mcp:read','mcp:write']}],challenge:'Bearer resource_metadata="https://fixture.invalid/metadata"'});
  registerOutlookEventTools(server,{client:f.client,publishedFeedReaders:f.readers});finalizeMcpToolAuth(server);
  const [ct,st]=InMemoryTransport.createLinkedPair();
  // The pinned SDK client strips the top-level extension during parsing.
  // Verify its retained compatibility mirror and the actual server wire body.
  const wire=[],send=st.send.bind(st);
  st.send=async(message,...rest)=>{wire.push(structuredClone(message));return send(message,...rest);};
  try{
    await server.connect(st);await client.connect(ct);const listed=await client.listTools();assert.equal(listed.tools.length,1);
    assert.match(JSON.stringify(listed.tools[0].inputSchema),/include_public_feed/);
    const expectedAuth=[{type:'oauth2',scopes:['mcp:read','mcp:write']}];
    assert.deepEqual(listed.tools[0]._meta.securitySchemes,expectedAuth);
    const raw=wire.find(message=>message.result?.tools?.[0]?.name==='custodial_outlook_events_sync');
    assert.ok(raw);assert.deepEqual(raw.result.tools[0].securitySchemes,expectedAuth);
    const result=await client.callTool({name:'custodial_outlook_events_sync',arguments:input({include_public_feed:true})});
    assert.equal(result.isError,true);assert.equal(f.calls.length,0);
  }finally{await client.close();await server.close();}
});
