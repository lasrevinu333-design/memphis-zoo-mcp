#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SCHEMA_CATALOG_QUERIES, captureSchemaCatalog, fingerprintSchemaCatalog } from "./schema-fingerprint-catalog.mjs";

const container=String(process.env.SCHEMA_FINGERPRINT_DOCKER_CONTAINER||"").trim();
const database=String(process.env.SCHEMA_FINGERPRINT_DATABASE||"").trim();
const mcpUrl=String(process.env.SCHEMA_FINGERPRINT_MCP_URL||"").trim();
if(!mcpUrl&&(!/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)||!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container)))throw new Error("A disposable mz_schema_rebuild Docker container/database or SCHEMA_FINGERPRINT_MCP_URL is required.");
if(mcpUrl&&!/^https:\/\//i.test(mcpUrl)&&!/^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?\//i.test(mcpUrl))throw new Error("SCHEMA_FINGERPRINT_MCP_URL must use HTTPS or local HTTP.");
const root=resolve(new URL("..",import.meta.url).pathname);
const inputPath=resolve(root,"supabase/canonical/schema-fingerprint-input.json");
const hashPath=resolve(root,"supabase/canonical/schema-fingerprint.txt");
const checkOnly=process.argv.slice(2).includes("--check");
const queryNames=new Map(Object.entries(SCHEMA_CATALOG_QUERIES).map(([name,sql])=>[sql,name]));

function queryDocker(sql,name){
  const wrapped=`select coalesce(json_agg(row_to_json(q)),'[]'::json)::text from (${sql}) q;`;
  const output=execFileSync("docker",["exec",container,"psql","-v","ON_ERROR_STOP=1","-At","-U","supabase_admin","-d",database,"-c",wrapped],{encoding:"utf8",maxBuffer:64*1024*1024}).trim();
  const rows=JSON.parse(output.split("\n").at(-1)||"[]");
  if(name==="cron_jobs"&&/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container)&&/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(database))return rows.map((row)=>row.database===database?{...row,database:"postgres"}:row);
  return rows;
}

let mcpClient=null;
async function query(sql,name="schema inventory"){
  if(!mcpUrl)return queryDocker(sql,name);
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

const inventory=await captureSchemaCatalog({query:async(sql)=>({rows:await query(sql,queryNames.get(sql)||"schema inventory")})});
if(mcpClient)await mcpClient.close();
const {normalized,fingerprint}=fingerprintSchemaCatalog(inventory);
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
