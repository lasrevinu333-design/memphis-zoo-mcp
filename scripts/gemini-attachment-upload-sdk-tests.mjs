// Installed PostgREST SDK plus actual upload/GET router, synthetic fetch/Storage.
import assert from 'node:assert/strict';
import express from 'express';
import {createClient} from '@supabase/supabase-js';
import {createGeminiConsoleRouter} from '../src/gemini-console-api.js';
const id=n=>'b6000000-0000-4000-8000-'+String(n).padStart(12,'0'),content=Buffer.from('Synthetic retained original ñ');
const actor={role:'ops_manager',manager_id:id(2),credential_id:id(3),device_id:'SYNTHETIC_MANAGER',roles:['OPS_MANAGER'],access_level:'full_access',read_only:false};
const modes=['stable','committed-lost-reply','committed-error-response','rejected','empty-receipt'];
for(const mode of modes){
 let row=null,blob=null,posts=0,removes=0,patches=0,uploads=0;const calls=[];
 const sdk=createClient('https://synthetic.invalid','SYNTHETIC_NONAUTHORITY_KEY',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,options={})=>{
  const url=new URL(input),method=options.method||'GET';assert.equal(url.origin,'https://synthetic.invalid');assert.equal(url.pathname,'/rest/v1/gemini_console_attachments');calls.push(method);
  if(method==='HEAD')return new Response(null,{status:200,headers:{'content-range':'*/0'}});
  if(method==='POST'){posts++;if(mode==='rejected')return new Response(JSON.stringify({code:'23505',message:'duplicate SYNTHETIC_PRIVATE_DB_REJECTION'}),{status:409,headers:{'content-type':'application/json'}});
   row={...JSON.parse(options.body),status:'pending',message_id:null,deleted_at:null,created_at:'2026-11-14T12:00:00Z'};
   if(mode==='committed-lost-reply')throw TypeError('SYNTHETIC_PRIVATE_REPLY_LOST');
   if(mode==='committed-error-response')return new Response(JSON.stringify({message:'SYNTHETIC_PRIVATE_REPLY_ERROR'}),{status:503,headers:{'content-type':'application/json'}});
   const columns=url.searchParams.get('select');const result=columns&&columns!=='*'?Object.fromEntries(columns.split(',').map(key=>[key,row[key]])):row;
   return new Response(JSON.stringify(mode==='empty-receipt'?null:result),{status:201,headers:{'content-type':'application/json'}});
  }
  if(method==='PATCH'){patches++;throw Error('No upload retirement authorized');}
  return new Response(JSON.stringify(row),{status:200,headers:{'content-type':'application/json'}});
 }}});
 const supabase={from(table){if(table==='gemini_console_attachments')return sdk.from(table);assert.equal(table,'gemini_console_conversations');return{select(){return this},eq(){return this},neq(){return this},async maybeSingle(){return{data:{conversation_id:id(7),owner_manager_id:actor.manager_id,status:'active'},error:null};}};},storage:{from(){return{
  async upload(path,bytes){uploads++;blob={path,bytes:Buffer.from(bytes)};return{data:{path},error:null};},async remove(){removes++;throw Error('No blind compensation');},
  async download(path){return blob&&blob.path===path?{data:{arrayBuffer:async()=>blob.bytes},error:null}:{data:null,error:Error('missing synthetic original')};}
 };}}};
 const app=express();app.use(express.json());app.use('/gemini-api',createGeminiConsoleRouter({supabase,requireOpsManagerAuth(req,res,next){req.memphisAuth=actor;req.restoreMutationLease={assertActive(){}};next();}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port+'/gemini-api',r=await fetch(base+'/conversations/'+id(7)+'/attachments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:'original.txt',mime_type:'text/plain',data_base64:content.toString('base64')})}),body=await r.json();
  assert.equal(posts,1);assert.equal(uploads,1);assert.equal(removes,0);assert.equal(patches,0);assert.deepEqual(blob.bytes,content);assert.doesNotMatch(JSON.stringify(body),/SYNTHETIC_PRIVATE|storage_path/);
  if(mode==='stable'){assert.equal(r.status,201);assert.equal(body.data.attachment_id,row.attachment_id);}else{assert.equal(r.status,mode==='rejected'?409:503);assert.equal(body.code,'attachment_upload_unconfirmed');assert.equal(body.retryable,false);assert.equal(body.data.attachment_id,blob.path.split('/')[2]);assert.equal(body.data.storage_upload,'confirmed');assert.equal(body.data.metadata_insert,'unconfirmed');assert.equal(body.data.storage_removal,'not_attempted');}
  if(row){assert.equal(row.status,'pending');assert.equal(row.deleted_at,null);assert.equal(row.message_id,null);assert.equal(row.attachment_id,blob.path.split('/')[2]);const get=await fetch(base+'/attachments/'+row.attachment_id);assert.equal(get.status,200);assert.deepEqual(Buffer.from(await get.arrayBuffer()),content);}
  console.log(JSON.stringify({mode,status:r.status,provider_methods:calls,metadata_posts:posts,storage_removals:removes,metadata_updates:patches,blob_retained:true,result:'PASS'}));
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
console.log(JSON.stringify({suite:'upload-installed-postgrest-sdk',cases:modes.length,status:'PASS',scope:'Actual installed SDK transport with synthetic fetch, Storage ports and real HTTP upload/GET'}));
