#!/usr/bin/env node
import {resolveReleaseSchemaTarget} from './production-target-schema-profile.mjs';

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, lstatSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SCHEMA_CATALOG_QUERIES, captureSchemaCatalog, fingerprintSchemaCatalog } from "./schema-fingerprint-catalog.mjs";

const container=String(process.env.SCHEMA_FINGERPRINT_DOCKER_CONTAINER||"").trim();
const database=String(process.env.SCHEMA_FINGERPRINT_DATABASE||"").trim();
const mcpUrl=String(process.env.SCHEMA_FINGERPRINT_MCP_URL||"").trim();
const freshCustodyDirectory=String(process.env.SCHEMA_FINGERPRINT_FRESH_CUSTODY||"").trim();
let disposableContainer=/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container);
if(freshCustodyDirectory){
  if(mcpUrl||database!=="postgres"||!/^[a-f0-9]{64}$/.test(container)||!isAbsolute(freshCustodyDirectory))throw new Error("Fresh fingerprint capture requires the exact owned CID and postgres database.");
  const directory=lstatSync(freshCustodyDirectory);
  if(!directory.isDirectory()||directory.uid!==process.getuid()||(directory.mode&0o777)!==0o700)throw new Error("Fresh fingerprint custody directory is not private and owned.");
  function custodyText(name,receipt=true){
    const path=resolve(freshCustodyDirectory,name),file=lstatSync(path);
    if(!file.isFile()||file.uid!==directory.uid||(receipt&&(file.mode&0o777)!==0o600)||file.nlink!==1)throw new Error("Fresh fingerprint custody file is not private and owned.");
    return readFileSync(path,"utf8");
  }
  const birth=JSON.parse(custodyText("PREBIRTH_ORIGINAL_CONTAINER.json"));
  const bound=JSON.parse(custodyText("RETURNED_ORIGINAL_CID.json"));
  const image=JSON.parse(custodyText("BOUND_ORIGINAL_IMAGE_ID.json"));
  const manifest=JSON.parse(readFileSync(resolve(new URL("..",import.meta.url).pathname,"release/fresh-only-replay/MANIFEST.json"),"utf8"));
  if(birth.schema!=="custodial.ci-fresh-original-container-custody.v1"||birth.directory!==freshCustodyDirectory
    ||!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(birth.name)||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(birth.owner)
    ||birth.cidfile!==resolve(freshCustodyDirectory,"original-container.cid")||custodyText("original-container.cid",false).trim()!==container
    ||birth.image!==manifest.image||!/^public\.ecr\.aws\/supabase\/postgres@sha256:[a-f0-9]{64}$/.test(birth.image)
    ||bound.id!==container||bound.name!==birth.name||bound.owner!==birth.owner||bound.image!==birth.image
    ||image.image!==birth.image||image.image_id!==bound.image_id||!/^sha256:[a-f0-9]{64}$/.test(bound.image_id))throw new Error("Fresh fingerprint original custody receipts disagree.");
  const observed=JSON.parse(execFileSync("docker",["inspect","--format","{{json .}}",container],{encoding:"utf8"}));
  if(observed.Id!==container||observed.Name!=="/"+birth.name||observed.Config?.Labels?.["custodial.owner"]!==birth.owner
    ||observed.Config?.Image!==birth.image||observed.Image!==bound.image_id)throw new Error("Fresh fingerprint original container ownership/image mismatch.");
  disposableContainer=true;
}
if(!mcpUrl&&(!/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)||!disposableContainer))throw new Error("A disposable mz_schema_rebuild Docker container/database or SCHEMA_FINGERPRINT_MCP_URL is required.");
if(mcpUrl&&!/^https:\/\//i.test(mcpUrl)&&!/^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?\//i.test(mcpUrl))throw new Error("SCHEMA_FINGERPRINT_MCP_URL must use HTTPS or local HTTP.");
const root=resolve(new URL("..",import.meta.url).pathname);
const inputPath=resolve(root,"supabase/canonical/schema-fingerprint-input.json");
const hashPath=resolve(root,"supabase/canonical/schema-fingerprint.txt");
const args=process.argv.slice(2);
const checkOnly=args.length===1&&args[0]==="--check";
const preflightOnly=args.length===1&&args[0]==="--preflight";
const observedProductionPreflightOnly=args.length===1&&args[0]==="--observed-production-preflight";
const targetPreflightOnly=args.length===1&&args[0]==="--target-preflight";
if(args.length>0&&!checkOnly&&!preflightOnly&&!observedProductionPreflightOnly&&!targetPreflightOnly)throw new Error("Usage: refresh-schema-fingerprint.mjs [--check|--preflight|--observed-production-preflight|--target-preflight]");
const queryNames=new Map(Object.entries(SCHEMA_CATALOG_QUERIES).map(([name,sql])=>[sql,name]));

function queryDocker(sql,name){
  const wrapped=`select coalesce(json_agg(row_to_json(q)),'[]'::json)::text from (${sql}) q;`;
  const output=execFileSync("docker",["exec",container,"psql","-v","ON_ERROR_STOP=1","-At","-U","supabase_admin","-d",database,"-c",wrapped],{encoding:"utf8",maxBuffer:64*1024*1024}).trim();
  const rows=JSON.parse(output.split("\n").at(-1)||"[]");
  if(name==="cron_jobs"&&disposableContainer&&/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(database))return rows.map((row)=>row.database===database?{...row,database:"postgres"}:row);
  return rows;
}

let mcpClient=null;
function normalizeObjectComments(rows){
  return rows.map((row)=>{
    if(!Object.hasOwn(row,"object_comment"))return row;
    const normalized={...row,comment:row.object_comment};
    delete normalized.object_comment;
    return normalized;
  });
}
async function query(sql,name="schema inventory"){
  if(!mcpUrl)return normalizeObjectComments(queryDocker(sql,name));
  if(!mcpClient){
    mcpClient=new Client({name:"schema-fingerprint-refresh",version:"1.0.0"});
    await mcpClient.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
  }
  const result=await mcpClient.callTool({name:"supabase_sql_read",arguments:{sql,max_rows:250000,max_response_bytes:100000000}});
  if(result.isError)throw new Error(`${name}: ${String(result.content?.[0]?.text||"Live schema inventory query failed.")}`);
  const payload=JSON.parse(String(result.content?.[0]?.text||"{}"));
  if(!payload.ok||payload.response_truncated||payload.row_limit_truncated||!Array.isArray(payload.rows))throw new Error(`Live schema inventory query was incomplete: ${JSON.stringify({ok:payload.ok,response_truncated:payload.response_truncated,row_limit_truncated:payload.row_limit_truncated})}`);
  return normalizeObjectComments(payload.rows);
}

const inventory=await captureSchemaCatalog({query:async(sql)=>({rows:await query(sql,queryNames.get(sql)||"schema inventory")})});
if(mcpClient)await mcpClient.close();
const {normalized,fingerprint}=fingerprintSchemaCatalog(inventory);
const inputText=`${JSON.stringify(normalized,null,2)}\n`;
const hashText=`${fingerprint}\n`;
function firstTextDifference(expected,actual){
  const expectedLines=expected.split("\n");
  const actualLines=actual.split("\n");
  const limit=Math.max(expectedLines.length,actualLines.length);
  for(let index=0;index<limit;index+=1){
    if(expectedLines[index]!==actualLines[index])return {
      line:index+1,
      expected:String(expectedLines[index]??"<missing>").slice(0,1000),
      actual:String(actualLines[index]??"<missing>").slice(0,1000),
    };
  }
  return null;
}
if(targetPreflightOnly){
  const releaseState=JSON.parse(readFileSync(resolve(root,"release/production-migration-state.json"),"utf8"));
  const schemaTarget=resolveReleaseSchemaTarget(root);
  const canonicalExpected=readFileSync(hashPath,"utf8").trim();
  assert.equal(canonicalExpected,schemaTarget.canonicalFingerprint);
  const releaseExpected=String(releaseState.target?.canonical_source_schema_fingerprint||"");
  if(!/^[0-9a-f]{64}$/.test(canonicalExpected)||releaseExpected!==schemaTarget.deploymentFingerprint)throw new Error("Release raw target schema fingerprint is invalid or differs from the declared deployment target.");
  if(fingerprint!==schemaTarget.deploymentFingerprint)throw new Error(`Restored post-migration database fingerprint ${fingerprint} differs from declared deployment target ${schemaTarget.deploymentFingerprint}.`);
}else if(observedProductionPreflightOnly){
  const releaseState=JSON.parse(readFileSync(resolve(root,"release/production-migration-state.json"),"utf8"));
  const expected=String(releaseState.observed_production?.catalog_privilege_fingerprint||"");
  if(!/^[0-9a-f]{64}$/.test(expected))throw new Error("Observed production schema fingerprint is invalid.");
  if(fingerprint!==expected)throw new Error(`Restored pre-migration database fingerprint ${fingerprint} differs from admitted production ${expected}.`);
}else if(preflightOnly){
  const releaseInput=JSON.parse(readFileSync(resolve(root,"release/schema-alignment-input.json"),"utf8"));
  const expected=String(releaseInput.schema_from_fingerprint||"");
  if(!/^[0-9a-f]{64}$/.test(expected))throw new Error("Release source schema fingerprint is invalid.");
  if(fingerprint!==expected)throw new Error(`Populated database preflight rejected schema fingerprint ${fingerprint}; expected ${expected}.`);
}else if(checkOnly){
  const committedInput=readFileSync(inputPath,"utf8");
  if(committedInput!==inputText)throw new Error(`Committed canonical schema-fingerprint-input.json does not equal the clean rebuild inventory: ${JSON.stringify(firstTextDifference(committedInput,inputText))}`);
  if(readFileSync(hashPath,"utf8")!==hashText)throw new Error("Committed canonical schema-fingerprint.txt does not equal the clean rebuild inventory.");
}else{
  writeFileSync(inputPath,inputText);
  writeFileSync(hashPath,hashText);
}
console.log(JSON.stringify({ok:true,mode:targetPreflightOnly?"target-preflight":observedProductionPreflightOnly?"observed-production-preflight":preflightOnly?"populated-preflight":checkOnly?"check":"refresh",checked:checkOnly||preflightOnly||observedProductionPreflightOnly||targetPreflightOnly,schema_fingerprint:fingerprint,counts:Object.fromEntries(Object.entries(inventory).map(([name,rows])=>[name,rows.length]))},null,2));
