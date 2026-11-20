// Bounded catalog-lock privileges for the same owned disposable current copy.
// No production/CLI route, role creation, definer hook or restore admission.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {types,isDeepStrictEqual} from 'node:util';
import pg from 'pg';
import {assertVerifiedImmutableBootstrapSource,readVerifiedImmutableBootstrapOwnerProfile} from './immutable-private-source-bootstrap.mjs';
const Client=pg.Client,nativeQuery=Client.prototype.query;
const schema='custodial.isolated-current-catalog-privileges.v1';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const own=(value,key)=>{if(!value||typeof value!=='object'||types.isProxy(value))return undefined;
 const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
const keys=['schema','setup_verified','callback_invoked','retirement_verified','setup_connection_closed','retirement_connection_closed',
 'requested_catalog_count','verified_grant_count','original_catalog_acl_sha256','original_roles_sha256','original_memberships_sha256','production_written','runtime_admission'];
export function projectIsolatedCatalogPrivilegeStatus(value){
 if(!value||typeof value!=='object'||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)return null;
 const actual=Reflect.ownKeys(value);if(actual.length!==keys.length||actual.some(k=>typeof k!=='string'||!keys.includes(k)
  ||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value')))return null;
 const d=Object.fromEntries(keys.map(k=>[k,own(value,k)]));
 if(d.schema!==schema||d.production_written!==false||d.runtime_admission!==false)return null;
 for(const k of ['setup_verified','callback_invoked','retirement_verified','setup_connection_closed','retirement_connection_closed'])if(typeof d[k]!=='boolean')return null;
 for(const k of ['requested_catalog_count','verified_grant_count'])if(!Number.isSafeInteger(d[k])||d[k]<0||d[k]>64)return null;
 if(d.verified_grant_count>d.requested_catalog_count)return null;
 for(const k of ['original_catalog_acl_sha256','original_roles_sha256','original_memberships_sha256'])
  if(d[k]!==null&&(typeof d[k]!=='string'||!/^[a-f0-9]{64}$/.test(d[k])))return null;
 return Object.freeze(d);
}
const identitySql=`select current_user actor,session_user session_actor,current_database() database,
 (select oid::text from pg_database where datname=current_database()) database_oid,
 (select pg_get_userbyid(datdba) from pg_database where datname=current_database()) database_owner,
 pg_backend_pid() pid,txid_current()::text xid,current_setting('transaction_read_only') readonly,
 current_setting('session_replication_role') replication,current_setting('cron.launch_active_jobs',true) cron_execution,
 current_setting('server_version_num')::integer server_version,(select rolsuper from pg_roles where rolname=current_user) administrator`;
const rolesSql=`select oid::text oid,rolname name,rolsuper superuser,rolinherit inherits,rolcreaterole create_role,
 rolcreatedb create_database,rolcanlogin login,rolreplication replication,rolbypassrls bypass_rls,
 rolconnlimit connection_limit,rolvaliduntil::text valid_until,rolconfig config from pg_roles order by oid`;
const membersSql=`select roleid::text role_oid,member::text member_oid,grantor::text grantor_oid,
 admin_option,inherit_option,set_option from pg_auth_members order by roleid,member,grantor`;
const catalogSql=`select c.oid::text oid,c.relname::text name,c.relowner::text owner,
 has_table_privilege('postgres',c.oid,'MAINTAIN') maintain,
 (select jsonb_agg(jsonb_build_object('grantee',a.grantee::text,'grantor',a.grantor::text,
  'privilege',a.privilege_type,'grant_option',a.is_grantable)order by a.grantee,a.grantor,a.privilege_type,a.is_grantable)
  from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a) acl
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='pg_catalog' and c.relkind='r' order by c.oid`;
const oid=value=>typeof value==='string'&&/^[1-9][0-9]{0,9}$/.test(value)&&BigInt(value)<=4294967295n;
const grantOrder=(a,b)=>Number(a.grantee)-Number(b.grantee)||Number(a.grantor)-Number(b.grantor)
 ||(a.privilege<b.privilege?-1:a.privilege>b.privilege?1:0)||Number(a.grant_option)-Number(b.grant_option);
function catalogs(value){
 assert.ok(Array.isArray(value)&&value.length===64);let previous=0;const names=new Set();
 for(const c of value){assert.deepEqual(Object.keys(c).sort(),['acl','maintain','name','oid','owner']);
  assert.ok(oid(c.oid)&&Number(c.oid)>previous&&oid(c.owner));previous=Number(c.oid);
  assert.match(c.name,/^pg_[a-z0-9_]+$/);assert.ok(!names.has(c.name));names.add(c.name);assert.equal(typeof c.maintain,'boolean');
  assert.ok(Array.isArray(c.acl)&&c.acl.length>0);assert.deepEqual([...c.acl].sort(grantOrder),c.acl);
  const seen=new Set();for(const a of c.acl){assert.deepEqual(Object.keys(a).sort(),['grant_option','grantee','grantor','privilege']);
   assert.ok(a.grantee==='0'||oid(a.grantee));assert.ok(oid(a.grantor));assert.equal(typeof a.grant_option,'boolean');
   assert.ok(['INSERT','SELECT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'].includes(a.privilege));
   const key=JSON.stringify(a);assert.ok(!seen.has(key));seen.add(key);}
 }return value;
}
export async function withIsolatedCurrentCatalogPrivileges({verifiedArchive,source,connectionString,runId,verifyTarget},run){
 const current=()=>{assertVerifiedImmutableBootstrapSource(source,verifiedArchive);
  assert.deepEqual(readVerifiedImmutableBootstrapOwnerProfile(source,verifiedArchive),{id:'immutable-private-current-postgres',actor:'postgres'});};
 current();assert.equal(typeof run,'function');assert.equal(typeof verifyTarget,'function');assert.match(runId,/^[1-9][0-9]*$/);
 const expected='mz_schema_rebuild_'+runId,url=new URL(connectionString);
 assert.equal(url.protocol,'postgresql:');assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.equal(decodeURIComponent(url.pathname),'/'+expected);
 assert.equal(url.search,'');assert.equal(url.hash,'');assert.match(url.port,/^[1-9][0-9]{0,4}$/);assert.ok(Number(url.port)<=65535);
 assert.equal(decodeURIComponent(url.username),'supabase_admin');
 let databaseOid,before,postgresOid,setup=false,invoked=false,retired=false,setupClosed=false,retirementClosed=false,value,failure,verifiedGrants=0;
 const requested=[];
 const status=()=>Object.freeze({schema,setup_verified:setup,callback_invoked:invoked,retirement_verified:retired,
  setup_connection_closed:setupClosed,retirement_connection_closed:retirementClosed,requested_catalog_count:requested.length,
  verified_grant_count:verifiedGrants,original_catalog_acl_sha256:before?hash(before.catalogs):null,
  original_roles_sha256:before?hash(before.roles):null,original_memberships_sha256:before?hash(before.members):null,
  production_written:false,runtime_admission:false});
 const native=db=>{assert.equal(Client.prototype.query,nativeQuery);assert.equal(Object.getPrototypeOf(db),Client.prototype);assert.equal(Object.hasOwn(db,'query'),false);};
 async function transaction(kind,readOnly,body){
  current();await verifyTarget();current();if(kind!=='SETUP')retirementClosed=false;
  const db=new Client({connectionString,application_name:'memphis-zoo-isolated-catalog-permissions',connectionTimeoutMillis:10000});
  let active=false,problem,result;
  try{
   native(db);await db.connect();current();native(db);
   const query=async(sql,args=[])=>{current();native(db);const r=await Reflect.apply(nativeQuery,db,[sql,args]);native(db);current();return r;};
   await query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');active=true;
   const identity=async()=>{const r=await query(identitySql);assert.equal(r.rowCount,1);const c=r.rows[0];
    assert.equal(c.actor,'supabase_admin');assert.equal(c.session_actor,c.actor);assert.equal(c.database,expected);assert.equal(c.database_owner,'postgres');
    assert.equal(c.administrator,true);assert.equal(c.replication,'origin');assert.equal(c.cron_execution,'off');assert.equal(c.readonly,readOnly?'on':'off');
    assert.equal(Math.floor(c.server_version/10000),17);assert.ok(oid(c.database_oid));assert.ok(Number.isSafeInteger(c.pid)&&c.pid>0);assert.match(c.xid,/^[1-9][0-9]*$/);
    if(databaseOid)assert.equal(c.database_oid,databaseOid);else databaseOid=c.database_oid;return c;};
   const original=await identity();assert.deepEqual(await identity(),original);result=await body(query);assert.deepEqual(await identity(),original);
   await query(readOnly?'ROLLBACK':'COMMIT');active=false;
  }catch(error){problem=error;if(active)try{native(db);await Reflect.apply(nativeQuery,db,['ROLLBACK']);active=false;}catch{}}
  finally{try{await db.end();if(kind==='SETUP')setupClosed=true;else retirementClosed=true;}catch(error){problem??=error;}}
  if(problem)throw problem;return result;
 }
 const snapshot=async query=>({roles:(await query(rolesSql)).rows,members:(await query(membersSql)).rows,
  catalogs:catalogs((await query(catalogSql)).rows)});
 const allowed=actual=>{
  assert.deepEqual(actual.roles,before.roles);assert.deepEqual(actual.members,before.members);catalogs(actual.catalogs);const added=[];
  for(let i=0;i<before.catalogs.length;i++){
   const old=before.catalogs[i],now=actual.catalogs[i];assert.deepEqual({...now,acl:old.acl,maintain:old.maintain},old);
   if(isDeepStrictEqual(now,old))continue;
   assert.ok(requested.includes(old.name)&&!old.maintain,'Foreign catalog privilege delta refused');
   const extra={grantee:postgresOid,grantor:old.owner,privilege:'MAINTAIN',grant_option:false};
   assert.deepEqual(now.acl,[...old.acl,extra].sort(grantOrder));assert.equal(now.maintain,true);added.push(old);
  }return added;
 };
 try{
  await transaction('SETUP',false,async query=>{
   before=structuredClone(await snapshot(query));const actor=before.roles.filter(r=>r.name==='postgres');
   assert.equal(actor.length,1);assert.equal(actor[0].superuser,false);assert.ok(oid(actor[0].oid));postgresOid=actor[0].oid;
   const fresh=await query('select count(*)::text row_count from public.employees');assert.equal(fresh.rowCount,1);assert.equal(fresh.rows[0].row_count,'0');
   for(const c of before.catalogs)if(!c.maintain){requested.push(c.name);await query('GRANT MAINTAIN ON TABLE pg_catalog.'+c.name+' TO postgres');}
   const after=await snapshot(query);verifiedGrants=allowed(after).length;assert.equal(verifiedGrants,requested.length);
   assert.ok(after.catalogs.every(c=>c.maintain));
  });
  assert.equal(setupClosed,true);setup=true;current();await verifyTarget();current();invoked=true;value=await run();current();
 }catch(error){failure=error;}
 finally{
  if(before&&postgresOid)try{
   await transaction('RETIRE',false,async query=>{
    const actual=await snapshot(query),own=allowed(actual);
    for(const c of own)await query('REVOKE MAINTAIN ON TABLE pg_catalog.'+c.name+' FROM postgres');
    assert.deepEqual(await snapshot(query),before);
   });
   await transaction('READBACK',true,async query=>assert.deepEqual(await snapshot(query),before));retired=true;
  }catch(error){failure??=error;}
 }
 const receipt=status();assert.ok(projectIsolatedCatalogPrivilegeStatus(receipt));
 if(failure||!setup||!retired||!setupClosed||!retirementClosed)
  throw Object.assign(new Error('Isolated catalog privilege rehearsal refused'),{code:'ISOLATED_CATALOG_PRIVILEGES_REFUSED',catalog_privileges:receipt});
 return Object.freeze({value,receipt});
}
