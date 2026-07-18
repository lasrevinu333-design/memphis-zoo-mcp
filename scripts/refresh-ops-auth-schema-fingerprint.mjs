#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const container=String(process.env.SCHEMA_FINGERPRINT_DOCKER_CONTAINER||"").trim();
const database=String(process.env.SCHEMA_FINGERPRINT_DATABASE||"").trim();
if(!/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)||!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container)){
  throw new Error("A disposable mz_schema_rebuild Docker container and database are required.");
}
const root=resolve(new URL("..",import.meta.url).pathname);
const inputPath=resolve(root,"supabase/canonical/schema-fingerprint-input.json");
const hashPath=resolve(root,"supabase/canonical/schema-fingerprint.txt");
const affectedTables=new Set(["ops_manager_managers","ops_manager_trusted_devices","ops_manager_shared_enrollment_windows","ops_manager_shared_enrollment_rate_limits"]);
const affectedFunctions=new Set(["ops_manager_create_shared_enrollment_window","ops_manager_disable_shared_enrollment_window","ops_manager_consume_shared_enrollment_window"]);

function query(sql){
  const output=execFileSync("docker",["exec",container,"psql","-v","ON_ERROR_STOP=1","-At","-U","supabase_admin","-d",database,"-c",`select coalesce(json_agg(row_to_json(q)),'[]'::json)::text from (${sql}) q;`],{encoding:"utf8",maxBuffer:32*1024*1024}).trim();
  return JSON.parse(output||"[]");
}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));return value;}
function merge(key,rows,predicate,logicalKey,orderedKeys){
  const positions=new Map(orderedKeys.map((row,index)=>[logicalKey(row),index]));
  const replacements=new Map(rows.map((row)=>[logicalKey(row),row]));
  const used=new Set();
  const merged=[];
  for(const row of inventory[key]){
    if(!predicate(row)){
      merged.push(row);
      continue;
    }
    const identity=logicalKey(row);
    if(replacements.has(identity)){
      merged.push(replacements.get(identity));
      used.add(identity);
    }
  }
  const additions=rows.filter((row)=>!used.has(logicalKey(row))).sort((a,b)=>(positions.get(logicalKey(a))??Number.MAX_SAFE_INTEGER)-(positions.get(logicalKey(b))??Number.MAX_SAFE_INTEGER));
  for(const row of additions){
    const position=positions.get(logicalKey(row))??Number.MAX_SAFE_INTEGER;
    const insertionIndex=merged.findIndex((candidate)=>(positions.get(logicalKey(candidate))??Number.MAX_SAFE_INTEGER)>position);
    merged.splice(insertionIndex<0?merged.length:insertionIndex,0,row);
  }
  inventory[key]=merged;
}
const by=(...keys)=>(a,b)=>{for(const key of keys){const compared=String(a[key]??"").localeCompare(String(b[key]??""));if(compared)return compared;}return 0;};

const inventory=process.env.SCHEMA_FINGERPRINT_BASELINE_GIT
  ? JSON.parse(execFileSync("git",["show",`${process.env.SCHEMA_FINGERPRINT_BASELINE_GIT}:supabase/canonical/schema-fingerprint-input.json`],{encoding:"utf8",maxBuffer:32*1024*1024}))
  : JSON.parse(readFileSync(inputPath,"utf8"));
const tableList=[...affectedTables].map((name)=>`'${name}'`).join(",");
const functionList=[...affectedFunctions].map((name)=>`'${name}'`).join(",");
const tableKey=(row)=>`${row.schema_name}.${row.table_name}`;
const columnKey=(row)=>`${tableKey(row)}.${row.ordinal_position}.${row.column_name}`;
const constraintKey=(row)=>`${tableKey(row)}.${row.constraint_name}`;
const indexKey=(row)=>`${tableKey(row)}.${row.index_name}`;
const functionKey=(row)=>`${row.schema_name}.${row.function_name}(${row.identity_arguments})`;
const tableGrantKey=(row)=>`${tableKey(row)}.${row.grantee}.${row.privilege_type}`;
const routineGrantKey=(row)=>`${functionKey(row)}.${row.grantee}.${row.privilege_type}`;
const order={
  tables:query("select n.nspname as schema_name,c.relname as table_name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by c.relname"),
  columns:query("select n.nspname as schema_name,c.relname as table_name,a.attnum as ordinal_position,a.attname as column_name from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum"),
  constraints:query("select n.nspname as schema_name,c.relname as table_name,con.conname as constraint_name from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,con.conname"),
  indexes:query("select n.nspname as schema_name,c.relname as table_name,i.relname as index_name from pg_index ix join pg_class c on c.oid=ix.indrelid join pg_class i on i.oid=ix.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,i.relname"),
  functions:query("select n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.proname,pg_get_function_identity_arguments(p.oid)"),
  table_grants:query("select table_schema as schema_name,table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' order by table_name,grantee,privilege_type"),
  routine_grants:query("select n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments,coalesce(r.rolname,'PUBLIC') as grantee,x.privilege_type from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x left join pg_roles r on r.oid=x.grantee where n.nspname='public' order by p.proname,pg_get_function_identity_arguments(p.oid),grantee"),
};

merge("tables",query(`select n.nspname as schema_name,c.relname as table_name,c.relkind as relation_kind,c.relrowsecurity as rls_enabled,c.relforcerowsecurity as rls_forced,pg_get_partkeydef(c.oid) as partition_key,obj_description(c.oid,'pg_class') as comment from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and c.relname in (${tableList}) order by c.relname`),(row)=>affectedTables.has(row.table_name),tableKey,order.tables);
merge("columns",query(`select n.nspname as schema_name,c.relname as table_name,a.attnum as ordinal_position,a.attname as column_name,format_type(a.atttypid,a.atttypmod) as data_type,a.attnotnull as not_null,a.attidentity as identity_kind,a.attgenerated as generated_kind,pg_get_expr(ad.adbin,ad.adrelid) as default_expression,case when a.attcollation<>t.typcollation then coll.collname else null end as collation_name,col_description(c.oid,a.attnum) as comment from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace join pg_type t on t.oid=a.atttypid left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum left join pg_collation coll on coll.oid=a.attcollation where n.nspname='public' and c.relkind in ('r','p') and c.relname in (${tableList}) and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum`),(row)=>affectedTables.has(row.table_name),columnKey,order.columns);
merge("constraints",query(`select n.nspname as schema_name,c.relname as table_name,con.conname as constraint_name,con.contype as constraint_type,pg_get_constraintdef(con.oid,true) as definition,con.convalidated as validated from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${tableList}) order by c.relname,con.conname`),(row)=>affectedTables.has(row.table_name),constraintKey,order.constraints);
merge("indexes",query(`select n.nspname as schema_name,c.relname as table_name,i.relname as index_name,pg_get_indexdef(ix.indexrelid) as definition,ix.indisunique as is_unique,ix.indisprimary as is_primary,exists(select 1 from pg_constraint con where con.conindid=ix.indexrelid) as backs_constraint from pg_index ix join pg_class c on c.oid=ix.indrelid join pg_class i on i.oid=ix.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${tableList}) order by c.relname,i.relname`),(row)=>affectedTables.has(row.table_name),indexKey,order.indexes);
merge("functions",query(`select n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments,pg_get_functiondef(p.oid) as definition,obj_description(p.oid,'pg_proc') as comment from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${functionList}) order by p.proname,pg_get_function_identity_arguments(p.oid)`),(row)=>affectedFunctions.has(row.function_name),functionKey,order.functions);
merge("table_grants",query(`select table_schema as schema_name,table_name,grantee,privilege_type,is_grantable from information_schema.role_table_grants where table_schema='public' and table_name in (${tableList}) order by table_name,grantee,privilege_type`),(row)=>affectedTables.has(row.table_name),tableGrantKey,order.table_grants);
merge("routine_grants",query(`select n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments,coalesce(r.rolname,'PUBLIC') as grantee,x.privilege_type,x.is_grantable from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x left join pg_roles r on r.oid=x.grantee where n.nspname='public' and p.proname in (${functionList}) order by p.proname,pg_get_function_identity_arguments(p.oid),grantee`),(row)=>affectedFunctions.has(row.function_name),routineGrantKey,order.routine_grants);

const json=`${JSON.stringify(stable(inventory),null,2)}\n`;
const hash=createHash("sha256").update(JSON.stringify(stable(inventory))).digest("hex");
writeFileSync(inputPath,json);
writeFileSync(hashPath,`${hash}\n`);
console.log(JSON.stringify({ok:true,schema_fingerprint:hash,tables:inventory.tables.length,functions:inventory.functions.length}));
