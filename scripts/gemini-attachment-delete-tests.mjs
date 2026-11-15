// Actual HTTP router with relational filters, synthetic Storage and lease ports.
// No provider/current attachment is accessed. Ambiguity never releases retirement.
import assert from 'node:assert/strict';
import express from 'express';
import {createGeminiConsoleRouter} from '../src/gemini-console-api.js';
const id=n=>'ba000000-0000-4000-8000-'+String(n).padStart(12,'0');
const modes=['success','success-normalized-timestamp','reserve-error','reserve-throw','reserve-missing','reserve-wrong-row','reserve-wrong-state','reserve-wrong-owner','reserve-missing-message-pin','reserve-lost-response','final-error','final-throw','final-missing','final-wrong-row','final-wrong-state','final-wrong-time','storage-error','storage-throw','storage-lost-response','lookup-error','not-found','already-attached','pending-with-message','claim-before-reserve','claim-during-storage','lease-before-reserve','lease-after-reserve','lease-after-storage','bad-actor','other-manager'];
for(const mode of modes){
 const actor={role:'ops_manager',manager_id:mode==='bad-actor'?'invalid':mode==='other-manager'?id(99):id(2),credential_id:id(3),device_id:'SYNTHETIC_MANAGER',roles:['OPS_MANAGER'],access_level:'full_access',read_only:false};
 const row={attachment_id:id(8),conversation_id:id(7),manager_id:id(2),message_id:mode==='pending-with-message'?id(9):null,status:mode==='already-attached'?'attached':'pending',deleted_at:null,storage_bucket:'synthetic-private',storage_path:'synthetic-only/file.txt',sha256:'a'.repeat(64),metadata_json:{original:'retained'}};
 let blob=true,removes=0,reserves=0,finals=0,leaseChecks=0,claims=0;
 const supabase={from(table){assert.equal(table,'gemini_console_attachments');let values,columns,filters=[];
  return {select(v){columns=v;return this},eq(k,v){filters.push(r=>r[k]===v);return this},is(k,v){filters.push(r=>r[k]===v);return this},update(v){values=v;return this},async maybeSingle(){
   const phase=!values?'read':values.status==='deleted'?'reserve':'final';
   if(phase==='read'&&mode==='lookup-error')return{data:null,error:Error('SYNTHETIC-PRIVATE-DB')};
   if(phase==='read'&&mode==='not-found')return{data:null,error:null};
   if(phase==='reserve'&&mode==='claim-before-reserve'){row.status='attached';row.message_id=id(9);claims++;}
   if(!filters.every(f=>f(row)))return{data:null,error:null};
   if(phase==='read')return{data:{...row},error:null};
   if(phase==='reserve'){reserves++;assert.equal(columns,'*');assert.deepEqual(values,{status:'deleted',deleted_at:null});}
   else {finals++;assert.equal(columns,'attachment_id,status,deleted_at');assert.ok(Number.isFinite(Date.parse(values.deleted_at)));assert.equal(row.status,'deleted');assert.equal(row.message_id,null);}
   const key=phase==='reserve'?'reserve':'final';
   if(mode===key+'-error')return{data:null,error:Error('SYNTHETIC-PRIVATE-DB')};
   if(mode===key+'-throw')throw Error('SYNTHETIC-PRIVATE-DB');
   if(mode===key+'-missing')return{data:null,error:null};
   if(mode===key+'-wrong-row')return{data:{...row,...values,attachment_id:id(99)},error:null};
   if(mode===key+'-wrong-state')return{data:{...row,...values,status:'pending'},error:null};
   if(mode==='reserve-wrong-owner'&&phase==='reserve')return{data:{...row,...values,manager_id:id(99)},error:null};
   if(mode==='reserve-missing-message-pin'&&phase==='reserve'){const result={...row,...values};delete result.message_id;return{data:result,error:null};}
   if(mode==='final-wrong-time'&&phase==='final')return{data:{...row,deleted_at:'2000-01-01T00:00:00Z'},error:null};
   Object.assign(row,values);
   if(mode==='reserve-lost-response'&&phase==='reserve')throw Error('SYNTHETIC-PRIVATE-LOST-REPLY');
   if(mode==='success-normalized-timestamp'&&phase==='final')return{data:{...row,deleted_at:row.deleted_at.replace('Z','+00:00')},error:null};
   return{data:{...row},error:null};
  }};
 },storage:{from(bucket){assert.equal(bucket,row.storage_bucket);return{async remove(paths){
  removes++;assert.deepEqual(paths,[row.storage_path]);assert.equal(row.status,'deleted','retirement precedes physical removal');assert.equal(row.message_id,null);assert.equal(row.deleted_at,null);
  if(mode==='claim-during-storage'&&(row.status==='pending'||row.message_id===id(9))){row.status='attached';row.message_id=id(9);claims++;}
  if(mode==='storage-error')return{error:Error('SYNTHETIC-PRIVATE-STORAGE')};
  if(mode==='storage-throw')throw Error('SYNTHETIC-PRIVATE-STORAGE');
  blob=false;if(mode==='storage-lost-response')throw Error('SYNTHETIC-PRIVATE-LOST-REPLY');return{data:paths,error:null};
 }}}}};
 const app=express();app.use('/gemini-api',createGeminiConsoleRouter({supabase,requireOpsManagerAuth:(req,res,next)=>{req.memphisAuth=actor;req.restoreMutationLease={assertActive(){leaseChecks++;const fail=mode==='lease-before-reserve'?1:mode==='lease-after-reserve'?2:mode==='lease-after-storage'?3:0;if(fail&&leaseChecks===fail)throw Error('SYNTHETIC-LEASE');}};next();}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/gemini-api/attachments/'+row.attachment_id,{method:'DELETE'}),body=await response.json();
  assert.doesNotMatch(JSON.stringify(body),/SYNTHETIC-PRIVATE|SYNTHETIC-LEASE/);assert.deepEqual(row.metadata_json,{original:'retained'});assert.ok(removes<=1&&reserves<=1&&finals<=1,'no automatic split-effect retry');
  if(['success','success-normalized-timestamp','claim-during-storage'].includes(mode)){assert.equal(response.status,200);assert.deepEqual(body.data,{attachment_id:id(8),status:'deleted'});assert.equal(blob,false);assert.equal(row.status,'deleted');assert.ok(row.deleted_at);assert.equal(claims,0);assert.equal(removes,1);assert.equal(reserves,1);assert.equal(finals,1);}
  else if(['lookup-error','not-found','already-attached','bad-actor','other-manager'].includes(mode)){assert.equal(body.ok,false);assert.equal(blob,true);assert.equal(removes,0);assert.equal(reserves,0);assert.equal(finals,0);if(mode!=='lookup-error')assert.equal(response.status,mode==='bad-actor'?403:404);}
  else {
   assert.equal(response.status,503);assert.equal(body.code,'attachment_deletion_unconfirmed');assert.equal(body.data.attachment_id,id(8));assert.equal(body.data.metadata_transition,'unconfirmed');
   if(mode.startsWith('reserve-')||['claim-before-reserve','pending-with-message','lease-before-reserve'].includes(mode)){assert.equal(removes,0);assert.equal(blob,true);assert.equal(body.data.storage_removal,'not_attempted');}
   if(mode==='claim-before-reserve'){assert.equal(row.status,'attached');assert.equal(row.message_id,id(9));assert.equal(claims,1);}
   if(mode==='reserve-lost-response'){assert.equal(row.status,'deleted');assert.equal(row.deleted_at,null);}
   if(mode.startsWith('final-')||mode==='lease-after-storage'){assert.equal(blob,false);assert.equal(row.status,'deleted');assert.equal(row.deleted_at,null);assert.equal(body.data.storage_removal,'confirmed');}
   if(mode.startsWith('storage-')){assert.equal(row.status,'deleted');assert.equal(row.deleted_at,null);assert.equal(body.data.storage_removal,'unconfirmed');assert.equal(finals,0);assert.equal(blob,mode!=='storage-lost-response');}
   if(mode==='lease-after-reserve'){assert.equal(row.status,'deleted');assert.equal(blob,true);assert.equal(removes,0);}
  }
  console.log(JSON.stringify({mode,status:response.status,reservations:reserves,storage_calls:removes,final_updates:finals,blob_present:blob,row_status:row.status,claims,result:'PASS'}));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
console.log(JSON.stringify({suite:'gemini-attachment-retirement',modes:modes.length,status:'PASS',scope:'Actual HTTP router; synthetic DB/Storage/lease only'}));
