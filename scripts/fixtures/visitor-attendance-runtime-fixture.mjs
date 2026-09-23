import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as attendance from '../../src/attendance-state.js';
import {makeVisitorAttendanceCollectorHandler} from '../../src/visitor-attendance-collector.js';

// Execute the actual index.js owning functions/routes without booting the server,
// opening production connections, or using the upstream attendance website.
export function visitorRuntimeFixture({nowMs=Date.now(),read,write,html}={}) {
 const source=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8');
 const start=source.indexOf('function parseAttendanceMetric(');
 const end=source.indexOf('\nasync function runReadOnlySql(',start);
 assert.ok(start>0&&end>start,'real attendance owning block located');
 let row=null;
 const writes=[],queries=[],routes={};
 class Clock extends Date {constructor(...args){super(...(args.length?args:[nowMs]));}static now(){return nowMs;}}
 const context={...attendance,Date:Clock,AbortController,setTimeout,clearTimeout,
  ATTENDANCE_STALE_AFTER_MS:3600000,ATTENDANCE_CACHE_MS:30000,ATTENDANCE_TIMEOUT_MS:1000,
  ATTENDANCE_SOURCE_URL:'https://synthetic.invalid/',ATTENDANCE_CF_CLEARANCE:'',
  APP_VERSION:'synthetic',RELEASE_ID:'synthetic',attendanceCache:{data:null,fetched_at_ms:0},
  console:{error(){}},requireOpsManagerWrite(){},
  app:{get(path,...handlers){routes[path]=handlers.at(-1);},post(path,...handlers){routes[path]=handlers.at(-1);}},
  async runReadOnlySql(sql){queries.push(sql);return read?read(sql):row?[row]:[];},
  async runOperationalCommand(command,payload){writes.push(payload);if(write)return write(command,payload);row={...payload,fetched_at:new Date(payload.fetched_at),updated_at:new Date(nowMs)};},
  async fetch(){return {ok:true,headers:{get:()=> 'text/html'},text:async()=> typeof html==='function'?html():html};}
 };
 vm.createContext(context);vm.runInContext(source.slice(start,end),context,{filename:'src/index.js attendance owning block'});
 for(const [marker,next] of [
  ['app.get("/dashboard-api/current-attendance"','app.post("/collector-api/visitor-attendance"'],
  ['app.post("/admin-api/attendance-update"','app.post("/admin-api/bundle"'],
 ]) {const a=source.indexOf(marker),b=source.indexOf(next,a);assert.ok(a>0&&b>a);vm.runInContext(source.slice(a,b),context,{filename:'src/index.js '+marker});}
 const token='synthetic-visitor-boundary-0123456789';
 const collector=makeVisitorAttendanceCollectorHandler({env:{ATTENDANCE_COLLECTOR_TOKEN:token},persist:context.persistAttendanceState,now:()=>nowMs});
 const invoke=async(handler,body)=>{const res={status(code){this.code=code;return this;},json(value){this.body=value;return this;}};await handler({body,get:()=> 'Bearer '+token},res);return res;};
 return {context,writes,queries,collector:body=>invoke(collector,body),manager:body=>invoke(routes['/admin-api/attendance-update'],body),publicRead:()=>invoke(routes['/dashboard-api/current-attendance']),persist:context.persistAttendanceState};
}
