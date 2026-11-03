import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import vm from 'node:vm';
import express from 'express';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {makeDeviceCredentialMiddleware,deviceCredentialInternals as credentials} from '../src/auth/device-credential-auth.js';
import {makeOpsAccessMiddleware,createOpsManagerSession,authenticatePresentedOpsAccessRequest} from '../src/auth/shared-access-auth.js';
import {makeMcpConnectorMiddleware} from '../src/auth/mcp-connector-auth.js';
import {makeFeedbackSubmitAuthority,authoritativeFeedbackPayload} from '../src/feedback-authority.js';
import {normalizeFeedbackInput} from '../src/public-submission-controls.js';
import {attachFeedbackDelivery,employeeFeedbackReceipt} from '../src/feedback-delivery-status.js';
import {makeFeedbackPrivateReader} from '../src/feedback-private-reader.js';
import {registerFeedbackRelayTools} from '../src/mcp/feedback-relay-tools.js';
import {configureMcpToolAuth,finalizeMcpToolAuth} from '../src/mcp/register.js';
import {projectFeedbackOwnedDiagnostic,rememberFeedbackDiagnosticSecrets} from './native-original-feedback-owned-diagnostic.mjs';
import {FEEDBACK_RELAY_CONTRACT} from '../src/feedback-email-relay.js';

// NEW owned local Source composition. Importing performs no SQL or IO.
// Normal middleware creates handler authInfo; no caller supplies auth verdicts.
const ID=Object.freeze({employee:'95000000-0000-4000-8000-000000000002',credential:'95000000-0000-4000-8000-000000000004',device:'95000000-0000-4000-8000-000000000001'});
const HEADERS=['X-Memphis-Native-Attestation-Version','X-Memphis-Native-Request-Id','X-Memphis-Native-Request-Timestamp','X-Memphis-Native-Request-Attestation'];
const sha=x=>createHash('sha256').update(x).digest('hex');
const exact=(x,want)=>{assert.ok(x&&Object.getPrototypeOf(x)===Object.prototype);assert.deepEqual(Reflect.ownKeys(x).sort(),[...want].sort());for(const d of Object.values(Object.getOwnPropertyDescriptors(x)))assert.ok(Object.hasOwn(d,'value'));};
function section(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);assert.equal(source.indexOf(start,a+1),-1);return source.slice(a,b);}

export async function prepareNativeOriginalFeedbackJourney({admin,target,backendRoot,recordDiagnostic}) {
 assert.equal(typeof recordDiagnostic,'function','owning exclusive diagnostic writer required');
 assert.equal(target?.synthetic,true);assert.equal(target?.network,'none');assert.match(target?.id||'',/^[a-f0-9]{64}$/);
 const pid=(await admin.query('select pg_backend_pid() pid')).rows[0].pid;
 const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'SYNTHETIC_ONLY_HTTP_PIECE_LOCAL_SOURCE_KEY',OPS_MANAGER_AUTH_REQUIRED:'true',OPS_MANAGER_SESSION_SECRET:randomUUID()+randomUUID(),MCP_CONNECTOR_TOKEN:randomUUID()+randomUUID(),MCP_ALLOW_READONLY_NOAUTH:'false',MCP_ALLOW_FULL_NOAUTH:'false'};
 const nativeSecret='SYNTHETIC_LONG_DEVICE_SECRET_SOURCE_OWNER_KIOSK_08';
 const diagnosticSecrets=new Set([nativeSecret,...Object.values(env).filter(x=>typeof x==='string'&&x.length>=16)]);let diagnosticIndex=0;
 const recordOwned=(kind,data)=>recordDiagnostic('FEEDBACK_'+kind+'_'+String(++diagnosticIndex).padStart(3,'0')+'.json',data);
 const managerId=randomUUID(),managerCredential=randomUUID();
 let tail=Promise.resolve(),closed=false,uncertain=false,server,mcp,writerCalls=0,rateCalls=0,relayCalls=0,readerCalls=0;
 const attempted=new Set(),transcript=[];
 function serialize(fn){const p=tail.then(fn);tail=p.catch(()=>{});return p;}
 async function tx(role,sql,args=[],write=false){return serialize(async()=>{
  assert.equal(closed,false);assert.equal(uncertain,false,'original SQL commit/rollback outcome UNKNOWN; no further command');assert.ok(['service_role','custodial_application_reader'].includes(role));assert.equal((await admin.query('select pg_backend_pid() pid')).rows[0].pid,pid);
  await admin.query(write?'begin':'begin read only');
  let commitAttempted=false;try{await admin.query('set local role '+role);const result=await admin.query(sql,args);commitAttempted=true;await admin.query('commit');return result.rows;}
  catch(error){if(commitAttempted)uncertain=true;try{await admin.query('rollback');}catch(cleanup){uncertain=true;error.rollbackFailure=cleanup;}throw error;}
 });}
 const read=sql=>{if(sql.includes('public.custodial_feedback_triage_version(status,updated_at) as triage_version'))readerCalls++;return tx('custodial_application_reader',sql);};
 const store={
  async getPolicy(){const rows=await tx('service_role','select mode from public.device_auth_policy where singleton=true');return {mode:credentials.normalizePolicyMode(rows[0]?.mode)};},
  async findCredential(id){return (await tx('service_role','select row_to_json(c) data from public.device_auth_credentials c where credential_id=$1',[id]))[0]?.data||null;},
  async touchCredential(id,patch){const fields=Object.keys(patch);assert.ok(fields.length&&fields.every(k=>['last_used_at','last_user_agent_hash','last_ip_hash','metadata_json'].includes(k)));
   return tx('service_role','update public.device_auth_credentials set '+fields.map((k,i)=>k+'=$'+(i+2)+(k==='metadata_json'?'::jsonb':'')).join(',')+' where credential_id=$1 and revoked_at is null returning credential_id',[id,...fields.map(k=>k==='metadata_json'?JSON.stringify(patch[k]):patch[k])],true);},
 };
 const trustedStore={async find(id){return (await tx('service_role',"select row_to_json(t)::jsonb || jsonb_build_object('manager',to_jsonb(m)) data from public.ops_manager_trusted_devices t join public.ops_manager_managers m on m.manager_id=t.manager_id where t.credential_id=$1",[id]))[0]?.data||null;}};
 const rpc={async rpc(name,args){
  try {
   if(name==='app_apply_operational_command') {exact(args,['p_command','p_payload']);assert.ok(['feedback_create','public_rate_limit'].includes(args.p_command));if(args.p_command==='feedback_create')writerCalls++;else rateCalls++;const rows=await tx('service_role','select public.app_apply_operational_command($1,$2::jsonb) data',[args.p_command,JSON.stringify(args.p_payload)],true);return {data:rows[0].data,error:null};}
   if(name==='custodial_feedback_delivery_status'){exact(args,['p_feedback_ids']);const rows=await tx('service_role','select public.custodial_feedback_delivery_status($1::uuid[]) data',[args.p_feedback_ids]);return {data:rows[0].data,error:null};}
   const match=/^custodial_feedback_relay_(status|claim|begin|receipt|defer|control|attachment_internal)$/.exec(name);assert.ok(match,'only fixed relay RPCs');relayCalls++;
   let query,values;if(match[1]==='attachment_internal'){exact(args,['p_principal','p_action','p_args']);query='select public.custodial_feedback_relay_attachment_internal($1,$2,$3::jsonb) data';values=[args.p_principal,args.p_action,JSON.stringify(args.p_args)];}
   else {exact(args,['p_principal','p_args']);query='select public.'+name+'($1,$2::jsonb) data';values=[args.p_principal,JSON.stringify(args.p_args)];}
   const rows=await tx('service_role',query,values,true);return {data:rows[0].data,error:null};
  } catch(error){const verb=name.startsWith('custodial_feedback_relay_')?name.slice('custodial_feedback_relay_'.length):null;
   if(['status','claim','begin','receipt','defer','control','attachment_internal'].includes(verb)){rememberFeedbackDiagnosticSecrets(args,diagnosticSecrets);recordOwned('RPC_ERROR',projectFeedbackOwnedDiagnostic({verb,request:args.p_args||{},error,secretValues:diagnosticSecrets}));}
   return {data:null,error};}
 }};
 try {
  await admin.query('begin');
  assert.equal((await admin.query('select count(*)::int n from public.system_feedback_items')).rows[0].n,0,'fresh feedback fixture only; no borrowed accepted originals');
  assert.equal((await admin.query('select count(*)::int n from public.system_feedback_email_intents')).rows[0].n,0);
  assert.equal((await admin.query('select count(*)::int n from public.devices where device_id=$1 or id=$2::uuid',['KIOSK_08',ID.device])).rows[0].n,0);
  await admin.query("insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values($1,'Synthetic Feedback manager',array['CUSTODIAL_MANAGER','OPS_MANAGER'],true,false)",[managerId]);
  await admin.query("insert into public.employees(id,employee_code,display_name,role,active) values($1,'EMP990252','Synthetic native Feedback employee','staff',true)",[ID.employee]);
  await admin.query("insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch) values($1,'KIOSK_08','Synthetic native Feedback source',true,null,6)",[ID.device]);
  await admin.query("insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at,metadata_json) values($1,$2,$3,statement_timestamp()-interval '1 minute',statement_timestamp()+interval '1 hour',$4::jsonb)",[ID.credential,ID.device,credentials.tokenHash(nativeSecret,env),JSON.stringify(credentials.deviceCredentialSecretMetadata(env))]);
  await admin.query("insert into public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,expires_at) values($1,'OPS_FEEDBACK_SOURCE','Synthetic reader', $2,'full_access',$3,statement_timestamp()+interval '1 hour')",[managerCredential,sha(randomUUID()),managerId]);
  await admin.query('set local role service_role');
  const assigned=(await admin.query('select public.custodial_assign_employee_device($1,$2::uuid,$3::uuid,$4,false,true,null::uuid) data',['KIOSK_08',ID.employee,managerId,'Fresh synthetic native Feedback prerequisite'])).rows[0].data;
  assert.equal(assigned.changed,true);await admin.query('reset role');await admin.query('commit');
  const app=express();app.disable('x-powered-by');app.use(express.json({limit:'30000b',strict:true,verify(req,_res,bytes){req.scanAuthorityRawBody=Buffer.from(bytes);}}));
  const managerGuard=makeOpsAccessMiddleware({env,trustedDeviceStore:trustedStore});
  const gate=makeFeedbackSubmitAuthority({requireEmployeeDeviceCredential:makeDeviceCredentialMiddleware({env,store,runReadOnlySql:read,requireEnrolledCredential:true}),requireOpsManagerWrite:makeOpsAccessMiddleware({env,trustedDeviceStore:trustedStore,requireWrite:true}),authenticatePresentedOpsAccessRequest});
  const index=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const noImage=value=>{assert.ok(value==null,'new photo/upload acquisition is outside this fixture');return null;};
  // Exact maintained writer + route. Only isolated DB/clock-independent ports
  // are supplied; authority middleware and post-await actor checks are real.
  const rateSecret=randomUUID()+randomUUID();const scope=vm.createContext({app,Buffer,createHash,createHmac,randomUUID,console:{error(){}},normalizeFeedbackInput,authoritativeFeedbackPayload,requireFeedbackSubmitAuthority:gate,requireOpsManagerAuth:managerGuard,makeFeedbackPrivateReader,attachFeedbackDelivery,employeeFeedbackReceipt,supabaseAdmin:rpc,APP_VERSION:'SOURCE_ONLY',RELEASE_ID:'NOT_DEPLOYED',FEEDBACK_CONTRACT_VERSION:'feedback.v3.enrolled-authority',
   RATE_LIMIT_MAX:10,getFeedbackLinkSecret:()=>rateSecret,
   runReadOnlySql:read,ensureSystemFeedbackSchema:async()=>assert.equal((await read("select to_regclass('public.system_feedback_items') is not null present"))[0].present,true),
   runOperationalCommand:async(command,payload)=>{const r=await rpc.rpc('app_apply_operational_command',{p_command:command,p_payload:payload});if(r.error)throw r.error;return r.data;},
   sqlLiteral:v=>v==null?'null':"'"+String(v).replaceAll("'","''")+"'",isUuid:v=>/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(v)),stableRequestFingerprint:v=>sha(JSON.stringify(v)),requestOperationId:req=>req.body.operation_id||req.get('idempotency-key'),
   validateSystemFeedbackImageAttachment:noImage,storeSystemFeedbackImageAttachment:async(_id,_op,image)=>noImage(image),persistedSystemFeedbackImageMetadata:noImage,removeUnreferencedSystemFeedbackImage:async image=>noImage(image)});
  vm.runInContext(section(index,'function publicSubmissionRateLimit(', '\n// Purge stale rate limit buckets'),scope,{timeout:1000});
  vm.runInContext(section(index,'function summarizeSystemFeedback(', '\nfunction buildSystemFeedbackNotificationBody('),scope,{timeout:1000});
  vm.runInContext(section(index,'function feedbackSubmissionActor(req)', '\napp.get("/guest-api/status"'),scope,{timeout:1000});
  vm.runInContext(section(index,'async function getSystemFeedbackItemById(', '\nasync function acknowledgeSystemFeedbackItem('),scope,{timeout:1000});
  vm.runInContext(section(index,'app.get("/dashboard-api/system-feedback/:feedbackId"', '\napp.get("/dashboard-api/system-feedback",'),scope,{timeout:1000});
  const requireMcpAuth=makeMcpConnectorMiddleware({env,allowReadOnlyNoAuth:false});
  // Same supported stateless SDK transport and private registration as normal.
  app.post('/mcp',requireMcpAuth,async(req,res)=>{
   const sdk=new McpServer({name:'owned-feedback-source',version:'SOURCE_ONLY'});configureMcpToolAuth(sdk);registerFeedbackRelayTools(sdk,{client:rpc});finalizeMcpToolAuth(sdk);
   const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});res.on('close',()=>{void transport.close();void sdk.close();});
   try{await sdk.connect(transport);await transport.handleRequest(req,res,req.body);}catch{if(!res.headersSent)res.status(500).json({error:'Owned MCP transport refused'});}
  });
  server=app.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
  const unauth=await fetch(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',authorization:'Bearer INVALID_SOURCE_ONLY'},body:'{}'});assert.equal(unauth.status,401);assert.equal(relayCalls,0);
  mcp=new Client({name:'owned-feedback-local-proof',version:'SOURCE_ONLY'});
  await mcp.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+env.MCP_CONNECTOR_TOKEN}}}));
  const manager=(await admin.query('select row_to_json(m) data from public.ops_manager_managers m where manager_id=$1',[managerId])).rows[0].data;
  const session=createOpsManagerSession({credentialId:managerCredential,deviceId:'OPS_FEEDBACK_SOURCE',manager,authMode:'trusted_device',accessLevel:'full_access',maximumAccessLevel:'full_access',env});
  diagnosticSecrets.add(session.token);
  async function tool(verb,args={}){assert.ok(['status','claim','begin','receipt','defer','control'].includes(verb));rememberFeedbackDiagnosticSecrets(args,diagnosticSecrets);let result;try{result=await mcp.callTool({name:'custodial_feedback_relay_'+verb,arguments:{contract_version:FEEDBACK_RELAY_CONTRACT,...args}});}
   catch(error){recordOwned('MCP_THROW',projectFeedbackOwnedDiagnostic({verb,request:args,error,secretValues:diagnosticSecrets}));throw error;}
   for(const block of result.content||[])if(block.type==='text')try{rememberFeedbackDiagnosticSecrets(JSON.parse(block.text),diagnosticSecrets);}catch{}
   recordOwned('MCP_CALL',projectFeedbackOwnedDiagnostic({verb,request:args,result,secretValues:diagnosticSecrets}));
   assert.notEqual(result.isError,true,'registered relay refused; owned redacted diagnostic retained');assert.equal(result.content.length,1);assert.equal(result.content[0].type,'text');return JSON.parse(result.content[0].text);}
  return Object.freeze({prepared:Object.freeze({...ID,device_identifier:'KIOSK_08',assignment_epoch:7,scope:'SYNTHETIC_NATIVE_ENROLLMENT_NOT_ANDROID_OR_REAL_MANAGER'}),
   async exchange(loan){assert.equal(closed,false);exact(loan,['method','path','exactRequestBytes','nativeHeaders','idempotencyKey']);exact(loan.nativeHeaders,HEADERS);assert.equal(loan.method,'POST');assert.equal(loan.path,'/feedback-api/submit');assert.ok(Buffer.isBuffer(loan.exactRequestBytes)&&loan.exactRequestBytes.length>0&&loan.exactRequestBytes.length<=30000);
    const rawRef=loan.exactRequestBytes,headersRef=loan.nativeHeaders,raw=Buffer.from(rawRef),headers={...headersRef},operation=loan.idempotencyKey;assert.equal(operation,JSON.parse(raw.toString('utf8')).operation_id);const current=()=>{assert.equal(loan.exactRequestBytes,rawRef);assert.equal(loan.nativeHeaders,headersRef);assert.ok(rawRef.equals(raw));assert.deepEqual(headersRef,headers);assert.equal(loan.method,'POST');assert.equal(loan.path,'/feedback-api/submit');assert.equal(loan.idempotencyKey,operation);};
    const key=headers['X-Memphis-Native-Request-Id'];assert.equal(attempted.has(key),false,'no native HTTP request replay');attempted.add(key);
    try{current();const response=await fetch(origin+loan.path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{...headers,Authorization:'Device '+ID.credential+'.'+nativeSecret,'X-Device-Credential':ID.credential+'.'+nativeSecret,'X-Memphis-Device-Credential':ID.credential+'.'+nativeSecret,'X-Device-Id':'KIOSK_08','X-Memphis-App-Edition':'custodial',Origin:'https://localhost',Accept:'application/json','Content-Type':'application/json','Idempotency-Key':operation},body:raw});const body=Buffer.from(await response.arrayBuffer());current();assert.ok(body.length<=1048576);const type=response.headers.get('content-type');assert.match(type,/^application\/json(?:;|$)/i);transcript.push({request_sha256:sha(raw),response_sha256:sha(body),status:response.status});return {status:response.status,body,headers:{'Content-Type':type}};}finally{raw.fill(0);}},
   async originalRow(operation){const rows=await tx('custodial_application_reader','select id,operation_id,request_fingerprint,category,priority,message,page_url,hub_context,device_id,metadata_json from public.system_feedback_items where operation_id=$1::uuid',[operation]);assert.equal(rows.length,1);return rows[0];},
   async relayAndReadOriginal({operationId,feedbackId}){
    assert.equal((await tool('status')).paused,true);const row=await this.originalRow(operationId);assert.equal(row.id,feedbackId);
    const challenge=await tool('control',{request_id:randomUUID(),action:'prepare_preflight',reason:'Synthetic local no-send qualification'});
    // Explicit test DATA observations. No provider/profile/Sent/Inbox read or
    // send occurred. This exercises existing authenticated observation guards.
    const preflight={challenge_id:challenge.challenge_id,challenge_nonce:challenge.challenge_nonce,provider_account:'eoperle@memphiszoo.org',profile_observed_at:challenge.issued_at,profile_result_sha256:sha('synthetic profile DATA'),sent_folder_id:'SOURCE_SENT',inbox_folder_id:'SOURCE_INBOX',sent_read_at:challenge.issued_at,sent_result_sha256:sha('synthetic empty Sent DATA'),inbox_read_at:challenge.issued_at,inbox_result_sha256:sha('synthetic empty Inbox DATA')};
    await tool('control',{request_id:randomUUID(),action:'resume_preflight_verified',reason:'Synthetic local gates only; no sender exists',preflight});
    const claim=await tool('claim',{request_id:randomUUID()});assert.equal(claim.feedback_id,feedbackId);assert.equal(claim.operation_id,operationId);assert.equal(claim.request_fingerprint,row.request_fingerprint);
    const request={request_id:randomUUID(),intent_id:claim.intent_id,claim_token:claim.claim_token,claim_generation:claim.claim_generation,envelope_sha256:claim.envelope_sha256};
    await assert.rejects(tool('begin',{...request,request_id:randomUUID(),intent_id:randomUUID()}),/registered relay refused/);
    await assert.rejects(tool('begin',{...request,request_id:randomUUID(),envelope_sha256:sha('wrong original envelope')}),/registered relay refused/);
    await assert.rejects(async()=>{const result=await tool('begin',request);assert.equal(result.may_send,true);assert.ok(result.attempt_id);throw Error('SYNTHETIC_LOST_BEGIN_REPLY_AFTER_SQL_SETTLED_NO_SEND');},/SYNTHETIC_LOST_BEGIN_REPLY/);
    // The normal relay-private tables deny direct service_role SELECT.
    // Read only the existing same-principal original and bounded delivery RPC;
    // neither reader claims/reconciles/begins/extends the original attempt.
    const originalUnknown=async()=>{
     const status=await tool('status'),recoverable=status.recoverable;
     assert.equal(status.last_receipt_at,null);assert.equal(status.counts.outcome_unknown,1);
     assert.equal(recoverable.intent_id,claim.intent_id);assert.equal(recoverable.claim_generation,claim.claim_generation);
     assert.equal(recoverable.envelope_sha256,claim.envelope_sha256);assert.equal(recoverable.mode,'reconcile');
     assert.match(recoverable.attempt_id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
     const delivery=await rpc.rpc('custodial_feedback_delivery_status',{p_feedback_ids:[feedbackId]});
     assert.equal(delivery.error,null);assert.equal(delivery.data.length,1);assert.equal(delivery.data[0].feedback_id,feedbackId);
     assert.equal(delivery.data[0].state,'outcome_unknown');assert.equal(delivery.data[0].evidence_state,'outcome_unknown');
     return {state:delivery.data[0].state,evidence_state:delivery.data[0].evidence_state,intent_id:recoverable.intent_id,
      attempt_id:recoverable.attempt_id,claim_generation:recoverable.claim_generation,envelope_sha256:recoverable.envelope_sha256,
      last_receipt_at:status.last_receipt_at};
    };
    const unknown=await originalUnknown();
    const beforeReads=readerCalls,absent=await fetch(origin+'/dashboard-api/system-feedback/'+feedbackId,{redirect:'error'});assert.equal(absent.status,401);assert.equal(readerCalls,beforeReads);
    const missing=await fetch(origin+'/dashboard-api/system-feedback/'+randomUUID(),{headers:{authorization:'Bearer '+session.token},redirect:'error'});assert.equal(missing.status,503);
    const response=await fetch(origin+'/dashboard-api/system-feedback/'+feedbackId,{headers:{authorization:'Bearer '+session.token},redirect:'error'});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const readback=await response.json();assert.equal(readback.data.id,feedbackId);assert.equal(Object.hasOwn(readback.data,'operation_id'),false);assert.equal(readback.data.id,row.id);assert.equal(readback.data.message,row.message);assert.equal(readback.data.email_delivery.evidence_state,'outcome_unknown');
    // No repeat begin, reclaim, clock advancement, provider receipt or resend.
    const after=await originalUnknown();assert.deepEqual(after,unknown);
    assert.deepEqual(await this.originalRow(operationId),row);
    assert.equal(after.last_receipt_at,null,'existing normal status confirms no receipt in this fresh fixture');
    await admin.query('update public.ops_manager_trusted_devices set revoked_at=statement_timestamp() where credential_id=$1',[managerCredential]);const prior=readerCalls;const denied=await fetch(origin+'/dashboard-api/system-feedback/'+feedbackId,{headers:{authorization:'Bearer '+session.token},redirect:'error'});assert.equal(denied.status,401);assert.equal(readerCalls,prior);
    return {scope:'LOCAL_AUTHENTICATED_SYNTHETIC_PREFLIGHT_NO_PROVIDER',original_operation_id:operationId,feedback_id:feedbackId,feedback_writer_calls:writerCalls,rate_gate_calls:rateCalls,relay_RPC_calls:relayCalls,reader_calls:readerCalls,original_state:after.state,provider_send:false,provider_receipts:0,external_messages:0,real_manager:false,transcript:[...transcript]};
   },
   async close(){if(closed)return;await tail;if(mcp)await mcp.close();if(server){server.closeAllConnections();await new Promise((ok,bad)=>server.close(e=>e?bad(e):ok()));}closed=true;},
  });
 }catch(error){try{await admin.query('rollback');}catch(cleanup){error.rollbackFailure=cleanup;}if(mcp)await mcp.close();if(server)server.close();closed=true;throw error;}
}
