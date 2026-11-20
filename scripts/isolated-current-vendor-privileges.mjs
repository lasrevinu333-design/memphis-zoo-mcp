// Bounded privilege-assisted DATA rehearsal only. No CLI or production route.
// The owning factory verifies its original private CID/network/relay throughout.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {types,isDeepStrictEqual} from 'node:util';
import pg from 'pg';
import {assertVerifiedImmutableBootstrapSource,readVerifiedImmutableBootstrapOwnerProfile} from './immutable-private-source-bootstrap.mjs';
const Client=pg.Client,nativeQuery=Client.prototype.query;
const vendors=Object.freeze(['supabase_auth_admin','supabase_storage_admin']);
const schema='custodial.isolated-current-vendor-privileges.v1';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const contextSql=`select current_user actor,session_user session_actor,current_database() database,
 (select oid::text from pg_catalog.pg_database where datname=current_database()) database_oid,
 (select pg_catalog.pg_get_userbyid(datdba) from pg_catalog.pg_database where datname=current_database()) database_owner,
 pg_backend_pid() pid,pg_catalog.txid_current()::text xid,
 current_setting('transaction_read_only') readonly,current_setting('session_replication_role') replication,
 current_setting('cron.launch_active_jobs',true) cron_execution,
 current_setting('server_version_num')::integer server_version,
 (select rolsuper from pg_catalog.pg_roles where rolname=current_user) administrator`;
const rolesSql=`select oid::text oid,rolname name,rolsuper superuser,rolinherit inherits,
 rolcreaterole create_role,rolcreatedb create_database,rolcanlogin login,rolreplication replication,
 rolbypassrls bypass_rls,rolconnlimit connection_limit,rolvaliduntil::text valid_until,rolconfig config
 from pg_catalog.pg_roles where rolname in ('postgres','supabase_auth_admin','supabase_storage_admin') order by rolname`;
const membersSql=`select r.rolname role_name,m.rolname member_name,g.rolname grantor_name,
 a.admin_option,a.inherit_option,a.set_option from pg_catalog.pg_auth_members a
 join pg_catalog.pg_roles r on r.oid=a.roleid join pg_catalog.pg_roles m on m.oid=a.member
 join pg_catalog.pg_roles g on g.oid=a.grantor where m.rolname='postgres' order by r.rolname,g.rolname`;
const privilegesSql=`select s.schema_name,count(*)::integer tables,
 count(*) filter(where c.oid is null or c.relkind<>'r' or c.relpersistence<>'p' or c.relispartition)::integer invalid,
 coalesce(bool_and(pg_catalog.has_schema_privilege('postgres',n.oid,'USAGE') and
  (pg_catalog.has_table_privilege('postgres',c.oid,'MAINTAIN') or pg_catalog.has_table_privilege('postgres',c.oid,'UPDATE') or
   pg_catalog.has_table_privilege('postgres',c.oid,'DELETE') or pg_catalog.has_table_privilege('postgres',c.oid,'TRUNCATE')) and
  (s.row_count='0' or pg_catalog.has_table_privilege('postgres',c.oid,'INSERT'))),false) available
 from pg_catalog.jsonb_to_recordset($1::jsonb) s(schema_name text,table_name text,row_count text)
 left join pg_catalog.pg_namespace n on n.nspname=s.schema_name
 left join pg_catalog.pg_class c on c.relnamespace=n.oid and c.relname=s.table_name
 group by s.schema_name order by s.schema_name`;
const safeStatus=value=>Object.freeze({...value,granted_roles:Object.freeze([...value.granted_roles])});
export function projectIsolatedVendorPrivilegeStatus(value){
 if(!value||typeof value!=='object'||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)return null;
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
 const expected=['schema','setup_verified','callback_invoked','retirement_verified','setup_connection_closed','retirement_connection_closed','granted_roles','original_memberships_sha256','original_role_attributes_sha256','production_written','runtime_admission'];
 if(keys.some(k=>typeof k!=='string')||!isDeepStrictEqual(keys.slice().sort(),expected.slice().sort())||keys.some(k=>!Object.hasOwn(descriptors[k],'value')))return null;
 const d=Object.fromEntries(keys.map(k=>[k,descriptors[k].value]));
 if(d.schema!==schema||d.production_written!==false||d.runtime_admission!==false)return null;
 for(const k of ['setup_verified','callback_invoked','retirement_verified','setup_connection_closed','retirement_connection_closed'])if(typeof d[k]!=='boolean')return null;
 for(const k of ['original_memberships_sha256','original_role_attributes_sha256'])if(d[k]!==null&&(typeof d[k]!=='string'||!/^[a-f0-9]{64}$/.test(d[k])))return null;
 if(types.isProxy(d.granted_roles)||!Array.isArray(d.granted_roles)||d.granted_roles.length>2)return null;
 const roles=[];for(let i=0;i<d.granted_roles.length;i++){const f=Object.getOwnPropertyDescriptor(d.granted_roles,String(i));if(!f||!Object.hasOwn(f,'value')||!vendors.includes(f.value)||roles.includes(f.value))return null;roles.push(f.value);}
 if(!isDeepStrictEqual(roles,vendors.filter(r=>roles.includes(r))))return null;
 return safeStatus({...d,granted_roles:roles});
}
export async function withIsolatedCurrentVendorPrivileges({verifiedArchive,source,connectionString,runId,verifyTarget},run){
 const current=()=>{assertVerifiedImmutableBootstrapSource(source,verifiedArchive);
  assert.deepEqual(readVerifiedImmutableBootstrapOwnerProfile(source,verifiedArchive),{id:'immutable-private-current-postgres',actor:'postgres'});};
 current();assert.equal(typeof run,'function');assert.equal(typeof verifyTarget,'function');assert.match(runId,/^[1-9][0-9]*$/);
 const expected='mz_schema_rebuild_'+runId,url=new URL(connectionString);
 assert.equal(url.protocol,'postgresql:');assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
 assert.equal(url.search,'');assert.equal(url.hash,'');assert.match(url.port,/^[1-9][0-9]{0,4}$/);assert.ok(Number(url.port)<=65535);
 assert.equal(decodeURIComponent(url.pathname),'/'+expected);assert.equal(decodeURIComponent(url.username),'supabase_admin');
 let databaseOid,beforeRoles,beforeMembers,setupVerified=false,callbackInvoked=false,retired=false,
  setupClosed=false,retirementClosed=false,value,failure;
 const granted=[],requested=[];
 const tables=JSON.parse(source.inventory['inventory/table-catalog.json']).filter(r=>['auth','storage'].includes(r.schema_name)).map(r=>{
  assert.equal(typeof r.table_name,'string');assert.ok(r.table_name.length>0&&!r.table_name.includes('\0')&&Buffer.byteLength(r.table_name)<=63);
  assert.match(r.row_count,/^(0|[1-9][0-9]*)$/);return{schema_name:r.schema_name,table_name:r.table_name,row_count:r.row_count};});
 const status=()=>safeStatus({schema,setup_verified:setupVerified,callback_invoked:callbackInvoked,retirement_verified:retired,
  setup_connection_closed:setupClosed,retirement_connection_closed:retirementClosed,granted_roles:granted,
  original_memberships_sha256:beforeMembers?hash(beforeMembers):null,original_role_attributes_sha256:beforeRoles?hash(beforeRoles):null,
  production_written:false,runtime_admission:false});
 const native=db=>{assert.equal(Client.prototype.query,nativeQuery);assert.equal(Object.getPrototypeOf(db),Client.prototype);assert.equal(Object.hasOwn(db,'query'),false);};
 async function transaction(kind,readOnly,body){
  if(kind!=='SETUP')retirementClosed=false;
  current();await verifyTarget();current();
  const db=new Client({connectionString,application_name:'memphis-zoo-isolated-vendor-permissions',connectionTimeoutMillis:10000});
  let active=false,problem,result;
  try{
   native(db);await db.connect();current();native(db);
   const query=async(sql,args=[])=>{current();native(db);const r=await Reflect.apply(nativeQuery,db,[sql,args]);native(db);current();return r;};
   await query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');active=true;
   const identity=async()=>{const r=await query(contextSql);assert.equal(r.rowCount,1);const c=r.rows[0];
    assert.equal(c.actor,'supabase_admin');assert.equal(c.session_actor,c.actor);assert.equal(c.database,expected);assert.equal(c.database_owner,'postgres');
    assert.equal(c.administrator,true);assert.equal(c.replication,'origin');assert.equal(c.cron_execution,'off');
    assert.equal(c.readonly,readOnly?'on':'off');assert.equal(Math.floor(c.server_version/10000),17);
    assert.match(c.database_oid,/^[1-9][0-9]*$/);assert.ok(Number.isSafeInteger(c.pid)&&c.pid>0);assert.match(c.xid,/^[1-9][0-9]*$/);
    if(databaseOid)assert.equal(c.database_oid,databaseOid);else databaseOid=c.database_oid;return c;};
   const original=await identity();assert.deepEqual(await identity(),original,'Native transaction/currentness changed');
   result=await body(query);assert.deepEqual(await identity(),original);
   await query(readOnly?'ROLLBACK':'COMMIT');active=false;
  }catch(error){problem=error;if(active)try{native(db);await Reflect.apply(nativeQuery,db,['ROLLBACK']);active=false;}catch{}}
  finally{try{await db.end();if(kind==='SETUP')setupClosed=true;else retirementClosed=true;}catch(error){problem??=error;}}
  if(problem)throw problem;return result;
 }
 const readSnapshot=async query=>({roles:(await query(rolesSql)).rows,members:(await query(membersSql)).rows});
 const added=members=>{
  assert.ok(Array.isArray(members));assert.deepEqual(members.filter(r=>!vendors.includes(r.role_name)),beforeMembers);
  const extra=members.filter(r=>vendors.includes(r.role_name));assert.ok(extra.length<=2);
  for(const row of extra){assert.ok(requested.includes(row.role_name),'Foreign vendor membership refused');assert.deepEqual(row,{role_name:row.role_name,member_name:'postgres',grantor_name:'supabase_admin',admin_option:false,inherit_option:true,set_option:false});}
  assert.equal(new Set(extra.map(r=>r.role_name)).size,extra.length);return extra;
 };
 const probe=async query=>{
  const result=(await query(privilegesSql,[JSON.stringify(tables)])).rows;
  assert.deepEqual(result.map(r=>r.schema_name),['auth','storage'].filter(s=>tables.some(t=>t.schema_name===s)));
  for(const row of result){assert.equal(row.tables,tables.filter(t=>t.schema_name===row.schema_name).length);assert.equal(row.invalid,0);assert.equal(typeof row.available,'boolean');}
  return result;
 };
 try{
  await transaction('SETUP',false,async query=>{
   const snapshot=await readSnapshot(query);assert.deepEqual(snapshot.roles.map(r=>r.name),['postgres',...vendors]);
   assert.ok(snapshot.members.every(r=>!vendors.includes(r.role_name)),'Pre-existing vendor membership refused');
   const fresh=await query('select count(*)::text row_count from public.employees');assert.equal(fresh.rowCount,1);assert.equal(fresh.rows[0].row_count,'0','Only a fresh disposable target may receive rehearsal privileges');
   beforeRoles=structuredClone(snapshot.roles);beforeMembers=structuredClone(snapshot.members);
   for(const row of await probe(query))if(!row.available)requested.push(row.schema_name==='auth'?'supabase_auth_admin':'supabase_storage_admin');
   for(const role of requested){await query('GRANT '+role+' TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET FALSE');granted.push(role);}
   const after=await readSnapshot(query);assert.deepEqual(after.roles,beforeRoles);assert.equal(added(after.members).length,requested.length);
   assert.ok((await probe(query)).every(row=>row.available),'Required vendor privileges remain unavailable');
  });
  assert.equal(setupClosed,true);setupVerified=true;current();await verifyTarget();current();callbackInvoked=true;
  value=await run();current();
 }catch(error){failure=error;}
 finally{
  if(beforeMembers&&beforeRoles)try{
   await transaction('RETIRE',false,async query=>{
    const actual=await readSnapshot(query);assert.deepEqual(actual.roles,beforeRoles);
    const own=added(actual.members);
    for(const row of own)await query('REVOKE '+row.role_name+' FROM postgres');
    assert.deepEqual(await readSnapshot(query),{roles:beforeRoles,members:beforeMembers});
   });
   await transaction('READBACK',true,async query=>assert.deepEqual(await readSnapshot(query),{roles:beforeRoles,members:beforeMembers}));
   retired=true;
  }catch(error){failure??=error;}
 }
 const receipt=status();assert.ok(projectIsolatedVendorPrivilegeStatus(receipt));
 if(failure||!setupVerified||!retired||!setupClosed||!retirementClosed){
  const error=Object.assign(new Error('Isolated vendor privilege rehearsal refused'),{code:'ISOLATED_VENDOR_PRIVILEGES_REFUSED',vendor_privileges:receipt});throw error;
 }
 return Object.freeze({value,receipt});
}
