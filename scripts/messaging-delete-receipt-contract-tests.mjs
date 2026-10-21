import assert from 'node:assert/strict';
import express from 'express';
import {readFileSync} from 'node:fs';
import {createMessagingRouter} from '../src/messaging-api.js';
import {EventEmitter} from 'node:events';
import {createHash,createHmac} from 'node:crypto';
import {createOriginalMessageActions} from '../src/messaging-original-outcome.js';

// Focused members and the default route use real product factories with
// recording credential/SQL boundaries. No SQL engine or physical phone proof.
async function originalOutcomeContract({attestationOnly=false,prototypeOnly=false,routerOnly=false}={}) {
  const ids=Array.from({length:8},(_,i)=>`${i+1}0000000-0000-4000-8000-00000000000${i+1}`);
  const [devicePk,employeeId,credentialId,userId,threadId,messageId,operationId,otherId]=ids;
  const tokenHash='a'.repeat(64), fingerprint='b'.repeat(64),time='2026-10-12T21:20:00.123456+00:00';
  const nativeSecret='SyntheticOriginalRequestSecret_1234567890';
  const authorization=`Device ${credentialId}.${nativeSecret}`;
  let current={device_pk:devicePk,device_id:'KIOSK_04',employee_id:employeeId,credential_id:credentialId,assignment_epoch:'17',token_hash:tokenHash};
  let denied=false,sqlRows=null,sqlHook=null,rpcHook=null,changeReceipt=null,unknown=false,checks=0,expectedMiddlewareRequest=null,incompleteAdmission=false,participant=true;
  const calls=[],sql=[],headers=[];
  class Response extends EventEmitter {
    status(value){this.statusCode=value;return this}
    json(value){this.body=value;this.headersSent=true;this.writableEnded=true;this.emit('finish');return this}
  }
  const install=req=>{
    const d={canonical_device_pk:current.device_pk,canonical_device_id:current.device_id,assigned_employee_id:current.employee_id,
      assignment_epoch:current.assignment_epoch,device_active:true,employee_active:true};
    const c={credential_id:current.credential_id,device_id:current.device_pk,token_hash:current.token_hash,
      confirmed_at:time,revoked_at:null,expires_at:'2099-01-01T00:00:00Z'};
    req.memphisDevice=d;req.memphisDeviceCredential=c;req.memphisDeviceAuth={ok:true,credentialed:true,device:d,credential:c};
    return req;
  };
  const common=()=>({device_id:'KIOSK_04',expected_employee_id:employeeId,expected_credential_id:credentialId,expected_assignment_epoch:'17'});
  const sign=req=>{
    req.scanAuthorityRawBody=Buffer.from(JSON.stringify(req.body),'utf8');
    const version='custodial-native-request.v1',timestamp=new Date().toISOString(),requestId=otherId,edition='custodial';
    Object.assign(req.headers,{'x-memphis-native-attestation-version':version,'x-memphis-native-request-id':requestId,
      'x-memphis-native-request-timestamp':timestamp,'x-memphis-app-edition':edition});
    const bodyHash=createHash('sha256').update(req.scanAuthorityRawBody).digest('hex');
    req.headers['x-memphis-native-request-attestation']=createHmac('sha256',nativeSecret)
      .update([version,credentialId,'KIOSK_04',req.method,req.originalUrl,bodyHash,requestId,timestamp,edition].join('\n')).digest('hex');
    return req;
  };
  const request=(kind='read')=>sign(install({method:'POST',originalUrl:`/messaging-api/thread/${threadId}/${kind}`,url:`/thread/${threadId}/${kind}`,
    headers:{authorization},params:{threadId},query:{},
    body:kind==='read'?{...common(),user_id:userId,through_message_id:messageId}:kind==='delete'
      ?{...common(),user_id:userId,operation_id:operationId}
      :{...common(),sender_user_id:userId,body:' original text ',message_type:'text',metadata_json:{source:'employee'},client_message_id:'original-client-1'}}));
  const normalRow=()=>({device_pk:devicePk,device_id:'KIOSK_04',employee_id:employeeId,assignment_epoch:'17',user_id:userId});
  const ports={
    requireDeviceAccess(req,res,next){
      if(expectedMiddlewareRequest)assert.equal(req,expectedMiddlewareRequest,'middleware receives the actual authenticated request');
      // Deliberately mirrors the existing non-Promise-returning wrapper.
      void Promise.resolve().then(()=>{
        headers.push(req.headers.authorization);
        if(routerOnly&&req.headers.authorization==='Bearer recording-read-only-manager'){
          req.memphisAuth={manager_id:otherId,read_only:true};next();return;
        }
        if(denied || req.headers.authorization!==authorization){res.status(401).json({ok:false});return}
        if(incompleteAdmission){req.memphisDevice={canonical_device_id:'KIOSK_04'};next();return;}
        install(req);next();
      });
    },
    async runReadOnlySql(statement){
      sql.push(statement);if(sqlHook)await sqlHook();
      if(routerOnly){
        if(/public\.device_aliases/.test(statement))return [{canonical_device_id:'KIOSK_04',device_id:'KIOSK_04',device_active:true,assigned_employee_id:employeeId,employee_active:true}];
        if(/public\.msg_get_user_by_device\('KIOSK_04'\)/.test(statement))return [{msg_user_id:userId,role:'employee'}];
        if(/from public\.msg_threads t/.test(statement))return [{id:threadId,thread_type:'direct',system_key:null,is_active:true,has_memphis_bot:false}];
        if(/from public\.msg_thread_participants/.test(statement))return participant?[{present:1}]:[];
      }
      return sqlRows??[normalRow()];
    },
    async runRpc(name,args){
      calls.push({name,args:structuredClone(args)});if(rpcHook)await rpcHook();
      if(routerOnly&&name==='msg_ensure_ops_manager_user')return {msg_user_id:otherId,role:'manager'};
      const payload=args.p_payload,command=payload.original_command??args.p_command;
      const actor={device_pk:devicePk,device_id:payload.device_id,employee_id:payload.expected_employee_id,
        credential_id:payload.expected_credential_id,assignment_epoch:payload.expected_assignment_epoch,user_id:payload.user_id};
      const original={...payload};delete original.credential_token_hash;delete original.original_command;
      const base={schema:'custodial.employee-original-message-outcome.v1',request_fingerprint:fingerprint,original_command:command,
        original_actor:actor,inventory_acknowledged:false,finalizer_allowed:false,key_removal:false};
      if(unknown)return {...base,state:'ORIGINAL_OUTCOME_NOT_FOUND_UNKNOWN',original_outcome_recorded:false,resend_allowed:false};
      const result=command.endsWith('_read')?{marked:1,thread_id:threadId,user_id:userId,through_message_id:messageId}
        :command.endsWith('_delete')?{ok:true,deleted:true,thread_id:threadId,operation_id:operationId,deletion_scope:'user',
          deleted_at:time,deleted_through:time,replayed:false,memphis_generation_ended:false}
        :{id:messageId,thread_id:threadId,sender_user_id:userId,body:payload.body.replace(/^ +| +$/g,''),message_type:'text',
          metadata_json:{source:'employee',client_message_id:'original-client-1'},client_message_id:'original-client-1',
          sent_at:time,created_at:time,updated_at:time,is_deleted:false,deleted_at:null,deleted_by_user_id:null,purge_after:null};
      const receipt={...base,state:'ORIGINAL_TRANSACTION_OUTCOME_RECORDED',original_outcome_recorded:true,original_request:original,result,recorded_at:time};
      if(changeReceipt)changeReceipt(receipt);return receipt;
    }
  };
  const actions=createOriginalMessageActions(ports);
  const check=(label,actual,expected)=>{assert.deepEqual(actual,expected,label);checks++;console.log('PASS original-outcome',label)};
  const rejects=async(label,action,req,status)=>{await assert.rejects(()=>actions[action](req,new Response()),e=>e.status===status,label);checks++;console.log('PASS original-outcome',label)};
  if(routerOnly){
    // Actual shipping router + original-action factory; only SQL/credential
    // observations are recording fixtures. This is not SQL or native-platform proof.
    const app=express();app.use(express.json({verify(req,_res,bytes){req.scanAuthorityRawBody=Buffer.from(bytes)}}));
    app.use('/messaging-api',createMessagingRouter({...ports,buildHealthPayload:()=>({ok:true}),appVersion:'source',releaseId:'not-deployed',contractVersion:'messaging.v5'}));
    const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
    const post=async(req=request('delete'))=>{
      const response=await fetch(`http://127.0.0.1:${server.address().port}${req.originalUrl}`,{method:req.method,headers:{...req.headers,'content-type':'application/json'},body:req.scanAuthorityRawBody});
      return {status:response.status,body:await response.json()};
    };
    const actionCalls=()=>calls.filter(c=>c.name==='app_apply_operational_command');
    try{
      let response=await post();check('current signed routed employee delete status',response.status,200);
      check('current routed exact operation',response.body.data.operation_id,operationId);
      check('current routed exact deletion scope',response.body.data.deletion_scope,'user');
      check('current routed private original RPC',actionCalls().at(-1).args.p_command,'employee_message_original_delete');
      check('current routed server-only token hash',actionCalls().at(-1).args.p_payload.credential_token_hash,tokenHash);
      check('current routed original outcome recorded',response.body.meta.original_outcome.state,'ORIGINAL_TRANSACTION_OUTCOME_RECORDED');
      check('current routed no finalizer authority',response.body.meta.original_outcome.finalizer_allowed,false);
      check('current routed no legacy delete RPC',calls.some(c=>c.name==='msg_delete_thread'),false);
      for(const [label,mutate,status] of [
        ['anonymous current route',req=>delete req.headers.authorization,401],
        ['wrong current credential',req=>req.headers.authorization='Device wrong',401],
        ['unsigned current route',req=>delete req.headers['x-memphis-native-request-attestation'],403],
        ['wrong original signature',req=>req.headers['x-memphis-native-request-attestation']='0'.repeat(64),403],
        ['unknown original body field',req=>{req.body.extra='unsafe';sign(req)},422],
        ['wrong original assignment',req=>{req.body.expected_assignment_epoch='18';sign(req)},409],
        ['forged original user',req=>{req.body.user_id=otherId;sign(req)},403],
      ]){
        const before=actionCalls().length,req=request('delete');mutate(req);response=await post(req);
        check(label+' refused',response.status,status);check(label+' no original action',actionCalls().length,before);
      }
      let before=actionCalls().length;incompleteAdmission=true;response=await post();incompleteAdmission=false;
      check('canonical-device-only admission stays refused',response.status,401);check('incomplete credential no original action',actionCalls().length,before);
      participant=false;response=await post();participant=true;check('current nonparticipant refused',response.status,403);check('current nonparticipant no original action',actionCalls().length,before);
      const manager=request('delete');manager.headers.authorization='Bearer recording-read-only-manager';response=await post(manager);
      check('current read-only manager remains refused',response.status,403);check('current read-only manager no original action',actionCalls().length,before);
      unknown=true;response=await post();unknown=false;check('current original UNKNOWN cannot become success',response.status,502);
      console.log('MESSAGING_CURRENT_ORIGINAL_DELETE_ROUTER_CONTRACT_PASS',checks);
    }finally{await new Promise(resolve=>server.close(resolve));console.log('OWNED_CURRENT_ORIGINAL_HTTP_SERVER_CLOSED')}
    return;
  }
  if(prototypeOnly){
    const actualApp=express(),observed={};
    actualApp.use(express.json({verify(req,_res,bytes){req.scanAuthorityRawBody=Buffer.from(bytes)}}));
    actualApp.post('/messaging-api/thread/:threadId/read',(req,res,next)=>{install(req);next()},async(req,res)=>{
      observed.query=Object.getPrototypeOf(req.query);observed.params=Object.getPrototypeOf(req.params);
      observed.ownQuery=Object.keys(req.query);observed.values=req.query;
      try{const result=await actions.prepare(req,res).read();res.json({ok:true,result:result.result})}
      catch(e){res.status(e.status||500).json({ok:false,error:e.message})}
    });
    const actualServer=await new Promise(resolve=>{const server=actualApp.listen(0,'127.0.0.1',()=>resolve(server))});
    try{
      const req=request();req.originalUrl+='?same=one&same=two&__proto__=owned&constructor=owned';sign(req);
      const response=await fetch(`http://127.0.0.1:${actualServer.address().port}${req.originalUrl}`,{
        method:'POST',headers:{...req.headers,'content-type':'application/json'},body:req.scanAuthorityRawBody});
      const result=await response.json();
      check('actual installed Express simple query has null prototype',observed.query,null);
      check('actual installed Express route params have null prototype',observed.params,null);
      check('actual query retains repeated and magic own fields',observed.ownQuery,['same','__proto__','constructor']);
      check('actual repeated query values remain intact',observed.values.same,['one','two']);
      check('actual signed Express request reaches product action',response.status,200);
      check('actual signed Express action returns marked count',result.result.marked,1);
    }finally{await new Promise(resolve=>actualServer.close(resolve));console.log('OWNED_PROTOTYPE_HTTP_SERVER_CLOSED')}
    const req=request();req.query=Object.assign(Object.create(null),{same:['one','two'],constructor:'own'});
    req.params=Object.assign(Object.create(null),req.params);
    check('supported null-prototype fields survive immutable capture',(await actions.read(req,new Response())).applicable,true);
    const changed=request();changed.query=Object.assign(Object.create(null),{own:'original'});
    const prepared=actions.prepare(changed,new Response()),before=calls.length;
    changed.query.own='changed';
    await assert.rejects(()=>prepared.read(),e=>e.status===409);checks++;
    check('null-prototype snapshot is independent of original fields',calls.length,before);
    const swapped=request(),pending=actions.prepare(swapped,new Response());swapped.query=Object.create(null);
    await assert.rejects(()=>pending.read(),e=>e.status===409);checks++;
    let getterReads=0;
    for(const [label,container] of [
      ['custom inherited query',Object.create({inherited:'unsafe'})],
      ['class instance query',new(class Query{constructor(){this.own='unsafe'}})()],
      ['getter query',Object.defineProperty({},'unsafe',{enumerable:true,get(){getterReads++;return'unsafe'}})],
      ['symbol query',{[Symbol('unsafe')]:'unsafe'}]]){
      const req=request();req.query=container;
      await rejects(label,'read',req,422);
    }
    check('query getter was never invoked',getterReads,0);
    const nullBody=request();nullBody.body=Object.assign(Object.create(null),nullBody.body);
    await rejects('action body remains strict plain JSON','read',nullBody,422);
    changeReceipt=r=>Object.setPrototypeOf(r,null);
    await rejects('outcome DTO remains strict plain JSON','read',request(),502);changeReceipt=null;
    const unknown=request();unknown.body.extra='unsafe';sign(unknown);
    await rejects('closed action body still rejects unknown own fields','read',unknown,422);
    console.log('MESSAGING_ORIGINAL_PROTOTYPE_CONTRACT_PASS',checks);return;
  }
  if(attestationOnly){
    for(const kind of ['send','read','delete']){
      const outcome=await actions[kind](request(kind),new Response());
      check(`${kind} real native verifier accepts synthetic signed bytes`,outcome.applicable,true);
    }
    const query=request();query.originalUrl+= '/original-outcome';query.url+='/original-outcome';sign(query);
    check('fixed original read query signed with its actual path', (await actions.readOutcome(query,new Response())).applicable,true);
    for(const [label,mutate] of [
      ['missing signature',req=>delete req.headers['x-memphis-native-request-attestation']],
      ['wrong signature',req=>req.headers['x-memphis-native-request-attestation']='0'.repeat(64)],
      ['wrong request ID',req=>req.headers['x-memphis-native-request-id']=messageId],
      ['changed method',req=>req.method='PUT'],['changed path',req=>req.originalUrl+='/original-outcome'],
      ['changed original body bytes',req=>req.scanAuthorityRawBody=Buffer.from('{}')],
      ['missing raw original bytes',req=>delete req.scanAuthorityRawBody],
      ['old native timestamp',req=>req.headers['x-memphis-native-request-timestamp']='2020-01-01T00:00:00.000Z']]){
      const req=request(),prior=calls.length;mutate(req);
      await rejects(label,'read',req,403);check(`${label} no action RPC`,calls.length,prior);
    }
    // A parsed POST body cannot be authorized by a correctly signed empty-body hash.
    const empty=request();delete empty.scanAuthorityRawBody;
    const h=empty.headers;
    h['x-memphis-native-request-attestation']=createHmac('sha256',nativeSecret).update([
      h['x-memphis-native-attestation-version'],credentialId,'KIOSK_04',empty.method,empty.originalUrl,
      createHash('sha256').update(Buffer.alloc(0)).digest('hex'),h['x-memphis-native-request-id'],
      h['x-memphis-native-request-timestamp'],h['x-memphis-app-edition']].join('\n')).digest('hex');
    await rejects('signed empty fallback cannot authorize parsed POST','read',empty,403);
    empty.scanAuthorityRawBody=Buffer.alloc(0);
    await rejects('signed explicit empty bytes cannot authorize parsed POST','read',empty,403);
    for(const [label,mutate] of [
      ['signature changed during SQL await',req=>req.headers['x-memphis-native-request-attestation']='0'.repeat(64)],
      ['raw body changed during SQL await',req=>req.scanAuthorityRawBody[0]^=1],
      ['path changed during SQL await',req=>req.originalUrl+='/other']]){
      const req=request(),prior=calls.length;sqlHook=async()=>mutate(req);
      await rejects(label,'read',req,409);sqlHook=null;check(`${label} no action RPC`,calls.length,prior);
    }
    const afterRequest=request();rpcHook=async()=>{afterRequest.headers['x-memphis-native-request-attestation']='0'.repeat(64)};
    await rejects('signature changed during RPC await refuses success','read',afterRequest,409);rpcHook=null;
    // Existing verifier uses new Date(), so exercise expiry through its actual
    // header witness instead of an invented injected clock/auth callback.
    const expires=request();sqlHook=async()=>{expires.headers['x-memphis-native-request-timestamp']='2020-01-01T00:00:00.000Z'};
    await rejects('timestamp changed during await refuses original transcript','read',expires,409);sqlHook=null;
    console.log('MESSAGING_ORIGINAL_ATTESTATION_CONTRACT_PASS',checks);return;
  }
  for(const kind of ['send','read','delete']){
    const outcome=await actions[kind](request(kind),new Response());
    check(`${kind} records exact original command`,outcome.outcome.original_command,`employee_message_original_${kind}`);
    check(`${kind} uses fixed private RPC`,calls.at(-1).name,'app_apply_operational_command');
    check(`${kind} only server token hash`,calls.at(-1).args.p_payload.credential_token_hash,tokenHash);
    check(`${kind} returned request has no hash`,Object.hasOwn(outcome.outcome.original_request,'credential_token_hash'),false);
  }
  const readPayload=structuredClone(calls.find(c=>c.args.p_command==='employee_message_original_read').args.p_payload);
  const queried=await actions.readOutcome(request(),new Response());
  const queryPayload={...calls.at(-1).args.p_payload};delete queryPayload.original_command;
  check('outcome-only fixed command',calls.at(-1).args.p_command,'employee_message_original_outcome');
  check('query uses identical saved action payload',queryPayload,readPayload);
  check('read marked result',queried.result.marked,1);
  unknown=true;const missing=await actions.readOutcome(request(),new Response());
  check('missing original remains UNKNOWN',missing.outcome.state,'ORIGINAL_OUTCOME_NOT_FOUND_UNKNOWN');
  check('missing original prohibits resend',missing.outcome.resend_allowed,false);
  await rejects('mutation cannot accept unknown receipt','read',request(),502);unknown=false;
  const before=calls.length;
  for(const [label,key,value,status] of [
    ['wrong employee','expected_employee_id',otherId,409],['wrong credential','expected_credential_id',otherId,409],
    ['wrong epoch','expected_assignment_epoch','18',409],['numeric epoch','expected_assignment_epoch',17,422],
    ['noncanonical epoch','expected_assignment_epoch','017',422],['unknown command injection','original_command','employee_message_original_send',422],
    ['client hash injection','credential_token_hash','c'.repeat(64),422],['wrong user','user_id',otherId,403]]){
    const req=request();req.body[key]=value;await rejects(label,'read',req,status);
  }
  check('invalid original bodies cause no action RPC',calls.length,before);
  denied=true;await rejects('existing middleware denial cannot become authentication','read',request(),401);denied=false;
  check('middleware denial causes no action RPC',calls.length,before);
  sqlRows=[{...normalRow(),user_id:otherId}];await rejects('canonical messaging user cannot be replaced by body','read',request(),403);sqlRows=null;
  sqlRows=[normalRow(),normalRow()];await rejects('ambiguous canonical relationship refused','read',request(),409);sqlRows=null;
  sqlRows=[];await rejects('missing active ordinary messaging assignment refused','read',request(),409);sqlRows=null;
  const relation=await actions.currentRelationship(request(),new Response());
  check('me relationship is source mapped',relation.relationship,{...normalRow(),credential_id:credentialId});
  check('me relationship has no hash',Object.hasOwn(relation.relationship,'token_hash'),false);
  check('fixed SQL has canonical employee join',sql.every(s=>s.includes('join public.msg_users u on u.employee_id=e.id')),true);
  check('fixed SQL requires active canonical messaging assignment',sql.every(s=>s.includes('join public.msg_device_assignments mda on mda.device_identifier=d.device_id and mda.msg_user_id=u.id and mda.is_active')),true);
  check('fixed SQL does not access credentials',sql.some(s=>s.includes('device_auth_credentials')),false);
  const mutable=request();const beforeTranscriptSwap=calls.length;
  sqlHook=async()=>{mutable.body.through_message_id=otherId;mutable.headers.authorization='Device substituted';mutable.params.threadId=otherId};
  await rejects('changed actual transcript during SQL await refused','read',mutable,409);sqlHook=null;
  check('changed transcript cannot create an action',calls.length,beforeTranscriptSwap);
  check('header captured before await',headers.every(value=>value===authorization),true);
  const actual=request('send'),prepared=actions.prepare(actual,new Response());
  expectedMiddlewareRequest=actual;await prepared.send();expectedMiddlewareRequest=null;
  check('prepared closure is applicable',prepared.applicable,true);
  for(const [label,mutate] of [
    ['body before route classification resumes',req=>req.body.body='replacement'],
    ['header before route classification resumes',req=>req.headers.authorization='Device substituted'],
    ['thread before route classification resumes',req=>req.params.threadId=otherId],
    ['path before route classification resumes',req=>req.originalUrl='/other']]){
    const req=request('send'),pending=actions.prepare(req,new Response()),prior=calls.length;
    await Promise.resolve();mutate(req);
    await assert.rejects(()=>pending.send(),e=>e.status===409,label);checks++;
    check(`${label} no action`,calls.length,prior);
  }
  const beforeSwap=calls.length;
  sqlHook=async()=>{current={...current,assignment_epoch:'18'}};
  await rejects('assignment changes during SQL await refuse action','read',request(),409);sqlHook=null;current={...current,assignment_epoch:'17'};
  check('changed assignment did not mutate',calls.length,beforeSwap);
  rpcHook=async()=>{current={...current,credential_id:otherId}};
  await rejects('credential changes during RPC await refuse success','read',request(),409);rpcHook=null;current={...current,credential_id:credentialId};
  for(const [label,change] of [
    ['wrong result actor',r=>r.result.user_id=otherId],['unknown DTO field',r=>r.credential_token_hash=tokenHash],
    ['wrong original request',r=>r.original_request.through_message_id=otherId],['wrong schema',r=>r.schema='other.v1'],
    ['malformed recorded timestamp',r=>r.recorded_at='2026-02-30T12:00:00Z'],['negative read count',r=>r.result.marked=-1],
    ['unsafe finalizer flag',r=>r.finalizer_allowed=true]]){
    changeReceipt=change;await rejects(label,'read',request(),502);
  }
  changeReceipt=r=>r.result.deleted_through='2026-10-12T21:20:00.123455+00:00';
  await rejects('delete microsecond reversal refused','delete',request('delete'),502);
  changeReceipt=r=>r.result.unknown=true;await rejects('unknown deletion receipt field refused','delete',request('delete'),502);changeReceipt=null;
  changeReceipt=r=>r.result.unknown=true;await rejects('unknown send composite field refused','send',request('send'),502);changeReceipt=null;
  const multiline=request('send');multiline.body.body='\n original text\n';
  sign(multiline);
  const multilineOutcome=await actions.send(multiline,new Response());
  check('send preserves source btrim newline semantics',multilineOutcome.result.body,'\n original text\n');
  const manager=request();manager.memphisAuth={manager_id:otherId};const prior=calls.length;
  check('manager routing remains not applicable',await actions.read(manager,new Response()),{applicable:false});
  const guest=request();guest.memphisMessagingDevice={identity:{role:'guest'}};
  check('guest routing remains not applicable',await actions.read(guest,new Response()),{applicable:false});
  check('nonapplicable routing has no original action',calls.length,prior);
  assert.throws(()=>createOriginalMessageActions({runReadOnlySql:async()=>[],runRpc:async()=>({})}),TypeError);checks++;
  console.log('MESSAGING_ORIGINAL_OUTCOME_CONTRACT_PASS',checks);
}
if(process.argv.includes('--original-prototype-only')){await originalOutcomeContract({prototypeOnly:true});process.exit(0)}
if(process.argv.includes('--original-attestation-only')){await originalOutcomeContract({attestationOnly:true});process.exit(0)}
if(process.argv.includes('--original-outcome-only')){await originalOutcomeContract();process.exit(0)}

async function legacyReceiptRouterFallbackContract(){
// Legacy import-safe router fallback only; NOT current shipping device admission.
const sqlSource=readFileSync(new URL('../supabase/migrations/20260810140000_finalize_named_manager_messenger_retirement_integrity.sql',import.meta.url),'utf8');
const begin=sqlSource.indexOf('create or replace function public.msg_delete_thread(p_thread_id uuid,p_request_user_id uuid,p_operation_id uuid)');
const end=sqlSource.indexOf('create or replace function public.msg_admin_tombstone_thread(',begin);
assert.ok(begin>=0&&end>begin,'exact user delete RPC source is present');
const deleteSql=sqlSource.slice(begin,end);
assert.match(deleteSql,/pg_advisory_xact_lock\(hashtextextended\(p_operation_id::text,0\)\)/);
assert.match(deleteSql,/v_existing\.thread_id<>p_thread_id or v_existing\.user_id<>p_request_user_id or v_existing\.deletion_scope<>'user'/);
assert.match(deleteSql,/insert into public\.msg_thread_deletion_operations\(operation_id,thread_id,user_id,deletion_scope/);
assert.equal((deleteSql.match(/'operation_id',(?:v_existing\.operation_id|p_operation_id)/g)||[]).length,2,
  'fresh and replayed SQL outcomes must both carry their bound operation');

const thread='10000000-0000-4000-8000-000000000001';
const employee='20000000-0000-4000-8000-000000000002';
const manager='30000000-0000-4000-8000-000000000003';
const managerUser='40000000-0000-4000-8000-000000000004';
const foreignUser='50000000-0000-4000-8000-000000000005';
const operation='60000000-0000-4000-8000-000000000006';
const foreignOperation='70000000-0000-4000-8000-000000000007';
const deletedAt='2026-10-02T12:00:00.123456+00:00';
const deletedThrough='2026-10-02T12:00:00.123457+00:00';
const receipt=(args,changes={})=>({ok:true,deleted:true,thread_id:args.p_thread_id,
  operation_id:args.p_operation_id,deletion_scope:'user',deleted_at:deletedAt,
  deleted_through:deletedThrough,replayed:false,memphis_generation_ended:false,...changes});
let receiptResult=args=>receipt(args),identityMode='normal',participant=true;
const rpcCalls=[];
const app=express();app.use(express.json());
app.use((req,res,next)=>{
    const token=req.headers.authorization;
    if(token==='Bearer employee'){req.memphisDevice={canonical_device_id:'KIOSK_04'};next();return}
    if(token==='Bearer manager' || token==='Bearer manager-read-only'){
      req.memphisAuth={manager_id:manager,read_only:token.endsWith('read-only')};next();return;
    }
    res.status(401).json({ok:false,error:'Legacy recording fixture auth required'});
});
app.use('/messaging-api',createMessagingRouter({
  // Omit requireDeviceAccess ONLY here to select its documented import-safe fallback.
  async runReadOnlySql(statement){
    const query=String(statement);
    if(/public\.device_aliases/.test(query))return [{canonical_device_id:'KIOSK_04',device_id:'KIOSK_04',device_active:true,assigned_employee_id:employee,employee_active:true}];
    if(/public\.msg_get_user_by_device\('KIOSK_04'\)/.test(query))return [identityMode==='missing'?{role:'employee'}:{msg_user_id:employee,role:'employee'}];
    if(/from public\.msg_threads t/.test(query))return [{id:thread,thread_type:'direct',system_key:null,is_active:true,has_memphis_bot:false}];
    if(/from public\.msg_thread_participants/.test(query))return participant?[{present:1}]:[];
    return [];
  },
  async runRpc(name,args){
    rpcCalls.push({name,args});
    if(name==='msg_ensure_ops_manager_user')return {msg_user_id:managerUser,role:'manager'};
    if(name==='msg_delete_thread')return receiptResult(args);
    throw Error(`Unexpected RPC ${name}`);
  },
  buildHealthPayload:()=>({ok:true}),appVersion:'test',releaseId:'test',contractVersion:'messaging.v1',
}));
const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
const origin=`http://127.0.0.1:${server.address().port}`;
const post=async(body={device_id:'KIOSK_04',user_id:employee,operation_id:operation},token='employee')=>{
  const response=await fetch(`${origin}/messaging-api/thread/${thread}/delete`,{method:'POST',
    headers:{'Content-Type':'application/json','x-device-id':'KIOSK_04',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
};
let checks=0;
const check=(label,actual,expected)=>{assert.deepEqual(actual,expected,label);checks++;console.log('PASS',label)};
const deleteCalls=()=>rpcCalls.filter(call=>call.name==='msg_delete_thread');
try{
  let result=await post();
  check('exact employee deletion status',result.status,200);
  check('exact browser receipt fields',Object.fromEntries(['ok','deleted','operation_id','thread_id','user_id','deletion_scope','deleted_at','deleted_through'].map(key=>[key,result.body.data[key]])),
    {ok:true,deleted:true,operation_id:operation,thread_id:thread,user_id:employee,deletion_scope:'user',deleted_at:deletedAt,deleted_through:deletedThrough});
  check('server-derived SQL caller',deleteCalls().at(-1).args,{p_thread_id:thread,p_request_user_id:employee,p_operation_id:operation});
  check('deletion meta preserved',result.body.meta,{version:'test',release_id:'test',contract_version:'messaging.v1',deletion:'current_user_only',authoritative:true,old_history_restores:false,memphis_starts_clean:false});
  receiptResult=args=>receipt(args,{replayed:true});
  result=await post();check('same-operation replay accepted',result.status,200);check('replay user remains authenticated viewer',result.body.data.user_id,employee);
  receiptResult=args=>receipt(args,{user_id:employee});
  result=await post();check('matching optional SQL actor accepted',result.status,200);
  receiptResult=args=>receipt(args,{deleted_at:'2026-10-02T07:00:00.123456-05:00'});
  result=await post();check('equivalent offset with later microsecond accepted',result.status,200);
  const invalid=[
    ['generic ok false',{ok:false}],['deleted false',{deleted:false}],
    ['wrong thread',{thread_id:'80000000-0000-4000-8000-000000000008'}],
    ['wrong operation',{operation_id:foreignOperation}],['missing operation',{operation_id:null}],
    ['foreign SQL actor',{user_id:foreignUser}],['null SQL actor',{user_id:null}],
    ['global scope',{deletion_scope:'global'}],['missing deleted time',{deleted_at:null}],
    ['local civil time',{deleted_at:'2026-10-02T12:00:00'}],
    ['invalid calendar time',{deleted_at:'2026-02-30T12:00:00Z'}],
    ['numeric timestamp',{deleted_at:1790942400123}],
    ['Date timestamp object',{deleted_at:new Date('2026-10-02T12:00:00Z')}],
    ['unknown offset',{deleted_at:'2026-10-02T12:00:00+XX:00'}],
    ['out-of-range offset',{deleted_at:'2026-10-02T12:00:00+24:00'}],
    ['out-of-range offset minutes',{deleted_at:'2026-10-02T12:00:00+00:60'}],
    ['unparseable through',{deleted_through:'yesterday'}],
    ['microsecond reversal',{deleted_through:'2026-10-02T12:00:00.123455+00:00'}],
  ];
  for(const [label,change] of invalid){
    receiptResult=args=>receipt(args,change);result=await post();
    check(`${label} rejected`,result.status,502);check(`${label} no success`,result.body.ok,false);
  }
  for(const [label,value] of [['empty result',[]],['two rows',[receipt({p_thread_id:thread,p_operation_id:operation}),receipt({p_thread_id:thread,p_operation_id:operation})]]]){
    receiptResult=()=>value;result=await post();check(`${label} rejected`,result.status,502);
  }
  receiptResult=args=>receipt(args);
  let before=deleteCalls().length;
  result=await post({device_id:'KIOSK_04',user_id:foreignUser,operation_id:operation});
  check('forged user denied before SQL',result.status,403);check('forged user no delete call',deleteCalls().length,before);
  result=await post({device_id:'KIOSK_04',user_id:employee,operation_id:'invalid'});
  check('invalid operation denied before SQL',result.status,422);check('invalid operation no delete call',deleteCalls().length,before);
  participant=false;result=await post();check('nonparticipant denied before SQL',result.status,403);
  check('nonparticipant no delete call',deleteCalls().length,before);participant=true;
  identityMode='missing';result=await post();check('claimed user cannot fill missing authenticated identity',result.status,400);
  check('missing identity no delete call',deleteCalls().length,before);identityMode='normal';
  result=await post({operation_id:operation},'manager-read-only');
  check('read-only manager cannot delete',result.status,403);check('read-only manager no delete call',deleteCalls().length,before);
  result=await post({operation_id:operation},'manager');
  check('named manager delete allowed',result.status,200);check('named manager actor is server-derived',result.body.data.user_id,managerUser);
  check('named manager SQL caller',deleteCalls().at(-1).args.p_request_user_id,managerUser);
  console.log('MESSAGING_LEGACY_IMPORT_SAFE_DELETE_RECEIPT_CONTRACT_PASS',checks);
}finally{await new Promise(resolve=>server.close(resolve));console.log('OWNED_HTTP_SERVER_CLOSED')}

}
// Normal default suite always covers current original actions and signed routed delete.
await originalOutcomeContract();
await originalOutcomeContract({attestationOnly:true});
await originalOutcomeContract({routerOnly:true});
await legacyReceiptRouterFallbackContract();
