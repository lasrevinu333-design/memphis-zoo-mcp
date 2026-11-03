import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createOpsManagerSession} from '../../src/auth/shared-access-auth.js';
import {createStaticWeeklyControlPlaneRuntime} from '../../src/static-weekly-control-plane-runtime.js';

// Used only by the existing isolated historical-restore publication fixture.
// HTTP/session middleware, named-manager SQL and restore leases are real code.
// The credential binding is a synthetic, per-test-only store, not production.
export async function approvedInitialHttpTransport({database,controlPlane,manager,deadlineAt}){
 assert.ok(database?.connect&&typeof controlPlane?.publishApprovedInitialBaseline==='function');
 assert.ok(Number.isFinite(deadlineAt)&&deadlineAt>performance.now());
 const remaining=()=>{const ms=Math.floor(deadlineAt-performance.now());assert.ok(ms>0,'original fixture deadline');return ms;};
 const credentialId=randomUUID(),deviceId='isolated-approved-initial-'+randomUUID(),activeLeases=new Set(),allLeases=new Set();
 const env={NODE_ENV:'test',SUPABASE_URL:'https://isolated-initial.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only-never-sent',OPS_MANAGER_SESSION_SECRET:randomUUID()+randomUUID()};
 const signedManager={manager_id:manager.manager_id,display_name:manager.manager_display_name,roles:['OPS_MANAGER','CUSTODIAL_MANAGER'],active:true};
 const session=createOpsManagerSession({credentialId,deviceId,manager:signedManager,authMode:'trusted_device',accessLevel:'full_access',maximumAccessLevel:'full_access',env});
 let registryChecks=0,requests=0;const trace=[];
 const store={async find(id){remaining();if(id!==credentialId)return null;
  const result=await database.query('select manager_id,display_name,roles,active,revoked_at,is_system_principal from public.ops_manager_managers where manager_id=$1',[manager.manager_id]);
  const row=result.rows[0];if(!row)return null;registryChecks++;
  return {credential_id:credentialId,device_id:deviceId,manager_id:row.manager_id,manager:row,
   max_access_level:'full_access',created_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+remaining()).toISOString()};}};
 const names={custodial_begin_application_mutation_lease:['p_request_id','p_service_name'],custodial_heartbeat_application_mutation_lease:['p_request_id'],custodial_release_application_mutation_lease:['p_request_id']};
 const supabase={async rpc(name,args){assert.ok(Object.hasOwn(names,name),'only existing restore admission RPCs');const client=await database.connect();let begun=false;
  try{remaining();await client.query('begin');begun=true;await client.query('set local role service_role');await client.query(`set local statement_timeout='${Math.min(4000,remaining())}ms'`);
   const keys=names[name],result=await client.query(`select public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) as data`,keys.map(k=>args[k]));
   await client.query('commit');begun=false;
   if(name==='custodial_begin_application_mutation_lease'){activeLeases.add(args.p_request_id);allLeases.add(args.p_request_id);}
   if(name==='custodial_release_application_mutation_lease'){assert.equal(result.rows[0]?.data,true);activeLeases.delete(args.p_request_id);}
   trace.push(name);return {data:result.rows[0]?.data,error:null};
  }catch(error){if(begun)await client.query('rollback').catch(()=>{});return {data:null,error};}finally{client.release();}}};
 const runtime=createStaticWeeklyControlPlaneRuntime({env,database,controlPlane,datedTransitionController:null,supabase,trustedDeviceStore:store});
 const server=createServer(runtime.app);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin='http://127.0.0.1:'+server.address().port;
 async function request(action,input){requests++;const body={source_id:input.sourceId,effective_start:input.effectiveStart,template_id:input.templateId,expected_revision:input.expectedRevision,
  ...(action==='confirm'?{preview_digest:input.previewDigest,idempotency_key:input.idempotencyKey}:{})};
  const response=await fetch(origin+'/static-weekly/approved-initial/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.token,'X-Device-Id':deviceId},body:JSON.stringify(body),signal:AbortSignal.timeout(Math.max(1,remaining()-100))});
  const value=await response.json();assert.equal(response.status,200,JSON.stringify({action,status:response.status,code:value.code,error:value.error}));assert.equal(value.ok,true);
  assert.equal(activeLeases.size,0,'exact SQL-backed restore lease settled before HTTP success');return value.data;
 }
 return {preview:input=>request('preview',input),confirm:input=>request('confirm',input),
  evidence:()=>({transport:'SIGNED_LOOPBACK_HTTP_ACTUAL_PUBLICATION_SQL_AND_RESTORE_LEASES',registryChecks,requests,leaseCount:allLeases.size,activeLeases:activeLeases.size,rpcTrace:[...trace],production:false}),
  async close(){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));assert.equal(server.listening,false);assert.equal(activeLeases.size,0,'no exact test lease left pending');}};
}
