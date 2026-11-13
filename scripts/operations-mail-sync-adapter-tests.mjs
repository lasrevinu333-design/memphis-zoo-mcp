import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createClient} from '@supabase/supabase-js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {readFileSync} from 'node:fs';
import {callOperationsMailSync,operationsMailSyncSchema,OPERATIONS_MAIL_SYNC_CONTRACT,OPERATIONS_MAIL_SYNC_SCHEMA_SHA256} from '../src/operations-mail-sync.js';
import {registerOperationsMailTools} from '../src/mcp/operations-mail-tools.js';
import {configureMcpToolAuth,finalizeMcpToolAuth} from '../src/mcp/register.js';
import {getToolManifest} from '../src/mcp/tool-manifest.js';
import {readOperationsMailLedger} from '../src/operations-mail-ledger.js';
import {SCHOOL_HEADERS} from '../src/operations-mail-contract.js';
const clone=v=>JSON.parse(JSON.stringify(v));
const auth={authInfo:{clientId:'memphis-mcp-connector-token',extra:{authSource:'connector_token'}}};
const oauth={authInfo:{clientId:'synthetic-client',scopes:['mcp:read','mcp:write'],extra:{authSource:'self_contained_oauth',issuer:'fixture',subject:'fixture-subject'}}};
const source={mailbox:'eoperle@memphiszoo.org',sender:'help@memzoomaint.on.spiceworks.com',message_id:'synthetic-original-ticket',content_sha256:'a'.repeat(64),source_at:'2026-10-08T10:00:00Z'};
const spice=(lines=['set category to Custodial','set assignee to Eric Operle','changed status from Pending -> Open'],delta={})=>({contract_version:OPERATIONS_MAIL_SYNC_CONTRACT,
  request:{kind:'spiceworks',evidence:{original_message_read:true,notification_fields_unquoted:true},observation:{source:clone(source),ticket_id:'6880',change_lines:lines,...delta}}});
const school=(delta={})=>({contract_version:OPERATIONS_MAIL_SYNC_CONTRACT,request:{kind:'school',
  evidence:{original_message_read:true,attachment_read_complete:true,complete_date_scope_verified:true},observation:{
    source:{...source,sender:'aferguson@memphiszoo.org',message_id:'synthetic-original-school'},attachment:{id:'synthetic-school-attachment',sha256:'b'.repeat(64)},
    headers:[...SCHOOL_HEADERS],rows:[[100,'Synthetic School',1,'Field Trip Elem Student 1-5','2026-10-09','09:00',20],
      [null,null,null,'Field Trip Paid Chaperone',null,null,2],[null,null,null,'Field Trip Teacher',null,null,1]],complete_for_dates:['2026-10-09'],...delta}}});
function fixture(options={}){
  const rows=[],calls=[],leases=new Set();let sequence=0;
  const client=createClient('https://operations-fixture.example.invalid','synthetic-fixture-role',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init={})=>{
    const url=new URL(input);assert.equal(url.hostname,'operations-fixture.example.invalid');
    const body=init.body?JSON.parse(init.body):null;calls.push({url:String(url),method:init.method,body,signal:init.signal});
    if(init.signal?.aborted)throw new Error('synthetic cancellation');
    const reply=(data,status=200,count)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json',...(count===undefined?{}:{'content-range':`0-${Math.max(0,count-1)}/${count}`})}});
    if(url.pathname.endsWith('/rpc/custodial_begin_application_mutation_lease')){
      assert.equal(body.p_service_name,'custodial-operations-outlook-import');assert.match(body.p_request_id,/^[a-f0-9-]{36}$/);
      if(options.beginError)return reply({message:'Synthetic restore hold',code:'P0001'},400);
      if(options.beginInvalid)return reply({mutations_paused:true,authority_generation:1});
      leases.add(body.p_request_id);return reply({mutations_paused:false,authority_generation:1});
    }
    if(url.pathname.endsWith('/rpc/custodial_release_application_mutation_lease')){
      assert.ok(leases.has(body.p_request_id));
      if(options.releaseError)return reply(false);
      leases.delete(body.p_request_id);return reply(true);
    }
    assert.equal(url.pathname,'/rest/v1/events_app_outlook_sync');
    if(init.method==='POST'){
      assert.equal(leases.size,1);assert.equal(url.searchParams.get('on_conflict'),'outlook_message_id,source_event_key');
      assert.match(init.headers.get('Prefer'),/resolution=ignore-duplicates/);
      if(options.throwWrite)throw new Error('Synthetic uncertain write');
      if(options.writeError)return reply({message:'Synthetic write error',code:'P0001'},400);
      if(!rows.some(r=>r.outlook_message_id===body.outlook_message_id&&r.source_event_key===body.source_event_key)){
        rows.push({...clone(body),id:`11000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`,created_at:'2026-10-08T10:01:00Z'});
      }
      return new Response(null,{status:201});
    }
    assert.equal(init.method,'GET');
    if(options.readError)return reply({message:'Synthetic read error',code:'P0001'},400);
    const message=url.searchParams.get('outlook_message_id'),key=url.searchParams.get('source_event_key');
    if(message){
      assert.equal(leases.size,1);const found=rows.find(r=>`eq.${r.outlook_message_id}`===message&&`eq.${r.source_event_key}`===key);
      const row=options.rowDelta?{...clone(found),...options.rowDelta}:clone(found);
      return reply(row);
    }
    assert.equal(key,'like.custodial-operations-v1/%');return reply(rows,200,rows.length);
  }}});
  return {client,calls,rows,leases};
}
test('typed private source catalog and canonical registration are bound',()=>{
  const t=getToolManifest().tools.find(t=>t.name==='custodial_outlook_operations_import');
  assert.equal(t.safety,'safe-write');assert.deepEqual(t.required_scopes,['mcp:read','mcp:write']);
  assert.equal(t.contract_version,OPERATIONS_MAIL_SYNC_CONTRACT);assert.equal(t.adapter_schema_sha256,OPERATIONS_MAIL_SYNC_SCHEMA_SHA256);assert.equal(t.input_schema.additionalProperties,false);
  assert.match(readFileSync(new URL('../src/mcp/create-mcp-server.js',import.meta.url),'utf8'),/registerOperationsMailTools\(server, \{ includeWrites: includePrivilegedTools \}\)/);
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.match(pkg.scripts['test:mcp-auth'],/operations-mail-sync-adapter-tests/);assert.match(pkg.scripts['test:operations-mail'],/operations-mail-sync-adapter-tests/);
});
for(const [name,extra] of [['anonymous',{}],['read only',{authInfo:{...oauth.authInfo,scopes:['mcp:read']}}],['write only',{authInfo:{...oauth.authInfo,scopes:['mcp:write']}}],
  ['forged connector',{authInfo:{...auth.authInfo,clientId:'other'}}],['untrusted auth source',{authInfo:{...oauth.authInfo,extra:{...oauth.authInfo.extra,authSource:'other'}}}],
  ['expired',{authInfo:{...oauth.authInfo,expiresAt:1}}],['invalid expiry',{authInfo:{...oauth.authInfo,expiresAt:'later'}}],['missing issuer',{authInfo:{...oauth.authInfo,extra:{...oauth.authInfo.extra,issuer:''}}}]])
  test(`${name} cannot dispatch an import`,async()=>{const f=fixture();await assert.rejects(callOperationsMailSync(spice(),extra,{client:f.client}),/principal_required/);assert.equal(f.calls.length,0);});
for(const extra of [auth,oauth])for(const args of [spice(),school()])test(`accepted ${extra.authInfo.extra.authSource}/${args.request.kind} uses exact leased readback`,async()=>{
  const f=fixture(),r=await callOperationsMailSync(args,extra,{client:f.client});assert.equal(r.state,'SAVED_READBACK');assert.equal(r.readback_verified,true);
  assert.equal(r.collector_activation_verified,false);assert.equal(r.mailbox_completeness_verified,false);assert.equal(r.external_ticket_mutation,false);
  assert.equal(f.calls.length,4);assert.equal(f.leases.size,0);assert.ok(f.calls.every(c=>c.signal instanceof AbortSignal));
  assert.equal(f.calls[1].body.source_payload.kind,args.request.kind);assert.deepEqual(f.calls[1].body.source_payload.observation,args.request.observation);
  assert.ok(!JSON.stringify(r).includes(args.request.observation.source.message_id));assert.ok(!JSON.stringify(r).includes('source_payload'));
});
for(const [name,make,change] of [
  ['wrong mailbox',spice,a=>a.request.observation.source.mailbox='other@example.com'],['wrong sender',spice,a=>a.request.observation.source.sender='other@example.com'],
  ['raw email body',spice,a=>a.request.observation.body='Private'],['raw source body',spice,a=>a.request.observation.source.body='Private'],
  ['recipients',spice,a=>a.request.observation.recipients=['private@example.com']],['generic SQL',spice,a=>a.request.sql='select 1'],
  ['AI digest',spice,a=>a.request.evidence.original_message_read=false],['quoted fields',spice,a=>a.request.evidence.notification_fields_unquoted=false],
  ['unsupported kind',spice,a=>a.request.kind='event'],['missing digest',spice,a=>delete a.request.observation.source.content_sha256],
  ['control characters',spice,a=>a.request.observation.title='unsafe\ntext'],['invalid ticket',spice,a=>a.request.observation.ticket_id='0'],
  ['bad attachment digest',school,a=>a.request.observation.attachment.sha256='bad'],['partial attachment',school,a=>a.request.evidence.attachment_read_complete=false],
  ['guessed scope',school,a=>a.request.evidence.complete_date_scope_verified=false],['no complete dates',school,a=>a.request.observation.complete_for_dates=[]],
  ['wrong date system',school,a=>a.request.observation.date_system='1904'],['incorrect headers',school,a=>a.request.observation.headers[0]='id'],
  ['non-cell object',school,a=>a.request.observation.rows[0][6]={qty:20}],['cell bool',school,a=>a.request.observation.rows[0][6]=true],
])test(`${name} refused before lease admission`,async()=>{const args=make();change(args);const f=fixture();await assert.rejects(callOperationsMailSync(args,auth,{client:f.client}));assert.equal(f.calls.length,0);});
for(const lines of [['The gate will not latch closed'],['Could this ticket be closed?'],['> changed status from Open -> Closed'],['set category to Custodial','set category to Other']])
  test(`non-authoritative or ambiguous change ${JSON.stringify(lines)} creates no record`,async()=>{const f=fixture();await assert.rejects(callOperationsMailSync(spice(lines),auth,{client:f.client}));assert.equal(f.calls.length,0);});
for(const [name,options,reason] of [['paused restore',{beginError:true},'mutation_unavailable'],['invalid lease',{beginInvalid:true},'mutation_unavailable'],
  ['write error',{writeError:true},'write_unconfirmed'],['lost write reply',{throwWrite:true},'write_unconfirmed'],['lost readback',{readError:true},'readback_unavailable'],
  ['release unconfirmed',{releaseError:true},'cleanup_unconfirmed'],['changed digest',{rowDelta:{payload_hash:'c'.repeat(64)}},'binding_invalid'],
  ['wrong source',{rowDelta:{outlook_message_id:'other'}},'binding_invalid'],['wrong namespace',{rowDelta:{source_event_key:'other'}},'binding_invalid'],
  ['wrong event',{rowDelta:{event_id:'unexpected'}},'record_invalid'],['wrong disposition',{rowDelta:{sync_status:'NEEDS_REVIEW'}},'record_invalid']])
  test(`${name} preserves exact reconciliation identity, never saved`,async()=>{const f=fixture(options),r=await callOperationsMailSync(spice(),auth,{client:f.client});
    assert.equal(r.state,'UNCONFIRMED');assert.equal(r.readback_verified,false);assert.equal(r.reconciliation_required,true);assert.match(r.reason,new RegExp(reason+'$'));
    assert.match(r.request_id,/^[a-f0-9-]{36}$/);assert.equal(r.request_id,f.calls[0].body.p_request_id);
    if(!options.beginError&&!options.beginInvalid)assert.equal(r.request_id,f.calls.at(-1).body.p_request_id);
    assert.ok(f.calls.length<=4);assert.ok(!JSON.stringify(r).includes(source.message_id));
  });
test('already cancelled import cannot claim persistence',async()=>{const f=fixture();const r=await callOperationsMailSync(spice(),auth,{client:f.client,signal:AbortSignal.abort()});assert.equal(r.state,'UNCONFIRMED');assert.equal(f.rows.length,0);});
test('exact replay retains one original; changed replay does not overwrite it',async()=>{
  const f=fixture(),a=spice();const first=await callOperationsMailSync(a,auth,{client:f.client});
  assert.equal((await callOperationsMailSync(clone(a),auth,{client:f.client})).id,first.id);assert.equal(f.rows.length,1);
  const conflict=spice(['changed status from Open -> Closed']);assert.equal((await callOperationsMailSync(conflict,auth,{client:f.client})).reason,'operations_mail_replay_conflict');
  assert.equal(f.rows.length,1);assert.deepEqual(f.rows[0].source_payload.observation.change_lines,a.request.observation.change_lines);assert.equal(f.leases.size,0);
});
test('out-of-order closure/reopen/reassignment persists into truthful existing manager projection',async()=>{
  const f=fixture();await callOperationsMailSync(spice(),auth,{client:f.client});
  async function observe(lines,id,at){return callOperationsMailSync(spice(lines,{source:{...source,message_id:id,source_at:at}}),auth,{client:f.client});}
  await observe(['changed status from Open -> Closed'],'synthetic-closure','2026-10-08T12:00:00Z');
  await observe(['changed status from Pending -> Open'],'synthetic-stale-open','2026-10-08T11:00:00Z');
  let view=await readOperationsMailLedger({client:f.client});assert.equal(view.spiceworks.rows[0].active,false);assert.equal(view.spiceworks.state,'snapshot');assert.equal(view.spiceworks.coverage,'imported_only');
  await observe(['changed status from Closed -> Open'],'synthetic-reopened','2026-10-08T13:00:00Z');
  view=await readOperationsMailLedger({client:f.client});assert.equal(view.spiceworks.rows[0].active,true);assert.equal(view.spiceworks.rows[0].custodial,true);
  await observe(['set category to Veterinary'],'synthetic-reassigned','2026-10-08T14:00:00Z');
  view=await readOperationsMailLedger({client:f.client});assert.equal(view.spiceworks.rows[0].custodial,false);assert.equal(view.spiceworks.mailbox_completeness_verified,false);
});
test('school original cells retain separate counts, unknown departure and corrected complete-date cancellation',async()=>{
  const f=fixture();await callOperationsMailSync(school(),auth,{client:f.client});let v=(await readOperationsMailLedger({client:f.client})).schools.rows[0];
  assert.equal(v.students,20);assert.equal(v.chaperones,2);assert.equal(v.teachers,1);assert.equal(v.total,23);assert.equal(v.departure_at,null);
  assert.equal(v.departure_source,null);assert.equal(v.status,'SCHEDULED');
  await callOperationsMailSync(school({source:{...source,sender:'aferguson@memphiszoo.org',message_id:'synthetic-complete-correction',source_at:'2026-10-08T11:00:00Z'},rows:[]}),auth,{client:f.client});
  v=(await readOperationsMailLedger({client:f.client})).schools.rows[0];assert.equal(v.status,'CANCELLED');assert.equal(v.total,23);
});
for(const [name,date,time,expectedArrival,expectedStatus] of [['missing arrival','2026-10-09',null,null,'REVIEW_REQUIRED'],['late arrival','2026-10-09','14:00','2026-10-09T19:00:00.000Z','SCHEDULED'],['winter arrival','2026-11-02','09:00','2026-11-02T15:00:00.000Z','SCHEDULED']])
  test(`${name} preserved without invented timing`,async()=>{const a=school({rows:[[100,'Synthetic School',1,'Field Trip Elem Student 1-5',date,time,20]],complete_for_dates:[date]}),f=fixture();
    const saved=await callOperationsMailSync(a,auth,{client:f.client});assert.equal(saved.state,'SAVED_READBACK');const row=(await readOperationsMailLedger({client:f.client})).schools.rows[0];
    assert.equal(row.arrival_at,expectedArrival);assert.equal(row.status,expectedStatus);assert.equal(row.departure_at,null);assert.equal(row.departure_source,null);
  });
test('default bounded school date scope refuses contradictions before any write',async()=>{
  for(const delta of [{complete_for_dates:['2026-10-10']},{complete_for_dates:['2026-10-09','2026-10-09']}]){
    const f=fixture();await assert.rejects(callOperationsMailSync(school(delta),auth,{client:f.client}));assert.equal(f.calls.length,0);
  }
});
test('school observation byte limit is pre-write, not unbounded transport',async()=>{const a=school({rows:Array.from({length:500},()=>Array(7).fill('x'.repeat(1000)))}),f=fixture();await assert.rejects(callOperationsMailSync(a,auth,{client:f.client}),/observation_limit/);assert.equal(f.calls.length,0);});
test('SDK publishes OAuth-only write tool; anonymous invocation does not import',async()=>{
  const f=fixture(),server=new McpServer({name:'synthetic-operations',version:'1'}),client=new Client({name:'synthetic-observer',version:'1'});
  configureMcpToolAuth(server,{securitySchemes:[{type:'noauth'},{type:'oauth2',scopes:['mcp:read','mcp:write']}],challenge:'Bearer resource_metadata="https://fixture.invalid/metadata"'});
  registerOperationsMailTools(server,{client:f.client});finalizeMcpToolAuth(server);const [ct,st]=InMemoryTransport.createLinkedPair();
  try{await server.connect(st);await client.connect(ct);const {tools}=await client.listTools();assert.equal(tools.length,1);assert.equal(tools[0].name,'custodial_outlook_operations_import');
    assert.deepEqual(tools[0]._meta.securitySchemes,[{type:'oauth2',scopes:['mcp:read','mcp:write']}]);
    const r=await client.callTool({name:'custodial_outlook_operations_import',arguments:spice()});assert.equal(r.isError,true);assert.match(r._meta['mcp/www_authenticate'][0],/mcp:read mcp:write/);assert.equal(f.calls.length,0);
  }finally{await client.close();await server.close();}
});
test('read-only server excludes operations importer',()=>{let n=0;registerOperationsMailTools({registerTool(){n++;}},{includeWrites:false});assert.equal(n,0);});
assert.equal(operationsMailSyncSchema.safeParse(spice()).success,true);assert.equal(operationsMailSyncSchema.safeParse(school()).success,true);
