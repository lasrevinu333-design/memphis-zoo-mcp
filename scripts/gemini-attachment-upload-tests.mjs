// Actual upload/GET HTTP routes with synthetic relational, Storage and lease
// faults. No real attachment, provider, SQL, manager session or message is used.
import assert from 'node:assert/strict';
import express from 'express';
import {createHash} from 'node:crypto';
import {createGeminiConsoleRouter} from '../src/gemini-console-api.js';
const id=n=>'b5000000-0000-4000-8000-'+String(n).padStart(12,'0');
const original=Buffer.from('Original synthetic attachment ñ\n');
const modes=['success','upload-error','upload-conflict','upload-throw-before-commit','upload-committed-lost-reply',
 'insert-error','insert-unique-conflict','insert-throw-before-commit','insert-committed-lost-reply','insert-committed-error-reply',
 'claimed-before-lost-reply','insert-empty-receipt','insert-wrong-id','lease-before-upload','lease-after-upload',
 'lease-after-insert','lease-before-ack','replaced-lease-after-upload','replaced-lease-after-insert',
 'read-only','invalid-file','missing-conversation','attachment-limit'];
for(const mode of modes){
 const actor={role:'ops_manager',manager_id:id(2),credential_id:id(3),device_id:'SYNTHETIC_MANAGER',roles:['OPS_MANAGER'],access_level:'full_access',read_only:mode==='read-only'};
 let row=null,blob=null,request,uploads=0,inserts=0,removes=0,updates=0,checks=0,replacementChecks=0,active=true,path='';
 const fault=()=>Error('SYNTHETIC_PRIVATE_PROVIDER_DIAGNOSTIC');
 const retire=()=>{active=false;if(mode.startsWith('replaced-lease'))request.restoreMutationLease={assertActive(){replacementChecks++;}};};
 const supabase={from(table){
  if(table==='gemini_console_conversations')return{select(){return this},eq(){return this},neq(){return this},async maybeSingle(){return{data:mode==='missing-conversation'?null:{conversation_id:id(7),owner_manager_id:actor.manager_id,status:'active'},error:null};}};
  assert.equal(table,'gemini_console_attachments');let values,head=false,columns="*";const filters=[];
  const execute=async()=>{
   if(head)return{count:mode==='attachment-limit'?8:0,error:null};
   if(values){
    inserts++;assert.equal(active,true,'no metadata writer after the original lease retired');
    if(mode==='insert-error')return{data:null,error:fault()};
    if(mode==='insert-unique-conflict')return{data:null,error:Error('duplicate SYNTHETIC_PRIVATE_PROVIDER_DIAGNOSTIC')};
    if(mode==='insert-throw-before-commit')throw fault();
    row={...values,status:'pending',message_id:null,deleted_at:null,created_at:'2026-11-14T12:00:00Z'};
    if(mode==='claimed-before-lost-reply'){row.status='attached';row.message_id=id(9);throw fault();}
    if(mode==='insert-committed-lost-reply')throw fault();
    if(mode==='insert-committed-error-reply')return{data:null,error:fault()};
    if(['lease-after-insert','replaced-lease-after-insert'].includes(mode))retire();
    if(mode==='insert-empty-receipt')return{data:null,error:null};
    const result={...row,attachment_id:mode==='insert-wrong-id'?id(999):row.attachment_id};
    return{data:columns==='*'?result:Object.fromEntries(columns.split(',').map(key=>[key,result[key]])),error:null};
   }
   return{data:row&&filters.every(f=>f(row))?{...row}:null,error:null};
  };
  return{select(selected,opts){columns=selected;head=opts?.head===true;return this;},eq(k,v){filters.push(r=>r[k]===v);return this;},neq(k,v){filters.push(r=>r[k]!==v);return this;},in(){return this;},insert(v){values=v;return this;},update(){updates++;throw Error('upload must not retire metadata');},single:execute,maybeSingle:execute,then(ok,bad){return execute().then(ok,bad);}};
 },storage:{from(bucket){assert.equal(bucket,'gemini-console-private');return{
  async upload(p,bytes,options){uploads++;path=p;assert.equal(active,true);assert.equal(options.upsert,false);assert.deepEqual(bytes,original);
   if(mode==='upload-throw-before-commit')throw fault();
   if(mode==='upload-error')return{data:null,error:fault()};
   if(mode==='upload-conflict')return{data:null,error:Object.assign(fault(),{status:409})};
   blob={path:p,bytes:Buffer.from(bytes)};
   if(mode==='upload-committed-lost-reply')throw fault();
   if(['lease-after-upload','replaced-lease-after-upload'].includes(mode))retire();
   return{data:{path:p},error:null};
  },async remove(){removes++;throw Error('blind upload compensation forbidden');},
  async download(p){return blob&&blob.path===p?{data:{arrayBuffer:async()=>blob.bytes},error:null}:{data:null,error:fault()};}
 };}}};
 const app=express();app.use(express.json());app.use('/gemini-api',createGeminiConsoleRouter({supabase,requireOpsManagerAuth(req,res,next){request=req;req.memphisAuth=actor;req.restoreMutationLease={assertActive(){checks++;if(mode==='lease-before-upload'||(mode==='lease-before-ack'&&checks===3))active=false;if(!active)throw Object.assign(fault(),{status:503});}};next();}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port+'/gemini-api',r=await fetch(base+'/conversations/'+id(7)+'/attachments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:mode==='invalid-file'?'original.exe':'original.txt',mime_type:'text/plain',data_base64:original.toString('base64')})}),body=await r.json();
  assert.equal(removes,0);assert.equal(updates,0);assert.equal(replacementChecks,0,'successor lease cannot replace original authority');assert.ok(uploads<=1&&inserts<=1,'no replay or replacement original');assert.doesNotMatch(JSON.stringify(body),/SYNTHETIC_PRIVATE|storage_path|gemini-console-private/);
  if(mode==='success'){assert.equal(r.status,201);assert.equal(body.data.attachment_id,row.attachment_id);assert.ok(checks>=3);}
  else if(uploads){assert.equal(r.status,['upload-conflict','insert-unique-conflict'].includes(mode)?409:503);assert.equal(body.ok,false);assert.equal(body.code,'attachment_upload_unconfirmed');assert.equal(body.retryable,false);assert.equal(body.data.attachment_id,path.split('/')[2]);assert.equal(body.data.storage_removal,'not_attempted');
   assert.equal(body.data.storage_upload,['upload-error','upload-conflict','upload-throw-before-commit','upload-committed-lost-reply'].includes(mode)?'unconfirmed':'confirmed');
   assert.equal(body.data.metadata_insert,inserts?(['lease-after-insert','replaced-lease-after-insert','lease-before-ack'].includes(mode)?'confirmed':'unconfirmed'):'not_attempted');
  }else{assert.equal(inserts,0);assert.equal(r.status,mode==='read-only'?403:mode==='invalid-file'?415:mode==='missing-conversation'?404:mode==='attachment-limit'?422:503);}
  if(['lease-after-upload','replaced-lease-after-upload','upload-committed-lost-reply'].includes(mode))assert.equal(inserts,0);
  if(blob)assert.deepEqual(blob.bytes,original);
  if(row){assert.equal(row.attachment_id,path.split('/')[2]);assert.equal(row.sha256,createHash('sha256').update(original).digest('hex'));assert.equal(row.storage_path,path);assert.equal(row.status,mode==='claimed-before-lost-reply'?'attached':'pending');assert.equal(row.message_id,mode==='claimed-before-lost-reply'?id(9):null);assert.equal(row.deleted_at,null);
   const get=await fetch(base+'/attachments/'+row.attachment_id);assert.equal(get.status,200);assert.deepEqual(Buffer.from(await get.arrayBuffer()),original);
  }
  console.log(JSON.stringify({mode,status:r.status,uploads,inserts,storage_removals:removes,metadata_updates:updates,lease_checks:checks,original_blob_present:!!blob,metadata_state:row?.status??null,result:'PASS'}));
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
console.log(JSON.stringify({suite:'upload-original-preservation-and-lease',cases:modes.length,status:'PASS',scope:'Actual HTTP routes with synthetic DB/Storage/lease; modeled attached ownership, no actual SQL/message claim'}));
