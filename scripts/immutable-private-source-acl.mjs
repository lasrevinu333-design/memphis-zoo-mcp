import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { types } from "node:util";
import pg from "pg";
import { assertVerifiedImmutableBootstrapSource, readVerifiedImmutableBootstrapAcls } from "./immutable-private-source-bootstrap.mjs";
import { readVerifiedImmutableBootstrapInventory, readVerifiedPrivateImportSource } from "./disaster-recovery-archive.mjs";

const Client=pg.Client, query=Client.prototype.query;
const quoteIdentifier=value=>'"'+String(value).replaceAll('"','""')+'"';
const scopes=Object.freeze(["public","auth","storage","custodial_release_identity","custodial_employment","custodial_coverall","custodial_leadership_private"]);
const sha=value=>createHash("sha256").update(value).digest("hex");
function fields(value,keys){
  assert.ok(value&&typeof value==="object"&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype,"Closed original metadata required");
  const properties=Object.getOwnPropertyDescriptors(value);
  assert.deepEqual(Reflect.ownKeys(properties).sort(),keys.slice().sort());
  return Object.fromEntries(keys.map(key=>{
    const field=properties[key];assert.ok(field&&Object.hasOwn(field,"value")&&field.enumerable,"Original metadata getters refused");
    return [key,field.value];
  }));
}
function list(value){
  assert.ok(Array.isArray(value)&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Array.prototype,"Dense original metadata array required");
  const properties=Object.getOwnPropertyDescriptors(value),length=properties.length.value;
  assert.ok(Number.isSafeInteger(length)&&length>=0&&length<=100000);
  assert.equal(Reflect.ownKeys(properties).length,length+1);
  return Array.from({length},(_,index)=>{
    const field=properties[index];assert.ok(field&&Object.hasOwn(field,"value")&&field.enumerable);
    return field.value;
  });
}
function identifier(value){
  assert.equal(typeof value,"string");assert.ok(value.length>0&&!value.includes("\0"));
  assert.ok(Buffer.byteLength(value,"utf8")<=63);assert.equal(Buffer.from(value,"utf8").toString("utf8"),value);
  return value;
}
function copyOriginalAcls(value){
  const outer=fields(value,["routines","relations","namespaces_columns"]),copy={};
  for(const group of ["routines","relations","namespaces_columns"]){
    copy[group]=Object.freeze(list(outer[group]).map(value=>{
      const row=fields(value,["kind","schema_name","object_name","identity","owner_name","column_name","grants"]);
      for(const key of ["kind","schema_name","object_name","identity","owner_name"])assert.equal(typeof row[key],"string");
      assert.ok(row.column_name===null||typeof row.column_name==="string");
      row.grants=Object.freeze(list(row.grants).map(value=>{
        const grant=fields(value,["grantee","grantor","privilege_type","is_grantable"]);
        for(const key of ["grantee","grantor","privilege_type"])assert.equal(typeof grant[key],"string");
        assert.equal(typeof grant.is_grantable,"boolean");return Object.freeze(grant);
      }));
      return Object.freeze(row);
    }));
  }
  return Object.freeze(copy);
}
function copyOriginalRelations(value){
  const seen=new Set();
  const rows=list(value).map(value=>{
    const row=fields(value,["schema_name","table_name","owner_name","relation_kind","is_partition","relrowsecurity","relforcerowsecurity"]);
    identifier(row.schema_name);identifier(row.table_name);identifier(row.owner_name);
    assert.ok(scopes.includes(row.schema_name));
    // Preserve the existing initializer's ordinary-table-only Source profile;
    // do not count a foreign table (potential remote IO) or omit a partition.
    assert.equal(row.relation_kind,"r");assert.equal(row.is_partition,false);
    assert.equal(typeof row.relrowsecurity,"boolean");assert.equal(typeof row.relforcerowsecurity,"boolean");
    const key=JSON.stringify([row.schema_name,row.table_name]);assert.ok(!seen.has(key));seen.add(key);
    return Object.freeze(row);
  });
  assert.ok(rows.length>0);return Object.freeze(rows);
}
const contextSql=`
  with expected_owners(relation) as (values
    ('custodial_dr.restore_control'),('custodial_dr.restore_manifests'),('custodial_dr.application_mutation_leases'),
    ('custodial_release_identity.group_original_creations'),('custodial_release_identity.employee_message_original_outcomes')),
  fence_keys(key) as (values
    (pg_catalog.hashtextextended('memphis-zoo-application-mutation-admission',0)),
    (pg_catalog.hashtextextended('memphis-zoo-application-mutation-fence',0)))
  select pg_catalog.jsonb_build_object(
    'database_oid',(select oid::text from pg_catalog.pg_database where datname=current_database()),
    'pid',pg_catalog.pg_backend_pid(),'xid',pg_catalog.txid_current()::text,
    'counter_parallel_safety',(select proparallel::text from pg_catalog.pg_proc where oid='pg_catalog.txid_current()'::pg_catalog.regprocedure),
    'actor',current_user,'session_actor',session_user,
    'database_owner',(select pg_catalog.pg_get_userbyid(datdba) from pg_catalog.pg_database where datname=current_database()),
    'namespace_owners_ok',(select count(*)=2 and bool_and(pg_catalog.pg_get_userbyid(nspowner)=
      case nspname when 'custodial_dr' then 'postgres' when 'custodial_release_identity' then 'supabase_admin' end)
      from pg_catalog.pg_namespace where nspname in('custodial_dr','custodial_release_identity')),
    'relation_owners_ok',(select count(*)=5 from expected_owners e join pg_catalog.pg_class c on c.oid=pg_catalog.to_regclass(e.relation)
      where c.relkind='r' and pg_catalog.pg_get_userbyid(c.relowner)=current_user),
    'read_only',pg_catalog.current_setting('transaction_read_only'),'row_security',pg_catalog.current_setting('row_security'),
    'replication_role',pg_catalog.current_setting('session_replication_role'),'search_path',pg_catalog.current_setting('search_path'),
    'fences_held',(select count(*)=2 from fence_keys f where exists(select 1 from pg_catalog.pg_locks l
      where l.locktype='advisory' and l.pid=pg_catalog.pg_backend_pid()
        and l.database=(select oid from pg_catalog.pg_database where datname=current_database())
        and l.granted and l.mode='ExclusiveLock' and l.objsubid=1
        and l.classid=((f.key>>32)&4294967295)::oid and l.objid=(f.key&4294967295)::oid)),
    'lease_count',(select count(*)::text from custodial_dr.application_mutation_leases),
    'control_count',(select count(*)::int from custodial_dr.restore_control where singleton),
    'control',(select pg_catalog.jsonb_build_object('state',state,'generation',authority_generation::text,
      'paused',mutations_paused,'restore_id',restore_id,'archive_digest',archive_digest)
      from custodial_dr.restore_control where singleton),
    'tables',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'schema_name',n.nspname,'table_name',c.relname,'owner_name',pg_catalog.pg_get_userbyid(c.relowner),
      'relation_kind',c.relkind,'is_partition',c.relispartition,'relrowsecurity',c.relrowsecurity,'relforcerowsecurity',c.relforcerowsecurity)
      order by n.nspname collate "C",c.relname collate "C"),'[]'::jsonb)
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname in('public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private') and c.relkind in('r','p','f'))
  ) context
`;

// No transaction/connection ownership or recovery authority is delegated.
export async function reconcileVerifiedImmutableBootstrapAcls(db,source,archive){
  const native=()=>{
    assert.ok(db&&typeof db==="object"&&!types.isProxy(db)&&Object.getPrototypeOf(db)===Client.prototype
      &&!Object.hasOwn(db,"query")&&Client.prototype.query===query,"Actual native pg.Client required");
  };
  native();assertVerifiedImmutableBootstrapSource(source,archive);
  // Read only WeakMap-/archive-branded original bytes, never plan.rawRows or
  // a public plan.inventory/survivor JSON field as authority.
  const originalAcls=copyOriginalAcls(readVerifiedImmutableBootstrapAcls(source,archive));
  // The signed schema Source owns custodial_dr as postgres but the original
  // release-identity namespace as supabase_admin. Never ALTER OWNER or accept
  // an arbitrary current target owner to satisfy this prerequisite.
  const releaseNamespace=originalAcls.namespaces_columns.filter(row=>row.kind==='SCHEMA'&&row.schema_name==='custodial_release_identity');
  assert.equal(releaseNamespace.length,1);assert.equal(releaseNamespace[0].owner_name,'supabase_admin');
  const original=readVerifiedPrivateImportSource(archive),observed=readVerifiedImmutableBootstrapInventory(archive);
  const inventory=fields(observed,["sourceBinding","inventory"]);
  assert.equal(inventory.sourceBinding,original.sourceBinding);
  const relationMember=Object.getOwnPropertyDescriptor(inventory.inventory,"inventory/original-relations.json");
  assert.ok(relationMember&&Object.hasOwn(relationMember,"value")&&typeof relationMember.value==="string");
  assert.equal(sha(relationMember.value),original.sourceBinding.source_identity.original_relations_sha256);
  const originalRelations=copyOriginalRelations(JSON.parse(relationMember.value));
  const metadata=rows=>rows.map(row=>[row.schema_name,row.table_name,row.owner_name,row.relation_kind,
    row.is_partition,row.relrowsecurity,row.relforcerowsecurity]).sort((a,b)=>Buffer.compare(Buffer.from(JSON.stringify(a.slice(0,2))),Buffer.from(JSON.stringify(b.slice(0,2)))));
  const expectedRelations=metadata(originalRelations);
  const current=()=>{native();assertVerifiedImmutableBootstrapSource(source,archive);};
  const raw=async(sql,args=[])=>{
    current();let result,failed=false,failure;
    try{result=await Reflect.apply(query,db,[sql,args]);}catch(error){failed=true;failure=error;}
    try{current();}catch(error){if(failed)throw new AggregateError([failure,error],"Original ACL operation/currentness refused",{cause:failure});throw error;}
    if(failed)throw failure;return result;
  };
  let originalContext;
  const context=async()=>{
    const result=await raw(contextSql);
    assert.equal(result.rowCount,1);assert.equal(result.rows.length,1);
    const row=fields(result.rows[0],["context"]).context;
    const value=fields(row,["database_oid","pid","xid","counter_parallel_safety","actor","session_actor","database_owner","namespace_owners_ok",
      "relation_owners_ok","read_only","row_security","replication_role","search_path","fences_held","lease_count","control_count","control","tables"]);
    assert.equal(value.actor,"supabase_admin");assert.equal(value.session_actor,value.actor);
    assert.equal(value.database_owner,"postgres");assert.equal(value.namespace_owners_ok,true);assert.equal(value.relation_owners_ok,true);
    assert.equal(value.read_only,"off");assert.equal(value.row_security,"off");assert.equal(value.replication_role,"origin");assert.equal(value.search_path,"pg_catalog");
    assert.equal(value.fences_held,true);assert.equal(value.lease_count,"0");assert.equal(value.control_count,1);
    assert.equal(value.counter_parallel_safety,'u','Original transaction-bound counters must execute outside parallel workers');
    assert.deepEqual(fields(value.control,["state","generation","paused","restore_id","archive_digest"]),
      {state:"READY",generation:"0",paused:false,restore_id:null,archive_digest:null});
    assert.equal(typeof value.database_oid,"string");assert.match(value.database_oid,/^[1-9][0-9]{0,9}(?![\s\S])/);
    assert.ok(BigInt(value.database_oid)<=4294967295n);assert.ok(Number.isInteger(value.pid)&&value.pid>0&&value.pid<=2147483647);
    assert.equal(typeof value.xid,"string");assert.match(value.xid,/^[1-9][0-9]{0,18}(?![\s\S])/);assert.ok(BigInt(value.xid)<=9223372036854775807n);
    value.tables=copyOriginalRelations(value.tables);assert.deepEqual(metadata(value.tables),expectedRelations,"Full original table owner/RLS scope differs");
    value.control=Object.freeze({...value.control});Object.freeze(value);
    if(originalContext)assert.deepEqual(value,originalContext,"Original actor/transaction/fences/target changed");
    return value;
  };
  originalContext=await context();current();
  await context();current(); // Same explicit READ WRITE xact, not autocommit.
  const emptyArgs=[];
  const emptySql=originalRelations.map(table=>{
    emptyArgs.push(table.schema_name,table.table_name);
    return "select $"+(emptyArgs.length-1)+"::text schema_name,$"+emptyArgs.length+"::text table_name,count(*)::text row_count,pg_catalog.txid_current()::text transaction_id from ONLY "
      +quoteIdentifier(table.schema_name)+"."+quoteIdentifier(table.table_name);
  }).join(" UNION ALL ");
  const fresh=async()=>{
    await context();current();
    // One actual snapshot covers EVERY selected table; no per-row await or
    // FORCE-RLS-filtered emptiness and no foreign-table network read.
    const result=await raw(emptySql,emptyArgs);
    await context();current();
    assert.equal(result.rowCount,originalRelations.length);assert.equal(result.rows.length,originalRelations.length);
    for(let i=0;i<originalRelations.length;i++){
      const table=originalRelations[i];
      assert.deepEqual(fields(result.rows[i],["schema_name","table_name","row_count","transaction_id"]),
        {schema_name:table.schema_name,table_name:table.table_name,row_count:"0",transaction_id:originalContext.xid},"Target must remain actually empty in the original transaction under row_security off");
    }
    await context();current();
  };
  await fresh();current();
  // This port is private to the three validated original-ACL plan builders.
  // Readbacks remain individually guarded. Pure privilege reductions execute
  // as one transactional batch per complete plan, with no JS await/callback
  // between its statements. No transaction, grant or recovery authority leaves
  // this function; a failed batch or post-await guard requires caller rollback.
  const target=Object.freeze({query:async(sql,args=[])=>{
    assert.equal(typeof sql,"string");
    assert.ok(!/^\s*REVOKE\b/i.test(sql),"Original ACL writes require the guarded batch port");
    await context();current();
    const result=await raw(sql,args);
    await context();current();
    return result;
  },revokeBatch:async(commands)=>{
    const statements=list(commands);
    assert.ok(statements.length>0,"Nonempty validated original ACL plan required");
    for(const statement of statements){
      assert.equal(typeof statement,"string");
      assert.ok(statement.startsWith("REVOKE ")&&!statement.includes("\0"),"Only private original ACL revocations permitted");
    }
    await fresh();current();
    const result=await raw(statements.join(";\n"));
    // pg simple-query returns one Result per statement, not one aggregate tag.
    // Count from the closed plan, never by splitting quoted SQL identifiers.
    const results=Array.isArray(result)?list(result):[result];
    assert.equal(results.length,statements.length,"Incomplete original ACL batch receipt");
    for(const entry of results){
      assert.ok(entry&&typeof entry==="object"&&!types.isProxy(entry));
      assert.equal(entry.command,"REVOKE","Unconfirmed original ACL revocation");
      assert.equal(entry.rowCount,null);assert.deepEqual(entry.rows,[]);
    }
    await fresh();current();
    return Object.freeze({revocation_count:statements.length});
  }});
  current();const routines=await reconcileOriginalRoutineAcls(target,originalAcls.routines);current();await context();current();
  const relations=await reconcileOriginalRelationAcls(target,originalAcls.relations);current();await context();current();
  const namespaces_columns=await reconcileOriginalNamespaceColumnAcls(target,originalAcls.namespaces_columns);current();await context();current();
  await fresh();current();
  return Object.freeze({
    routines:Object.freeze({...routines}),relations:Object.freeze({...relations}),namespaces_columns:Object.freeze({...namespaces_columns}),
    archive_digest:original.sourceBinding.archive_digest,source_identity_sha256:original.sourceBinding.source_identity_sha256,
    target_authority:false,resume_allowed:false,restore_complete:false,
  });
}

   async function captureOriginalNamespaceColumnAcls(client){

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
    const rows=(await client.query(`
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

   async function reconcileOriginalNamespaceColumnAcls(target,original){

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
    // Clone closed DATA before the first await. In particular, never sort or
    // mutate the independently verified/deep-frozen signed original snapshot.
    const copySnapshot=snapshot=>{
     const objects=[],seen=new Set();
     for(const value of list(snapshot)){
      const r=data(value,['kind','schema_name','object_name','identity','owner_name','column_name','grants']);
      assert.ok(r.kind==='SCHEMA'||r.kind==='COLUMN','Unsupported ACL descriptor kind');
      name(r.schema_name);name(r.object_name);name(r.owner_name);assert.ok(scopes.includes(r.schema_name),'ACL namespace outside fixed scope');
      if(r.kind==='SCHEMA'){assert.equal(r.object_name,r.schema_name);assert.equal(r.column_name,null);}
      else name(r.column_name);
      const identity=r.kind==='SCHEMA'?quoteIdentifier(r.schema_name):
       quoteIdentifier(r.schema_name)+'.'+quoteIdentifier(r.object_name)+'('+quoteIdentifier(r.column_name)+')';
      assert.equal(r.identity,identity,'Exact ACL object identity required');
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
    };
    const expected=copySnapshot(original);
    const actual=copySnapshot(await captureOriginalNamespaceColumnAcls(target));
    assert.equal(actual.length,expected.length,'Complete original ACL object set required');
    const revocations=[];
    // Preflight EVERY expected object/owner/grant/grantor/option before ANY
    // REVOKE. An absent original permission is never repaired with a GRANT.
    for(let i=0;i<expected.length;i++){
     const before=actual[i],wanted=expected[i];
     assert.deepEqual(objectKey(before),objectKey(wanted),'Original namespace/column set differs');
     assert.equal(before.identity,wanted.identity);assert.equal(before.owner_name,wanted.owner_name,'Original ACL object owner differs');
     const old=new Map(before.grants.map(g=>[JSON.stringify(grantKey(g)),g]));
     const keep=new Map(wanted.grants.map(g=>[JSON.stringify(grantKey(g)),g]));
     for(const [key,g]of keep){
      const present=old.get(key);assert.ok(present,'Expected original permission/grantor missing');
      assert.ok(!g.is_grantable||present.is_grantable,'Expected original grant option missing');
     }
     for(const [key,g]of old){
      const originalGrant=keep.get(key);
      if(!originalGrant)revocations.push({object:before,grant:g,optionOnly:false});
      else if(g.is_grantable&&!originalGrant.is_grantable)revocations.push({object:before,grant:g,optionOnly:true});
     }
    }
    let revokedPrivileges=0,revokedGrantOptions=0;
    const commands=[];
    // The caller owns rollback on ANY refusal; never commit/retry here.
    for(const {object:r,grant:g,optionOnly}of revocations){
     // Identifiers come from the actual catalog object matched above, never
     // from caller SQL/identity text. Native REVOKE checks actual rights; any
     // denial/RESTRICT dependency failure is terminal, with no role fallback.
     const privilege=g.privilege_type+(r.kind==='COLUMN'?' ('+quoteIdentifier(r.column_name)+')':'');
     const object=r.kind==='SCHEMA'?'SCHEMA '+quoteIdentifier(r.schema_name):
      'TABLE '+quoteIdentifier(r.schema_name)+'.'+quoteIdentifier(r.object_name);
     const grantee=g.grantee==='PUBLIC'?'PUBLIC':quoteIdentifier(g.grantee);
     commands.push('REVOKE '+(optionOnly?'GRANT OPTION FOR ':'')+privilege+' ON '+object+
      ' FROM '+grantee+' GRANTED BY '+quoteIdentifier(g.grantor)+' RESTRICT');
     if(optionOnly)revokedGrantOptions++;else revokedPrivileges++;
    }
    if(commands.length){
     const receipt=data(await target.revokeBatch(Object.freeze(commands)),['revocation_count']);
     assert.equal(receipt.revocation_count,commands.length,'Incomplete original namespace/column ACL batch receipt');
    }
    const final=copySnapshot(await captureOriginalNamespaceColumnAcls(target));
    assert.deepEqual(final,expected,'Exact original namespace/column ACL readback required');
    return Object.freeze({revoked_privileges:revokedPrivileges,revoked_grant_options:revokedGrantOptions});
   }

   async function captureOriginalRoutineAcls(client){
    const reply=await client.query(`select pg_catalog.current_setting('search_path') search_path,
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

   async function reconcileOriginalRoutineAcls(target,original){
    // Detach/validate ALL original DATA synchronously before the first await.
    // Frozen signed arrays are never sorted or mutated in place.
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
    const identities=new Set();let previousRoutine=null;
    const expected=list(original).map(value=>{
     const r=closed(value,['kind','schema_name','object_name','identity','owner_name','column_name','grants']);
     assert.ok(['FUNCTION','PROCEDURE'].includes(r.kind));assert.ok(['public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private'].includes(r.schema_name));
     text(r.object_name);text(r.identity,65536);text(r.owner_name);assert.equal(r.column_name,null);
     assert.ok(!identities.has(r.identity),'Duplicate original routine identity');identities.add(r.identity);
     const key=routineKey(r);if(previousRoutine!==null)assert.ok(compare(previousRoutine,key)<0,'Original routine array is not canonical');previousRoutine=key;
     let previousGrant=null;const grants=list(r.grants).map(value=>{
      const g=closed(value,['grantee','grantor','privilege_type','is_grantable']);text(g.grantee);text(g.grantor);
      assert.notEqual(g.grantee,r.owner_name);assert.equal(g.privilege_type,'EXECUTE');assert.equal(typeof g.is_grantable,'boolean');
      const key=grantKey(g);if(previousGrant!==null)assert.ok(compare(previousGrant,key)<0,'Original ACL array is not canonical/unique');previousGrant=key;return g;
     });
     return {kind:r.kind,schema_name:r.schema_name,object_name:r.object_name,identity:r.identity,owner_name:r.owner_name,column_name:null,grants};
    });
    assert.ok(expected.length>0,'Empty original routine snapshot is unsupported');
    const actual=await captureOriginalRoutineAcls(target);
    assert.equal(actual.length,expected.length,'Target selected routine object set differs');
    const header=r=>({kind:r.kind,schema_name:r.schema_name,object_name:r.object_name,identity:r.identity,owner_name:r.owner_name,column_name:r.column_name});
    const plan=[];
    for(let i=0;i<expected.length;i++){
     const before=expected[i],now=actual[i];assert.deepEqual(header(now),header(before),'Target routine identity/owner differs');
     const originalGrants=new Map(before.grants.map(g=>[grantKey(g),g])),currentGrants=new Map(now.grants.map(g=>[grantKey(g),g]));
     for(const [key,g]of originalGrants){const current=currentGrants.get(key);
      assert.ok(current&&(!g.is_grantable||current.is_grantable),'An original routine privilege/grantor/option is missing; no automatic GRANT');}
     for(const [key,g]of currentGrants){const old=originalGrants.get(key);
      if(!old)plan.push({routine:now,grant:g,optionOnly:false});
      else if(g.is_grantable&&!old.is_grantable)plan.push({routine:now,grant:g,optionOnly:true});}
    }
    const ownerResult=await target.query("select current_user actor,session_user session_actor,pg_catalog.current_setting('search_path') search_path");
    assert.equal(ownerResult.rows.length,1);const owner=ownerResult.rows[0];
    text(owner.actor);assert.equal(owner.actor,owner.session_actor,'Original target owner context changed');assert.equal(owner.search_path,'pg_catalog');
    // REVOKE issued by the actual routine owner targets its OWN grant tuple.
    // A different grantor/owner would need unsupported role context; refuse
    // the ENTIRE plan first, never SET ROLE or accidentally revoke originals.
    for(const step of plan){assert.equal(step.routine.owner_name,owner.actor,'Extra ACL requires unsupported routine-owner context');
     assert.equal(step.grant.grantor,owner.actor,'Extra ACL requires unsupported grantor context');}
    const quote=s=>'"'+s.replaceAll('"','""')+'"';
    const commands=plan.map(step=>{
     const role=step.grant.grantee==='PUBLIC'?'PUBLIC':quote(step.grant.grantee);
     // identity comes ONLY from the fresh fixed-scope target catalog query,
     // never original/caller SQL; its names/types were formatted by Postgres.
     return 'REVOKE '+(step.optionOnly?'GRANT OPTION FOR ':'')+'EXECUTE ON '+step.routine.kind+' '+step.routine.identity+' FROM '+role+' RESTRICT';
    });
    if(commands.length){
     const revoked=await target.revokeBatch(commands);
     assert.deepEqual(closed(revoked,['revocation_count']),{revocation_count:commands.length},'Ambiguous routine REVOKE batch result');
    }
    const after=await captureOriginalRoutineAcls(target);
    assert.deepEqual(after,expected,'Routine ACL reconciliation is not exact (including grantor/options)');
    const finalOwner=(await target.query("select current_user actor,session_user session_actor,pg_catalog.current_setting('search_path') search_path")).rows;
    assert.deepEqual(finalOwner,[owner],'Routine ACL owner/search_path changed');
    return {revoked_count:plan.length,privilege_revokes:plan.filter(s=>!s.optionOnly).length,grant_option_revokes:plan.filter(s=>s.optionOnly).length};
   }

   async function captureOriginalRelationAcls(client){
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
    const result=await client.query(`select jsonb_build_object(
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

   async function reconcileOriginalRelationAcls(target,original){
    const {types}=createRequire(import.meta.url)('node:util');
    // Detach and reject accessors/holes/proxies BEFORE the first await. This
    // authenticates nothing; Main supplies independently verified Source DATA.
    const copy=(value,depth=0)=>{
     assert.ok(depth<=4,'Unsupported ACL metadata nesting');
     if(value===null||typeof value==='string'||typeof value==='boolean')return value;
     assert.ok(value&&typeof value==='object'&&!types.isProxy(value),'Plain ACL metadata required');
     const props=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(props);
     if(Array.isArray(value)){
      assert.equal(Object.getPrototypeOf(value),Array.prototype);
      assert.deepEqual(keys,[...Array.from({length:value.length},(_,i)=>String(i)),'length']);
      return Object.freeze(Array.from({length:value.length},(_,i)=>{
       const property=props[String(i)];assert.ok(Object.hasOwn(property,'value')&&property.enumerable);return copy(property.value,depth+1);}));
     }
     assert.ok([Object.prototype,null].includes(Object.getPrototypeOf(value)));const result=Object.create(null);
     for(const k of keys){assert.equal(typeof k,'string');const property=props[k];assert.ok(Object.hasOwn(property,'value')&&property.enumerable);
      Object.defineProperty(result,k,{value:copy(property.value,depth+1),enumerable:true});}
     return Object.freeze(result);
    };
    const expected=copy(original);assert.ok(Array.isArray(expected));
    const q=name=>'"'+name.replaceAll('"','""')+'"';
    const key=item=>JSON.stringify([item.schema_name,item.object_name]);
    const grantKey=item=>JSON.stringify([item.grantee,item.grantor,item.privilege_type]);
    const compare=(a,b)=>Buffer.compare(Buffer.from(a,'utf8'),Buffer.from(b,'utf8'));
    const fields=(value,keys)=>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));assert.deepEqual(Object.keys(value).sort(),[...keys].sort());};
    const name=value=>{assert.equal(typeof value,'string');assert.ok(value.length>0&&!value.includes('\0'));
     assert.ok(Buffer.byteLength(value,'utf8')<=63);assert.equal(Buffer.from(value,'utf8').toString('utf8'),value);};
    const tablePrivileges=new Set(['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']);
    const sequencePrivileges=new Set(['SELECT','UPDATE','USAGE']);let previous=null;
    for(const item of expected){
     fields(item,['kind','schema_name','object_name','identity','owner_name','column_name','grants']);
     assert.ok(['TABLE','PARTITIONED TABLE','VIEW','MATERIALIZED VIEW','FOREIGN TABLE','SEQUENCE'].includes(item.kind));
     assert.ok(['public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private'].includes(item.schema_name));
     name(item.object_name);name(item.owner_name);assert.notEqual(item.owner_name,'PUBLIC');assert.equal(item.column_name,null);
     assert.equal(item.identity,q(item.schema_name)+'.'+q(item.object_name));assert.ok(Array.isArray(item.grants));
     assert.ok(previous===null||compare(previous,key(item))<0,'Original relation descriptors must be unique/canonical');previous=key(item);
     let priorGrant=null;const allowed=item.kind==='SEQUENCE'?sequencePrivileges:tablePrivileges;
     for(const grant of item.grants){
      fields(grant,['grantee','grantor','privilege_type','is_grantable']);name(grant.grantee);name(grant.grantor);
      assert.notEqual(grant.grantor,'PUBLIC');assert.notEqual(grant.grantee,item.owner_name);
      assert.ok(allowed.has(grant.privilege_type));assert.equal(typeof grant.is_grantable,'boolean');
      assert.ok(priorGrant===null||compare(priorGrant,grantKey(grant))<0,'Original ACL grants must be unique/canonical');priorGrant=grantKey(grant);
     }
    }
    const actor=(await target.query('select current_user::text actor,session_user::text session_actor')).rows;
    assert.equal(actor.length,1);name(actor[0].actor);assert.equal(actor[0].actor,actor[0].session_actor);
    const current=await captureOriginalRelationAcls(target);assert.equal(current.length,expected.length,'Complete original relation set required');
    const metadata=item=>[item.kind,item.schema_name,item.object_name,item.identity,item.owner_name,item.column_name];
    const actions=[];
    // Validate ALL object identities and ALL expected rights before the first
    // revoke. Missing original grantor/option never authorizes a repair grant.
    for(let i=0;i<expected.length;i++){
     const wanted=expected[i],actual=current[i];assert.deepEqual(metadata(actual),metadata(wanted),'Original relation identity/owner changed');
     const wantedGrants=new Map(wanted.grants.map(g=>[grantKey(g),g]));
     const actualGrants=new Map(actual.grants.map(g=>[grantKey(g),g]));
     for(const grant of wanted.grants){const found=actualGrants.get(grantKey(grant));
      assert.ok(found&&(!grant.is_grantable||found.is_grantable),'Original relation privilege/grantor/option missing');}
     for(const grant of actual.grants){const wantedGrant=wantedGrants.get(grantKey(grant));
      if(!wantedGrant||(grant.is_grantable&&!wantedGrant.is_grantable)){
       // No role switching or ambiguous implicit-grantor adoption. Foreign
       // grantors/owners are an unsupported revoke, not permission to retry.
       assert.equal(actual.owner_name,actor[0].actor,'Relation revoke requires the same actual owning session');
       assert.equal(grant.grantor,actor[0].actor,'Foreign relation grantor revoke unsupported');
       actions.push({actual,grant,optionOnly:!!wantedGrant});
      }
     }
    }
    const commands=Object.freeze(actions.map(action=>{
     const {actual,grant,optionOnly}=action;
     const kind=actual.kind==='SEQUENCE'?'SEQUENCE':'TABLE';
     const grantee=grant.grantee==='PUBLIC'?'PUBLIC':q(grant.grantee);
     return 'REVOKE '+(optionOnly?'GRANT OPTION FOR ':'')+grant.privilege_type+' ON '+kind+' '
      +q(actual.schema_name)+'.'+q(actual.object_name)+' FROM '+grantee+' RESTRICT';
    }));
    if(commands.length){
     const live=(await target.query('select current_user::text actor,session_user::text session_actor')).rows;assert.deepEqual(live,actor);
     assert.equal(typeof target.revokeBatch,'function','Guarded relation ACL batch port required');
     const receipt=await target.revokeBatch(commands);
     assert.ok(receipt&&typeof receipt==='object'&&!types.isProxy(receipt),'Closed relation ACL batch receipt required');
     assert.equal(Object.getPrototypeOf(receipt),Object.prototype);
     const properties=Object.getOwnPropertyDescriptors(receipt);
     assert.deepEqual(Reflect.ownKeys(properties),['revocation_count']);
     assert.ok(Object.hasOwn(properties.revocation_count,'value')&&properties.revocation_count.enumerable,'Plain batch count required');
     assert.equal(properties.revocation_count.value,commands.length,'Unconfirmed relation ACL batch count');
    }
    const final=await captureOriginalRelationAcls(target);
    assert.deepEqual((await target.query('select current_user::text actor,session_user::text session_actor')).rows,actor);
    // Fixed property order for metadata equality only; no original DATA row
    // is parsed/coerced/reserialized or used as a target survivor baseline.
    const logical=list=>list.map(item=>[...metadata(item),item.grants.map(g=>[g.grantee,g.grantor,g.privilege_type,g.is_grantable])]);
    assert.deepEqual(logical(final),logical(expected),'Final relation ACLs must equal the authenticated originals');
    return Object.freeze({revoked_privileges:actions.filter(a=>!a.optionOnly).length,revoked_grant_options:actions.filter(a=>a.optionOnly).length});
   }
