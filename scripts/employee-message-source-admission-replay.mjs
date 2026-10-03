import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,lstatSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertDecisionMigrationManifest,DECISION_IMAGE,DECISION_INPUT_PINS} from './native-provider-event-decisions-database-tests.mjs';
import {verifyEmployeeMessageSourceAdmissionDatabase} from './employee-message-source-admission-database-tests.mjs';

// Importing this module launches nothing. Only explicit --execute may create
// its one labelled, network-none synthetic target. Historical218 guards stay.
const ROOT=fileURLToPath(new URL('../',import.meta.url));
export const MESSAGE_FILE='20261003121757_employee_message_source_admission.sql';
export const MESSAGE_SHA='20ff06f8c0c5e82814189e1e2969b928ffa48eb1181098a73156962dc9ac1e7f';
export const MESSAGE_MANIFEST='4795b9525622e1512005f85ae1c5994971dccc3d54a987a743bdcfef8bf9ce32';
export const MESSAGE_IDENTITY='mz_prepare_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,timestamp with time zone)';
export const PREPARE_PRIOR='33d72de69db3e6735bec2827642bea966b89920d4c7b7bf338d73b7aca907ff2';
export const PREPARE_CURRENT='f92cb203c31ebb06322984cdcc10ab64cc37719e58e4a0ba1aa4fd2e0ae80ed5';
export const PREPARE_GRANT='67aa32e1273a26d411f190d8cbaf66fe2b7788fe0ab03faad22cf7cb9e0c9453';
const IMAGE_ID=DECISION_IMAGE.split('@')[1],hex=/^[0-9a-f]{64}$/;
const hash=x=>createHash('sha256').update(x).digest('hex');
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
const key=x=>JSON.stringify([x.object_kind,x.object_identity]);
const sorted=rows=>[...rows].sort((a,b)=>key(a)<key(b)?-1:key(a)>key(b)?1:0);
export const MESSAGE_INPUTS=Object.freeze({...DECISION_INPUT_PINS,
 'scripts/native-provider-event-decisions-database-tests.mjs':'07bb4a10ca4f189abd1b5169c11acd9b75ee40b67c9279d2a7fa10954878291e',
 'src/employee-notifications.js':'840931765d9ae9ad3f5f6223e801ec9a34bb32043717b99c494282082f4ccefb',
 'scripts/employee-message-source-admission-tests.mjs':'1a1b97b3551eb26e6a8764511b8c771ba6f0bfb4b9d06053a64d60c9b0250dcc',
 'scripts/employee-message-source-admission-database-tests.mjs':'119a8056109b8a6fb4d8e77cca1a44d09a2e6958f084999ef1fd9e6b208fb421',
});
const EXCEPTIONS=Object.freeze({
 '20260718083100_reconstruct_public_grant_hardening.sql':'ed9aac28cb07f3565f3289d15d67458297222910ac44b1a77e8b5ae71b4c59c3',
 '20260729150527_audit_defense_in_depth_hardening.sql':'420157f3073a3ea1b0055fc6e6246374a9babf2db576cda3bc4272a01e27cc4f',
 '20260815160613_normalize_managed_production_schema_security.sql':'fcc15cab9a3c492f9958d91643e5c88f88f0917b31a3507d340c6fab67cb011a',
});
const DEFAULTS="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const REMOVE_DEFAULTS=['postgres','supabase_admin'].flatMap(owner=>['',' in schema public'].map(scope=>`alter default privileges for role ${owner}${scope} revoke all on tables from public,anon,authenticated,service_role;alter default privileges for role ${owner}${scope} revoke all on sequences from public,anon,authenticated,service_role;`)).join('\n');
const ABSENT=`do $absent$begin if (${DEFAULTS})<>0 then raise exception 'automatic table/sequence grants present';end if;end $absent$;`;
const INVENTORY='select jsonb_agg(to_jsonb(i) order by object_kind,object_identity) from public.custodial_release_authority_restore_inventory i;';
const SURFACE='select jsonb_agg(to_jsonb(s) order by object_kind,object_identity) from public.custodial_release_canary_authority_surface() s;';
const LIVE=`select jsonb_build_object('function',pg_get_functiondef(${q(MESSAGE_IDENTITY)}::regprocedure),'grant',public.custodial_release_authority_current_grant_definition(${q(MESSAGE_IDENTITY)}));`;

export function assertMessageManifest(rows){
 assert.ok(Array.isArray(rows));assert.equal(rows.length,219);
 assert.deepEqual(rows.map(x=>x.file),[...new Set(rows.map(x=>x.file))].sort());
 const own=rows.filter(x=>x.file===MESSAGE_FILE);assert.deepEqual(own,[{file:MESSAGE_FILE,sha256:MESSAGE_SHA}]);
 // This is the unchanged historical verifier, not a count or head override.
 assertDecisionMigrationManifest(rows.filter(x=>x.file!==MESSAGE_FILE));
 assert.equal(rows.length-rows.findIndex(x=>x.file===MESSAGE_FILE)-1,13);
 assert.equal(hash(JSON.stringify(rows)),MESSAGE_MANIFEST);return rows;
}
export function readMessageSource(root=ROOT){
 const directory=join(root,'supabase/migrations');
 const migrations=assertMessageManifest(readdirSync(directory).filter(x=>x.endsWith('.sql')).sort().map(file=>({file,sha256:hash(readFileSync(join(directory,file)))})));
 const inputs=Object.entries(MESSAGE_INPUTS).map(([file,sha256])=>{assert.equal(hash(readFileSync(join(root,file))),sha256,file);return {file,sha256};});
 const runner='scripts/employee-message-source-admission-replay.mjs';
 inputs.push({file:runner,sha256:hash(readFileSync(join(root,runner)))});
 return {migrations,manifest_sha256:MESSAGE_MANIFEST,inputs};
}
export function assertMessageTarget(row,target,{allowStopped=false}={}){
 assert.match(target.id,hex);assert.match(target.fixture_id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.equal(target.name,'mz_schema_message_'+target.fixture_id.replaceAll('-',''));
 assert.equal(row.Id,target.id);assert.equal(row.Name,'/'+target.name);assert.equal(row.Image,IMAGE_ID);
 assert.ok(row.State?.Running===true||(allowStopped&&row.State?.Running===false));
 assert.equal(row.HostConfig?.NetworkMode,'none');assert.deepEqual(row.HostConfig?.PortBindings??{},{});
 assert.ok(Object.values(row.NetworkSettings?.Ports??{}).every(x=>x===null||(Array.isArray(x)&&x.length===0)));
 assert.equal(row.Config?.Labels?.['custodial.owner'],'employee-message-source-admission');
 assert.equal(row.Config?.Labels?.['custodial.synthetic'],'true');assert.equal(row.Config?.Labels?.['custodial.fixture-id'],target.fixture_id);
 assert.ok(Array.isArray(row.Mounts??[])&&(row.Mounts??[]).length<=1);
 for(const mount of row.Mounts??[])assert.ok(mount.Type==='tmpfs'&&mount.Destination==='/var/lib/postgresql/data'
  &&(!mount.Source||mount.Source==='tmpfs')&&mount.RW===true);
 return target;
}
export function compareMessageDelta(before,after){
 for(const value of [before,after]){
  assert.ok(Array.isArray(value.inventory)&&Array.isArray(value.surface));
  assert.equal(new Set(value.inventory.map(key)).size,value.inventory.length);assert.equal(new Set(value.surface.map(key)).size,value.surface.length);
  for(const r of value.inventory){assert.match(r.definition_sha256,hex);assert.equal(hash(r.definition_sql),r.definition_sha256);}
 }
 const own=r=>r.object_kind==='function'&&r.object_identity===MESSAGE_IDENTITY;
 const oldRows=before.inventory.filter(own),newRows=after.inventory.filter(own);assert.equal(oldRows.length,1);assert.equal(newRows.length,1);
 const a=oldRows[0],b=newRows[0];assert.equal(a.definition_sha256,PREPARE_PRIOR);assert.equal(b.definition_sha256,PREPARE_CURRENT);
 const metadata=r=>({...r,definition_sql:null,definition_sha256:null,captured_at:null});assert.deepEqual(metadata(a),metadata(b));
 assert.ok(Number.isFinite(Date.parse(a.captured_at))&&Number.isFinite(Date.parse(b.captured_at)));
 assert.ok(Date.parse(b.captured_at)>=Date.parse(a.captured_at));
 assert.deepEqual(sorted(before.inventory.filter(r=>!own(r))),sorted(after.inventory.filter(r=>!own(r))),'all other inventory rows byte-exact');
 assert.deepEqual(sorted(before.surface),sorted(after.surface),'exact canary membership/purposes unchanged');
 assert.equal(before.live.function,a.definition_sql);assert.equal(after.live.function,b.definition_sql);
 assert.equal(before.live.grant,after.live.grant);assert.equal(hash(after.live.grant),PREPARE_GRANT);
 for(const value of [before,after]){
  const grants=value.inventory.filter(r=>r.object_kind==='grant'&&r.object_identity===MESSAGE_IDENTITY);assert.equal(grants.length,1);
  assert.equal(grants[0].definition_sql,value.live.grant);assert.equal(grants[0].definition_sha256,PREPARE_GRANT);
 }
 return {changed:[{object_kind:'function',object_identity:MESSAGE_IDENTITY,prior_sha256:PREPARE_PRIOR,current_sha256:PREPARE_CURRENT}],
  inventory_membership_unchanged:true,canary_unchanged:true,acl_unchanged:true,all_other_rows_byte_exact:true};
}
// The explicit callback is a subprocess boundary, not an acceptance/test mode.
// Fake-only contract tests verify refusal to remove an unowned target.
export function cleanupMessageTarget(docker,target){
 let row;
 try{const rows=JSON.parse(docker(['inspect',target.id??target.name]));assert.equal(rows.length,1);row=rows[0];}
 catch(error){if(/No such (?:object|container)/i.test(String(error.stderr))){return {removed:false,no_owned_container:true};}throw error;}
 const exact={...target,id:target.id??row.Id};assertMessageTarget(row,exact,{allowStopped:true});
 docker(['rm','-f',exact.id]);assert.equal(docker(['ps','-a','--filter','id='+exact.id,'--format','{{.ID}}']).trim(),'');
 return {removed:true,no_owned_container:true,target:exact};
}

async function execute(output){
 const source=readMessageSource(),git=(...a)=>execFileSync('git',a,{cwd:ROOT,encoding:'utf8',timeout:10000}).trim();
 assert.equal(git('status','--porcelain'),'','clean committed source required');
 const identity={commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}')};
 assert.ok(isAbsolute(output)&&realpathSync(output)===output&&!output.startsWith(ROOT));
 const st=lstatSync(output);assert.ok(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid());assert.equal(st.mode&0o077,0);assert.equal(readdirSync(output).length,0);
 const save=(name,value)=>writeFileSync(join(output,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
 const target={id:null,fixture_id:randomUUID(),name:null};target.name='mz_schema_message_'+target.fixture_id.replaceAll('-','');
 let launched=false,cleaned=false,phase='target',sequence=0,result=null;
 const docker=(args,input)=>execFileSync('docker',['--host','unix:///var/run/docker.sock',...args],{encoding:'utf8',input,timeout:60000,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']});
 const log=(label,value)=>save(String(sequence++).padStart(4,'0')+'-'+label+'.log',value);
 const inspect=()=>{const rows=JSON.parse(docker(['inspect',target.id]));assert.equal(rows.length,1);assertMessageTarget(rows[0],target);};
 const sql=text=>{inspect();try{return docker(['exec','-i',target.id,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse','-U','supabase_admin','-d','postgres'],
  'set standard_conforming_strings=on;set client_min_messages=warning;set statement_timeout=30000;set lock_timeout=5000;'+text);}
  catch(error){log('sql-failure',String(error.stderr??''));throw error;}};
 const snapshot=()=>({inventory:JSON.parse(sql(INVENTORY)),surface:JSON.parse(sql(SURFACE)),live:JSON.parse(sql(LIVE))});
 function cleanup(){if(cleaned)return;const receipt=launched?cleanupMessageTarget(docker,target):{removed:false,no_owned_container:true};
  const sourceUnchanged=git('rev-parse','HEAD')===identity.commit&&git('status','--porcelain')==='';
  cleaned=true;save('cleanup.json',{...receipt,target,pid:process.pid,source_unchanged:sourceUnchanged,at:new Date().toISOString()});
  assert.equal(sourceUnchanged,true,'source remains clean through normal cleanup');}
 const stop=()=>{try{cleanup();}finally{process.exit(143);}};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 save('intent.json',{schema:'custodial.employee-message-source-run-intent.v1',source:{...identity,...source},target,pid:process.pid,
  image:DECISION_IMAGE,started_at:new Date().toISOString(),synthetic:true,production:false,global_restore:false});
 try{
  const image=JSON.parse(docker(['image','inspect',DECISION_IMAGE]));assert.equal(image.length,1);assert.equal(image[0].Id,IMAGE_ID);
  assert.equal(docker(['ps','-a','--filter','name=^/'+target.name+'$','--format','{{.ID}}']).trim(),'');
  launched=true;const launchedId=docker(['run','-d','--pull','never','--network','none','--name',target.name,
   '--label','custodial.owner=employee-message-source-admission','--label','custodial.synthetic=true','--label','custodial.fixture-id='+target.fixture_id,
   '--tmpfs','/var/lib/postgresql/data:rw,size=1g','-e','POSTGRES_PASSWORD=postgres','-e','PGPASSWORD=postgres',DECISION_IMAGE,
   '-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']).trim();assert.match(launchedId,hex);target.id=launchedId;inspect();save('target.json',target);
  console.log('OWNED_MESSAGE_TARGET',JSON.stringify({pid:process.pid,...target}));
  let ready=0;for(let n=0;n<60&&ready<4;n++){try{sql('select 1;');ready++;}catch{ready=0;}await new Promise(r=>setTimeout(r,500));}assert.equal(ready,4);
  sql(REMOVE_DEFAULTS+ABSENT);phase='migrations';let before,after,delta;
  for(const [index,m] of source.migrations.entries()){
   const bytes=readFileSync(join(ROOT,'supabase/migrations',m.file));assert.equal(hash(bytes),m.sha256);
   if(m.file===MESSAGE_FILE){before=snapshot();save('before-message-UNVALIDATED.json',before);}
   if(EXCEPTIONS[m.file]){assert.equal(m.sha256,EXCEPTIONS[m.file]);assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);}
   let out;try{out=sql(ABSENT+'\n'+bytes+'\n'+(EXCEPTIONS[m.file]?REMOVE_DEFAULTS:'')+'\n'+ABSENT);}
   catch(error){save('failed-migration.json',{file:m.file,sha256:m.sha256,index,applied_predecessors:index,status:'FAIL'});throw error;}
   log('migration-'+String(index).padStart(4,'0'),out);
   if(m.file===MESSAGE_FILE){after=snapshot();save('after-message-UNVALIDATED.json',after);delta=compareMessageDelta(before,after);save('message-delta.json',delta);}
   if((index+1)%25===0)console.log('REPLAYED_EXACT_MIGRATIONS',index+1);await new Promise(r=>setImmediate(r));
  }
  assert.ok(delta);const final=snapshot();save('after219-UNVALIDATED.json',final);
  for(const kind of ['function','grant'])assert.deepEqual(final.inventory.filter(r=>r.object_kind===kind&&r.object_identity===MESSAGE_IDENTITY),
   after.inventory.filter(r=>r.object_kind===kind&&r.object_identity===MESSAGE_IDENTITY),'all13 later migrations preserve corrected prepare and ACL');
  assert.deepEqual(final.live,after.live);
  assert.equal(sql("select public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure));").trim(),
   '4f2cac31af750c5bc10a50445583b27ae2c6e67b0f66fe72c078b53c533d00db','unchanged exact final218 canary');
  phase='actual_message_sql_js';
  const receipt=await verifyEmployeeMessageSourceAdmissionDatabase({sql,target:{id:target.id,network:'none',synthetic:true}});
  assert.equal(receipt.status,'PASS');assert.ok(Number.isSafeInteger(receipt.checks)&&receipt.checks>0);
  save('message-sql-js-receipt.json',receipt);
  assert.deepEqual(JSON.parse(sql(INVENTORY)),final.inventory,'scoped body/ACL recovery preserves all inventory rows');
  assert.deepEqual(JSON.parse(sql(SURFACE)),final.surface);assert.deepEqual(JSON.parse(sql(LIVE)),final.live);
  assert.equal(sql(DEFAULTS).trim(),'0');phase='final_source';assert.deepEqual(readMessageSource(),source);
  assert.equal(git('rev-parse','HEAD'),identity.commit);assert.equal(git('status','--porcelain'),'');
  result={schema:'custodial.employee-message-source-engine-receipt.v1',status:'PASS',source:{...identity,...source},target,checks:receipt.checks,
   actual_sql:true,actual_js_consumer:true,actual_http:false,provider_delivery:false,scoped_restore:true,global_restore:false,
   automatic_grants_absent_before_after_each:true,delta,independent_audit:false,full_record_closure:false,policy_selection:false};
 }catch(error){save('failure.json',{status:'FAIL',phase,error_class:error.name,message_sha256:hash(String(error.message)),at:new Date().toISOString()});throw error;}
 finally{cleanup();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
 assert.ok(cleaned&&result);save('receipt.json',{...result,cleanup_verified:true,cleanup_sha256:hash(readFileSync(join(output,'cleanup.json'))),finished_at:new Date().toISOString()});
 console.log('MESSAGE_SQL_JS_SCOPED_RESTORE_PASS',result.checks);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--source-check')console.log(JSON.stringify({status:'PASS',scope:'SOURCE_ONLY_NO_ENGINE',...readMessageSource()}));
 else{assert.equal(process.argv.length,4,'use --source-check or --execute PRIVATE_EMPTY_OUTPUT_DIRECTORY');assert.equal(process.argv[2],'--execute');await execute(process.argv[3]);}
}
