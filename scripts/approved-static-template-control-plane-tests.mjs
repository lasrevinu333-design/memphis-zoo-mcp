import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {runInNewContext} from 'node:vm';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {contentDigest,installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';
import {loadSixPersonAbsenceSource} from './fixtures/six-person-absence-source.mjs';

// Changed pending-command PREPARED readback only. Actor/SQL DATA are inert;
// no preparation, worker, publication or genuine manager authority is claimed.
if(process.argv.includes('--approved-pending-prepared-currentness-only')){
 const id='81000000-0000-4000-8000-000000000001',credential='85000000-0000-4000-8000-000000000001',
  operation='85000000-0000-4000-8000-000000000002',observed=[];
 for(const mode of ['stable','credential','auth-mode']){
  const manager={manager_id:id,manager_display_name:'UNIT original preparer',credential_id:credential,
   device_id:'UNIT-currentness-device',access_level:'full_access',read_only:false,auth_mode:'trusted_device'},
   command={operation_id:operation,state:'PREPARED',prepared_by_manager_id:id,semantic_body:{commandKind:'absence'}},calls=[];
  let released=0,ended=0,compilerCalls=0,outcome;
  class Client extends EventEmitter{
   async query(sql){calls.push(sql);let result;
    if(['begin','rollback','commit','select 1','set local role static_weekly_control_plane',
     'select public.custodial_begin_application_mutation()'].includes(sql)
     ||/^set local statement_timeout = '\d+ms'$/.test(sql)||sql.includes('pg_advisory_xact_lock'))return{rows:[]};
    if(sql.includes('custodial_action_actor_v1'))result={manager_id:id,credential_id:credential,device_id:'UNIT-currentness-device',owner:true};
    else if(sql.includes('static_weekly_v10_read_staffing_command')){
     if(mode==='credential')manager.credential_id='85000000-0000-4000-8000-000000000003';
     if(mode==='auth-mode')manager.auth_mode='changed_during_original_read';
     result=structuredClone(command);
    }else assert.fail('Unexpected original PREPARED query '+sql);
    return{rows:[{result}]};
   }
   release(){released++;}
  }
  const cp=createStaticWeeklyControlPlane({database:{async connect(){return new Client();},async end(){ended++;}},
   compilerPreparer:()=>{compilerCalls++;throw Error('NO_PREPARATION');},shutdownCompiler:async()=>{}});
  try{
   const value=await cp.runManagerOperation({manager,signal:new AbortController().signal,
    deadlineAt:performance.now()+10000,permission:'write'},()=>cp.prepareStaffingCommand({manager,operationId:operation}));
   assert.deepEqual(value,command);outcome='PREPARED_RETURNED';
  }catch(error){outcome=error.code||error.message;}
  finally{await cp.close();}
  assert.equal(compilerCalls,0);assert.equal(released,1);assert.equal(ended,1);
  assert.ok(!calls.some(q=>q.includes('stage_staffing_command')||q.includes('materialize_projection')));
  observed.push({mode,outcome,terminal:calls.at(-1)});
 }
 console.log(JSON.stringify({scope:'NEW original PREPARED caller identity across awaited read',observed,
  SQL:'NOT_RUN',actualWorker:false,oldGroups:0,resources0:true}));
 assert.deepEqual(observed,[{mode:'stable',outcome:'PREPARED_RETURNED',terminal:'commit'},
  {mode:'credential',outcome:'staffing_original_principal_changed',terminal:'rollback'},
  {mode:'auth-mode',outcome:'staffing_original_principal_changed',terminal:'rollback'}]);
 process.exit(0);
}

// NEW dispatcher/receipt composition Source only. No SQL port, manager,
// publication, approval or successful ledger insertion is simulated here.
if(process.argv.includes('--approved-dated-dispatch-source-only')||process.argv.includes('--approved-dated-publication-binding-source-only')||process.argv.includes('--approved-dated-ledger-profile-source-only')){
 const {splitSchemaStatements}=await import('./isolated-event-owner-schema.mjs'),
  sql=readFileSync(new URL('../supabase/migrations/20261017200958_approved_static_original_confirmation_receipts.sql',import.meta.url),'utf8'),
  start=sql.indexOf('CREATE FUNCTION public.static_weekly_materialize_approved_template('),
  end=sql.indexOf('END $fn$;',start)+9,dispatcher=sql.slice(start,end),
  first=dispatcher.indexOf(' -- BEGIN DATED_ORIGINAL_CONFIRMATION_DISPATCH'),
  last=dispatcher.indexOf(' -- END DATED_ORIGINAL_CONFIRMATION_DISPATCH'),
  sha=s=>createHash('sha256').update(s).digest('hex');
 let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS NEW dated dispatcher Source',name);};
 if(process.argv.includes('--approved-dated-ledger-profile-source-only')){
  const guard=sql.slice(sql.indexOf('CREATE FUNCTION public.static_weekly_guard_approved_template_confirmation()'),sql.indexOf('CREATE TRIGGER approved_confirmation_binding')),
   table=sql.slice(sql.indexOf('CREATE TABLE public.static_weekly_approved_template_confirmations'),sql.indexOf('-- The original manager/key lookup')),
   dated=guard.slice(guard.indexOf('\n ELSE\n')),proofStart=guard.indexOf(' IF NOT EXISTS(SELECT 1 FROM public.weekly_schedule_publications p');
  check('closed recurring/dated CHECK never accepts SQL UNKNOWN',()=>{
   assert.match(table,/CONSTRAINT approved_confirmation_publication_profile CHECK\(\(/);
   assert.match(table,/jsonb_typeof\(request_json->'kind'\)='string'/);
   assert.match(table,/\)\) IS TRUE\)/);
   assert.match(table,/request_json->>'kind'='RECURRING_STAFFING' AND request_json->'publicationId'='null'::jsonb\s+AND publication_id<>source_publication_id/);
   assert.match(table,/request_json->>'kind'='DATED_ABSENCE' AND request_json->'publicationId'=to_jsonb\(source_publication_id::text\)\s+AND publication_id=source_publication_id/);
   assert.match(guard,/jsonb_typeof\(NEW.request_json->'kind'\) IS DISTINCT FROM 'string'/);
   assert.match(guard,/NEW.request_json->>'kind' NOT IN\('RECURRING_STAFFING','DATED_ABSENCE'\)/);
   assert.match(guard,/NEW.request_json \?& ARRAY\['publicationId','serviceDate','kind','templateId','expectedRevision','previewDigest','idempotencyKey'\]/);
  });
  check('original PK/projection once remain; publication uniqueness is recurring-only',()=>{
   assert.match(table,/PRIMARY KEY\(manager_id,idempotency_key\)/);
   assert.match(table,/CONSTRAINT approved_confirmation_projection_once UNIQUE\(projection_id\)/);
   assert.doesNotMatch(table,/CONSTRAINT approved_confirmation_publication_once UNIQUE/);
   assert.match(table,/CREATE UNIQUE INDEX approved_confirmation_publication_once\s+ON public.static_weekly_approved_template_confirmations\(publication_id\)\s+WHERE request_json->>'kind'='RECURRING_STAFFING';/);
  });
  check('recurring relational proof is exactly the original proof',()=>{
   assert.equal(sha(guard.slice(proofStart,guard.indexOf(' ELSE\n',proofStart))),'9c9b88dab316b4ed4aadec8ab443cf935eedcca0c3a56415673f861c0596842d');
   assert.match(guard,/v_kind='RECURRING_STAFFING' AND extract\(isodow FROM v_service_date\)<>1/);
   assert.match(guard,/NEW.request_json->'publicationId' IS DISTINCT FROM 'null'::jsonb/);
  });
  check('DATED actual Source/version/operation/week/projection/lunch all bind',()=>{
   for(const text of ["NEW.request_json->'publicationId' IS DISTINCT FROM to_jsonb(NEW.source_publication_id::text)",
    'NEW.publication_id IS DISTINCT FROM NEW.source_publication_id',"v_week:=v_service_date-(extract(isodow FROM v_service_date)::integer-1)",
    'v_projection.version_id IS DISTINCT FROM v_publication.version_id','v_projection.week_end IS DISTINCT FROM v_week+6',
    'v_projection.compiled_by_manager_id IS DISTINCT FROM NEW.manager_id','v_lunch.accepted_by_manager_id IS DISTINCT FROM NEW.manager_id',
    "v_projection.receipt_json->'feasibilityDigest' IS DISTINCT FROM NEW.receipt_json->'feasibility_digest'",
    "'{authority,scopeDates}' IS DISTINCT FROM jsonb_build_array(v_service_date::text)",
    's.source_digest=public.static_weekly_digest_jsonb(s.canonical_source)'])assert.ok(guard.includes(text),text);
   assert.doesNotMatch(dated,/v_publication\.(actor_manager_id|authority_revision|effective_start)/);
   assert.ok(dated.includes('static_weekly_assert_approved_dated_projection(v_projection.projection_envelope'));
   assert.ok(dated.includes('static_weekly_assert_approved_dated_lunch(NEW.projection_id,v_lunch.document_json)'));
  });
  check('stale/foreign/pretend receipt cannot replace actual original command and advanced epoch',()=>{
   for(const text of ['v_accepted_revision IS DISTINCT FROM v_expected_revision+1',
    "c.idempotency_key=(NEW.request_json->>'previewDigest')||':dated-projection'",
    'c.actor_manager_id=NEW.manager_id AND a.actor_manager_id=NEW.manager_id',
    'c.expected_revision=v_expected_revision AND a.authority_revision=v_accepted_revision',
    'c.request_digest=public.static_weekly_digest_jsonb(c.request_canonical_json)',
    "c.request_canonical_json->'projection_envelope'=v_projection.projection_envelope",
    "c.response_json#>'{data,projection_id}'=to_jsonb(NEW.projection_id::text)",
    'public.static_weekly_v15_read_recurring_generation() IS DISTINCT FROM v_generation',
    'public.static_weekly_v3_manager_actor(NEW.manager_id) IS DISTINCT FROM v_actor'])assert.ok(dated.includes(text),text);
  });
  check('immutable triggers and private RLS/ACL policy stay unchanged',()=>{
   const a=sql.indexOf('CREATE TRIGGER approved_confirmation_binding'),b=sql.indexOf('-- Narrow definer lookup',a);
   assert.equal(sha(sql.slice(a,b)),'6441e123a2a2facacc9d71d30aa5ec905dbc5b6b03f8cd70d334e079f60906d3');
   assert.match(sql,/ALTER TABLE public.static_weekly_approved_template_confirmations ENABLE ROW LEVEL SECURITY/);
   assert.match(sql,/ALTER TABLE public.static_weekly_approved_template_confirmations FORCE ROW LEVEL SECURITY/);
   assert.doesNotMatch(guard,/INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|GRANT|SET ROLE|DISABLE TRIGGER|session_replication_role|EXCEPTION WHEN/i);
   const parsed=splitSchemaStatements(sql);assert.equal(parsed.statements.filter(s=>s.text?.includes('CREATE FUNCTION public.static_weekly_guard_approved_template_confirmation()')).length,1);
  });
  console.log(JSON.stringify({checks,scope:'NEW kind-specific immutable original ledger SQL Source/refusal profiles only',SQL:'NOT_RUN',
   previous8OrPublicationChecksReplayed:0,Task7StatusChecksReplayed:0,resources0:true}));process.exit(0);
 }
 if(process.argv.includes('--approved-dated-publication-binding-source-only')){
  assert.ok(first>=0&&last>first);
  const dated=dispatcher.slice(first,last),beforeLookup=dated.slice(0,dated.indexOf('SELECT * INTO prior'));
  check('DATED requires the exact named original publication without filling a missing request',()=>{
   assert.match(beforeLookup,/OR p_envelope#>'\{request,publicationId\}' IS DISTINCT FROM to_jsonb\(p_source_publication_id::text\)/);
   assert.doesNotMatch(beforeLookup,/p_envelope#>'\{request,publicationId\}' IS DISTINCT FROM 'null'::jsonb/);
   assert.match(beforeLookup,/'publicationId',p_source_publication_id,'serviceDate',p_date,'kind',p_kind/);
   assert.doesNotMatch(dated,/p_envelope\s*:=|jsonb_set\(p_envelope|coalesce\(p_envelope#>>?'\{request,publicationId\}'/i);
   assert.match(dated,/prior.request_json IS DISTINCT FROM p_envelope->'request'/);
   assert.match(dated,/receipt->'publication_id' IS DISTINCT FROM to_jsonb\(p_source_publication_id::text\)/);
   assert.match(dated,/VALUES\(p_manager_id,p_key,p_envelope->'request',receipt,p_source_publication_id,p_source_publication_id,v_projection_id\)/);
  });
  console.log(JSON.stringify({checks,scope:'NEW named-publication DATED original-request SQL Source correction only',SQL:'NOT_RUN',
   previous8SourceChecksReplayed:0,oldGroups:0,resources0:true}));process.exit(0);
 }
 check('actual dispatcher has a distinct DATED branch',()=>{
  assert.ok(start>=0&&end>start);assert.ok(first>=0&&last>first);
  assert.match(dispatcher,/IF p_kind='DATED_ABSENCE' THEN/);
 });
 const branch=dispatcher.slice(first,last),unchanged=dispatcher.slice(0,first)+dispatcher.slice(dispatcher.indexOf('\n',last)+1);
 check('recurring path and common actor/fence/lock bytes unchanged',()=>{
  assert.equal(sha(unchanged),'5f6dad520b8e3239af3c340fcb6900143c1f8dda9a03da418287bbf3eb01bf87');
  for(const guard of ['static_weekly_v3_assert_control_plane()','custodial_begin_application_mutation()',
   "pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0))",'actor:=public.static_weekly_v3_manager_actor(p_manager_id)'])
   assert.ok(dispatcher.indexOf(guard)>=0&&dispatcher.indexOf(guard)<first);
 });
 check('closed original request/envelope is bound before lookup',()=>{
  const lookup=branch.indexOf('SELECT * INTO prior');
  for(const text of ['approved dated materialization','approved dated original request',"p_key IS DISTINCT FROM (p_key::uuid)::text",
   "p_envelope->'request' IS DISTINCT FROM jsonb_build_object", "p_envelope#>'{request,publicationId}' IS DISTINCT FROM to_jsonb(p_source_publication_id::text)",
   "p_preview_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(p_envelope-'request'-'previewDigest')"])
   assert.ok(branch.indexOf(text)>=0&&branch.indexOf(text)<lookup,text);
 });
 check('exact replay returns original without a new basis/write',()=>{
  const replay=branch.slice(branch.indexOf('IF FOUND THEN'),branch.indexOf('basis:=public.'));
  assert.match(replay,/prior.request_json IS DISTINCT FROM p_envelope->'request'/);
  assert.match(replay,/prior.source_publication_id IS DISTINCT FROM p_source_publication_id/);
  assert.match(replay,/prior.publication_id IS DISTINCT FROM p_source_publication_id/);
  assert.match(replay,/prior.receipt_json->>'previewDigest'/);assert.match(replay,/RETURN prior.receipt_json/);
  assert.doesNotMatch(replay,/materialize_projection|INSERT INTO|UPDATE public\.|static_weekly_read_approved_template_basis/);
 });
 check('fresh actual basis and original actor/generation precede the private writer',()=>{
  const writer=branch.indexOf('receipt:=public.static_weekly_approved_dated_materialize_projection(');
  assert.ok(writer>branch.indexOf('basis:=public.static_weekly_read_approved_template_basis('));
  for(const field of ['templateCatalogDigest','templateInputsDigest','currentSourceDigest'])assert.ok(branch.indexOf(field)<writer);
  assert.match(branch,/p_generation IS DISTINCT FROM public.static_weekly_v15_read_recurring_generation\(\)/);
  assert.match(branch,/public.static_weekly_v3_manager_actor\(p_manager_id\) IS DISTINCT FROM actor/);
  assert.equal((branch.match(/receipt:=public\.static_weekly_approved_dated_materialize_projection\(/g)||[]).length,1);
  assert.match(branch,/p_manager_id,p_source_publication_id,p_date,feasibility#>>'\{mapping,templateId\}',\s*p_revision,p_generation,p_preview_digest,feasibility/);
 });
 check('exact private receipt is checked then inserted once into the original ledger',()=>{
  const writer=branch.indexOf('receipt:=public.'),insert=branch.indexOf('INSERT INTO public.static_weekly_approved_template_confirmations'),
   returned=branch.lastIndexOf('RETURN receipt;');assert.ok(writer<insert&&insert<returned);
  assert.equal((branch.match(/INSERT INTO public\.static_weekly_approved_template_confirmations/g)||[]).length,1);
  assert.match(branch,/receipt->'publication_id' IS DISTINCT FROM to_jsonb\(p_source_publication_id::text\)/);
  assert.match(branch,/receipt->>'feasibility_digest' IS DISTINCT FROM feasibility->>'digest'/);
  assert.match(branch,/l.document_json=feasibility#>'\{datedAbsence,lunchDocument\}'/);
  assert.match(branch,/VALUES\(p_manager_id,p_key,p_envelope->'request',receipt,p_source_publication_id,p_source_publication_id,v_projection_id\)/);
  assert.match(branch,/prior.receipt_json IS DISTINCT FROM receipt/);
  assert.doesNotMatch(branch,/receipt\s*:=\s*jsonb_build_object|ON CONFLICT|UPDATE\s+public\.|DELETE\s+FROM|create_draft|publish_draft|COMMIT|SECURITY DEFINER|set_config\(/i);
 });
 check('kind-specific native ledger proof remains mandatory, not bypassed',()=>{
  assert.match(sql,/CONSTRAINT approved_confirmation_publication_profile CHECK\(\(/);
  assert.match(sql,/CREATE UNIQUE INDEX approved_confirmation_publication_once/);
  const guard=sql.slice(sql.indexOf('CREATE FUNCTION public.static_weekly_guard_approved_template_confirmation()'),sql.indexOf('CREATE TRIGGER approved_confirmation_binding'));
  assert.match(guard,/NEW.request_json->>'kind' NOT IN\('RECURRING_STAFFING','DATED_ABSENCE'\)/);
  assert.match(guard,/v_kind='RECURRING_STAFFING' AND extract\(isodow FROM v_service_date\)<>1/);
  assert.match(guard,/NEW.request_json->'publicationId' IS DISTINCT FROM 'null'::jsonb/);
  assert.doesNotMatch(branch,/DISABLE TRIGGER|session_replication_role|ALTER TABLE|GRANT|SET ROLE/i);
 });
 check('existing lexical statement boundary accepts unchanged outer migration',()=>{
  const parsed=splitSchemaStatements(sql);assert.ok(parsed.statements.length>0);
  assert.equal(parsed.statements.filter(s=>s.text?.includes('CREATE FUNCTION public.static_weekly_materialize_approved_template(')).length,1);
 });
 console.log(JSON.stringify({checks,scope:'NEW DATED dispatcher/original-receipt Source composition only',SQL:'NOT_RUN',
  ledgerDatedCompatibility:'SOURCE_IMPLEMENTED_NATIVE_SQL_NOT_RUN',
  existingRecurringCasesReplayed:0,oldV5CasesReplayed:0,resources0:true}));process.exit(0);
}

// NEW actual service/serializer join with recording SQL DATA only. No server,
// database, solver, signed manager or accepting preparation stand-in runs.
if(process.argv.includes('--approved-dated-confirmation-status-only')){
 // Actual exported controller, recording DB port only. No SQL, current manager,
 // preview, confirmation, solver or receipt-signing operation is exercised.
 const manager={manager_id:'11000000-0000-4000-8000-000000000001',manager_display_name:'UNIT dated status manager',
  auth_mode:'trusted_device',trusted_device:true,read_only:false};
 const key='12000000-0000-4000-8000-000000000001',publication='14000000-0000-4000-8000-000000000001',
  projection='15000000-0000-4000-8000-000000000001',foreign='16000000-0000-4000-8000-000000000001';
 const digest='a'.repeat(64),calls=[];let returned,releases=0,checks=0;
 class DatedStatusClient extends EventEmitter{
  async query(sql,args=[]){calls.push({sql,args});
   if(sql==='select public.static_weekly_read_approved_template_confirmation($1,$2) as result')return{rows:[{result:returned}]};
   if(/select public\.static_weekly_/.test(sql))throw Error('Unexpected writer, preview, current snapshot or foreign ledger');
   return{rows:[]};
  }
  release(){releases++;}
 }
 const cp=createStaticWeeklyControlPlane({database:{connect:async()=>new DatedStatusClient()},
  compiler:()=>{throw Error('No solver in dated original status');},shutdownCompiler:async()=>{}});
 const original=()=>({request:{publicationId:publication,serviceDate:'2026-10-06',kind:'DATED_ABSENCE',templateId:null,
  expectedRevision:4,previewDigest:digest,idempotencyKey:key},receipt:{schema:'custodial.approved-static-confirmation.v1',
  status:'PERSISTED_CURRENT',ok:true,persistence_status:'PERSISTED',publication_id:publication,projection_id:projection,
  authority_revision:6,revision:6,feasibility_digest:'b'.repeat(64),lunch_document_identity:'c'.repeat(64),previewDigest:digest,solverInvoked:false}});
 const read=()=>cp.getApprovedStaticConfirmationStatus({manager,confirmationKey:key});
 const groupCheck=(start,accepted)=>{const group=calls.slice(start),reader=group.findIndex(q=>q.sql.includes('read_approved_template_confirmation'));
  assert.ok(reader>group.findIndex(q=>q.sql.includes('pg_advisory_xact_lock')));
  assert.deepEqual(group[reader].args,[manager.manager_id,key]);
  assert.equal(group.some(q=>q.sql=== (accepted?'commit':'rollback')),true);
  assert.equal(group.some(q=>q.sql=== (accepted?'rollback':'commit')),false);
  assert.equal(group.some(q=>/materialize|snapshot|create_draft|publish_draft|v13_read/.test(q.sql)),false);
 };
 try{
  for(const date of ['2026-10-06','2026-10-11','2026-10-05']){
   returned=original();returned.request.serviceDate=date;const start=calls.length,value=await read();
   assert.deepEqual(value,{schema:'custodial.approved-static-confirmation-status.v1',kind:'recurring',state:'ACCEPTED',
    confirmationKey:key,request:returned.request,receipt:returned.receipt});
   assert.notStrictEqual(value.request,returned.request);assert.notStrictEqual(value.receipt,returned.receipt);
   assert.equal(Object.hasOwn(value,'currentReadback'),false);groupCheck(start,true);checks++;
   if(process.argv.includes('--dated-status-reproducer-only'))break;
  }
  if(!process.argv.includes('--dated-status-reproducer-only')){
   returned=original();returned.request.templateId='approved-six';assert.equal((await read()).request.templateId,'approved-six');checks++;
   const mutations=[
    ['foreign receipt publication',x=>{x.receipt.publication_id=foreign;}],
    ['null original publication',x=>{x.request.publicationId=null;}],
    ['trimmed publication',x=>{x.request.publicationId+=' ';}],
    ['malformed publication',x=>{x.request.publicationId='not-a-uuid';}],
    ['nonprimitive publication',x=>{x.request.publicationId={toString(){throw Error('No coercion');}};}],
    ['impossible date',x=>{x.request.serviceDate='2026-02-30';}],
    ['padded date',x=>{x.request.serviceDate=' 2026-10-06';}],
    ['nonprimitive date',x=>{x.request.serviceDate={toString(){throw Error('No coercion');}};}],
    ['foreign original key',x=>{x.request.idempotencyKey=foreign;}],
    ['stale accepted revision',x=>{x.receipt.authority_revision=4;x.receipt.revision=4;}],
    ['different revision alias',x=>{x.receipt.revision=7;}],
    ['unsafe request revision',x=>{x.request.expectedRevision=9007199254740992;}],
    ['different digest',x=>{x.receipt.previewDigest='d'.repeat(64);}],
    ['malformed digest',x=>{x.request.previewDigest+='\n';x.receipt.previewDigest+='\n';}],
    ['foreign schema',x=>{x.receipt.schema='custodial.approved-static-initial-confirmation.v1';}],
    ['unpersisted receipt',x=>{x.receipt.status='PREVIEW_ONLY';}],
    ['malformed projection',x=>{x.receipt.projection_id=null;}],
    ['padded projection',x=>{x.receipt.projection_id+=' ';}],
    ['nonprimitive projection',x=>{x.receipt.projection_id={toString(){throw Error('No coercion');}};}],
    ['foreign kind',x=>{x.request.kind='OTHER';}],
    ['extra request field',x=>{x.request.managerId=foreign;}],
    ['getter request',x=>{Object.defineProperty(x.request,'serviceDate',{enumerable:true,get(){throw Error('No getter');}});}],
    ['getter receipt',x=>{Object.defineProperty(x.receipt,'publication_id',{enumerable:true,get(){throw Error('No getter');}});}],
    ['solver claim',x=>{x.receipt.solverInvoked=true;}]
   ];
   for(const [name,mutate]of mutations){returned=original();mutate(returned);const start=calls.length;
    await assert.rejects(read(),undefined,name);groupCheck(start,false);checks++;}
   returned=null;const absent=await read();assert.equal(absent.state,'NOT_FOUND');assert.equal(absent.receipt,null);checks++;
   for(const input of [{manager:{...manager,read_only:true},confirmationKey:key},{manager,confirmationKey:'invalid'}]){
    const start=calls.length;await assert.rejects(cp.getApprovedStaticConfirmationStatus(input));assert.equal(calls.length,start);checks++;
   }
   returned=original();const value=await cp.getApprovedStaticConfirmationStatus({manager,confirmationKey:key,
    request:{publicationId:foreign},receipt:{publication_id:foreign}});
   assert.equal(value.request.publicationId,publication);assert.equal(value.receipt.publication_id,publication);checks++;
  }
  assert.equal(releases,calls.filter(q=>q.sql==='begin').length);
  console.log(JSON.stringify({checks,scope:'NEW actual controller DATED original receipt Source/recording port only',
   actual_SQL:false,actual_HTTP:false,real_manager:false,old_groups:0,confirmation_writes:0,solver_runs:0,resources0:true}));
 }finally{await cp.close();}
 process.exit(0);
}
if(process.argv.includes('--approved-dated-operation-day-only')){
 const clone=structuredClone,sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 installStaticWeeklySha256HexAccelerator(sha);
 assert.equal(sha(readFileSync(new URL('../src/static-weekly-recurring-staffing-adaptation.js',import.meta.url))),
  'f5c31056057af3c3847449610b4b05bfe3046ebd72aeae6878fad7c19389048d','Exact sealed serializer dependency, not redesigned by this caller test');
 const configBytes=readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url));
 assert.equal(sha(configBytes),'40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30');
 const MID='81000000-0000-4000-8000-000000000001',PUB='82000000-0000-4000-8000-000000000001',
  VERSION='83000000-0000-4000-8000-000000000001',PROJECTION='84000000-0000-4000-8000-000000000001',
  KEY='85000000-0000-4000-8000-000000000001',SUCCESSOR='86000000-0000-4000-8000-000000000001';
 const manager={manager_id:MID,manager_display_name:'Synthetic named caller',auth_mode:'trusted_device',read_only:false,
  credential_id:KEY,device_id:'synthetic-dated-caller',access_level:'full_access'};
 let checks=0;
 function fixture(){
  const ownerConfig=JSON.parse(configBytes),filled=Object.entries(ownerConfig.slots).filter(([,slot])=>!slot.vacancy),
   kaili=ownerConfig.slots.KAILI.slotId,oldPerson=ownerConfig.slots.KAILI.personId;
  const pattern={serviceDate:'2026-10-05',slots:filled.map(([key,slot])=>({id:slot.slotId,label:key,
    incumbencies:[{personId:slot.personId,displayName:slot.name,effectiveStart:'2026-10-01',effectiveEnd:null}]})),
   exceptions:[],proximity:[],version:{id:VERSION,publicationId:PUB,status:'published',effectiveStart:'2026-10-05',effectiveEnd:null,
    objective:{requireVerifiedProximity:true},assignments:[],slotAvailability:[],vacancyCapableSlotIds:[],vacantSlotIds:[],namedAbsentSlotIds:[]}};
  for(let day=0;day<7;day++)for(const [index,[key,slot]]of filled.entries()){
   const location='synthetic-current-location-'+index,family=slot.normalAssignmentFamilies?.[0]||'CHINA';
   pattern.version.assignments.push({workId:`fixture-${day}-${key}`,dayOfWeek:day,locationId:location,locationCodeSnapshot:family,
    locationNameSnapshot:location,ownerSlotId:slot.slotId,originSlotId:slot.slotId,window:{start:'09:00',end:'09:30'},
    serviceEffortMinutes:10,serviceEffortProvenance:'synthetic-reviewed',priority:1,priorityProvenance:'synthetic-reviewed',required:true,
    requiredQualifications:['q'+index],qualificationProvenance:'synthetic-reviewed',restrictions:[],restrictedSlotIds:[],restrictionProvenance:'synthetic-reviewed',
    includedLocations:[{locationId:location,locationNameSnapshot:location}]});
   pattern.version.slotAvailability.push({slotId:slot.slotId,dayOfWeek:day,status:'working',shift:{start:'08:00',end:'17:00'},lunch:{start:'12:00',end:'13:00'},
    qualifications:['q'+index],qualificationProvenance:'synthetic-reviewed',restrictions:[],restrictionProvenance:'synthetic-reviewed',
    productiveCapacityProvenance:'synthetic-reviewed',maxServiceEffortMinutes:480,maxServiceEffortProvenance:'synthetic-reviewed',
    acceptedRouteAnchorLocationId:location,acceptedRouteProvenance:'synthetic-reviewed'});
  }
  for(let from=0;from<6;from++)for(let to=0;to<6;to++)if(from!==to)pattern.proximity.push({fromLocationId:'synthetic-current-location-'+from,
   toLocationId:'synthetic-current-location-'+to,minutes:1,verified:true,provenance:'synthetic-directed'});
  const source=clone(pattern);source.serviceDate='2026-10-06';
  for(const slot of source.slots)slot.incumbencies[0].effectiveEnd='2026-10-12';
  const changed=source.slots.find(slot=>slot.id===kaili);changed.incumbencies[0].effectiveEnd='2026-10-06';
  changed.incumbencies.push({personId:SUCCESSOR,displayName:'Synthetic Tuesday successor',effectiveStart:'2026-10-06',effectiveEnd:'2026-10-12'});
  ownerConfig.slots.KAILI.personId=SUCCESSOR;ownerConfig.slots.KAILI.name='Synthetic Tuesday successor';
  for(const key of ['OPTION1','OPTION2','OPTION4']){
   const id=ownerConfig.slots[key].slotId;source.slots.push({id,label:key,incumbencies:[]});
   source.version.vacancyCapableSlotIds.push(id);source.version.vacantSlotIds.push(id);
   for(let day=0;day<7;day++)source.version.slotAvailability.push({...clone(pattern.version.slotAvailability[0]),slotId:id,dayOfWeek:day,status:'vacant_unfilled'});
  }
  source.exceptions=[{id:'synthetic-existing-Monday-lunch',type:'lunch',serviceDate:'2026-10-05',baseVersionId:VERSION,publicationId:PUB,
   actorId:MID,reason:'Original accepted Monday lunch DATA',idempotencyKey:'synthetic-existing-Monday-lunch',expectedRevision:41,
   payload:{slotId:ownerConfig.slots.KAREN.slotId},window:{start:'13:00',end:'14:00'}}];
  const templateId='synthetic-approved-six',roleSlotIds=filled.map(([,slot])=>slot.slotId).sort(),
   templates=[{templateId,staffingCount:6,roleSlotIds,source:pattern}],
   admittedBindings=[{schema:'custodial.approved-static-template-binding.v1',templateId,staffingCount:6,sourceDigest:contentDigest(pattern),
    roleSlotIdsDigest:contentDigest(roleSlotIds),patternAuthority:'OWNER_APPROVED_OPERATIONAL_PATTERN',artifactSha256:sha(configBytes),
    ownerConfigDigest:contentDigest(ownerConfig),patternPublicationStatus:'SYNTHETIC_SOURCE_NOT_PUBLICATION_PROOF'}],
   entries=[{templateId,entryDigest:postgresJsonbContentDigest({templates,admittedBindings,ownerConfig,approvalEvidence:'SYNTHETIC DATA ONLY'})}];
  let state={revision:42,accepted:null,lunch:null},savedTransaction=null,change='none',writes=0,checkedOut=0,released=0,ended=0;
  const calls=[],materialized=[];
  class Client extends EventEmitter{
   async query(sql,args=[]){calls.push({sql,args:clone(args)});let result=null;
    if(sql==='begin'){savedTransaction=clone(state);return{rows:[]};}
    if(sql==='rollback'){state=savedTransaction;savedTransaction=null;return{rows:[]};}
    if(sql==='commit'){savedTransaction=null;return{rows:[]};}
    if(sql==='set local role static_weekly_control_plane'||/^set local statement_timeout = '\d+ms'$/.test(sql)
     ||sql==='select public.custodial_begin_application_mutation()')return{rows:[]};
    if(sql.includes('pg_advisory_xact_lock')){assert.deepEqual(args,['memphis-static-weekly-authority']);return{rows:[]};}
    if(sql.includes('custodial_action_actor_v1')){
     assert.deepEqual(args,[MID,KEY,manager.device_id,'full_access','write']);result={manager_id:MID,credential_id:KEY,device_id:manager.device_id,owner:true};
    }else if(sql.includes('static_weekly_v3_read_manager_snapshot')){
     assert.deepEqual(args,['2026-10-05']);result={authority_revision:state.revision,current_publication:{publication_id:PUB},
      projection_status:'current',latest_projection:{projection_id:state.accepted?PROJECTION:PUB}};
    }else if(sql.includes('static_weekly_read_approved_template_confirmation')){assert.deepEqual(args,[MID,KEY]);result=null;
    }else if(sql.includes('static_weekly_read_approved_template_basis')){
     assert.deepEqual(args,[MID,PUB,'2026-10-06','DATED_ABSENCE',templateId,42]);
     const basis={schema:'custodial.approved-static-template-basis.v1',publicationId:PUB,serviceDate:'2026-10-06',kind:'DATED_ABSENCE',authorityRevision:42,generation:7,
      currentSource:clone(source),ownerConfig:clone(ownerConfig),templates:clone(templates),admittedBindings:clone(admittedBindings),
      templateCatalogEntries:clone(entries),templateCatalogDigest:postgresJsonbContentDigest(entries),
      templateInputsDigest:postgresJsonbContentDigest({templates,admittedBindings,ownerConfig})};
     if(change==='lost')basis.currentSource=null;
     if(change==='changed')basis.currentSource.exceptions[0].window={start:'14:00',end:'15:00'};
     result=basis;
    }else if(sql.includes('static_weekly_materialize_approved_template')){
     const envelope=args[8],dated=envelope.feasibility.datedAbsence;assert.equal(writes,0);
     assert.deepEqual(args.slice(0,7),[MID,PUB,'2026-10-06','DATED_ABSENCE',42,7,KEY]);assert.equal(args[7],envelope.previewDigest);
     assert.deepEqual(envelope.request,{publicationId:PUB,serviceDate:'2026-10-06',kind:'DATED_ABSENCE',templateId,
      expectedRevision:42,previewDigest:envelope.previewDigest,idempotencyKey:KEY});
     const {previewDigest,request,...body}=envelope;assert.equal(previewDigest,postgresJsonbContentDigest(body));
     assert.equal(dated.sourcePublicationId,PUB);assert.equal(dated.sourceVersionId,VERSION);assert.deepEqual(dated.scopeDates,['2026-10-06']);
     assert.equal(dated.projection.week_start,'2026-10-05');assert.equal(dated.projection.week_end,'2026-10-11');
     assert.equal(dated.projection.assignments.find(row=>row.service_date==='2026-10-05'&&row.owner_slot_id===kaili).owner_person_id,oldPerson);
     assert.equal(dated.projection.assignments.find(row=>row.service_date==='2026-10-06'&&row.owner_slot_id===kaili).owner_person_id,SUCCESSOR);
     assert.deepEqual(dated.projection.authority.originalCompilerInput,source);
     assert.equal(dated.projection.applied_exceptions[0].serviceDate,'2026-10-05');
     assert.equal(dated.lunchDocument.week_start,'2026-10-05');assert.equal(dated.lunchDocument.loans.length,42);
     writes++;materialized.push(clone(envelope));state.revision=43;state.lunch=dated.lunchDocument;
     result=state.accepted={ok:true,persistence_status:'PERSISTED',publication_id:PUB,projection_id:PROJECTION,authority_revision:43,
      feasibility_digest:envelope.feasibility.digest,lunch_document_identity:dated.lunchDocument.document_identity};
    }else if(sql.includes('static_weekly_v8_read_lunch_document')){
     assert.deepEqual(args,['2026-10-06']);result={persistence_status:'PERSISTED',projection_id:PROJECTION,document_identity:state.lunch.document_identity};
    }else if(sql.includes('static_weekly_v21_reconcile_dependency_changes')){
     assert.deepEqual(args,[MID]);result={authorityRevision:state.revision,processedChangeCount:0,invalidations:[],blockedPublications:[],affectedPhonesUpdated:false};
    }else assert.fail('Unexpected recording SQL '+sql);
    return{rows:[{result}]};
   }
   release(){checkedOut--;released++;assert.ok(checkedOut>=0);}
  }
  const database={async connect(){checkedOut++;return new Client();},async end(){ended++;assert.equal(checkedOut,0);}},
   cp=createStaticWeeklyControlPlane({database,compiler:()=>{throw Error('NO_SOLVER');},compilerPreparer:()=>{throw Error('NO_SOLVER');},shutdownCompiler:async()=>{}});
  const invoke=(method,extra={})=>{const signal=new AbortController().signal,deadlineAt=performance.now()+15000;
   return cp.runManagerOperation({manager,signal,deadlineAt,permission:'write'},()=>cp[method]({manager,publicationId:PUB,serviceDate:'2026-10-06',kind:'DATED_ABSENCE',
    templateId,expectedRevision:42,signal,deadlineAt,...extra}));};
  return{cp,calls,materialized,source,ownerConfig,oldPerson,kaili,invoke,setChange:value=>change=value,writes:()=>writes,
   state:()=>clone(state),async close(){await cp.close();assert.equal(checkedOut,0);assert.equal(ended,1);assert.equal(released,calls.filter(row=>row.sql==='begin').length);}};
 }
 const positive=fixture();try{
  const preview=await positive.invoke('previewApprovedStaticPattern');
  assert.equal(preview.schema,'custodial.approved-static-preview.v1');assert.equal(preview.serviceDate,'2026-10-06');assert.equal(preview.authorityRevision,42);
  assert.equal(preview.mapping.staffingCount,6);assert.equal(preview.mapping.slotMapping.find(row=>row.actualSlotId===positive.kaili).actualPersonId,SUCCESSOR);
  assert.equal(preview.lunch.week_start,'2026-10-05');assert.equal(positive.writes(),0);assert.equal(preview.published,false);checks++;
  const accepted=await positive.invoke('confirmApprovedStaticPattern',{idempotencyKey:KEY,previewDigest:preview.previewDigest});
  assert.equal(accepted.publication_id,PUB);assert.equal(accepted.projection_id,PROJECTION);assert.equal(accepted.authority_revision,43);
  assert.equal(accepted.solverInvoked,false);assert.equal(positive.writes(),1);assert.equal(positive.materialized.length,1);
  assert.equal(positive.calls.filter(row=>row.sql==='commit').length,2);checks++;
 }finally{await positive.close();}
 for(const change of ['lost','changed']){const f=fixture();try{
  const preview=await f.invoke('previewApprovedStaticPattern');f.setChange(change);
  await assert.rejects(f.invoke('confirmApprovedStaticPattern',{idempotencyKey:KEY,previewDigest:preview.previewDigest}),
   {code:change==='lost'?'static_template_trusted_basis_invalid':'static_template_preview_changed'});
  assert.equal(f.writes(),0);assert.equal(f.state().revision,42);assert.equal(f.state().accepted,null);
  assert.equal(f.calls.at(-1).sql,'rollback');assert.equal(f.calls.filter(row=>row.sql==='commit').length,1);checks++;
 }finally{await f.close();}}
 console.log(JSON.stringify({scope:'NEW actual approved service operation-day preview/confirm and Source revalidation with recording SQL DATA',checks,
  SQL:false,HTTP:false,realManager:false,solver_runs:0,publication:false,old_groups:0,resources0:true}));process.exit(0);
}

// NEW overlay and closing components only. Retained compiler input is real fixture DATA,
// NOT an accepted SQL command, event approval, current manager or publication.
if(process.argv.includes('--approved-pending-actual-lunch-window-only')||process.argv.includes('--approved-pending-isolated-producer-only')||process.argv.includes('--approved-pending-caller-refusals-only')||process.argv.includes('--approved-pending-relation-refusals-only')||process.argv.includes('--approved-pending-proposal-source-only')||process.argv.includes('--approved-pending-multidate-producer-only')||process.argv.includes('--approved-dated-unresolved-snapshot-guard-only')||process.argv.includes('--approved-dated-unresolved-response-only')||process.argv.includes('--approved-dated-unresolved-response-predecessor-only')||process.argv.includes('--approved-dated-closing-consumer-only')||process.argv.includes('--approved-dated-closing-refusals-only')||process.argv.includes('--approved-dated-closing-unresolved-only')||process.argv.includes('--approved-dated-closing-partial-covered-only')||process.argv.includes('--approved-dated-partial-native-consumer-only')||process.argv.includes('--approved-dated-partial-native-source-only')){
 const {prepareApprovedStaticTemplateProjection}=await import('../src/static-weekly-recurring-staffing-adaptation.js');
 const {createShiftEndContinuityPolicy}=await import('../src/static-weekly-shift-end-derivation.js');
 const {prepareStaticWeeklySchedulingProblem,normalizeStaticWeeklyAuthority}=await import('../src/static-weekly-schedule-program.js');
 const {canonicalJson}=await import('../src/static-weekly-schedule-model.js');
 const {splitSchemaStatements}=await import('./isolated-event-owner-schema.mjs');
 const clone=structuredClone,sha=x=>createHash('sha256').update(x).digest('hex');
 installStaticWeeklySha256HexAccelerator(sha);
 assert.equal(sha(readFileSync(new URL('../src/static-weekly-shift-end-derivation.js',import.meta.url))),
  '582dd466c11527710375c1ea1296ee38b948fc4c24045e6c2422113ebe35e5c8','Exact borrowed Task7 dependency; its21+10 checks are not replayed');
 const ownerConfig=JSON.parse(readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url))),
  filled=Object.entries(ownerConfig.slots).filter(([,s])=>!s.vacancy),kaili=ownerConfig.slots.KAILI.slotId,
  substitute='74000000-0000-4000-8000-000000000003',person='74000000-0000-4000-8000-000000000001';
 if(process.argv.includes('--approved-pending-actual-lunch-window-only'))ownerConfig.slots.KAREN.lunch=['09:30','10:00'];
 // Tiny explicit UNIT Source: normal role IDs/geography, but constructed
 // seven-day attendance/work/edges. NOT approved/current production facts.
 for(const [,s]of filled){s.workDays=[0,1,2,3,4,5,6];delete s.shiftByDay;delete s.lunchByDay;}
 const source={serviceDate:'2026-10-05',slots:filled.map(([key,s])=>({id:s.slotId,label:key,
  incumbencies:[{personId:s.personId,displayName:s.name,effectiveStart:'2026-10-01',effectiveEnd:null}]})),exceptions:[],proximity:[],
  version:{id:'83000000-0000-4000-8000-000000000001',publicationId:'82000000-0000-4000-8000-000000000001',
   status:'published',effectiveStart:'2026-10-05',effectiveEnd:null,objective:{requireVerifiedProximity:true},
   assignments:[],slotAvailability:[],vacancyCapableSlotIds:[],vacantSlotIds:[],namedAbsentSlotIds:[]}};
 const weights={};
 for(let day=0;day<7;day++)for(const [index,[key,s]]of filled.entries()){
  const family=s.normalAssignmentFamilies?.[0]||'CHINA',loc='UNIT-closing-'+index;weights[family]=1;
  for(let part=0;part<2;part++){
  const area=loc+'-'+part;
  source.version.assignments.push({workId:'UNIT-'+day+'-'+key+'-'+part,dayOfWeek:day,ownerSlotId:s.slotId,originSlotId:s.slotId,
   locationId:area,locationNameSnapshot:area,locationCodeSnapshot:family,includedLocations:[{locationId:area,locationNameSnapshot:area}],
   serviceMode:'scan_tracked',schedulingMode:'flexible_coverage_ownership',window:{start:'09:45',end:s.shift[1]},
   serviceEffortMinutes:30,serviceEffortProvenance:'UNIT original parent budget',priority:1,priorityProvenance:'UNIT priority',required:true,
   requiredQualifications:['general'],qualificationProvenance:'UNIT qualification',
   restrictions:[],restrictedSlotIds:[],restrictionProvenance:'UNIT hard restrictions'});
  }
  source.version.slotAvailability.push({dayOfWeek:day,slotId:s.slotId,status:'working',shift:{start:s.shift[0],end:s.shift[1]},
   lunch:{start:s.lunch[0],end:s.lunch[1]},qualifications:['general'],
   qualificationProvenance:'UNIT eligibility',restrictions:[],restrictionProvenance:'UNIT eligibility',
   maxDutyMinutes:480,maxDutyProvenance:'UNIT duty',maxServiceEffortMinutes:480,maxServiceEffortProvenance:'UNIT service',
   productiveCapacityProvenance:'UNIT capacity',acceptedRouteAnchorLocationId:loc+'-0',acceptedRouteProvenance:'UNIT original route'});
 }
 for(let a=0;a<12;a++)for(let b=0;b<12;b++)if(a!==b)source.proximity.push({fromLocationId:'UNIT-closing-'+Math.floor(a/2)+'-'+a%2,toLocationId:'UNIT-closing-'+Math.floor(b/2)+'-'+b%2,
  minutes:Math.floor(a/2)===5?1:2,verified:true,provenance:'UNIT directed path'});
 source.version.shiftEndContinuityPolicy=createShiftEndContinuityPolicy(weights,sha(JSON.stringify(ownerConfig)),postgresJsonbContentDigest);
 const pattern=normalizeStaticWeeklyAuthority(source.version,source.slots,[],source.proximity,source.serviceDate),current=clone(pattern);
 current.serviceDate='2026-10-06';current.slots.push({id:substitute,label:'UNIT substitute',incumbencies:[{personId:person,displayName:'UNIT substitute',effectiveStart:'2026-10-01',effectiveEnd:null}]});
 for(let day=0;day<7;day++){
  const a=clone(current.version.slotAvailability.find(a=>a.dayOfWeek===day&&a.slotId===kaili));a.slotId=substitute;
  current.version.slotAvailability.push(a);
 }
 ownerConfig.slots.UNIT_SUBSTITUTE={...clone(ownerConfig.slots.KAILI),slotId:substitute,personId:person,name:'UNIT substitute',vacancy:false};
 current.exceptions=[{id:'UNIT-dated-absence',type:'daily_absence',serviceDate:'2026-10-06',actorId:'UNIT manager DATA only',
  reason:'UNIT accepted absence',idempotencyKey:'UNIT-dated-absence',expectedRevision:1,sequence:2,
  baseVersionId:current.version.id,publicationId:current.version.publicationId,payload:{slotId:kaili}}];
 const roleSlotIds=filled.map(([,s])=>s.slotId).sort(),templateId='UNIT-closing-six',input={
  templates:[{templateId,staffingCount:6,roleSlotIds,source:pattern}],currentSource:current,currentOwnerConfig:ownerConfig,
  admittedBindings:[{schema:'custodial.approved-static-template-binding.v1',templateId,staffingCount:6,sourceDigest:contentDigest(pattern),
   roleSlotIdsDigest:contentDigest(roleSlotIds),patternAuthority:'OWNER_APPROVED_OPERATIONAL_PATTERN',
   artifactSha256:sha(JSON.stringify(pattern)),ownerConfigDigest:contentDigest(ownerConfig),patternPublicationStatus:'UNIT_ONLY_NOT_NATIVE_APPROVAL'}],
  selection:{schema:'custodial.static-template-selection.v1',kind:'DATED_ABSENCE',templateId,serviceDate:'2026-10-06',
   availablePersonIds:[...filled.filter(([key])=>key!=='KAILI').map(([,s])=>s.personId),person]}};
 if(process.argv.includes('--approved-pending-caller-refusals-only')){
  const managerId='81000000-0000-4000-8000-000000000001',key='85000000-0000-4000-8000-000000000001',operation='85000000-0000-4000-8000-000000000002';
  let checks=0;
  for(const [mode,code]of [['foreign','staffing_original_preparer_required'],['stale','staffing_preparation_revision_changed'],
   ['withdrawn','42501'],['missing-cancellation','staffing_original_cancellation_target_required']]){
   const manager={manager_id:managerId,manager_display_name:'UNIT original preparer',credential_id:key,device_id:'UNIT-pending-device',access_level:'full_access',read_only:false,auth_mode:'trusted_device'},
    semantic={absenceKind:'daily_absence',commandKind:'absence',employeeId:ownerConfig.slots.KAILI.personId,startDate:'2026-10-06',endDate:'2026-10-07',targetAbsenceId:null};
   if(mode==='missing-cancellation'){semantic.commandKind='cancel_absence';semantic.absenceKind=null;semantic.targetAbsenceId=operation;}
   const command={operation_id:operation,state:'PREPARING',prepared_by_manager_id:mode==='foreign'?person:managerId,semantic_body:semantic,
    semantic_digest:postgresJsonbContentDigest(semantic),expected_revision:42,current_service_date:'2026-10-05',original_cancellation_target:null},calls=[];
   let released=0,ended=0,compilerCalls=0;
   class Client extends EventEmitter{
    async query(sql,args=[]){calls.push(sql);let result=null;
     if(['begin','rollback','commit','select 1','set local role static_weekly_control_plane','select public.custodial_begin_application_mutation()'].includes(sql)
      ||/^set local statement_timeout = '\d+ms'$/.test(sql)||sql.includes('pg_advisory_xact_lock'))return{rows:[]};
     if(sql.includes('custodial_action_actor_v1'))result={manager_id:managerId,credential_id:key,device_id:manager.device_id,owner:mode!=='withdrawn'};
     else if(sql.includes('static_weekly_v10_read_staffing_command'))result=clone(command);
     else if(sql.includes('static_weekly_v11_read_current_refresh_targets'))result=[];
     else if(sql.includes('static_weekly_v3_read_manager_snapshot'))result={authority_revision:43,current_publication:{publication_id:current.version.publicationId}};
     else assert.fail('Unexpected inert refusal query '+sql);
     return {rows:[{result}]};
    }
    release(){released++;}
   }
   const cp=createStaticWeeklyControlPlane({database:{async connect(){return new Client();},async end(){ended++;}},
    compilerPreparer:()=>{compilerCalls++;throw Error('NO_SOLVER');},shutdownCompiler:async()=>{}}),signal=new AbortController().signal,deadlineAt=performance.now()+10000;
   try{await assert.rejects(cp.runManagerOperation({manager,signal,deadlineAt,permission:'write'},()=>cp.prepareStaffingCommand({manager,operationId:operation})),e=>e.code===code);}
   finally{await cp.close();}
   assert.equal(compilerCalls,0);assert.equal(released,1);assert.equal(ended,1);assert.equal(calls.at(-1),'rollback');
   assert.ok(!calls.some(q=>q.includes('stage_staffing_command')||q.includes('materialize_projection')));checks++;
  }
  console.log(JSON.stringify({checks,scope:'NEW actual pending preparation controller refusals with inert SQL/actor DATA; no planner/worker/SQL acceptance',SQL:'NOT_RUN',oldGroups:0,resources0:true}));process.exit(0);
 }
 if(process.argv.includes('--approved-pending-actual-lunch-window-only')||process.argv.includes('--approved-pending-isolated-producer-only')||process.argv.includes('--approved-pending-relation-refusals-only')||process.argv.includes('--approved-pending-proposal-source-only')||process.argv.includes('--approved-pending-multidate-producer-only')){
  const {prepareApprovedPendingStaffingWeekProjection}=await import('../src/static-weekly-recurring-staffing-adaptation.js'),
   {createApprovedPendingStaffingWeekInput}=await import('../src/static-weekly-staffing-preview.js'),
   managerId='81000000-0000-4000-8000-000000000001',operation='85000000-0000-4000-8000-000000000001',accepted=clone(current);
  accepted.serviceDate='2026-10-05';accepted.exceptions=[];
  const sourceRow={authority_revision:42,publication_id:accepted.version.publicationId,version_id:accepted.version.id,compiler_input:accepted,exceptions:[]},
   semantic={absenceKind:'daily_absence',commandKind:'absence',employeeId:ownerConfig.slots.KAILI.personId,
    endDate:'2026-10-07',startDate:'2026-10-06',targetAbsenceId:null},
   command={operation_id:operation,state:'PREPARING',prepared_by_manager_id:managerId,semantic_body:semantic,
    semantic_digest:postgresJsonbContentDigest(semantic),expected_revision:42,current_service_date:'2026-10-05',original_cancellation_target:null},
   entries=[{templateId,entryDigest:sha('UNIT catalog DATA')}],basis=date=>({schema:'custodial.approved-static-template-basis.v1',
    publicationId:sourceRow.publication_id,serviceDate:date,kind:'DATED_ABSENCE',authorityRevision:42,generation:7,
    currentSource:{...clone(accepted),serviceDate:date,exceptions:[]},ownerConfig:clone(ownerConfig),templates:clone(input.templates),admittedBindings:clone(input.admittedBindings),
    templateCatalogEntries:entries,templateCatalogDigest:postgresJsonbContentDigest(entries),
    templateInputsDigest:postgresJsonbContentDigest({templates:input.templates,admittedBindings:input.admittedBindings,ownerConfig})});
  const args={command,managerId,actor:{managerId,managerName:'UNIT pending manager'},weekStart:'2026-10-05',source:sourceRow,
   bases:['2026-10-06','2026-10-07'].map(basis),deadline:performance.now()+25000},before=canonicalJson(args),
   relation=createApprovedPendingStaffingWeekInput({command,managerId,weekStart:args.weekStart,source:sourceRow});
  // NEW actual child qualification entrypoint. Prepared but NOT executed by
  // the Source-only helper; Main must reserve the existing compute slot.
  if(process.argv.includes('--approved-pending-isolated-producer-only')){
   const {createStaticWeeklyCompilerRuntime}=await import('../src/static-weekly-schedule-compiler-runtime.js'),
    {enumerateStaffingServiceWindow}=await import('../src/static-weekly-staffing-preparation.js'),
    runtime=createStaticWeeklyCompilerRuntime({exposeProcessIdentityForTest:true}),
    originalInput={schema:'custodial.approved-static-pending-staffing-worker-input.v1',command,managerId,actor:args.actor,
     weekStart:args.weekStart,source:sourceRow,bases:args.bases,
     snapshot:{authority_revision:42,current_publication:{publication_id:sourceRow.publication_id}},
     window:enumerateStaffingServiceWindow(semantic.startDate,semantic.endDate)},
    beforeWorker=canonicalJson(originalInput);
   let ticks=0;const pulse=setInterval(()=>ticks++,20);
   let out;
   try{
    out=await runtime.compileAndPrepare(originalInput,{kind:'approved-pending-staffing'},
     {deadlineAtMilliseconds:args.deadline});
    assert.equal(runtime.getReadiness().worker.compiler,'fixed approved pending preparation');
    assert.equal(runtime.getReadiness().worker.solverInvoked,false);
    assert.equal(runtime.getReadiness().worker.nestedSolverProcess,false);
    assert.ok(Number.isSafeInteger(runtime.getReadiness().worker.processId));
    assert.ok(ticks>0,'parent event loop remains available for original native keepalive');
    assert.equal(Object.keys(out).length,13);assert.equal(Object.isFrozen(out.envelope.semantic_snapshot.originalCommand),true);
    assert.equal(out.envelope.semantic_snapshot.originalCommand.operationId,operation);
    assert.deepEqual(out.envelope.semantic_snapshot.scopeDates,['2026-10-06','2026-10-07']);
    assert.equal(out.compilerVersion,'approved-static-pending-staffing-v1');
    assert.equal(Object.hasOwn(out.envelope,'attestation'),false);assert.equal(canonicalJson(originalInput),beforeWorker);
   }finally{clearInterval(pulse);await runtime.shutdown();}
   assert.equal(runtime.getReadiness().state,'closed');
   console.log(JSON.stringify({checks:1,scope:'NEW fixed pending original -> real existing serialized child -> closed transport DATA',
    actualChild:true,solver:false,SQL:'NOT_RUN',oldGroups:0,resources0:true}));process.exit(0);
  }
  if(process.argv.includes('--approved-pending-relation-refusals-only')){
   const adapter=next=>createApprovedPendingStaffingWeekInput({command:next.command,managerId:next.managerId,weekStart:next.weekStart,source:next.source});
   let checks=0;
   for(const change of [a=>{a.command.prepared_by_manager_id=person;},a=>{a.command.semantic_digest='0'.repeat(64);},
    a=>{a.source.authority_revision=43;},a=>{a.command.current_service_date='2026-10-08';},a=>{a.command.state='ACCEPTED';},
    a=>{a.source.version_id=operation;},a=>{a.command.original_cancellation_target={status:'accepted'};},
    a=>{a.command.semantic_body.startDate='2026-02-31';a.command.semantic_digest=postgresJsonbContentDigest(a.command.semantic_body);},
    a=>{a.command=new Proxy(a.command,{});}]){
    const changed=clone(args);change(changed);assert.throws(()=>adapter(changed));checks++;
   }
   const spanning=clone(args);spanning.command.semantic_body.startDate='2026-10-11';spanning.command.semantic_body.endDate='2026-10-13';
   spanning.command.semantic_digest=postgresJsonbContentDigest(spanning.command.semantic_body);
   const one=adapter(spanning);spanning.weekStart='2026-10-12';const two=adapter(spanning);
   assert.deepEqual(one.scopeDates,['2026-10-11']);assert.deepEqual(two.scopeDates,['2026-10-12','2026-10-13']);
   assert.deepEqual([...one.scopeDates,...two.scopeDates],['2026-10-11','2026-10-12','2026-10-13']);checks++;
   const cancellation=clone(args),target='85000000-0000-4000-8000-000000000002',employee=cancellation.command.semantic_body.employeeId;
   cancellation.command.semantic_body={absenceKind:null,commandKind:'cancel_absence',employeeId:employee,endDate:'2026-10-07',startDate:'2026-10-06',targetAbsenceId:target};
   cancellation.command.semantic_digest=postgresJsonbContentDigest(cancellation.command.semantic_body);
   cancellation.command.current_service_date='2026-10-06';
   cancellation.command.original_cancellation_target={absenceId:target,employeeId:employee,startDate:'2026-10-01',endDate:'2026-10-07',acceptedOperationId:target,status:'accepted'};
   cancellation.source.exceptions=relation.pendingSource.exceptions.map(e=>({...clone(e),id:target+':'+e.serviceDate,staffingAbsenceId:target,status:'accepted'}));
   const cancelled=adapter(cancellation);assert.equal(cancelled.pendingSource.exceptions.length,0);
   assert.ok(cancelled.dayViews.every(v=>v.source.exceptions.length===1&&v.source.exceptions[0].serviceDate!==v.serviceDate));
   assert.deepEqual(cancelled.originalSource,cancellation.source);assert.deepEqual(cancelled.originalCommand.originalCancellationTarget,cancellation.command.original_cancellation_target);checks++;
   assert.equal(canonicalJson(args),before);
   console.log(JSON.stringify({checks,scope:'NEW original relation hostile/late/stale/foreign/Proxy, cross-week exact partition and original cancellation DATA only',SQL:'NOT_RUN',oldGroups:0,resources0:true}));process.exit(0);
  }
  if(process.argv.includes('--approved-pending-proposal-source-only')){
   const sql=readFileSync(new URL('../proposals/approved-static-pending-staffing.sql',import.meta.url),'utf8'),parsed=splitSchemaStatements(sql);
   assert.ok(parsed.statements.length>10);assert.doesNotMatch(sql,/^\s*GRANT\s|^\s*BEGIN\s*;|^\s*COMMIT\s*;/mi);
   for(const fixed of ['Pending exact original command unavailable','Pending original semantics did not become the exact accepted facts',
    'Pending complete original day partitions required','Pending merged exact week projection or original relation differs',
    'Pending original publication vector differs','Pending sink requires actual original acceptance facts',
    'Pending independent validator unrelated Source changed','Pending lunch unrelated original Source differs','Pending original entrypoint unrelated Source differs'])assert.ok(sql.includes(fixed),fixed);
   const producer=readFileSync(new URL('../src/static-weekly-recurring-staffing-adaptation.js',import.meta.url),'utf8'),
    cpSource=readFileSync(new URL('../src/static-weekly-control-plane.js',import.meta.url),'utf8'),a=cpSource.indexOf('    async prepareStaffingCommand('),b=cpSource.indexOf('    async stageStaffingCommand(',a),region=cpSource.slice(a,b);
   assert.ok(region.includes('await lockStaticWeeklyAuthority(client)'));assert.ok(region.includes('staffing_approved_original_command_changed'));
   assert.ok(region.includes('staffing_approved_original_source_changed'));assert.ok(region.includes('staffing_approved_pending_basis_changed'));
   assert.ok(!region.includes('await prepareProjection(overlay.input'));assert.ok(producer.includes('deriveLunchCoverageFromPreparedProblem(problem,assignments)'));
   assert.ok(producer.includes('staffing_approved_pending_hard_constraint'));assert.ok(sql.includes('BEGIN PRIVATE ORIGINAL-PENDING BATCH DIGEST'));
   console.log(JSON.stringify({checks:1,statements:parsed.statements.length,scope:'NEW proposal statement-boundaries and fixed Source guard/caller controls only; NOT SQL body compilation or native admission',SQL:'NOT_RUN',oldGroups:0,resources0:true}));process.exit(0);
  }
  assert.deepEqual(relation.scopeDates,['2026-10-06','2026-10-07']);assert.equal(sourceRow.exceptions.length,0);
  assert.ok(relation.pendingSource.exceptions.every(e=>!Object.hasOwn(e,'status')));
  assert.ok(relation.dayViews.every(v=>v.source.exceptions.length===1&&v.source.exceptions[0].serviceDate===v.serviceDate));
  const out=prepareApprovedPendingStaffingWeekProjection(args),snapshot=out.envelope.semantic_snapshot;
  assert.equal(snapshot.schema,'custodial.approved-static-pending-staffing-projection-snapshot.v1');
  assert.deepEqual(snapshot.scopeDates,relation.scopeDates);assert.equal(snapshot.originalCommand.semanticDigest,command.semantic_digest);
  for(const date of relation.scopeDates){const part=snapshot.partitions.find(p=>p.serviceDate===date);
   assert.deepEqual(out.envelope.assignments.filter(r=>r.service_date===date),part.projection.assignments.filter(r=>r.service_date===date));}
  assert.equal(new Set(out.envelope.assignments.map(r=>r.plan_work_id)).size,out.envelope.assignments.length);
  assert.equal(out.envelope.week_start,'2026-10-05');assert.equal(out.envelope.week_end,'2026-10-11');
  assert.equal(out.lunchDocument.source_input_digest,out.envelope.authority.inputDigest);
  assert.equal(out.lunchDocument.base_authority_digest,out.envelope.authority_digest);
  assert.equal(out.replayDigest,postgresJsonbContentDigest({projectionAssignments:out.envelope.assignments,
   lunchDocument:Object.fromEntries(Object.entries(out.lunchDocument).filter(([key])=>!['base_authority_digest','base_replay_digest','document_identity'].includes(key)))}));
  assert.equal(Object.keys(out).filter(key=>key!=='lunchDocument').length,12);
  assert.equal(canonicalJson(args),before);assert.equal(Object.hasOwn(out.envelope,'attestation'),false);
  if(process.argv.includes('--approved-pending-actual-lunch-window-only')){
   const karen=ownerConfig.slots.KAREN.slotId,loans=out.lunchDocument.loans.filter(l=>l.normal_owner_slot_id===karen);
   assert.equal(loans.length,7);assert.ok(loans.every(l=>l.coverage_start==='09:30'&&l.coverage_end==='10:00'));
   const responsibilities=out.lunchDocument.responsibilities.filter(r=>r.normal_owner_slot_id===karen),endIntents=out.lunchDocument.notification_intents.filter(i=>loans.some(l=>l.loan_id===i.loan_id)&&i.event==='end');
   assert.ok(responsibilities.length>0);assert.ok(responsibilities.every(r=>r.coverage_end==='10:00'));
   assert.ok(endIntents.length>0);assert.ok(endIntents.every(i=>i.scheduled_time==='10:00'));
   console.log(JSON.stringify({checks:5,scope:'actual unchanged recurring pending producer transitively derives accepted synthetic 30-minute lunch/end without fixed-hour rule; NOT SQL/current operational authority',SQL:'NOT_RUN',solver:false}));process.exit(0);
  }
  console.log(JSON.stringify({checks:1,scope:'NEW original pending two-day overlay -> disjoint fixed components -> merged hard model/lunch; synthetic UNIT DATA not DB acceptance',
   SQL:'NOT_RUN',solver:false,oldGroups:0,resources0:true}));process.exit(0);
 }
 if(process.argv.includes('--approved-dated-unresolved-snapshot-guard-only')||process.argv.includes('--approved-dated-unresolved-response-only')||process.argv.includes('--approved-dated-unresolved-response-predecessor-only')){
  // Actual local serializer + real control-plane operation. SQL/actor replies
  // below are explicitly synthetic recording DATA, NOT native/current authority.
  const next=clone(input),gregory=ownerConfig.slots.GREGORY.slotId;
  next.currentSource.version.slotAvailability.find(a=>a.dayOfWeek===2&&a.slotId===gregory).maxDutyMinutes=360;
  next.currentSource.exceptions.push({...clone(next.currentSource.exceptions[0]),id:'UNIT-response-partial',idempotencyKey:'UNIT-response-partial',sequence:3,
   type:'partial_absence',payload:{slotId:gregory},window:{start:'16:30',end:'17:00'}});
  const MID='81000000-0000-4000-8000-000000000001',KEY='85000000-0000-4000-8000-000000000001',PUB=next.currentSource.version.publicationId,
   sourceText=readFileSync(new URL('../src/static-weekly-control-plane.js',import.meta.url),'utf8');
  let creator=createStaticWeeklyControlPlane;
  if(process.argv.includes('--approved-dated-unresolved-response-predecessor-only')){
   const {realpathSync}=await import('node:fs'),{pathToFileURL}=await import('node:url'),
    dependency=realpathSync(new URL('../src/static-weekly-recurring-staffing-adaptation.js',import.meta.url)),
    predecessor=new URL('./static-weekly-control-plane.js',pathToFileURL(dependency));
   assert.equal(sha(readFileSync(predecessor)),'6843ad1b6c8765fc1c9bc6ff9b986a61917d4e625741e34442f239d661a8f9bf');
   creator=(await import(predecessor.href)).createStaticWeeklyControlPlane;
  }
  let checks=0;
  async function journey(change='none',confirm=false,requestedTemplate=null){
   const manager={manager_id:MID,manager_display_name:'UNIT named manager DATA',credential_id:KEY,device_id:'UNIT-device',
    access_level:'full_access',auth_mode:'trusted_device',read_only:false},controller=new AbortController(),calls=[];
   let checkedOut=0,released=0,ended=0,basisReads=0,snapshots=0,actorReads=0,firstSnapshot=null;
   const basis={schema:'custodial.approved-static-template-basis.v1',publicationId:PUB,serviceDate:'2026-10-06',kind:'DATED_ABSENCE',
    authorityRevision:42,generation:7,currentSource:clone(next.currentSource),ownerConfig:clone(next.currentOwnerConfig),
    templates:clone(next.templates),admittedBindings:clone(next.admittedBindings),
    templateCatalogEntries:[{templateId,entryDigest:sha('UNIT release approval DATA')}],
    templateCatalogDigest:postgresJsonbContentDigest([{templateId,entryDigest:sha('UNIT release approval DATA')}]),
    templateInputsDigest:postgresJsonbContentDigest({templates:next.templates,admittedBindings:next.admittedBindings,ownerConfig:next.currentOwnerConfig})};
   class Client extends EventEmitter{
    async query(sql,args=[]){calls.push({sql,args:clone(args)});let result=null;
     if(['begin','rollback','commit','set local role static_weekly_control_plane','select public.custodial_begin_application_mutation()'].includes(sql)
      ||/^set local statement_timeout = '\d+ms'$/.test(sql))return {rows:[]};
     if(sql.includes('pg_advisory_xact_lock')){assert.deepEqual(args,['memphis-static-weekly-authority']);return {rows:[]};}
     if(sql.includes('custodial_action_actor_v1')){
      actorReads++;assert.deepEqual(args,[MID,KEY,'UNIT-device','full_access','write']);
      result={manager_id:MID,credential_id:KEY,device_id:'UNIT-device',owner:!(change==='revoked'&&actorReads>1)};
     }else if(sql.includes('static_weekly_v3_read_manager_snapshot')){
      snapshots++;assert.deepEqual(args,['2026-10-05']);result={authority_revision:42,current_publication:{publication_id:PUB},
       projection_status:'current',latest_projection:{projection_id:'84000000-0000-4000-8000-000000000001'}};
      if(snapshots>1&&change==='publication')result.current_publication.publication_id='82000000-0000-4000-8000-000000000002';
      if(snapshots>1&&change==='revision')result.authority_revision=43;
      if(change==='retained-snapshot'){
       if(snapshots===1)firstSnapshot=result;
       else result=clone(firstSnapshot);
      }
     }else if(sql.includes('static_weekly_read_approved_template_confirmation')){
      assert.deepEqual(args,[MID,KEY]);result=null;
     }else if(sql.includes('static_weekly_read_approved_template_basis')){
      assert.deepEqual(args,[MID,PUB,'2026-10-06','DATED_ABSENCE',requestedTemplate,42]);basisReads++;result=clone(basis);
      if(basisReads>1){
       if(change==='generation')result.generation++;
       if(change==='source')result.currentSource.exceptions[0].reason+=' changed';
       if(change==='missing')result=null;
       if(change==='credential')manager.credential_id='85000000-0000-4000-8000-000000000002';
       if(change==='device')manager.device_id='UNIT-other-device';
       if(change==='abort')controller.abort();
       if(change==='retained-snapshot')firstSnapshot.current_publication.publication_id='82000000-0000-4000-8000-000000000002';
      }
     }else assert.fail('Unexpected recording SQL '+sql);
     await Promise.resolve();return {rows:[{result}]};
    }
    release(){checkedOut--;released++;assert.equal(checkedOut,0);}
    async end(){}
   }
   const cp=creator({database:{async connect(){checkedOut++;return new Client();},async end(){ended++;assert.equal(checkedOut,0);}},
    compiler:()=>{throw Error('NO_SOLVER');},compilerPreparer:()=>{throw Error('NO_SOLVER');},shutdownCompiler:async()=>{}});
   let value,error;
   try{
    const deadlineAt=performance.now()+20000,method=confirm?'confirmApprovedStaticPattern':'previewApprovedStaticPattern';
    value=await cp.runManagerOperation({manager,signal:controller.signal,deadlineAt,permission:'write'},()=>cp[method]({manager,
     publicationId:PUB,serviceDate:'2026-10-06',kind:'DATED_ABSENCE',templateId:requestedTemplate,expectedRevision:42,
     previewDigest:'a'.repeat(64),idempotencyKey:KEY,signal:controller.signal,deadlineAt}));
   }catch(failure){error=failure;}
   finally{await cp.close();assert.equal(checkedOut,0);assert.equal(ended,1);assert.equal(released,1);}
   assert.equal(calls.some(c=>c.sql.includes('static_weekly_materialize_approved_template')),false);
   return {value,error,calls,basisReads,snapshots,actorReads};
  }
  if(process.argv.includes('--approved-dated-unresolved-snapshot-guard-only')){
   const refused=await journey('retained-snapshot');assert.equal(refused.value,undefined);
   assert.equal(refused.error?.code,'static_template_unresolved_source_changed');
   assert.equal(refused.calls.at(-1).sql,'rollback');
   console.log(JSON.stringify({checks:1,scope:'NEW original snapshot detached before preparation awaits; recording port late-object mutation refused',
    previous24Replayed:0,SQL:'NOT_RUN',resources0:true}));process.exit(0);
  }
  const first=await journey();
  assert.equal(first.error,undefined,'genuine local unresolved failure must reach the current preview response');
  assert.deepEqual(Object.keys(first.value).sort(),['schema','status','sourcePublicationId','authorityRevision','serviceDate','kind','templateId','unresolved'].sort());
  const context={};runInNewContext(readFileSync(new URL('../../frontend/memphis-approved-schedule.js',import.meta.url),'utf8'),context);
  const binding={sourcePublicationId:PUB,authorityRevision:42,serviceDate:'2026-10-06',kind:'DATED_ABSENCE',templateId:null},
   accepted=context.MemphisApprovedSchedule.validateUnresolvedPreview(first.value,binding);
  assert.equal(accepted.status,'UNRESOLVED');assert.equal(first.basisReads,2);assert.equal(first.snapshots,2);assert.equal(first.actorReads,4);
  assert.ok(first.value.unresolved.some(row=>row.reason==='NO_ELIGIBLE_INTERVAL_OWNER'&&row.window.start==='16:30'));
  assert.ok(Object.isFrozen(first.value)&&Object.isFrozen(first.value.unresolved)&&Object.isFrozen(first.value.unresolved[0].window));
  assert.equal(first.calls.at(-1).sql,'commit');checks++;console.log('PASS NEW genuine preparation -> current preview -> exact frontend validator (no approval)');
  const selected=await journey('none',false,templateId);assert.equal(selected.error,undefined);assert.equal(selected.value.templateId,templateId);checks++;
  const confirm=await journey('none',true);assert.equal(confirm.error?.code,'static_template_dated_coverage_unresolved');
  assert.equal(confirm.value,undefined);assert.equal(confirm.basisReads,1);assert.equal(confirm.calls.at(-1).sql,'rollback');checks++;
  for(const change of ['source','generation','missing','publication','revision','credential','device','revoked','abort']){
   const refused=await journey(change);assert.equal(refused.value,undefined,change);assert.ok(refused.error,change);
   assert.equal(refused.calls.some(c=>c.sql==='commit'),false,change);assert.equal(refused.calls.at(-1).sql,'rollback',change);checks++;
  }
  // Component extraction uses the exact shipping checker, not a substitute
  // serializer or an accepting authority callback. Only malformed DATA changes.
  const start=sourceText.indexOf('  function approvedStaticUnresolvedPreview('),end=sourceText.indexOf('\n  async function approvedStaticPreparation',start),
   {types}=await import('node:util'),checker=runInNewContext('('+sourceText.slice(start,end).trim()+')',
    {types,Object,Array,Set,Map,Number,String,Date,Reflect,postgresJsonbContentDigest,canonicalJson,clone,
     prepareStaticWeeklySchedulingProblem,fail:code=>Object.assign(new Error(code),{code})});
  let genuine;try{prepareApprovedStaticTemplateProjection(next);}catch(error){genuine=error;}
  const wire=clone(next.currentSource);wire.serviceDate='2026-10-05';wire.versions=[wire.version];delete wire.version;
  const target=prepareStaticWeeklySchedulingProblem(wire),checkerArgs={basis:{ownerConfig:next.currentOwnerConfig},target,choice:next.templates[0],
   selection:next.selection,publicationId:PUB,date:'2026-10-06',templateId:null,revision:42,deadlineAt:performance.now()+20000};
  const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
  const corruptions=[v=>{v.operationDate='2026-10-07';},v=>{v.currentWeekSourceDigest='f'.repeat(64);},
   v=>{v.unresolved[0].parentWorkId='foreign';},v=>{v.unresolved[0].reason='<private arbitrary error>';},
   v=>{v.unresolved[0].originalBudget++;},v=>{v.unresolved[0].requiredSegments=1;},
   v=>{v.unresolved[0].window.end='23:59';},v=>{v.selectedAssignments=[];},
   v=>{v.parentReferences[0].currentPersonId=MID;},v=>{v.selectedAvailability[0].personId=MID;},
   v=>{v.unresolved[0].window.start=' 16:30';}];
  for(const change of corruptions){const value=clone(genuine.unresolved);change(value);const error=Object.assign(Error('UNIT private message'),{code:genuine.code});
   Object.defineProperty(error,'unresolved',{value:freeze(value)});
   assert.throws(()=>checker(error,checkerArgs),{code:'static_template_unresolved_preview_invalid'});checks++;
  }
  let accessed=0;const accessor=clone(genuine.unresolved);Object.defineProperty(accessor.unresolved[0],'reason',{get(){accessed++;return 'NO_ELIGIBLE_INTERVAL_OWNER';},enumerable:true});
  // Freeze without invoking the malicious property.
  const freezeDescriptors=v=>{if(v&&typeof v==='object'){for(const d of Object.values(Object.getOwnPropertyDescriptors(v)))if('value'in d)freezeDescriptors(d.value);Object.freeze(v);}return v;};
  const accessorError=Error('UNIT private');Object.defineProperty(accessorError,'unresolved',{value:freezeDescriptors(accessor)});
  assert.throws(()=>checker(accessorError,checkerArgs),{code:'static_template_unresolved_preview_invalid'});assert.equal(accessed,0);checks++;
  console.log(JSON.stringify({checks,scope:'NEW actual approved preparation/preview and strict diagnostic/currentness Source recording only',
   SQL:'NOT_RUN',genuineManager:false,browser:false,solver:false,oldGroups:0,pendingStaffingCommandJoin:'MAIN_OWNED_NOT_PROVEN',resources0:true}));process.exit(0);
 }
 if(process.argv.includes('--approved-dated-partial-native-consumer-only')||process.argv.includes('--approved-dated-partial-native-source-only')){
  const sourceOnly=process.argv.includes('--approved-dated-partial-native-source-only');
  const gregory=ownerConfig.slots.GREGORY.slotId;
  const partial=(next,start,end,n)=>{
   next.currentSource.version.slotAvailability.find(a=>a.dayOfWeek===2&&a.slotId===gregory).maxDutyMinutes=360;
   next.currentSource.exceptions.push({...clone(next.currentSource.exceptions[0]),id:'UNIT-V5-partial-'+n,idempotencyKey:'UNIT-V5-partial-'+n,sequence:2+n,
    type:'partial_absence',payload:{slotId:gregory},window:{start,end}});
  };
  const verifyCovered=(next,windows,expectedSegments)=>{
   const before=canonicalJson(next),out=prepareApprovedStaticTemplateProjection(next),projection=out.datedAbsence.projection,
    selected=projection.authority.shiftEndDerivation.selected;
   assert.equal(selected.schema,'custodial.approved-dated-mapped-shift-end-derivation.v1');
   for(const reference of selected.parentReferences.filter(r=>r.originalOwnerSlotId===gregory)){
    const chain=selected.parentChains.find(c=>c.parentWorkId===reference.parentWorkId).segments;
    assert.equal(chain.length,expectedSegments);assert.equal(chain[0].workId,reference.parentWorkId);assert.equal(chain[0].originSlotId,gregory);
    let cursor=reference.mappedParent.window.start;
    for(const row of chain){
     assert.equal(row.window.start,cursor);cursor=row.window.end;
     assert.ok(Number.isSafeInteger(row.serviceEffortMinutes)&&row.serviceEffortMinutes>0);
     const available=selected.selectedAvailability.find(a=>a.slotId===row.ownerSlotId);
     assert.ok(available.personId&&!available.vacant);assert.ok(available.availability.shift.start<=row.window.start&&row.window.end<=available.availability.shift.end);
     assert.ok(!(available.availability.blockedWindows||[]).some(w=>w.start<row.window.end&&row.window.start<w.end));
     if(row.ownerSlotId!==gregory)assert.ok(!(available.availability.lunch.start<row.window.end&&row.window.start<available.availability.lunch.end));
     assert.deepEqual(row.includedLocations,reference.mappedParent.includedLocations);
    }
    assert.equal(cursor,selected.continuity.staffedDeparture);
    assert.equal(chain.reduce((sum,r)=>sum+r.serviceEffortMinutes,0),reference.originalParent.serviceEffortMinutes);
    for(const window of windows){
     assert.ok(chain.some(r=>r.window.start===window.start&&r.window.end===window.end&&r.ownerSlotId!==gregory));
     assert.ok(chain.some(r=>r.window.start===window.end&&r.ownerSlotId===gregory),'Nominal original owner returns immediately when available');
    }
   }
   const original=prepareStaticWeeklySchedulingProblem({...clone(next.currentSource),serviceDate:'2026-10-05',versions:[clone(next.currentSource.version)]});
   assert.equal(original.error,undefined);
   assert.deepEqual(out.overlayCompilerInput.version.assignments.filter(r=>r.dayOfWeek!==2),original.derivedBaselineCanonicalInput.version.assignments.filter(r=>r.dayOfWeek!==2));
   assert.deepEqual(projection.authority.originalCompilerInput,next.currentSource);assert.equal(canonicalJson(next),before);
   assert.equal(projection.week_start,'2026-10-05');assert.equal(projection.week_end,'2026-10-11');
   assert.equal(out.datedAbsence.lunchDocument.week_start,'2026-10-05');
   return selected;
  };
  if(!sourceOnly){
  const middle=clone(input);partial(middle,'10:00','10:15',1);verifyCovered(middle,[{start:'10:00',end:'10:15'}],3);
  const two=clone(input);partial(two,'09:50','10:00',1);partial(two,'10:05','10:10',2);
  verifyCovered(two,[{start:'09:50',end:'10:00'},{start:'10:05',end:'10:10'}],5);
  const insufficient=clone(input);
  for(const value of [insufficient.templates[0].source,insufficient.currentSource])value.version.assignments.find(r=>r.workId==='UNIT-2-GREGORY-0').serviceEffortMinutes=2;
  insufficient.admittedBindings[0].sourceDigest=contentDigest(insufficient.templates[0].source);
  insufficient.admittedBindings[0].artifactSha256=sha(JSON.stringify(insufficient.templates[0].source));
  partial(insufficient,'10:00','10:15',1);let failure;
  try{prepareApprovedStaticTemplateProjection(insufficient);}catch(error){failure=error;}
  assert.equal(failure?.code,'static_template_dated_coverage_unresolved');
  assert.ok(failure.unresolved.unresolved.some(r=>r.parentWorkId==='UNIT-2-GREGORY-0'&&r.reason==='ORIGINAL_BUDGET_INSUFFICIENT_FOR_POSITIVE_SEGMENTS'&&r.originalBudget===2&&r.requiredSegments===3));
  assert.equal(Object.hasOwn(failure.unresolved,'selectedAssignments'),false);
  }
  const sql=readFileSync(new URL('../proposals/approved-static-dated-absence-materializer.sql',import.meta.url),'utf8'),
   native=sql.slice(sql.indexOf('CREATE FUNCTION public.static_weekly_approved_dated_assert_closing('),sql.indexOf('CREATE FUNCTION public.static_weekly_assert_approved_dated_projection('));
  assert.equal(splitSchemaStatements(sql).statements.length,10);
  assert.doesNotMatch(native,/partial-interval native consumer is not qualified/);
  for(const exact of ['partial_active:=EXISTS','nominal_units:=units','lead(t) OVER','interval_units:=','desired_owner:=span',
   "p.value->'vacant'='false'::jsonb","b->>'start'<to_time AND from_time<b->>'end'",'p.key=original_owner AND flexible',
   'NOT flexible AND jsonb_array_length','last_segment->>','serviceEffortMinutes\')::numeric',
   'Dated partial interval has no eligible original or borrowed owner','Dated partial locked original owner is unavailable',
   'Dated partial chain loses an original interval','Dated closing exact positive integer budget differs'])assert.ok(native.includes(exact),exact);
  assert.ok(native.indexOf("EXCEPT ALL SELECT value FROM jsonb_array_elements(selected->'selectedAssignments')")>native.indexOf('units:=interval_units'),'Supplied plan DATA is compared after native reconstruction (initial bounded shape check remains before it)');
  assert.doesNotMatch(native,/INSERT INTO|UPDATE public\.|DELETE FROM|SECURITY DEFINER/);
  console.log(JSON.stringify({scope:'NEW partial native consumer Source contract + actual serializer multi-interval/budget boundary',
   actualSerializerCoveredCases:sourceOnly?0:2,actualSerializerBudgetRefusals:sourceOnly?0:1,nativeSourceContractChecks:1,SQL:'NOT_RUN',
   oldV4CasesReplayed:0,task7ChecksReplayed:0,resources0:true}));process.exit(0);
 }
 if(process.argv.includes('--approved-dated-closing-partial-covered-only')){
  const gregory=ownerConfig.slots.GREGORY.slotId,next=clone(input);
  next.currentSource.version.slotAvailability.find(a=>a.dayOfWeek===2&&a.slotId===gregory).maxDutyMinutes=360;
  next.currentSource.exceptions.push({...clone(next.currentSource.exceptions[0]),id:'UNIT-partial-start',idempotencyKey:'UNIT-partial-start',sequence:3,
   type:'partial_absence',payload:{slotId:gregory},window:{start:'09:45',end:'10:00'}});
  const before=canonicalJson(next),out=prepareApprovedStaticTemplateProjection(next),projection=out.datedAbsence.projection,
   selected=projection.authority.shiftEndDerivation.selected;
  assert.equal(selected.schema,'custodial.approved-dated-mapped-shift-end-derivation.v1');
  const parent=selected.parentReferences.find(r=>r.originalOwnerSlotId===gregory),chain=selected.parentChains.find(r=>r.parentWorkId===parent.parentWorkId);
  const first=chain.segments[0];assert.equal(first.workId,parent.parentWorkId);assert.equal(first.originSlotId,gregory);assert.notEqual(first.ownerSlotId,gregory);
  assert.equal(first.window.start,'09:45');assert.equal(first.window.end,'10:00');
  assert.equal(projection.assignments.find(r=>r.plan_work_id==='2:'+first.workId).owner_slot_id,first.ownerSlotId);
  assert.ok(chain.segments.some(r=>r.window.start==='10:00'&&r.ownerSlotId===gregory));
  assert.equal(chain.segments.reduce((n,r)=>n+r.serviceEffortMinutes,0),parent.originalParent.serviceEffortMinutes);
  assert.equal(canonicalJson(next),before);assert.deepEqual(projection.authority.originalCompilerInput,next.currentSource);
  const sql=readFileSync(new URL('../proposals/approved-static-dated-absence-materializer.sql',import.meta.url),'utf8');
  assert.match(sql,/partial_active:=EXISTS/);
  console.log(JSON.stringify({scope:'Retained partial covered serializer component; native consumer Source now independently reconstructs intervals',
   checks:1,SQL:'NOT_RUN',nativePartialInterval:'SOURCE_ONLY_NOT_QUALIFIED',originalCoveredCase:'NOT_REPLAYED',task7ChecksReplayed:0,oldGroups:0,resources0:true}));process.exit(0);
 }
 if(process.argv.includes('--approved-dated-closing-unresolved-only')){
  const gregory=ownerConfig.slots.GREGORY.slotId,next=clone(input);
  next.currentSource.version.slotAvailability.find(a=>a.dayOfWeek===2&&a.slotId===gregory).maxDutyMinutes=360;
  next.currentSource.exceptions.push({...clone(next.currentSource.exceptions[0]),id:'UNIT-partial-tail',idempotencyKey:'UNIT-partial-tail',sequence:3,
   type:'partial_absence',payload:{slotId:gregory},window:{start:'16:30',end:'17:00'}});
  const before=canonicalJson(next);let failure;
  try{prepareApprovedStaticTemplateProjection(next);}catch(error){failure=error;}
  assert.equal(failure?.code,'static_template_dated_coverage_unresolved');
  const unresolved=failure.unresolved;
  assert.equal(unresolved.schema,'custodial.approved-dated-mapped-shift-end-unresolved.v1');assert.equal(unresolved.status,'UNRESOLVED');
  assert.equal(unresolved.operationDate,'2026-10-06');assert.ok(unresolved.unresolved.length>0);
  assert.ok(unresolved.unresolved.some(row=>row.window.start==='16:30'&&row.window.end==='17:00'&&row.reason==='NO_ELIGIBLE_INTERVAL_OWNER'));
  for(const key of ['selectedAssignments','effectiveInput','parentChains','continuity'])assert.equal(Object.hasOwn(unresolved,key),false);
  assert.equal(Object.hasOwn(failure,'sourcePublicationId'),false);assert.equal(Object.hasOwn(failure,'authorityRevision'),false);
  assert.ok(Object.isFrozen(unresolved)&&Object.isFrozen(unresolved.unresolved[0]));
  assert.equal(Object.getOwnPropertyDescriptor(failure,'unresolved').writable,false);
  assert.equal(canonicalJson(next),before);
  const sourceText=readFileSync(new URL('../src/static-weekly-recurring-staffing-adaptation.js',import.meta.url),'utf8');
  assert.ok(sourceText.indexOf("if(selected?.schema==='custodial.approved-dated-mapped-shift-end-unresolved.v1')")<sourceText.indexOf('const effective=structuredClone(original.derivedBaselineCanonicalInput)'));
  console.log(JSON.stringify({scope:'NEW actual serializer preserves exact frozen unresolved DATA and stops before model/projection',
   checks:1,SQL:'NOT_RUN',coveredCase:'NOT_REPLAYED',task7ChecksReplayed:0,oldGroups:0,resources0:true}));process.exit(0);
 }
 if(process.argv.includes('--approved-dated-closing-refusals-only')){
  let checks=0;
  const refuse=(mutate,code)=>{const next=clone(input);mutate(next);assert.throws(()=>prepareApprovedStaticTemplateProjection(next),{code});checks++;};
  refuse(c=>{c.currentSource.exceptions[0].baseVersionId='foreign-original';},'static_template_dated_week_source_unavailable');
  refuse(c=>{c.templates[0].source.version.assignments[0].originSlotId=substitute;},'static_template_not_independently_admitted');
  refuse(c=>{c.currentSource.exceptions.push({...clone(c.currentSource.exceptions[0]),id:'UNIT-lock',idempotencyKey:'UNIT-lock',sequence:3,
   type:'manager_correction',payload:{locks:[{workId:'UNIT-2-KAILI-0',slotId:substitute}]}});},'static_template_dated_closing_work_overlay_unsupported');
  const sql=readFileSync(new URL('../proposals/approved-static-dated-absence-materializer.sql',import.meta.url),'utf8');
  for(const key of ['parentReferences','selectedAvailability','selectedAssignments','parentChains','handoffs','openResponsibilities']){
   assert.ok(sql.includes("selected->'"+key+"'"),'Independent typed '+key+' validation exists');
  }
  assert.match(sql,/compilerInput',p_baseline,'overlayCompilerInput',p_closing->'originalDerivedInput'/);
  assert.match(sql,/Dated closing exact native catalog parent references differ/);
  assert.match(sql,/Dated closing independently reconstructed chain output differs/);
  assert.match(sql,/Dated closing segment conflicts with actual accepted availability/);
  console.log(JSON.stringify({scope:'NEW actual dated serializer refusal controls + native-validator refusal Source',
   actualSerializerRefusals:checks,SQL:'NOT_RUN',positiveClosingCase:'NOT_REPLAYED',task7ChecksReplayed:0,oldGroups:0,resources0:true}));process.exit(0);
 }
 const before=canonicalJson(input),out=prepareApprovedStaticTemplateProjection(input),projection=out.datedAbsence.projection,
  closing=projection.authority.shiftEndDerivation;
 assert.equal(canonicalJson(input),before);assert.equal(closing.schema,'custodial.approved-static-dated-closing.v1');
 assert.equal(closing.selected.schema,'custodial.approved-dated-mapped-shift-end-derivation.v1');
 assert.equal(closing.selected.operationDate,'2026-10-06');assert.ok(closing.selected.handoffs.length>0);
 const reference=closing.selected.parentReferences.find(r=>r.originalOwnerSlotId===kaili);
 assert.equal(reference.mappedOwnerSlotId,substitute);assert.equal(reference.mappedParent.originSlotId,kaili);
 assert.equal(reference.currentPersonId,person);
 const wire=clone(current);wire.serviceDate='2026-10-05';wire.versions=[wire.version];delete wire.version;
 const original=prepareStaticWeeklySchedulingProblem(wire);assert.equal(original.error,undefined);
 const pre=normalizeStaticWeeklyAuthority(original.baselineCanonicalInput.version,original.baselineCanonicalInput.slots,
  original.canonicalInput.exceptions,original.baselineCanonicalInput.proximity,original.serviceDate);
 assert.equal(closing.selected.originalWeekSourceDigest,postgresJsonbContentDigest(pre));
 assert.deepEqual(closing.originalReceipt,original.shiftEndDerivation);assert.deepEqual(closing.originalDerivedInput,original.derivedBaselineCanonicalInput);
 assert.deepEqual(projection.authority.compilerInput,original.baselineCanonicalInput);assert.deepEqual(projection.authority.originalCompilerInput,current);
 assert.deepEqual(projection.authority.originalWeekCompilerInput,original.canonicalInput);
 assert.deepEqual(out.overlayCompilerInput.version.assignments.filter(r=>r.dayOfWeek!==2),original.derivedBaselineCanonicalInput.version.assignments.filter(r=>r.dayOfWeek!==2));
 assert.equal(projection.week_start,'2026-10-05');assert.equal(projection.week_end,'2026-10-11');
 assert.equal(out.datedAbsence.lunchDocument.week_start,'2026-10-05');assert.ok(out.datedAbsence.lunchDocument.loans.length>0);
 assert.deepEqual(projection.applied_exceptions,original.applied);assert.equal(out.solverInvoked,false);assert.equal(out.optimized,false);
 assert.equal(Object.hasOwn(out,'recurringStaffing'),false);assert.equal(Object.hasOwn(out,'initialBaseline'),false);
 const sql=readFileSync(new URL('../proposals/approved-static-dated-absence-materializer.sql',import.meta.url),'utf8');
 assert.equal(splitSchemaStatements(sql).statements.length,10);
 for(const text of ['Dated closing exact native catalog parent references differ','Dated closing selected availability is not actual original day',
  'Dated whole derived week differs from original six days plus selected chain','Dated closing segment conflicts with actual accepted availability',
  'Dated closing independently reconstructed chain output differs','Dated closing accepted applied commands differ'])assert.ok(sql.includes(text),text);
 assert.match(sql,/'compilerInput',p_baseline,'overlayCompilerInput',p_closing->'originalDerivedInput'/);
 assert.doesNotMatch(sql,/compilerInput',p_closing->'mappedInput','overlayCompilerInput'/);
 console.log(JSON.stringify({scope:'NEW actual dated serializer to typed closing DATA and independent validator refusal Source',
  serializerChecks:1,sqlRefusalSourceChecks:1,typedSelectedParents:closing.selected.parentReferences.length,
  typedSelectedSegments:closing.selected.selectedAssignments.length,unchangedOriginalDerivedDays:6,
  SQL:'NOT_RUN',realApproval:false,solverRuns:0,oldGroups:0,task7ChecksReplayed:0,resources0:true}));process.exit(0);
}
if(process.argv.includes('--approved-dated-lock-target-lineage-only')){
 const sql=readFileSync(new URL('../proposals/approved-static-dated-absence-materializer.sql',import.meta.url),'utf8'),
  guard=sql.indexOf("MESSAGE='Dated accepted lock lost its exact mapped work target'");
 assert.ok(guard<0,'This refusal is an ordinary RAISE, not a new configurable permission/message handler');
 const start=sql.indexOf('IF EXISTS(SELECT 1 FROM jsonb_each(locks) l WHERE NOT EXISTS('),
  refusal=sql.indexOf("THEN RAISE EXCEPTION 'Dated accepted lock lost its exact mapped work target'",start),
  filter=sql.indexOf("WHERE w->'_datedCancelled'='false'::jsonb",refusal);
 assert.ok(start>0&&refusal>start&&filter>refusal);
 assert.ok(sql.slice(start,refusal).includes("(w->>'dayOfWeek')||':'||(w->>'workId')=l.key"));
 console.log(JSON.stringify({scope:'NEW original lock target cannot disappear through regrouping before cancelled filtering',checks:1,
  sourceSha256:createHash('sha256').update(sql).digest('hex'),nativeSQL:'NOT_RUN',previous_overlay_checks:'NOT_REPLAYED',resources0:true}));process.exit(0);
}
if(process.argv.includes('--approved-dated-accepted-overlays-only')||process.argv.includes('--approved-dated-reassignment-only')){
 const reassignmentOnly=process.argv.includes('--approved-dated-reassignment-only');
 const {prepareStaticWeeklySchedulingProblem}=await import('../src/static-weekly-schedule-program.js');
 const {canonicalJson}=await import('../src/static-weekly-schedule-model.js');
 const {splitSchemaStatements}=await import('./isolated-event-owner-schema.mjs');
 const sha=value=>createHash('sha256').update(value).digest('hex'),clone=structuredClone;
 installStaticWeeklySha256HexAccelerator(sha);
 const sql=readFileSync(new URL('../proposals/approved-static-dated-absence-materializer.sql',import.meta.url),'utf8'),
  // Exact V2 Source predicate (cbb50402), not a runtime SQL reproduction.
  predecessor="WHERE e->>'type' NOT IN('pto','daily_absence','partial_absence','lunch','shift_override')",
  mapper=readFileSync(new URL('../src/static-weekly-recurring-staffing-adaptation.js',import.meta.url),'utf8');
 let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS NEW overlay component',name);};
 if(!reassignmentOnly)check('predecessor refuses all work commands; new reconstruction binds actual immutable accepted provenance',()=>{
  assert.match(predecessor,/NOT IN\('pto','daily_absence','partial_absence','lunch','shift_override'\)/);
  const start=sql.indexOf('CREATE FUNCTION public.static_weekly_approved_dated_effective_work('),
   end=sql.indexOf('END $effective_work$;',start),body=sql.slice(start,end);
  assert.equal(splitSchemaStatements(sql).statements.length,9);
  for(const text of ['SELECT * INTO STRICT command FROM public.weekly_schedule_exception_commands',
   'command.payload_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(command.payload_json)',
   'command.authority_revision>current_revision','e->\'sequence\' IS DISTINCT FROM to_jsonb(command.authority_revision)',
   'r.reverses_exception_id=c.exception_id','Dated original lock duplicate or target differs',
   'Dated original event duplicate or overlapping target differs','Dated effective work current original Source changed'])assert.ok(body.includes(text),text);
  assert.match(body,/p_source->'exceptions' IS DISTINCT FROM accepted/);
  assert.match(body,/p_source#>>'\{version,id\}'/);
  assert.doesNotMatch(body,/custodial_held|events_app_events|INSERT INTO|UPDATE public\.|DELETE FROM|SECURITY DEFINER/);
  assert.match(sql,/static_weekly_approved_dated_effective_work\(uuid,date,jsonb\)/);
 });
 const retained=loadSixPersonAbsenceSource(),original=clone(retained.compilerInput),source=clone(original);
 const prepare=input=>{
  const wire=clone(input);wire.versions=[wire.version];delete wire.version;
  const problem=prepareStaticWeeklySchedulingProblem(wire);assert.equal(problem.error,undefined,JSON.stringify(problem.error));return problem;
 };
 const day=2,date='2026-10-06',version=source.version;
 const usable=version.assignments.filter(w=>w.dayOfWeek===day&&w.serviceEffortMinutes>1&&w.priority>=0
  &&w.required!==false&&(!w.serviceMode||w.serviceMode==='scan_tracked'));
 assert.ok(usable.length>=3);
 const [removed,patched,addedFrom]=usable;
 const payloadWork=w=>Object.fromEntries(['workId','locationId','locationCodeSnapshot','locationNameSnapshot','window',
  'serviceEffortMinutes','serviceEffortProvenance','priority','priorityProvenance','requiredQualifications',
  'qualificationProvenance','restrictions','restrictionProvenance',
  ...['serviceMode','includedLocations'].filter(k=>Object.hasOwn(w,k))].map(k=>[k,clone(w[k])]));
 const command=(id,type,payload,sequence=1)=>({id,type,payload,sequence,serviceDate:date,
  baseVersionId:version.id,publicationId:version.publicationId,actorId:'synthetic-overlay-component-manager',
  reason:'Synthetic accepted-command DATA for pure compiler semantics only',idempotencyKey:id,expectedRevision:40,status:'accepted'});
 const patch=payloadWork(patched);patch.serviceEffortMinutes--;
 const added={...payloadWork(addedFrom),workId:'synthetic-dated-added-work',dayOfWeek:day,originSlotId:addedFrom.originSlotId||addedFrom.ownerSlotId};
 const event=command('synthetic-dated-event','event_impact',{removeWorkIds:[removed.workId],patchWork:[patch],addWork:[added]});
 const before=clone(source),withEvent=clone(source);withEvent.exceptions=[event];
 let baseline,eventProblem;
 if(reassignmentOnly){
  check('accepted lock lifts the compiler baseline-owner constraint, not other eligibility or original Source ownership',()=>{
   const baseline=prepare(source),alternative=baseline.candidates.find(c=>c.item.dayOfWeek===day&&c.slot.id!==c.item.ownerSlotId);
   assert.equal(alternative,undefined,'Ordinary unmodified Source pins baseline ownership before the explicit lock');
   const original=baseline.work.find(w=>w.key===day+':'+patched.workId),
    currentOtherSlot=baseline.slots.find(slot=>slot.id!==original.ownerSlotId&&baseline.availabilityByDaySlot.has(day+'\u0000'+slot.id));
   assert.ok(currentOtherSlot,'Use an actual current available Source slot, not an invented employee');
   const locked=clone(source),workId=original.workId,slotId=currentOtherSlot.id;
   locked.exceptions=[command('synthetic-original-reassignment','manager_correction',{locks:[{workId,slotId}]})];
   const problem=prepare(locked),key=day+':'+workId,work=problem.work.find(w=>w.key===key);
   assert.notEqual(slotId,work.ownerSlotId);assert.equal(work.manualLock,slotId);
   assert.equal(work.custodialCoverageMode,'zoo_employee_baseline');
   assert.ok(baseline.staticRejections.get(key).find(r=>r.slotId===slotId)?.reasons.some(r=>r.code==='baseline_owner_required'));
   assert.deepEqual([...new Set(problem.candidates.filter(c=>c.item.key===key).map(c=>c.slot.id))],[slotId]);
   assert.deepEqual(locked.version,source.version);assert.deepEqual(locked.slots,source.slots);
   assert.match(sql,/work->'ownerSlotId' IS DISTINCT FROM work->'_datedManualLock'/);
  });
  console.log(JSON.stringify({scope:'NEW original manual-lock reassignment pure compiler component',checks,sourceSha256:sha(sql),
   nativeSQL:'NOT_RUN',approvedMappingReassignment:'NOT_RUN',mappingOrPublicationAuthority:false,
   previous_6_checks:'NOT_REPLAYED',resources0:true}));process.exit(0);
 }
 check('real pure compiler applies remove patch add without altering raw source or six other days',()=>{
  baseline=prepare(source);eventProblem=prepare(withEvent);
  assert.deepEqual(source,before);assert.deepEqual(withEvent.version,source.version);
  assert.equal(eventProblem.work.some(w=>w.dayOfWeek===day&&w.workId===removed.workId),false);
  assert.equal(eventProblem.work.find(w=>w.dayOfWeek===day&&w.workId===patched.workId).serviceEffortMinutes,patch.serviceEffortMinutes);
  const addedWork=eventProblem.work.find(w=>w.workId===added.workId);assert.equal(addedWork.overlayWork,true);
  assert.equal(addedWork.originSlotId,added.originSlotId);
  assert.deepEqual(eventProblem.work.filter(w=>w.dayOfWeek!==day),baseline.work.filter(w=>w.dayOfWeek!==day));
  assert.deepEqual(eventProblem.baselineCanonicalInput,baseline.baselineCanonicalInput);
  assert.deepEqual(eventProblem.applied.map(e=>e.id),[event.id]);
 });
 check('held command DATA cannot change work; stale publication/version DATA is refused',()=>{
  const held=clone(withEvent);held.exceptions[0].status='held';const ignored=prepare(held);
  assert.deepEqual(ignored.work,baseline.work);assert.deepEqual(ignored.applied,[]);
  for(const key of ['baseVersionId','publicationId']){
   const stale=clone(withEvent);stale.exceptions[0][key]='foreign-original';
   const wire=clone(stale);wire.versions=[wire.version];delete wire.version;
   const result=prepareStaticWeeklySchedulingProblem(wire);assert.ok(result.error||false,'Stale '+key+' must refuse');
  }
 });
 check('manual locks constrain existing candidates rather than rewriting original work ownership',()=>{
  const locked=clone(source),slot=patched.ownerSlotId;
  locked.exceptions=[command('synthetic-original-lock','manager_correction',{locks:[{workId:patched.workId,slotId:slot}]})];
  const problem=prepare(locked),key=day+':'+patched.workId,work=problem.work.find(w=>w.key===key);
  assert.equal(work.manualLock,slot);assert.equal(work.ownerSlotId,patched.ownerSlotId);
  const candidates=problem.candidates.filter(c=>c.item.key===key);assert.ok(candidates.length>0);
  assert.deepEqual([...new Set(candidates.map(c=>c.slot.id))],[slot]);
  assert.deepEqual(locked.version,source.version);
 });
 check('actual approved mapper coverage boundary rejects a changed domain instead of inventing event approval',()=>{
  // Invoke the EXACT private pure coverage helper from the sealed producer,
  // not an accepting getStatus/normalizer or a new admitted-binding fixture.
  const begin=mapper.indexOf('function coverageDomain(problem) {'),end=mapper.indexOf('\n  const coverage = coverageDomain(approved);',begin);
  assert.ok(begin>0&&end>begin);
  const coverage=runInNewContext('('+mapper.slice(begin,end)+')',{canonicalJson,scopeDays:[day],selection:{kind:'RECURRING_STAFFING'},date,sorted:x=>[...x].sort(),
   require:(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});}});
  assert.notEqual(canonicalJson(coverage(baseline)),canonicalJson(coverage(eventProblem)));
  assert.match(mapper,/require\(canonicalJson\(coverage\) === canonicalJson\(coverageDomain\(target\)\), 'static_template_current_coverage_incompatible'\)/);
  assert.match(sql,/Dated accepted event requires a compatible approved physical domain/);
 });
 check('all downstream checks consume effective work, preserving original source and lock/overlay lineage',()=>{
  const begin=sql.indexOf('CREATE FUNCTION public.static_weekly_assert_approved_dated_projection('),
   end=sql.indexOf('END $validation$;',begin),validate=sql.slice(begin,end),lunch=sql.slice(sql.indexOf('CREATE FUNCTION public.static_weekly_assert_approved_dated_lunch('));
  assert.match(validate,/effective_original:=public.static_weekly_approved_dated_effective_work/);
  assert.doesNotMatch(validate,/jsonb_array_elements\(authority#>'\{overlayCompilerInput,version,assignments\}'\)/);
  assert.match(validate,/work->'ownerSlotId' IS DISTINCT FROM work->'_datedManualLock'/);
  assert.match(validate,/'manualLockSlotId',work->'_datedManualLock','overlayWork',work->'_datedOverlayWork'/);
  assert.match(validate,/IF work->'_datedOverlayWork'='false'::jsonb THEN/);
  assert.match(lunch,/JOIN jsonb_array_elements\(effective_work\) w/);
  assert.match(validate,/original_rows IS DISTINCT FROM unaffected OR mapped_rows IS DISTINCT FROM expected_rows/);
  assert.doesNotMatch(sql,/^GRANT |INSERT INTO public\.weekly_schedule_exception_commands|UPDATE public\.weekly_schedule_versions/m);
 });
 console.log(JSON.stringify({scope:'NEW accepted work-overlay Source + actual pure compiler/domain component',checks,
  sourceSha256:sha(sql),retainedFixture:retained.fixtureSha256,nativeSQL:'NOT_RUN',solver_runs:0,
  currentEventApproval:false,physicalCoverageProducer:'INCOMPATIBLE_DOMAINS_REFUSED; NO_APPROVED_EVENT_MAPPING_PRODUCER_IN_THIS_CONTRACT',
  old_checks_replayed:0,resources0:true}));process.exit(0);
}

if(process.argv.includes('--approved-dated-semantic-writer-source-only')||process.argv.includes('--approved-dated-regroup-lineage-source-only')){
 const file=new URL('../proposals/approved-static-dated-absence-materializer.sql',import.meta.url);
 const sql=readFileSync(file,'utf8'),sha=s=>createHash('sha256').update(s).digest('hex');
 const {splitSchemaStatements}=await import('./isolated-event-owner-schema.mjs');
 const {statements}=splitSchemaStatements(sql);assert.equal(statements.length,10);
 const body=(name,tag)=>{const at=sql.indexOf('CREATE FUNCTION public.'+name+'(');assert.ok(at>=0);
  const begin=sql.indexOf('AS $'+tag+'$',at),end=sql.indexOf('END $'+tag+'$;',begin);assert.ok(end>begin);return sql.slice(begin,end);};
 const main=body('static_weekly_approved_dated_materialize_projection','dated'),
  validate=body('static_weekly_assert_approved_dated_projection','validation'),
  lunch=body('static_weekly_assert_approved_dated_lunch','lunch'),
  availability=body('static_weekly_approved_dated_effective_availability','availability');
 let checks=0;
 const check=(name,fn)=>{fn();checks++;console.log('PASS NEW Source',name);};
 if(process.argv.includes('--approved-dated-regroup-lineage-source-only')){
  check('regrouping consumes locally reconstructed rows and actual or explicitly absent original links',()=>{
   assert.match(validate,/original-'ownerSlotId'=work-'ownerSlotId'/);
   assert.match(validate,/SELECT assignment_id INTO STRICT original_assignment/);
   assert.match(validate,/ELSIF day<>operation_day THEN RAISE EXCEPTION 'Dated unaffected original parent link differs'/);
   assert.match(validate,/jsonb_build_object\(identity_key,original_assignment\)/);
   assert.match(sql,/v_dated_validation:=public\.static_weekly_assert_approved_dated_projection/);
   assert.match(sql,/assignment_id=nullif\(v_dated_validation#>>ARRAY\['assignment_links',v_item->>'plan_work_id'\]/);
   assert.match(sql,/jsonb_array_elements\(v_dated_validation->'projection_assignments'\) original where original=v_item/);
   assert.match(sql,/inverse IS DISTINCT FROM original/);
   assert.doesNotMatch(sql,/SET ROLE|ALTER ROLE|^GRANT /m);
   assert.doesNotMatch(main,/commit|rollback|create_draft|publish_draft/i);
  });
  console.log(JSON.stringify({scope:'NEW private computed regroup lineage Source only',checks,sourceSha256:sha(sql),
   SQL_compilation:'NOT_RUN',SQL_execution:'NOT_RUN',prior_3_Source_checks:'NOT_REPLAYED',old_groups:0,resources0:true}));process.exit(0);
 }
 check('real dated write composition follows independent validation and preserves original publication',()=>{
  const first=main.indexOf('checked:=public.static_weekly_assert_approved_dated_projection'),
   sink=main.indexOf('materialized:=public.static_weekly_approved_dated_projection_sink'),
   lunchCheck=main.indexOf('PERFORM public.static_weekly_assert_approved_dated_lunch'),
   lunchWrite=main.indexOf('accepted_lunch:=public.static_weekly_v8_materialize_lunch_document'),
   result=main.indexOf('RETURN jsonb_build_object');
  assert.ok(first>0&&sink>first&&lunchCheck>sink&&lunchWrite>lunchCheck&&result>lunchWrite);
  assert.ok(main.lastIndexOf('PERFORM public.static_weekly_assert_approved_dated_projection')>lunchWrite);
  assert.match(main,/p\.publication_id=p_publication AND p\.version_id=publication\.version_id/);
  assert.match(main,/p\.week_start=v_week_start AND p\.week_end=v_week_start\+6/);
  assert.match(main,/l\.document_json=lunch/);assert.match(main,/p\.projection_envelope=projection/);
  assert.match(main,/materialized#>>'\{data,projection_id\}'/);
  assert.doesNotMatch(main,/create_draft|publish_draft|SET ROLE|COMMIT|ROLLBACK|EXCEPTION WHEN/i);
  assert.doesNotMatch(sql,/Approved dated independent SQL lineage validator and writer are not integrated/);
  assert.match(validate,/closing_result:=public\.static_weekly_approved_dated_assert_closing/);
  assert.match(sql,/'compilerInput',p_baseline,'overlayCompilerInput',p_closing->'originalDerivedInput'/);
 });
 check('dated semantics reconstruct multiplicity current-day people and unchanged six-day outputs',()=>{
  assert.match(validate,/min\(|sum\(\(w->>'serviceEffortMinutes'\)::numeric\)/);
  assert.match(validate,/jsonb_agg\(member ORDER BY member\)/);
  assert.match(validate,/WHERE w->>'dayOfWeek'=operation_day::text/);
  assert.match(validate,/original_rows IS DISTINCT FROM unaffected OR mapped_rows IS DISTINCT FROM expected_rows/);
  assert.match(validate,/d<>operation_date OR/);assert.match(validate,/d=operation_date AND NOT EXISTS\(SELECT 1 FROM public\.employees/);
  assert.match(validate,/expected_projection\) EXCEPT ALL/);
  assert.match(validate,/Dated fixed route has no contiguous protected-safe directed transit/);
  assert.match(validate,/Dated hard workload capacity including original stops exceeded/);
  assert.match(validate,/Unqualified approved dated work-changing exception profile/);
  for(const type of ["WHEN 'pto','daily_absence'","WHEN 'partial_absence'","WHEN 'lunch'","WHEN 'shift_override'"])assert.ok(availability.includes(type));
  assert.match(lunch,/WITH RECURSIVE base AS/);assert.match(lunch,/reach\(root,key\)/);
  assert.match(lunch,/new_mask:=mask \| \(1<<\(k-1\)\)/);assert.match(lunch,/candidate->'owners'/);
  assert.match(lunch,/Dated deterministic original lunch helper partition differs/);
  assert.match(lunch,/responsibility->'proximity_evidence' IS DISTINCT FROM costs/);
  assert.match(lunch,/Dated original lunch notification identity differs/);
 });
 check('private native sink retains existing row constraints and has no new public authority',()=>{
  assert.match(sql,/pg_get_functiondef\(target\)/);assert.match(sql,/i\.definition_sql=original/);
  assert.match(sql,/i\.definition_sha256=public\.static_weekly_digest_text\(original\)/);
  assert.match(sql,/inverse IS DISTINCT FROM original/);
  assert.match(sql,/replace\(changed,'SECURITY DEFINER','SECURITY INVOKER'\)/);
  assert.match(sql,/a\.grantee<>p\.proowner/);assert.doesNotMatch(sql,/^GRANT /m);
  assert.doesNotMatch(sql,/INSERT INTO public\.weekly_schedule_versions|UPDATE public\.weekly_schedule_versions|INSERT INTO public\.weekly_schedule_publications|INSERT INTO public\.weekly_schedule_exception_commands/i);
  const sink=sql.slice(sql.indexOf('DO $dated_sink$'),sql.indexOf('END $dated_sink$;'));
  assert.doesNotMatch(sink,/replace\([^\n]+assignment_id|replace\([^\n]+baseline work/);
  for(const name of ['assert_window','effective_availability','projection_sink','materialize_projection'])assert.ok(sql.includes('static_weekly_approved_dated_'+name));
 });
 console.log(JSON.stringify({scope:'NEW independent dated semantics and real writer composition SQL Source only',checks,sourceSha256:sha(sql),
  SQL_compilation:'NOT_RUN',SQL_execution:'NOT_RUN',closing_profile:'TYPED_AVAILABILITY_ONLY_SOURCE; NATIVE_NOT_RUN',unlinked_regrouping:'SERVER_RECONSTRUCTED_LINK_OR_EXPLICIT_NULL_SELECTED_DAY',
  old_groups:0,solver:false,publication:false,resources0:true}));process.exit(0);
}

if(process.argv.includes('--approved-original-confirmation-sql-source-only')){
 const file='20261017200958_approved_static_original_confirmation_receipts.sql';
 const sql=readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
 const {splitSchemaStatements}=await import('./isolated-event-owner-schema.mjs');
 const {statements}=splitSchemaStatements(sql);
 assert.equal(statements[0].tokens[0].value,'begin');assert.equal(statements.at(-1).tokens[0].value,'commit');
 const body=name=>{const start=sql.indexOf('CREATE FUNCTION public.'+name);assert.ok(start>0);
  const end=sql.indexOf('END $fn$;',start);assert.ok(end>start);return sql.slice(start,end+'END $fn$;'.length);};
 const reader=body('static_weekly_read_approved_template_confirmation('),guard=body('static_weekly_guard_approved_template_confirmation()');
 assert.match(reader,/p_manager_id uuid,p_key text\)\nRETURNS jsonb/);
 assert.ok(reader.indexOf('static_weekly_v3_assert_control_plane()')<reader.indexOf('pg_advisory_xact_lock'));
 assert.ok(reader.indexOf('pg_advisory_xact_lock')<reader.indexOf('static_weekly_v3_manager_actor(p_manager_id)'));
 assert.ok(reader.indexOf('static_weekly_v3_manager_actor(p_manager_id)')<reader.indexOf("SELECT jsonb_build_object('request',request_json,'receipt',receipt_json)"));
 assert.match(reader,/length\(p_key\)<>36/);assert.match(reader,/p_key IS DISTINCT FROM \(p_key::uuid\)::text/);
 assert.match(reader,/WHERE manager_id=p_manager_id AND idempotency_key=p_key;\n RETURN result;/);
 assert.doesNotMatch(reader,/INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE\s+public\.|materialize|retry_safe|resend_allowed/i);
 assert.match(sql,/PRIMARY KEY\(manager_id,idempotency_key\)/);
 for(const column of ['request_json','receipt_json'])assert.match(sql,new RegExp(column+' jsonb NOT NULL'));
 for(const column of ['source_publication_id','publication_id','projection_id'])assert.match(sql,new RegExp('FOREIGN KEY\\('+column+'\\)'));
 for(const key of ['publicationId','serviceDate','kind','templateId','expectedRevision','previewDigest','idempotencyKey'])assert.ok(guard.includes("'"+key+"'"));
 assert.match(guard,/TG_RELID<>'public\.static_weekly_approved_template_confirmations'::regclass/);
 assert.match(guard,/NEW\.request_json->'publicationId' IS DISTINCT FROM 'null'::jsonb/);
 assert.match(guard,/NEW\.request_json->'kind' IS DISTINCT FROM '"RECURRING_STAFFING"'::jsonb/);
 assert.match(guard,/NEW\.request_json->'idempotencyKey' IS DISTINCT FROM to_jsonb\(NEW\.idempotency_key\)/);
 assert.match(guard,/extract\(isodow FROM v_service_date\)<>1/);
 assert.match(guard,/v_accepted_revision<=v_expected_revision OR v_accepted_revision>9007199254740991/);
 assert.match(guard,/NEW\.receipt_json->'ok' IS DISTINCT FROM 'true'::jsonb/);
 assert.match(guard,/NEW\.receipt_json->'solverInvoked' IS DISTINCT FROM 'false'::jsonb/);
 assert.match(guard,/NEW\.receipt_json->'previewDigest' IS DISTINCT FROM NEW\.request_json->'previewDigest'/);
 for(const field of ['previewDigest','feasibility_digest','lunch_document_identity'])assert.ok(guard.includes("length(NEW."+(field==='previewDigest'?'request_json':'receipt_json')+"->>'"+field+"')<>64"));
 assert.match(guard,/x\.publication_id=p\.publication_id AND x\.version_id=v\.version_id/);
 assert.match(guard,/p\.publication_id=NEW\.publication_id AND x\.projection_id=NEW\.projection_id/);
 assert.match(guard,/p\.actor_manager_id=NEW\.manager_id AND x\.compiled_by_manager_id=NEW\.manager_id AND l\.accepted_by_manager_id=NEW\.manager_id/);
 assert.match(guard,/l\.document_identity=NEW\.receipt_json->>'lunch_document_identity'/);
 for(const name of ['approved_confirmation_binding','approved_confirmation_immutable','approved_confirmation_no_truncate'])assert.ok(sql.includes('ENABLE ALWAYS TRIGGER '+name+';'));
 assert.match(sql,/BEFORE UPDATE OR DELETE ON public\.static_weekly_approved_template_confirmations/);
 assert.match(sql,/BEFORE TRUNCATE ON public\.static_weekly_approved_template_confirmations/);
 assert.match(sql,/FORCE ROW LEVEL SECURITY/);assert.match(sql,/REVOKE ALL ON TABLE public\.static_weekly_approved_template_confirmations/);
 assert.match(sql,/has_table_privilege\(role_name/);assert.match(sql,/has_any_column_privilege\(role_name/);
 assert.match(sql,/a\.grantee<>p\.proowner/);assert.match(sql,/NOT a\.is_grantable/);
 assert.deepEqual(sql.match(/^GRANT [^\n]+/gm),['GRANT EXECUTE ON FUNCTION public.static_weekly_read_approved_template_confirmation(uuid,text) TO static_weekly_control_plane;']);
 assert.doesNotMatch(sql,/INSERT\s+INTO\s+public\.static_weekly_approved_template_confirmations|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.static_weekly_materialize|ALTER\s+DEFAULT\s+PRIVILEGES|CREATE\s+ROLE/i);
 for(const kind of ['relation','column','column_set','relation_state','constraint','index','trigger','function','grant'])assert.ok(sql.includes("'"+kind+"'"));
 assert.match(sql,/CASE WHEN tgenabled='A' THEN ' enable always trigger '/);
 assert.match(sql,/current_grant_definition\(r\.name\)/);assert.match(sql,/current_grant_definition\(oid::regprocedure::text\)/);
 assert.match(sql,/proacl FROM pg_proc/);assert.match(sql,/proowner FROM pg_proc/);
 assert.match(sql,/GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1/);
 assert.match(sql,/EXCEPT SELECT \* FROM approved_original_inventory_before/);
 assert.match(sql,/ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable/);
 console.log(JSON.stringify({scope:'NEW approved original confirmation migration Source contract and existing SQL boundary splitter',
  file,sourceSha256:createHash('sha256').update(sql).digest('hex'),statements:statements.length,
  SQL_compilation:'NOT_RUN',SQL_execution:'NOT_RUN',caller_permissions:'NOT_RUN',receipt_rows_created:0,old_groups:0,resources0:true}));process.exit(0);
}

if(process.argv.includes('--approved-confirmation-status-only')){
 const manager={manager_id:'11000000-0000-4000-8000-000000000001',manager_display_name:'UNIT approved manager',
  auth_mode:'trusted_device',trusted_device:true,read_only:false};
 const key='12000000-0000-4000-8000-000000000001',source='13000000-0000-4000-8000-000000000001';
 const publication='14000000-0000-4000-8000-000000000001',projection='15000000-0000-4000-8000-000000000001';
 const digest='a'.repeat(64),calls=[];let releases=0,returned=null,sqlFailure=null;
 class StatusClient extends EventEmitter{
  async query(sql,args=[]){calls.push({sql,args});
   if(/static_weekly_read_approved_(initial|template)_confirmation/.test(sql)){
    if(sqlFailure)throw sqlFailure;return{rows:[{result:returned}]};
   }
   return{rows:[]};
  }
  release(){releases++;}
 }
 const cp=createStaticWeeklyControlPlane({database:{connect:async()=>new StatusClient()},
  compiler:()=>{throw Error('No solver in approved confirmation recovery');},shutdownCompiler:async()=>{}});
 let checks=0;
 const request=kind=>kind==='initial'?{sourceId:source,effectiveStart:'2026-10-05',templateId:'approved-six',
  expectedRevision:4,previewDigest:digest,idempotencyKey:key}:{publicationId:null,serviceDate:'2026-10-05',kind:'RECURRING_STAFFING',
  templateId:null,expectedRevision:4,previewDigest:digest,idempotencyKey:key};
 const original=kind=>({request:request(kind),receipt:{schema:`custodial.approved-static${kind==='initial'?'-initial':''}-confirmation.v1`,
  status:'PERSISTED_CURRENT',ok:true,persistence_status:'PERSISTED',source_id:source,publication_id:publication,projection_id:projection,
  authority_revision:6,revision:6,feasibility_digest:'b'.repeat(64),lunch_document_identity:'c'.repeat(64),previewDigest:digest,solverInvoked:false}});
 try{
  if(process.argv.includes('--digest-boundary-only')){
   for(const kind of ['initial','recurring'])for(const field of ['previewDigest','feasibility_digest','lunch_document_identity']){
    returned=original(kind);returned.receipt[field]+='\n';if(field==='previewDigest')returned.request.previewDigest+='\n';
    const method=kind==='initial'?'getApprovedInitialConfirmationStatus':'getApprovedStaticConfirmationStatus';
    const before=calls.length;await assert.rejects(cp[method]({manager,confirmationKey:key}));
    assert.ok(calls.slice(before).some(q=>q.sql==='rollback'));assert.equal(calls.slice(before).some(q=>q.sql==='commit'),false);checks++;
   }
   console.log(JSON.stringify({checks,scope:'NEW exact 64-byte approved receipt digest boundary only',actual_SQL:false,
    actual_HTTP:false,real_manager:false,old_groups:0,resources0:true}));
   process.exitCode=0;
  }else{
  assert.equal(typeof cp.getApprovedInitialConfirmationStatus,'function','Mounted approved initial receipts need their own read-only recovery method');
  assert.equal(typeof cp.getApprovedStaticConfirmationStatus,'function','Mounted approved recurring receipts must not use the old compiler ledger');
  for(const kind of ['initial','recurring']){
   const method=kind==='initial'?'getApprovedInitialConfirmationStatus':'getApprovedStaticConfirmationStatus';
   for(const accepted of [false,true]){
    returned=accepted?original(kind):null;const before=calls.length;
    const value=await cp[method]({manager,confirmationKey:key});
    assert.deepEqual(value,{schema:'custodial.approved-static-confirmation-status.v1',kind,state:accepted?'ACCEPTED':'NOT_FOUND',
     confirmationKey:key,request:accepted?request(kind):null,receipt:accepted?returned.receipt:null});
    if(accepted){assert.notStrictEqual(value.request,returned.request);assert.notStrictEqual(value.receipt,returned.receipt);}
    const group=calls.slice(before),reader=group.find(q=>/static_weekly_read_approved_/.test(q.sql));
    assert.equal(reader.sql,`select public.static_weekly_read_approved_${kind==='initial'?'initial':'template'}_confirmation($1,$2) as result`);
    assert.deepEqual(reader.args,[manager.manager_id,key]);
    assert.ok(group.findIndex(q=>q.sql.includes('pg_advisory_xact_lock'))<group.indexOf(reader));
    assert.equal(group.some(q=>/static_weekly_v13_read|materialize|create_draft|publish_draft/.test(q.sql)),false);checks++;
   }
   for(const mutate of [x=>{x.request.idempotencyKey=source;},x=>{x.receipt.previewDigest='d'.repeat(64);},
    x=>{x.receipt.solverInvoked=true;},x=>{x.request.expectedRevision=NaN;},x=>{x.request.extra='unbound';},
    x=>{x.receipt.schema='custodial.some-other-receipt.v1';},x=>{x.receipt.revision=7;},x=>{x.receipt.authority_revision=4;},
    x=>{if(kind==='initial')x.receipt.source_id=publication;else x.request.kind='DATED_ABSENCE';}]){
    returned=original(kind);mutate(returned);const before=calls.length;
    await assert.rejects(cp[method]({manager,confirmationKey:key}));assert.ok(calls.slice(before).some(q=>q.sql==='rollback'));checks++;
   }
   for(const bad of [{manager:{...manager,read_only:true},confirmationKey:key},{manager,confirmationKey:'not-the-original'},
    {manager:{...manager,auth_mode:'admin_api_key'},confirmationKey:key}]){
    const before=calls.length;await assert.rejects(cp[method](bad));assert.equal(calls.length,before);checks++;
   }
   returned=original(kind);sqlFailure=Object.assign(Error('UNIT unresolved original read'),{code:'55P03'});
   const before=calls.length;await assert.rejects(cp[method]({manager,confirmationKey:key}));
   assert.ok(calls.slice(before).some(q=>q.sql==='rollback'));assert.equal(calls.slice(before).some(q=>q.sql==='commit'),false);
   sqlFailure=null;checks++;
  }
  assert.equal(releases,calls.filter(q=>q.sql==='begin').length);
  console.log(JSON.stringify({checks,scope:'NEW approved original receipt/locking Source controller only',
   actual_SQL:false,actual_HTTP:false,real_manager:false,solver_runs:0,mutation_functions:0,old_groups:0,resources0:true}));
  }
 }finally{await cp.close();}
 process.exit(0);
}

if(process.argv.includes('--staffing-readers-only')){
 const MID='11000000-0000-4000-8000-000000000001',SOURCE='12000000-0000-4000-8000-000000000001';
 const actor={manager_id:MID,manager_display_name:'Synthetic current owner',auth_mode:'trusted_device',read_only:false};
 const raw={slots:[{id:SOURCE,incumbencies:[]}],version:{vacancyCapableSlotIds:[SOURCE]}};
 const current={...raw,serviceDate:'2026-10-05'},queries=[];
 let revision=42,roster=[],outcome={schema:'custodial.original-staffing-outcome.v1',state:'OUTCOME_UNCONFIRMED',retry_safe:false};
 class ReadClient extends EventEmitter{
  async query(sql,args=[]){queries.push({sql,args});let result=null;
   if(sql.includes('static_weekly_v3_read_manager_snapshot'))result={authority_revision:revision,roster};
   else if(sql.includes('static_weekly_v3_read_authority_source'))result={source_id:SOURCE,compiler_input:args.length===1?raw:current};
   else if(sql.includes('static_weekly_read_original_staffing_outcome_v1'))result=outcome;
   return{rows:[{result}]};}
  release(){}
 }
 const cp=createStaticWeeklyControlPlane({database:{connect:async()=>new ReadClient()},compiler:()=>{throw Error('No solver in source/readback path');},shutdownCompiler:async()=>{}});
 try{
  const input={manager:actor,sourceId:SOURCE,effectiveStart:'2026-10-06',expectedRevision:42};
  const r=await cp.getRosterSourceDetails(input);assert.equal(r.schema,'custodial.roster-source-details.v1');
  assert.equal(r.manager_id,MID);assert.equal(r.week_start,'2026-10-05');assert.equal(r.phone_released,false);
  assert.deepEqual(r.registered_compiler_input,raw);assert.deepEqual(r.compiler_input,current);
  assert.notEqual(r.registered_source_digest,r.current_source_digest);
  revision=43;await assert.rejects(cp.getRosterSourceDetails(input),{code:'static_weekly_staffing_source_revision_changed'});
  revision=42;roster=null;await assert.rejects(cp.getRosterSourceDetails(input),{code:'static_weekly_staffing_roster_unavailable'});
  await assert.rejects(cp.getRosterSourceDetails({...input,manager:{...actor,read_only:true}}),{code:'static_weekly_named_manager_required'});
  assert.equal(await cp.readOriginalStaffingOutcome({manager:actor,operation:'vacate_roster_slot',idempotencyKey:'original-key'}),outcome);
  assert.deepEqual(queries.filter(q=>q.sql.includes('static_weekly_read_original_staffing_outcome_v1')).at(-1).args,[MID,'original-key','vacate_roster_slot']);
  await assert.rejects(cp.readOriginalStaffingOutcome({manager:actor,operation:'departed',idempotencyKey:'original-key'}),{code:'static_weekly_staffing_operation_invalid'});
  assert.equal(queries.some(q=>/static_weekly_v[489]_(vacate|fill|restore|materialize)/.test(q.sql)),false);
  console.log('NEW source/readback controller behavior passed: exact raw/current source and digests, stale/missing/readonly refusal, fixed original selector, no writer or solver. FAKE SQL source test; not actual HTTP/browser/PASS.');
 }finally{await cp.close();}
 process.exit(0);
}

const start=performance.now(),deadlineAt=start+60_000,clone=structuredClone,initialMode=process.argv.includes('--initial');
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
const consumerBytes=readFileSync(new URL('./fixtures/approved-schedule-web-consumer-7ddd.js',import.meta.url));
assert.equal(createHash('sha256').update(consumerBytes).digest('hex'),'fa9064b80f703fc77c989c27e16e10ebf5e0fa77c6194801233b4947484dab80','exact current web consumer, not an accepting stand-in');
const webContext={};runInNewContext(consumerBytes.toString(),webContext);
const webConsumer=webContext.MemphisApprovedSchedule;
const configBytes=readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url));
assert.equal(createHash('sha256').update(configBytes).digest('hex'),'40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30');
const ownerConfig=JSON.parse(configBytes),packet=loadSixPersonAbsenceSource(),currentSource=packet.compilerInput;
assert.equal(packet.fixtureSha256,'882e5895d60338313b08f28ec327f2087468261749cdbac5dc7d78ac22e20469');
assert.equal(postgresJsonbContentDigest(currentSource),'ac98f94d0c28a9cd493898bef2463059ef59a80bfcac1f8d0a455ddf6901571a');
const removed=new Set(currentSource.slots.filter(s=>s.contractorCapacity).map(s=>s.id));
assert.equal(currentSource.version.assignments.filter(r=>removed.has(r.ownerSlotId)).length,0);
if(!initialMode){
 currentSource.slots=currentSource.slots.filter(s=>!removed.has(s.id));
 currentSource.version.slotAvailability=currentSource.version.slotAvailability.filter(r=>!removed.has(r.slotId));
 for(const key of ['namedAbsentSlotIds','vacancyCapableSlotIds','vacantSlotIds'])currentSource.version[key]=(currentSource.version[key]||[]).filter(id=>!removed.has(id));
}
const templateId='owner-corrected-six',roleSlotIds=Object.values(ownerConfig.slots).filter(s=>!s.vacancy).map(s=>s.slotId).sort();
const templates=[{templateId,staffingCount:6,source:clone(currentSource),roleSlotIds}],admittedBindings=[{
 schema:'custodial.approved-static-template-binding.v1',templateId,staffingCount:6,
 sourceDigest:contentDigest(currentSource),roleSlotIdsDigest:contentDigest(roleSlotIds),
 patternAuthority:'OWNER_APPROVED_OPERATIONAL_PATTERN',artifactSha256:createHash('sha256').update(configBytes).digest('hex'),
 ownerConfigDigest:contentDigest(ownerConfig),patternPublicationStatus:'UNPUBLISHED_LOCAL_CANDIDATE'}];
const inputsDigest=postgresJsonbContentDigest({templates,admittedBindings,ownerConfig});
// Match the existing SQL's release-entry fingerprint, not an invented hash of
// the narrower returned inputs. Approval evidence remains part of each entry.
const catalogEntries=templates.map((template,i)=>({templateId:template.templateId,
 entryDigest:postgresJsonbContentDigest({template,binding:admittedBindings[i],ownerConfig,approvalEvidence:{unitOnly:true}})}));
const catalogDigest=postgresJsonbContentDigest(catalogEntries);
const publication='81000000-0000-4000-8000-000000000001',newPublication='81000000-0000-4000-8000-000000000002',projection='81000000-0000-4000-8000-000000000003';
const actor={manager_id:'fixture-named-manager',manager_display_name:'Fixture Manager',auth_mode:'trusted_device'};
let revision=4,accepted=null,saved=null,lunch=null,basisMutator=x=>x,readbackBad=false,releases=0;
let transactionSnapshot=null;
const sourceId=loadSixPersonAbsenceSource().sourceId;
const calls=[];
class Client extends EventEmitter {
 async query(sql,args=[]){
  calls.push({sql,args});
  if(sql==='begin')transactionSnapshot={revision,accepted,saved,lunch};
  if(sql==='rollback'&&transactionSnapshot){({revision,accepted,saved,lunch}=transactionSnapshot);transactionSnapshot=null;}
  if(sql==='commit')transactionSnapshot=null;
  if(initialMode&&!accepted&&sql.includes('static_weekly_v3_read_manager_snapshot'))
    throw Object.assign(new Error('initial manager snapshot requires exactly one active registered recurring source'),{code:'23514'});
  let result=null;
  if(sql.includes('static_weekly_read_approved_template_confirmation')||sql.includes('static_weekly_read_approved_initial_confirmation'))result=saved;
  else if(sql.includes('static_weekly_v3_read_manager_snapshot'))result={authority_revision:revision,
    current_publication:{publication_id:accepted?newPublication:publication},projection_status:accepted?'current':'missing',
    latest_projection:accepted?{projection_id:readbackBad?'wrong':projection}:null};
  else if(sql.includes('static_weekly_v3_read_authority_source'))result={source_id:args[0],compiler_input:clone(currentSource),exceptions:[]};
  else if(sql.includes('static_weekly_read_approved_initial_basis'))result=basisMutator({schema:'custodial.approved-static-initial-basis.v1',
    sourceId:args[1],serviceDate:args[2],authorityRevision:revision,generation:2,
    currentSource:clone(currentSource),currentSourceDigest:postgresJsonbContentDigest(currentSource),
    ownerConfig:clone(ownerConfig),templates:clone(templates),admittedBindings:clone(admittedBindings),templateCatalogDigest:inputsDigest});
  else if(sql.includes('static_weekly_read_approved_template_basis'))result=basisMutator({schema:'custodial.approved-static-template-basis.v1',
    publicationId:args[1],serviceDate:args[2],kind:args[3],authorityRevision:revision,generation:2,
    currentSource:clone(currentSource),ownerConfig:clone(ownerConfig),templates:clone(templates),admittedBindings:clone(admittedBindings),
    templateCatalogDigest:catalogDigest,templateCatalogEntries:clone(catalogEntries),templateInputsDigest:inputsDigest});
  else if(sql.includes('static_weekly_materialize_approved_template')||sql.includes('static_weekly_materialize_approved_initial_baseline')){
    const envelope=args[initialMode?6:8];assert.equal(args[0],actor.manager_id);assert.equal(args[initialMode?3:4],revision);
    if(initialMode){assert.equal(args[1],sourceId);assert.equal(envelope.feasibility.currentSourceDigest,postgresJsonbContentDigest(currentSource));
      assert.deepEqual(envelope.feasibility.candidateSource,currentSource);
      assert.equal(envelope.feasibility.initialBaseline.document.assignments.length,323);
      assert.equal(envelope.feasibility.initialBaseline.projection.assignments.length,494);
      assert.equal(envelope.feasibility.initialBaseline.document.authority.schema,'custodial.approved-static-authority.v1');
      assert.equal(Object.hasOwn(envelope.feasibility.initialBaseline.document.authority,'optimizerResult'),false);
      assert.ok(envelope.feasibility.shiftEndDerivation.parentChains.length===323);
      const working=envelope.feasibility.projectionAvailability.filter(a=>a.status==='working'&&a.incumbentPersonId);
      const employees=new Set(Object.values(ownerConfig.slots).filter(s=>!s.vacancy).map(s=>s.personId));
      assert.equal(working.length,30);
      assert.ok(working.every(a=>employees.has(a.incumbentPersonId)));
    }else assert.equal(args[7],envelope.previewDigest);
    assert.equal(envelope.feasibility.optimized,false);
    assert.equal(envelope.feasibility.projectionAssignments.length,494);
    assert.equal(envelope.feasibility.lunchDocument.responsibilities.some(r=>r.creates_deep_clean!==false),false);
    revision++;lunch=envelope.feasibility.lunchDocument;
    accepted={ok:true,persistence_status:'PERSISTED',publication_id:newPublication,projection_id:projection,
      authority_revision:revision,source_id:sourceId,feasibility_digest:envelope.feasibility.digest,lunch_document_identity:lunch.document_identity};
    saved={request:envelope.request,receipt:{schema:'custodial.approved-static-confirmation.v1',status:'PERSISTED_CURRENT',
      ...accepted,revision,previewDigest:envelope.previewDigest,solverInvoked:false}};result=accepted;
  } else if(sql.includes('static_weekly_v8_read_lunch_document'))result={persistence_status:'PERSISTED',projection_id:projection,document_identity:lunch.document_identity};
  else if(sql.includes('static_weekly_v21_reconcile_dependency_changes'))result={authorityRevision:revision,processedChangeCount:0,
    invalidations:[],blockedPublications:[],affectedPhonesUpdated:false};
  return {rows:[{result}]};
 }
 release(){releases++;}
}
const database={connect:async()=>new Client()},cp=createStaticWeeklyControlPlane({database,
 compiler:()=>{throw Error('FORBIDDEN_SOLVER');},compilerPreparer:()=>{throw Error('FORBIDDEN_SOLVER');},shutdownCompiler:async()=>{}});
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const input={manager:actor,serviceDate:'2026-10-05',expectedRevision:4,deadlineAt};
try {
 if(process.argv.includes('--approved-basis-catalog-only')){
  assert.notEqual(catalogDigest,inputsDigest,'The actual SQL compact release-entry fingerprint is not the returned-input fingerprint');
  const preview=await cp.previewApprovedStaticPattern(input);
  assert.equal(preview.schema,'custodial.approved-static-preview.v1');assert.equal(preview.solverInvoked,false);
  assert.equal(preview.published,false);assert.equal(accepted,null);assert.equal(saved,null);checks++;
  for(const mutate of [x=>({...x,templateCatalogDigest:'0'.repeat(64)}),x=>({...x,templateInputsDigest:'0'.repeat(64)}),
   x=>({...x,templateCatalogEntries:[]}),x=>({...x,templateCatalogEntries:x.templateCatalogEntries.map(e=>({...e,templateId:'foreign'}))}),
   x=>({...x,templateCatalogEntries:x.templateCatalogEntries.map(e=>({...e,entryDigest:e.entryDigest+'\n'}))}),
   x=>{const y={...x};delete y.templateInputsDigest;return y;}]){
   basisMutator=mutate;await assert.rejects(cp.previewApprovedStaticPattern(input),{code:'static_template_trusted_basis_invalid'});checks++;
  }
  assert.equal(calls.some(q=>/materialize_approved|publish_draft/.test(q.sql)),false);
  console.log(JSON.stringify({scope:'NEW approved Source basis compact catalog plus complete input binding only',checks,
   actual_SQL:false,actual_HTTP:false,solver_runs:0,publication:false,old_groups:0,resources0:true}));
 }else if(initialMode){
  const sql=readFileSync(new URL('../supabase/migrations/20261004140657_approved_static_template_authority.sql',import.meta.url),'utf8');
  check('initial SQL keeps predecessor optimized validators untouched and private copied writers reversible',()=>{
    assert.equal(/create\s+or\s+replace\s+function\s+public\.static_weekly_assert_compiler_authority/i.test(sql),false);
    assert.equal(/create\s+or\s+replace\s+function\s+public\.static_weekly_v2_(create_draft|publish_draft|materialize_projection)/i.test(sql),false);
    assert.match(sql,/if reversed<>original then raise exception/);
    assert.match(sql,/kind:=case when exists\(select 1 from public.weekly_schedule_publications\) then 'supersede' else 'publish'/);
    assert.match(sql,/public\.static_weekly_v3_assert_draft_incumbency\(v_version_id\)/);
    assert.match(sql,/public\.static_weekly_v8_materialize_lunch_document\(v_projection_id/);
    assert.match(sql,/initial adapter provenance seam changed/);
  });
  check('initial SQL admission/actor/current-source/CAS/generation/private grants and recovery remain explicit source obligations',()=>{
    for(const needle of ['static_weekly_v3_assert_release_operator','static_weekly_v3_assert_control_plane','static_weekly_v3_manager_actor',
      "baseline.feasibility->'candidateSource' is distinct from source","p_generation is distinct from (basis->>'generation')::bigint",
      'static_weekly_v9_assert_shift_end_derivation','force row level security','custodial_release_authority_current_grant_definition',
      'initial canary recovery alias count changed'])assert.ok(sql.includes(needle),needle);
    assert.equal(/grant\s+(select|insert|update|delete|all)\s+on\s+table/i.test(sql),false);
    assert.equal(/grant\s+execute[^;]*\bto\s+(anon|authenticated|service_role)\b/i.test(sql),false);
  });
  const initial={manager:actor,sourceId,effectiveStart:'2026-10-05',templateId,expectedRevision:4,deadlineAt};
  await assert.rejects(cp.createInitialDraft({...initial,idempotencyKey:'original-initial-must-not-solve'}),/FORBIDDEN_SOLVER/);checks++;
  await assert.rejects(cp.previewApprovedInitialBaseline({...initial,manager:{...actor,read_only:true}}),{code:'static_weekly_named_manager_required'});checks++;
  await assert.rejects(cp.previewApprovedInitialBaseline({...initial,expectedRevision:3}),{code:'static_template_revision_changed'});checks++;
  await assert.rejects(cp.previewApprovedInitialBaseline({...initial,effectiveStart:'2026-09-28'}),{code:'static_template_initial_source_invalid'});checks++;
  basisMutator=x=>({...x,currentSourceDigest:'0'.repeat(64)});
  await assert.rejects(cp.previewApprovedInitialBaseline(initial),{code:'static_template_trusted_basis_invalid'});checks++;
  basisMutator=x=>({...x,currentSource:{...x.currentSource,exceptions:[{}]}});
  await assert.rejects(cp.previewApprovedInitialBaseline(initial),{code:'static_template_trusted_basis_invalid'});checks++;
  basisMutator=x=>({...x,templateCatalogDigest:'0'.repeat(64)});
  await assert.rejects(cp.previewApprovedInitialBaseline(initial),{code:'static_template_trusted_basis_invalid'});checks++;
  basisMutator=x=>x;
  const preview=await cp.previewApprovedInitialBaseline(initial);
  check('actual initial preview passes unchanged exact web validator',()=>{
    const checked=webConsumer.validatePreview('initial',preview,{source_id:sourceId,effective_start:initial.effectiveStart,template_id:templateId,expected_revision:4},null);
    assert.equal(checked.previewDigest,preview.previewDigest);
  });
  check('exact untrimmed current-six initial preview retains323 including complete source, derives494/lunch30 without solver',()=>{
    assert.equal(calls.some(c=>c.sql.includes('static_weekly_v3_read_manager_snapshot')),false,
      'source-specific initial preview must not borrow the ambiguous unbound snapshot');
    assert.equal(preview.status,'PREVIEW_ONLY');assert.equal(preview.mapping.unchanged,true);
    assert.equal(preview.assignments.length,494);assert.equal(preview.lunch.loans.length,30);
    assert.equal(currentSource.version.assignments.length,323);assert.equal(currentSource.slots.filter(s=>s.contractorCapacity).length,removed.size);
    assert.equal(revision,4);assert.equal(preview.solverInvoked,false);
    const employees=new Set(Object.values(ownerConfig.slots).filter(s=>!s.vacancy).map(s=>s.personId));
    assert.equal(preview.lunch.loans.every(l=>employees.has(l.normal_owner_person_id)),true);
    assert.equal(preview.lunch.responsibilities.every(r=>employees.has(r.coverer_person_id)&&r.creates_deep_clean===false),true);
  });
  const confirmation={...initial,previewDigest:preview.previewDigest,idempotencyKey:'fixture-initial-approved-six'};
  readbackBad=true;
  await assert.rejects(cp.publishApprovedInitialBaseline({...confirmation,idempotencyKey:'fixture-readback-mismatch'}),{code:'static_template_current_readback_mismatch'});checks++;
  check('missing/mismatched authoritative readback rolls back fake initial write without commit',()=>{
    assert.equal(revision,4);assert.equal(accepted,null);assert.equal(saved,null);assert.equal(lunch,null);
    assert.equal(calls.at(-1).sql,'rollback');
  });
  readbackBad=false;
  const result=await cp.publishApprovedInitialBaseline(confirmation);
  check('initial typed baseline publishes over existing historical publication then checks current projection and persisted lunch',()=>{
    assert.equal(result.status,'PERSISTED_CURRENT');assert.equal(result.source_id,sourceId);assert.equal(result.revision,5);
    assert.equal(result.projection_id,projection);assert.ok(calls.some(c=>c.sql.includes('pg_advisory_xact_lock')));
    assert.ok(calls.some(c=>c.sql.includes('set local role static_weekly_control_plane')));
    assert.ok(calls.some(c=>c.sql==='commit'));
  });
  const basisReads=calls.filter(c=>c.sql.includes('static_weekly_read_approved_initial_basis')).length;
  const replay=await cp.publishApprovedInitialBaseline(confirmation);
  check('initial replay retains original accepted receipt without regenerating or resetting authority',()=>{
    assert.equal(replay.status,'ACCEPTED_ORIGINAL_RECEIPT');assert.equal(calls.filter(c=>c.sql.includes('static_weekly_read_approved_initial_basis')).length,basisReads);
  });
  await assert.rejects(cp.publishApprovedInitialBaseline({...confirmation,previewDigest:'1'.repeat(64)}),{code:'static_template_confirmation_identity_conflict'});checks++;
  await assert.rejects(cp.previewApprovedInitialBaseline({...initial,deadlineAt:start-1}),{code:'static_weekly_recurring_operation_deadline_exceeded'});checks++;
  check('no optimized materializer or fabricated certificate on static initial path',()=>{
    assert.equal(calls.some(c=>/static_weekly_v3_(create_draft|publish_draft|materialize_projection)/.test(c.sql)),false);
    assert.equal(calls.filter(c=>c.sql.includes('static_weekly_materialize_approved_initial_baseline')).length,2);
  });
 }else{
 await assert.rejects(cp.previewApprovedStaticPattern({...input,manager:{...actor,read_only:true}}),{code:'static_weekly_named_manager_required'});checks++;
 await assert.rejects(cp.previewApprovedStaticPattern({...input,expectedRevision:3}),{code:'static_template_revision_changed'});checks++;
 basisMutator=x=>({...x,templateCatalogDigest:'0'.repeat(64)});
 await assert.rejects(cp.previewApprovedStaticPattern(input),{code:'static_template_trusted_basis_invalid'});checks++;
 basisMutator=x=>x;
 const preview=await cp.previewApprovedStaticPattern(input);
 check('actual recurring preview passes unchanged exact web validator',()=>{
  const checked=webConsumer.validatePreview('recurring',preview,{effective_start:input.serviceDate,expected_revision:4},{current_publication:{publication_id:publication}});
  assert.equal(checked.previewDigest,preview.previewDigest);
  assert.throws(()=>webConsumer.validatePreview('recurring',{...preview,lunch:{lunches:[]}},{effective_start:input.serviceDate,expected_revision:4},{current_publication:{publication_id:publication}}),/incomplete or mismatched/);
 });
 check('actual six manager preview returns fixed unchanged323/complete494 plus lunch without compiler',()=>{
  assert.equal(preview.status,'PREVIEW_ONLY');assert.equal(preview.mapping.unchanged,true);assert.equal(preview.assignments.length,494);
  assert.equal(preview.lunch.loans.length,30);assert.ok(preview.lunch.responsibilities.length>0);assert.equal(preview.solverInvoked,false);assert.equal(revision,4);
  check('private preview carries the same bounded availability and hard-constraint view consumed by the scheduler',()=>{
   assert.equal(preview.constraintView.schema,'custodial.approved-static-constraint-view.v1');
   assert.equal(preview.constraintView.contract,'FIXED_APPROVED_PATTERN_COMPLETE_HARD_CONSTRAINTS_NOT_OPTIMALITY');
   assert.ok(Number.isSafeInteger(preview.constraintView.hardConstraintCount));
   assert.ok(preview.constraintView.hardConstraintCount>0);
   assert.ok(preview.constraintView.slotAvailability.length>0);
   assert.ok(preview.constraintView.projectionAvailability.length>0);
   assert.equal(preview.constraintView.balance.optimized,false);
   assert.equal(preview.constraintView.opening.proven,false);
  });
 });
 const writesBefore=calls.filter(c=>c.sql.includes('static_weekly_materialize_approved_template')).length;
 await assert.rejects(cp.confirmApprovedStaticPattern({...input,previewDigest:'0'.repeat(64),idempotencyKey:'stale-preview-fixture'}),{code:'static_template_preview_changed'});checks++;
 check('changed preview digest never reaches typed writer',()=>assert.equal(calls.filter(c=>c.sql.includes('static_weekly_materialize_approved_template')).length,writesBefore));
 const confirmation={...input,previewDigest:preview.previewDigest,idempotencyKey:'fixture-static-six-confirm'};
 const result=await cp.confirmApprovedStaticPattern(confirmation);
 check('fake transport confirms same actor/CAS typed write then exact current projection and persisted lunch readback',()=>{
  assert.equal(result.status,'PERSISTED_CURRENT');assert.equal(result.revision,5);assert.equal(result.projection_id,projection);
  assert.ok(calls.some(c=>c.sql.includes('pg_advisory_xact_lock')));assert.ok(calls.some(c=>c.sql.includes('set local role static_weekly_control_plane')));
 });
 const basisReads=calls.filter(c=>c.sql.includes('static_weekly_read_approved_template_basis')).length;
 const replay=await cp.confirmApprovedStaticPattern(confirmation);
 check('original exact confirmation replay survives later revision without new basis/solver',()=>{
  assert.equal(replay.status,'ACCEPTED_ORIGINAL_RECEIPT');assert.equal(replay.currentReadbackNotRepeated,true);
  assert.equal(calls.filter(c=>c.sql.includes('static_weekly_read_approved_template_basis')).length,basisReads);
 });
 await assert.rejects(cp.confirmApprovedStaticPattern({...confirmation,previewDigest:'1'.repeat(64)}),{code:'static_template_confirmation_identity_conflict'});checks++;
 await assert.rejects(cp.previewApprovedStaticPattern({...input,deadlineAt:start-1}),{code:'static_weekly_recurring_operation_deadline_exceeded'});checks++;
 check('legacy optimized writer is never used by static preview/confirmation',()=>assert.equal(calls.some(c=>/static_weekly_v3_(create_draft|publish_draft|materialize_projection)/.test(c.sql)),false));
 check('all checked out fake clients are released',()=>assert.ok(releases>=7));
 }
 console.log(JSON.stringify({status:'PASS',checks,elapsedMilliseconds:performance.now()-start,
  actualArtifactPatternRows:323,actualDerivedProjectionRows:494,solver:false,sqlExecuted:false,production:false,
  scope:initialMode?'EXACT_UNTRIMMED_SOURCE_INITIAL_STATIC_BASELINE_FAKE_TRANSACTION_NOT_SQL_ACCEPTANCE':
    'ACTUAL_SOURCE_STATIC_FEASIBILITY_AND_FAKE_MANAGER_TRANSACTION_CONTRACT_NOT_SQL_ACCEPTANCE'}));
} finally {await cp.close();}
