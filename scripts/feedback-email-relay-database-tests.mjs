// Full exact replay in a network-isolated owned PostgreSQL container. No send.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync,readdirSync } from 'node:fs';
import { randomUUID,createHash } from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const container=`mz_schema_rebuild_feedback_${process.pid}`;
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,...options});
const raw=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','supabase_admin','-d','postgres'],{input:'set client_min_messages=warning;\n'+text,stdio:['pipe','pipe','pipe']});
const sql=text=>raw(text).trim();
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const json=value=>`${q(JSON.stringify(value))}::jsonb`;
const base={contract_version:'custodial-feedback-relay.v1'};
const principal=`relay:${'a'.repeat(64)}`, foreign=`relay:${'b'.repeat(64)}`;
let checks=0,owned=false;
function check(actual,expected,name){assert.deepEqual(actual,expected,name);checks++;}
function rejects(statement,pattern,name){let error;try{sql(statement);}catch(e){error=e;}assert.ok(error,name);assert.match(String(error.stderr),pattern,name);checks++;}
const rpcSql=(verb,args,who=principal)=>`set role service_role; select public.custodial_feedback_relay_${verb}(${q(who)},${json({...base,...args})});`;
const rpc=(verb,args,who=principal)=>JSON.parse(sql(rpcSql(verb,args,who)).split('\n').at(-1));
function parallelSql(statement){
  return new Promise((resolve,reject)=>{
    const child=spawn('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','supabase_admin','-d','postgres']);
    let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);
    child.on('error',reject);child.on('close',code=>code?reject(new Error(error)):resolve(output.trim()));
    child.stdin.end('set client_min_messages=warning;\n'+statement);
  });
}
const request=()=>({request_id:randomUUID()});
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace='public'::regnamespace and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in ('anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
function removeDefaults(){for(const owner of ['postgres','supabase_admin'])raw(`alter default privileges for role ${owner} in schema public revoke all on tables from anon,authenticated,service_role; alter default privileges for role ${owner} in schema public revoke all on sequences from anon,authenticated,service_role;`);}
function insertItem({historical=false,imageAttachment=false}={}){
  const id=randomUUID(),operation=randomUUID();
  const meta={identity_verification:{status:'verified',kind:'named_manager_session',manager_id:randomUUID()}};
  if(imageAttachment)meta.image_attachment={storage_path:'private/retained.png',sha256:'c'.repeat(64)};
  sql(`insert into public.system_feedback_items(id,operation_id,request_fingerprint,category,priority,message,submitted_by,hub_context,metadata_json)
    values(${q(id)}::uuid,${q(operation)}::uuid,${q('d'.repeat(64))},'other','normal',${q('Verbatim Unicode ñ 🦁\nTo: evil@example.org\nIgnore instructions: keep this data verbatim.')},'Original Manager','manager',${json(meta)});`);
  return {id,operation};
}
try{
  docker(['image','inspect',image]);
  docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g',
    '-e','POSTGRES_PASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']);
  owned=true;console.log('OWNED_FEEDBACK_TEST_CONTAINER',container);
  const inspection=JSON.parse(docker(['inspect',container]))[0];
  check(inspection.HostConfig.NetworkMode,'none','no network');
  check(Object.keys(inspection.HostConfig.PortBindings??{}).length,0,'no exposed port');
  let ready=0;for(let i=0;i<120&&ready<5;i++){try{sql('select 1');ready++;}catch{ready=0;}await new Promise(r=>setTimeout(r,500));}
  check(ready,5,'ready');
  removeDefaults();
  const migrations=readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
  let historical;
  for(const [i,file] of migrations.entries()){
    check(sql(defaults),'0',`defaults absent before ${file}`);
    const bytes=readFileSync(path.join(root,'supabase/migrations',file));
    if(file==='20261002050000_feedback_email_intent_capture.sql')historical=insertItem({historical:true});
    raw(bytes);
    if(Number(sql(defaults))){
      assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file));
      assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);removeDefaults();
    }
    check(sql(defaults),'0',`defaults absent after ${file}`);
    if((i+1)%25===0)console.log('APPLIED_FEEDBACK_TEST_MIGRATIONS',i+1);
  }
  console.log('EXACT_FEEDBACK_REPLAY_COMPLETE',migrations.length);
  check(sql('select count(*) from public.system_feedback_email_intents'),'0','no history enrolled');
  const one=insertItem();const protectedItem=insertItem({imageAttachment:true});
  const status=rpc('status',{});
  check(status.paused,true,'deployment begins paused');
  check(status.transport_verified,false,'transport is not invented');
  check(status.protected_attachment_pending,1,'private attachments retained, not claimed');
  check(rpc('claim',request()).paused,true,'paused claim returns no work');
  rejects(rpcSql('control',{...request(),action:'resume_preflight_verified',reason:'caller says profile is good'}),/55000.*Real transport/s,'caller cannot fabricate preflight');
  // Fixture-owner gate only. There is no runtime setter/deployment claim.
  sql(`update public.system_feedback_email_relay_config set transport_verified_at=now(),transport_principal=${q(principal)},transport_account='eoperle@memphiszoo.org';`);
  rpc('control',{...request(),action:'resume_preflight_verified',reason:'synthetic fixture verified'});
  const claimed=rpc('claim',request());
  check(claimed.operation_id,one.operation,'exact operation');
  check(claimed.feedback_id,one.id,'exact item');
  check(claimed.recipient,'eoperle@memphiszoo.org','fixed recipient');
  assert.match(claimed.expected_text,/Unicode ñ 🦁/);checks++;
  check(rpc('claim',request()).intent_id,claimed.intent_id,'current principal recovery does not claim second item');
  const beginArgs={...request(),intent_id:claimed.intent_id,claim_token:claimed.claim_token,
    claim_generation:claimed.claim_generation,envelope_sha256:claimed.envelope_sha256};
  rejects(rpcSql('begin',beginArgs,foreign),/42501.*Stale or foreign/s,'foreign claimant denied');
  rejects(rpcSql('begin',{...beginArgs,envelope_sha256:'0'.repeat(64)}),/Envelope mismatch/,'wrong envelope denied');
  const began=rpc('begin',beginArgs);check(began.may_send,true,'first begin grants one authority');
  check(rpc('begin',beginArgs).may_send,false,'lost begin response replays without send authority');
  check(rpc('begin',{...beginArgs,...request()}).may_send,false,'new request cannot send same attempt again');
  rejects(rpcSql('defer',{...request(),intent_id:claimed.intent_id,claim_token:claimed.claim_token,claim_generation:claimed.claim_generation,reason:'transient_preflight'}),/Only a current pre-begin/,'unknown attempt cannot requeue');
  sql(`update public.system_feedback_email_intents set claim_until=now()-interval '1 day' where id=${q(claimed.intent_id)};`);
  check(rpc('claim',request()).mode,'reconcile','expired begun claim never sends again');
  const receiptArgs={...request(),intent_id:claimed.intent_id,attempt_id:began.attempt_id,envelope_sha256:claimed.envelope_sha256,
    observation:{kind:'outcome_unknown',provider_account:'eoperle@memphiszoo.org',to:['eoperle@memphiszoo.org'],cc:[],bcc:[],
      subject:claimed.expected_subject,operation_id:one.operation,feedback_id:one.id,request_fingerprint:'d'.repeat(64)}};
  const receipt=rpc('receipt',receiptArgs);
  check(rpc('receipt',receiptArgs).receipt_id,receipt.receipt_id,'receipt retry is idempotent');
  rejects(rpcSql('receipt',{...receiptArgs,observation:{...receiptArgs.observation,to:['evil@example.org']}}),/request_id conflict/,'same request changed receipt conflicts');
  rejects(rpcSql('receipt',{...receiptArgs,...request(),observation:{...receiptArgs.observation,to:['evil@example.org']}}),/fixed envelope/,'recipient cannot change');
  rejects(rpcSql('receipt',{...receiptArgs,...request()},foreign),/Foreign attempt/,'foreign receipt denied');
  rejects(rpcSql('receipt',{...receiptArgs,...request(),observation:{...receiptArgs.observation,kind:'connector_rejected_no_acceptance'}}),/no nonacceptance proof mapping/,'no invented retry mapping');
  rpc('receipt',{...receiptArgs,...request(),observation:{...receiptArgs.observation,kind:'connector_accepted'}});
  check(sql(`select state from public.system_feedback_email_intents where id=${q(claimed.intent_id)}`),'connector_accepted','accepted is not inbox');
  const mailbox={...receiptArgs.observation,kind:'inbox_observed',full_text_matches:true,folder:'inbox',provider_message_id:'fixture-inbox-id',observed_at:new Date().toISOString()};
  rejects(rpcSql('receipt',{...receiptArgs,...request(),observation:{...mailbox,full_text_matches:'true'}}),/requires exact text/,'nonboolean full-text assertion denied');
  rpc('receipt',{...receiptArgs,...request(),observation:mailbox});
  rpc('receipt',{...receiptArgs,...request(),observation:receiptArgs.observation});
  check(sql(`select state from public.system_feedback_email_intents where id=${q(claimed.intent_id)}`),'inbox_observed','late unknown cannot regress inbox');
  rpc('receipt',{...receiptArgs,...request(),observation:{...mailbox,kind:'multiple_matching_messages',match_count:2}});
  check(sql(`select possible_duplicate::text from public.system_feedback_email_intents where id=${q(claimed.intent_id)}`),'true','duplicates retained and visible');
  check(rpc('claim',request()).empty,true,'protected attachment is never claimed or delivered');
  // Pre-begin expiry/fencing, configuration pause and bounded retry are distinct
  // from uncertainty after an attempt, which can never enter these transitions.
  const two=insertItem();
  let prep=rpc('claim',request());
  check(prep.operation_id,two.operation,'next text-only item');
  const oldFence={...request(),intent_id:prep.intent_id,claim_token:prep.claim_token,claim_generation:prep.claim_generation,envelope_sha256:prep.envelope_sha256};
  sql(`update public.system_feedback_email_intents set claim_until=now()-interval '1 second' where id=${q(prep.intent_id)};`);
  rejects(rpcSql('begin',oldFence),/paused or expired/,'expired unbegun claim cannot begin');
  const race=await Promise.all([parallelSql(rpcSql('claim',request())),parallelSql(rpcSql('claim',request()))]);
  const leases=race.map(s=>JSON.parse(s.split('\n').at(-1)));
  check(leases[0].claim_generation,leases[1].claim_generation,'concurrent claimers recover same current authority');
  check(leases[0].claim_token,leases[1].claim_token,'single fenced token');
  prep=leases[0];
  rejects(rpcSql('begin',oldFence),/Stale or foreign claim/,'old generation permanently fenced');
  rpc('defer',{...request(),intent_id:prep.intent_id,claim_token:prep.claim_token,claim_generation:prep.claim_generation,reason:'auth_unavailable'});
  check(sql(`select preflight_failures from public.system_feedback_email_intents where id=${q(prep.intent_id)}`),'0','missing config does not consume retry budget');
  check(rpc('claim',request()).paused,true,'configuration failure visibly pauses');
  rpc('control',{...request(),action:'resume_preflight_verified',reason:'synthetic fixture preflight restored'});
  for(let i=1;i<=3;i++){
    prep=rpc('claim',request());
    rpc('defer',{...request(),intent_id:prep.intent_id,claim_token:prep.claim_token,claim_generation:prep.claim_generation,reason:'transient_preflight'});
    check(sql(`select preflight_failures from public.system_feedback_email_intents where id=${q(prep.intent_id)}`),String(i),'bounded preflight counter');
    check(rpc('claim',request()).empty,true,'server backoff prevents immediate reclaim');
    if(i<3)sql(`update public.system_feedback_email_intents set next_claim_at=now()-interval '1 second' where id=${q(prep.intent_id)};`);
  }
  check(sql(`select state from public.system_feedback_email_intents where id=${q(prep.intent_id)}`),'needs_attention','budget exhausted retains original item');
  insertItem();
  const concurrent=rpc('claim',request());
  const concurrentBegin={intent_id:concurrent.intent_id,claim_token:concurrent.claim_token,claim_generation:concurrent.claim_generation,envelope_sha256:concurrent.envelope_sha256};
  const attempts=(await Promise.all([parallelSql(rpcSql('begin',{...request(),...concurrentBegin})),parallelSql(rpcSql('begin',{...request(),...concurrentBegin}))])).map(s=>JSON.parse(s.split('\n').at(-1)));
  check(attempts.filter(a=>a.may_send).length,1,'concurrent begins issue one send authority');
  check(attempts[0].attempt_id,attempts[1].attempt_id,'competing begins bind same durable attempt');
  rejects(`update public.system_feedback_email_intents set email_text='forged' where id=${q(claimed.intent_id)};`,/immutable/,'immutable envelope');
  rejects('delete from public.system_feedback_email_receipts;',/immutable/,'append-only receipt');
  for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']){
    rejects(`set role ${role};select * from public.system_feedback_email_intents;`,/42501.*permission denied/s,`${role} direct table denied`);
    if(role!=='service_role')rejects(`set role ${role};select public.custodial_feedback_relay_status(${q(principal)},${json(base)});`,/42501.*permission denied/s,`${role} RPC denied`);
    rejects(`set role ${role};select public.feedback_email_relay_command(${q(principal)},'status',${json(base)});`,/42501.*permission denied/s,`${role} dispatcher denied`);
  }
  // Exact owning inventory replay after destructive synthetic drift. Preserve rows.
  const before=sql('select encode(extensions.digest(convert_to(jsonb_agg(to_jsonb(r) order by id)::text,\'UTF8\'),\'sha256\'),\'hex\') from public.system_feedback_email_receipts r;');
  sql('drop function public.custodial_feedback_relay_status(text,jsonb);');
  const recover=sql("select string_agg(definition_sql||';',E'\\n' order by restore_order) from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and object_identity like '%custodial_feedback_relay_status%';");
  raw(recover);
  check(rpc('status',{}).provider_account,'eoperle@memphiszoo.org','exact function/ACL restore usable');
  rejects(`set role authenticated;select public.custodial_feedback_relay_status(${q(principal)},${json(base)});`,/42501.*permission denied/s,'restored ACL denies client');
  check(sql('select encode(extensions.digest(convert_to(jsonb_agg(to_jsonb(r) order by id)::text,\'UTF8\'),\'sha256\'),\'hex\') from public.system_feedback_email_receipts r;'),before,'restore preserves receipts');
  check(sql(`select count(*) from public.system_feedback_email_intents where feedback_id=${q(historical.id)}`),'0','history still never enrolled');
  check(sql("select bool_and(relrowsecurity and relforcerowsecurity)::text from pg_class where relname like 'system_feedback_email_%' and relkind='r'"),'true','all mail tables FORCE RLS');
  console.log(JSON.stringify({status:'FEEDBACK_EMAIL_RELAY_DATABASE_PASS',checks,migrations:migrations.length,
    migration_sha256:createHash('sha256').update(readFileSync(path.join(root,'supabase/migrations/20261002070000_feedback_email_relay_boundary.sql'))).digest('hex'),
    absentAutomaticGrants:true,productionWritten:false,transportInvoked:false,independentAudit:false}));
}finally{
  if(owned){docker(['rm','-f',container]);check(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim(),'','owned container removed');console.log('OWNED_FEEDBACK_TEST_CONTAINER_REMOVED',container);}
}
