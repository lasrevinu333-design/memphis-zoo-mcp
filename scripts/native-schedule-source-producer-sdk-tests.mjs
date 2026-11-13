import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {prepareNativeScheduleSourceJobs,NATIVE_SCHEDULE_PREPARATION_BUDGET_MS} from '../src/native-schedule-source-producer.js';
let mode='hang',requests=0,server;const sockets=new Set(),at=new Date().toISOString();
try{
 server=http.createServer((req,res)=>{requests++;assert.equal(req.method,'POST');assert.equal(req.url,'/rest/v1/rpc/custodial_native_schedule_source_requests');
  if(mode==='503'){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'Synthetic source unavailable'}));}
  else req.resume();
 });server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const db=createClient('http://127.0.0.1:'+port,'synthetic-source-producer-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const origin=performance.now(),hung=await prepareNativeScheduleSourceJobs({db}),elapsed=performance.now()-origin;
 assert.equal(hung.status,'SOURCE_READ_PENDING');assert.equal(hung.requested,null);assert.equal(hung.delivery_admitted,false);assert.equal(requests,1);
 assert.ok(elapsed>=NATIVE_SCHEDULE_PREPARATION_BUDGET_MS-100&&elapsed<NATIVE_SCHEDULE_PREPARATION_BUDGET_MS+2500,'actual SDK abort within bound');
 mode='503';const rejected=await prepareNativeScheduleSourceJobs({db});assert.equal(rejected.status,'SOURCE_READ_PENDING');assert.equal(requests,2,'503 must not auto-replay');
 const result={status:'PASS',actual_pinned_SDK:true,actual_localhost_HTTP:true,owned_port:port,started_at_utc:at,hang_elapsed_ms:elapsed,requests,
  source_budget_ms:NATIVE_SCHEDULE_PREPARATION_BUDGET_MS,abort_observed:true,automatic_retries_disabled:true,production:false,provider_dispatch:false,phone:false};
 const evidence=process.argv[2]||process.env.SOURCE_PRODUCER_SDK_EVIDENCE;
 if(evidence)fs.writeFileSync(evidence,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(result));
}finally{
 const stopped=server?.listening?new Promise(resolve=>server.close(resolve)):Promise.resolve();
 const closed=[...sockets].map(s=>s.closed?Promise.resolve():new Promise(resolve=>{s.once('close',resolve);s.destroy();}));
 await Promise.all(closed);await stopped;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(server?.listening,false);assert.equal(sockets.size,0);
 console.log(JSON.stringify({owned_http_server_closed:true,owned_sockets_remaining:sockets.size}));
}
