import {currentManagerTransaction} from './static-weekly-manager-operation.js';
import {readFileSync} from 'node:fs';
import {DATED_TRANSITION_STORE_CONTRACT,loadPreparedOctoberDatedPlan,
 createOctoberDatedMaterializationController} from './static-weekly-dated-transition-materialization.js';

const unavailable=cause=>Object.assign(new Error('dated_transition_database_adapter_unavailable'),{
 code:'dated_transition_database_adapter_unavailable',cause});
function connectionFailure(error){
 const code=String(error?.code||'').toUpperCase(),message=String(error?.message||'').toLowerCase();
 return code.startsWith('08')||['ECONNRESET','ECONNREFUSED','EPIPE','ETIMEDOUT','53300','53400','57P01','57P02','57P03'].includes(code)
  ||['connection terminated','connection error','not queryable','timeout exceeded when trying to connect'].some(s=>message.includes(s));
}

export function createOctoberDatedPostgresStore({database,plan}){
 if(typeof database?.connect!=='function')throw Error('dated_transition_database_required');
 return {contract:DATED_TRANSITION_STORE_CONTRACT,async transaction(work){
  const context=currentManagerTransaction(),signal=context?.signal;
  const deadline=context?.deadlineAt??performance.now()+60000;
  const active=()=>{if(signal?.aborted||performance.now()>=deadline)throw Object.assign(new Error('dated_transition_operation_deadline_unavailable'),{code:'dated_transition_operation_deadline_unavailable'});};
  let client,abortConnect;
  const connecting=Promise.resolve().then(()=>{active();return database.connect();});
  try{
   client=await(signal?Promise.race([connecting,new Promise((_,reject)=>{abortConnect=()=>reject(Object.assign(new Error('dated_transition_operation_deadline_unavailable'),{code:'dated_transition_operation_deadline_unavailable'}));signal.addEventListener('abort',abortConnect,{once:true});if(signal.aborted)abortConnect();})]):connecting);
   active();
  }catch(error){void connecting.then(c=>c.release(error),()=>{});if(connectionFailure(error))throw unavailable(error);throw error;}finally{if(abortConnect)signal.removeEventListener('abort',abortConnect);}
  let begun=false,managerId=null,asynchronousConnectionError=null,discardClientError=null;
  const onConnectionError=error=>{asynchronousConnectionError ||= error instanceof Error?error:new Error('Database connection unavailable.');};
  client.on?.('error',onConnectionError);
  const abort=()=>{discardClientError ||= new Error('Dated request interrupted');try{void client.end?.()?.catch?.(onConnectionError);}catch(error){onConnectionError(error);}};
  signal?.addEventListener('abort',abort,{once:true});
  const query=async(sql,args)=>{active();if(begun)await client.query(`set local statement_timeout = '${Math.max(1,Math.floor(deadline-performance.now()))}ms'`);active();const r=await client.query(sql,args);active();return r;};
  const validate=async()=>{if(!context)return;const m=context.manager;const r=await query('select public.custodial_action_actor_v1($1,$2,$3,$4,$5) as result',[m.manager_id,m.credential_id,m.device_id,m.access_level,'write']);const a=r.rows[0]?.result;if(a?.manager_id!==m.manager_id||a?.credential_id!==m.credential_id||a?.device_id!==m.device_id||a?.owner!==true)throw Object.assign(new Error('Current dated-transition owner authority required'),{code:'42501'});};
  try{
   await query('begin');begun=true;
   await query('set local role static_weekly_control_plane');
   await validate();
   // Drain the COMPLETE transaction before disaster restore, including source
   // reads and authority locking. Do not wait for stage/rollback to fence it.
   await query('select public.custodial_begin_application_mutation()');
   // Same top-level lock as existing weekly authority. Snapshot after waiting.
   await query('select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))',['memphis-static-weekly-authority']);
   async function call(operation,args={}){
    const result=await query('select public.custodial_dated_control($1,$2::jsonb) as data',
     [operation,JSON.stringify({managerId,...args})]);
    return result.rows[0]?.data;
   }
   const tx={
    async snapshot(id,start,end,authorityOnly=false){managerId=id;return call('snapshot',{plan,start,end,authorityOnly});},
    receipt:(id,key)=>call('receipt',{managerId:id,key}),
    stage:value=>call('stage',{plan:value}),readStaged:()=>call('staged'),
    finalize:(request,record)=>call('finalize',{request,record}),
    current:planDigest=>call('current',{planDigest}),
    appendRollback:(request,record)=>call('rollback',{request,record}),
    readCurrentDay:date=>call('day',{date}),
   };
   const result=await work(tx);
   if(asynchronousConnectionError)throw asynchronousConnectionError;
   await validate();await query('commit');begun=false;
   if(asynchronousConnectionError)throw asynchronousConnectionError;
   return result;
  }catch(error){
   let rollbackError=null;
   if(begun)await client.query('rollback').catch(e=>{rollbackError=e;});
   const broken=asynchronousConnectionError||(connectionFailure(error)?error:null)||(connectionFailure(rollbackError)?rollbackError:null);
   if(broken){discardClientError=broken;throw unavailable(broken);}
   if(error?.code==='42883'||error?.code==='3F000')throw unavailable(error);
   throw error;
  }finally{signal?.removeEventListener('abort',abort);client.removeListener?.('error',onConnectionError);client.release(discardClientError||asynchronousConnectionError||undefined);}
 }};
}
export function createConfiguredOctoberDatedController(database){
 const plan=loadPreparedOctoberDatedPlan(JSON.parse(readFileSync(new URL('../config/custodial-october-dated-plan-20261001.json',import.meta.url),'utf8')));
 return createOctoberDatedMaterializationController({plan,store:createOctoberDatedPostgresStore({database,plan})});
}
