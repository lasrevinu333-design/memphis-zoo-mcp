import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { types } from "node:util";
import pg from "pg";

const NativeClient = pg.Client;
const nativeQuery = NativeClient.prototype.query;
const SCHEMAS = Object.freeze(["public","auth","storage","custodial_release_identity","custodial_employment","custodial_coverall","custodial_leadership_private"]);
const GUARDS = Object.freeze(["custodial_release_identity.guard_group_original_creation()","custodial_dr.guard_application_mutation()"]);
const quoteIdentifier = value => '"' + value.replaceAll('"','""') + '"';

// Catalog metadata only. Caller owns the original exported repeatable-read
// READ ONLY transaction, search_path setup, commit/rollback and connection.
function requireNative(client) {
  assert.ok(client && typeof client === "object" && !types.isProxy(client)
    && Object.getPrototypeOf(client) === NativeClient.prototype
    && !Object.hasOwn(client,"query") && NativeClient.prototype.query === nativeQuery,
    "Original backup metadata requires the actual unmodified pg.Client");
  const connected=Object.getOwnPropertyDescriptor(client,"_connected");
  const ending=Object.getOwnPropertyDescriptor(client,"_ending");
  assert.ok(connected && Object.hasOwn(connected,"value") && connected.value === true
    && ending && Object.hasOwn(ending,"value") && ending.value === false,
    "Original backup snapshot client is unavailable");
}

function detached(value,depth=0) {
  assert.ok(depth<=10,"Unsupported original metadata nesting");
  if(value===null||typeof value==="string"||typeof value==="boolean")return value;
  if(typeof value==="number"){assert.ok(Number.isFinite(value));return value;}
  assert.ok(value && typeof value==="object" && !types.isProxy(value),"Plain catalog metadata required");
  const props=Object.getOwnPropertyDescriptors(value);
  if(Array.isArray(value)){
    assert.equal(Object.getPrototypeOf(value),Array.prototype);
    const length=props.length.value;
    assert.ok(Number.isSafeInteger(length)&&length>=0&&length<=100000);
    assert.deepEqual(Reflect.ownKeys(props),[...Array.from({length},(_,i)=>String(i)),"length"]);
    return Object.freeze(Array.from({length},(_,i)=>{
      const p=props[String(i)];assert.ok(p&&Object.hasOwn(p,"value")&&p.enumerable);
      return detached(p.value,depth+1);
    }));
  }
  assert.ok([Object.prototype,null].includes(Object.getPrototypeOf(value)));
  const result={};
  for(const key of Reflect.ownKeys(props)){
    const p=props[key];assert.ok(typeof key==="string"&&Object.hasOwn(p,"value")&&p.enumerable);
    Object.defineProperty(result,key,{value:detached(p.value,depth+1),enumerable:true});
  }
  return Object.freeze(result);
}
function fields(value,keys){
  assert.ok(value&&typeof value==="object"&&!Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(),[...keys].sort());
}
function name(value){
  assert.ok(typeof value==="string"&&value.length>0&&!value.includes("\0")
    &&Buffer.byteLength(value,"utf8")<=63&&Buffer.from(value,"utf8").toString("utf8")===value);
}
function rows(reply){
  assert.ok(reply&&reply.command==="SELECT"&&Number.isSafeInteger(reply.rowCount));
  const result=detached(reply.rows);assert.ok(Array.isArray(result));
  assert.equal(reply.rowCount,result.length);return result;
}
// Preserve the COMPLETE release row in the same PostgreSQL representation as
// the original DATA stream. Driver timestamp decoding truncates microseconds;
// a hand-picked field list also silently loses later release-control columns.
export function readProductionBackupOriginalRelease(reply){
 const selected=rows(reply);assert.equal(selected.length,1,'Exactly one original deployed release required');
 fields(selected[0],['original_row']);
 const raw=selected[0].original_row;
 assert.ok(typeof raw==='string'&&Buffer.byteLength(raw)>0&&Buffer.byteLength(raw)<=16*1024*1024,'Original PostgreSQL release JSON text required');
 const original=JSON.parse(raw);
 assert.ok(original&&typeof original==='object'&&!Array.isArray(original),'Original complete release object required');
 return detached(original);
}
const CONTEXT_SQL=`select jsonb_build_object(
  'database_oid',(select oid::text from pg_catalog.pg_database where datname=current_database()),
  'backend_pid',pg_catalog.pg_backend_pid(),'actor',current_user,'session_actor',session_user,
  'read_only',pg_catalog.current_setting('transaction_read_only'),
  'isolation',pg_catalog.current_setting('transaction_isolation'),
  'search_path',pg_catalog.current_setting('search_path'),
  'row_security',pg_catalog.current_setting('row_security'),
  'snapshot_id',pg_catalog.txid_current_snapshot()::text,
  'transaction_started_at',pg_catalog.transaction_timestamp()::text,
  'virtual_xid',(select l.virtualtransaction::text from pg_catalog.pg_locks l
    where l.pid=pg_catalog.pg_backend_pid() and l.locktype='virtualxid' and l.granted)
) context`;
const RELATIONS_SQL=`select n.nspname schema_name,c.relname table_name,c.relkind::text relation_kind,
 c.relispartition is_partition,pg_catalog.pg_get_userbyid(c.relowner) owner_name,
 c.relrowsecurity,c.relforcerowsecurity
 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private')
 and c.relkind in ('r','p','f') order by n.nspname,c.relname`;
const GUARDS_SQL=`select pg_catalog.pg_get_functiondef(p.oid) definition,p.prosrc,
 pg_catalog.pg_get_userbyid(p.proowner) owner
 from (values(0,'custodial_release_identity.guard_group_original_creation()'),
             (1,'custodial_dr.guard_application_mutation()')) original(ordinal,identity)
 left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(original.identity)
 order by original.ordinal`;

function requireOriginalNamespaceCoverage(relationRows,routines,relations,namespaces_columns){
 const namespaceRows=namespaces_columns.filter(r=>r.kind==='SCHEMA'),names=namespaceRows.map(r=>r.schema_name);
 assert.equal(new Set(names).size,names.length,'Duplicate original namespace owner/ACL metadata');
 assert.ok(names.length>=4&&names.length<=SCHEMAS.length&&names.every(n=>SCHEMAS.includes(n)),
  'Original namespace metadata outside fixed backup scope');
 assert.ok(SCHEMAS.slice(0,4).every(n=>names.includes(n)),'Complete original legacy schema ACL scope required');
 for(const row of [...relationRows,...routines,...relations,...namespaces_columns])
  assert.ok(names.includes(row.schema_name),'Original private object has no captured namespace owner/ACL');
 return names;
}

   async function captureOriginalNamespaceColumnAcls(client,query){

    const data=(value,keys)=>{
     assert.ok(value!==null&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null),'Closed ACL record required');
     const ds=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(ds);
     assert.ok(names.every(k=>typeof k==='string'),'ACL symbol keys refused');
     assert.deepEqual(names.sort(),[...keys].sort(),'Exact ACL record keys');
     const copy={};
     for(const key of keys){assert.ok(Object.hasOwn(ds[key],'value')&&ds[key].enumerable,'ACL accessors refused');copy[key]=ds[key].value;}
     return copy;
    };
    const list=value=>{
     assert.ok(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype,'Plain ACL array required');
     const ds=Object.getOwnPropertyDescriptors(value),length=ds.length?.value;
     assert.ok(Number.isSafeInteger(length)&&length>=0);assert.equal(Reflect.ownKeys(ds).length,length+1,'ACL sparse/extra array properties refused');
     const copy=[];
     for(let i=0;i<length;i++){const d=ds[String(i)];assert.ok(d&&Object.hasOwn(d,'value')&&d.enumerable,'ACL array accessors/holes refused');copy.push(d.value);}
     return copy;
    };
    const name=value=>{
     assert.ok(typeof value==='string'&&value.length>0&&!value.includes('\0')&&Buffer.byteLength(value,'utf8')<=63&&Buffer.from(value,'utf8').toString('utf8')===value,'Exact PostgreSQL ACL name required');
     return value;
    };
    const compare=(a,b)=>{for(let i=0;i<a.length;i++){const n=Buffer.compare(Buffer.from(a[i]??'','utf8'),Buffer.from(b[i]??'','utf8'));if(n)return n;}return 0;};
    const objectKey=r=>[r.kind,r.schema_name,r.object_name,r.column_name];
    const grantKey=g=>[g.grantee,g.grantor,g.privilege_type];
    const scopes=['public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private'];
    const privileges={SCHEMA:['USAGE','CREATE'],COLUMN:['SELECT','INSERT','UPDATE','REFERENCES']};
    const rows=(await query(`
     with namespaces as (
      select oid,nspname,nspowner,nspacl from pg_catalog.pg_namespace
      where nspname in ('public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private')
     ), objects as (
      select 'SCHEMA'::text kind,n.nspname schema_name,n.nspname object_name,
       n.nspowner owner_oid,null::text column_name,n.nspacl acl
      from namespaces n
      union all
      select case when a.attnum>0 and not a.attisdropped and c.relkind in ('r','p','v','m','f') then 'COLUMN'
        else 'UNSUPPORTED_COLUMN_RELATION_'||c.relkind::text end,
       n.nspname,c.relname,c.relowner,a.attname::text,a.attacl
      from namespaces n join pg_catalog.pg_class c on c.relnamespace=n.oid
      join pg_catalog.pg_attribute a on a.attrelid=c.oid
      -- Do not silently omit explicit ACLs on an unsupported/dropped/system
      -- column. Return an unsupported descriptor and refuse capture instead.
      where (a.attnum>0 and not a.attisdropped and c.relkind in ('r','p','v','m','f'))
       or pg_catalog.cardinality(a.attacl)>0
     )
     select o.kind,o.schema_name,o.object_name,owner.rolname owner_name,o.column_name,
      coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
       'grantee',case when a.grantee=0 then 'PUBLIC' when grantee.rolname<>'PUBLIC' then grantee.rolname end,
       'grantor',case when grantor.rolname<>'PUBLIC' then grantor.rolname end,
       'privilege_type',a.privilege_type,'is_grantable',a.is_grantable))
       from pg_catalog.aclexplode(case when o.kind='SCHEMA'
        then coalesce(o.acl,pg_catalog.acldefault('n',o.owner_oid)) else o.acl end) a
       left join pg_catalog.pg_roles grantee on grantee.oid=a.grantee
       left join pg_catalog.pg_roles grantor on grantor.oid=a.grantor
       where a.grantee<>o.owner_oid),'[]'::jsonb) grants
     from objects o left join pg_catalog.pg_roles owner on owner.oid=o.owner_oid
    `)).rows;
    const objects=[],seen=new Set();
    for(const value of list(rows)){
     const r=data(value,['kind','schema_name','object_name','owner_name','column_name','grants']);
     assert.ok(r.kind==='SCHEMA'||r.kind==='COLUMN','Unsupported explicit column ACL object');
     name(r.schema_name);name(r.object_name);name(r.owner_name);assert.ok(scopes.includes(r.schema_name),'ACL namespace outside fixed scope');
     if(r.kind==='SCHEMA'){assert.equal(r.object_name,r.schema_name);assert.equal(r.column_name,null);}
     else name(r.column_name);
     const identity=r.kind==='SCHEMA'?quoteIdentifier(r.schema_name):
      quoteIdentifier(r.schema_name)+'.'+quoteIdentifier(r.object_name)+'('+quoteIdentifier(r.column_name)+')';
     const grants=[],seenGrants=new Set();
     for(const value of list(r.grants)){
      const g=data(value,['grantee','grantor','privilege_type','is_grantable']);
      name(g.grantee);name(g.grantor);assert.notEqual(g.grantor,'PUBLIC');assert.notEqual(g.grantee,r.owner_name,'Owner ACL entries must be excluded');
      assert.ok(privileges[r.kind].includes(g.privilege_type),'Unsupported ACL privilege');assert.equal(typeof g.is_grantable,'boolean');
      assert.ok(!(g.grantee==='PUBLIC'&&g.is_grantable),'PUBLIC grant option refused');
      const key=JSON.stringify(grantKey(g));assert.ok(!seenGrants.has(key),'Duplicate ACL permission/grantor');seenGrants.add(key);
      grants.push(Object.freeze(g));
     }
     grants.sort((a,b)=>compare(grantKey(a),grantKey(b)));
     const row=Object.freeze({kind:r.kind,schema_name:r.schema_name,object_name:r.object_name,identity,owner_name:r.owner_name,column_name:r.column_name,grants:Object.freeze(grants)});
     const key=JSON.stringify(objectKey(row));assert.ok(!seen.has(key),'Duplicate ACL object');seen.add(key);objects.push(row);
    }
    objects.sort((a,b)=>compare(objectKey(a),objectKey(b)));
    return Object.freeze(objects);
   }

   async function captureOriginalRoutineAcls(client,query){
    const reply=await query(`select pg_catalog.current_setting('search_path') search_path,
     coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'kind',case p.prokind when 'f' then 'FUNCTION' when 'p' then 'PROCEDURE' else null end,
      'schema_name',n.nspname,'object_name',p.proname,
      'identity',pg_catalog.format('%I.%I(%s)',n.nspname,p.proname,pg_catalog.oidvectortypes(p.proargtypes)),
      'owner_name',owner_role.rolname,'column_name',null,
      'grants',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
       'grantee',case when a.grantee=0 then 'PUBLIC' when grantee_role.rolname='PUBLIC' then null else grantee_role.rolname end,
       'grantor',grantor_role.rolname,'privilege_type',a.privilege_type,'is_grantable',a.is_grantable))
       from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
       left join pg_catalog.pg_roles grantee_role on grantee_role.oid=a.grantee
       left join pg_catalog.pg_roles grantor_role on grantor_role.oid=a.grantor
       where a.grantee<>p.proowner),'[]'::jsonb))),'[]'::jsonb) routines
     from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
     left join pg_catalog.pg_roles owner_role on owner_role.oid=p.proowner
     where n.nspname in ('public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private')`);
    assert.equal(reply.rows.length,1);assert.equal(reply.rows[0].search_path,'pg_catalog','Routine type identity requires Main pg_catalog search_path');
    const closed=(value,names)=>{
     assert.ok(value&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
     const d=Object.getOwnPropertyDescriptors(value);assert.deepEqual(Reflect.ownKeys(d).sort(),[...names].sort());
     return Object.fromEntries(names.map(k=>{assert.ok(Object.hasOwn(d[k],'value')&&d[k].enumerable);return [k,d[k].value];}));
    };
    const list=(value)=>{
     assert.ok(Array.isArray(value));const d=Object.getOwnPropertyDescriptors(value),length=d.length.value;
     assert.ok(Number.isSafeInteger(length)&&length>=0&&length<=100000);assert.equal(Reflect.ownKeys(d).length,length+1);
     return Array.from({length},(_,i)=>{assert.ok(d[i]&&Object.hasOwn(d[i],'value')&&d[i].enumerable);return d[i].value;});
    };
    const text=(s,max=63)=>{assert.equal(typeof s,'string');assert.ok(s.length>0&&!s.includes('\0'));
     const bytes=Buffer.from(s,'utf8');assert.ok(bytes.length<=max&&bytes.toString('utf8')===s);return s;};
    const compare=(a,b)=>Buffer.compare(Buffer.from(a,'utf8'),Buffer.from(b,'utf8'));
    const routineKey=r=>JSON.stringify([r.schema_name,r.object_name,r.identity,r.kind]);
    const grantKey=g=>JSON.stringify([g.grantee,g.grantor,g.privilege_type]);
    const result=list(reply.rows[0].routines).map(value=>{
     const r=closed(value,['kind','schema_name','object_name','identity','owner_name','column_name','grants']);
     assert.ok(['FUNCTION','PROCEDURE'].includes(r.kind),'Unsupported selected pg_proc routine kind');
     assert.ok(['public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private'].includes(r.schema_name));
     text(r.object_name);text(r.identity,65536);text(r.owner_name);assert.equal(r.column_name,null);
     const seen=new Set();const grants=list(r.grants).map(value=>{
      const g=closed(value,['grantee','grantor','privilege_type','is_grantable']);
      text(g.grantee);text(g.grantor);assert.notEqual(g.grantee,r.owner_name,'Owner ACL entries are excluded');
      assert.equal(g.privilege_type,'EXECUTE');assert.equal(typeof g.is_grantable,'boolean');
      const key=grantKey(g);assert.ok(!seen.has(key),'Duplicate effective routine ACL tuple');seen.add(key);return g;
     }).sort((a,b)=>compare(grantKey(a),grantKey(b)));
     return {kind:r.kind,schema_name:r.schema_name,object_name:r.object_name,identity:r.identity,owner_name:r.owner_name,column_name:null,grants};
    }).sort((a,b)=>compare(routineKey(a),routineKey(b)));
    assert.ok(result.length>0,'Empty selected original routine catalog');
    const identities=new Set();for(const r of result){assert.ok(!identities.has(r.identity),'Duplicate selected routine identity');identities.add(r.identity);}
    return result;
   }

   async function captureOriginalRelationAcls(client,query){
    const {types}=createRequire(import.meta.url)('node:util');
    const fixedSchemas=new Set(['public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private']);
    const kinds=new Set(['TABLE','PARTITIONED TABLE','VIEW','MATERIALIZED VIEW','FOREIGN TABLE','SEQUENCE']);
    const tablePrivileges=new Set(['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']);
    const sequencePrivileges=new Set(['SELECT','UPDATE','USAGE']);
    const q=name=>'"'+name.replaceAll('"','""')+'"';
    const key=item=>JSON.stringify([item.schema_name,item.object_name]);
    const grantKey=item=>JSON.stringify([item.grantee,item.grantor,item.privilege_type]);
    const compare=(a,b)=>Buffer.compare(Buffer.from(a,'utf8'),Buffer.from(b,'utf8'));
    const name=value=>{assert.equal(typeof value,'string');assert.ok(value.length>0&&!value.includes('\0'));
     assert.ok(Buffer.byteLength(value,'utf8')<=63);assert.equal(Buffer.from(value,'utf8').toString('utf8'),value);return value;};
    const fields=(value,keys)=>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value)&&!types.isProxy(value));
     assert.ok([Object.prototype,null].includes(Object.getPrototypeOf(value)));
     const properties=Object.getOwnPropertyDescriptors(value);assert.deepEqual(Reflect.ownKeys(properties).sort(),[...keys].sort());
     for(const k of keys)assert.ok(Object.hasOwn(properties[k],'value')&&properties[k].enumerable,'Plain ACL metadata required');return properties;};
    const array=value=>{assert.ok(Array.isArray(value)&&!types.isProxy(value));
     assert.equal(Object.getPrototypeOf(value),Array.prototype);
     assert.deepEqual(Reflect.ownKeys(value),[...Array.from({length:value.length},(_,i)=>String(i)),'length']);
     for(let i=0;i<value.length;i++)assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(value,String(i)),'value'));return value;};
    const result=await query(`select jsonb_build_object(
     'kind',case c.relkind when 'r' then 'TABLE' when 'p' then 'PARTITIONED TABLE' when 'v' then 'VIEW'
       when 'm' then 'MATERIALIZED VIEW' when 'f' then 'FOREIGN TABLE' when 'S' then 'SEQUENCE' end,
     'schema_name',n.nspname::text,'object_name',c.relname::text,
     'identity','"'||replace(n.nspname::text,'"','""')||'"."'||replace(c.relname::text,'"','""')||'"',
     'owner_name',owner_role.rolname::text,'column_name',null,
     'grants',coalesce((select jsonb_agg(jsonb_build_object(
       'grantee',case when a.grantee=0 then 'PUBLIC' when grantee.rolname='PUBLIC' then null else grantee.rolname::text end,
       'grantor',grantor.rolname::text,'privilege_type',a.privilege_type,'is_grantable',a.is_grantable))
      from pg_catalog.aclexplode(coalesce(c.relacl,case when c.relkind='S'
        then pg_catalog.acldefault('s',c.relowner) else pg_catalog.acldefault('r',c.relowner) end)) a
      left join pg_catalog.pg_roles grantee on grantee.oid=a.grantee
      left join pg_catalog.pg_roles grantor on grantor.oid=a.grantor
      where a.grantee<>c.relowner),'[]'::jsonb)) descriptor
     from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
     left join pg_catalog.pg_roles owner_role on owner_role.oid=c.relowner
     where n.nspname in ('public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private')
       and c.relkind in ('r','p','v','m','f','S')`);
    const objects=[],seen=new Set();
    for(const row of array(result.rows)){
     fields(row,['descriptor']);const item=row.descriptor;
     fields(item,['kind','schema_name','object_name','identity','owner_name','column_name','grants']);
     assert.ok(kinds.has(item.kind)&&fixedSchemas.has(item.schema_name));
     name(item.schema_name);name(item.object_name);name(item.owner_name);assert.notEqual(item.owner_name,'PUBLIC');
     assert.equal(item.column_name,null);assert.equal(item.identity,q(item.schema_name)+'.'+q(item.object_name));
     assert.ok(!seen.has(key(item)),'Duplicate relation ACL object');seen.add(key(item));
     const grants=[],seenGrants=new Set(),allowed=item.kind==='SEQUENCE'?sequencePrivileges:tablePrivileges;
     for(const grant of array(item.grants)){
      fields(grant,['grantee','grantor','privilege_type','is_grantable']);name(grant.grantee);name(grant.grantor);
      assert.notEqual(grant.grantor,'PUBLIC');assert.notEqual(grant.grantee,item.owner_name);
      assert.ok(allowed.has(grant.privilege_type),'Unsupported relation privilege');assert.equal(typeof grant.is_grantable,'boolean');
      assert.ok(!seenGrants.has(grantKey(grant)),'Duplicate relation ACL grant');seenGrants.add(grantKey(grant));
      grants.push(Object.freeze({grantee:grant.grantee,grantor:grant.grantor,privilege_type:grant.privilege_type,is_grantable:grant.is_grantable}));
     }
     grants.sort((a,b)=>compare(grantKey(a),grantKey(b)));
     objects.push(Object.freeze({kind:item.kind,schema_name:item.schema_name,object_name:item.object_name,identity:item.identity,
      owner_name:item.owner_name,column_name:null,grants:Object.freeze(grants)}));
    }
    objects.sort((a,b)=>compare(key(a),key(b)));return Object.freeze(objects);
   }

// DATA validation inside the SAME original native snapshot only. A legacy
// schema's observed empty private relation census is retained as actual
// absence, including the fixed private guard's original all-NULL catalog row.
// Partial private tables or a missing mandatory mutation guard still refuse.
function requireOriginalPrivateRelationGuardData(relationRows,guards){
 const privateRows=relationRows.filter(r=>r.schema_name==="custodial_release_identity");
 if(privateRows.length!==0)for(const table of ["group_original_creations","employee_message_original_outcomes"])
  assert.ok(privateRows.some(r=>r.table_name===table),"Required original private relation metadata is missing");
 assert.equal(guards.length,2);
 for(let i=0;i<guards.length;i++){
  const g=guards[i];fields(g,["definition","prosrc","owner"]);
  if(i===0&&privateRows.length===0&&g.definition===null&&g.prosrc===null&&g.owner===null)continue;
  name(g.owner);
  assert.ok(typeof g.definition==="string"&&typeof g.prosrc==="string"
   &&g.definition.startsWith("CREATE OR REPLACE FUNCTION "+GUARDS[i]+"\n")
   &&g.definition.endsWith("AS $function$"+g.prosrc+"$function$\n"),
   "Exact original guard definition/body is unavailable");
 }
}

export async function captureProductionBackupOriginalMetadata(client) {
  assert.equal(arguments.length,1,"Original metadata capture takes only its existing snapshot client");
  requireNative(client);
  let originalContext;
  async function context(){
    requireNative(client);
    const reply=await Reflect.apply(nativeQuery,client,[CONTEXT_SQL]);
    requireNative(client);
    const observed=rows(reply);assert.equal(observed.length,1);fields(observed[0],["context"]);
    const value=observed[0].context;
    fields(value,["database_oid","backend_pid","actor","session_actor","read_only","isolation",
      "search_path","row_security","snapshot_id","transaction_started_at","virtual_xid"]);
    assert.ok(typeof value.database_oid==="string"&&/^[1-9][0-9]{0,9}$/.test(value.database_oid)
      &&BigInt(value.database_oid)<=4294967295n);
    assert.ok(Number.isInteger(value.backend_pid)&&value.backend_pid>0&&value.backend_pid<=2147483647);
    name(value.actor);name(value.session_actor);assert.equal(value.actor,value.session_actor);
    assert.equal(value.read_only,"on");assert.equal(value.isolation,"repeatable read");
    assert.equal(value.search_path,"pg_catalog");assert.equal(value.row_security,"off");
    assert.ok(typeof value.snapshot_id==="string"&&/^[0-9]+:[0-9]+:[0-9,]*$/.test(value.snapshot_id));
    assert.ok(typeof value.virtual_xid==="string"&&/^[1-9][0-9]*\/[1-9][0-9]*$/.test(value.virtual_xid));
    assert.ok(typeof value.transaction_started_at==="string"&&value.transaction_started_at.length>0);
    if(originalContext)assert.deepEqual(value,originalContext,"Original read-only snapshot context changed");
    return value;
  }
  originalContext=await context();
  async function query(sql){
    // Only the five fixed catalog statements below call this private closure.
    // Every actual await checks the original client and server context again.
    await context();requireNative(client);
    const reply=await Reflect.apply(nativeQuery,client,[sql]);
    requireNative(client);
    await context();requireNative(client);
    const result=rows(reply);
    return {rows:result,rowCount:result.length};
  }
  const relationRows=(await query(RELATIONS_SQL)).rows;
  assert.ok(relationRows.length>0,"Original relation metadata is missing");
  const seen=new Set();
  for(const r of relationRows){
    fields(r,["schema_name","table_name","relation_kind","is_partition","owner_name","relrowsecurity","relforcerowsecurity"]);
    assert.ok(SCHEMAS.includes(r.schema_name));name(r.table_name);name(r.owner_name);
    assert.ok(["r","p","f"].includes(r.relation_kind));
    for(const k of ["is_partition","relrowsecurity","relforcerowsecurity"])assert.equal(typeof r[k],"boolean");
    const key=JSON.stringify([r.schema_name,r.table_name]);assert.ok(!seen.has(key));seen.add(key);
  }
  const guards=(await query(GUARDS_SQL)).rows;
  requireOriginalPrivateRelationGuardData(relationRows,guards);
  const routines=await captureOriginalRoutineAcls(client,query);
  const relations=await captureOriginalRelationAcls(client,query);
  const namespaces_columns=await captureOriginalNamespaceColumnAcls(client,query);
  requireOriginalNamespaceCoverage(relationRows,routines,relations,namespaces_columns);
  await context();requireNative(client);
  return detached({relations:relationRows,guards,acls:{routines,relations,namespaces_columns}});
}
