// Loopback HTTP + unmodified production middleware/store/control-plane code.
// Only the transport from the Supabase-shaped client to LOCAL PostgreSQL is
// adapted; every read/RPC SET ROLEs to the real intended service_role. This is
// not deployed PostgREST, production sign-in, browser or phone acceptance.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {createOpsManagerSession} from '../../src/auth/shared-access-auth.js';
import {createStaticWeeklyControlPlaneRuntime} from '../../src/static-weekly-control-plane-runtime.js';

export async function postgresAuthenticatedInitialHttp({database,controlPlane,manager,deadlineAt}){
 assert.ok(database?.connect&&controlPlane?.runManagerOperation);
 assert.match(database.options?.host??'',/^\/tmp\/mz-msg-[A-Za-z0-9_-]+\/socket$/,'owned disposable socket only');
 assert.equal(database.options?.database,'postgres');assert.equal(database.options?.user,'supabase_admin');
 const remaining=()=>{const r=Math.floor(deadlineAt-performance.now());assert.ok(r>0,'same diagnostic deadline');return r;};
 const credentialId=randomUUID(),deviceId='isolated-current-owner-'+randomUUID(),activeLeases=new Set(),allLeases=new Set(),trace=[];
 const env={NODE_ENV:'test',SUPABASE_URL:'https://local-sql-adapter.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only-never-sent',OPS_MANAGER_SESSION_SECRET:randomUUID()+randomUUID()};
 await database.query("insert into public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,metadata_json,created_at,expires_at) values($1,$2,'Isolated current manager', $3,'full_access',$4,'{}',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '5 minutes')",[credentialId,deviceId,createHash('sha256').update('synthetic-trust-'+credentialId).digest('hex'),manager.manager_id]);
 let credentialReads=0,managerReads=0;
 const permitted={
  ops_manager_trusted_devices:{key:'credential_id',columns:'credential_id,device_id,device_label,token_hash,max_access_level,manager_id,platform_summary,metadata_json,created_at,last_used_at,expires_at,revoked_at,revoked_reason'},
  ops_manager_managers:{key:'manager_id',columns:'manager_id,display_name,contact_label,roles,active,revoked_at,revoked_reason,created_at,last_access_at,system_key,is_system_principal'},
 };
 const rpcKeys={custodial_begin_application_mutation_lease:['p_request_id','p_service_name'],custodial_heartbeat_application_mutation_lease:['p_request_id'],custodial_release_application_mutation_lease:['p_request_id']};
 async function roleQuery(sql,values){const c=await database.connect();let begun=false;
  try{remaining();await c.query('begin');begun=true;await c.query('set local role service_role');await c.query(`set local statement_timeout='${Math.min(4000,remaining())}ms'`);const r=await c.query(sql,values);await c.query('commit');begun=false;return r;
  }finally{if(begun)await c.query('rollback').catch(()=>{});c.release();}}
 const supabase={
  from(table){assert.ok(Object.hasOwn(permitted,table));let columns=null,key=null,value=null;
   const b={select(s){assert.equal(s,permitted[table].columns);columns=s;return b;},eq(k,v){assert.equal(k,permitted[table].key);key=k;value=v;return b;},async maybeSingle(){assert.ok(columns&&key);try{
    const r=await roleQuery('select '+columns+' from public.'+table+' where '+key+'=$1',[value]);assert.ok(r.rows.length<=1);
    if(table==='ops_manager_trusted_devices')credentialReads++;else managerReads++;
    return {data:r.rows[0]?JSON.parse(JSON.stringify(r.rows[0])):null,error:null};
   }catch(error){return {data:null,error};}}};return b;
  },
  async rpc(name,args){assert.ok(Object.hasOwn(rpcKeys,name));try{const keys=rpcKeys[name],r=await roleQuery('select public.'+name+'('+keys.map((_,i)=>'$'+(i+1)).join(',')+') as data',keys.map(k=>args[k]));
   if(name==='custodial_begin_application_mutation_lease'){assert.equal(r.rows[0].data.request_id,args.p_request_id);activeLeases.add(args.p_request_id);allLeases.add(args.p_request_id);}
   if(name==='custodial_release_application_mutation_lease'){assert.equal(r.rows[0].data,true);activeLeases.delete(args.p_request_id);}
   trace.push(name);return {data:r.rows[0]?.data,error:null};
  }catch(error){return {data:null,error};}},
 };
 // Do not inject a fake find()/manager result: the ordinary store reads the
 // freshly issued SQL credential and current manager registry on every request.
 const runtime=createStaticWeeklyControlPlaneRuntime({env,database,controlPlane,datedTransitionController:null,supabase});
 const server=createServer(runtime.app);await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
 const origin='http://127.0.0.1:'+server.address().port;
 const issue=(level='full_access',signedDevice=deviceId)=>createOpsManagerSession({credentialId,deviceId:signedDevice,manager,authMode:'trusted_device',accessLevel:level,maximumAccessLevel:'full_access',env});
 const full=issue(),readOnly=issue('read_only'),wrongDevice=issue('full_access','different-signed-device');
 const requests=[];
 async function request(path,body,{token=full.token,method='POST'}={}){
  const started=performance.now(),response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),'X-Device-Id':deviceId},...(method==='GET'?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(Math.max(1,remaining()-100))});
  const value=await response.json();requests.push({path,status:response.status,code:value.code??null,elapsed_ms:performance.now()-started});
  // Failure responses release through the existing finish callback. Await its
  // exact owned RPC outcome, without dropping/expiring a lease to make a PASS.
  const until=Math.min(deadlineAt,performance.now()+1000);
  while(activeLeases.size&&performance.now()<until)await new Promise(r=>setTimeout(r,5));
  assert.equal(activeLeases.size,0,'all exact request leases settled');return {status:response.status,value};
 }
 return {request,origin,session:()=>({...full}),authHeaders:()=>({Authorization:'Bearer '+full.token,'X-Device-Id':deviceId}),
  readOnlyToken:readOnly.token,wrongDeviceToken:wrongDevice.token,
  async revoke(){await database.query('update public.ops_manager_trusted_devices set revoked_at=clock_timestamp(),revoked_reason=$2 where credential_id=$1',[credentialId,'isolated regression only']);},
  async restore(){await database.query('update public.ops_manager_trusted_devices set revoked_at=null,revoked_reason=null where credential_id=$1',[credentialId]);},
  async evidence(){const rows=await database.query('select count(*)::int n from custodial_dr.application_mutation_leases where request_id=any($1::uuid[])',[[...allLeases]]);assert.equal(rows.rows[0].n,0);return {scope:'REAL_LOOPBACK_HTTP_CURRENT_SQL_CREDENTIAL_REGISTRY_ACTOR_AND_RESTORE_RPCS_WITH_LOCAL_SQL_TRANSPORT_ADAPTER',credentialReads,managerReads,requests,leaseCount:allLeases.size,activeLeases:activeLeases.size,sqlLeaseRows:rows.rows[0].n,rpcTrace:trace,production:false,deployedPostgREST:false,browser:false,phone:false};},
  async close(){server.closeAllConnections();await new Promise((r,j)=>server.close(e=>e?j(e):r()));assert.equal(server.listening,false);assert.equal(activeLeases.size,0);},
 };
}
