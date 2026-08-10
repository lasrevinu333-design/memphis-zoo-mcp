#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const container=String(process.env.SCHEMA_FINGERPRINT_DOCKER_CONTAINER||"").trim();
const database=String(process.env.SCHEMA_FINGERPRINT_DATABASE||"").trim();
const mcpUrl=String(process.env.SCHEMA_FINGERPRINT_MCP_URL||"").trim();
if(!mcpUrl&&(!/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)||!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container)))throw new Error("A disposable mz_schema_rebuild Docker container/database or SCHEMA_FINGERPRINT_MCP_URL is required.");
if(mcpUrl&&!/^https:\/\//i.test(mcpUrl)&&!/^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?\//i.test(mcpUrl))throw new Error("SCHEMA_FINGERPRINT_MCP_URL must use HTTPS or local HTTP.");
const root=resolve(new URL("..",import.meta.url).pathname);
const inputPath=resolve(root,"supabase/canonical/schema-fingerprint-input.json");
const hashPath=resolve(root,"supabase/canonical/schema-fingerprint.txt");
const checkOnly=process.argv.slice(2).includes("--check");

const queries={
  extensions:`select e.extname as extension_name,case when e.extname='pg_net' then 'provider_managed' else e.extversion end as version,n.nspname as schema_name from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by e.extname`,
  types:`select n.nspname as schema_name,t.typname as type_name,t.typtype as type_kind,format_type(t.typbasetype,t.typtypmod) as base_type,t.typnotnull as not_null,pg_get_expr(t.typdefaultbin,0) as default_expression,coalesce((select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid),'[]'::jsonb) as enum_labels from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('e','d') order by t.typname`,
  sequences:`select schemaname as schema_name,sequencename as sequence_name,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size from pg_sequences where schemaname='public' order by sequencename`,
  tables:`select n.nspname as schema_name,c.relname as table_name,c.relkind as relation_kind,c.relrowsecurity as rls_enabled,c.relforcerowsecurity as rls_forced,pg_get_partkeydef(c.oid) as partition_key,obj_description(c.oid,'pg_class') as comment from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by c.relname`,
  columns:`select n.nspname as schema_name,c.relname as table_name,a.attnum as ordinal_position,a.attname as column_name,format_type(a.atttypid,a.atttypmod) as data_type,a.attnotnull as not_null,a.attidentity as identity_kind,a.attgenerated as generated_kind,pg_get_expr(ad.adbin,ad.adrelid) as default_expression,case when a.attcollation<>t.typcollation then coll.collname else null end as collation_name,col_description(c.oid,a.attnum) as comment from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace join pg_type t on t.oid=a.atttypid left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum left join pg_collation coll on coll.oid=a.attcollation where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum`,
  constraints:`select n.nspname as schema_name,c.relname as table_name,con.conname as constraint_name,con.contype as constraint_type,pg_get_constraintdef(con.oid,true) as definition,con.convalidated as validated from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,con.conname`,
  indexes:`select n.nspname as schema_name,c.relname as table_name,i.relname as index_name,pg_get_indexdef(ix.indexrelid) as definition,ix.indisunique as is_unique,ix.indisprimary as is_primary,exists(select 1 from pg_constraint con where con.conindid=ix.indexrelid) as backs_constraint from pg_index ix join pg_class c on c.oid=ix.indrelid join pg_class i on i.oid=ix.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,i.relname`,
  functions:`select n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments,pg_get_functiondef(p.oid) as definition,obj_description(p.oid,'pg_proc') as comment from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.proname,pg_get_function_identity_arguments(p.oid)`,
  views:`select n.nspname as schema_name,c.relname as view_name,c.relkind as relation_kind,pg_get_viewdef(c.oid,true) as definition,obj_description(c.oid,'pg_class') as comment from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m') order by c.relname`,
  triggers:`select n.nspname as schema_name,c.relname as table_name,t.tgname as trigger_name,pg_get_triggerdef(t.oid,true) as definition,t.tgenabled as enabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by c.relname,t.tgname`,
  policies:`select n.nspname as schema_name,c.relname as table_name,p.polname as policy_name,p.polpermissive as permissive,p.polcmd as command_code,coalesce((select jsonb_agg(r.rolname order by r.rolname) from unnest(p.polroles) role_oid join pg_roles r on r.oid=role_oid),'[]'::jsonb) as roles,pg_get_expr(p.polqual,p.polrelid) as using_expression,pg_get_expr(p.polwithcheck,p.polrelid) as check_expression from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,p.polname`,
  table_grants:`select table_schema as schema_name,table_name,grantee,privilege_type,is_grantable from information_schema.role_table_grants where table_schema='public' and grantee in ('PUBLIC','anon','authenticated','service_role') order by table_name,grantee,privilege_type`,
  routine_grants:`select n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments,coalesce(r.rolname,'PUBLIC') as grantee,x.privilege_type,x.is_grantable from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x left join pg_roles r on r.oid=x.grantee where n.nspname='public' and coalesce(r.rolname,'PUBLIC') in ('PUBLIC','anon','authenticated','service_role') order by p.proname,pg_get_function_identity_arguments(p.oid),grantee`,
  cron_jobs:`select jobname,schedule,command,database,case when username in ('postgres','supabase_admin') then 'migration_owner' else username end as username,active from cron.job order by jobname`,
};

function queryDocker(sql){
  const wrapped=`select coalesce(json_agg(row_to_json(q)),'[]'::json)::text from (${sql}) q;`;
  const output=execFileSync("docker",["exec",container,"psql","-v","ON_ERROR_STOP=1","-At","-U","supabase_admin","-d",database,"-c",wrapped],{encoding:"utf8",maxBuffer:64*1024*1024}).trim();
  return JSON.parse(output.split("\n").at(-1)||"[]");
}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}

let mcpClient=null;
async function query(sql,name="schema inventory"){
  if(!mcpUrl)return queryDocker(sql);
  if(!mcpClient){
    mcpClient=new Client({name:"schema-fingerprint-refresh",version:"1.0.0"});
    await mcpClient.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
  }
  const result=await mcpClient.callTool({name:"supabase_sql_read",arguments:{sql,max_rows:250000,max_response_bytes:100000000}});
  if(result.isError)throw new Error(`${name}: ${String(result.content?.[0]?.text||"Live schema inventory query failed.")}`);
  const payload=JSON.parse(String(result.content?.[0]?.text||"{}"));
  if(!payload.ok||payload.response_truncated||payload.row_limit_truncated||!Array.isArray(payload.rows))throw new Error(`Live schema inventory query was incomplete: ${JSON.stringify({ok:payload.ok,response_truncated:payload.response_truncated,row_limit_truncated:payload.row_limit_truncated})}`);
  return payload.rows.map((row)=>{
    if(!Object.hasOwn(row,"object_comment"))return row;
    const normalized={...row,comment:row.object_comment};
    delete normalized.object_comment;
    return normalized;
  });
}

const inventory={};
for(const [name,sql] of Object.entries(queries))inventory[name]=await query(sql,name);
if(mcpClient)await mcpClient.close();
const normalized=stable(inventory);
const compact=JSON.stringify(normalized);
const fingerprint=createHash("sha256").update(compact).digest("hex");
const inputText=`${JSON.stringify(normalized,null,2)}\n`;
const hashText=`${fingerprint}\n`;
if(checkOnly){
  if(readFileSync(inputPath,"utf8")!==inputText)throw new Error("Committed canonical schema-fingerprint-input.json does not equal the clean rebuild inventory.");
  if(readFileSync(hashPath,"utf8")!==hashText)throw new Error("Committed canonical schema-fingerprint.txt does not equal the clean rebuild inventory.");
}else{
  writeFileSync(inputPath,inputText);
  writeFileSync(hashPath,hashText);
}
console.log(JSON.stringify({ok:true,checked:checkOnly,schema_fingerprint:fingerprint,counts:Object.fromEntries(Object.entries(inventory).map(([name,rows])=>[name,rows.length]))},null,2));
