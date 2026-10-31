// Invoked only by the root-owned frozen source303 database runner. This module
// creates no pool, database, socket, server or process and never reads a target URL.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {installCustodialRecordRoutes,validateRecordOperation} from '../src/custodial-record-operations.mjs';
import {createCustodialLeadershipRecordBridge} from '../src/auth/custodial-leadership-record-operation.mjs';
import {createCustodialLeadershipRemoteVerifier} from '../src/auth/custodial-leadership-runtime.js';
import {makeOpsAccessMiddleware,createCustodialLeadershipOpsSession} from '../src/auth/shared-access-auth.js';

const id=n=>`c7290000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sharedSession='c7200000-0000-4000-8000-000000000013';
const base='/admin-api/custodial';
const postPath=base+'/cleaning-sessions/:sessionId/corrections';
const truthPath=base+'/cleaning-sessions/:sessionId/truth';
const outcomePath=postPath+'/:operationId';
const internalBase='/custodial-leadership-internal';
const response=()=>({statusCode:200,headers:{},status(n){this.statusCode=n;return this;},
  set(k,v){this.headers[k]=v;return this;},setHeader(k,v){this.headers[k]=v;},
  json(value){this.body=value;return this;}});

export async function run(context){
  const {fixture,pool,cohort,save,assertFrozen}=context;
  assert.equal(typeof fixture?.assertOwned,'function');
  assert.equal(typeof assertFrozen,'function');assert.equal(typeof save,'function');
  assertFrozen();await fixture.assertOwned();
  assert.equal(fixture.receipt.selected_replay.migrations,303);
  assert.equal(pool.options.host,fixture.socketDirectory);
  assert.ok(fixture.socketDirectory?.startsWith('/'));
  assert.ok(cohort?.manager?.token&&cohort.service&&cohort.router);
  assert.equal(typeof cohort.verifyTransaction,'function');
  for(const key of ['DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL'])
    assert.equal(process.env[key],undefined,'Ambient target configuration is forbidden: '+key);
  const {manager,env,csrf}=cohort,checks=[],transportCalls=[];
  let legacyCalls=0,sequence=0;
  const mark=(name,detail={})=>{checks.push({name,status:'PASS',...detail});save('RECORD_CHECK_'+String(checks.length).padStart(3,'0')+'.json',checks.at(-1));};
  const step=async(name,fn)=>{
    const n=++sequence;assertFrozen();await fixture.assertOwned();
    save('RECORD_STEP_'+String(n).padStart(3,'0')+'_BEFORE.json',{name});
    try{return await fn();}catch(error){
      save('RECORD_STEP_'+String(n).padStart(3,'0')+'_FAILURE.json',{name,status:'FAIL',code:error.code??null,message:error.message});throw error;
    }
  };
  const query=async(sql,args=[])=>{assertFrozen();await fixture.assertOwned();return pool.query(sql,args);};
  const original=(await query('select to_jsonb(s) as original from public.sessions s where id=$1',[sharedSession])).rows[0]?.original;
  assert.equal(original?.status,'closed','Shared signed fixture must provide its original completed session');
  const originalResponses=(await query('select to_jsonb(c) as original from public.completion_responses c where session_id=$1 order by id',[sharedSession])).rows;
  assert.ok(originalResponses.length>0);
  assert.equal(Number((await query('select count(*) as n from public.custodial_session_corrections where session_id=$1',[sharedSession])).rows[0].n),0,
    'Record extension requires the untouched committed signed fixture, not rollback-test corrections');

  // Root retains these synthetic rows until it destroys its exact owned database.
  // Session INSERT uses the maintained snapshot trigger; no trigger/grant bypass.
  await step('create unique c729 record fixtures in existing owned database',async()=>{
    const c=await pool.connect();
    try{
      await c.query('begin');await c.query("set local statement_timeout='5000ms'");
      await c.query('insert into public.employees(id,employee_code,display_name) values($1,$2,$3)',
        [id(1),'SYNTHETIC-SEALED-RECORD-EXTENSION','Synthetic corrected record employee']);
      for(const n of [101,102])await c.query(`insert into public.sessions(id,session_uuid,location_id,employee_id,device_id,status,started_at,ended_at,completion_source)
        select $1,$2,location_id,employee_id,device_id,'closed',started_at,ended_at,completion_source from public.sessions where id=$3`,
        [id(n),'sealed-record-concurrency-'+n,sharedSession]);
      await c.query('commit');
    }catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}
    mark('unique fixtures use current directory/session table guards');
  });

  // In-memory HTTP transport invokes the actual root CP route handlers. JSON
  // decoding is the only modeled HTTP port; no Express socket/body-stream claim.
  const handlers=new Map();
  for(const suffix of ['/verify','/records']){
    const layers=cohort.router.stack.filter(x=>x.route?.path===internalBase+suffix&&x.route.methods?.post);
    assert.equal(layers.length,1,'Exactly one actual current CP handler: '+suffix);
    const handler=layers[0].route.stack.at(-1)?.handle;assert.equal(typeof handler,'function');handlers.set(suffix,handler);
  }
  const companionOrigin=new URL(env.STATIC_WEEKLY_CONTROL_PLANE_PUBLIC_URL).origin;
  const origin=String(env.CUSTODIAL_LEADERSHIP_ALLOWED_ORIGINS).split(',')[0].trim();
  assert.ok(origin.startsWith('https://'));
  const fetchImpl=async(url,init)=>{
    assertFrozen();await fixture.assertOwned();assert.equal(init.method,'POST');assert.equal(init.redirect,'error');
    const target=new URL(url);assert.equal(target.origin,companionOrigin);assert.equal(target.search,'');
    const suffix=target.pathname.slice(internalBase.length);assert.equal(target.pathname,internalBase+suffix);
    assert.ok(handlers.has(suffix),'No unrecognized or external HTTP destination');
    const body=JSON.parse(init.body),headers={authorization:init.headers.Authorization};
    const req={method:'POST',url:target.pathname,originalUrl:target.pathname,body,headers,
      get:k=>headers[k.toLowerCase()]||'',header:k=>headers[k.toLowerCase()]||''};
    const res=response();await handlers.get(suffix)(req,res);
    transportCalls.push({path:target.pathname,action:body.action??null,status:res.statusCode});
    return new Response(JSON.stringify(res.body),{status:res.statusCode});
  };
  const routes=[],app={get:(path,...stack)=>routes.push({method:'GET',path,stack}),post:(path,...stack)=>routes.push({method:'POST',path,stack})};
  const auth={env,trustedDeviceStore:{find:async()=>{throw Error('Cohort cannot fall back to named trusted-device lookup');}},
    leadershipVerifier:createCustodialLeadershipRemoteVerifier({env,fetchImpl})};
  installCustodialRecordRoutes(app,{requireOpsManagerAuth:makeOpsAccessMiddleware(auth),
    requireOpsManagerWrite:makeOpsAccessMiddleware({...auth,requireWrite:true}),
    managerId:req=>req.memphisAuth.manager_id,backendSecret:()=>{throw Error('Cohort cannot read a legacy backend secret');},
    runRpc:async()=>{legacyCalls++;throw Error('Cohort cannot use legacy runRpc');},
    leadershipRecordBridge:createCustodialLeadershipRecordBridge({env,fetchImpl})});
  async function route(method,pattern,{params={sessionId:sharedSession},body={},op=id(201),csrfValue=csrf,token=manager.token,originValue=origin}={}){
    const selected=routes.find(r=>r.method===method&&r.path===pattern);assert.ok(selected);
    const path=pattern.replace(/:([A-Za-z]+)/g,(_,key)=>encodeURIComponent(params[key]));
    const headers={authorization:'Bearer '+token,origin:originValue,'x-csrf-token':csrfValue,'idempotency-key':op};
    const req={method,path,url:path,originalUrl:path,params,query:{},body,headers,
      get:k=>headers[k.toLowerCase()]||'',header:k=>headers[k.toLowerCase()]||''},res=response();
    for(const fn of selected.stack){let next=false;await fn(req,res,()=>{next=true;});if(!next)break;}
    return res;
  }
  const firstBody={reason:'Synthetic original HTTP record correction',expected_correction_id:null,
    expected_session_uuid:original.session_uuid,corrected_employee_id:id(1)};
  await step('real signed/current route denies CSRF, altered claims and missing preview markers',async()=>{
    const before=Number((await query('select count(*) as n from public.custodial_session_corrections where session_id=$1',[sharedSession])).rows[0].n);
    for(const csrfValue of ['',randomUUID()])assert.equal((await route('POST',postPath,{body:firstBody,csrfValue})).statusCode,403);
    assert.equal((await route('POST',postPath,{body:firstBody,originValue:'https://unapproved.invalid'})).statusCode,403);
    assert.equal((await route('POST',postPath,{body:firstBody,token:manager.token+'x'})).statusCode,401);
    const {token:unusedToken,expires_at:unusedExpiry,...expectedClaims}=manager;
    const changed=createCustodialLeadershipOpsSession({expectedClaims:{...expectedClaims,claimed_manager_id:id(999)},
      credentialExpiresAt:manager.expires_at,env});
    assert.equal((await route('POST',postPath,{body:firstBody,token:changed.token})).statusCode,403);
    for(const marker of ['expected_correction_id','expected_session_uuid']){
      const body={...firstBody};delete body[marker];assert.equal((await route('POST',postPath,{body})).statusCode,422);
    }
    assert.equal((await route('POST',postPath,{body:firstBody,op:''})).statusCode,422);
    assert.equal((await route('POST',postPath,{body:{...firstBody,manager_id:id(999)}})).statusCode,422);
    assert.equal(Number((await query('select count(*) as n from public.custodial_session_corrections where session_id=$1',[sharedSession])).rows[0].n),before);
    mark('actual shared auth/current CP service rejects invalid CSRF, origin, token, selected claim and missing markers without correction');
  });

  let firstCorrection,originalReceipt;
  await step('actual public route to companion commits and reads original attributed correction',async()=>{
    const created=await route('POST',postPath,{body:firstBody});
    assert.equal(created.statusCode,201,JSON.stringify(created.body));assert.equal(created.body.ok,true);
    assert.equal(created.body.data.operation_id,id(201));assert.equal(created.body.data.replayed,false);
    firstCorrection=created.body.data.correction_id;assert.ok(firstCorrection);
    assert.equal(created.headers['Cache-Control'],'no-store');
    const truth=await route('GET',truthPath,{csrfValue:''});assert.equal(truth.statusCode,200,JSON.stringify(truth.body));
    assert.equal(truth.body.data.correction_id,firstCorrection);assert.equal(truth.body.data.current_employee_id,id(1));
    assert.equal(truth.body.data.session_uuid,original.session_uuid);
    const replay=await route('POST',postPath,{body:firstBody});assert.equal(replay.statusCode,200,JSON.stringify(replay.body));
    assert.equal(replay.body.data.replayed,true);assert.equal(replay.body.data.correction_id,firstCorrection);
    const status=await route('GET',outcomePath,{params:{sessionId:sharedSession,operationId:id(201)},csrfValue:''});
    assert.equal(status.statusCode,200,JSON.stringify(status.body));originalReceipt=status.body.data;
    assert.equal(originalReceipt.found,true);assert.equal(originalReceipt.operation_id,id(201));
    assert.equal(originalReceipt.actor_manager_id,manager.manager_id);
    assert.equal(originalReceipt.actor_name,manager.claimed_manager_display_name+' (shared PIN; self-asserted)');
    const rows=(await query('select to_jsonb(c) as value from public.custodial_session_corrections c where operation_id=$1',[id(201)])).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].value.corrected_by_manager_id,manager.manager_id);
    assert.equal(rows[0].value.corrected_by_manager_name_snapshot,originalReceipt.actor_name);
    const events=(await query(`select credential_id,device_id,detail_json from public.ops_manager_auth_events
      where event_type='cleaning_record_correction_recorded' and detail_json->>'operation_id'=$1`,[id(201)])).rows;
    assert.equal(events.length,1);const audit=events[0];assert.equal(audit.credential_id,null);assert.equal(audit.device_id,manager.device_id);
    assert.equal(audit.detail_json.actor.credential_id,manager.credential_id);assert.equal(audit.detail_json.actor.claimed_account_id,manager.claimed_manager_id);
    assert.equal(audit.detail_json.actor.owner,false);assert.equal(audit.detail_json.actor.identity_assurance,'SELF_ASSERTED_NAME');
    assert.equal(audit.detail_json.actor.individual_identity_verified,false);assert.ok(audit.detail_json.actor.request_id);
    assert.equal(legacyCalls,0);
    mark('actual HTTP→bridge→current CP /records→SQL commits once, reads truth/status, preserves original audit on replay',
      {operationId:id(201),correctionId:firstCorrection,cohortId:manager.manager_id,claimedAccountId:manager.claimed_manager_id});
  });
  await step('later correction leaves original receipt and raw phone records unchanged',async()=>{
    const later={reason:'Synthetic later HTTP record correction',expected_correction_id:firstCorrection,
      expected_session_uuid:original.session_uuid,corrected_ended_at:new Date(Date.parse(original.ended_at)+2000).toISOString()};
    const created=await route('POST',postPath,{body:later,op:id(202)});assert.equal(created.statusCode,201,JSON.stringify(created.body));
    assert.notEqual(created.body.data.correction_id,firstCorrection);
    const status=await route('GET',outcomePath,{params:{sessionId:sharedSession,operationId:id(201)},csrfValue:''});
    assert.equal(status.statusCode,200);assert.deepEqual(status.body.data,originalReceipt);
    const repeated=await route('POST',postPath,{body:firstBody});assert.equal(repeated.statusCode,200);assert.equal(repeated.body.data.correction_id,firstCorrection);
    assert.equal((await route('POST',postPath,{body:{...firstBody,reason:'Different original payload'}})).statusCode,409);
    assert.equal((await route('POST',postPath,{body:firstBody,op:id(203)})).statusCode,409);
    assert.deepEqual((await query('select to_jsonb(s) as original from public.sessions s where id=$1',[sharedSession])).rows[0].original,original);
    assert.deepEqual((await query('select to_jsonb(c) as original from public.completion_responses c where session_id=$1 order by id',[sharedSession])).rows,originalResponses);
    mark('later correction cannot substitute original receipt; conflicting replay/stale preview deny; original session/response remain exact');
  });

  // Hold A's real uncommitted write while B starts its original request. Observe
  // B blocked by A using pg_blocking_pids from A itself (no third pool client).
  // This establishes actual overlap, not sequential Promise.all success.
  async function concurrent({sessionId,sameOperation}){
    const clients=[];let pendingB;
    try{
      clients.push(await pool.connect());clients.push(await pool.connect());
      const [left,right]=clients,pids=[];
      for(const c of clients){
        await c.query('begin');await c.query('set local role static_weekly_control_plane');
        await c.query("set local statement_timeout='5000ms'");await c.query("set local lock_timeout='5000ms'");
        await cohort.verifyTransaction(c,{manager,leadershipRequestId:randomUUID()});
        pids.push((await c.query('select pg_backend_pid() as pid')).rows[0].pid);
      }
      assert.notEqual(pids[0],pids[1],'Two distinct server connections are required');
      const operationA=sameOperation?id(301):id(401),operationB=sameOperation?operationA:id(402);
      const common={session_id:sessionId,reason:'Synthetic concurrent completed correction',expected_correction_id:null,
        expected_session_uuid:'sealed-record-concurrency-'+(sameOperation?101:102),corrected_employee_id:id(1)};
      const sql='select public.custodial_leadership_record_operation_v1($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb) as result';
      const params=operationId=>[manager.manager_id,manager.credential_id,manager.device_id,'correct',
        JSON.stringify(validateRecordOperation('correct',{...common,operation_id:operationId}))];
      const first=(await left.query(sql,params(operationA))).rows[0].result;assert.equal(first.replayed,false);
      let settled=false;
      pendingB=right.query(sql,params(operationB)).then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
      let observedBlocking=false;
      for(let attempt=0;attempt<100&&!settled;attempt++){
        observedBlocking=(await left.query('select $1::integer=any(pg_blocking_pids($2::integer)) as blocked',pids)).rows[0].blocked===true;
        if(observedBlocking)break;await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(observedBlocking,true,'Original request B must actually wait on uncommitted A');
      await left.query('commit');const second=await pendingB;pendingB=null;
      if(sameOperation){
        if(second.error)throw second.error;
        const replay=second.value.rows[0].result;assert.equal(replay.replayed,true);
        assert.deepEqual({...replay,replayed:false},first);await right.query('commit');
      }else{
        assert.ok(second.error,'Different operation with stale common marker must reject');assert.equal(second.error.code,'40901');
        await right.query('rollback');
      }
      const corrections=(await left.query('select operation_id,correction_id from public.custodial_session_corrections where session_id=$1',[sessionId])).rows;
      assert.equal(corrections.length,1);assert.equal(corrections[0].operation_id,operationA);assert.equal(corrections[0].correction_id,first.correction_id);
      const auditCount=Number((await left.query(`select count(*) as n from public.ops_manager_auth_events
        where event_type='cleaning_record_correction_recorded' and detail_json->>'session_id'=$1`,[sessionId])).rows[0].n);
      assert.equal(auditCount,1);
      return {sessionId,operationA,operationB,pids,observedBlocking,correctionId:first.correction_id,
        secondResult:sameOperation?'EXACT_ORIGINAL_REPLAY':'40901',correctionRows:corrections.length,auditRows:auditCount};
    }finally{
      // Release A before awaiting B on failure, so cleanup cannot strand its lock wait.
      if(clients[0])await clients[0].query('rollback').catch(()=>{});
      if(pendingB)await pendingB.catch(()=>{});
      if(clients[1])await clients[1].query('rollback').catch(()=>{});
      for(const c of clients)c.release();
    }
  }
  await step('two actual connections serialize same original operation into one append and exact replay',async()=>{
    const result=await concurrent({sessionId:id(101),sameOperation:true});save('RECORD_SAME_OPERATION_CONCURRENCY.json',result);
    mark('same-operation concurrency: observed real lock wait, one correction/audit, exact original replay',result);
  });
  await step('two actual connections enforce one winner for different operations sharing the preview marker',async()=>{
    const result=await concurrent({sessionId:id(102),sameOperation:false});save('RECORD_PREVIEW_CAS_CONCURRENCY.json',result);
    mark('different-operation concurrency: observed real lock wait, one correction/audit, one 40901 conflict',result);
  });
  await step('final original preservation and shared cohort availability',async()=>{
    assert.deepEqual((await query('select to_jsonb(s) as original from public.sessions s where id=$1',[sharedSession])).rows[0].original,original);
    assert.deepEqual((await query('select to_jsonb(c) as original from public.completion_responses c where session_id=$1 order by id',[sharedSession])).rows,originalResponses);
    const verified=await cohort.service.authenticateManagerSessionToken({token:manager.token,csrf,requireCsrf:true});
    assert.equal(verified.managerSession.manager_id,manager.manager_id);assert.equal(verified.managerSession.claimed_manager_id,manager.claimed_manager_id);
    assert.equal(legacyCalls,0);assertFrozen();await fixture.assertOwned();
    mark('shared original records and current cohort remain available for later root extensions; no legacy RPC used');
  });
  const result={status:'PASS',checks,transportCalls,legacyCalls,scope:'ROOT_OWNED_REAL_SQL_WITH_IN_MEMORY_HTTP_AND_OBSERVED_TWO_CONNECTION_LOCK_WAITS',
    socketsOpened:0,createdPools:0,production:false,physicalAcceptance:false,independentAudit:false};
  save('RECORD_EXTENSION_RESULT.json',result);return result;
}
