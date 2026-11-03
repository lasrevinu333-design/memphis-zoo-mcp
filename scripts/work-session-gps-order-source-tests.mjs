import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import{pathToFileURL}from'node:url';
export async function runWorkSessionGpsOrderSourceTests(root=process.cwd()){
 let checks=0;const eq=(a,b,n)=>{assert.deepEqual(a,b,n);checks++;},match=(s,re,n)=>{assert.match(s,re,n);checks++;};
 const source=fs.readFileSync(path.join(root,'src/index.js'),'utf8'),start=source.indexOf('app.get("/dashboard-api/work-session-alerts", requireOpsManagerAuth,'),end=source.indexOf('\nfunction offlineAuthorityManagerId',start);
 assert.ok(start>0&&end>start);checks++;
 const block=source.slice(start,end),query=block.match(/runReadOnlySql\(`([\s\S]*?)`\)/)?.[1];assert.ok(query);checks++;
 match(query,/order by \(se\.payload_json->>'observed_at'\)::timestamptz desc nulls last,\s*se\.scanned_at desc, se\.id desc/,'capture order, NULL handling and deterministic receipt tie');
 match(query,/from public\.custodial_open_work\(\) work/,'only the existing open-work projection');
 match(query,/where se\.event_type = 'work_position_check'/,'existing GPS event family only');
 for(const member of ['se.session_id = work.session_id',"se.payload_json->>'session_uuid' = work.session_uuid",'work.client_session_id is not null']){
  eq(query.includes(member),true,'existing exact session relation '+member);}
 eq((query.match(/limit 1/g)||[]).length,1,'existing read cardinality unchanged');
 eq(/\b(?:insert|update|delete|alter|grant|revoke)\s/i.test(query),false,'query stays read-only');
 const gate=()=>{};let registered=null,readQuery=null,rows=[{result:'gps_unverified',payload_json:{}}];
 vm.runInNewContext(block,{app:{get:(route,middleware,handler)=>{registered={route,middleware,handler};}},requireOpsManagerAuth:gate,
  runReadOnlySql:async sql=>{readQuery=sql;return rows;},APP_VERSION:'synthetic-version',RELEASE_ID:'synthetic-release',console:{error(){}}});
 eq(registered.route,'/dashboard-api/work-session-alerts','same existing GET route');eq(registered.middleware,gate,'same owning manager gate');
 const response={status(code){this.code=code;return this;},json(value){this.value=value;return this;}};
 await registered.handler({},response);eq(response.code,200,'actual handler source returns success');eq(readQuery,query,'actual handler executes exact inspected SQL');
 eq(JSON.stringify(response.value.data),JSON.stringify(rows),'no row/status/location data fabricated');
 rows=null;await registered.handler({},response);eq(JSON.stringify(response.value.data),'[]','missing result remains empty, not a location');
 registered=null;vm.runInNewContext(block,{app:{get:(_route,_gate,handler)=>{registered=handler;}},requireOpsManagerAuth:gate,
  runReadOnlySql:async()=>{throw Error('synthetic unavailable reader');},APP_VERSION:'synthetic-version',RELEASE_ID:'synthetic-release',console:{error(){}}});
 await registered({},response);eq(response.code,500,'existing failure behavior remains closed');eq(response.value.ok,false,'reader failure is not current position');
 return{status:'PASS',checks,actual_handler_body:true,synthetic_reader:true,actual_SQL:false,manager_login_proof:false,geographic_alignment:false,production:false,phone:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(await runWorkSessionGpsOrderSourceTests()));
