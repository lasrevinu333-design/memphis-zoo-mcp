#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installCustodialRecordRoutes } from "../src/custodial-record-operations.mjs";

const index = readFileSync("src/index.js", "utf8");
const identityMigration = readFileSync("supabase/migrations/20260820153000_append_only_cleaning_identity_corrections.sql", "utf8");
const gpsMigration = readFileSync("supabase/migrations/20260820154000_late_gps_is_advisory_only.sql", "utf8");

// Routes now live in the typed installer. Exercise that owning export, while
// retaining the historical immutable-original/effective-correction assertions below.
assert.match(index, /import \{installCustodialRecordRoutes\} from '\.\/custodial-record-operations\.mjs'/);
assert.match(index, /installCustodialRecordRoutes\(app,\{requireOpsManagerAuth,requireOpsManagerWrite,runRpc,[\s\S]*?managerId:offlineAuthorityManagerId,backendSecret:offlineAuthoritySecret/);
const routes=[],calls=[],read=()=>{},write=()=>{};
installCustodialRecordRoutes({get:(path,...handlers)=>routes.push({method:'GET',path,handlers}),post:(path,...handlers)=>routes.push({method:'POST',path,handlers})}, {
  requireOpsManagerAuth:read,requireOpsManagerWrite:write,
  managerId:req=>req.memphisAuth.manager_id,backendSecret:()=>'SYNTHETIC_BACKEND_SECRET',
  runRpc:async(name,args)=>{calls.push({name,args});return {replayed:false};},
});
const correctionRoute=routes.find(row=>row.method==='POST'&&row.path==='/admin-api/custodial/cleaning-sessions/:sessionId/corrections');
const truthRoute=routes.find(row=>row.method==='GET'&&row.path==='/admin-api/custodial/cleaning-sessions/:sessionId/truth');
assert.ok(correctionRoute,'current cleaning correction route must exist');assert.equal(correctionRoute.handlers[0],write);assert.equal(truthRoute.handlers[0],read);
const response=()=>({statusCode:200,set(){return this;},status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}});
const id=n=>`98000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const req={params:{sessionId:id(1)},memphisAuth:{manager_id:id(2),auth_mode:'trusted_device'},headers:{'idempotency-key':id(3)},body:{reason:'Verified synthetic correction',expected_correction_id:null,expected_session_uuid:'exact original / opaque identity',corrected_employee_id:id(4)}};
let res=response();await correctionRoute.handlers.at(-1)(req,res);assert.equal(res.statusCode,201);
assert.equal(calls[0].name,'custodial_named_record_operation_v1');assert.equal(calls[0].args.p_manager_id,id(2));assert.equal(calls[0].args.p_input.operation_id,id(3));assert.equal(calls[0].args.p_input.session_id,id(1));assert.equal(calls[0].args.p_input.expected_session_uuid,req.body.expected_session_uuid);
res=response();await correctionRoute.handlers.at(-1)({...req,body:{...req.body,manager_id:id(9)}},res);assert.equal(res.statusCode,422);assert.equal(calls.length,1,'browser actor cannot reach named RPC');
res=response();await correctionRoute.handlers.at(-1)({...req,headers:{}},res);assert.equal(res.statusCode,422);assert.equal(calls.length,1,'missing original operation cannot reach writer');
res=response();await truthRoute.handlers.at(-1)(req,res);assert.equal(res.statusCode,200);assert.equal(calls.at(-1).args.p_action,'truth');assert.deepEqual(calls.at(-1).args.p_input,{session_id:id(1)});

const correctionFunction = identityMigration.match(/create or replace function public\.custodial_append_session_correction\([\s\S]*?\n\$function\$;/i)?.[0] || "";
assert.ok(correctionFunction);
assert.match(correctionFunction, /custodial_require_backend_execution_secret/);
assert.match(correctionFunction, /is_system_principal = false/);
assert.match(correctionFunction, /insert into public\.custodial_session_corrections/);
assert.doesNotMatch(correctionFunction, /update public\.sessions/i);
assert.match(identityMigration, /Original cleaning identity is immutable/);
assert.match(identityMigration, /Cleaning corrections are append-only/);
assert.match(identityMigration, /original_employee_id[\s\S]*current_employee_id/);
assert.match(identityMigration, /new\.employee_name_snapshot[\s\S]*is distinct from[\s\S]*old\.employee_name_snapshot/);

assert.match(gpsMigration, /v_session_state not in \('active','pending_submit'\)/);
assert.match(gpsMigration, /'evidence_scope','post_session_advisory'/);
assert.match(gpsMigration, /revoke all on function public\.custodial_evaluate_location_proximity_v2_measurement[\s\S]*service_role/);
assert.match(gpsMigration, /create or replace function public\.tool_evaluate_location_proximity_v2/);

console.log("CLEANING_IDENTITY_ROUTE_CONTRACT_PASS");
