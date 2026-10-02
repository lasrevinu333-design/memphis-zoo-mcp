import {createHash, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Extension of the existing recovery controller, NOT a database launcher,
// migration runner, canonical capturer, production checker or release gate.
export const RECOVERY_KINDS = Object.freeze(['column','column_set','constraint','function','grant','index','policy','relation','relation_state','trigger','view']);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OWN_FILES = ['scripts/current-release-recovery-probe.mjs','scripts/current-release-recovery-probe-contract-tests.mjs'];
const HEX = /^[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROLE = ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'];
const HEALTH_DENIED_ROLES = ROLE.filter(role=>role!=='service_role');
const CONTROL_REASON = 'synthetic current-source recovery probe';
const CONTROL_HEALTH = Object.freeze({ok:false,scope:'current-source-synthetic'});
const ARRAY_FIELDS = ['missing_objects','mismatched_objects','surface_missing_objects','surface_uncovered_objects'];
const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value==='object'
  ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])) : value;
const canonical = value => JSON.stringify(stable(value));
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const key = row => JSON.stringify([row.kind,row.identity]);
const sorted = rows => [...rows].sort((a,b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
function requireThat(condition, code) { if (!condition) throw new Error(code); }
function same(a,b,code) { requireThat(canonical(a) === canonical(b),code); }
function exactKeys(value, keys, code) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value),code);
  same(Object.keys(value).sort(),[...keys].sort(),code);
}
function entries(rows, fields, code) {
  requireThat(Array.isArray(rows) && rows.length > 0 && rows.length <= 20000,code);
  for (const row of rows) {
    exactKeys(row,fields,code);
    requireThat(RECOVERY_KINDS.includes(row.kind) && typeof row.identity === 'string'
      && row.identity.length > 0 && row.identity.length <= 500 && !/[\r\n\0]/.test(row.identity),code);
    if (fields.includes('sha256')) requireThat(HEX.test(row.sha256),code);
    if (fields.includes('order')) requireThat(Number.isSafeInteger(row.order) && row.order > 0,code);
  }
  requireThat(new Set(rows.map(key)).size === rows.length,code);
  same(rows,sorted(rows),code + '_order');
}

export function validateRecoveryManifest(m) {
  exactKeys(m,['schema','synthetic','production','target','source','inventory','surface','required_surface','health_checks','protected_rows','faults','omitted_surface','manager_id'],'manifest_shape');
  requireThat(m.schema === 'custodial.current-release-recovery-probe-manifest.v1' && m.synthetic === true && m.production === false,'synthetic_manifest_required');
  exactKeys(m.target,['name','id','image','database','fixture_id'],'target_shape');
  requireThat(/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(m.target.name)
    && HEX.test(m.target.id) && /^sha256:[0-9a-f]{64}$/.test(m.target.image)
    && /^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(m.target.database)
    && UUID.test(m.target.fixture_id),'local_owned_target_required');
  exactKeys(m.source,['commit','tree','migrations','probe_files'],'source_shape');
  requireThat(SHA.test(m.source.commit) && SHA.test(m.source.tree),'source_identity');
  requireThat(Array.isArray(m.source.migrations) && m.source.migrations.length > 0,'migration_manifest_required');
  for (const row of m.source.migrations) {
    exactKeys(row,['file','sha256'],'migration_shape');
    requireThat(/^\d{14}_[a-zA-Z0-9_]+\.sql$/.test(row.file) && HEX.test(row.sha256),'migration_identity');
  }
  same(m.source.migrations.map(x=>x.file),[...new Set(m.source.migrations.map(x=>x.file))].sort(),'migration_order');
  requireThat(Array.isArray(m.source.probe_files),'probe_files');
  same(m.source.probe_files.map(x=>x.file),OWN_FILES,'probe_files');
  for (const row of m.source.probe_files) { exactKeys(row,['file','sha256'],'probe_file_shape'); requireThat(HEX.test(row.sha256),'probe_file_hash'); }
  entries(m.inventory,['kind','identity','sha256','order'],'inventory');
  same([...new Set(m.inventory.map(x=>x.kind))].sort(),RECOVERY_KINDS,'all_eleven_inventory_kinds_required');
  entries(m.surface,['kind','identity'],'surface');
  entries(m.required_surface,['kind','identity'],'required_surface');
  for (const row of m.surface) requireThat(m.inventory.some(x=>key(x)===key(row)),'surface_inventory_coverage');
  for (const row of m.required_surface) requireThat(m.surface.some(x=>key(x)===key(row)),'required_surface_coverage');
  requireThat(Array.isArray(m.health_checks) && m.health_checks.length > 0
    && m.health_checks.every(x=>/^[a-z][a-z0-9_]+$/.test(x)),'health_checks');
  same(m.health_checks,[...new Set(m.health_checks)].sort(),'health_checks_order');
  requireThat(m.health_checks.includes('restore_inventory_exact') && m.health_checks.includes('canary_authority_surface_captured'),'health_checks_required');
  entries(m.faults,['kind','identity'],'faults');
  same(m.faults.map(x=>x.kind),RECOVERY_KINDS,'exact_eleven_faults_required');
  for (const row of m.faults) requireThat(m.inventory.some(x=>key(x)===key(row)),'fault_inventory_identity');
  exactKeys(m.omitted_surface,['kind','identity'],'omitted_surface');
  requireThat(m.required_surface.some(x=>key(x)===key(m.omitted_surface)),'required_omission_identity');
  requireThat(Array.isArray(m.protected_rows) && m.protected_rows.length > 0 && m.protected_rows.length <= 100,'protected_rows');
  for (const row of m.protected_rows) {
    exactKeys(row,['relation','count','sha256'],'protected_row_shape');
    requireThat(/^public\.[a-z][a-z0-9_]{0,62}$/.test(row.relation)
      && !/custodial_(backend_execution_config|release_canary_|release_authority_)/.test(row.relation)
      && Number.isSafeInteger(row.count) && row.count >= 0 && HEX.test(row.sha256),'protected_row_identity');
  }
  same(m.protected_rows.map(x=>x.relation),[...new Set(m.protected_rows.map(x=>x.relation))].sort(),'protected_rows_order');
  requireThat(m.protected_rows.some(x=>x.count > 0),'populated_synthetic_snapshot_required');
  requireThat(UUID.test(m.manager_id),'synthetic_manager_required');
  return m;
}

function realRun(command,args,options={}) {
  return spawnSync(command,args,{encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024,
    env:{PATH:process.env.PATH,LANG:'C.UTF-8'},...options});
}
function call(run,command,args,input) {
  const r = run(command,args,{input});
  requireThat(r && Number.isInteger(r.status) && typeof r.stdout === 'string' && typeof r.stderr === 'string','subprocess_result_shape');
  return r;
}
function successful(run,command,args,input,code) {
  const r=call(run,command,args,input); requireThat(r.status===0,code); return r.stdout.trim();
}
function parse(text,code) { try { return JSON.parse(text); } catch { throw new Error(code); } }
const DOCKER = ['--host','unix:///var/run/docker.sock'];
function inspectTarget(run,t) {
  const list=parse(successful(run,'docker',[...DOCKER,'inspect','--type','container',t.name],undefined,'inspect_failed'),'inspect_json');
  requireThat(Array.isArray(list) && list.length===1,'one_container_required'); const x=list[0];
  requireThat(x.Id===t.id && x.Name==='/'+t.name && x.Image===t.image && x.State?.Running===true,'container_identity');
  requireThat(x.HostConfig?.NetworkMode==='none' && Object.keys(x.HostConfig.PortBindings||{}).length===0
    && Object.values(x.NetworkSettings?.Ports||{}).every(value=>value===null)
    && x.NetworkSettings && canonical(Object.keys(x.NetworkSettings.Networks||{}))==='["none"]','network_none_required');
  const labels=x.Config?.Labels||{};
  requireThat(labels['org.memphiszoo.custodial.fixture']==='synthetic'
    && labels['org.memphiszoo.custodial.owner']==='/root'
    && labels['org.memphiszoo.custodial.fixture-id']===t.fixture_id,'owned_synthetic_labels_required');
  return {id:x.Id,image:x.Image,name:t.name,network:'none',fixture_id:t.fixture_id};
}

export function localRecoverySource(root=ROOT,run=realRun) {
  const git=args=>successful(run,'git',['-C',root,...args],undefined,'source_git_failed');
  requireThat(git(['status','--porcelain','--untracked-files=normal'])==='','clean_source_required');
  const migrations=readdirSync(resolve(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort()
    .map(file=>({file,sha256:hash(readFileSync(resolve(root,'supabase/migrations',file)))}));
  return {commit:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}']),migrations,
    probe_files:OWN_FILES.map(file=>({file,sha256:hash(readFileSync(resolve(root,file)))}))};
}

// Query returns hashes only, never protected business contents or key material.
const LIVE = `case i.object_kind
 when 'function' then pg_get_functiondef(to_regprocedure(i.object_identity))
 when 'relation' then public.custodial_release_authority_current_relation_definition(i.object_identity)
 when 'column' then public.custodial_release_authority_current_column_definition(i.object_identity)
 when 'column_set' then public.custodial_release_authority_current_column_set_definition(i.object_identity)
 when 'constraint' then public.custodial_release_authority_current_constraint_definition(i.object_identity)
 when 'index' then public.custodial_release_authority_current_index_definition(i.object_identity)
 when 'policy' then public.custodial_release_authority_current_policy_definition(i.object_identity)
 when 'relation_state' then public.custodial_release_authority_current_relation_state_definition(i.object_identity)
 when 'grant' then public.custodial_release_authority_current_grant_definition(i.object_identity)
 when 'view' then public.custodial_release_authority_current_view_definition(i.object_identity)
 when 'trigger' then (select 'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'; '||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' '||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end||' trigger '||quote_ident(t.tgname)||';'
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where i.object_identity=quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'.'||quote_ident(t.tgname) and not t.tgisinternal)
 else null end`;
const INVENTORY_SQL = `select coalesce(jsonb_agg(jsonb_build_object('kind',i.object_kind,'identity',i.object_identity,'order',i.restore_order,'sha256',i.definition_sha256,'stored_sha256',encode(extensions.digest(convert_to(i.definition_sql,'UTF8'),'sha256'),'hex'),'live_sha256',encode(extensions.digest(convert_to(${LIVE},'UTF8'),'sha256'),'hex'))),'[]'::jsonb) from public.custodial_release_authority_restore_inventory i;`;
const SURFACE_SQL = "select coalesce(jsonb_agg(jsonb_build_object('kind',object_kind,'identity',object_identity)),'[]'::jsonb) from public.custodial_release_canary_authority_surface();";
const DEFAULT_SQL = "select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole);";

function assertHealth(h,m,{kind='healthy',identity}={}) {
  exactKeys(h,['ok','authority','canonical_objects_expected','canary_surface_objects_expected',...ARRAY_FIELDS,'checks'],'health_shape');
  requireThat(h.authority==='offline-authority.v5','health_authority');
  same(Object.keys(h.checks||{}).sort(),m.health_checks,'health_check_set');
  requireThat(h.canonical_objects_expected===m.inventory.length-(kind==='omission'?1:0)
    && h.canary_surface_objects_expected===m.surface.length,'health_counts');
  for (const field of ARRAY_FIELDS) same(h[field],field===(kind==='digest'?'mismatched_objects':kind==='omission'?'surface_uncovered_objects':'')?[identity]:[],'health_'+field);
  const failed=kind==='digest'?'restore_inventory_exact':kind==='omission'?'canary_authority_surface_captured':null;
  for (const name of m.health_checks) requireThat(h.checks[name]===(name!==failed),'health_check_'+name);
  requireThat(h.ok===(kind==='healthy'),'health_result');
}

export function runCurrentReleaseRecoveryProbe(input,{root=ROOT,run=realRun}={}) {
  const m=validateRecoveryManifest(input), fake=run!==realRun;
  same(localRecoverySource(root,run),m.source,'source_manifest_mismatch');
  const target=inspectTarget(run,m.target), phases=[];
  const args=[...DOCKER,'exec','-i',m.target.id,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U','supabase_admin','-d',m.target.database];
  function raw(phase,body) { return call(run,'docker',args,`/* current-recovery:${phase} */\nset standard_conforming_strings=on;set client_min_messages=warning;set statement_timeout=60000;set lock_timeout=5000;\n${body}`); }
  function sql(phase,body) { const r=raw(phase,body);requireThat(r.status===0,'sql_'+phase); return r.stdout.trim(); }
  function json(phase,body) { return parse(sql(phase,body),'json_'+phase); }
  function defaults(phase) { requireThat(sql(phase,DEFAULT_SQL)==='0','automatic_grants_present'); }
  function inventory(phase) {
    const rows=json(phase,INVENTORY_SQL); requireThat(Array.isArray(rows),'inventory_rows');
    for (const row of rows) {
      exactKeys(row,['kind','identity','order','sha256','stored_sha256','live_sha256'],'observed_inventory_shape');
      requireThat(HEX.test(row.sha256) && row.sha256===row.stored_sha256 && row.sha256===row.live_sha256,'live_inventory_mismatch');
    }
    const projected=sorted(rows.map(({kind,identity,order,sha256})=>({kind,identity,sha256,order})));
    same(projected,m.inventory,'inventory_manifest_mismatch'); return hash(canonical(projected));
  }
  function surface(phase) { const rows=json(phase,SURFACE_SQL); requireThat(Array.isArray(rows),'surface_rows');same(sorted(rows),m.surface,'surface_manifest_mismatch'); }
  function protectedRows(phase) {
    const observed=m.protected_rows.map(row=>json(phase+'_'+row.relation.split('.')[1],`select jsonb_build_object('relation',${q(row.relation)},'count',count(*),'sha256',encode(extensions.digest(convert_to(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),''),'UTF8'),'sha256'),'hex')) from ${row.relation} r;`));
    same(observed,m.protected_rows,'protected_rows_changed');return observed;
  }
  defaults('defaults_before');inventory('inventory_before');surface('surface_before');protectedRows('protected_before');
  requireThat(sql('manager',`select count(*) from public.ops_manager_managers where manager_id=${q(m.manager_id)}::uuid and active and revoked_at is null and roles && array['DIRECTOR','SECURITY_ADMIN']::text[];`)==='1','existing_synthetic_manager_required');
  // No direct configuration-table update, disabled verifier or provider key.
  const secret='synthetic-current-recovery-'+randomUUID();
  sql('configure',`select public.custodial_configure_backend_execution_key(encode(extensions.digest(convert_to(${q(secret)},'UTF8'),'sha256'),'hex'),'current-release-recovery-synthetic');`);
  const healthSql=`select public.custodial_backend_authority_health(${q(secret)});`;
  const before=json('health_before',healthSql);assertHealth(before,m);
  function callers(phase) {
    assertHealth(json(phase+'_service',`begin;set local role service_role;${healthSql}rollback;`),m);
    for (const role of ROLE) {
      const r=raw(phase+'_denied_'+role,`begin;set local role ${role};select public.custodial_configure_backend_execution_key(${q('0'.repeat(64))},'denied-synthetic-fixture');rollback;`);
      requireThat(r.status!==0 && /ERROR:\s+42501\b/.test(r.stderr),'configuration_caller_not_denied_'+role);
    }
    for (const role of HEALTH_DENIED_ROLES) {
      const r=raw(phase+'_health_denied_'+role,`begin;set local role ${role};${healthSql}rollback;`);
      requireThat(r.status!==0 && /ERROR:\s+42501\b/.test(r.stderr),'health_caller_not_denied_'+role);
    }
    const wrong=raw(phase+'_wrong_secret',"begin;set local role service_role;select public.custodial_backend_authority_health('wrong-synthetic-proof-not-a-credential');rollback;");
    requireThat(wrong.status!==0 && /ERROR:\s+42501\b/.test(wrong.stderr),'wrong_proof_not_denied');
  }
  callers('callers_before');
  const controls=[];
  function control(action) {
    const request_id=randomUUID(), pending={manager_id:m.manager_id,request_id,device_identifier:'KIOSK_08',action};
    try {
      const result=json(action,`set role service_role;select public.custodial_control_release_canary(${q(m.manager_id)}::uuid,${q(request_id)}::uuid,'KIOSK_08',${q(action)},${q(CONTROL_REASON)},${q(JSON.stringify(CONTROL_HEALTH))}::jsonb,${q(secret)});`);
      exactKeys(result,['device_identifier','canary_paused','restored_objects','audit_id','replayed'],'control_receipt_shape');
      requireThat(result.device_identifier==='KIOSK_08' && result.replayed===false && UUID.test(result.audit_id),'control_receipt_identity');
      const observed=json(action+'_readback',`select jsonb_build_object('manager_id',requested_by_manager_id,'request_id',request_id,'device_identifier',device_identifier,'action',action,'reason',reason,'authoritative_health',authoritative_health,'audit_id',audit_id,'result',result_json) from public.custodial_release_canary_rollback_audits where audit_id=${q(result.audit_id)}::uuid;`);
      const {audit_id,replayed,...stored}=result;
      same(observed,{...pending,reason:CONTROL_REASON,authoritative_health:CONTROL_HEALTH,audit_id,result:stored},'control_original_readback');
      controls.push(observed);return result;
    } catch(error) { error.pending_control=pending;throw error; } // Unknown outcome: never resend.
  }
  const pause=control('pause_canary');requireThat(pause?.canary_paused===true && pause.restored_objects===0,'pause_not_confirmed');
  for (const row of [...m.faults,{...m.omitted_surface,omission:true}]) {
    const name=row.omission?'omission':'digest_'+row.kind;
    const mutation=row.omission?'delete from':'update';
    const statement=row.omission?`${mutation} public.custodial_release_authority_restore_inventory where object_kind=${q(row.kind)} and object_identity=${q(row.identity)};`
      :`${mutation} public.custodial_release_authority_restore_inventory set definition_sha256=repeat('0',64) where object_kind=${q(row.kind)} and object_identity=${q(row.identity)};`;
    // Quote the entire anonymous body as a SQL literal. A manifest identity may
    // legally contain a dollar delimiter; it must never close a DO code string.
    const body=`declare changed integer;begin ${statement} get diagnostics changed=row_count;if changed<>1 then raise exception 'exact one fault target required';end if;end;`;
    const fault=json(name,`begin;alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
      do ${q(body)};
      alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
      ${healthSql}rollback;`);
    assertHealth(fault,m,{kind:row.omission?'omission':'digest',identity:row.identity});
    inventory('rollback_'+name);surface('surface_'+name);protectedRows('protected_'+name);
    phases.push({kind:row.kind,identity:row.identity,fault:row.omission?'required_surface_inventory_omission':'captured_digest_mismatch',rollback_readback:true});
  }
  const restored=control('restore_authority');
  requireThat(restored?.canary_paused===true && restored.restored_objects===m.inventory.length,'restore_receipt_mismatch');
  const after=json('health_after',healthSql);assertHealth(after,m);
  inventory('inventory_after');surface('surface_after');const protectedAfter=protectedRows('protected_after');
  callers('callers_after');defaults('defaults_after');
  requireThat(sql('paused_after',`select public.custodial_release_canary_is_paused('KIOSK_08',${q(secret)});`)==='t','canary_not_left_paused');
  same(inspectTarget(run,m.target),target,'target_changed');same(localRecoverySource(root,run),m.source,'source_changed_during_probe');
  return {schema:'custodial.current-release-recovery-probe-receipt.v1',execution:fake?'FAKE_SUBPROCESS_UNIT_ONLY':'OWNED_SYNTHETIC_ENGINE',engine_executed:!fake,
    production:false,release_admission:false,manifest_sha256:hash(canonical(m)),source:m.source,target,controls,
    inventory_count:m.inventory.length,inventory_sha256:hash(canonical(m.inventory)),surface_count:m.surface.length,
    health_before:before,health_after:after,protected_rows:protectedAfter,rollback_faults:phases,
    restored_objects:restored.restored_objects,canary_left_paused:true,automatic_grants_absent:true,
    caller_checks:{intended_health_role:'service_role',denied_configuration_roles:ROLE,denied_health_roles:HEALTH_DENIED_ROLES,wrong_health_proof_denied:true},
    limits:['Captured-digest challenges are health-comparison sensitivity, not live-DDL corruption proof.','Existing owning live-DDL recovery tests and separate normal canonical capture remain required.','This helper neither resumes traffic nor establishes runtime/native/production authority.']};
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    requireThat(process.argv.length===4 && process.argv[2]==='--manifest','usage_manifest_file_only');
    const path=process.argv[3];requireThat(!/^[a-z]+:\/\//i.test(path),'manifest_url_forbidden');
    const bytes=readFileSync(path);requireThat(bytes.length<=8*1024*1024,'manifest_size');
    const receipt=runCurrentReleaseRecoveryProbe(parse(bytes.toString(),'manifest_json'));
    console.log(JSON.stringify(receipt));
  } catch (error) {
    // Never echo SQL, a fixture proof, arbitrary subprocess stderr or manifest contents.
    const code=/^[a-z0-9_]+$/.test(String(error.message))?error.message:'probe_failed';
    console.error(JSON.stringify({schema:'custodial.current-release-recovery-probe-failure.v1',ok:false,code,release_admission:false,pending_control:error.pending_control||null}));
    process.exitCode=1;
  }
}
