#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import express from "express";
import { createMessagingRouter } from "../src/messaging-api.js";

const execFileAsync = promisify(execFile);
const container = String(process.env.NAMED_MANAGER_ADMIN_ROUTE_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.NAMED_MANAGER_ADMIN_ROUTE_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container) || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("A disposable schema-rebuild database is required.");
}

const SECURITY_MANAGER = "00000000-0000-4000-8000-00000000e601";
const NORMAL_MANAGER = "00000000-0000-4000-8000-00000000e602";
const SECURITY_THREAD = "00000000-0000-4000-8000-00000000e603";
const NORMAL_THREAD = "00000000-0000-4000-8000-00000000e604";
const SECURITY_OPERATION = "00000000-0000-4000-8000-00000000e605";
const NORMAL_OPERATION = "00000000-0000-4000-8000-00000000e606";

async function sql(statement) {
  const { stdout, stderr } = await execFileAsync("docker", [
    "exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t",
    "-U", "supabase_admin", "-d", database, "-c", statement,
  ], { maxBuffer: 16 * 1024 * 1024 });
  assert.equal(stderr.trim(), "");
  return stdout.trim().split("\n").at(-1);
}

async function queryRows(statement) {
  const wrapped = `select coalesce(json_agg(row_to_json(q)),'[]'::json)::text from (${String(statement).replace(/;\s*$/, "")}) q;`;
  return JSON.parse(await sql(wrapped));
}

await sql(`
  insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal)
  values
    ('${SECURITY_MANAGER}'::uuid,'Route Security Administrator',array['SECURITY_ADMIN']::text[],true,false),
    ('${NORMAL_MANAGER}'::uuid,'Route Ordinary Manager',array['OPS_MANAGER']::text[],true,false)
  on conflict(manager_id) do update set display_name=excluded.display_name,roles=excluded.roles,active=true,revoked_at=null,is_system_principal=false;
  set role service_role;
  select (public.msg_ensure_ops_manager_user('${SECURITY_MANAGER}'::uuid)).id;
  select (public.msg_ensure_ops_manager_user('${NORMAL_MANAGER}'::uuid)).id;
`);

const [securityUser] = await queryRows(`
  select id from public.msg_users where ops_manager_id='${SECURITY_MANAGER}'::uuid
`);
const [normalUser] = await queryRows(`
  select id from public.msg_users where ops_manager_id='${NORMAL_MANAGER}'::uuid
`);
assert.ok(securityUser?.id && normalUser?.id, "named-manager provisioning did not produce Messenger principals");
assert.equal(await sql(`select role from public.msg_users where id='${securityUser.id}'::uuid;`), "manager",
  "a named SECURITY_ADMIN must keep the ordinary named-manager Messenger role");

await sql(`
  insert into public.msg_threads(id,thread_type,title,created_by_user_id,is_active)
  values
    ('${SECURITY_THREAD}'::uuid,'group','Security admin route tombstone','${securityUser.id}'::uuid,true),
    ('${NORMAL_THREAD}'::uuid,'group','Ordinary manager route rejection','${normalUser.id}'::uuid,true)
  on conflict(id) do update set is_active=true;
  insert into public.msg_thread_participants(thread_id,user_id)
  values
    ('${SECURITY_THREAD}'::uuid,'${securityUser.id}'::uuid),
    ('${NORMAL_THREAD}'::uuid,'${normalUser.id}'::uuid)
  on conflict(thread_id,user_id) do update set left_at=null;
`);

async function runRpc(name, args) {
  if (name === "msg_ensure_ops_manager_user") {
    return JSON.parse(await sql(`set role service_role; select row_to_json(x)::text from public.msg_ensure_ops_manager_user('${args.p_manager_id}'::uuid) x;`));
  }
  if (name === "msg_admin_tombstone_thread") {
    return JSON.parse(await sql(`set role service_role; select public.msg_admin_tombstone_thread('${args.p_thread_id}'::uuid,'${args.p_request_user_id}'::uuid,'${args.p_operation_id}'::uuid)::text;`));
  }
  throw new Error(`Unexpected route RPC: ${name}`);
}

function boundary(req, _res, next) {
  const token = String(req.header("authorization") || "");
  if (token === "Bearer security") {
    req.memphisAuth = { manager_id: SECURITY_MANAGER, manager_display_name: "Route Security Administrator", device_id: "route-security-session", roles: ["SECURITY_ADMIN"], read_only: false };
  } else if (token === "Bearer ordinary") {
    // The forged session claim deliberately says SECURITY_ADMIN. The database
    // must still reject this named manager because its authoritative role is
    // OPS_MANAGER.
    req.memphisAuth = { manager_id: NORMAL_MANAGER, manager_display_name: "Route Ordinary Manager", device_id: "route-ordinary-session", roles: ["SECURITY_ADMIN"], read_only: false };
  }
  next();
}

const app = express();
app.use(express.json());
app.use("/messaging-api", createMessagingRouter({
  runReadOnlySql: queryRows,
  runRpc,
  buildHealthPayload: () => ({ ok: true }),
  requireDeviceAccess: boundary,
  requireOpsManagerAuth: boundary,
  registerOperationalJobHandler: () => {},
  appVersion: "test",
  releaseId: "test",
  contractVersion: "messaging.v4",
}));
const server = createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}/messaging-api`;

async function tombstone(threadId, operationId, authorization) {
  const response = await fetch(`${origin}/thread/${threadId}/admin-tombstone`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authorization },
    body: JSON.stringify({ operation_id: operationId }),
  });
  return { status: response.status, body: await response.json() };
}

try {
  const security = await tombstone(SECURITY_THREAD, SECURITY_OPERATION, "Bearer security");
  assert.equal(security.status, 200, `named SECURITY_ADMIN route tombstone failed: ${JSON.stringify(security.body)}`);
  assert.equal(security.body.data.deletion_scope, "global");
  assert.equal(await sql(`select is_active::text from public.msg_threads where id='${SECURITY_THREAD}'::uuid;`), "false");

  const normal = await tombstone(NORMAL_THREAD, NORMAL_OPERATION, "Bearer ordinary");
  assert.equal(normal.status, 400, "ordinary named manager bypassed database SECURITY_ADMIN authority");
  assert.match(normal.body.error, /active named SECURITY_ADMIN Messenger principal is required/i);
  assert.equal(await sql(`select is_active::text from public.msg_threads where id='${NORMAL_THREAD}'::uuid;`), "true");
  assert.equal(await sql(`select count(*)::text from public.msg_thread_deletion_operations where operation_id='${NORMAL_OPERATION}'::uuid;`), "0");
  console.log("NAMED_MANAGER_MESSENGER_ADMIN_ROUTE_DATABASE_PASS");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
