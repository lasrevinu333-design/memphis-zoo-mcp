// S17 ONLY. Preserve attempt-04 passed S15/S16/S21 without repeating them. Same fixed fixture deadline; no browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:https';
import pg from 'pg';
import {consumeCurrentQualifiedSqlFixture} from './current-qualified-sql-ci-fixture.mjs';
import {setupCurrentOwnedSchedulerBrowser} from './fixtures/scheduling-current310-http-fixture.mjs';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';

const report={schema:'custodial.scheduling-current310-rollback.v2',production:false,release_admission:false,gates:{S17:{status:'NOT_RUN'}},checks:[],priorPassedGatesNotRepeated:['S15','S16','S21'],priorEvidence:'evidence/attempt-04'};
let resource,fixture,pool,reportFile,proxy;
const openClients=new Set();
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const errorRecord=e=>({name:e.name,code:e.code??null,message:e.message,detail:e.detail??null,phase:e.currentOwnedBrowserFixturePhase??null});
function save(){if(reportFile)fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});}
function check(name,actual,expected){assert.deepEqual(actual,expected,name);report.checks.push(name);save();}
const addDays=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
async function gate(name,work){if(name!=='S17')return;report.gates[name]={status:'RUNNING'};save();try{const evidence=await work();report.gates[name]={status:'PASS',...evidence};}
 catch(e){report.gates[name]={status:'FAIL',error:errorRecord(e)};console.log(JSON.stringify({gate:name,error:errorRecord(e)}));}save();}
async function client(role='supabase_admin',session=null){
 const c=await pool.connect();openClients.add(c);
 await c.query('begin');await c.query('set local role '+role);await c.query("set local statement_timeout='30000ms'");
 if(session?.auth_mode==='custodial_leadership_pin')await c.query('select public.static_weekly_leadership_bind_verified_request($1::uuid,$2::uuid,$3::uuid,$4::uuid)',[session.credential_id,session.device_id,session.manager_id,randomUUID()]);
 return c;
}
async function finish(c,commit=false){try{await c.query(commit?'commit':'rollback');}finally{openClients.delete(c);c.release();}}
async function query(sql,args=[]){const c=await client();try{return await c.query(sql,args);}finally{await finish(c);}}
async function tx(role,work,session=null){const c=await client(role,session);try{const r=await work(c);await finish(c,true);return r;}catch(e){if(openClients.has(c))await finish(c);throw e;}}
async function expectDenied(role,sql,args=[],session=null){let err;try{await tx(role,c=>c.query(sql,args),session);}catch(e){err=e;}
 assert.ok(err,'Expected an actual SQL denial as '+role);assert.equal(err.code,'42501');return {role,code:err.code,message:err.message};}
const tables=['static_weekly_schedule_control','weekly_schedule_versions','weekly_schedule_publications','weekly_schedule_compiled_projections',
 'weekly_schedule_projection_assignments','weekly_schedule_lunch_documents','weekly_schedule_exception_commands',
 'weekly_schedule_command_receipts','static_weekly_staffing_commands','static_weekly_staffing_command_receipts',
 'static_weekly_staffing_staged_candidates','static_weekly_staffing_absences','static_weekly_staffing_absence_cancellations',
 'static_weekly_schedule_application_intents','static_weekly_schedule_application_receipts'];
async function fingerprint(){const result={};for(const t of tables)result[t]=(await query("select count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) AS digest from public."+t+' AS t')).rows[0];return result;}
async function revision(){return Number((await query('select current_revision from public.static_weekly_schedule_control where singleton')).rows[0].current_revision);}
async function command(id){return (await query('select state,expected_revision::int,accepted_revision::int,accepted_receipt,preview_digest,confirmation_key from public.static_weekly_staffing_commands where operation_id=$1',[id])).rows[0];}
async function counts(id){return (await query("select (select count(*)::int from public.static_weekly_staffing_absences where accepted_operation_id=$1) AS facts,(select count(*)::int from public.static_weekly_staffing_command_receipts where operation_id=$1 and event_kind='ACCEPTED') AS receipts",[id])).rows[0];}
async function http(session,url,body,{raw=false,endpoint=fixture.origin}={}){
 const response=await fetch(endpoint+url,{method:body===undefined?'GET':'POST',headers:{Origin:'https://127.0.0.1:4173','Content-Type':'application/json',Authorization:'Bearer '+session.token,'X-Device-Id':session.device_id,...(fixture.csrfToken?{'X-CSRF-Token':fixture.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)});
 const value=await response.json();if(raw)return {status:response.status,value};
 assert.equal(response.status,200,'Real HTTPS failure '+url+': '+JSON.stringify(value));assert.equal(value.ok,true);return value.data;
}
async function prepare(session,date,expectedRevision){
 const begun=await http(session,'/static-weekly/staffing-commands',{command_kind:'absence',employee_id:fixture.employeeId,start_date:date,end_date:date,absence_kind:'daily_absence',client_prepare_key:randomUUID(),expected_revision:expectedRevision});
 assert.equal(begun.state,'PREPARING');await http(session,'/static-weekly/staffing-commands/'+begun.operation_id+'/prepare',{});
 const row=await command(begun.operation_id);assert.equal(row.state,'PREPARED');assert.match(row.preview_digest,/^[a-f0-9]{64}$/);
 assert.equal(row.confirmation_key,null);return {id:begun.operation_id,digest:row.preview_digest,key:randomUUID(),session};
}
const accept=(c,op)=>c.query('select public.static_weekly_v11_accept_staffing_command($1::uuid,$2,$3::uuid,$4::uuid) AS value',[op.id,op.digest,op.key,op.session.manager_id]).then(r=>r.rows[0].value);
async function checkRole(c,role){const row=(await c.query('select current_user,rolsuper,rolbypassrls from pg_roles where rolname=current_user')).rows[0];assert.equal(row.current_user,role);assert.equal(row.rolsuper,false);assert.equal(row.rolbypassrls,false);return row;}
async function contention(first,second,date){
 const before=await revision();const a=await prepare(first,date,before),b=await prepare(second,date,before);
 const winner=await client('static_weekly_control_plane',first),loser=await client('static_weekly_control_plane',second);
 let losePromise,loserResult,win;
 try{
  const role=await checkRole(winner,'static_weekly_control_plane');await checkRole(loser,'static_weekly_control_plane');
  const pid=(await loser.query('select pg_backend_pid() AS pid')).rows[0].pid;
  await winner.query("select pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0))");
  losePromise=accept(loser,b).then(value=>({value}),error=>({error:errorRecord(error)}));
  let waiting=false;for(let i=0;i<100;i++){waiting=(await query("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) AS waiting",[pid])).rows[0].waiting;if(waiting)break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(waiting,true,'Second real SQL backend must be observed waiting');
  win=await accept(winner,a);await finish(winner,true);loserResult=await losePromise;await finish(loser);
  check('S15 stale losing transaction '+first.auth_mode,loserResult.error?.code,'40001');
  check('S15 one revision '+first.auth_mode,await revision(),before+1);
  check('S15 winning durable fact/receipt '+first.auth_mode,await counts(a.id),{facts:1,receipts:1});
  check('S15 losing durable fact/receipt '+first.auth_mode,await counts(b.id),{facts:0,receipts:0});
  check('S15 losing prepared state '+first.auth_mode,(await command(b.id)).state,'PREPARED');
  return {date,firstActor:first.auth_mode,secondActor:second.auth_mode,winner:a.id,loser:b.id,beforeRevision:before,afterRevision:before+1,role,observedWaitingLock:true,loserError:loserResult.error,acceptedReceiptDigest:hash(win)};
 }finally{if(openClients.has(winner))await finish(winner);if(losePromise)await losePromise;if(openClients.has(loser))await finish(loser);}
}
try{
 assert.deepEqual(process.argv.slice(2),[]);
 resource=await consumeCurrentQualifiedSqlFixture({name:'mz_schema_rebuild_scheduling_v2_'+process.pid});
 const d=JSON.parse(fs.readFileSync(process.env.CUSTODIAL_CURRENT310_OWNED_CI_DESCRIPTOR));
 reportFile=path.join(d.runtime,'ci-output/scheduling-rollback-s17.json');assert.equal(fs.existsSync(reportFile),false);save();report.borrow=resource.receipt;
 const tls={key:fs.readFileSync(path.join(d.runtime,'localhost-key.pem')),cert:fs.readFileSync(path.join(d.runtime,'localhost-cert.pem'))};
 fixture=await setupCurrentOwnedSchedulerBrowser({fixture:resource,frontendOrigin:'https://127.0.0.1:4173',tls});
 report.runtimeSetup=await fixture.evidence();save();console.log('CURRENT310_REAL_HTTPS_SQL_SETUP_COMPLETE');
 pool=new pg.Pool({...resource.pgClientConfig,database:'postgres',user:'supabase_admin',max:7,connectionTimeoutMillis:5000,statement_timeout:30000});
 pool.on('error',e=>{report.poolError=errorRecord(e);save();});
 const owner=fixture.ownerSession,cohort=fixture.session;assert.notEqual(owner.manager_id,cohort.manager_id);
 await gate('S21',async()=>{
  const allowed=await tx('custodial_application_reader',async c=>{
   const role=await checkRole(c,'custodial_application_reader');
   const policy=(await c.query("select row_security_active('public.employees'::regclass) AS active,(select relforcerowsecurity from pg_class where oid='public.employees'::regclass) AS forced")).rows[0];assert.deepEqual(policy,{active:true,forced:true});
   const ids=readApprovedManualWeek().referenceBindings.people.map(p=>p.employeeId);const rows=(await c.query('select id,display_name from public.employees where id=any($1::uuid[]) order by id',[ids])).rows;assert.deepEqual(rows.map(r=>r.id),ids.slice().sort());const reference=rows.filter(x=>!x.display_name.startsWith('Synthetic schedule custodian '));assert.deepEqual(reference.map(x=>x.display_name).sort(),['Jada Rawlings','Xavier Green']);
   return {role,policy,visibleSyntheticEmployees:6,explicitlyApprovedSourceBoundReferenceLabels:2};
  });
  const denials=[];
  for(const sql of ['select notes from public.employees','update public.employees set active=false','select * from public.static_weekly_staffing_commands','select * from public.device_auth_credentials'])denials.push({...await expectDenied('custodial_application_reader',sql),sql});
  for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_release_operator'])denials.push(await expectDenied(role,'select public.static_weekly_v11_accept_staffing_command($1::uuid,$2,$3::uuid,$4::uuid)',[randomUUID(),'a'.repeat(64),randomUUID(),owner.manager_id]));
  denials.push(await expectDenied('static_weekly_control_plane','select public.custodial_read_approved_schedule_choices_v1($1::uuid,$2::uuid,$3,$4)',[cohort.manager_id,cohort.credential_id,cohort.device_id,cohort.access_level]));
  const positive=await tx('static_weekly_control_plane',async c=>{await checkRole(c,'static_weekly_control_plane');return (await c.query('select public.custodial_read_approved_schedule_choices_v1($1::uuid,$2::uuid,$3,$4) AS value',[cohort.manager_id,cohort.credential_id,cohort.device_id,cohort.access_level])).rows[0].value;},cohort);
  assert.equal(positive.schema,'custodial.approved-schedule-choices.v1');
  const missing=await http({...owner,token:'bad-token'},'/static-weekly/manager-snapshot?week_start='+fixture.week,undefined,{raw:true});assert.ok([401,403].includes(missing.status));
  return {allowed,denials,positiveBoundRpc:true,invalidHttpDenied:missing.status,denialMechanisms:'Existing column/table/function ACL and verified-actor guard; no policy mutation or fabricated row-filter denial',ownerReadsUsedAsProof:false};
 });
 await gate('S15',async()=>({orders:[await contention(owner,cohort,fixture.week),await contention(cohort,owner,addDays(fixture.week,7))]}));
 await gate('S16',async()=>{
  const before=await revision(),op=await prepare(owner,addDays(fixture.week,14),before);let acceptedUpstream=null,requests=0,proxyError=null;
  const route='/static-weekly/staffing-commands/'+op.id+'/confirm';
  proxy=createServer(tls,async(req,res)=>{try{requests++;assert.equal(req.url,route);assert.equal(req.method,'POST');let body='';for await(const part of req)body+=part;
   const headers={...req.headers};delete headers.host;delete headers.connection;
   const upstream=await fetch(fixture.origin+route,{method:'POST',headers,body,signal:AbortSignal.timeout(45000)});const value=await upstream.json();assert.equal(upstream.status,200);assert.equal(value.ok,true);acceptedUpstream=value.data;
   // Upstream HTTP success follows the application's real SQL commit.
   res.destroy();
  }catch(e){proxyError=errorRecord(e);res.destroy();}});
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));let transportFailed=false;
  try{await http(owner,route,{preview_digest:op.digest,confirmation_key:op.key},{endpoint:'https://127.0.0.1:'+proxy.address().port});}catch(e){transportFailed=true;}
  assert.equal(transportFailed,true);assert.equal(proxyError,null);assert.ok(acceptedUpstream);assert.equal(requests,1);
  await new Promise(r=>proxy.close(r));proxy=null;
  const recovered=await http(owner,'/static-weekly/staffing-commands/'+op.id);
  check('S16 exact original operation recovered',recovered.operation_id,op.id);check('S16 durable accepted state',recovered.state,'ACCEPTED');
  const durable=await command(op.id);assert.equal(acceptedUpstream.replayed,false);assert.deepEqual({...durable.accepted_receipt,replayed:false},acceptedUpstream);
  const afterLost=await fingerprint();
  const replay=await http(owner,route,{preview_digest:op.digest,confirmation_key:op.key});assert.equal(replay.replayed,true);
  check('S16 exact replay changes no durable schedule state',await fingerprint(),afterLost);
  check('S16 one revision',await revision(),before+1);check('S16 one fact and accepted receipt',await counts(op.id),{facts:1,receipts:1});
  const wrong=await http(owner,route,{preview_digest:op.digest,confirmation_key:randomUUID()},{raw:true});assert.notEqual(wrong.status,200);
  return {operationId:op.id,lostSuccessfulReply:true,upstreamCommitObserved:true,droppedRequests:requests,recoveredBySameOperationGet:true,exactReplay:true,changedIdentityDenied:wrong.status,beforeRevision:before,afterRevision:before+1,receiptSha256:hash(durable.accepted_receipt)};
 });
 await gate('S17',async()=>{
  const before=await revision(),op=await prepare(owner,addDays(fixture.week,21),before),cases=[];
  for(const kind of ['projection','lunch','commit']){
   const baseline=await fingerprint(),c=await client();let failed,returned=false;
   const table=kind==='projection'?'weekly_schedule_compiled_projections':kind==='lunch'?'weekly_schedule_lunch_documents':'static_weekly_staffing_command_receipts';
   const fname='scheduling_v2_fault_'+kind;
   try{
    await c.query(`create function public.${fname}() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin raise exception using errcode='P0001',message='scheduling_v2_injected_${kind}',detail=jsonb_build_object('revision',(select current_revision from public.static_weekly_schedule_control where singleton),'facts',(select count(*) from public.static_weekly_staffing_absences where accepted_operation_id='${op.id}'::uuid),'projections',(select count(*) from public.weekly_schedule_compiled_projections),'lunches',(select count(*) from public.weekly_schedule_lunch_documents),'acceptedReceipts',(select count(*) from public.static_weekly_staffing_command_receipts where operation_id='${op.id}'::uuid and event_kind='ACCEPTED'))::text;end$$;revoke all on function public.${fname}() from public;`);
    await c.query(kind==='commit'?`create constraint trigger ${fname} after insert on public.${table} deferrable initially deferred for each row when(new.event_kind='ACCEPTED') execute function public.${fname}()`:`create trigger ${fname} before insert on public.${table} for each row execute function public.${fname}()`);
    await c.query('set local role static_weekly_control_plane');await checkRole(c,'static_weekly_control_plane');
    await accept(c,op);returned=true;await c.query('commit');
   }catch(e){failed=e;}finally{if(openClients.has(c))await finish(c);}
   assert.ok(failed,'Injected fault was not encountered');assert.equal(failed.code,'P0001');assert.equal(failed.message,'scheduling_v2_injected_'+kind);
   const inside=JSON.parse(failed.detail);assert.equal(Number(inside.revision),before+1);assert.equal(Number(inside.facts),1);
   if(kind!=='projection')assert.ok(inside.projections>baseline.weekly_schedule_compiled_projections.count,'Fault must follow a real projection write');
   if(kind==='commit'){assert.equal(returned,true);assert.equal(Number(inside.acceptedReceipts),1);}
   check('S17 complete durable rollback '+kind,await fingerprint(),baseline);
   check('S17 fault function rolled back '+kind,(await query('select to_regprocedure($1) IS NULL AS absent',['public.'+fname+'()'])).rows[0].absent,true);
   cases.push({kind,sqlState:failed.code,inside,acceptanceReturnedBeforeCommitFailure:returned,completeFingerprintPreserved:true});
  }
  const accepted=await http(owner,'/static-weekly/staffing-commands/'+op.id+'/confirm',{preview_digest:op.digest,confirmation_key:op.key});
  check('S17 same original accepts after removed injected faults',(await command(op.id)).state,'ACCEPTED');check('S17 exactly one resulting revision',await revision(),before+1);check('S17 exactly one fact and receipt',await counts(op.id),{facts:1,receipts:1});
  return {operationId:op.id,cases,acceptedReceiptDigest:hash(accepted),sameOperationRecovered:true};
 });
 report.runtimeFinal=await fixture.evidence();report.sqlGatesPassed=['S17'].every(k=>report.gates[k].status==='PASS');
}catch(e){report.error=errorRecord(e);console.log(JSON.stringify({fatal:report.error}));}
finally{
 if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}
 for(const c of [...openClients])try{await finish(c);}catch{}
 if(pool)await pool.end();
 if(fixture)try{await fixture.close();report.runtimeClosed=true;}catch(e){report.closeError=errorRecord(e);}
 if(resource)try{await resource.cleanup();report.borrowReleased=true;}catch(e){report.cleanupError=errorRecord(e);}
 report.parentFinalCleanupRequired=true;report.verdict='NOT_READY';save();
 console.log(JSON.stringify({sqlGatesPassed:report.sqlGatesPassed===true,gates:Object.fromEntries(Object.entries(report.gates).map(([k,v])=>[k,v.status])),runtimeClosed:report.runtimeClosed,borrowReleased:report.borrowReleased}));
 if(!report.sqlGatesPassed||!report.runtimeClosed||!report.borrowReleased)process.exitCode=1;
}
