import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeVisitorAttendanceCollectorHandler } from "../src/visitor-attendance-collector.js";
import { normalizeAttendanceRecord } from "../src/attendance-state.js";
import { makeOpsAccessMiddleware } from "../src/auth/shared-access-auth.js";
import { makeRestoreMutationGate } from "../src/restore-mutation-gate.js";
const now=Date.parse("2026-09-23T12:00:00Z"), token="synthetic-collector-token-0123456789";
const original={attendance:0,last_year:100,planned:200,yesterday:150,yesterday_plan:175,fetched_at:new Date(now).toISOString()};
let writes=[], accepted=0, storedOverride, fail=false, passed=0;
const handler=makeVisitorAttendanceCollectorHandler({
 env:{ATTENDANCE_COLLECTOR_TOKEN:token},now:()=>now,accepted:()=>accepted++,
 persist:async payload=>{if(fail)throw Error("private provider error");writes.push(payload);return storedOverride===undefined?payload:storedOverride;}
});
const run=async(body=original,auth="Bearer "+token,h=handler)=>{
 const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await h({body,get:()=>auth},res);return res;
};
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);passed++;};
check((await run()).code,200,"actual zero accepted");
check(writes[0].attendance,0,"zero is not missing");
check(writes[0].source,"home-browser-auto-push","source is server assigned");
check(accepted,1,"cache cleared only after verified persistence");
for(const value of [null,undefined,"",true,false,[],{},-1,1.5,NaN,Infinity,2147483648]){
 check((await run({...original,attendance:value})).code,422,"reject invalid attendance");
}
for(const auth of ["","Bearer wrong","Basic "+token]){
 check((await run(original,auth)).code,401,"reject wrong authentication");
}
for(const value of ["not-a-date",null,new Date(now+120000).toISOString(),new Date(now-3600001).toISOString()]){
 check((await run({...original,fetched_at:value})).code,422,"reject untrustworthy source timestamp");
}
check((await run({...original,planned:false})).code,422,"reject false optional metric");
check(writes.length,1,"invalid requests never reach persistence");
storedOverride=null;check((await run()).code,503,"hidden RLS row is not success");
storedOverride={...original,attendance:55};check((await run()).code,503,"wrong saved row is not success");
for (const field of ["last_year","planned","yesterday","yesterday_plan","source"]) {
 storedOverride={...original,source:"home-browser-auto-push",[field]:field==="source"?"another-writer":999};
 check((await run()).code,503,"conflicting saved "+field+" is not this observation");
}
storedOverride=undefined;fail=true;const rejected=await run();
check(rejected.code,503,"failed persistence is not accepted");
check(JSON.stringify(rejected.body).includes("private provider"),false,"no provider error disclosure");
check(accepted,1,"unverified saves do not clear cache");
const disabled=makeVisitorAttendanceCollectorHandler({env:{},persist:()=>assert.fail("disabled collector wrote")});
check((await run(original,"Bearer "+token,disabled)).code,503,"disabled unless separately configured");
check(normalizeAttendanceRecord({attendance:false,fetched_at:original.fetched_at}),null,"boolean is not visitor zero");
check(normalizeAttendanceRecord({attendance:0,fetched_at:original.fetched_at},{nowMs:now}).stale,false,"real zero remains current");
const index=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
assert.match(index,/app\.post\("\/admin-api\/attendance-update", requireOpsManagerWrite/);passed++;
assert.match(index,/app\.post\("\/collector-api\/visitor-attendance", makeVisitorAttendanceCollectorHandler/);passed++;
const managerResponse={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
await makeOpsAccessMiddleware({env:{NODE_ENV:'production',OPS_MANAGER_SESSION_SECRET:'synthetic-manager-secret-0123456789'},requireWrite:true})(
 {headers:{authorization:'Bearer '+token},header(name){return this.headers[name.toLowerCase()]||'';}},managerResponse,
 ()=>assert.fail('collector token became manager write authority'));
check(managerResponse.code,401,'real manager boundary rejects collector-only token');
const restoreResponse={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
await makeRestoreMutationGate({required:true,supabase:{async rpc(){return {data:null,error:new Error('disaster recovery is in progress; application mutations are paused')};}}})(
 {method:'POST',path:'/collector-api/visitor-attendance'},restoreResponse,()=>assert.fail('collector bypassed paused restore'));
check(restoreResponse.code,503,'collector POST observes restore pause');
check(restoreResponse.body.code,'disaster_restore_in_progress','restore pause is explicit');
assert.ok(index.indexOf('app.use(makeRestoreMutationGate(')<index.indexOf('app.post("/collector-api/visitor-attendance"'),'production middleware ordering covers collector');passed++;
console.log(JSON.stringify({passed,failed:0,productionWritten:false,scope:"visitor-count collector only"},null,2));
