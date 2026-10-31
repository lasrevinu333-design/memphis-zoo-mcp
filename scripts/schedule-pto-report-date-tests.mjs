import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeSync} from 'node:fs';
import {createScheduleRouter} from '../src/schedule-api.js';

// Actual Express parser handler; synthetic request/response/auth/data ports.
// This makes no socket, database, AI-provider or genuine authentication claim.
if (!process.argv.includes('--timezone-child')) {
  const results=[];
  for (const timezone of ['UTC','America/Chicago','Pacific/Kiritimati']) {
    const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--timezone-child'],{
      env:{PATH:process.env.PATH,TZ:timezone},encoding:'utf8',timeout:15000,
    });
    results.push({timezone,status:child.status,output:child.stdout.trim(),error:child.stderr.trim()});
  }
  writeSync(1,JSON.stringify({scope:'Express parser handler with synthetic ports; no HTTP/database/provider',results})+'\n');
  assert.ok(results.every(r=>r.status===0),'Civil PTO dates must remain exact in every server timezone');
} else {
  const unexpected=async()=>{throw Error('No database or mutation port should be used by report parsing');};
  const router=createScheduleRouter({runReadOnlySql:unexpected,runRpc:unexpected,runCommand:unexpected,
    buildHealthPayload:()=>({ok:true}),requireAdminApiAuth:(_q,_s,next)=>next(),
    requireOpsManagerAuth:(_q,_s,next)=>next(),requireDeviceAccess:(_q,_s,next)=>next(),
    appVersion:'synthetic',releaseId:'synthetic',contractVersion:'synthetic'});
  const route=router.stack.find(layer=>layer.route?.path==='/pto/parse-report').route;
  assert.equal(route.methods.post,true);
  const handler=route.stack.at(-1).handle;
  const failures=[],checks=[];
    const cases=[
      {name:'single civil date',text:'July 30, 2026 Thursday Smith, Amy Approved',dates:[['2026-07-30','2026-07-30']]},
      {name:'consecutive civil dates',text:'July 30, 2026 Thursday Smith, Amy Approved\nJuly 31, 2026 Friday Smith, Amy Approved',dates:[['2026-07-30','2026-07-31']]},
      {name:'valid leap day',text:'February 29, 2028 Tuesday Smith, Amy Approved',dates:[['2028-02-29','2028-02-29']]},
      {name:'invalid February day',text:'February 30, 2026 Monday Smith, Amy Approved',refused:true},
      {name:'invalid April day',text:'April 31, 2026 Friday Smith, Amy Approved',refused:true},
      {name:'unapproved rows',text:'July 30, 2026 Thursday Smith, Amy Submitted',dates:[]},
      {name:'conflicting rows',text:'July 30, 2026 Thursday Smith, Amy Approved\nJuly 30, 2026 Thursday Smith, Amy Cancelled',dates:[]},
    ];
    for(const c of cases) {
      const response={statusCode:null,body:null,status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}};
      await handler({body:{report_text:c.text}},response);
      const body=response.body;
      try {
        assert.equal(response.statusCode,c.refused?400:200);
        if(!c.refused)assert.deepEqual(body.data.rows.map(r=>[r.start_date,r.end_date]),c.dates);
        checks.push(c.name);
      }catch(error){failures.push({name:c.name,status:response.statusCode,body,message:error.message});}
    }
  writeSync(1,JSON.stringify({timezone:process.env.TZ,checks,failures,sqlExecuted:false,providerCalled:false})+'\n');
  assert.equal(failures.length,0);
}
