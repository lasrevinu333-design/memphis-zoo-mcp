// S25 ONLY: normal manager UI -> HTTPS runtime -> current310 SQL -> phone DOM.
// Parent must acquire the original host V2 guardian before this consumer starts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'node:https';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import express from 'express';
import pg from 'pg';
import {consumeCurrentQualifiedSqlFixture} from './current-qualified-sql-ci-fixture.mjs';
import {setupCurrentOwnedSchedulerBrowser} from './fixtures/scheduling-current310-http-fixture.mjs';
import {createScheduleRouter} from '../src/schedule-api.js';
import {makeDeviceCredentialMiddleware,createSupabaseDeviceCredentialStore,deviceCredentialSecretMetadata,installDeviceCredentialRoutes} from '../src/auth/device-credential-auth.js';
import {resolveActiveAssignedDevice} from '../src/device-identity.js';

const backend=fileURLToPath(new URL('..',import.meta.url)),front=path.resolve(backend,'../frontend');
const report={schema:'custodial.scheduling-joined-s25.v2',gate:'S25',status:'NOT_RUN',production:false,physicalPhone:false,nativeHardware:'SYNTHETIC_IDENTITY_AND_STORAGE_PORT_ONLY',deployedPostgREST:false,traffic:[],sqlRoles:[],checks:[]};
let resource,fixture,pool,browser,staticServer,phoneServer,reportFile,output,phase='borrow',phoneOffline=false,lostReply=false,opId=null,committed=null,requestCounts={begin:0,prepare:0,confirm:0},phoneReads=[];
const sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const recordError=e=>({name:e.name,code:e.code??null,message:String(e.message).slice(0,4000),phase});
function save(){if(reportFile)fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});}
function check(name,actual,expected){assert.deepEqual(actual,expected,name);report.checks.push(name);save();}
async function transaction(role,sql,args=[],readOnly=false){
 assert.ok(['supabase_admin','service_role','custodial_application_reader'].includes(role));
 const c=await pool.connect();try{await c.query(readOnly?'begin read only':'begin');await c.query('set local role '+role);await c.query("set local statement_timeout='15000ms'");
  if(!report.sqlRoles.includes(role)){report.sqlRoles.push(role);const row=(await c.query('select current_user,rolsuper,rolbypassrls from pg_roles where rolname=current_user')).rows[0];(report.roleProperties??=[]).push(row);}
  const r=await c.query(sql,args);await c.query('commit');return r;
 }catch(e){await c.query('rollback');throw e;}finally{c.release();}
}
const ownerQuery=(sql,args=[])=>transaction('supabase_admin',sql,args);
const readonly=async sql=>(await transaction('custodial_application_reader',sql,[],true)).rows;
const start=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve('https://127.0.0.1:'+server.address().port));});
const close=async s=>{if(s){s.closeAllConnections();await new Promise(r=>s.close(r));}};
try{
 assert.deepEqual(process.argv.slice(2),[]);resource=await consumeCurrentQualifiedSqlFixture({name:'mz_schema_rebuild_scheduling_joined_'+process.pid});
 const d=JSON.parse(fs.readFileSync(process.env.CUSTODIAL_CURRENT310_OWNED_CI_DESCRIPTOR));output=path.join(d.runtime,'ci-output');reportFile=path.join(output,'scheduling-joined-s25.json');assert.equal(fs.existsSync(reportFile),false);save();
 const tls={key:fs.readFileSync(path.join(d.runtime,'localhost-key.pem')),cert:fs.readFileSync(path.join(d.runtime,'localhost-cert.pem'))};
 phase='actual_https_sql_setup';fixture=await setupCurrentOwnedSchedulerBrowser({fixture:resource,frontendOrigin:'https://127.0.0.1:4173',tls});report.setup=await fixture.evidence();save();
 const deniedSnapshot=await fetch(fixture.origin+'/static-weekly/manager-snapshot?week_start='+fixture.week,{headers:{Origin:'https://127.0.0.1:4173'},signal:AbortSignal.timeout(5000)});await deniedSnapshot.arrayBuffer();assert.ok([401,403].includes(deniedSnapshot.status));report.unauthenticatedSnapshotDenied=deniedSnapshot.status;save();
 pool=new pg.Pool({...resource.pgClientConfig,database:'postgres',user:'supabase_admin',max:5,connectionTimeoutMillis:5000});pool.on('error',e=>{report.poolError=recordError(e);save();});
 phase='synthetic_phone_enrollment';
 const devicePk=randomUUID(),credentialId=randomUUID(),deviceId='KIOSK_09',secret=randomBytes(32).toString('base64url'),env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:randomBytes(48).toString('hex')};
 const tokenHash=createHmac('sha256',env.DEVICE_CREDENTIAL_SECRET).update('device-token:'+secret).digest('hex'),phoneToken=credentialId+'.'+secret;
 const employee=(await ownerQuery('select employee_code,active from public.employees where id=$1',[fixture.employeeId])).rows[0];assert.equal(employee.employee_code,null);assert.equal(employee.active,true);
 const employeeCode='EMP990009';assert.equal((await ownerQuery('select count(*)::int AS n from public.employees where employee_code=$1',[employeeCode])).rows[0].n,0);
 assert.equal((await ownerQuery('update public.employees set employee_code=$2 where id=$1 and employee_code is null',[fixture.employeeId,employeeCode])).rowCount,1);
 assert.equal((await ownerQuery("select count(*)::int AS n from public.devices where device_id=$1",[deviceId])).rows[0].n,0);
 await ownerQuery("insert into public.devices(id,device_id,device_name,assigned_employee_id,active,assignment_epoch) values($1,$2,'Synthetic scheduling phone',$3,true,1)",[devicePk,deviceId,fixture.employeeId]);
 const epoch=Number((await ownerQuery('select assignment_epoch from public.devices where id=$1',[devicePk])).rows[0].assignment_epoch);
 const resolved=await resolveActiveAssignedDevice({runReadOnlySql:readonly,deviceIdentifier:deviceId});assert.equal(resolved.canonical_device_pk,devicePk);assert.equal(resolved.assigned_employee_id,fixture.employeeId);assert.equal(resolved.employee_code,employeeCode);assert.equal(resolved.assignment_valid,true);assert.equal(resolved.device_active,true);assert.equal(resolved.employee_active,true);report.syntheticEnrollment={canonicalDevice:deviceId,employeeCode,assignmentValid:true,employeeActive:true};save();
 await ownerQuery("insert into public.device_auth_credentials(credential_id,device_id,token_hash,device_label,confirmed_at,last_used_at,expires_at,metadata_json) values($1,$2,$3,'Synthetic scheduling phone',clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '10 minutes',$4::jsonb)",[credentialId,devicePk,tokenHash,JSON.stringify(deviceCredentialSecretMetadata(env))]);
 const tableColumns={device_auth_policy:'mode,updated_by,updated_at',device_auth_credentials:'credential_id,device_id,token_hash,device_label,created_at,confirmed_at,last_used_at,expires_at,revoked_at,revoked_reason,metadata_json'};
 const transport={from(table){assert.ok(Object.hasOwn(tableColumns,table),'No additional credential tables allowed');let columns,key,value;
  const b={select(s){assert.equal(s,tableColumns[table]);columns=s;return b;},eq(k,v){assert.equal(k,table==='device_auth_policy'?'singleton':'credential_id');key=k;value=v;return b;},
   async maybeSingle(){try{assert.ok(columns&&key);const r=await transaction('service_role','select '+columns+' from public.'+table+' where '+key+'=$1',[value],true);assert.ok(r.rows.length<=1);return {data:r.rows[0]?JSON.parse(JSON.stringify(r.rows[0])):null,error:null};}catch(error){return {data:null,error};}}};return b;}};
 const store=createSupabaseDeviceCredentialStore(transport);
 const requireDevice=makeDeviceCredentialMiddleware({env,store,runReadOnlySql:readonly,requireEnrolledCredential:true});
 const rpcNames=new Set(['static_weekly_v24_read_device_schedule_delivery','static_weekly_v27_issue_recurring_notification_plan','static_weekly_v10_ack_device_schedule_application','static_weekly_v26_read_original_delivery_outcome','static_weekly_v27_ack_device_schedule_delivery']);
 const runRpc=async(name,args)=>{assert.ok(rpcNames.has(name),'No notification delivery or unrelated RPC permitted');const keys=Object.keys(args);assert.ok(keys.every(k=>/^p_[a-z0-9_]+$/.test(k)));return (await transaction('service_role','select public.'+name+'('+keys.map((k,i)=>k+'=> $'+(i+1)).join(',')+') AS value',keys.map(k=>args[k]))).rows[0].value;};
 const phoneApp=express();phoneApp.use(express.json({limit:'1mb'}));phoneApp.use((req,res,next)=>{res.set('Access-Control-Allow-Origin','https://127.0.0.1:4173');res.set('Access-Control-Allow-Headers','content-type,x-device-id,x-device-credential,authorization');res.set('Access-Control-Allow-Methods','GET,POST,OPTIONS');if(req.method==='OPTIONS')return res.sendStatus(204);if(!(req.method==='GET'&&req.path==='/device-auth/status')&&!/^\/schedule-api\/my-day-summary(?:\/(?:application-receipt|delivery-receipt))?$/.test(req.path))return res.sendStatus(403);next();});
 installDeviceCredentialRoutes(phoneApp,{env,store,runReadOnlySql:readonly,requireOpsAuth:(_q,r)=>r.sendStatus(403),requireOpsWrite:(_q,r)=>r.sendStatus(403)});
 phoneApp.use('/schedule-api',createScheduleRouter({runReadOnlySql:readonly,runRpc,runCommand:()=>{throw Error('No generic schedule mutation permitted');},buildHealthPayload:()=>({}),requireAdminApiAuth:(_q,r)=>r.sendStatus(403),requireOpsManagerAuth:(_q,r)=>r.sendStatus(403),requireDeviceAccess:requireDevice,appVersion:'owned-current310',releaseId:'LOCAL_TEST_ONLY',contractVersion:'LOCAL_TEST_ONLY'}));
 phoneServer=createServer(tls,phoneApp);const phoneOrigin=await start(phoneServer);
 const phoneUrl=phoneOrigin+'/schedule-api/my-day-summary?device_id='+deviceId+'&service_date='+fixture.week;
 const phoneHeader={'X-Device-Id':deviceId,'X-Device-Credential':phoneToken,Origin:'https://127.0.0.1:4173'};
 const first=await fetch(phoneUrl,{headers:phoneHeader});const before=(await first.json());assert.equal(first.status,200,JSON.stringify(before));assert.equal(before.ok,true);assert.equal(before.data.projection_status,'current');assert.ok(before.data.raw_items.length>0);report.initialPhone={projectionId:before.data.projection_id,rows:before.data.raw_items.length,dataSha256:sha(before.data),mode:before.data.schedule_delivery_mode};save();
 phase='static_frontend';
 staticServer=createServer(tls,(req,res)=>{try{const url=new URL(req.url,'https://127.0.0.1:4173'),f=path.resolve(front,'.'+decodeURIComponent(url.pathname));if(!f.startsWith(front+path.sep)||!fs.statSync(f).isFile())return res.writeHead(404).end();const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png'}[path.extname(f)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});res.end(fs.readFileSync(f));}catch{res.writeHead(404).end();}});
 await new Promise((resolve,reject)=>{staticServer.once('error',reject);staticServer.listen(4173,'127.0.0.1',resolve);});
 const {chromium}=await import(pathToFileURL(path.join(front,'node_modules/playwright/index.mjs')).href);
 phase='owned_browser';browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
 const managerContext=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',ignoreHTTPSErrors:true});
 await managerContext.addCookies(fixture.bootstrapCookies().map(c=>({...c,url:'https://memphis-zoo-mcp.onrender.com/'})));
 await managerContext.route('**/*',async route=>{try{const req=route.request(),u=new URL(req.url());
  if(u.origin==='https://memphis-zoo-mcp.onrender.com'&&req.method()==='GET'&&['/custodial-leadership-api/session','/scheduler-runtime-config'].includes(u.pathname)){const response=await route.fetch({url:fixture.origin+u.pathname,headers:await req.allHeaders(),maxRedirects:0,maxRetries:0});return route.fulfill({response});}
  if(u.origin===fixture.origin&&u.pathname.startsWith('/static-weekly/')){
   if(req.method()==='POST'){
    if(u.pathname==='/static-weekly/staffing-commands')requestCounts.begin++;
    else if(u.pathname.endsWith('/prepare'))requestCounts.prepare++;
    else if(u.pathname.endsWith('/confirm')){requestCounts.confirm++;assert.equal(requestCounts.confirm,1);opId=u.pathname.split('/')[3];const response=await route.fetch({maxRedirects:0,maxRetries:0});const body=await response.json();assert.equal(response.status(),200,JSON.stringify(body));assert.equal(body.ok,true);committed=body.data;lostReply=true;return route.abort('failed');}
    else return route.abort('blockedbyclient');
   }return route.continue();
  }
  if(u.origin==='https://127.0.0.1:4173'&&['GET','HEAD'].includes(req.method()))return route.continue();return route.abort('blockedbyclient');
 }catch(e){report.managerRouteError=recordError(e);save();await route.abort('failed').catch(()=>{});}
 });
 const phoneContext=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Tokyo',serviceWorkers:'block',ignoreHTTPSErrors:true});
 await phoneContext.addInitScript(({date,device,employee,credential,epoch})=>{
  const RealDate=Date,instant=date+'T16:00:00Z';window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[instant]));}static now(){return RealDate.parse(instant);}};
  const principal={employee_id:employee,credential_id:credential,assignment_epoch:epoch};
  window.MemphisMobile={ready:Promise.resolve(),deviceId:()=>device,principalIdentity:()=>JSON.stringify(principal),profileMatchesPrincipal:d=>d.employee_id===employee&&d.credential_id===credential&&d.assignment_epoch===epoch,requestJson:async(p,o)=>{const r=await fetch('https://memphis-zoo-mcp.onrender.com'+p,o);if(!r.ok)throw Error('Receipt refused');return r.json();}};
  window.MemphisCustodialSecurity={native:true,getStatus:()=>({ready:true,available:true,quarantined:false,generation:1,deviceId:device,principal}),mutateProtectedWork:async f=>f({generation:1,deviceId:device,assertCurrent(){}})};
 },{date:fixture.week,device:deviceId,employee:fixture.employeeId,credential:credentialId,epoch});
 const html=fs.readFileSync(path.join(front,'employee-schedule.html'),'utf8');
 await phoneContext.route('**/*',async route=>{try{const req=route.request(),u=new URL(req.url());
  if(u.origin==='https://memphis-zoo-mcp.onrender.com'&&(u.pathname.startsWith('/schedule-api/my-day-summary')||(req.method()==='GET'&&u.pathname==='/device-auth/status'))){
   if(phoneOffline)return route.abort('internetdisconnected');const target=new URL(phoneOrigin+u.pathname+u.search);if(req.method()==='GET'&&u.pathname==='/schedule-api/my-day-summary')target.searchParams.set('service_date',fixture.week);
   const response=await route.fetch({url:target.href,headers:{...await req.allHeaders(),...phoneHeader},maxRedirects:0,maxRetries:0});const body=await response.json();report.traffic.push({surface:'phone',method:req.method(),path:u.pathname,status:response.status()});if(req.method()==='GET'&&u.pathname==='/schedule-api/my-day-summary'&&body.ok){phoneReads.push(body.data);report.lastPhone={projectionId:body.data.projection_id,rawRows:body.data.raw_items?.length,mode:body.data.schedule_delivery_mode};}save();return route.fulfill({response});
  }
  if(u.origin==='https://127.0.0.1:4173'&&u.pathname==='/employee-schedule.html')return route.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'')});
  if(u.origin==='https://127.0.0.1:4173')return route.continue();return route.abort('blockedbyclient');
 }catch(e){report.phoneRouteError=recordError(e);save();await route.abort('failed').catch(()=>{});}
 });
 const phone=await phoneContext.newPage();await phone.goto('https://127.0.0.1:4173/employee-schedule.html');
 await phone.addScriptTag({content:fs.readFileSync(path.join(front,'memphis-recurring-schedule-target.js'),'utf8')});
 await phone.addScriptTag({content:[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1]});
 await phone.waitForFunction(()=>document.querySelectorAll('#areas .area').length>0,undefined,{timeout:15000});
 check('Phone initial actual SQL read',phoneReads.length>0,true);const initialDom=await phone.locator('#content').innerText();assert.ok(initialDom.length>5);await phone.screenshot({path:path.join(output,'s25-phone-before.png'),fullPage:true});
 phase='manager_real_ui_prepare';const page=await managerContext.newPage();await page.goto('https://127.0.0.1:4173/schedule-weekly.html?date='+fixture.week+'&week_start='+fixture.week,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#status')?.textContent.startsWith('Loaded '),undefined,{timeout:20000});
 await page.locator('#absence-type').selectOption('daily_absence');await page.locator('#absence-end-date').fill(fixture.week);await page.locator('[data-callout-slot="'+fixture.slotId+'"]').check();await page.locator('#apply-day-btn').click();
 await page.waitForFunction(()=>document.querySelector('#staffing-confirm-btn')&&!document.querySelector('#staffing-confirm-btn').disabled,undefined,{timeout:60000});
 await page.screenshot({path:path.join(output,'s25-manager-prepared.png'),fullPage:true});
 phoneOffline=true;await phone.evaluate(()=>window.dispatchEvent(new Event('memphis:schedule-refresh')));await phone.waitForFunction(()=>!document.querySelector('#state').hidden&&/saved|offline|update/i.test(document.querySelector('#state-text').textContent));
 phase='real_commit_drop_reply';await page.locator('#staffing-confirm-btn').click();await page.locator('#action-confirm-dialog').getByRole('button',{name:'Publish Reviewed Staffing',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#scheduler-retry')&&!document.querySelector('#scheduler-retry').disabled,undefined,{timeout:45000});assert.equal(lostReply,true);assert.ok(committed&&opId);
 const row=(await ownerQuery('select state,accepted_revision::int,accepted_receipt from public.static_weekly_staffing_commands where operation_id=$1',[opId])).rows[0];check('Manager real commit before dropped reply',row.state,'ACCEPTED');
 const offlineDom=await phone.locator('#content').innerText();check('Offline phone retained previous display',offlineDom,initialDom);await phone.screenshot({path:path.join(output,'s25-phone-offline.png'),fullPage:true});
 phase='original_manager_recovery';await page.locator('#scheduler-retry').click();
 const key='mz_scheduler_dated_operation_v1:'+encodeURIComponent(fixture.origin)+':'+fixture.session.manager_id;
 await page.waitForFunction(k=>localStorage.getItem(k)===null,key,{timeout:30000});check('One begin prepare confirm across recovery',requestCounts,{begin:1,prepare:1,confirm:1});
 await page.screenshot({path:path.join(output,'s25-manager-recovered.png'),fullPage:true});
 phase='phone_reconnect';phoneOffline=false;const oldReads=phoneReads.length;await phone.locator('#retry').click();
 for(let i=0;i<150&&phoneReads.length===oldReads;i++)await new Promise(r=>setTimeout(r,50));assert.ok(phoneReads.length>oldReads);
 const after=phoneReads.at(-1);check('Phone read exact accepted projection',after.projection_id,committed.projections[fixture.week].projection_id);check('Absent employee has no cleaning rows',after.raw_items.length,0);
 await phone.waitForFunction(()=>/not scheduled|No regular areas are active/i.test(document.querySelector('#areas').textContent),undefined,{timeout:10000});await phone.screenshot({path:path.join(output,'s25-phone-recovered.png'),fullPage:true});
 const finalDom=await phone.locator('main').innerText();assert.notEqual(finalDom,initialDom);const facts=(await ownerQuery("select (select count(*)::int from public.static_weekly_staffing_absences where accepted_operation_id=$1) AS facts,(select count(*)::int from public.static_weekly_staffing_command_receipts where operation_id=$1 and event_kind='ACCEPTED') AS receipts",[opId])).rows[0];check('One persisted operation after combined faults',facts,{facts:1,receipts:1});
 report.operationId=opId;report.acceptedRevision=row.accepted_revision;report.receiptSha256=sha(row.accepted_receipt);report.requestCounts=requestCounts;report.managerRecoveredWithoutResubmit=true;report.offlineOldDisplay=true;report.reconnectedExactProjection=true;report.finalPhone={projectionId:after.projection_id,rawRows:after.raw_items.length,displayText:finalDom};report.runtime=await fixture.evidence();report.status='PASS';
}catch(e){report.status='FAIL';report.error=recordError(e);report.requestCounts=requestCounts;report.lostReply=lostReply;report.operationId=opId;console.log(JSON.stringify({error:report.error}));if(fixture)try{report.runtimeAtFailure=await fixture.evidence();}catch(e){report.runtimeEvidenceError=recordError(e);}if(browser&&output){report.failedScreens=[];let i=0;for(const context of browser.contexts())for(const page of context.pages()){try{const name='s25-failed-surface-'+(++i)+'.png';await page.screenshot({path:path.join(output,name),fullPage:true,timeout:5000});report.failedScreens.push({file:name,text:(await page.locator('body').innerText({timeout:3000})).slice(0,6000)});}catch{}}}}
finally{
 if(browser)try{await browser.close();report.browserClosed=true;}catch(e){report.browserCloseError=recordError(e);}
 await close(staticServer);await close(phoneServer);if(pool)await pool.end();if(fixture)try{await fixture.close();report.runtimeClosed=true;}catch(e){report.closeError=recordError(e);}
 if(resource)try{await resource.cleanup();report.borrowReleased=true;}catch(e){report.cleanupError=recordError(e);}
 report.parentOwnsFinalDatabaseAndLeaseCleanup=true;save();console.log(JSON.stringify({status:report.status,error:report.error,closed:report.browserClosed}));if(report.status!=='PASS'||!report.browserClosed||!report.borrowReleased)process.exitCode=1;
}
