// Compose the actual restore gate (including heartbeat abort) and upload router.
import assert from 'node:assert/strict';
import express from 'express';
import {makeRestoreMutationGate} from '../src/restore-mutation-gate.js';
import {createGeminiConsoleRouter} from '../src/gemini-console-api.js';
const id=n=>'b7000000-0000-4000-8000-'+String(n).padStart(12,'0');
const actor={role:'ops_manager',manager_id:id(2),credential_id:id(3),device_id:'SYNTHETIC_MANAGER',roles:['OPS_MANAGER'],access_level:'full_access',read_only:false};
for(const mode of ['stable','loss-during-upload','loss-during-metadata']){
 let request,row=null,blob=null,inserts=0,removes=0,heartbeats=0,releases=0,waiting=false,terminations=0;const content=Buffer.from('Synthetic original protected upload');
 const heartbeat=()=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Synthetic heartbeat wait expired')),2000);
  const finish=()=>{clearTimeout(timer);resolve();};
  if(mode==='stable')onStable=finish;
  else{const signal=request.restoreMutationLease.signal;if(signal.aborted)finish();else signal.addEventListener('abort',finish,{once:true});}
 });let onStable;
 const supabase={async rpc(name){
  if(name==='custodial_begin_application_mutation_lease')return{data:{mutations_paused:false,authority_generation:1},error:null};
  if(name==='custodial_heartbeat_application_mutation_lease'){heartbeats++;if(mode==='stable')onStable?.();return{data:mode==='stable'||!waiting,error:null};}
  if(name==='custodial_release_application_mutation_lease'){releases++;return{data:true,error:null};}throw Error('Unexpected synthetic RPC');
 },from(table){
  if(table==='gemini_console_conversations')return{select(){return this},eq(){return this},neq(){return this},async maybeSingle(){return{data:{conversation_id:id(7),owner_manager_id:actor.manager_id,status:'active'},error:null};}};
  assert.equal(table,'gemini_console_attachments');let head=false,values;const execute=async()=>{
   if(head)return{count:0,error:null};
   inserts++;assert.equal(request.restoreMutationLease.signal.aborted,false,'metadata writer must begin with current lease');row={...values,status:'pending',message_id:null,deleted_at:null};
   if(mode==='loss-during-metadata'){waiting=true;await heartbeat();}
   return{data:{...row},error:null};
  };return{select(_s,o){head=o?.head===true;return this;},eq(){return this;},in(){return this;},insert(v){values=v;return this;},single:execute,then(ok,bad){return execute().then(ok,bad);}};
 },storage:{from(){return{
  async upload(path,bytes){blob={path,bytes:Buffer.from(bytes)};if(mode!=='loss-during-metadata'){waiting=true;await heartbeat();}return{data:{path},error:null};},async remove(){removes++;throw Error('No trailing Storage compensation');}
 };}}};
 const app=express();app.use(express.json());app.use(makeRestoreMutationGate({supabase,heartbeatMilliseconds:5,disconnectTerminationMilliseconds:1000,terminateUnsettledProcess(){terminations++;},logger:{error(){}}}));app.use((req,res,next)=>{request=req;next();});app.use('/gemini-api',createGeminiConsoleRouter({supabase,requireOpsManagerAuth(req,res,next){req.memphisAuth=actor;next();}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  const r=await fetch('http://127.0.0.1:'+server.address().port+'/gemini-api/conversations/'+id(7)+'/attachments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:'original.txt',mime_type:'text/plain',data_base64:content.toString('base64')})}),body=await r.json();await new Promise(setImmediate);
  assert.ok(heartbeats>=1);assert.equal(releases,1);assert.equal(terminations,0);assert.equal(removes,0);assert.deepEqual(blob.bytes,content);
  if(mode==='stable'){assert.equal(r.status,201);assert.equal(inserts,1);}else{assert.equal(r.status,503);assert.equal(body.code,'attachment_upload_unconfirmed');assert.equal(body.retryable,false);assert.equal(body.data.attachment_id,blob.path.split('/')[2]);assert.equal(body.data.storage_upload,'confirmed');assert.equal(inserts,mode==='loss-during-upload'?0:1);assert.equal(body.data.metadata_insert,mode==='loss-during-upload'?'not_attempted':'confirmed');}
  if(row){assert.equal(row.status,'pending');assert.equal(row.deleted_at,null);assert.equal(row.message_id,null);}
  console.log(JSON.stringify({mode,status:r.status,inserts,heartbeats,releases,terminations,storage_removals:removes,blob_retained:true,result:'PASS'}));
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
console.log(JSON.stringify({suite:'actual-gate-upload-lease-composition',cases:3,status:'PASS',scope:'Real gate/heartbeat/abort and HTTP route, synthetic manager/RPC/DB/Storage; accelerated fixture heartbeat only'}));
