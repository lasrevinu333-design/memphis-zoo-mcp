import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import {fileURLToPath} from 'node:url';
if(process.argv.includes('--affected-fixed-reader-only')){
  // Existing source-composition member, no dependency install/server/SQL. Load
  // only the actual pure byte-compactor and exchange source; auth/driver imports
  // are not exercised or presented as normal credential/database proof.
  const {privateCustodyRecordSyntaxLimits}=await import('../src/native-private-custody-record.js');
  const crypto=await import('node:crypto'),util=await import('node:util');
  const root=fileURLToPath(new URL('..',import.meta.url));
  const readSource=fs.readFileSync(root+'/src/supabase/read.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
  const normal=new Function('Pool','pgTypes',readSource+'\nreturn {getReadLimits,compactRowsToByteLimit,wrapReadQuery};')(class{},{});
  const source=fs.readFileSync(root+'/src/native-private-custody-exchange.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
  const api=new Function('createHash','createHmac','timingSafeEqual','isDeepStrictEqual','privateCustodyRecordSyntaxLimits',source+
    '\nreturn {factory:typeof createPrivateCustodyFixedReadOnlySql===\'function\'?createPrivateCustodyFixedReadOnlySql:null,limits:typeof privateCustodyFixedSqlReadLimits===\'object\'?privateCustodyFixedSqlReadLimits:null};')(
      crypto.createHash,crypto.createHmac,crypto.timingSafeEqual,util.isDeepStrictEqual,privateCustodyRecordSyntaxLimits);
  const ordinaryCap=normal.getReadLimits({maxResponseBytes:25000000}).max_response_bytes;
  let large=[{complete_private_frame:{frame_base64:'A'.repeat(ordinaryCap)}}];
  const old=normal.compactRowsToByteLimit(large,ordinaryCap);
  console.log(JSON.stringify({case:'legal_frame_reply_exceeds_ordinary_SQL_cap',ordinary_cap:ordinaryCap,synthetic_base64_bytes:ordinaryCap,
    source_compactor_rows:old.rows.length,response_truncated:old.response_truncated,first_oversized_row_bytes:old.first_oversized_row_bytes}));
  assert.equal(old.rows.length,0);assert.equal(old.response_truncated,true);
  assert.equal(typeof api.factory,'function','private fixed source reader is required; current ordinary composition drops the single row');
  const limits=api.limits;assert.ok(Object.isFrozen(limits));assert.equal(limits.maxRows,1);
  assert.ok(limits.maxResponseBytes>4*Math.ceil(limits.maxFrameBytes/3));assert.ok(limits.maxResponseBytes<=100000000);
  assert.equal(limits.maxFrameBytes,privateCustodyRecordSyntaxLimits.record_bytes+8192+4+4+'custodial.native-private-eight-custody-transport-frame.v1'.length*2+4+4+32);
  let cases=1,calls=[],ordinaryCalls=[];
  const envelope=(rows,selected)=>{const compact=normal.compactRowsToByteLimit(rows,selected.maxResponseBytes);
    return{ok:true,rowCount:compact.row_count,originalRowCount:rows.length,row_limit_truncated:false,...compact,
      limits:normal.getReadLimits(selected),wrapped:true};};
  let supplied=null,throwRead=false;
  const capable=async options=>{calls.push(options);assert.ok(Object.isFrozen(options));if(throwRead)throw Error('SYNTHETIC_PRIVATE_ERROR_DO_NOT_EXPOSE');
    return supplied??envelope(large,options);};
  const ordinary=async sql=>{ordinaryCalls.push(sql);return[{ordinary:'unchanged'}];};
  const reader=api.factory({runSupabaseReadOnlySql:capable,runReadOnlySql:ordinary});
  const u='11111111-1111-4111-8111-111111111111',h='a'.repeat(64);
  const sql=`select public.custodial_private_custody_v1_read_complete_frame('${u}'::uuid,'${u}'::uuid,'${u}'::uuid,'${h}'::text,'${h}'::text,'${u}'::uuid,0::integer,'${u}'::uuid,'${h}'::text,'${h}'::text) as complete_private_frame`;
  assert.deepEqual(await reader(sql,{maxRows:999,maxResponseBytes:1000000000}),large);
  assert.deepEqual(calls[0],{sql,maxRows:1,maxResponseBytes:limits.maxResponseBytes});assert.equal(ordinaryCalls.length,0);
  assert.match(normal.wrapReadQuery(sql,normal.getReadLimits(calls[0])),/ limit 2$/);cases++;
  large=null;supplied=envelope([{complete_private_frame:null}],{maxRows:1,maxResponseBytes:limits.maxResponseBytes});
  for(const command of ['select public.custodial_v13_read_separation_context()', 'select public.custodial_v14_read_separation_generation()',
    'select public.custodial_private_custody_v1_read_chunk()', 'with requested as (select 1) select * from requested']){
    const count=calls.length;assert.deepEqual(await reader(command),[{ordinary:'unchanged'}]);assert.equal(calls.length,count);assert.equal(ordinaryCalls.at(-1),command);cases++;
  }
  const pending=error=>error.status===503&&error.code==='native_private_custody_complete_frame_pending'&&!error.message.includes('DO_NOT_EXPOSE');
  for(const command of [sql+'\n',sql+';',sql+' -- alias',sql.replace('0::integer','00::integer'),sql.replace('0::integer','999999::integer'),
    sql.replace(u,'INVALID'),sql.replace(' as complete_private_frame',' as different'),sql.toUpperCase(),{sql,maxResponseBytes:1000000000}]){
    const count=calls.length,oldOrdinary=ordinaryCalls.length;await assert.rejects(reader(command),pending);assert.equal(calls.length,count);assert.equal(ordinaryCalls.length,oldOrdinary);cases++;
  }
  for(const change of [r=>{delete r.response_truncated;},r=>{r.response_truncated=true;},r=>{r.row_limit_truncated=true;},r=>{r.ok=false;},
    r=>{r.rows=[];},r=>{r.rows=[{complete_private_frame:null},{complete_private_frame:null}];},r=>{r.rowCount=0;},r=>{r.originalRowCount=2;},
    r=>{r.error='SYNTHETIC_PRIVATE_ERROR_DO_NOT_EXPOSE';},r=>{r.wrapped=false;},r=>{r.response_bytes=limits.maxResponseBytes+1;},
    r=>{r.response_bytes=0;},r=>{r.response_bytes++;},r=>{r.limits.max_rows=2;},r=>{r.limits.max_response_bytes=25000000;},r=>{r.rows=[{other:null}];}]){
    supplied=envelope([{complete_private_frame:null}],{maxRows:1,maxResponseBytes:limits.maxResponseBytes});change(supplied);
    const count=calls.length,oldOrdinary=ordinaryCalls.length;await assert.rejects(reader(sql),pending);assert.equal(calls.length,count+1);assert.equal(ordinaryCalls.length,oldOrdinary);cases++;
  }
  for(const value of [null,[],{rows:[{complete_private_frame:null}],response_truncated:false}]){
    supplied=value;const narrow=api.factory({runSupabaseReadOnlySql:async()=>value,runReadOnlySql:ordinary});await assert.rejects(narrow(sql),pending);cases++;
  }
  throwRead=true;const count=calls.length;await assert.rejects(reader(sql),pending);assert.equal(calls.length,count+1);cases++;
  for(const capabilities of [{},{runSupabaseReadOnlySql:capable},{runReadOnlySql:ordinary}]){assert.throws(()=>api.factory(capabilities),TypeError);cases++;}
  supplied=null;calls=[];ordinaryCalls=[];
  console.log(JSON.stringify({status:'PRIVATE_CUSTODY_FIXED_READER_SOURCE_PASS',cases,at_utc:new Date().toISOString(),limits,
    actual_source_compactor:true,runner:'synthetic recording normal-envelope callback',SQL:false,HTTP:false,normalAuth:false,network:false,owned_runtime_resources:0}));process.exit(0);
}

const {default:express}=await import('express');
const {createGeneralJsonMiddleware}=await import('../src/request-json-parser.js');
const {makeRestoreMutationGate}=await import('../src/restore-mutation-gate.js');
const {installNativePrivateCustodyExchangeRoute}=await import('../src/native-private-custody-http-route.js');

// NEW owning main composition ONLY. Real loopback parser and existing core are
// used; the restore lease RPC is synthetic. No credential/current generation,
// SQL, server custody, hosted deployment, real manager or phone PASS follows.
const root=fileURLToPath(new URL('..',import.meta.url)),index=fs.readFileSync(root+'/src/index.js','utf8'),checks=[];
const check=async(name,fn)=>{await fn();checks.push({name,status:'PASS'});};
const counts={attempts:0,begin:0,release:0,store:0,sql:0,writer:0};let paused=false;
const leaseClient={async rpc(name){if(name==='custodial_begin_application_mutation_lease'){counts.attempts++;if(paused)throw new Error('mutations are paused');counts.begin++;return {data:{mutations_paused:false,authority_generation:1}};}
  if(name==='custodial_release_application_mutation_lease'){counts.release++;return {data:true};}if(name==='custodial_heartbeat_application_mutation_lease')return {data:true};throw Error('unexpected lease RPC');}};
const app=express();let exactRequest,exactRaw;
app.use((req,res,next)=>{if(req.originalUrl==='/device-auth/private-custody')exactRequest=req;next();});
app.use(createGeneralJsonMiddleware());app.use(makeRestoreMutationGate({supabase:leaseClient,required:true,requestId:()=> '11111111-1111-4111-8111-111111111111',logger:{error(){}}}));
installNativePrivateCustodyExchangeRoute(app,{env:Object.freeze({}),store:{async findCredential(){counts.store++;throw Error('not authorized in parser composition test');}},
  db:{async rpc(){counts.writer++;throw Error('no writer authority in this test');}},runReadOnlySql:async()=>{counts.sql++;throw Error('no SQL in this test');}});
app.post('/ordinary',(req,res)=>res.json({ordinary:req.body}));
const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
const post=(path,body='{}',headers={})=>new Promise((resolve,reject)=>{const request=http.request({host:'127.0.0.1',port,path,method:'POST',agent:false,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),...headers}},response=>{
  const bytes=[];response.on('data',chunk=>bytes.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:JSON.parse(Buffer.concat(bytes).toString('utf8'))}));});
  request.setTimeout(2000,()=>request.destroy(new Error('new owning composition request timed out')));request.on('error',reject);request.end(body);});
const settle=async()=>{for(let i=0;i<50;i++){if(counts.release>=counts.begin||paused)return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('owned synthetic lease settlement missing');};
try {
  await check('main source registers explicit normal capabilities only after existing restore gate',()=>{
    assert.ok(index.includes('import { installNativePrivateCustodyExchangeRoute } from "./native-private-custody-http-route.js"'));
    assert.ok(index.indexOf('app.use(makeRestoreMutationGate(')<index.indexOf('installNativePrivateCustodyExchangeRoute(app,'));
    assert.match(index,/if \(privateCustodyCredentialStore && supabaseAdmin\) \{\s*installNativePrivateCustodyExchangeRoute\(app, \{\s*env: process\.env, store: privateCustodyCredentialStore,\s*db: supabaseAdmin, runReadOnlySql(?:: privateCustodyReadOnlySql)?,/);
    assert.match(index,/else \{\s*app.post\('\/device-auth\/private-custody',[\s\S]*?res.status\(503\)[\s\S]*?native_private_custody_auth_pending/);
  });
  await check('paused existing restore lease prevents private parser/core/writer calls',async()=>{paused=true;const before={...counts},result=await post('/device-auth/private-custody','{"synthetic":"marker"}');
    assert.equal(result.status,503);assert.equal(result.body.code,'disaster_restore_in_progress');assert.equal(counts.attempts,before.attempts+1);assert.equal(counts.begin,before.begin);assert.equal(counts.writer,before.writer);assert.equal(counts.store,before.store);assert.equal(counts.sql,before.sql);assert.equal(exactRequest.body,undefined);paused=false;});
  await check('exact raw parser reaches real frozen core rejection and clears owned request references',async()=>{const result=await post('/device-auth/private-custody','{"schema":"synthetic-invalid-no-authority","private_marker":"test-only"}');
    assert.equal(result.status,403);assert.equal(result.headers['cache-control'],'no-store');assert.equal(exactRequest.body,undefined);assert.equal(exactRequest.scanAuthorityRawBody,undefined);assert.equal(exactRequest.nativePrivateCustodyRequestState,undefined);await settle();});
  await check('case alias after general parser is refused without hanging or credential calls',async()=>{const result=await post('/DEVICE-AUTH/private-custody');assert.equal(result.status,404);assert.equal(result.body.error,'native_private_custody_exact_path_required');await settle();});
  await check('trailing slash alias after general parser is refused without signing-path fallback',async()=>{const result=await post('/device-auth/private-custody/');assert.equal(result.status,404);assert.equal(result.body.error,'native_private_custody_exact_path_required');await settle();});
  await check('query alias remains refused before raw parser or auth capability use',async()=>{const result=await post('/device-auth/private-custody?alias=1');assert.equal(result.status,404);assert.equal(result.body.error,'native_private_custody_exact_path_required');await settle();});
  await check('ordinary general JSON parsing remains connected behind unchanged restore gate',async()=>{const result=await post('/ordinary','{"original":"ordinary-json"}');assert.equal(result.status,200);assert.deepEqual(result.body,{ordinary:{original:'ordinary-json'}});await settle();});
  await check('new exact stream rejects malformed JSON and non-identity encoding with no auth SQL writer effects',async()=>{
    let result=await post('/device-auth/private-custody','{bad');assert.equal(result.status,400);await settle();result=await post('/device-auth/private-custody','{}',{'Content-Encoding':'gzip'});assert.equal(result.status,415);await settle();assert.equal(counts.store,0);assert.equal(counts.sql,0);assert.equal(counts.writer,0);
  });
  console.log(JSON.stringify({status:'NEW8_MAIN_SOURCE_AND_LOOPBACK_PREAUTH_COMPOSITION_PASS',checks,counts,
    actual_SQL_current_credential_generation_native_HTTP_or_hosted_runtime:false,all_ACK_resend_finalizer_key_admission_build_install_or_physical:false}));
}finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
