// Owned fresh303 canonical ticket component qualification only; no production URLs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes,createHash,createHmac} from 'node:crypto';
import pg from '../node_modules/pg/lib/index.js';
import {createCiFreshOnlyFixture} from './ci-fresh-only-replay.mjs';
import {createCustodialLeadershipControlPlane,createCustodialLeadershipTicketBridge} from '../src/auth/custodial-leadership-runtime.js';
import {createCustodialLeadershipOpsSession,configureCustodialLeadershipVerifier} from '../src/auth/shared-access-auth.js';
import {installOwnerAccessRoutes} from '../src/owner-access-api.js';
const B=resolve(dirname(fileURLToPath(import.meta.url)),'..'),A=resolve(B,'../..'),F=resolve(A,'findings/ticket-cohort-proposal');
const sha=x=>createHash('sha256').update(x).digest('hex'),ram=()=>randomBytes(32).toString('hex');
const files=[resolve(B,'proposals/custodial-leadership-ticket-operation.sql'),resolve(B,'scripts/fixtures/ticket-cohort/regression.sql'),resolve(B,'scripts/fixtures/ticket-cohort/signed-setup.sql'),
 fileURLToPath(import.meta.url),resolve(B,'scripts/ci-fresh-only-replay.mjs'),resolve(B,'src/auth/custodial-leadership-ticket-operation.mjs'),resolve(B,'src/auth/custodial-leadership-runtime.js'),resolve(B,'src/owner-access-api.js'),resolve(B,'src/auth/shared-access-auth.js'),resolve(B,'src/custodial-leadership-pin.js')];
const snapshot=(selected=files)=>selected.map(path=>({path,sha256:sha(fs.readFileSync(path)),bytes:fs.statSync(path).size}));
const cleanSql=path=>fs.readFileSync(path,'utf8').replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
const prefix='c7200000-0000-4000-8000-',manager=prefix+'000000000001',credential=prefix+'000000000002',browser=prefix+'000000000003',ticket=prefix+'000000000101',workOrder=prefix+'000000000102',nonscan=prefix+'000000000103';
export async function runTicketDatabaseTests({out,extraSql=null,constructFixture=createCiFreshOnlyFixture}){
 assert.ok(isAbsolute(out));assert.ok(resolve(out).startsWith(F+'/'));assert.equal(fs.existsSync(out),false,'Fresh evidence path required');
 for(const key of ['DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','PGHOST','PGPASSWORD','SCHEMA_REBUILD_ADMIN_URL','SCHEMA_REBUILD_DOCKER_CONTAINER'])assert.ok(!process.env[key],'Ambient target credential refused: '+key);
 fs.mkdirSync(out,{mode:0o700});const save=(name,value)=>fs.writeFileSync(resolve(out,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
 let extraBytes=null;const selectedFiles=[...files];
 if(extraSql!==null){assert.ok(isAbsolute(extraSql));extraSql=resolve(extraSql);assert.ok(extraSql.endsWith('.sql'));
  assert.ok(extraSql.startsWith(resolve(A,'findings')+'/')||extraSql.startsWith(resolve(B,'scripts/fixtures')+'/'));
  assert.equal(fs.realpathSync(extraSql),extraSql);const stat=fs.lstatSync(extraSql);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=262144);
  extraBytes=cleanSql(extraSql);assert.match(extraBytes,/\bBEGIN\s*;/i);assert.match(extraBytes,/\bROLLBACK\s*;/i);selectedFiles.push(extraSql);}
 const sourceBefore=snapshot(selectedFiles);save('SOURCE_BEFORE.json',sourceBefore);for(let i=0;i<3;i++)save('INPUT_'+i+'.sql',cleanSql(files[i]));
 if(extraBytes!==null)save('INPUT_EXTRA.sql',extraBytes);
 const result={status:'RUNNING',scope:'OWNED_FRESH303_CANONICAL_COHORT_TICKET_COMPONENT',productionWritten:false,canonicalReleaseAccepted:false,physicalBrowser:false,httpTransport:'in-memory exported handlers; no socket',checks:[],notices:[]};
 let fixture,pool,unknown=false,success=false,sequence=0;
 const lost=e=>{unknown=true;result.connectionErrors??=[];result.connectionErrors.push({code:e?.code,message:e?.message});};
 const check=(label,ok=true)=>{assert.equal(ok,true,label);result.checks.push(label);console.log('PASS '+label);};
 try{
  fixture=await constructFixture({name:'mz_schema_rebuild_ticket_'+randomUUID().replaceAll('-',''),hostSocket:true});
  await fixture.assertOwned();assert.equal(fixture.receipt.selected_replay.migrations,303);save('OWNED_SOURCE303_RECEIPT.json',fixture.receipt);
  pool=new pg.Pool({host:fixture.socketDirectory,database:'postgres',user:'supabase_admin',password:'postgres',max:3,connectionTimeoutMillis:5000});
  pool.on('connect',c=>{c.on('error',lost);c.on('notice',n=>result.notices.push(n.message));});pool.on('error',lost);
  const query=async(sql,args=[])=>{assert.equal(unknown,false,'Unknown connection forbids new SQL');await fixture.assertOwned();const n=String(++sequence).padStart(3,'0');save('QUERY_'+n+'_BEFORE.json',{sql,args});try{const r=await pool.query(sql,args);save('QUERY_'+n+'_RETURNED.json',Array.isArray(r)?r.map(x=>({command:x.command,rowCount:x.rowCount,rows:x.rows})):{command:r.command,rowCount:r.rowCount,rows:r.rows});return r;}catch(e){save('QUERY_'+n+'_ERROR.json',{code:e.code,message:e.message,where:e.where});if(/^(08|ECONN|57P)/.test(e.code||''))unknown=true;throw e;}};
  const legacyDefs=async()=>{const r=await query("select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1::text[]) order by p.proname",[['custodial_action_actor_v1','custodial_ticket_capabilities_v1','custodial_close_scan_ticket_outcome_v1','custodial_set_maintenance_ticket_outcome','static_weekly_leadership_bind_verified_request']]);return r.rows;};
  const before=await legacyDefs();save('LEGACY_BEFORE.json',before);
  await query(cleanSql(files[2]));check('synthetic committed scan/cohort fixture created in owned disposable source303 only');
  async function expectSql(label,code,sql,args=[]){const c=await pool.connect();try{await c.query('begin');let e;try{await c.query(sql,args);}catch(x){e=x;}assert.ok(e,label);assert.equal(e.code,code,label);await c.query('rollback');check(label);save('EXPECTED_FAILURE_'+label.replaceAll(/[^a-z0-9]+/gi,'_')+'.json',{code:e.code,message:e.message});}finally{c.release();}}
  await expectSql('baseline service-role capability lacks leadership transaction context','42501',`set local role service_role;select public.custodial_ticket_capabilities_v1('${manager}','${credential}','${browser}','full_access',ARRAY['${ticket}']::uuid[])`);
  await expectSql('baseline bound wrapper still rejects system cohort at named writer','42501',`set local role static_weekly_control_plane;select public.static_weekly_leadership_bind_verified_request('${credential}','${browser}','${manager}','${randomUUID()}');set local role service_role;select public.custodial_close_scan_ticket_outcome_v1('${manager}','${credential}','${browser}','full_access','${ticket}','mark_fixed',NULL,NULL,'synthetic-ticket-test-secret-not-production')`);
  await expectSql('baseline legacy audit FK rejects private registration identity','23503',`insert into public.ops_manager_auth_events(credential_id,device_id,event_type,success,detail_json) values('${credential}','${browser}','synthetic_probe',true,'{}')`);
  await query(cleanSql(files[0]));check('single staged SQL successor applied after exact predecessor hash guards');
  const sqlResults=await query(cleanSql(files[1]));const sqlSummary=(Array.isArray(sqlResults)?sqlResults:[sqlResults]).flatMap(r=>r.rows||[]).map(r=>r.jsonb_build_object).find(r=>r?.suite==='ticket-cohort-final302-plus-successor');assert.ok(sqlSummary?.passed>=35);save('SQL_REGRESSION_RESULT.json',sqlSummary);check('real SQL regression '+sqlSummary.passed+' checks passed with original fixture rollback');
  if(extraBytes!==null){assert.deepEqual(snapshot(selectedFiles),sourceBefore);const extraResult=await query(extraBytes);
   save('EXTRA_SQL_RECEIPT.json',{path:extraSql,sha256:sha(fs.readFileSync(extraSql)),bytes:fs.statSync(extraSql).size,returned:true,
    rowSets:(Array.isArray(extraResult)?extraResult:[extraResult]).map(r=>({command:r.command,rowCount:r.rowCount,rows:r.rows})),scope:'explicit bounded local SQL fixture, same owned database, single query call'});
   check('optional explicitly frozen rollback SQL fixture returned successfully');}
  const after=await legacyDefs();assert.deepEqual(after,before);save('LEGACY_AFTER.json',after);check('named legacy function definitions and grants remain byte-identical');
  const raw=(await query('select custodial_leadership_private.session_view($1::uuid) as session',[credential])).rows[0].session;assert.ok(raw);assert.equal(raw.cohort.principalId,manager);
  const origin='https://ticket-fixture.example.invalid',env={NODE_ENV:'test',OPS_MANAGER_SESSION_SECRET:ram(),CUSTODIAL_LEADERSHIP_PIN_PEPPER:ram(),CUSTODIAL_LEADERSHIP_PIN_ENABLED:'true',CUSTODIAL_LEADERSHIP_ALLOWED_ORIGINS:origin,STATIC_WEEKLY_CONTROL_PLANE_PUBLIC_URL:'https://companion.example.invalid'};
  const expected={role:'ops_manager',access_level:'full_access',roles:['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN'],claimed_manager_id:raw.claimedAccount.accountId,claimed_manager_display_name:raw.claimedAccount.displayName,identity_assurance:'SELF_ASSERTED_NAME',individual_identity_verified:false,manager_id:manager,credential_id:credential,device_id:browser,manager_display_name:'Custodial leadership cohort',permissions:{schema:'custodial.manager-permissions.v1',read:true,owner:false,custodialManagementAdmin:true,policyVersion:raw.cohort.policyVersion},auth_mode:'custodial_leadership_pin',actor_kind:'CUSTODIAL_LEADERSHIP_COHORT',read_only:false,owner:false,custodial_management_admin:true};
  const signed=createCustodialLeadershipOpsSession({expectedClaims:expected,credentialExpiresAt:raw.credentialExpiresAt,registrationLifetime:raw.registrationLifetime,env});
  const csrf=createHmac('sha256',env.CUSTODIAL_LEADERSHIP_PIN_PEPPER).update('leadership-csrf-v1\0'+raw.csrfBinding).digest('hex');
  const cp=createCustodialLeadershipControlPlane({env,database:pool}),handler=cp.router.stack.find(x=>x.route?.path==='/custodial-leadership-internal/tickets').route.stack.at(-1).handle;
  const response=()=>({statusCode:200,status(n){this.statusCode=n;return this;},set(){return this;},setHeader(){},json(body){this.body=body;return this;}});
  const req=({method='POST',path='/dashboard-api/close-ticket',body,query,token=signed.token,csrfValue=csrf,originValue=origin}={})=>{const h={authorization:'Bearer '+token,'x-csrf-token':csrfValue,origin:originValue};return {method,path,url:path,originalUrl:path,secure:true,body,query,headers:h,get:k=>h[k.toLowerCase()]||'',header:k=>h[k.toLowerCase()]||''};};
  let fallback=0,bridgeCalls=0;const bridge=createCustodialLeadershipTicketBridge({env,fetchImpl:async(url,init)=>{bridgeCalls++;assert.equal(url,env.STATIC_WEEKLY_CONTROL_PLANE_PUBLIC_URL+'/custodial-leadership-internal/tickets');const r=response();await handler(req({body:JSON.parse(init.body),token:init.headers.Authorization.slice(7)}),r);return new Response(JSON.stringify(r.body),{status:r.statusCode});}});
  const routes=[],app={get:(path,...stack)=>routes.push({method:'GET',path,stack}),post:(path,...stack)=>routes.push({method:'POST',path,stack})};
  installOwnerAccessRoutes(app,{env,store:{find(){throw Error('no named credential lookup for cohort');}},runRpc(){fallback++;throw Error('cohort must not use legacy service-role RPC');},backendSecret(){throw Error('cohort must not acquire legacy secret');},leadershipTicketBridge:bridge});configureCustodialLeadershipVerifier(cp.verify);
  async function route(request,label){assert.equal(unknown,false);await fixture.assertOwned();const item=routes.find(x=>x.method===request.method&&(Array.isArray(x.path)?x.path.includes(request.path):x.path===request.path));assert.ok(item);const r=response();for(const fn of item.stack){let next=false;await fn(request,r,()=>{next=true;});if(!next)break;}save('ROUTE_'+label+'.json',{status:r.statusCode,body:r.body});return r;}
  const fixed={ticket_id:ticket,outcome:'mark_fixed',external_work_order_reference:null,close_notes:'Synthetic signed route observation'};
  let r=await route(req({method:'GET',path:'/dashboard-api/ticket-capabilities',query:{ids:[ticket,nonscan].join(',')},csrfValue:''}),'capabilities_before');assert.equal(r.statusCode,200);assert.equal(r.body.data.tickets.find(x=>x.ticket_id===ticket).can_close,true);assert.equal(r.body.data.tickets.find(x=>x.ticket_id===nonscan).can_close,false);check('real signed capability route uses canonical scan eligibility through same-client SQL context');
  r=await route(req({body:fixed}),'fixed');assert.equal(r.statusCode,200);assert.equal(r.body.data.replayed,false);assert.equal(r.body.data.actor_manager_id,manager);check('actual signed Main handler to companion to bound SQL commits fixed outcome');
  const row=(await query("select t.status,t.resolution_actor_manager_id,t.closed_by,t.resolution_outcome,h.actor_manager_id,h.actor_name_snapshot,e.credential_id,e.device_id,e.detail_json from public.maintenance_tickets t join public.maintenance_ticket_outcome_history h on h.ticket_id=t.id join public.ops_manager_auth_events e on e.detail_json->>'ticket_id'=t.id::text where t.id=$1",[ticket])).rows;assert.equal(row.length,1);assert.equal(row[0].credential_id,null);assert.equal(row[0].resolution_actor_manager_id,manager);assert.equal(row[0].actor_manager_id,manager);assert.equal(row[0].closed_by,'Custodial leadership cohort');assert.equal(row[0].device_id,browser);assert.equal(row[0].detail_json.actor.claimed_account_id,raw.claimedAccount.accountId);assert.equal(row[0].detail_json.actor.credential_id,credential);assert.equal(row[0].detail_json.actor.identity_assurance,'SELF_ASSERTED_NAME');assert.equal(row[0].detail_json.actor.individual_identity_verified,false);assert.equal(row[0].detail_json.actor.owner,false);save('PERSISTED_CALLER_ATTRIBUTION.json',row);check('readback retains original cohort authority and self-asserted claim without legacy FK impersonation');
  r=await route(req({body:fixed}),'exact_replay');assert.equal(r.statusCode,200);assert.equal(r.body.data.replayed,true);assert.equal(r.body.data.actor_manager_id,manager);check('signed exact replay reads original outcome without rewriting actor');
  r=await route(req({body:{...fixed,close_notes:'Different'}}),'changed_replay');assert.equal(r.statusCode,409);check('changed signed replay conflicts rather than replacing recorded history');
  r=await route(req({path:'/admin-api/close-ticket',body:{ticket_id:workOrder,outcome:'work_order_sent',external_work_order_reference:'SYNTHETIC-WO-001',close_notes:null}}),'work_order');assert.equal(r.statusCode,200);assert.equal(r.body.data.outcome,'work_order_sent');check('admin alias records actual supplied work-order reference using same cohort path');
  r=await route(req({body:{...fixed,ticket_id:nonscan}}),'nonscan_denied');assert.equal(r.statusCode,403);check('cohort cannot inherit owner non-scan closure exception');
  for(const csrfValue of ['',ram()]){r=await route(req({body:{...fixed,ticket_id:nonscan},csrfValue}),'csrf_'+(csrfValue?'wrong':'missing'));assert.notEqual(r.statusCode,200);}check('actual signed current middleware rejects missing and wrong browser-bound CSRF');
  r=await route(req({body:fixed,originValue:'https://evil.example.invalid'}),'origin_denied');assert.equal(r.statusCode,403);check('actual signed current middleware rejects unapproved origin');
  const wrong=createCustodialLeadershipOpsSession({expectedClaims:{...expected,claimed_manager_id:randomUUID()},credentialExpiresAt:raw.credentialExpiresAt,registrationLifetime:raw.registrationLifetime,env});r=await route(req({body:fixed,token:wrong.token}),'claimed_identity_denied');assert.notEqual(r.statusCode,200);check('signed but stale claimed identity is denied by actual private registration readback');
  await query('update custodial_leadership_private.registrations set revoked_at=clock_timestamp() where registration_id=$1',[credential]);r=await route(req({body:fixed}),'revoked_registration_denied');assert.notEqual(r.statusCode,200);check('actual private registration revocation immediately denies existing signed cohort token');
  const counts=(await query("select (select count(*) from public.maintenance_ticket_outcome_history where ticket_id=any($1::uuid[])) history,(select count(*) from public.ops_manager_auth_events where detail_json->>'ticket_id'=any($2::text[])) events,(select status from public.maintenance_tickets where id=$3) nonscan_status",[[ticket,workOrder],[ticket,workOrder],nonscan])).rows[0];assert.equal(Number(counts.history),2);assert.equal(Number(counts.events),2);assert.equal(counts.nonscan_status,'open');assert.equal(fallback,0);save('FINAL_READBACK.json',{...counts,fallback,bridgeCalls});check('two genuine outcomes have exactly two history and audit rows; denials and replays add none');
  assert.deepEqual(snapshot(selectedFiles),sourceBefore);save('SOURCE_AFTER.json',snapshot(selectedFiles));check('all staged implementation and fixture source bytes stayed unchanged during qualification');
  success=true;result.status='PASS_SCOPED_NOT_RELEASE_ACCEPTANCE';
 }catch(e){if(/^(08|ECONN|57P)/.test(e.code||'')||/unknown/i.test(e.code||''))unknown=true;result.status=unknown?'UNKNOWN':'FAIL';result.error={code:e.code,message:e.message,stack:e.stack};process.exitCode=1;
 }finally{
  configureCustodialLeadershipVerifier(null);
  if(pool)try{await pool.end();}catch(e){unknown=true;success=false;result.status='UNKNOWN';result.poolEndError=e.message;process.exitCode=1;}
  if(fixture&&success&&!unknown)try{await fixture.assertOwned();await fixture.cleanup();result.cleanup='OWNED_FIXTURE_CLEANUP_RETURNED';}catch(e){result.status='UNKNOWN';result.cleanupError=e.message;process.exitCode=1;}
  else if(fixture)result.cleanup='PRESERVED_ORIGINAL_OWNED_FIXTURE_FOR_FAILURE_OR_UNKNOWN_RECONCILIATION';
  else result.cleanup='NO_RETURNED_FIXTURE_CONSTRUCTOR_OWNS_PARTIAL_CLEANUP';
  save('RESULT.json',result);console.log(JSON.stringify({status:result.status,checks:result.checks.length,cleanup:result.cleanup,out}));
 }
 return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 assert.deepEqual(process.argv.slice(2,3),['--out']);assert.ok([4,6].includes(process.argv.length));
 if(process.argv.length===6)assert.equal(process.argv[4],'--extra-sql');
 await runTicketDatabaseTests({out:resolve(process.argv[3]),extraSql:process.argv.length===6?process.argv[5]:null});
}
