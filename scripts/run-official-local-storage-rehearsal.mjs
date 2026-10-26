// Explicit backup_only qualification: unmodified official Storage API, same
// signed original DB, archived FileBackend versions. Never a production target.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, mkdirSync, mkdtempSync, rmSync, statSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { createServer, createConnection, isIP } from 'node:net';

export const IMAGE = 'public.ecr.aws/supabase/storage-api@sha256:528ec49c3c32561908b07ee91bced7f8456f3b688164e341eaa422441767a0bd';
const PG_IMAGE = 'supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const CAP = 1024 * 1024, WORK_MS = 900000;
export function resourceProfile(profile){
  if(profile==='native-text-v4-existing-postgres')return Object.freeze({work_ms:900000,node_heap_mib:256,cpus:1,cleanup_ms:45000});
  if(profile==='immutable-private-fresh-supabase-admin')return Object.freeze({work_ms:1800000,node_heap_mib:384,cpus:1,cleanup_ms:45000});
  throw new Error('Only authenticated closed archive profiles select resource bounds.');
}
export function assertPinnedPgResources(value,cid,name){
  insist(value.Id===cid && value.Name==='/'+name && value.Config.Image===PG_IMAGE
    && value.HostConfig.Memory===1024**3 && value.HostConfig.MemorySwap===1024**3
    && value.HostConfig.NanoCpus===1e9 && value.HostConfig.PidsLimit===256,'Provider-only PG resource pin refused.');
  return true;
}
export function validatePinnedOfficialImage(value){
  insist(/^sha256:[a-f0-9]{64}$/.test(value.id) && Array.isArray(value.repo_digests) && value.repo_digests.includes(IMAGE)
    && (value.user===null || value.user===''),'Pinned registry reference and official default-root image required.');
  return value.id;
}
export async function closeOwnedRelay(relay,sockets,deadline){
  const owned=[...sockets],socketClosed=owned.map(socket=>new Promise(yes=>{socket.once('close',yes);socket.destroy();}));
  await new Promise((yes,no)=>{const timer=setTimeout(()=>no(new Error('Owned relay closure deadline exceeded.')),Math.max(1,Math.min(1000,deadline-Date.now())));
    const listenerClosed=new Promise((done,fail)=>relay.close(e=>e?fail(e):done()));
    Promise.all([listenerClosed,...socketClosed]).then(()=>{clearTimeout(timer);yes();},e=>{clearTimeout(timer);no(e);});});
  insist(!relay.listening && sockets.size===0,'Owned relay remains after actual socket close events.');
}
// Fixed same-transaction catalog locks for one authenticated disposable native
// original. No generic SQL or alternate restore actor is admitted.
export function nativeTextCatalogLockCapability(intent,target){
  insist(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(intent.restore_id)
    && /^[1-9][0-9]{0,18}$/.test(String(intent.authority_generation))
    && BigInt(intent.authority_generation)<=9223372036854775807n
    && /^[a-f0-9]{64}$/.test(intent.archive_digest)
    && /^[a-z0-9]{20}$/.test(intent.source_project_ref) && /^[a-z0-9]{20}$/.test(intent.target_project_ref)
    && /^mz_schema_rebuild_[A-Za-z0-9_]{1,100}$/.test(target.database_name)
    && /^[1-9][0-9]{0,9}$/.test(String(target.database_oid)) && BigInt(target.database_oid)<=4294967295n
    && target.database_owner==='postgres','Closed native original catalog capability identity required.');
  const body=`
BEGIN
  IF session_user <> 'postgres' OR current_user <> 'supabase_admin'
    OR current_setting('session_replication_role') <> 'origin'
    OR current_database() <> '${target.database_name}'
    OR (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) <> '${target.database_oid}'::pg_catalog.oid
    OR (SELECT count(*) FROM custodial_dr.restore_control
      WHERE singleton=true AND restore_id='${intent.restore_id}'::pg_catalog.uuid
        AND authority_generation='${intent.authority_generation}'::pg_catalog.int8
        AND archive_digest='${intent.archive_digest}'
        AND source_project_ref='${intent.source_project_ref}' AND target_project_ref='${intent.target_project_ref}'
        AND mutations_paused=true AND state IN ('PREPARING','STORAGE_RESTORING')) <> 1
  THEN RAISE EXCEPTION 'Fixed native original catalog lock authority refused' USING ERRCODE='42501'; END IF;
  LOCK TABLE pg_catalog.pg_type,pg_catalog.pg_proc,pg_catalog.pg_cast,pg_catalog.pg_namespace,pg_catalog.pg_enum,pg_catalog.pg_range IN SHARE MODE;
END;
`;
  const definition="CREATE OR REPLACE FUNCTION custodial_dr.native_text_lock_catalogs_v1()\n RETURNS void\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog'\nAS $function$"+body+"$function$\n";
  return {identity:'custodial_dr.native_text_lock_catalogs_v1()',body,definition,owner:'supabase_admin',
    acl:[{grantee:'postgres',grantor:'supabase_admin',privilege:'EXECUTE',grantable:false},
      {grantee:'supabase_admin',grantor:'supabase_admin',privilege:'EXECUTE',grantable:false}]};
}
const NATIVE_LOCK_INSPECT_SQL=`select p.oid::text oid,p.prosrc body,pg_catalog.pg_get_functiondef(p.oid) definition,
 pg_catalog.pg_get_userbyid(p.proowner) owner,p.prosecdef security_definer,p.proconfig config,
 p.proacl::text acl_text,p.prokind::text kind,p.prorettype::pg_catalog.regtype::text returns,p.pronargs args,
 (select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
 'grantor',pg_catalog.pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)
 order by (case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end) collate "C",a.privilege_type)
 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner)))a) acl
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname='custodial_dr' and p.proname='native_text_lock_catalogs_v1'`;
export function requireExactNativeLock(row,plan,oid=null){
  insist(row && /^[1-9][0-9]*$/.test(row.oid) && (!oid || row.oid===oid) && row.body===plan.body
    && row.definition===plan.definition && row.owner===plan.owner && row.security_definer===true
    && stable(row.config)===stable(['search_path=pg_catalog']) && row.kind==='f' && row.returns==='void' && row.args===0 && typeof row.acl_text==='string'
    && stable(row.acl)===stable(plan.acl),'Fixed native catalog lock capability identity changed.');
  return row;
}
let stopping=false;const liveGroups=new Set();
function stop(){stopping=true;for(const pid of liveGroups)try{process.kill(-pid,'SIGKILL');}catch{}}
const inspectFormat='{"Id":{{json .Id}},"ImageId":{{json .Image}},"Name":{{json .Name}},"Config":{"Image":{{json .Config.Image}},"Labels":{{json .Config.Labels}}},"HostConfig":{"Memory":{{json .HostConfig.Memory}},"MemorySwap":{{json .HostConfig.MemorySwap}},"NanoCpus":{{json .HostConfig.NanoCpus}},"ReadonlyRootfs":{{json .HostConfig.ReadonlyRootfs}},"PidsLimit":{{json .HostConfig.PidsLimit}}},"State":{{json .State}},"NetworkSettings":{"Ports":{{json .NetworkSettings.Ports}},"Networks":{{json .NetworkSettings.Networks}}}}';
const hash = value => createHash('sha256').update(value).digest('hex');
export const stable = value => JSON.stringify(value,(_,v)=>v && typeof v==='object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
const insist = (value,message) => { if(!value) throw new Error(message); };
const pause = ms => new Promise(r=>setTimeout(r,ms));
const sign = (value,key) => createHmac('sha256',key).update(stable(value)).digest('hex');
function durable(path,value,mode=0o600){const fd=openSync(path,'wx',mode);try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}}
function ticks(pid){return readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ')[19];}
function memoryFloor(bytes){const m=/^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync('/proc/meminfo','utf8'));insist(m && Number(m[1])*1024>=bytes,'Insufficient available memory.');}
export function selectedMode(env){
  insist(env.REHEARSAL_SCOPE==='backup_only' && env.OFFICIAL_LOCAL_STORAGE_PROVIDER==='true','Explicit backup_only provider opt-in required.');
  insist(env.RESTORE_APPLY==='true' && env.RESTORE_DATABASE_ONLY==='true','Original whole database-only APPLY required.');
  const u=new URL(env.SUPABASE_DB_URL);
  insist(['postgres:','postgresql:'].includes(u.protocol) && u.hostname==='127.0.0.1' && !u.search && !u.hash
    && /^mz_schema_rebuild_[A-Za-z0-9_]+$/.test(u.pathname.slice(1)),'Owned loopback database required.');
  return u;
}
export function storageResult(result,archive,intent){
  insist(result.ok===true && result.restore_id===intent.restore_id && result.authority_generation===intent.authority_generation
    && result.database_only===true && result.mutations_paused===true && result.state==='PAUSED_RECONCILIATION'
    && result.database_tables===Number(archive.summary.table_count) && String(result.database_rows)===String(archive.summary.database_row_count),
    'Normal original restore result did not match the authenticated source.');
  const s=result.storage;
  insist(s?.provider_verified===true && s.object_bytes_verified===true && s.metadata_and_ownership_verified===true
    && s.scope==='OFFICIAL_LOCAL_FILE_BACKEND_SAME_ORIGINAL' && s.production_provider_verified===false
    && Array.isArray(s.owner_access_probes) && s.owner_access_probes.length===Number(archive.summary.storage_object_count)
    && s.owner_access_probes.every(p=>p.status==='VERIFIED_CURRENT_RESTORED_ROLE_BOUNDARY'),
    'Official local provider and exact original metadata verification required.');
  return result;
}

// One original process group per invocation. Actual wait is durable before
// absence/cleanup assertions; no secret-bearing argv or environment is logged.
function runner(root,getDeadline,cleanupBudget){let sequence=0;return async function run(argv,{env=process.env,seconds=60,cleanup=false,input=null}={}){
  if(cleanup)cleanupBudget.deadline??=Date.now()+45000;
  insist(cleanup?Date.now()<cleanupBudget.deadline:!stopping && Date.now()<getDeadline(),'Original work/cleanup deadline exhausted before child birth.');
  if(!cleanup)memoryFloor(2*1024**3);
  const number=String(++sequence).padStart(3,'0'),prefix=resolve(root,number),started=Date.now();
  durable(prefix+'.INTENT.json',{original:true,program:argv[0],argument_sha256:hash(stable(argv.slice(1))),started,seconds});
  let child,owner,code,signal,error;const chunks=[[],[]],sizes=[0,0];
  try{
    child=spawn(argv[0],argv.slice(1),{env,detached:true,stdio:[input===null?'ignore':'pipe','pipe','pipe']});liveGroups.add(child.pid);
    const completion=new Promise((done,reject)=>{child.once('error',reject);child.once('exit',(c,s)=>done([c,s]));});completion.catch(()=>{});
    owner={pid:child.pid,pgid:child.pid,proc_start_ticks:ticks(child.pid)};durable(prefix+'.OWNER.json',owner);
    if(input!==null){insist(typeof input==='string' && Buffer.byteLength(input,'utf8')<=4096,'Fixed private stdin bound exceeded.');child.stdin.on('error',()=>{error??=new Error('Private original stdin refused.');});child.stdin.end(input);}
    for(const [i,stream] of [child.stdout,child.stderr].entries())stream.on('data',chunk=>{
      sizes[i]+=chunk.length;if(sizes[i]>CAP){error=new Error('Original stream exceeded finite bound.');try{process.kill(-child.pid,'SIGKILL');}catch{}}
      else chunks[i].push(chunk);
    });
    const limit=Math.min(seconds*1000,Math.max(1,(cleanup?cleanupBudget.deadline:getDeadline())-Date.now()-2000));
    const timer=setTimeout(()=>{error=new Error('Original child deadline exhausted.');try{process.kill(-child.pid,'SIGKILL');}catch{}},limit);
    try{[code,signal]=await completion;}finally{clearTimeout(timer);}
    durable(prefix+'.ACTUAL_WAIT.json',{...owner,code,signal,elapsed_ms:Date.now()-started});liveGroups.delete(child.pid);
    const drained=await Promise.race([Promise.all([child.stdout,child.stderr].map(stream=>stream.readableEnded?Promise.resolve():new Promise(r=>stream.once('end',r)))).then(()=>true),pause(2000).then(()=>false)]);
    if(!drained){try{process.kill(-child.pid,'SIGKILL');}catch{};child.stdout.destroy();child.stderr.destroy();error??=new Error('Original stream drain deadline exceeded.');}
    for(const [i,suffix] of ['stdout','stderr'].entries())writeFileSync(prefix+'.'+suffix,Buffer.concat(chunks[i]),{mode:0o600,flag:'wx'});
    try{process.kill(-child.pid,0);throw new Error('Original group remains after wait.');}catch(e){if(e.code!=='ESRCH')throw e;}
    insist(!existsSync(`/proc/${child.pid}`),'Original PID remains after wait.');
    if(error)throw error;insist(code===0,'Original child refused; private streams retained.');
    return Buffer.concat(chunks[0]).toString('utf8');
  }catch(e){
    if(child?.pid && code===undefined){try{process.kill(-child.pid,'SIGKILL');}catch{}
      await new Promise(r=>child.exitCode!==null||child.signalCode!==null?r():child.once('exit',r));
      if(!existsSync(prefix+'.ACTUAL_WAIT.json'))durable(prefix+'.ACTUAL_WAIT.json',{...owner,code:child.exitCode,signal:child.signalCode,setup_failure:true});}
    liveGroups.delete(child?.pid);throw e;
  }
};}

async function originalRows(archive,tableName,api){
  const data=api.openVerifiedRestoreTableData(archive,'storage',tableName),rows=[];
  try{
    for await(const line of createInterface({input:data.stream,crlfDelay:Infinity})){
      insist(rows.length<65536,'Archived row bound exceeded.');
      rows.push(JSON.parse(api.decodeRestoreTableRowLine(line,data.table)));
    }
    await data.verified;insist(String(rows.length)===data.table.row_count,'Archived row count mismatch.');return rows;
  }finally{await data.close();}
}

// Executed by the pinned official image before its unchanged entrypoint. This
// code writes only FILE bytes; all metadata is restored by the normal CLI.
// Fixed catalog-only observation, shared byte-for-byte by gate and host.
// No pg_authid, password fields, operational rows, or caller-selected SQL.
export const STORAGE_CREDENTIAL_NONSECRET_SQL = `select jsonb_build_object(
    'role',(select jsonb_build_object('oid',oid,'name',rolname,'super',rolsuper,'inherit',rolinherit,'createrole',rolcreaterole,'createdb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'connection_limit',rolconnlimit,'valid_until',rolvaliduntil,'bypassrls',rolbypassrls,'config',rolconfig) from pg_roles where rolname='supabase_storage_admin'),
    'memberships',(select coalesce(jsonb_agg(to_jsonb(m) order by roleid,member,grantor),'[]'::jsonb) from pg_auth_members m),
    'schemas',(select coalesce(jsonb_agg(jsonb_build_array(oid,nspname,nspowner,nspacl) order by oid),'[]'::jsonb) from pg_namespace),
    'relations',(select coalesce(jsonb_agg(jsonb_build_array(oid,relowner,relacl) order by oid),'[]'::jsonb) from pg_class),
    'columns',(select coalesce(jsonb_agg(jsonb_build_array(attrelid,attnum,attacl) order by attrelid,attnum),'[]'::jsonb) from pg_attribute where attacl is not null),
    'routines',(select coalesce(jsonb_agg(jsonb_build_array(oid,proowner,proacl) order by oid),'[]'::jsonb) from pg_proc),
    'defaults',(select coalesce(jsonb_agg(to_jsonb(d) order by oid),'[]'::jsonb) from pg_default_acl d),
    'databases',(select coalesce(jsonb_agg(jsonb_build_array(oid,datdba,datacl) order by oid),'[]'::jsonb) from pg_database),
    'role_settings',(select coalesce(jsonb_agg(to_jsonb(d) order by setdatabase,setrole),'[]'::jsonb) from pg_db_role_setting d)
    ) snapshot`;
export const STORAGE_CATALOG_SQL = `with ns as (select oid from pg_namespace where nspname='storage'),
rr as (select oid from pg_roles where rolname in ('postgres','supabase_admin','supabase_storage_admin','anon','authenticated','service_role','authenticator')
 union select nspowner from pg_namespace where oid in(select oid from ns)
 union select relowner from pg_class where relnamespace in(select oid from ns)
 union select proowner from pg_proc where pronamespace in(select oid from ns))
select jsonb_build_object(
 'schema',(select jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text) order by nspname) from pg_namespace where oid in(select oid from ns)),
 'relations',(select jsonb_agg(jsonb_build_object('name',relname,'kind',relkind,'owner',pg_get_userbyid(relowner),'acl',relacl::text,'options',reloptions,'rls',relrowsecurity,'force_rls',relforcerowsecurity,'persistence',relpersistence,'replica_identity',relreplident) order by relname) from pg_class where relnamespace in(select oid from ns)),
 'columns',(select jsonb_agg(jsonb_build_object('relation',c.relname,'name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'collation',a.attcollation::regcollation::text,'acl',a.attacl::text,'default',pg_get_expr(d.adbin,d.adrelid)) order by c.relname,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where c.relnamespace in(select oid from ns) and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(jsonb_build_object('relation',c.relname,'name',x.conname,'type',x.contype,'deferrable',x.condeferrable,'deferred',x.condeferred,'validated',x.convalidated,'definition',pg_get_constraintdef(x.oid,false)) order by c.relname,x.conname) from pg_constraint x left join pg_class c on c.oid=x.conrelid where x.connamespace in(select oid from ns)),
 'indexes',(select jsonb_agg(jsonb_build_object('relation',t.relname,'name',c.relname,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'primary',i.indisprimary) order by t.relname,c.relname) from pg_index i join pg_class c on c.oid=i.indexrelid join pg_class t on t.oid=i.indrelid where t.relnamespace in(select oid from ns)),
 'routines',(select jsonb_agg(jsonb_build_object('name',p.proname,'identity_arguments',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'security_definer',p.prosecdef,'language',l.lanname,'kind',p.prokind,'arguments',p.proargtypes::text,'return_type',format_type(p.prorettype,null),'definition',case when p.prokind in ('f','p') then pg_get_functiondef(p.oid) else p.prosrc end) order by p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_language l on l.oid=p.prolang where p.pronamespace in(select oid from ns)),
 'views',(select jsonb_agg(jsonb_build_object('name',relname,'definition',pg_get_viewdef(oid,false)) order by relname) from pg_class where relnamespace in(select oid from ns) and relkind in ('v','m')),
 'sequences',(select jsonb_agg(jsonb_build_object('name',c.relname,'type',format_type(q.seqtypid,null),'start',q.seqstart::text,'increment',q.seqincrement::text,'max',q.seqmax::text,'min',q.seqmin::text,'cache',q.seqcache::text,'cycle',q.seqcycle) order by c.relname) from pg_sequence q join pg_class c on c.oid=q.seqrelid where c.relnamespace in(select oid from ns)),
 'triggers',(select jsonb_agg(jsonb_build_object('relation',c.relname,'name',t.tgname,'enabled',t.tgenabled,'internal',t.tgisinternal,'definition',pg_get_triggerdef(t.oid,false)) order by c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace in(select oid from ns)),
 'policies',(select jsonb_agg(jsonb_build_object('relation',c.relname,'name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',(select jsonb_agg(case when x=0 then 'PUBLIC' else pg_get_userbyid(x) end order by x) from unnest(p.polroles) x),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by c.relname,p.polname) from pg_policy p join pg_class c on c.oid=p.polrelid where c.relnamespace in(select oid from ns)),
 'types',(select jsonb_agg(jsonb_build_object('name',typname,'kind',typtype,'owner',pg_get_userbyid(typowner),'acl',typacl::text,'base',format_type(typbasetype,typtypmod),'not_null',typnotnull,'default',typdefault) order by typname) from pg_type where typnamespace in(select oid from ns)),
 'enums',(select jsonb_agg(jsonb_build_object('type',t.typname,'label',e.enumlabel,'sort',e.enumsortorder) order by t.typname,e.enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typnamespace in(select oid from ns)),
 'default_acls',(select jsonb_agg(jsonb_build_object('role',pg_get_userbyid(defaclrole),'schema',case when defaclnamespace=0 then 'GLOBAL' else 'storage' end,'kind',defaclobjtype,'acl',defaclacl::text) order by defaclrole,defaclnamespace,defaclobjtype) from pg_default_acl where defaclnamespace in(select oid from ns) or defaclnamespace=0 and defaclrole in(select oid from rr)),
 'roles',(select jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'create_role',rolcreaterole,'create_db',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypass_rls',rolbypassrls,'connection_limit',rolconnlimit,'valid_until',rolvaliduntil::text) order by rolname) from pg_roles where oid in(select oid from rr)),
 'role_settings',(select jsonb_agg(jsonb_build_object('role',pg_get_userbyid(setrole),'database',case when setdatabase=0 then 'GLOBAL' else current_database() end,'settings',setconfig) order by setrole,setdatabase) from pg_db_role_setting where setrole in(select oid from rr) and setdatabase in(0,(select oid from pg_database where datname=current_database()))),
 'memberships',(select jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option) order by roleid,member,grantor) from pg_auth_members where roleid in(select oid from rr) or member in(select oid from rr))
) catalog`;
async function storageCatalog(db){const r=await db.query(STORAGE_CATALOG_SQL);insist(r.rowCount===1 && r.rows[0].catalog?.schema?.length===1,'Storage catalog unavailable.');
 const text=stable(r.rows[0].catalog);insist(Buffer.byteLength(text)<=16*1024**2,'Storage catalog bound exceeded.');return {catalog:r.rows[0].catalog,sha256:hash(text)};}

async function containerGate(){
  const require=createRequire('/app/package.json'),{Client}=require('pg');
  const input=JSON.parse(readFileSync('/custody/input.json','utf8'));
  const db=new Client({connectionString:process.env.CUSTODIAL_GATE_DATABASE_URL,application_name:'owned-storage-pre-server',connectionTimeoutMillis:5000,query_timeout:10000});
  await db.connect();const deadline=Date.now()+resourceProfile(input.source_profile).work_ms;
  try{
    for(;;){
      insist(Date.now()<deadline,'Pre-server original boundary deadline exceeded.');
      const context=await db.query(`select current_database() database_name,(select oid::text from pg_database where datname=current_database()) database_oid,
        (select pg_get_userbyid(datdba) from pg_database where datname=current_database()) database_owner`);
      insist(stable(context.rows[0])===stable(input.database),'Provider DB identity changed.');
      try{
        const c=await db.query(`select restore_id::text,authority_generation::text,archive_digest,source_project_ref,target_project_ref,state,mutations_paused
          from custodial_dr.restore_control where singleton=true`);
        const v=c.rows[0],i=input.intent;
        if(c.rowCount===1 && v.restore_id===i.restore_id && v.authority_generation===String(i.authority_generation)
          && v.archive_digest===i.archive_digest && v.source_project_ref===i.source_project_ref && v.target_project_ref===i.target_project_ref
          && v.state==='STORAGE_RESTORING' && v.mutations_paused===true){
          const r=await db.query('select row_to_json(m) row from storage.migrations m order by id');
          insist(r.rowCount===input.migration_count && hash(stable(r.rows.map(x=>x.row)))===input.migrations_sha256,'Archived migration full tuple identity mismatch.');break;
        }
      }catch(e){if(!['42P01','42703'].includes(e.code))throw e;}
      await pause(200);
    }
    const before=await storageCatalog(db);durable('/audit/STORAGE_CATALOG_BEFORE_PROVIDER.json',before,0o644);
    const {TenantLocation}=require('/app/dist/storage/locator.js'),{FileBackend}=require('/app/dist/storage/backend/file.js');
    const backend=new FileBackend(),locator=new TenantLocation(process.env.GLOBAL_S3_BUCKET);
    insist(readdirSync(process.env.STORAGE_FILE_BACKEND_PATH).length===0,'FILE namespace was not empty.');
    for(const object of input.objects){
      const bytes=readFileSync('/custody/'+object.file);
      insist(bytes.length===object.size_bytes && hash(bytes)===object.sha256,'Verified original object changed.');
      const key=locator.getKeyLocation({tenantId:process.env.TENANT_ID,bucketId:object.bucket_id,objectName:object.name});
      await backend.uploadObject(process.env.GLOBAL_S3_BUCKET,key,object.version??undefined,Readable.from(bytes),object.contentType,object.cacheControl,undefined,bytes.length);
    }
    const r=await db.query('select row_to_json(m) row from storage.migrations m order by id');
    insist(hash(stable(r.rows.map(x=>x.row)))===input.migrations_sha256,'Bootstrap changed archived migration metadata.');
  }finally{await db.end();}
  const child=spawn('docker-entrypoint.sh',['node','dist/start/server.js'],{stdio:'inherit',env:process.env});
  for(const s of ['SIGTERM','SIGINT'])process.on(s,()=>child.kill(s));
  const code=await new Promise((r,j)=>{child.once('error',j);child.once('exit',(c,s)=>r(c??(s?1:0)));});process.exitCode=code;
}

async function host(){
  const u=selectedMode(process.env),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const api=await import(pathToFileURL(resolve(root,'scripts/disaster-recovery-archive.mjs')));
  const storage=await import(pathToFileURL(resolve(root,'scripts/disaster-recovery-storage.mjs')));
  const {Client}=await import('pg');
  memoryFloor(4*1024**3);
  const tmp=process.env.RUNNER_TEMP;insist(tmp && statSync(tmp).uid===process.getuid(),'Owned runner temporary directory required.');
  const original=JSON.parse(process.env.RESTORE_INTENT_JSON);
  const crypto=await import(pathToFileURL(resolve(root,'scripts/disaster-recovery-crypto.mjs')));
  const intent=crypto.captureVerifiedOriginalRestoreIntent(original,process.env.RESTORE_INTENT_VERIFY_KEY,process.env.RESTORE_INTENT_VERIFY_KEY_ID);
  const custody=mkdtempSync(resolve(tmp,'official-storage-')),started=Date.now();let deadline=started+WORK_MS;const cleanupBudget={deadline:null};const run=runner(custody,()=>deadline,cleanupBudget);
  const namespace='mz_schema_rebuild_storage_'+randomBytes(10).toString('hex'),alias=namespace+'_db',network=namespace+'_net';
  let archive,client,cid=null,pgid=null,networkBorn=false,networkId=null,connected=false,failure,output,cleanupFailure=null,serviceAbsent=false,networkAbsent=false,relay=null,relayClosed=true,verifiedImageId=null,databaseUrl=null,nativeLockPlan=null,nativeLockOwned=null,nativeLockDatabaseOid=null,originalCliInvoked=false,originalCliSettled=false;const relaySockets=new Set();
  try{
    archive=api.materializeVerifiedArchive({sourceDir:process.env.RESTORE_SOURCE_DIR,archiveVerifyKey:process.env.RESTORE_ARCHIVE_VERIFY_KEY,
      archiveVerifyKeyId:process.env.RESTORE_ARCHIVE_VERIFY_KEY_ID,supportedFormats:['memphis-zoo-disaster-recovery.v4'],
      requiredEntries:['backup-summary.json','inventory/table-catalog.json','inventory/storage-buckets.json','inventory/storage-objects.json']});
    api.assertVerifiedArchiveIndependentIntentKey(archive,process.env.RESTORE_INTENT_VERIFY_KEY);
    const a=storage.freshLocalStorageArchiveBinding(archive),s=a.sourceBinding;
    const budget=resourceProfile(a.source_profile);deadline=started+budget.work_ms;
    insist(intent.archive_digest===s.archive_digest && intent.source_identity_sha256===s.source_identity_sha256 && intent.source_project_ref===s.project_ref,'Original intent source mismatch.');
    if(a.source_profile==='native-text-v4-existing-postgres')insist(a.bucket_count===3 && a.object_count===1,'Production G31 original requires authenticated three buckets and one object.');
    else insist(a.source_profile==='immutable-private-fresh-supabase-admin' && a.bucket_count>0 && a.object_count>0 && a.bucket_count<=65536 && a.object_count<=65536,'Private original requires bounded genuine nonempty Storage.');
    u.username=a.expected_session_user;databaseUrl=u.href;
    client=new Client({connectionString:databaseUrl,connectionTimeoutMillis:5000,query_timeout:10000});await client.connect();
    const identity=await client.query(`select current_database() database_name,(select oid::text from pg_database where datname=current_database()) database_oid,
      (select pg_get_userbyid(datdba) from pg_database where datname=current_database()) database_owner,session_user::text session_user,current_user::text current_user`);
    const id=identity.rows[0];insist(id.database_owner===a.expected_database_owner && id.session_user===a.expected_session_user && id.current_user===id.session_user,'Source profile/DB owner mismatch.');
    const rows=await originalRows(archive,'migrations',api),typed=[];
    for(const row of rows){const r=await client.query('select row_to_json(x) row from json_populate_record(null::storage.migrations,$1::json) x',[JSON.stringify(row)]);typed.push(r.rows[0].row);}
    typed.sort((x,y)=>x.id-y.id);const migrationCount=typed.length;insist(migrationCount>0 && migrationCount<=1024 && new Set(typed.map(x=>x.id)).size===migrationCount && typeof typed.at(-1).name==='string','Authenticated full migration identity required.');
    if(a.source_profile==='native-text-v4-existing-postgres')insist(migrationCount===74,'Production original exact74 migration rows required.');
    const migrationsHash=hash(stable(typed)),objectsRows=await originalRows(archive,'objects',api),inventory=api.readVerifiedStorageUploadInventory(archive),objects=[];
    const mount=resolve(custody,'provider-input');mkdirSync(mount,{mode:0o700});
    const audit=resolve(custody,'provider-audit');mkdirSync(audit,{mode:0o700});
    for(const o of inventory.objectRecords){
      const native=objectsRows.find(x=>x.id===o.object_id);insist(native && native.bucket_id===o.bucket_id && native.name===o.name,'Original object membership mismatch.');
      const meta=typeof native.metadata==='string'?JSON.parse(native.metadata):native.metadata;
      const blob=api.readVerifiedStorageUploadBlob(archive,o.object_id),bytes=Buffer.from(await blob.blob.arrayBuffer()),file=o.sha256;
      insist(hash(bytes)===o.sha256 && bytes.length===o.size_bytes,'Original object byte mismatch.');writeFileSync(resolve(mount,file),bytes,{mode:0o400,flag:'wx'});
      const contentType=meta.mimetype,cacheControl=String(meta.cacheControl??meta.cache_control);
      insist(typeof contentType==='string' && contentType.length>0 && cacheControl!=='undefined' && !/[\r\n]/.test(contentType+cacheControl),'Exact original object metadata required.');
      objects.push({...o,file,version:native.version,contentType,cacheControl});
    }
    const input={source_profile:a.source_profile,database:{database_name:id.database_name,database_oid:id.database_oid,database_owner:id.database_owner},intent,migration_count:migrationCount,migrations_sha256:migrationsHash,objects};
    durable(resolve(custody,'WORKER_INPUT_REDACTED.json'),{input_sha256:hash(stable(input)),worker_sha256:hash(readFileSync(fileURLToPath(import.meta.url))),
      original_intent_sha256:hash(stable(original)),archive_digest:s.archive_digest,database_oid:id.database_oid,migrations_full_tuple_sha256:migrationsHash,
      objects:objects.map(o=>({sha256:o.sha256,size_bytes:o.size_bytes,version_sha256:hash(String(o.version))})),secrets_retained:false});
    durable(resolve(mount,'input.json'),input);writeFileSync(resolve(mount,'worker.mjs'),readFileSync(fileURLToPath(import.meta.url)),{mode:0o400,flag:'wx'});
    const pgName='mz_schema_rebuild_'+process.env.GITHUB_RUN_ID;
    const pg=JSON.parse(await run(['docker','inspect','--format',inspectFormat,pgName]));insist(pg.Name==='/'+pgName && pg.Config.Image===PG_IMAGE && /^[a-f0-9]{64}$/.test(pg.Id),'Existing owned PG identity mismatch.');pgid=pg.Id;
    await run(['docker','update','--memory','1g','--memory-swap','1g','--cpus','1','--pids-limit','256',pgid]);
    const boundedPg=JSON.parse(await run(['docker','inspect','--format',inspectFormat,pgid]));
    assertPinnedPgResources(boundedPg,pgid,pgName);
    const pgPorts=boundedPg.NetworkSettings.Ports['5432/tcp'];
    if(a.source_profile==='native-text-v4-existing-postgres')
      insist(pgPorts?.length===1 && pgPorts[0].HostIp==='127.0.0.1' && Number(pgPorts[0].HostPort)===Number(u.port),'Exact owned PG loopback port mismatch.');
    else insist(a.source_profile==='immutable-private-fresh-supabase-admin'
      && Object.values(boundedPg.NetworkSettings.Ports||{}).every(ports=>ports===null || Array.isArray(ports) && ports.length===0),
      'Private original must retain its owned forward and no published PG ports.');
    // Archive roles intentionally exclude passwords. Initialize only this
    // disposable existing role's credential, never LOGIN/grants/HBA or actor.
    const bootstrap=decodeURIComponent(u.password);
    insist(/^(?:postgres|[a-f0-9]{64})$/.test(bootstrap),'Fixed disposable bootstrap credential shape required.');
    const beforeCredential=(await client.query(STORAGE_CREDENTIAL_NONSECRET_SQL)).rows[0].snapshot;
    insist(beforeCredential.role?.login===true,'Existing login Storage role required; no attribute changes admitted.');
    const credentialSQL="\\set VERBOSITY terse\nset log_statement='none';\nset log_min_error_statement='panic';\n"+
      "do $credential$ begin if current_setting('log_statement')<>'none' then raise exception 'Credential logging refused'; end if; end $credential$;\n"+
      "alter role supabase_storage_admin password '"+bootstrap.replaceAll("'","''")+"';\n";
    await run(['docker','exec','-i',pgid,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',id.database_name],{input:credentialSQL});
    const afterCredential=(await client.query(STORAGE_CREDENTIAL_NONSECRET_SQL)).rows[0].snapshot;
    insist(stable(beforeCredential)===stable(afterCredential),'Password-only setup changed nonsecret role/membership/ACL/owner metadata.');
    durable(resolve(custody,'STORAGE_ROLE_CREDENTIAL_NONSECRET_INVARIANCE.json'),{role:'supabase_storage_admin',before:beforeCredential,after:afterCredential,
      database_oid:id.database_oid,owned_container_id:pgid,only_ephemeral_password_initialized:true,plaintext_or_verifier_exported:false});

    if(a.source_profile==='native-text-v4-existing-postgres'){
      const existing=await client.query(NATIVE_LOCK_INSPECT_SQL);insist(existing.rowCount===0,'Existing native catalog capability name refused.');
      nativeLockPlan=nativeTextCatalogLockCapability(intent,id);nativeLockDatabaseOid=id.database_oid;
      durable(resolve(custody,'NATIVE_CATALOG_LOCK_INSTALL_INTENT.json'),{identity:nativeLockPlan.identity,
        database_oid:id.database_oid,owned_container_id:pgid,restore_id:intent.restore_id,authority_generation:intent.authority_generation,
        archive_digest:intent.archive_digest,expected_body_sha256:hash(nativeLockPlan.body),expected_definition_sha256:hash(nativeLockPlan.definition),
        owner:nativeLockPlan.owner,acl:nativeLockPlan.acl,production:false});
      const sql="begin;\ndo $existing$ begin if exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='custodial_dr' and p.proname='native_text_lock_catalogs_v1') then raise exception 'Existing capability refused'; end if; end $existing$;\n"+
        nativeLockPlan.definition.replace(/^CREATE OR REPLACE FUNCTION /,'CREATE FUNCTION ')+";\nalter function custodial_dr.native_text_lock_catalogs_v1() owner to supabase_admin;\nrevoke all on function custodial_dr.native_text_lock_catalogs_v1() from public,anon,authenticated,service_role;\ngrant execute on function custodial_dr.native_text_lock_catalogs_v1() to postgres;\n"+
        "do $acl$ begin if (select count(*) from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl)a where p.oid=pg_catalog.to_regprocedure('custodial_dr.native_text_lock_catalogs_v1()') and pg_catalog.pg_get_userbyid(a.grantee) in ('postgres','supabase_admin') and pg_catalog.pg_get_userbyid(a.grantor)='supabase_admin' and a.privilege_type='EXECUTE' and not a.is_grantable)<>2 or (select count(*) from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl)a where p.oid=pg_catalog.to_regprocedure('custodial_dr.native_text_lock_catalogs_v1()'))<>2 then raise exception 'Exact capability ACL refused'; end if; end $acl$;\ncommit;\n";
      await run(['docker','exec','-i',pgid,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',id.database_name],{input:sql});
      const installed=await client.query(NATIVE_LOCK_INSPECT_SQL);insist(installed.rowCount===1,'Fixed catalog capability installation absent.');
      nativeLockOwned=requireExactNativeLock(installed.rows[0],nativeLockPlan);
      durable(resolve(custody,'NATIVE_CATALOG_LOCK_INSTALLED.json'),{...nativeLockOwned,body_sha256:hash(nativeLockOwned.body),definition_sha256:hash(nativeLockOwned.definition),production:false});
    }
    const secret=randomBytes(32).toString('hex'),now=Math.floor(Date.now()/1000),jwt=(role)=>{
      const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({role,iss:'supabase',iat:now,exp:Math.min(Math.floor(Date.parse(intent.expires_at)/1000),now+Math.ceil(budget.work_ms/1000)+30)})).toString('base64url');
      return h+'.'+p+'.'+createHmac('sha256',secret).update(h+'.'+p).digest('base64url');};
    const serviceKey=jwt('service_role'),internal=new URL(databaseUrl);internal.hostname=alias;internal.port='5432';internal.username='supabase_storage_admin';
    const gateUrl=new URL(internal);gateUrl.username=a.expected_session_user;
    const config={DATABASE_URL:internal.href,CUSTODIAL_GATE_DATABASE_URL:gateUrl.href,AUTH_JWT_SECRET:secret,SERVICE_KEY:serviceKey,ANON_KEY:jwt('anon'),TENANT_ID:s.project_ref,PROJECT_REF:s.project_ref,
      GLOBAL_S3_BUCKET:'stub',STORAGE_BACKEND:'file',STORAGE_FILE_BACKEND_PATH:'/owned-files',STORAGE_FILE_ETAG_ALGORITHM:'md5',
      DB_INSTALL_ROLES:'false',DB_ALLOW_MIGRATION_REFRESH:'false',DB_MIGRATIONS_FREEZE_AT:typed.at(-1).name,
      DATABASE_MAX_CONNECTIONS:'8',PG_QUEUE_ENABLE:'false',IMAGE_TRANSFORMATION_ENABLED:'false',PORT:'5000'};
    const envFile=resolve(custody,'provider.env');writeFileSync(envFile,Object.entries(config).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600,flag:'wx'});
    networkId=(await run(['docker','network','create','--internal','--label','custodial.owner='+namespace,network])).trim();networkBorn=true;
    insist(/^[a-f0-9]{64}$/.test(networkId),'Owned network identity missing.');
    await run(['docker','network','connect','--alias',alias,network,pgid]);connected=true;
    await run(['docker','pull',IMAGE],{seconds:120});
    const imageMetadata=JSON.parse(await run(['docker','image','inspect','--format','{"id":{{json .Id}},"repo_digests":{{json .RepoDigests}},"user":{{json (index .Config "User")}}}',IMAGE]));
    verifiedImageId=validatePinnedOfficialImage(imageMetadata);
    durable(resolve(custody,'PINNED_OFFICIAL_IMAGE_METADATA.json'),{registry_reference:IMAGE,config_image_id:verifiedImageId,repo_digests:imageMetadata.repo_digests,default_root:true});
    cid=(await run(['docker','create','--name',namespace,'--label','custodial.owner='+namespace,'--network',network,
      '--cpus','1','--memory','512m','--pids-limit','128','--read-only','--tmpfs','/tmp:rw,size=32m','--tmpfs','/owned-files:rw,size=128m',
      '--env-file',envFile,'--mount',`type=bind,src=${mount},dst=/custody,readonly`,
      '--mount',`type=bind,src=${audit},dst=/audit`,'--entrypoint','node',IMAGE,'/custody/worker.mjs','--container-gate'])).trim();
    insist(/^[a-f0-9]{64}$/.test(cid),'Owned service CID missing.');await run(['docker','start',cid]);
    const inspect=JSON.parse(await run(['docker','inspect','--format',inspectFormat,cid]));
    insist(inspect.Id===cid && inspect.ImageId===verifiedImageId && inspect.Name==='/'+namespace && inspect.Config.Image===IMAGE && inspect.Config.Labels['custodial.owner']===namespace
      && inspect.HostConfig.Memory===512*1024**2 && inspect.HostConfig.NanoCpus===1e9 && inspect.HostConfig.ReadonlyRootfs===true,'Owned service identity/configuration mismatch.');
    const endpoint=inspect.NetworkSettings.Networks[network];
    insist(Object.keys(inspect.NetworkSettings.Networks).length===1 && endpoint?.NetworkID===networkId
      && isIP(endpoint.IPAddress)===4 && inspect.State.Running===true
      && Object.values(inspect.NetworkSettings.Ports||{}).every(v=>v===null),'Exact sole-internal service endpoint required.');
    const relayNetwork=JSON.parse(await run(['docker','network','inspect',network]))[0];
    insist(relayNetwork.Id===networkId && relayNetwork.Name===network && relayNetwork.Internal===true
      && relayNetwork.Labels['custodial.owner']===namespace && Object.keys(relayNetwork.Containers||{}).length===2
      && Object.hasOwn(relayNetwork.Containers,cid) && Object.hasOwn(relayNetwork.Containers,pgid),'Exact owned internal relay network required.');
    const destination=endpoint.IPAddress;
    const assertRelayTarget=async()=>{const v=JSON.parse(await run(['docker','inspect','--format',inspectFormat,cid]));
      insist(v.Id===cid && v.ImageId===verifiedImageId && v.Name==='/'+namespace && v.Config.Image===IMAGE && v.Config.Labels['custodial.owner']===namespace
        && v.State.Running===true && Object.keys(v.NetworkSettings.Networks).length===1
        && v.NetworkSettings.Networks[network]?.NetworkID===networkId && v.NetworkSettings.Networks[network]?.IPAddress===destination
        && Object.values(v.NetworkSettings.Ports||{}).every(p=>p===null),'Owned relay target identity changed.');};
    relayClosed=false;
    relay=createServer(client=>{
      if(stopping || Date.now()>=deadline || relaySockets.size>=64){client.destroy();return;}
      const upstream=createConnection({host:destination,port:5000});
      for(const socket of [client,upstream]){relaySockets.add(socket);socket.setTimeout(10000);
        socket.on('timeout',()=>socket.destroy());socket.on('error',()=>{client.destroy();upstream.destroy();});
        socket.on('close',()=>{relaySockets.delete(socket);if(socket===client)upstream.destroy();else client.destroy();});}
      client.pipe(upstream);upstream.pipe(client);
    });
    await new Promise((yes,no)=>{relay.once('error',no);relay.listen({host:'127.0.0.1',port:0,exclusive:true},yes);});
    relay.on('error',()=>{stopping=true;for(const socket of relaySockets)socket.destroy();});
    const listener=relay.address();insist(listener.address==='127.0.0.1' && listener.port>0 && listener.port<=65535,'Owned loopback listener refused.');
    const relayBinding={origin:'http://127.0.0.1:'+listener.port,container_id:cid,container_name:namespace,image:IMAGE,config_image_id:verifiedImageId,
      network_id:networkId,network_name:network,destination_address:destination,destination_port:5000,external_network_attached:false,payloads_logged:false};
    durable(resolve(custody,'OWNED_LOOPBACK_RELAY_BOUND.json'),relayBinding);
    await assertRelayTarget();
    const binding={purpose:'custodial-immutable-fresh-local-storage-provider',source_profile:a.source_profile,original_intent_sha256:hash(stable(original)),
      ...Object.fromEntries(['restore_id','authority_generation','archive_digest','source_identity_sha256','source_project_ref','target_project_ref'].map(k=>[k,intent[k]])),
      approved_at:new Date().toISOString(),expires_at:intent.expires_at,
      host_target:{hostname:'127.0.0.1',port:Number(u.port),database_name:id.database_name,database_oid:id.database_oid,session_user:a.expected_session_user,database_owner:id.database_owner},
      provider:{origin:relayBinding.origin,container_id:cid,image_digest:IMAGE.split('@')[1],namespace,
        config_sha256:hash(stable({environment:config,relay:relayBinding})),service_key_sha256:hash(serviceKey),jwt_secret_sha256:hash(secret),database:{network_alias:alias,port:5432,database_name:id.database_name,database_oid:id.database_oid,role:'supabase_storage_admin'},
        backend:'file',restore_method:'official-file-backend-archived-version-v1',archived_storage_inventory_sha256:a.archived_storage_inventory_sha256,
        archived_migrations_74_full_tuple_sha256:migrationsHash,file_backend_namespace_sha256:hash(stable({namespace,empty:true,objects:objects.map(o=>({file:o.file,sha256:o.sha256,size_bytes:o.size_bytes,version:o.version}))}))}};
    const envelope={format:'custodial.immutable-fresh-local-storage-provider.v1',algorithm:'hmac-sha256',key_id:process.env.RESTORE_INTENT_VERIFY_KEY_ID,binding,signature:sign(binding,process.env.RESTORE_INTENT_VERIFY_KEY)};
    storage.validateFreshLocalStorageProviderData({providerEnvelope:envelope,originalIntentEnvelope:original,intentVerifyKey:process.env.RESTORE_INTENT_VERIFY_KEY,
      intentVerifyKeyId:process.env.RESTORE_INTENT_VERIFY_KEY_ID,serviceKey,jwtSecret:secret,databaseUrl,
      expected:{source_profile:a.source_profile,expected_session_user:a.expected_session_user,expected_database_owner:a.expected_database_owner,
        archive_digest:s.archive_digest,source_project_ref:s.project_ref,source_identity_sha256:s.source_identity_sha256,archived_storage_inventory_sha256:a.archived_storage_inventory_sha256}});
    await client.end();client=null;
    const allowed=/^Cpus_allowed_list:\s+([0-9]+)/m.exec(readFileSync('/proc/self/status','utf8'));insist(allowed,'CPU affinity unavailable.');
    let stdout;originalCliInvoked=true;
    try{stdout=await run(['taskset','-c',allowed[1],process.execPath,'--max-old-space-size='+budget.node_heap_mib,resolve(root,'scripts/production-restore.mjs')],{seconds:budget.work_ms/1000,
      env:{...process.env,SUPABASE_DB_URL:databaseUrl,RESTORE_FRESH_STORAGE_PROVIDER_JSON:JSON.stringify(envelope),RESTORE_FRESH_STORAGE_SERVICE_KEY:serviceKey,RESTORE_FRESH_STORAGE_JWT_SECRET:secret}});}
    finally{originalCliSettled=true;}
    output=storageResult(JSON.parse(stdout),s,intent);
    await assertRelayTarget();
    const final=new Client({connectionString:databaseUrl,connectionTimeoutMillis:5000,query_timeout:10000});await final.connect();
    try{const before=JSON.parse(readFileSync(resolve(audit,'STORAGE_CATALOG_BEFORE_PROVIDER.json'),'utf8')),after=await storageCatalog(final);
      insist(hash(stable(before.catalog))===before.sha256 && before.sha256===after.sha256 && stable(before.catalog)===stable(after.catalog),'Official provider changed Storage catalog/ACL/role metadata.');
      durable(resolve(custody,'STORAGE_CATALOG_AFTER_PROVIDER.json'),after);
      const actual=await final.query('select row_to_json(m) row from storage.migrations m order by id');insist(actual.rowCount===migrationCount && hash(stable(actual.rows.map(x=>x.row)))===migrationsHash,'Official startup changed archived migration metadata.');}finally{await final.end();}
    durable(resolve(custody,'PROVIDER_VERIFIED.json'),{provider_verified:true,production_provider_verified:false,archive_digest:s.archive_digest,original_intent_sha256:hash(stable(original)),
      namespace,container_id:cid,image:IMAGE,database_oid:id.database_oid,archived_migrations_74_full_tuple_sha256:migrationsHash,actual_archived_migration_count:migrationCount,resource_profile:budget,buckets:a.bucket_count,objects:a.object_count});
  }catch(e){failure=e;}
  finally{
    cleanupBudget.deadline??=Date.now()+45000;
    try{if(relay){
      await closeOwnedRelay(relay,relaySockets,cleanupBudget.deadline);relayClosed=true;
      durable(resolve(custody,'OWNED_LOOPBACK_RELAY_CLOSED.json'),{listener_closed:true,owned_sockets_remaining:0,before_container_removal:true});}}
    catch(e){cleanupFailure=e;failure??=e;}
    if(client)try{await client.end();}catch(e){failure??=e;}
    if(nativeLockPlan && databaseUrl)try{
      // Same owned original only. Normal CLI wait/absence is already complete.
      // A different OID, body, definition, owner or ACL always refuses deletion.
      insist(!originalCliInvoked || originalCliSettled,'Original CLI remains unsettled before capability cleanup.');
      const remaining=()=>{const ms=cleanupBudget.deadline-Date.now();insist(ms>0,'Shared cleanup deadline exceeded.');return Math.min(5000,ms);};
      const check=new Client({connectionString:databaseUrl,connectionTimeoutMillis:remaining(),query_timeout:5000});await check.connect();
      const cleanupQuery=text=>check.query({text,query_timeout:remaining()});
      try{let removedOid=null;const identity=(await cleanupQuery('select current_database() name,(select oid::text from pg_database where datname=current_database()) oid,session_user::text actor')).rows[0];
        insist(identity.name===u.pathname.slice(1) && identity.actor==='postgres' && identity.oid===nativeLockDatabaseOid,'Original catalog cleanup database identity changed.');
        const found=await cleanupQuery(NATIVE_LOCK_INSPECT_SQL);
        if(found.rowCount){insist(found.rowCount===1,'Ambiguous fixed catalog capability cleanup.');
          const current=requireExactNativeLock(found.rows[0],nativeLockPlan,nativeLockOwned?.oid);removedOid=current.oid;
          const sql="do $cleanup$ begin if not exists(select 1 from pg_catalog.pg_proc p where p.oid='"+current.oid+"'::pg_catalog.oid and pg_catalog.pg_get_functiondef(p.oid)='"+nativeLockPlan.definition.replaceAll("'","''")+"' and pg_catalog.pg_get_userbyid(p.proowner)='supabase_admin' and p.proacl::text='"+current.acl_text.replaceAll("'","''")+"' and p.oid=pg_catalog.to_regprocedure('custodial_dr.native_text_lock_catalogs_v1()')) then raise exception 'Fixed capability cleanup identity changed'; end if; drop function custodial_dr.native_text_lock_catalogs_v1(); end $cleanup$;";
          await run(['docker','exec','-i',pgid,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',identity.name],{input:sql,cleanup:true});}
        insist((await cleanupQuery(NATIVE_LOCK_INSPECT_SQL)).rowCount===0,'Fixed catalog capability remains after cleanup.');
        durable(resolve(custody,'NATIVE_CATALOG_LOCK_REMOVED.json'),{identity:nativeLockPlan.identity,exact_oid:removedOid,fresh_absent:true,original_cli_invoked:originalCliInvoked,original_cli_call_settled:originalCliSettled,cleanup_without_child_invocation:!originalCliInvoked,production:false});
      }finally{await check.end();}
    }catch(e){cleanupFailure=e;failure??=e;}
    try{
      if(!cid){const candidates=(await run(['docker','ps','-aq','--no-trunc','--filter','name=^/'+namespace+'$'],{cleanup:true})).trim().split('\n').filter(Boolean);insist(candidates.length<=1,'Ambiguous cleanup name.');cid=candidates[0]??null;}
      if(cid){const v=JSON.parse(await run(['docker','inspect','--format',inspectFormat,cid],{cleanup:true}));insist(v.Id===cid && v.ImageId===verifiedImageId && v.Config.Labels['custodial.owner']===namespace && v.Config.Image===IMAGE,'Cleanup identity mismatch.');
        await run(['docker','rm','-f',cid],{cleanup:true});
        // A missing exact CID is established by successful empty filtered lists.
        insist(!(await run(['docker','ps','-aq','--filter','id='+cid],{cleanup:true})).trim(),'Owned service remains.');serviceAbsent=true;}else serviceAbsent=true;
      const networks=(await run(['docker','network','ls','-q','--filter','label=custodial.owner='+namespace],{cleanup:true})).trim().split('\n').filter(Boolean);
      insist(networks.length<=1,'Ambiguous owned network.');
      if(networks.length){const n=JSON.parse(await run(['docker','network','inspect',network],{cleanup:true}))[0];
        if(pgid && Object.hasOwn(n.Containers||{},pgid))await run(['docker','network','disconnect',network,pgid],{cleanup:true});
        const after=JSON.parse(await run(['docker','network','inspect',network],{cleanup:true}))[0];
        insist(Object.keys(after.Containers||{}).length===0,'Foreign network member prevents cleanup.');insist(n.Labels['custodial.owner']===namespace && Object.keys(after.Containers||{}).length===0,'Foreign network member prevents cleanup.');await run(['docker','network','rm',network],{cleanup:true});}
      insist(!(await run(['docker','network','ls','--no-trunc','-q','--filter','name=^'+network+'$'],{cleanup:true})).trim(),'Owned network name remains.');
      if(networkId)insist(!(await run(['docker','network','ls','--no-trunc','-q','--filter','id='+networkId],{cleanup:true})).trim(),'Owned network ID remains.');networkAbsent=true;
    }catch(e){cleanupFailure=e;failure??=e;}
    try{archive?.cleanup();}catch(e){failure??=e;}
    // Private source bytes/local keys live only in this owned directory.
    try{rmSync(resolve(custody,'provider-input'),{recursive:true,force:true});rmSync(resolve(custody,'provider.env'),{force:true});}catch(e){failure??=e;}
    durable(resolve(custody,'FINAL.json'),{ok:!failure,provider_verified:!failure,production_provider_verified:false,resource_namespace:namespace,
      service_born:cid!==null,service_CID_or_name_fresh_absent:serviceAbsent,network_fresh_absent:networkAbsent,relay_closed_or_never_born:relayClosed,cleanup_checked:cleanupFailure===null && relayClosed && serviceAbsent && networkAbsent,scope:'OFFICIAL_LOCAL_FILE_BACKEND_SAME_ORIGINAL',error:failure?'OWNING_REHEARSAL_REFUSED':null});
    const evidence=resolve(tmp,'official-local-storage-provider-evidence',namespace);mkdirSync(evidence,{recursive:true,mode:0o700});
    for(const name of readdirSync(custody))if(/^(?:[0-9]{3}\.(?:INTENT\.json|OWNER\.json|ACTUAL_WAIT\.json|stdout|stderr)|FINAL\.json|PROVIDER_VERIFIED\.json|WORKER_INPUT_REDACTED\.json|STORAGE_CATALOG_AFTER_PROVIDER\.json|OWNED_LOOPBACK_RELAY_(?:BOUND|CLOSED)\.json|PINNED_OFFICIAL_IMAGE_METADATA\.json|STORAGE_ROLE_CREDENTIAL_NONSECRET_INVARIANCE\.json|NATIVE_CATALOG_LOCK_(?:INSTALL_INTENT|INSTALLED|REMOVED)\.json)$/.test(name))copyFileSync(resolve(custody,name),resolve(evidence,name));
    const beforeFile=resolve(custody,'provider-audit','STORAGE_CATALOG_BEFORE_PROVIDER.json');if(existsSync(beforeFile))copyFileSync(beforeFile,resolve(evidence,'STORAGE_CATALOG_BEFORE_PROVIDER.json'));
    rmSync(resolve(custody,'provider-audit'),{recursive:true,force:true});
  }
  if(failure)throw failure;process.stdout.write(JSON.stringify(output)+'\n');
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv.slice(2);insist(mode.length===0 || mode.length===1 && mode[0]==='--container-gate','Unsupported lifecycle mode.');
  if(!mode.length)for(const signal of ['SIGTERM','SIGINT'])process.on(signal,stop);
  (mode.length?containerGate():host()).catch(()=>{process.stderr.write('Official local Storage original refused; private bounded receipts retained.\n');process.exitCode=1;});
}
