import assert from 'node:assert/strict';
import {test, after} from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMcpServer} from '../src/mcp/create-mcp-server.js';
import {getToolManifest} from '../src/mcp/tool-manifest.js';
import {configureMcpToolAuth} from '../src/mcp/register.js';
import {registerOutlookEventTools} from '../src/mcp/outlook-event-tools.js';
import {registerOperationsMailTools} from '../src/mcp/operations-mail-tools.js';
import {OUTLOOK_SYNC_CONTRACT, OUTLOOK_SYNC_SCHEMA_SHA256} from '../src/outlook-event-sync.js';
import {OPERATIONS_MAIL_SYNC_CONTRACT, OPERATIONS_MAIL_SYNC_SCHEMA_SHA256} from '../src/operations-mail-sync.js';

// In-memory protocol plus injected inert clients only. No server entry point,
// listener, cloud job, timer/runner, mailbox, SQL service or credential is used.
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('LIVE_NETWORK_FORBIDDEN_IN_REGISTRATION_CONTRACT'); };
const scopes=['mcp:read','mcp:write'];
const names=['custodial_outlook_events_sync','custodial_outlook_operations_import'];
const oauth={authInfo:{clientId:'synthetic-client',scopes:[...scopes],extra:{authSource:'self_contained_oauth',issuer:'fixture',subject:'fixture'}}};
const connector={authInfo:{clientId:'memphis-mcp-connector-token',extra:{authSource:'connector_token'}}};
const options={oauth:{enabled:true,scopes,challenge:'Bearer realm="synthetic", scope="mcp:read mcp:write"'},allowNoAuth:true};
async function linked(server, body){
 const client=new Client({name:'inert-registration-contract',version:'1'});
 const [ct,st]=InMemoryTransport.createLinkedPair();
 try {await server.connect(st);await client.connect(ct);return await body(client);}
 finally {await client.close();await server.close();}
}
test('normal MCP lists both restored writers exactly once with private scopes; anonymous calls fail before dispatch',async()=>{
 await linked(createMcpServer(options),async client=>{
  const listed=(await client.listTools()).tools;
  for(const name of names){
   const found=listed.filter(t=>t.name===name);assert.equal(found.length,1);
   assert.deepEqual(found[0]._meta.securitySchemes,[{type:'oauth2',scopes}]);
   const arguments_=name===names[0]?{contract_version:OUTLOOK_SYNC_CONTRACT,request:{action:'status',observation:{}}}:{
    contract_version:OPERATIONS_MAIL_SYNC_CONTRACT,
    request:{kind:'spiceworks',evidence:{original_message_read:true,notification_fields_unquoted:true},observation:{
     source:{mailbox:'eoperle@memphiszoo.org',sender:'help@memzoomaint.on.spiceworks.com',message_id:'inert-auth-original',content_sha256:'a'.repeat(64),source_at:'2026-10-08T10:00:00Z'},
     ticket_id:'6880',change_lines:['set category to Custodial'],
    }},
   };
   const denied=await client.callTool({name,arguments:arguments_});assert.equal(denied.isError,true);
   assert.match(denied._meta['mcp/www_authenticate'][0],/mcp:read mcp:write/);
  }
  assert.equal(listed.filter(t=>t.name==='ping').length,1);
 });
});
for(const settings of [{readOnly:true},{includePrivilegedTools:false}])test(`read-only registration omits both imports: ${JSON.stringify(settings)}`,async()=>{
 await linked(createMcpServer({...options,...settings}),async client=>{
  const listed=(await client.listTools()).tools;for(const name of names)assert.equal(listed.some(t=>t.name===name),false);
  assert.equal(listed.some(t=>t.name==='ping'),true);
 });
});
test('machine-readable catalog binds both exact typed contracts and existing privileged classification',()=>{
 const tools=getToolManifest({includePlanned:false}).tools;
 for(const [name,contract,digest]of [[names[0],OUTLOOK_SYNC_CONTRACT,OUTLOOK_SYNC_SCHEMA_SHA256],[names[1],OPERATIONS_MAIL_SYNC_CONTRACT,OPERATIONS_MAIL_SYNC_SCHEMA_SHA256]]){
  const found=tools.filter(t=>t.name===name);assert.equal(found.length,1);const t=found[0];
  assert.equal(t.safety,'safe-write');assert.deepEqual(t.required_scopes,scopes);assert.equal(t.contract_version,contract);assert.equal(t.adapter_schema_sha256,digest);assert.equal(t.input_schema.additionalProperties,false);
 }
});
function captured(register,client){
 const handlers=new Map();const server={registerTool(name,definition,handler){assert.equal(handlers.has(name),false);handlers.set(name,{definition,handler});}};
 configureMcpToolAuth(server,{securitySchemes:[{type:'oauth2',scopes}],challenge:options.oauth.challenge});register(server,{client});return [...handlers.values()][0].handler;
}
for(const [label,extra]of [['anonymous',{}],['read-only',{authInfo:{...oauth.authInfo,scopes:['mcp:read']}}],['write-only',{authInfo:{...oauth.authInfo,scopes:['mcp:write']}}]])test(`${label} has no adapter dispatch for either registered writer`,async()=>{
 let calls=0;const client={rpc(){calls++;throw new Error('INERT_CLIENT_MUST_NOT_DISPATCH');},from(){calls++;throw new Error('INERT_CLIENT_MUST_NOT_DISPATCH');}};
 for(const register of [registerOutlookEventTools,registerOperationsMailTools])assert.equal((await captured(register,client)({},extra)).isError,true);
 assert.equal(calls,0);
});
for(const [label,extra]of [['forged connector',{authInfo:{...connector.authInfo,clientId:'wrong-client'}}],['expired',{authInfo:{...oauth.authInfo,expiresAt:1}}],['invalid expiry',{authInfo:{...oauth.authInfo,expiresAt:'later'}}],['untrusted source',{authInfo:{...oauth.authInfo,extra:{...oauth.authInfo.extra,authSource:'unknown'}}}]])test(`${label} cannot reach either injected service`,async()=>{
 let calls=0;const client={rpc(){calls++;},from(){calls++;}};
 for(const register of [registerOutlookEventTools,registerOperationsMailTools])await assert.rejects(captured(register,client)({},extra),/principal_required/);
 assert.equal(calls,0);
});
for(const [label,extra]of [['OAuth',oauth],['connector',connector]])test(`${label} reaches the exact event status service and strict operations schema without network`,async()=>{
 const calls=[];const client={rpc(name,args){calls.push({name,args});return{abortSignal(signal){assert.ok(signal instanceof AbortSignal);return{retry(value){assert.equal(value,false);return Promise.resolve({data:{schema:'custodial.outlook-event-sync.v1',writer_ready:true,mailbox:'eoperle@memphiszoo.org',cursor:null,checkpoint_at:null,last_import_at:null},error:null});}};}};}};
 const result=await captured(registerOutlookEventTools,client)({contract_version:OUTLOOK_SYNC_CONTRACT,request:{action:'status',observation:{}}},extra);
 const payload=JSON.parse(result.content[0].text);assert.equal(payload.writer_ready,true);assert.deepEqual(calls,[{name:'custodial_outlook_event_sync_v1',args:{p_action:'status',p_observation:{}}}]);
 await assert.rejects(captured(registerOperationsMailTools,client)({unexpected:'field'},extra),error=>error.name==='ZodError');assert.equal(calls.length,1);
});
after(()=>{globalThis.fetch=originalFetch;});

// The selected SQL returns exactly this four-key envelope on an already-saved
// source identity. It omits schema; acceptance still requires the original
// ledger/source payload and invocation authority readback, never a second send.
function replayObservation(action='apply') {
 const source={mailbox:'eoperle@memphiszoo.org',message_id:'inert-replay-original',content_sha256:'a'.repeat(64),evidence_kind:action==='cancel'?'event_cancellation':'original_event_notice',source_at:'2026-10-08T10:00:00Z',received_at:'2026-10-08T10:01:00Z'};
 const observation={source,source_event_key:'inert-replay-event'};
 if(action==='review')return{...observation,reason:'End time unresolved.'};
 if(action==='cancel')return{...observation,event_id:'12000000-0000-4000-8000-000000000001',expected_revision:3,reason:'Original cancellation.'};
 return{...observation,event:{event_name:'Synthetic event',event_scope:'SINGLE_VENUE',primary_venue_id:'12000000-0000-4000-8000-000000000001',event_date:'2026-10-09',end_date:'2026-10-09',start_time:'10:00:00',end_time:'11:00:00',start_instant_utc:'2026-10-09T15:00:00Z',end_instant_utc:'2026-10-09T16:00:00Z',attendee_count:null}};
}
function replayCase({action='apply',state='APPLIED',eventId='12000000-0000-4000-8000-000000000001',alterResult=()=>{},alterRow=()=>{},afterRPC=()=>{},afterRead=()=>{}}={}) {
 const observation=replayObservation(action),args={contract_version:OUTLOOK_SYNC_CONTRACT,request:{action,observation}},ledger='11000000-0000-4000-8000-000000000001';
 const response={state,event_id:eventId,replayed:true,ledger_id:ledger};
 const row={id:ledger,event_id:eventId,outlook_message_id:observation.source.message_id,source_event_key:'custodial-outlook-events-v1/event/'+observation.source_event_key,payload_hash:'b'.repeat(64),sync_status:state,source_payload:JSON.parse(JSON.stringify(observation))};
 alterResult(response);alterRow(row);const calls=[];
 const chain={select(value){calls.push(['select',value]);return this;},eq(name,value){calls.push(['eq',name,value]);return this;},abortSignal(signal){assert.ok(signal instanceof AbortSignal);return this;},retry(value){assert.equal(value,false);return this;},async single(){await afterRead();return{data:row,error:null};}};
 const client={rpc(name,value){calls.push(['rpc',name,value]);return{abortSignal(signal){assert.ok(signal instanceof AbortSignal);return{async retry(value){assert.equal(value,false);await afterRPC();return{data:response,error:null};}};}};},from(name){calls.push(['from',name]);return chain;}};
 return{args,client,calls,row,response};
}
async function invokeReplay(f,extra=structuredClone(oauth)) {
 const {callOutlookEventSync}=await import('../src/outlook-event-sync.js');
 return callOutlookEventSync(f.args,extra,{client:f.client,signal:extra.signal});
}
for(const [state,action,eventId]of [
 ['APPLIED','apply','12000000-0000-4000-8000-000000000001'],
 ['CANCELLED','cancel','12000000-0000-4000-8000-000000000001'],
 ['UNCHANGED','apply','12000000-0000-4000-8000-000000000001'],
 ['NEEDS_REVIEW','review',null],
 ['BLOCKED_MANUAL','apply','12000000-0000-4000-8000-000000000001'],
])test(`Outlook SQL replay exact ${state} is accepted only after unchanged original ledger readback`,async()=>{
 const f=replayCase({state,action,eventId}),r=await invokeReplay(f);
 assert.equal(r.state,state);assert.equal(r.replayed,true);assert.equal(r.readback_verified,true);assert.equal(r.event_id,eventId);assert.equal(r.ledger_id,f.row.id);assert.equal(r.collector_activation_verified,false);assert.equal(r.external_mail_or_ticket_mutation,false);
 assert.equal(f.calls.filter(c=>c[0]==='rpc').length,1);assert.equal(f.calls.filter(c=>c[0]==='from').length,1);
 assert.deepEqual(f.calls.find(c=>c[0]==='rpc').slice(1),['custodial_outlook_event_sync_v1',{p_action:action,p_observation:f.args.request.observation}]);
});
for(const [label,change]of [
 ['nonreplay missing schema',r=>r.replayed=false],['missing replay marker',r=>delete r.replayed],['string replay marker',r=>r.replayed='true'],
 ['missing ledger',r=>delete r.ledger_id],['invalid ledger',r=>r.ledger_id='not-a-uuid'],['foreign ledger',r=>r.ledger_id='11000000-0000-4000-8000-000000000002'],
 ['unknown state',r=>r.state='ERROR'],['different state',r=>r.state='CANCELLED'],['foreign event',r=>r.event_id='12000000-0000-4000-8000-000000000002'],['missing event',r=>delete r.event_id],
 ['extra source hash',r=>r.source_sha256='b'.repeat(64)],['extra field',r=>r.extra='unsupported'],['wrong present schema',r=>r.schema='wrong'],['null present schema',r=>r.schema=null],['undefined present schema',r=>r.schema=undefined],
])test(`Outlook SQL replay rejects ${label}`,async()=>{const f=replayCase({alterResult:change});await assert.rejects(invokeReplay(f),/outlook_sync_readback_unconfirmed/);});
for(const [label,change]of [
 ['different payload',r=>r.source_payload.source.content_sha256='c'.repeat(64)],['foreign message',r=>r.outlook_message_id='foreign-message'],['foreign source key',r=>r.source_event_key='foreign-key'],
 ['invalid payload hash',r=>r.payload_hash='not-a-digest'],['invalid row ledger',r=>r.id='not-a-uuid'],['invalid event identity',r=>r.event_id='not-a-uuid'],
])test(`Outlook SQL replay still rejects ${label} in authoritative row`,async()=>{const f=replayCase({alterRow:change});await assert.rejects(invokeReplay(f),/outlook_sync_readback_unconfirmed/);});
test('Outlook SQL replay fresh response still requires exact schema and retains fresh output',async()=>{
 const f=replayCase({alterResult:r=>{r.schema='custodial.outlook-event-sync.v1';r.replayed=false;r.source_sha256='b'.repeat(64);}}),r=await invokeReplay(f);
 assert.equal(r.replayed,false);assert.equal(r.readback_verified,true);
 const wrong=replayCase({alterResult:r=>{r.schema='wrong';r.replayed=false;}});await assert.rejects(invokeReplay(wrong),/outlook_sync_readback_unconfirmed/);
});
for(const [phase,change]of [
 ['RPC',extra=>extra.authInfo.extra.subject='new-subject'],['readback',extra=>extra.authInfo.scopes.pop()],
])test(`Outlook SQL replay preserves original principal after ${phase}`,async()=>{
 const extra=structuredClone(oauth);const f=replayCase(phase==='RPC'?{afterRPC:()=>change(extra)}:{afterRead:()=>change(extra)});
 await assert.rejects(invokeReplay(f,extra),/outlook_sync_write_unconfirmed/);
});
for(const phase of ['before','RPC','readback'])test(`Outlook SQL replay preserves cancellation ${phase}`,async()=>{
 const controller=new AbortController(),extra={...structuredClone(oauth),signal:controller.signal};
 if(phase==='before')controller.abort();const f=replayCase(phase==='RPC'?{afterRPC:()=>controller.abort()}:phase==='readback'?{afterRead:()=>controller.abort()}:{});
 await assert.rejects(invokeReplay(f,extra),/outlook_sync_write_unconfirmed/);
 if(phase==='before')assert.equal(f.calls.length,0);
});
test('Outlook SQL replay expired principal cannot dispatch',async()=>{
 const extra=structuredClone(oauth);extra.authInfo.expiresAt=1;const f=replayCase();await assert.rejects(invokeReplay(f,extra),/outlook_sync_principal_required/);assert.equal(f.calls.length,0);
});

// The actual current issuer helpers remain byte-literal. Only the express
// import's resolution and a private-helper export wrapper are adapted in memory
// so these tests need no HTTP server, production key, registration or token.
let actualIssuerFixture;
async function issuedLongClientAuthority(){
 if(!actualIssuerFixture)actualIssuerFixture=(async()=>{
  const {readFile}=await import('node:fs/promises');
  const raw=await readFile(new URL('../src/auth/mcp-self-contained-oauth.js',import.meta.url),'utf8');
  const original='import express from "express";';assert.equal(raw.split(original).length,2);
  const wrapped=raw.replace(original,`import express from ${JSON.stringify(import.meta.resolve('express'))};`)
   +'\nexport {validateRegistrationRequest,issueClientId,verifyClientId,issueTokenPair};\n';
  const issuer=await import('data:text/javascript;base64,'+Buffer.from(wrapped).toString('base64'));
  const config=issuer.getSelfContainedMcpOAuthConfig({NODE_ENV:'test',MCP_OAUTH_ENABLED:'true',MCP_PUBLIC_URL:'http://127.0.0.1:3000',MCP_CONNECTOR_TOKEN:'synthetic-local-root-credential-for-only-this-inert-test',MOXIE_WEB_PASSWORD:'synthetic-local-operator-password'});
  assert.equal(config.ready,true);const now=Math.floor(Date.now()/1000);
  const metadata=issuer.validateRegistrationRequest({client_name:'review-fixture',redirect_uris:['a','b','c','d'].map(c=>'https://chatgpt.com/connector/oauth/'+c.repeat(256)),scope:'mcp:read mcp:write'});
  const clientId=issuer.issueClientId(config,metadata,now);assert.ok(Buffer.byteLength(clientId,'utf8')>2048);assert.ok(Buffer.byteLength(clientId,'utf8')<=6144);
  assert.deepEqual(issuer.verifyClientId(config,clientId,now),metadata);
  const tokens=issuer.issueTokenPair(config,{clientId,scope:'mcp:read mcp:write'},now);
  const verified=issuer.verifyMcpOAuthAccessToken(config,tokens.access_token,{now:()=>now*1000,requiredScopes:['mcp:read','mcp:write']});
  assert.equal(verified.clientId,clientId);assert.deepEqual(verified.scopes,['mcp:read','mcp:write']);
  return{authInfo:verified,clientBytes:Buffer.byteLength(clientId,'utf8'),clientCharacters:clientId.length};
 })();return actualIssuerFixture;
}
function inertOperationsClient(){
 let row;const calls=[];
 const query={eq(){return this;},abortSignal(signal){assert.ok(signal instanceof AbortSignal);return this;},async single(){return{data:row,error:null};}};
 return{calls,client:{rpc(name,args){calls.push(name);return{abortSignal(signal){assert.ok(signal instanceof AbortSignal);return Promise.resolve({data:name==='custodial_begin_application_mutation_lease'?{mutations_paused:false,authority_generation:1}:true,error:null});}};},from(name){assert.equal(name,'events_app_outlook_sync');return{upsert(value,options){calls.push('upsert');assert.deepEqual(options,{onConflict:'outlook_message_id,source_event_key',ignoreDuplicates:true});row={...structuredClone(value),id:'11000000-0000-4000-8000-000000000001',created_at:'2026-10-08T10:01:00Z'};return{abortSignal(signal){assert.ok(signal instanceof AbortSignal);return Promise.resolve({error:null});}};},select(){calls.push('select');return query;}};}}};
}
function inertSpiceObservation(){return{contract_version:OPERATIONS_MAIL_SYNC_CONTRACT,request:{kind:'spiceworks',evidence:{original_message_read:true,notification_fields_unquoted:true},observation:{source:{mailbox:'eoperle@memphiszoo.org',sender:'help@memzoomaint.on.spiceworks.com',message_id:'synthetic-long-client-source',content_sha256:'a'.repeat(64),source_at:'2026-10-08T10:00:00Z'},ticket_id:'6880',change_lines:['set category to Custodial']}}};}
async function exerciseThreeClientValidators(authInfo){
 const [{callOutlookEventSync},{callOperationsMailSync},{callFeedbackRelay,FEEDBACK_RELAY_CONTRACT}]=await Promise.all([import('../src/outlook-event-sync.js'),import('../src/operations-mail-sync.js'),import('../src/feedback-email-relay.js')]);
 const outClient={rpc(name,args){assert.equal(name,'custodial_outlook_event_sync_v1');assert.deepEqual(args,{p_action:'status',p_observation:{}});return{abortSignal(signal){assert.ok(signal instanceof AbortSignal);return{retry(value){assert.equal(value,false);return Promise.resolve({data:{schema:'custodial.outlook-event-sync.v1',writer_ready:true,mailbox:'eoperle@memphiszoo.org',cursor:null,checkpoint_at:null,last_import_at:null},error:null});}};}};}};
 const ops=inertOperationsClient();
 const relayClient={async rpc(name){assert.equal(name,'custodial_feedback_relay_status');return{data:{ok:true,may_send:false,transport_paused:true},error:null};}};
 return Promise.allSettled([
  callOutlookEventSync({contract_version:OUTLOOK_SYNC_CONTRACT,request:{action:'status',observation:{}}},{authInfo},{client:outClient}),
  callOperationsMailSync(inertSpiceObservation(),{authInfo},{client:ops.client}),
  callFeedbackRelay('status',{contract_version:FEEDBACK_RELAY_CONTRACT},{authInfo},{client:relayClient}),
 ]);
}
async function acceptAllClientValidators(authInfo){
 const results=await exerciseThreeClientValidators(authInfo);assert.deepEqual(results.map(r=>r.status),['fulfilled','fulfilled','fulfilled']);
 assert.equal(results[0].value.writer_ready,true);assert.equal(results[1].value.state,'SAVED_READBACK');assert.equal(results[1].value.collector_activation_verified,false);assert.equal(results[2].value.may_send,false);assert.equal(results[2].value.transport_paused,true);return results;
}
async function rejectAllClientValidators(authInfo){
 const results=await exerciseThreeClientValidators(authInfo);assert.deepEqual(results.map(r=>r.status),['rejected','rejected','rejected']);
 assert.match(results[0].reason.message,/principal_required/);assert.match(results[1].reason.message,/principal_required/);assert.match(results[2].reason.message,/authorization|principal/);
}
test('OAuth clientId issuer-generated and verified >2048-byte identity reaches all three unchanged service contracts',async t=>{
 const issued=await issuedLongClientAuthority();const results=await exerciseThreeClientValidators(issued.authInfo);
 t.diagnostic(JSON.stringify({actual_issuer_validated:true,token_verified_with_both_scopes:true,client_bytes:issued.clientBytes,client_characters:issued.clientCharacters,adapter_statuses:results.map(r=>r.status),rejection_reasons:results.map(r=>r.status==='rejected'?r.reason.message:null),live_service:false}));
 assert.deepEqual(results.map(r=>r.status),['fulfilled','fulfilled','fulfilled']);assert.equal(results[0].value.writer_ready,true);assert.equal(results[1].value.state,'SAVED_READBACK');assert.equal(results[2].value.may_send,false);
});
for(const [label,value]of [['ASCII6144','x'.repeat(6144)],['UTF8two-byte6144','é'.repeat(3072)],['UTF8four-byte6144','😀'.repeat(1536)]])test(`OAuth clientId accepted exact byte boundary ${label}`,async()=>{
 const issued=await issuedLongClientAuthority();const auth=structuredClone(issued.authInfo);auth.clientId=value;assert.equal(Buffer.byteLength(value,'utf8'),6144);await acceptAllClientValidators(auth);
});
for(const [label,change]of [
 ['ASCII6145',a=>a.clientId='x'.repeat(6145)],['UTF8two-byte6145',a=>a.clientId='é'.repeat(3072)+'x'],['UTF8four-byte6148',a=>a.clientId='😀'.repeat(1537)],
 ['empty',a=>a.clientId=''],['nonstring',a=>a.clientId=123],['null',a=>a.clientId=null],
 ['expired',a=>a.expiresAt=1],['invalid expiry',a=>a.expiresAt='later'],['wrong auth source',a=>a.extra.authSource='untrusted'],
 ['read-only',a=>a.scopes=['mcp:read']],['write-only',a=>a.scopes=['mcp:write']],['issuer remains2048chars',a=>a.extra.issuer='x'.repeat(2049)],['subject remains2048chars',a=>a.extra.subject='x'.repeat(2049)],
])test(`OAuth clientId all three validators reject ${label}`,async()=>{
 const issued=await issuedLongClientAuthority();const auth=structuredClone(issued.authInfo);change(auth);await rejectAllClientValidators(auth);
});
test('OAuth clientId full supported identity remains bound without truncation',async()=>{
 const issued=await issuedLongClientAuthority();const {feedbackRelayPrincipal}=await import('../src/feedback-email-relay.js');
 const first=structuredClone(issued.authInfo),second=structuredClone(issued.authInfo);first.clientId='x'.repeat(2048)+'first';second.clientId='x'.repeat(2048)+'second';assert.notEqual(feedbackRelayPrincipal({authInfo:first}),feedbackRelayPrincipal({authInfo:second}));
 const extra={authInfo:structuredClone(issued.authInfo)};const f=replayCase({afterRPC:()=>{extra.authInfo.clientId=extra.authInfo.clientId.slice(0,-1)+(extra.authInfo.clientId.endsWith('a')?'b':'a');}});
 await assert.rejects(invokeReplay(f,extra),/outlook_sync_write_unconfirmed/);
});
