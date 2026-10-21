import {readFileSync} from 'node:fs';
import {DATED_TRANSITION_STORE_CONTRACT,loadPreparedOctoberDatedPlan,
 createOctoberDatedMaterializationController} from './static-weekly-dated-transition-materialization.js';

export function createOctoberDatedPostgresStore({database,plan}){
 if(typeof database?.connect!=='function')throw Error('dated_transition_database_required');
 return {contract:DATED_TRANSITION_STORE_CONTRACT,async transaction(work){
  const client=await database.connect();let begun=false,managerId=null;
  try{
   await client.query('begin');begun=true;
   await client.query('set local role static_weekly_control_plane');
   // Same top-level lock as existing weekly authority. Snapshot after waiting.
   await client.query('select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))',['memphis-static-weekly-authority']);
   async function call(operation,args={}){
    const result=await client.query('select public.custodial_dated_control($1,$2::jsonb) as data',
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
   const result=await work(tx);await client.query('commit');begun=false;return result;
  }catch(error){
   if(begun)await client.query('rollback').catch(()=>{});
   if(error?.code==='42883'||error?.code==='3F000')throw Object.assign(new Error('dated_transition_database_adapter_unavailable'),{code:'dated_transition_database_adapter_unavailable',cause:error});
   throw error;
  }finally{client.release();}
 }};
}
export function createConfiguredOctoberDatedController(database){
 const plan=loadPreparedOctoberDatedPlan(JSON.parse(readFileSync(new URL('../config/custodial-october-dated-plan-20261001.json',import.meta.url),'utf8')));
 return createOctoberDatedMaterializationController({plan,store:createOctoberDatedPostgresStore({database,plan})});
}
