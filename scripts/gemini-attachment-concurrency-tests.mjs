// Two actual HTTP requests and actual abandoned-cleanup function. The synthetic
// begin RPC follows the retained SQL UPDATE predicate; no provider/SQL call.
import assert from 'node:assert/strict';import express from 'express';import vm from 'node:vm';
import {readFileSync}from'node:fs';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';
for(const key of ['GEMINI_CONSOLE_API_KEY','MEMPHIS_GEMINI_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY'])delete process.env[key];
const filename=new URL('../src/gemini-console-api.js',import.meta.url),source=readFileSync(filename,'utf8');
const context=vm.createContext({Buffer,process,console,setInterval:()=>({unref(){}}),setTimeout:()=>({unref(){}})});
const module=new vm.SourceTextModule(source.replace('  const cleanupTimer = setInterval','  router.__testCleanup = cleanupAbandonedAttachments;\n  const cleanupTimer = setInterval'),{identifier:filename.href,context});
await module.link(async spec=>{const actual=await import(new URL(spec.startsWith('.')?spec:spec,filename).href).catch(async error=>{if(!spec.startsWith('.'))return import(spec);throw error;}),keys=Object.keys(actual);return new vm.SyntheticModule(keys,function(){for(const key of keys)this.setExport(key,actual[key]);},{context});});await module.evaluate();
const {createGeminiConsoleRouter}=module.namespace,id=n=>'ba000000-0000-4000-8000-'+String(n).padStart(12,'0');
const actor={role:'ops_manager',manager_id:id(2),credential_id:id(3),device_id:'SYNTHETIC_MANAGER',roles:['OPS_MANAGER'],access_level:'full_access',read_only:false};
const content=Buffer.from('retained attachment');let checks=0;const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
for(const mode of ['send-wins','delete-wins','two-deletes','cleanup-send-wins','cleanup-delete-wins','cleanup-storage-failure']){
 const row={attachment_id:id(8),conversation_id:id(7),manager_id:id(2),message_id:null,status:'pending',deleted_at:null,created_at:'2000-01-01T00:00:00Z',storage_bucket:'synthetic-private',storage_path:'synthetic/file.txt',original_filename:'file.txt',mime_type:'text/plain',sha256:createHash('sha256').update(content).digest('hex'),metadata_json:{original:'keep'}};
 let blob=true,claims=0,refusals=0,removes=0,reserves=0,finals=0,listings=0,leaseBegins=0,leaseReleases=0,signal,release;
 const reached=new Promise(r=>signal=r),continued=new Promise(r=>release=r);
 const supabase={from(table){
  if(table==='gemini_console_conversations')return{select(){return this},eq(){return this},neq(){return this},async maybeSingle(){return{data:{conversation_id:id(7),owner_manager_id:id(2),status:'active'},error:null}}};
  if(table==='gemini_console_messages')return{update(){return this},eq(){return this},lt(){return Promise.resolve({error:null})}};
  check(table,'gemini_console_attachments');let values,filters=[],listing=false;
  const execute=async()=>{
   if(listing){listings++;return{data:row.status==='pending'?[{...row}]:[],error:null};}
   const phase=!values?'read':values.status==='deleted'?'reserve':'final';
   if(phase==='reserve'&&mode==='cleanup-send-wins'&&row.status==='pending'){row.status='attached';row.message_id=id(9);claims++;}
   if(!filters.every(f=>f(row)))return{data:null,error:null};
   if(phase==='read'){const snapshot={...row};if(mode==='send-wins'){signal();await continued;}return{data:snapshot,error:null};}
   Object.assign(row,values);if(phase==='reserve')reserves++;else finals++;return{data:{...row},error:null};
  };
  return{select(){return this},eq(k,v){filters.push(r=>r[k]===v);return this},neq(k,v){filters.push(r=>r[k]!==v);return this},is(k,v){filters.push(r=>r[k]===v);return this},lt(){return this},limit(){listing=true;return this},update(v){values=v;return this},maybeSingle:execute,then(ok,bad){return execute().then(ok,bad)}};
 },storage:{from(){return{async remove(){removes++;check(row.status,'deleted');check(row.message_id,null);check(row.deleted_at,null);
  if(['delete-wins','two-deletes'].includes(mode)){signal();await continued;}
  if(mode==='cleanup-delete-wins'){if(row.status==='pending'||row.message_id===id(9)){row.status='attached';row.message_id=id(9);claims++;}else refusals++;}
  if(mode==='cleanup-storage-failure')return{error:Error('Synthetic Storage failure')};blob=false;return{data:[{name:row.storage_path}],error:null};
 },async download(){return blob?{data:{arrayBuffer:async()=>content},error:null}:{data:null,error:Error('Synthetic blob absent')}}}}},async rpc(name,args){
  if(name==='custodial_begin_application_mutation_lease'){leaseBegins++;return{data:{mutations_paused:false,authority_generation:1},error:null};}
  if(name==='custodial_release_application_mutation_lease'){leaseReleases++;return{data:true,error:null};}
  if(name==='gemini_console_fail_turn')return{data:true,error:null};
  check(name,'gemini_console_begin_turn');check(args.p_attachment_ids,[row.attachment_id]);
  if(row.status!=='pending'&&row.message_id!==id(9)){refusals++;return{data:null,error:Error('one or more attachments are unavailable')};}
  row.status='attached';row.message_id=id(9);claims++;return{data:{user_message:{message_id:id(9),role:'user',body:'Synthetic fixture'},claimed:true},error:null};
 }};
 const app=express();app.use(express.json());const router=createGeminiConsoleRouter({supabase,requireOpsManagerAuth:(req,res,next)=>{req.memphisAuth=actor;req.restoreMutationLease={assertActive(){}};next();}});app.use('/gemini-api',router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/gemini-api',deleting=()=>fetch(base+'/attachments/'+id(8),{method:'DELETE'}),sending=()=>fetch(base+'/conversations/'+id(7)+'/messages/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_message_id:id(10),correlation_id:id(11),body:'Synthetic fixture',attachment_ids:[id(8)]})});
 try{
  if(mode.startsWith('cleanup-')){
   await router.__testCleanup();check(listings,1);check(leaseBegins,1);check(leaseReleases,1);
   if(mode==='cleanup-send-wins'){check(claims,1);check(removes,0);check(blob,true);check(row.status,'attached');}
   else if(mode==='cleanup-delete-wins'){check(claims,0);check(refusals,1);check(removes,1);check(blob,false);check(row.status,'deleted');}
   else {check(removes,1);check(blob,true);check(row.status,'deleted');check(row.deleted_at,null);check(finals,0);await router.__testCleanup();check(removes,1);}
  }else{
   const pending=deleting();await reached;
   if(mode==='send-wins'){
    const send=await sending(),text=await send.text();check(send.status,200);assert.ok(text.includes(id(9)));checks++;check(claims,1);release();const response=await pending,body=await response.json();check(response.status,503);check(body.data.storage_removal,'not_attempted');check(row.status,'attached');check(blob,true);check(removes,0);check((await fetch(base+'/attachments/'+id(8))).status,200);
   }else if(mode==='delete-wins'){
    check(row.status,'deleted');const send=await sending();await send.text();check(claims,0);check(refusals,1);release();check((await pending).status,200);check(row.status,'deleted');check(blob,false);check(removes,1);check(finals,1);
   }else{
    const second=await deleting();check(second.status,404);check(removes,1);release();check((await pending).status,200);check(removes,1);check(reserves,1);check(finals,1);
   }
  }
  check(row.metadata_json,{original:'keep'});console.log(JSON.stringify({mode,claims,refusals,storage_calls:removes,reservations:reserves,final_updates:finals,blob_present:blob,row_status:row.status,status:'PASS'}));
 }finally{release();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
console.log(JSON.stringify({suite:'gemini-attachment-concurrency',modes:6,checks,status:'PASS',scope:'Actual HTTP routes/cleanup and real lease lifecycle, synthetic relational/RPC/Storage ports; no SQL/provider'}));
