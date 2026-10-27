// External qualification control. No product archive format or admission change.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {sealFile,recipientIdentity,cleanupOwnedWork,extractSafe} from './g12-verified-backup-transfer.mjs';
const PRODUCT='4803109c968d874519f9dec2278089971bf3530b';
const TREE='2138a5cc4052c1fd4b98d5a9ef69fe7916879f3c';
const IMAGE='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const SCOPE='DERIVED_CI_POST_MIGRATION_PHYSICAL_CLONE_FOR_LOCAL_G12_NOT_V4_ARCHIVE';
const SHA=/^[a-f0-9]{64}$/;
const insist=(ok,message)=>{if(!ok)throw new Error(message);};
export function hashFile(file){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{insist(fs.fstatSync(fd).isFile(),'Regular file required.');const h=crypto.createHash('sha256'),b=Buffer.alloc(1024*1024);let n;while((n=fs.readSync(fd,b,0,b.length,null))!==0)h.update(b.subarray(0,n));return h.digest('hex');}finally{fs.closeSync(fd);}}
const privateJson=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const jsonSame=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function validatePlan(p){
 insist(p?.format==='custodial.g12.consistent-physical-export-plan.v1'&&p.scope===SCOPE,'Physical export scope required.');
 insist(p.product_commit===PRODUCT&&p.product_tree===TREE,'Exact product identity required.');
 insist(p.repository==='lasrevinu333-design/memphis-zoo-mcp'&&p.control_branch==='codex/custodial-g12-current48031-physical-clone-20261027','Exact repository/control branch required.');
 insist(p.backup_run_id===40454607125&&p.backup_artifact_id===12711908408&&p.original_zip_sha256==='7680d3df0ac42ce790a4af682483a6adbee5095990b27bd4cc6ae12ceca8d50f'&&p.archive_digest==='d3085a6c253c77dfc6f328f5d65d333b03d11d7f13d870585727b7415a52da52','Actual fresh backup metadata is pending or differs.');
 insist(p.target_ledger_count===395&&p.target_fingerprint==='f67580f03992120abd4086a9b53af98b05c29469eb140013221384df57bdd160','Exact captured target required.');
 insist(p.recipient_spki_sha256==='5326e1c6e1614045b9eaa536c5eb857a8079377e4b1aa01c6e7fb260303a70ff'
   &&recipientIdentity(p.recipient_public_key_pem).sha256===p.recipient_spki_sha256,'Exact Root task recipient required.');
 return p;
}
export function validateMigrationProof(rows,p){
 const migrated=rows.find(r=>r?.ok===true&&r.rehearsal===true&&r.candidate_commit===p.product_commit&&r.source_data_preservation);
 const proof=migrated?.source_data_preservation;
 insist(migrated?.candidate_tree===p.product_tree&&migrated.after_ledger_count===395&&migrated.target_catalog_fingerprint===p.target_fingerprint
   &&migrated.before_ledger_count===235&&Array.isArray(migrated.applied)&&migrated.applied.length===160,'Normal160 committed migration result missing.');
 insist(proof?.schema==='custodial.isolated-release-data-preservation.v1'&&proof.scope==='ISOLATED_EXISTING160_TRANSACTION_DATA_PROOF'
   &&proof.original_tables===217&&proof.original_public_tables===182&&proof.nonpublic_tables===35&&proof.nonpublic_exact_native_text===true
   &&proof.four_settings_constants_verified===true&&proof.relay_paused_no_migration_time_send_evidence===true&&proof.raw_values_exported===false
   &&Array.isArray(proof.tables)&&proof.tables.length===215&&proof.tables.every(t=>t.missing_rows==='0'),'Normal original217 preservation proof missing.');
 const terminal=[...rows].reverse().find(r=>r?.ok===true&&r.source_commit===p.product_commit&&r.archive_digest===p.archive_digest);
 insist(terminal?.source_tree===p.product_tree&&String(terminal.backup_run_id)===String(p.backup_run_id)&&terminal.target_migration_count===395
   &&terminal.target_catalog_fingerprint===p.target_fingerprint&&terminal.active_mutation_leases===0&&terminal.expired_mutation_leases===0
   &&terminal.authority_health===true&&terminal.direct_dml_denied===true&&terminal.live_production_reads===0,'Completed isolated candidate tail missing.');
 return {migration:migrated,terminal,proof};
}
export function validateDatabaseMetadata(m,p,runId){
 insist(m?.database?.name==='mz_schema_rebuild_'+runId&&/^[0-9]+$/.test(m.database.oid)&&m.database.owner==='postgres','Exact owned database identity required.');
 insist(m.actor?.name==='supabase_admin'&&m.actor.login===true&&(m.actor.superuser===true||m.actor.replication===true),'Existing replication-capable actor required; never grant it.');
 insist(m.settings?.server_version_num>=170000&&m.settings.server_version_num<180000&&['replica','logical'].includes(m.settings.wal_level)&&m.settings.full_page_writes==='on'
   &&m.settings.max_wal_senders>=2&&m.external_tablespaces===0,'Existing physical replication prerequisites required.');
 insist(Array.isArray(m.hba_rules)&&m.hba_rules.length>0&&m.hba_rules.every(r=>r.error===null),'Existing HBA rules must parse.');
 insist(m.hba_rules.some(r=>r.type==='local'&&r.database?.includes('replication')&&r.user_name?.some(u=>['all','supabase_admin'].includes(u))
   &&['trust','scram-sha-256','md5','peer'].includes(r.auth_method)),'Existing local replication HBA rule required; never modify HBA.');
 const c=m.control;
 insist(c?.state==='COMPLETE'&&c.mutations_paused===false&&c.archive_digest===p.archive_digest&&c.target_project_ref==='rqquvtjdmugpigbndmne'
   &&/^[a-f0-9-]{36}$/.test(c.restore_id)&&Number(c.authority_generation)>0,'Completed restored generation required.');
 insist(m.manifest?.database_verified===true&&m.manifest.storage_verified===true&&m.manifest.authority_invalidated===true&&m.manifest.post_restore_verified===true
   &&m.manifest.archive_digest===p.archive_digest&&SHA.test(m.manifest.final_manifest_sha256),'Completed original restore manifest required.');
 insist(m.open_discrepancies===0&&m.leases===0&&Object.values(m.usable_authority||{}).length===6&&Object.values(m.usable_authority).every(n=>n===0),'All authority revocations and zero leases required.');
 insist(m.ledger_count===395&&m.authority_health===true,'Current ledger and fresh-key authority health required.');
 return m;
}
export function inventoryTree(root){
 const result=[];function visit(dir){for(const name of fs.readdirSync(dir).sort()){
  const file=path.join(dir,name),s=fs.lstatSync(file),relative=path.relative(root,file).split(path.sep).join('/');
  insist(!s.isSymbolicLink(),'Snapshot symlinks are unsupported.');
  if(s.isDirectory())visit(file);else{insist(s.isFile()&&s.nlink===1,'Only ordinary snapshot files required.');result.push({path:relative,bytes:s.size,sha256:hashFile(file),mode:s.mode&0o777});}
 }}visit(root);return result;
}
export function verifyCopiedBackup(root){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'backup_manifest')));
 insist(manifest['PostgreSQL-Backup-Manifest-Version']>=1&&Array.isArray(manifest.Files)&&Array.isArray(manifest['WAL-Ranges'])&&manifest['WAL-Ranges'].length>0,'Native backup manifest and WAL ranges required.');
 for(const f of manifest.Files){
  insist(typeof f.Path==='string'&&!path.isAbsolute(f.Path)&&!f.Path.split('/').includes('..')&&!f.Path.includes('\\')&&f['Checksum-Algorithm']==='SHA256'&&SHA.test(f.Checksum),'Closed SHA256 manifest entry required.');
  const file=path.join(root,f.Path);insist(fs.statSync(file).size===f.Size&&hashFile(file)===f.Checksum,'Copied basebackup manifest checksum mismatch.');
 }
 insist(fs.readFileSync(path.join(root,'PG_VERSION'),'utf8').trim()==='17','Same PGmajor17 required.');
 return {backup_manifest_sha256:hashFile(path.join(root,'backup_manifest')),manifest_files:manifest.Files.length,wal_ranges:manifest['WAL-Ranges'],files:inventoryTree(root)};
}
export function verifyChecksumBatch(text,batch,inside){
 const lines=text.trimEnd().split('\n');insist(lines.length===batch.length,'Complete checksum batch required.');
 batch.forEach((f,i)=>{insist(/^[A-Za-z0-9_./-]+$/.test(f.path)&&!f.path.split('/').includes('..'),'Closed basebackup path required.');
  insist(lines[i]===f.sha256+'  '+inside+'/'+f.path,'Copied verified backup file/order differs.');});
}
let childDeadline=Infinity;
function execute(command,args,{input,env={PATH:'/usr/bin:/bin'},timeout=120000}={}){
 timeout=Math.min(timeout,Math.max(0,childDeadline-Date.now()));insist(timeout>0,'Finite export/cleanup deadline reached.');
 const started=new Date().toISOString(),r=spawnSync(command,args,{input,env,encoding:'utf8',timeout,maxBuffer:16*1024*1024});
 // Never print raw command, input, env or child output. Private originals below
 // are allowlisted metadata/tool commands only, not credential-bearing calls.
 insist(!r.error&&r.status===0,'Owned physical-export subprocess refused: '+path.basename(command));
 return {stdout:r.stdout,started_at:started,finished_at:new Date().toISOString(),exit_code:r.status};
}
export async function exportClone(planFile){
 const p=validatePlan(JSON.parse(fs.readFileSync(planFile))),e=process.env;childDeadline=Date.now()+12*60*1000;
 insist(e.GITHUB_ACTIONS==='true'&&e.GITHUB_REPOSITORY===p.repository&&e.GITHUB_EVENT_NAME==='workflow_dispatch'
   &&e.GITHUB_REF==='refs/heads/'+p.control_branch&&e.GITHUB_RUN_ATTEMPT==='1'&&/^[1-9][0-9]*$/.test(e.GITHUB_RUN_ID||'')&&/^[a-f0-9]{40}$/.test(e.GITHUB_SHA||''),'Genuine reviewed Actions control required.');
 const product=fs.realpathSync(process.cwd());
 const git=args=>execute('/usr/bin/git',args).stdout.trim();
 insist(git(['rev-parse','HEAD'])===p.product_commit&&git(['rev-parse','HEAD^{tree}'])===p.product_tree&&git(['status','--porcelain'])==='','Actual product checkout must be clean.');
 const root=fs.realpathSync(e.RUNNER_TEMP),work=fs.mkdtempSync(path.join(root,'g12-transfer-'));fs.chmodSync(work,0o700);
 const s=fs.statSync(work),owner=path.join(root,'g12-physical-export-owned-work.json');
 privateJson(owner,{format:'custodial.g12.transfer-owned-work.v1',directory:work,dev:s.dev,ino:s.ino,uid:s.uid});
 const runId=e.GITHUB_RUN_ID,name='mz_schema_rebuild_'+runId,inside='/tmp/g12-basebackup-'+runId;
 let cid=null,success=false,outputIdentity=null,insideIdentity=null;const output=path.join(root,'g12-physical-ciphertext');
 const docker=(args,opts)=>execute('/usr/bin/docker',args,opts);
 const inspect=()=>JSON.parse(docker(['inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"reference":{{json .Config.Image}},"running":{{json .State.Running}},"privileged":{{json .HostConfig.Privileged}},"ports":{{json .NetworkSettings.Ports}},"mounts":{{json .Mounts}}}',name]).stdout);
 const assertContainer=()=>{const m=inspect();insist(m.id===cid&&m.running===true&&m.image===image.id&&m.reference===IMAGE&&m.name==='/'+name&&m.privileged===false
   &&Array.isArray(m.mounts)&&m.mounts.length>0&&m.mounts.every(x=>x.Type==='tmpfs')
   &&m.ports?.['5432/tcp']?.length===1&&m.ports['5432/tcp'][0].HostIp==='127.0.0.1','Exact original owned container changed.');return m;};
 const sql=text=>{assertContainer();const r=docker(['exec','-i',cid,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',name],{input:"set log_statement='none';set log_min_error_statement='panic';set log_error_verbosity='terse';set log_parameter_max_length=0;set log_parameter_max_length_on_error=0;\n"+text+';\n'});return r.stdout.trim();};
 let image;
 try{
  image=JSON.parse(docker(['image','inspect','--format','{"id":{{json .Id}},"digests":{{json .RepoDigests}}}',IMAGE]).stdout);
  insist(/^sha256:[a-f0-9]{64}$/.test(image.id)&&image.digests?.includes(IMAGE),'Exact pinned image digest required.');cid=inspect().id;insist(/^[a-f0-9]{64}$/.test(cid),'Original CID required.');assertContainer();
  const api=await import(pathToFileURL(path.join(product,'scripts/json-value-stream.mjs')));
  const receipt=path.join(root,'production-backup-migration-rehearsal.jsonl'),rows=api.parseJsonValueStream(fs.readFileSync(receipt,'utf8'),'Existing normal rehearsal results');
  const normal=validateMigrationProof(rows,p);
  const keyNames=['backend_proof_secret','native_route_proof_secret','device_credential_secret','ops_manager_session_secret'];
  const keys={};for(const k of keyNames){const value=e['G12_LOCAL_'+k.toUpperCase()];insist(/^[a-f0-9]{64}$/.test(value||''),'Fresh task-only runtime key missing.');keys[k]=value;}
  insist(new Set(Object.values(keys)).size===4,'Local signing keys must be independent.');
  const backendDigest=crypto.createHash('sha256').update(keys.backend_proof_secret).digest('hex');
  const stateQuery=`select json_build_object(
   'database',json_build_object('name',current_database(),'oid',(select oid::text from pg_database where datname=current_database()),'owner',(select datdba::regrole::text from pg_database where datname=current_database())),
   'actor',(select json_build_object('name',rolname,'login',rolcanlogin,'superuser',rolsuper,'replication',rolreplication) from pg_roles where rolname=current_user),
   'settings',json_build_object('server_version_num',current_setting('server_version_num')::int,'server_version',current_setting('server_version'),'wal_level',current_setting('wal_level'),'full_page_writes',current_setting('full_page_writes'),'max_wal_senders',current_setting('max_wal_senders')::int,'data_directory',current_setting('data_directory'),'shared_preload_libraries',current_setting('shared_preload_libraries'),'ssl',current_setting('ssl'),'ssl_cert_file',current_setting('ssl_cert_file'),'ssl_key_file',current_setting('ssl_key_file'),'ssl_ca_file',current_setting('ssl_ca_file'),'config_file',current_setting('config_file'),'hba_file',current_setting('hba_file'),'ident_file',current_setting('ident_file'),'cron_database',current_setting('cron.database_name'),'cron_active',current_setting('cron.launch_active_jobs')),
   'system_identifier',(select system_identifier::text from pg_control_system()),
     'hba_rules',(select coalesce(json_agg(r order by rule_number),'[]'::json) from pg_hba_file_rules r),
   'config_sources',(select coalesce(json_agg(distinct sourcefile),'[]'::json) from pg_file_settings),
   'external_tablespaces',(select count(*)::int from pg_tablespace where spcname not in('pg_default','pg_global')),
   'control',(select row_to_json(c) from custodial_dr.restore_control c where singleton=true),
   'manifest',(select row_to_json(m) from custodial_dr.restore_manifests m join custodial_dr.restore_control c using(restore_id) where c.singleton=true),
   'open_discrepancies',(select count(*)::int from custodial_dr.restore_discrepancies d join custodial_dr.restore_control c using(restore_id) where c.singleton=true and d.status='OPEN'),
   'leases',(select count(*)::int from custodial_dr.application_mutation_leases),
   'usable_authority',json_build_object('employee_credentials',(select count(*)::int from public.device_auth_credentials where revoked_at is null),'employee_enrollment',(select count(*)::int from public.device_auth_enrollment_codes where revoked_at is null),'manager_trust',(select count(*)::int from public.ops_manager_trusted_devices where revoked_at is null),'manager_enrollment',(select count(*)::int from public.ops_manager_enrollment_codes where status='active' and revoked_at is null),'manager_push',(select count(*)::int from public.ops_manager_push_devices where coalesce(enabled,true)=true or revoked_at is null),'auth_sessions',(select count(*)::int from auth.sessions)),
   'ledger_count',(select count(*)::int from supabase_migrations.schema_migrations),
   'authority_health',coalesce((public.custodial_backend_authority_health('${keys.backend_proof_secret}')->>'ok')::boolean,false))`;
  // Keys are sent only through private stdin; no SQL/args/output/key is logged.
  const catalogPreflight=()=>{const r=execute(process.execPath,['scripts/refresh-schema-fingerprint.mjs','--target-preflight'],{env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',SCHEMA_FINGERPRINT_DOCKER_CONTAINER:name,SCHEMA_FINGERPRINT_DATABASE:name}});const v=JSON.parse(r.stdout);insist(v.ok===true&&v.mode==='target-preflight'&&v.schema_fingerprint===p.target_fingerprint,'Current target catalog differs after normal runtime setup.');return r.stdout;};
  const catalogBefore=catalogPreflight();
  const before=validateDatabaseMetadata(JSON.parse(sql(stateQuery)),p,runId);
  insist(before.settings.cron_database===name&&before.settings.cron_active==='off','Scheduler must remain disabled.');
  const payload=path.join(work,'payload');fs.mkdirSync(payload,{mode:0o700});
  const proofDir=path.join(payload,'normal-ci-proof');fs.mkdirSync(proofDir,{mode:0o700});fs.copyFileSync(receipt,path.join(proofDir,'normal-rehearsal-results.jsonl'));
  privateJson(path.join(proofDir,'NORMAL_160_AND_217_PROOF.json'),normal);
  const ghEnv={PATH:'/usr/bin:/bin',GH_TOKEN:e.GH_TOKEN};
  const originalRun=JSON.parse(execute('/usr/bin/gh',['api','--method','GET','repos/'+p.repository+'/actions/runs/'+p.backup_run_id],{env:ghEnv}).stdout);
  const originalArtifact=JSON.parse(execute('/usr/bin/gh',['api','--method','GET','repos/'+p.repository+'/actions/artifacts/'+p.backup_artifact_id],{env:ghEnv}).stdout);
  insist(originalRun.id===p.backup_run_id&&originalRun.head_sha===p.product_commit&&originalRun.run_attempt===1&&originalRun.status==='completed'&&originalRun.conclusion==='success'&&originalRun.event==='workflow_dispatch'&&originalRun.path==='.github/workflows/production-disaster-recovery-backup.yml','Original fresh backup run differs.');
  insist(originalArtifact.id===p.backup_artifact_id&&originalArtifact.digest==='sha256:'+p.original_zip_sha256&&originalArtifact.name==='memphis-zoo-disaster-recovery-'+p.backup_run_id&&originalArtifact.expired===false&&originalArtifact.size_in_bytes===15482225&&originalArtifact.workflow_run?.id===p.backup_run_id&&originalArtifact.workflow_run?.head_sha===p.product_commit,'Original fresh backup artifact differs.');
  const zipResult=spawnSync('/usr/bin/gh',['api','--method','GET','repos/'+p.repository+'/actions/artifacts/'+p.backup_artifact_id+'/zip'],{env:ghEnv,timeout:120000,maxBuffer:32*1024*1024});
  insist(!zipResult.error&&zipResult.status===0&&Buffer.isBuffer(zipResult.stdout)&&zipResult.stdout.length===15482225&&crypto.createHash('sha256').update(zipResult.stdout).digest('hex')===p.original_zip_sha256,'Actual original ZIP bytes differ.');
  const originalZip=path.join(proofDir,'original-artifact.zip');fs.writeFileSync(originalZip,zipResult.stdout,{flag:'wx',mode:0o600});zipResult.stdout.fill(0);
  const zipMember=path.join(work,'verified-original-zip-member');fs.mkdirSync(zipMember,{mode:0o700});extractSafe(originalZip,zipMember,'zip');
  insist(hashFile(path.join(zipMember,'memphis-zoo-backup.tar.gz.enc'))===hashFile(path.join(root,'encrypted-backup/memphis-zoo-backup.tar.gz.enc')),'Normal CI decrypted a different encrypted archive.');
  const sourceRoot=path.join(root,'production-backup');
  fs.copyFileSync(path.join(root,'memphis-zoo-backup.tar.gz'),path.join(proofDir,'original-production-backup.tar.gz'));
  for(const file of ['archive-signature.json','backup-summary.json','SHA256SUMS'])fs.copyFileSync(path.join(sourceRoot,file),path.join(proofDir,file));
  insist(hashFile(path.join(sourceRoot,'SHA256SUMS'))===p.archive_digest,'Original authenticated archive digest changed.');
  const uidgid=docker(['exec',cid,'id','postgres']).stdout.trim();insist(/^uid=\d+\(postgres\) gid=\d+\(postgres\)/.test(uidgid),'Actual postgres UID/GID required.');
  docker(['exec','--user','postgres',cid,'mkdir','--mode=0700','--',inside]);insideIdentity=docker(['exec',cid,'stat','-c','%d:%i:%u',inside]).stdout.trim();insist(/^[0-9]+:[0-9]+:[0-9]+$/.test(insideIdentity),'Created basebackup directory identity required.');
  const baseArgs=['exec','--user','postgres',cid,'pg_basebackup','--host=/var/run/postgresql','--username=supabase_admin','--no-password','--pgdata='+inside,'--format=plain','--wal-method=stream','--checkpoint=fast','--manifest-checksums=SHA256'];
  const baseWait=docker(baseArgs,{timeout:300000});assertContainer();
  const verifyWait=docker(['exec','--user','postgres',cid,'pg_verifybackup',inside],{timeout:180000});assertContainer();
  const physical=path.join(payload,'physical-cluster');fs.mkdirSync(physical,{mode:0o700});docker(['cp',cid+':'+inside+'/.',physical],{timeout:180000});
  const copied=verifyCopiedBackup(physical);
  // Compare every copied file, including streamed WAL absent from Files list,
  // against the exact verified basebackup, never against live PGDATA.
  for(let offset=0;offset<copied.files.length;offset+=100){
   const batch=copied.files.slice(offset,offset+100);assertContainer();
   for(const f of batch)insist(/^[A-Za-z0-9_./-]+$/.test(f.path)&&!f.path.split('/').includes('..'),'Closed basebackup path required.');
   const got=docker(['exec',cid,'sha256sum','--',...batch.map(f=>inside+'/'+f.path)]).stdout;verifyChecksumBatch(got,batch,inside);
  }
  const config=path.join(payload,'external-config');fs.mkdirSync(config,{mode:0o700});
  const configFiles=new Set([before.settings.config_file,before.settings.hba_file,before.settings.ident_file,...before.config_sources,...before.hba_rules.map(r=>r.file_name).filter(Boolean),...[before.settings.ssl_cert_file,before.settings.ssl_key_file,before.settings.ssl_ca_file].filter(x=>x&&path.isAbsolute(x))]);
  const configuration=[];
  for(const file of configFiles){
   if(file===before.settings.data_directory+'/postgresql.auto.conf')continue;
   insist(typeof file==='string'&&(/^\/etc\/postgresql(?:-custom)?\/[A-Za-z0-9_./-]+$/.test(file)||/^\/etc\/ssl\/(?:certs|private)\/[A-Za-z0-9_.-]+$/.test(file))&&!file.split('/').includes('..'),'Unexpected external configuration source.');
   const out=path.join(config,file.slice(1));fs.mkdirSync(path.dirname(out),{recursive:true,mode:0o700});assertContainer();docker(['cp','-L',cid+':'+file,out]);
   const h=hashFile(out);insist(docker(['exec',cid,'sha256sum','--',file]).stdout.slice(0,64)===h,'External config copy differs.');configuration.push({source_path:file,payload_path:'external-config/'+file.slice(1),sha256:h,bytes:fs.statSync(out).size});
  }
  const catalogAfter=catalogPreflight();insist(catalogBefore===catalogAfter,'Postmigration target catalog changed during physical export.');
  const after=validateDatabaseMetadata(JSON.parse(sql(stateQuery)),p,runId);insist(jsonSame(before,after),'Completed/control/authority/config metadata changed during physical export.');
  const roleSecrets={};for(const k of ['AUTHENTICATOR_PASSWORD','READER_PASSWORD','SCHEDULER_PASSWORD','JWT_SECRET','SERVICE_ROLE_JWT']){insist(typeof e['G12_LOCAL_'+k]==='string'&&e['G12_LOCAL_'+k].length>=32,'CI-local runtime credential missing.');roleSecrets[k.toLowerCase()]=e['G12_LOCAL_'+k];}
  const credentials={format:'custodial.g12.ci-local-runtime-credentials.v1',scope:SCOPE,production_keys_exported:false,...keys,...roleSecrets,
   bootstrap_database_user:'supabase_admin',bootstrap_database_password:'postgres',database_name:name,readonly_role:'custodial_readonly_runtime_20991231',scheduler_role:'static_weekly_runtime_20260823'};
  privateJson(path.join(payload,'LOCAL_RUNTIME_CREDENTIALS.json'),credentials);
  const provenance={format:'custodial.g12.consistent-physical-clone.v1',scope:SCOPE,product_commit:p.product_commit,product_tree:p.product_tree,
   control_commit:e.GITHUB_SHA,control_ref:e.GITHUB_REF,ci_run_id:runId,ci_attempt:1,repository:p.repository,
   original_backup:{run_id:p.backup_run_id,artifact_id:p.backup_artifact_id,zip_sha256:p.original_zip_sha256,archive_digest:p.archive_digest,actual_zip_digest_verified:true,original_hmac_verified_in_ci:true,original_hmac_verified_locally:false},
   physical_source:{container_id:cid,container_name:name,image_reference:IMAGE,image_id:image.id,pg_major:17,postgres_uid_gid:uidgid,original_pgdata:before.settings.data_directory,settings:before.settings,system_identifier:before.system_identifier,database:before.database},
   consistent_backup:{method:'pg_basebackup plain -X stream',pg_basebackup:{started_at:baseWait.started_at,finished_at:baseWait.finished_at,exit_code:0},pg_verifybackup:{started_at:verifyWait.started_at,finished_at:verifyWait.finished_at,exit_code:0},...copied},
   configuration_files:configuration,source_before:before,source_after:after,normal_ci_proof:{receipt_sha256:hashFile(receipt),migration_160_and_original217:true,standard_release_attestation_claim:false},
   task_only_key_binding:{backend_sha256:backendDigest,native_sha256:crypto.createHash('sha256').update(keys.native_route_proof_secret).digest('hex'),configured_in_normal_workflow:true},
   recipient_spki_sha256:p.recipient_spki_sha256,production_provider_claim:false,physical_device_claim:false,local_restore_claim:false};
  fs.writeFileSync(path.join(proofDir,'ACTUAL_TARGET_CATALOG_PREFLIGHT.json'),catalogAfter,{flag:'wx',mode:0o600});
  privateJson(path.join(payload,'PHYSICAL_CLONE_PROVENANCE.json'),provenance);
  privateJson(path.join(payload,'PAYLOAD_FILE_INVENTORY.json'),inventoryTree(payload));
  const bundle=path.join(work,'physical-payload.tar.gz');execute('/usr/bin/tar',['-czf',bundle,'-C',work,'payload'],{timeout:180000});
  fs.mkdirSync(output,{mode:0o700});outputIdentity=fs.lstatSync(output);
  const binding={scope:SCOPE,product_commit:p.product_commit,product_tree:p.product_tree,control_commit:e.GITHUB_SHA,ci_run_id:runId,ci_attempt:1,
   original_backup_run:p.backup_run_id,archive_digest:p.archive_digest,physical_provenance_sha256:hashFile(path.join(payload,'PHYSICAL_CLONE_PROVENANCE.json')),
   backup_manifest_sha256:copied.backup_manifest_sha256,system_identifier:before.system_identifier,database:before.database,recipient_spki_sha256:p.recipient_spki_sha256};
  const encrypted=await sealFile(bundle,path.join(output,'consistent-physical-clone.g12enc'),p.recipient_public_key_pem,binding);
  privateJson(path.join(output,'CIPHERTEXT_CUSTODY.json'),{format:'custodial.g12.physical-clone-ciphertext-custody.v1',binding,ciphertext_sha256:encrypted.ciphertext_sha256,ciphertext_bytes:encrypted.ciphertext_bytes,
   sender_authentication:'Collect exact reviewed GitHub control run and actual artifact digest independently. Recipient encryption alone is not sender authentication.',original_production_keys_exported:false});
  success=true;
 }finally{
  childDeadline=Date.now()+45000;
  // Only fixed /tmp basebackup in the same original live owned CID is removed;
  // no source PGDATA, archive or foreign container is ever removed here.
  try{if(cid&&insideIdentity){assertContainer();insist(docker(['exec',cid,'stat','-c','%d:%i:%u',inside]).stdout.trim()===insideIdentity,'Foreign basebackup directory preserved.');docker(['exec',cid,'rm','-rf','--',inside]);}}finally{
   cleanupOwnedWork(owner,root);if(!success&&outputIdentity){const current=fs.lstatSync(output);insist(current.isDirectory()&&!current.isSymbolicLink()&&current.dev===outputIdentity.dev&&current.ino===outputIdentity.ino,'Foreign cipher directory preserved.');fs.rmSync(output,{recursive:true});}
  }
 }
 console.log(JSON.stringify({scope:SCOPE,ciphertext_prepared:true,plaintext_work_absent:!fs.existsSync(work),release_attestation_claim:false}));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{insist(process.argv.length===3,'Only exact reviewed plan path required.');await exportClone(process.argv[2]);}catch{console.error('Consistent physical clone export refused; no local restore/admission claim.');process.exitCode=1;}}
