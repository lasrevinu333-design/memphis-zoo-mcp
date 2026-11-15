// Actual HTTP router; synthetic database, Storage, authority and mutation lease.
// No Supabase request or real attachment deletion occurs.
import assert from 'node:assert/strict';import express from 'express';import{createGeminiConsoleRouter}from'../src/gemini-console-api.js';
const id=n=>'ba000000-0000-4000-8000-'+String(n).padStart(12,'0');
for(const mode of ['success','db-error','db-throw','missing-update','wrong-row','wrong-state','storage-error','storage-throw','lookup-error','not-found','lease-retired','bad-actor']){
 const actor={role:'ops_manager',manager_id:mode==='bad-actor'?'invalid':id(2),credential_id:id(3),device_id:'SYNTHETIC_MANAGER',roles:['OPS_MANAGER'],access_level:'full_access',read_only:false};
 const row={attachment_id:id(8),conversation_id:id(7),manager_id:id(2),status:'pending',storage_bucket:'synthetic-private',storage_path:'synthetic-only/file.txt'};
 let removes=0,updates=0,blob=true,leases=0;const queries=[];
 const supabase={from(table){assert.equal(table,'gemini_console_attachments');const query={action:'read',filters:[],columns:null};queries.push(query);
  return {select(columns){query.columns=columns;return this},eq(k,v){query.filters.push([k,v]);return this},update(values){query.action='update';query.values=values;return this},async maybeSingle(){
   if(query.action==='read'){if(mode==='lookup-error')return{data:null,error:{message:'SYNTHETIC-PRIVATE-DB-DETAIL'}};if(mode==='not-found')return{data:null,error:null};return{data:{...row},error:null};}
   updates++;assert.deepEqual(query.filters,[['attachment_id',id(8)],['manager_id',id(2)],['status','pending']]);assert.equal(query.columns,'attachment_id,status');
   assert.equal(query.values.status,'deleted');assert.ok(Number.isFinite(Date.parse(query.values.deleted_at)));
   if(mode==='db-error')return{data:null,error:{code:'40001',message:'SYNTHETIC-PRIVATE-DB-DETAIL'}};
   if(mode==='db-throw')throw Error('SYNTHETIC-PRIVATE-DB-DETAIL');
   if(mode==='missing-update')return{data:null,error:null};
   if(mode==='wrong-row')return{data:{attachment_id:id(99),status:'deleted'},error:null};
   if(mode==='wrong-state')return{data:{attachment_id:id(8),status:'pending'},error:null};
   row.status='deleted';return{data:{attachment_id:row.attachment_id,status:row.status},error:null};
  }};
 },storage:{from(bucket){assert.equal(bucket,row.storage_bucket);return{async remove(paths){removes++;assert.deepEqual(paths,[row.storage_path]);if(mode==='storage-error')return{error:{message:'SYNTHETIC-PRIVATE-STORAGE-DETAIL'}};if(mode==='storage-throw')throw Error('SYNTHETIC-PRIVATE-STORAGE-DETAIL');blob=false;return{data:paths,error:null};}}}}};
 const app=express();app.use('/gemini-api',createGeminiConsoleRouter({supabase,requireOpsManagerAuth:(req,res,next)=>{req.memphisAuth={...actor};req.restoreMutationLease={assertActive(){leases++;if(mode==='lease-retired'&&leases===2)throw Error('SYNTHETIC-LEASE-RETIRED');}};next();}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const res=await fetch('http://127.0.0.1:'+server.address().port+'/gemini-api/attachments/'+row.attachment_id,{method:'DELETE'});const body=await res.json();
  assert.doesNotMatch(JSON.stringify(body),/SYNTHETIC-PRIVATE|SYNTHETIC-LEASE/);
  if(mode==='success'){assert.equal(res.status,200);assert.equal(body.ok,true);assert.deepEqual(body.data,{attachment_id:id(8),status:'deleted'});assert.equal(row.status,'deleted');assert.equal(blob,false);assert.equal(removes,1);assert.equal(updates,1);}
  else {assert.equal(body.ok,false);assert.equal(row.status,'pending');assert.ok(removes<=1&&updates<=1,'no automatic destructive retry');
   if(['db-error','db-throw','missing-update','wrong-row','wrong-state','lease-retired'].includes(mode)){assert.equal(res.status,503);assert.equal(body.code,'attachment_deletion_unconfirmed');assert.deepEqual(body.data,{attachment_id:id(8),storage_removal:'confirmed',metadata_transition:'unconfirmed'});assert.equal(blob,false);assert.equal(removes,1);}
   else {assert.equal(blob,true);assert.equal(updates,0);if(mode==='not-found')assert.equal(res.status,404);if(mode==='bad-actor')assert.equal(res.status,403);}
  }
  console.log(JSON.stringify({mode,status:res.status,storage_calls:removes,metadata_updates:updates,blob_present:blob,row_status:row.status,result:'PASS'}));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
