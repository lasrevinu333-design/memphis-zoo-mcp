import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createClient} from '@supabase/supabase-js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {readFileSync} from 'node:fs';
import {callOutlookEventSync,outlookSyncSchema,OUTLOOK_SYNC_CONTRACT,OUTLOOK_SYNC_SCHEMA_SHA256} from '../src/outlook-event-sync.js';
import {registerOutlookEventTools} from '../src/mcp/outlook-event-tools.js';
import {configureMcpToolAuth,finalizeMcpToolAuth} from '../src/mcp/register.js';
import {getToolManifest} from '../src/mcp/tool-manifest.js';
const clone=v=>JSON.parse(JSON.stringify(v));
const id='11000000-0000-4000-8000-000000000001',eventId='12000000-0000-4000-8000-000000000001';
const auth={authInfo:{clientId:'memphis-mcp-connector-token',extra:{authSource:'connector_token'}}};
const oauth={authInfo:{clientId:'synthetic-client',scopes:['mcp:read','mcp:write'],extra:{authSource:'self_contained_oauth',issuer:'fixture',subject:'fixture-subject'}}};
const source={mailbox:'eoperle@memphiszoo.org',message_id:'synthetic-original-source',content_sha256:'a'.repeat(64),
  evidence_kind:'original_event_notice',source_at:'2026-10-08T10:00:00Z',received_at:'2026-10-08T10:01:00Z'};
const event={event_name:'Synthetic Event',event_scope:'SINGLE_VENUE',primary_venue_id:eventId,event_date:'2026-10-09',end_date:'2026-10-09',
  start_time:'10:00:00',end_time:'11:00:00',start_instant_utc:'2026-10-09T15:00:00Z',end_instant_utc:'2026-10-09T16:00:00Z',attendee_count:null};
const input=(action='apply',delta={})=>({contract_version:OUTLOOK_SYNC_CONTRACT,request:{action,observation:{source,source_event_key:'synthetic-event',event,...delta}}});
const cp={mailbox:'eoperle@memphiszoo.org',run_id:id,from:'2026-10-07T10:00:00Z',through:'2026-10-08T10:00:00Z',complete:true,pages_read:2,evidence_sha256:'b'.repeat(64)};
const checkpoint=()=>({contract_version:OUTLOOK_SYNC_CONTRACT,request:{action:'checkpoint',observation:cp}});
const status=()=>({contract_version:OUTLOOK_SYNC_CONTRACT,request:{action:'status',observation:{}}});
function fixture(args,{state='APPLIED',rowDelta={},resultDelta={},writeError=false,readError=false,throwWrite=false,throwRead=false,afterWrite=()=>{},afterRead=()=>{}}={}){
  const calls=[],obs=args.request.observation,check=args.request.action==='checkpoint',readOnly=args.request.action==='status';
  const row={id,event_id:check?null:eventId,outlook_message_id:check?`collector:${obs.run_id}`:readOnly?'unused-status-fixture':obs.source.message_id,
    source_event_key:check?'custodial-outlook-events-v1/checkpoint':`custodial-outlook-events-v1/event/${obs.source_event_key}`,
    payload_hash:'c'.repeat(64),sync_status:check?'UNCHANGED':state,source_payload:clone(obs),...rowDelta};
  const result=args.request.action==='status'?{schema:'custodial.outlook-event-sync.v1',writer_ready:true,mailbox:source.mailbox,cursor:null,checkpoint_at:null,last_import_at:null}
    :check?{state:'CHECKPOINT_SAVED',through:obs.through,replayed:false}
    :{schema:'custodial.outlook-event-sync.v1',state,event_id:eventId,ledger_id:id,source_sha256:row.payload_hash,replayed:false};
  const client=createClient('https://outlook-fixture.example.invalid','synthetic-fixture-role',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,options={})=>{
    assert.equal(new URL(url).hostname,'outlook-fixture.example.invalid');
    calls.push({url:String(url),method:options.method,body:options.body?JSON.parse(options.body):null,signal:options.signal});
    if(options.signal?.aborted)throw new Error('synthetic cancellation');
    const write=String(url).includes('/rpc/');
    if((write&&throwWrite)||(!write&&throwRead))throw new Error('synthetic transport uncertainty');
    const error=write?writeError:readError;
    await(write?afterWrite():afterRead());
    return new Response(JSON.stringify(error?{message:'Synthetic error',code:'P0001'}:write?{...result,...resultDelta}:row),{status:error?400:200,headers:{'content-type':'application/json'}});
  }}});
  return {client,calls,row};
}
test('source catalog exposes only the typed private writer and canonical registration',()=>{
  const tool=getToolManifest().tools.find(t=>t.name==='custodial_outlook_events_sync');
  assert.equal(tool.safety,'safe-write');assert.deepEqual(tool.required_scopes,['mcp:read','mcp:write']);
  assert.equal(tool.adapter_schema_sha256,OUTLOOK_SYNC_SCHEMA_SHA256);assert.equal(tool.contract_version,OUTLOOK_SYNC_CONTRACT);
  assert.equal(tool.input_schema.additionalProperties,false);
  const main=readFileSync(new URL('../src/mcp/create-mcp-server.js',import.meta.url),'utf8');
  assert.match(main,/registerOutlookEventTools\(server, \{ includeWrites: includePrivilegedTools \}\)/);
  assert.match(readFileSync(new URL('../package.json',import.meta.url),'utf8'),/test:mcp-auth.*outlook-event-sync-adapter-tests/);
});
for(const [label,extra] of [['missing',{}],['read-only',{authInfo:{...oauth.authInfo,scopes:['mcp:read']}}],['forged connector',{authInfo:{...auth.authInfo,clientId:'other'}}],['wrong source',{authInfo:{...oauth.authInfo,extra:{...oauth.authInfo.extra,authSource:'other'}}}],['expired',{authInfo:{...oauth.authInfo,expiresAt:1}}]]){
  test(`${label} principal cannot dispatch`,async()=>{const f=fixture(input());await assert.rejects(callOutlookEventSync(input(),extra,{client:f.client}),/principal_required/);assert.equal(f.calls.length,0);});
}
for(const extra of [auth,oauth])test(`accepted ${extra.authInfo.extra.authSource} dispatch is bounded and exactly read back`,async()=>{
  const args=input(),f=fixture(args),r=await callOutlookEventSync(args,extra,{client:f.client});
  assert.equal(r.state,'APPLIED');assert.equal(r.readback_verified,true);assert.equal(r.collector_activation_verified,false);assert.equal(r.external_mail_or_ticket_mutation,false);
  assert.equal(f.calls.length,2);assert.match(f.calls[0].url,/\/rpc\/custodial_outlook_event_sync_v1$/);
  assert.deepEqual(f.calls[0].body,{p_action:'apply',p_observation:args.request.observation});
  assert.match(f.calls[1].url,/events_app_outlook_sync/);assert.equal(f.calls[1].method,'GET');assert.ok(f.calls.every(c=>c.signal instanceof AbortSignal));
  assert.ok(!JSON.stringify(r).includes(source.message_id));assert.ok(!JSON.stringify(r).includes(source.content_sha256));
});
for(const state of ['CANCELLED','UNCHANGED','NEEDS_REVIEW','BLOCKED_MANUAL'])test(`${state} remains truthful, not converted to applied`,async()=>{
  const args=input(),f=fixture(args,{state});assert.equal((await callOutlookEventSync(args,auth,{client:f.client})).state,state);
});
test('unknown review can have null event identity',async()=>{const args=input('review',{event:undefined,reason:'End time unresolved.'});delete args.request.observation.event;
  const f=fixture(args,{state:'NEEDS_REVIEW',rowDelta:{event_id:null},resultDelta:{event_id:null}});assert.equal((await callOutlookEventSync(args,auth,{client:f.client})).event_id,null);});
test('authoritative cancellation uses existing event/revision and no external edit',async()=>{
  const args=input('cancel',{source:{...source,evidence_kind:'event_cancellation'},event_id:eventId,expected_revision:3,reason:'Source cancellation.'});delete args.request.observation.event;
  const f=fixture(args,{state:'CANCELLED'});assert.equal((await callOutlookEventSync(args,auth,{client:f.client})).state,'CANCELLED');assert.equal(f.calls[0].body.p_action,'cancel');
});
test('checkpoint requires exact recorded observation and no generic completeness inference',async()=>{
  const args=checkpoint(),f=fixture(args),r=await callOutlookEventSync(args,auth,{client:f.client});assert.equal(r.through,cp.through);assert.equal(r.readback_verified,true);assert.equal(r.collector_activation_verified,false);
});
test('status is private read, not a writer or activation claim',async()=>{const args=status(),f=fixture(args);const r=await callOutlookEventSync(args,auth,{client:f.client});assert.equal(r.cursor,null);assert.equal(f.calls.length,1);});
for(const [label,mutate] of [
  ['wrong mailbox',a=>a.request.observation.source.mailbox='other@example.com'],['AI digest',a=>a.request.observation.source.evidence_kind='ai_daily_brief'],
  ['raw body',a=>a.request.observation.source.body='Do not store mail'],['raw recipients',a=>a.request.observation.event.recipients=['other@example.com']],
  ['generic SQL',a=>a.request.observation.sql='select 1'],['missing end',a=>delete a.request.observation.event.end_time],['invented attendance',a=>a.request.observation.event.attendee_count=-1],
  ['unknown action',a=>a.request.action='delete'],['private event notes',a=>a.request.observation.event.notes='Private'],['missing digest',a=>delete a.request.observation.source.content_sha256],
])test(`${label} rejected before dispatch`,async()=>{const args=clone(input());mutate(args);const f=fixture(input());await assert.rejects(callOutlookEventSync(args,auth,{client:f.client}));assert.equal(f.calls.length,0);});
for(const [label,mutate] of [['partial',a=>a.request.observation.complete=false],['zero pages',a=>a.request.observation.pages_read=0],['no evidence',a=>delete a.request.observation.evidence_sha256]])
  test(`${label} checkpoint rejected before dispatch`,async()=>{const args=clone(checkpoint());mutate(args);const f=fixture(checkpoint());await assert.rejects(callOutlookEventSync(args,auth,{client:f.client}));assert.equal(f.calls.length,0);});
for(const [label,rowDelta] of [['wrong source',{outlook_message_id:'other'}],['wrong namespace',{source_event_key:'other'}],['changed payload',{source_payload:{}}],['wrong status',{sync_status:'CANCELLED'}],['bad digest',{payload_hash:'bad'}],['wrong ledger',{id:eventId}],['wrong event',{event_id:null}]])
  test(`${label} readback remains unconfirmed`,async()=>{const args=input(),f=fixture(args,{rowDelta});await assert.rejects(callOutlookEventSync(args,auth,{client:f.client}),/readback_unconfirmed/);assert.equal(f.calls.length,2);});
for(const options of [{writeError:true},{throwWrite:true},{readError:true},{throwRead:true},{resultDelta:{source_sha256:'d'.repeat(64)}}])
  test(`uncertain ${JSON.stringify(options)} never blindly retries`,async()=>{const args=input(),f=fixture(args,options);await assert.rejects(callOutlookEventSync(args,auth,{client:f.client}),/unconfirmed/);assert.ok(f.calls.length<=2);});
test('cancelled operation never reports saved',async()=>{const args=input(),f=fixture(args);await assert.rejects(callOutlookEventSync(args,auth,{client:f.client,signal:AbortSignal.abort()}),/unconfirmed/);});
test('checkpoint mismatch cannot become current-source proof',async()=>{const args=checkpoint(),f=fixture(args,{resultDelta:{through:'2026-10-07T10:00:00Z'}});await assert.rejects(callOutlookEventSync(args,auth,{client:f.client}),/readback_unconfirmed/);});
test('invalid writer status stays unavailable',async()=>{const args=status(),f=fixture(args,{resultDelta:{mailbox:'other@example.com'}});await assert.rejects(callOutlookEventSync(args,auth,{client:f.client}),/status_invalid/);});
test('SDK tools/list publishes required auth; anonymous tool invocation cannot run',async()=>{
  const server=new McpServer({name:'synthetic-outlook-adapter',version:'1'}),client=new Client({name:'synthetic-observer',version:'1'});
  configureMcpToolAuth(server,{securitySchemes:[{type:'noauth'},{type:'oauth2',scopes:['mcp:read','mcp:write']}],challenge:'Bearer resource_metadata="https://fixture.invalid/metadata"'});
  registerOutlookEventTools(server);finalizeMcpToolAuth(server);const [ct,st]=InMemoryTransport.createLinkedPair();
  try{await server.connect(st);await client.connect(ct);const tools=await client.listTools();assert.equal(tools.tools.length,1);
    assert.equal(tools.tools[0].name,'custodial_outlook_events_sync');assert.deepEqual(tools.tools[0]._meta.securitySchemes,[{type:'oauth2',scopes:['mcp:read','mcp:write']}]);
    const r=await client.callTool({name:'custodial_outlook_events_sync',arguments:status()});assert.equal(r.isError,true);assert.match(r._meta['mcp/www_authenticate'][0],/mcp:read mcp:write/);
  }finally{await client.close();await server.close();}
});
test('read-only server has no private event tool',()=>{let n=0;registerOutlookEventTools({registerTool(){n++;}},{includeWrites:false});assert.equal(n,0);});
assert.equal(outlookSyncSchema.safeParse(input()).success,true);
test('NEW original event sync expiry at writer response cannot read back or report success',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const extra=clone(oauth);extra.authInfo.expiresAt=Math.floor(now/1000)+30;
  const args=input(),f=fixture(args,{afterWrite:()=>{now+=31000;}});
  await assert.rejects(callOutlookEventSync(args,extra,{client:f.client}),/unconfirmed|principal_required/);
  assert.equal(f.calls.length,1,'Expired original authorization must not start a follow-on ledger read');
  assert.deepEqual(f.calls[0].body,{p_action:'apply',p_observation:args.request.observation});
});

for(const [kind,template] of [['connector',auth],['OAuth',oauth]]){
  test(`NEW original event sync unchanged ${kind} lifetime preserves exact original readback without reading token`,async()=>{
    const extra=clone(template),args=input(),f=fixture(args);
    extra.authInfo.expiresAt=Math.floor(Date.now()/1000)+60;
    Object.defineProperty(extra.authInfo,'token',{get(){throw Error('The adapter must never inspect a token');}});
    const r=await callOutlookEventSync(args,extra,{client:f.client});
    assert.equal(r.state,'APPLIED');assert.equal(r.readback_verified,true);
    assert.equal(f.calls.length,2);assert.equal(f.calls.filter(call=>call.url.includes('/rpc/')).length,1);
    assert.deepEqual(f.calls[0].body,{p_action:'apply',p_observation:args.request.observation});
    assert.deepEqual(f.row.source_payload,args.request.observation);
    assert.equal(r.collector_activation_verified,false);assert.equal(r.external_mail_or_ticket_mutation,false);
  });
}
test('NEW original event sync connector expiry during writer response is one unconfirmed original only',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const extra=clone(auth);extra.authInfo.expiresAt=Math.floor(now/1000)+30;
  const args=input(),f=fixture(args,{afterWrite:()=>{now+=31000;}});
  await assert.rejects(callOutlookEventSync(args,extra,{client:f.client}),/^Error: outlook_sync_write_unconfirmed$/);
  assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].body,{p_action:'apply',p_observation:args.request.observation});
});
for(const [name,change] of [
  ['authInfo replacement',extra=>{extra.authInfo=clone(extra.authInfo);}],
  ['context replacement',extra=>{extra.authInfo.extra=clone(extra.authInfo.extra);}],
  ['source',extra=>{extra.authInfo.extra.authSource='connector_token';}],
  ['client',extra=>{extra.authInfo.clientId='another-otherwise-valid-client';}],
  ['issuer',extra=>{extra.authInfo.extra.issuer='another-otherwise-valid-issuer';}],
  ['subject',extra=>{extra.authInfo.extra.subject='another-otherwise-valid-subject';}],
  ['scopes replacement',extra=>{extra.authInfo.scopes=[...extra.authInfo.scopes];}],
  ['scopes changed',extra=>{extra.authInfo.scopes.push('new-scope');}],
  ['scopes withdrawn',extra=>{extra.authInfo.scopes.splice(1,1);}],
  ['expiry renewal',extra=>{extra.authInfo.expiresAt+=60;}]
]){
  for(const stage of ['writer','ledger']){
    test(`NEW original event sync ${name} during ${stage} cannot adopt a new authorization`,async()=>{
      const extra=clone(oauth);extra.authInfo.expiresAt=Math.floor(Date.now()/1000)+60;
      const args=input(),f=fixture(args,{[stage==='writer'?'afterWrite':'afterRead']:()=>change(extra)});
      await assert.rejects(callOutlookEventSync(args,extra,{client:f.client}),/^Error: outlook_sync_write_unconfirmed$/);
      assert.equal(f.calls.length,stage==='writer'?1:2);
      assert.equal(f.calls.filter(call=>call.url.includes('/rpc/')).length,1,'never resend or replace the original');
      assert.deepEqual(f.calls[0].body,{p_action:'apply',p_observation:args.request.observation});
      assert.deepEqual(f.row.source_payload,args.request.observation,'recording original is not undone or relabeled');
    });
  }
}
test('NEW original event sync expiry during ledger read cannot report saved',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const extra=clone(oauth);extra.authInfo.expiresAt=Math.floor(now/1000)+30;
  const args=input(),f=fixture(args,{afterRead:()=>{now+=31000;}});
  await assert.rejects(callOutlookEventSync(args,extra,{client:f.client}),/^Error: outlook_sync_write_unconfirmed$/);
  assert.equal(f.calls.length,2);assert.equal(f.calls.filter(call=>call.url.includes('/rpc/')).length,1);
});
for(const stage of ['writer','ledger']){
  test(`NEW original event sync caller cancellation during ${stage} survives transport ignoring abort`,async()=>{
    const controller=new AbortController(),args=input(),f=fixture(args,{[stage==='writer'?'afterWrite':'afterRead']:()=>controller.abort()});
    await assert.rejects(callOutlookEventSync(args,clone(oauth),{client:f.client,signal:controller.signal}),/^Error: outlook_sync_write_unconfirmed$/);
    assert.equal(f.calls.length,stage==='writer'?1:2);assert.equal(f.calls.at(-1).signal.aborted,true);
    assert.equal(f.calls.filter(call=>call.url.includes('/rpc/')).length,1);
  });
}
test('NEW original event sync merged deadline is checked even when transport returns success',async t=>{
  const deadline=new AbortController();
  t.mock.method(AbortSignal,'timeout',milliseconds=>{assert.equal(milliseconds,10000);return deadline.signal;});
  const args=input(),f=fixture(args,{afterWrite:()=>deadline.abort()});
  await assert.rejects(callOutlookEventSync(args,clone(oauth),{client:f.client,signal:new AbortController().signal}),/^Error: outlook_sync_write_unconfirmed$/);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].signal.aborted,true);
});
test('NEW original event sync initial invalid principal and aborted signal cannot dispatch',async()=>{
  const args=input(),invalid=fixture(args);
  await assert.rejects(callOutlookEventSync(args,{},{client:invalid.client}),/^Error: outlook_sync_principal_required$/);
  assert.equal(invalid.calls.length,0);
  const cancelled=fixture(args);
  await assert.rejects(callOutlookEventSync(args,clone(auth),{client:cancelled.client,signal:AbortSignal.abort()}),/^Error: outlook_sync_write_unconfirmed$/);
  assert.equal(cancelled.calls.length,0);
});
for(const mode of ['current','expired','identity','scope','cancelled']){
  test(`NEW original event sync status ${mode} remains read-only and cannot activate withdrawn owner`,async t=>{
    let now=Date.now();t.mock.method(Date,'now',()=>now);
    const extra=clone(oauth);extra.authInfo.expiresAt=Math.floor(now/1000)+30;
    const cancelled=new AbortController(),args=status(),f=fixture(args,{afterWrite:()=>{
      if(mode==='expired')now+=31000;
      if(mode==='identity')extra.authInfo.extra.subject='new-subject';
      if(mode==='scope')extra.authInfo.scopes.pop();
      if(mode==='cancelled')cancelled.abort();
    }});
    const pending=callOutlookEventSync(args,extra,{client:f.client,signal:cancelled.signal});
    if(mode==='current')assert.equal((await pending).writer_ready,true);
    else await assert.rejects(pending,/^Error: outlook_sync_status_unavailable$/);
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.p_action,'status');
    assert.deepEqual(f.calls[0].body.p_observation,{});
  });
}

test('NEW registered event sync wrapper preserves original authorization through owning readback',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  for(const mode of ['current','expires-at-writer','withdraws-at-ledger','cancelled-at-writer','denied']){
    const controller=new AbortController(),extra=clone(oauth),args=input();
    extra.signal=controller.signal;extra.authInfo.expiresAt=Math.floor(now/1000)+30;
    if(mode==='denied')extra.authInfo.scopes=['mcp:read'];
    const f=fixture(args,{afterWrite:()=>{
      if(mode==='expires-at-writer')now+=31000;
      if(mode==='cancelled-at-writer')controller.abort();
    },afterRead:()=>{if(mode==='withdraws-at-ledger')extra.authInfo.extra.subject='changed-original';}});
    const sdk=new McpServer({name:'synthetic-current-event-owner',version:'1'});
    const register=sdk.registerTool.bind(sdk);let handler;
    sdk.registerTool=(name,definition,callback)=>{
      assert.equal(name,'custodial_outlook_events_sync');handler=callback;
      return register(name,definition,callback);
    };
    configureMcpToolAuth(sdk,{securitySchemes:[{type:'oauth2',scopes:['mcp:read','mcp:write']}],challenge:'Bearer realm="synthetic-original"'});
    try{
      registerOutlookEventTools(sdk,{client:f.client});assert.equal(typeof handler,'function');
      if(mode==='current'){
        const response=await handler(args,extra),value=JSON.parse(response.content[0].text);
        assert.equal(value.readback_verified,true);assert.equal(value.ledger_id,id);
        assert.equal(value.collector_activation_verified,false);assert.equal(f.calls.length,2);
      }else if(mode==='denied'){
        assert.equal((await handler(args,extra)).isError,true);assert.equal(f.calls.length,0);
      }else{
        await assert.rejects(handler(args,extra),/^Error: outlook_sync_write_unconfirmed$/);
        assert.equal(f.calls.length,mode==='withdraws-at-ledger'?2:1);
      }
      assert.ok(f.calls.filter(call=>call.url.includes('/rpc/')).length<=1);
      if(f.calls.length)assert.deepEqual(f.calls[0].body,{p_action:'apply',p_observation:args.request.observation});
    }finally{await sdk.close();}
  }
});
