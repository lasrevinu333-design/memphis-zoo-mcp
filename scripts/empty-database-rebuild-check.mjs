import { randomUUID } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const adminUrl = process.env.SCHEMA_REBUILD_ADMIN_URL || process.env.DATABASE_URL;
let dockerContainer = process.env.SCHEMA_REBUILD_DOCKER_CONTAINER;
const dockerImage = process.env.SCHEMA_REBUILD_DOCKER_IMAGE;
const keepDatabase = /^(1|true|yes)$/i.test(String(process.env.SCHEMA_REBUILD_KEEP_DATABASE || ""));
let ownsDockerContainer = false;

if (!adminUrl && !dockerContainer && !dockerImage) {
  console.error("Set SCHEMA_REBUILD_ADMIN_URL, SCHEMA_REBUILD_DOCKER_CONTAINER, or SCHEMA_REBUILD_DOCKER_IMAGE for a non-production PostgreSQL target.");
  process.exit(2);
}

if (adminUrl && !/(localhost|127\.0\.0\.1|memphis-rebuild|schema-rebuild|test|ci)/i.test(adminUrl)) {
  console.error("Refusing empty-database rebuild check against a URL that does not look local/test/CI.");
  process.exit(2);
}

const root = resolve(new URL("..", import.meta.url).pathname);
const migrationsDir = resolve(root, "supabase/migrations");
const migrationFiles = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
const databaseName = `mz_schema_rebuild_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function dockerPsql(database, sql) {
  const user = process.env.SCHEMA_REBUILD_DOCKER_USER || "supabase_admin";
  const result = spawnSync(
    "docker",
    ["exec", "-i", dockerContainer, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", user, "-d", database],
    { input: sql, encoding: "utf8", maxBuffer: 1024 * 1024 * 32 },
  );
  if (result.status !== 0) {
    throw new Error(`docker psql failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function dockerPsqlConcurrent(database, sql) {
  const user = process.env.SCHEMA_REBUILD_DOCKER_USER || "supabase_admin";
  return new Promise((resolveResult) => {
    const child = spawn(
      "docker",
      ["exec", "-i", dockerContainer, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", user, "-d", database, "-c", sql],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolveResult({ status, stdout, stderr }));
  });
}

function outputLines(result) {
  return String(result.stdout || "").split("\n").map((line) => line.trim()).filter(Boolean);
}

async function verifyDockerConcurrency(database) {
  dockerPsql(database, `
    insert into public.employees(id, employee_code, display_name, active, role)
    values ('00000000-0000-4000-8000-00000000f201', 'CONCURRENT-FINISH', 'Concurrent Finish Test', true, 'staff');
    insert into public.locations(id, location_code, location_name, location_type, form_type, active)
    values ('00000000-0000-4000-8000-00000000f202', 'CONCURRENT_FINISH', 'Concurrent Finish Location', 'restroom', 'restroom', true);
    insert into public.devices(id, device_id, device_name, active, assigned_employee_id)
    values ('00000000-0000-4000-8000-00000000f203', 'CONCURRENT-FINISH-DEVICE', 'Concurrent Finish Device', true, '00000000-0000-4000-8000-00000000f201');
    select public.tool_start_session_v2(
      'CONCURRENT_FINISH', 'CONCURRENT-FINISH-DEVICE',
      '00000000-0000-4000-8000-00000000f204', now() - interval '5 minutes',
      'rebuild-concurrency-start'
    );
  `);
  const finishSql = `
    select public.tool_finish_session_exact(
      '00000000-0000-4000-8000-00000000f204',
      'CONCURRENT-FINISH-DEVICE',
      '00000000-0000-4000-8000-00000000f205',
      now()
    ) ->> 'session_uuid';
  `;
  const finishes = await Promise.all(Array.from({ length: 10 }, () => dockerPsqlConcurrent(database, finishSql)));
  if (finishes.some((result) => result.status !== 0)) {
    throw new Error(`Concurrent exact finishes failed:\n${finishes.map((item) => item.stderr).filter(Boolean).join("\n")}`);
  }
  const sessionIds = finishes.flatMap(outputLines);
  if (sessionIds.length !== 10 || new Set(sessionIds).size !== 1) {
    throw new Error(`Concurrent exact finishes did not converge on one session: ${JSON.stringify(sessionIds)}`);
  }
  const finishState = dockerPsql(database, `
    select count(*)::text || '|' || count(distinct finish_operation_id)::text || '|' || min(status)
    from public.sessions
    where client_session_id = '00000000-0000-4000-8000-00000000f204';
  `).trim();
  if (finishState !== "1|1|pending_submit") throw new Error(`Concurrent exact finish invariant failed: ${finishState}`);

  dockerPsql(database, `
    insert into public.operational_notification_jobs(job_key, job_type, source_id, payload_json)
    select 'rebuild-concurrency-job:' || value, 'rebuild_test', gen_random_uuid(), jsonb_build_object('ordinal', value)
    from generate_series(1, 20) value;
  `);
  const claimSql = (worker) => `select job_id from public.claim_operational_notification_jobs('${worker}', 10, 90);`;
  const claims = await Promise.all([
    dockerPsqlConcurrent(database, claimSql("rebuild-worker-a")),
    dockerPsqlConcurrent(database, claimSql("rebuild-worker-b")),
  ]);
  if (claims.some((result) => result.status !== 0)) {
    throw new Error(`Concurrent notification claims failed:\n${claims.map((item) => item.stderr).filter(Boolean).join("\n")}`);
  }
  const claimSets = claims.map(outputLines);
  const claimedIds = claimSets.flat();
  if (claimSets.some((ids) => ids.length !== 10) || claimedIds.length !== 20 || new Set(claimedIds).size !== 20) {
    throw new Error(`Concurrent notification workers overlapped or lost work: ${JSON.stringify(claimSets)}`);
  }
  dockerPsql(database, `
    insert into public.operational_notification_jobs(job_key, job_type, source_id, payload_json)
    values ('rebuild-memphis-restart', 'memphis_bot_reply', gen_random_uuid(), '{"test":true}'::jsonb);
  `);
  const firstLease = JSON.parse(dockerPsql(database, `
    select row_to_json(j)::text
    from public.claim_operational_notification_job_by_key('rebuild-memphis-restart','restart-worker-a',15) j;
  `).trim());
  dockerPsql(database, `update public.operational_notification_jobs set leased_until=now()-interval '1 second' where job_key='rebuild-memphis-restart';`);
  const recoveredLease = JSON.parse(dockerPsql(database, `
    select row_to_json(j)::text
    from public.claim_operational_notification_job_by_key('rebuild-memphis-restart','restart-worker-b',15) j;
  `).trim());
  if (firstLease.lease_token === recoveredLease.lease_token || Number(recoveredLease.attempts) !== 2) {
    throw new Error("Expired Memphis job lease was not recovered with a new authoritative token.");
  }
  const staleFinish = spawnSync("docker", ["exec", "-i", dockerContainer, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", process.env.SCHEMA_REBUILD_DOCKER_USER || "supabase_admin", "-d", database, "-c",
    `select public.finish_operational_notification_job('${firstLease.job_id}'::uuid,'${firstLease.lease_token}'::uuid,true,null,30);`], { encoding: "utf8" });
  if (staleFinish.status === 0 || !/lease is no longer authoritative/i.test(staleFinish.stderr)) {
    throw new Error("A stale worker was allowed to finalize a recovered Memphis job lease.");
  }
  dockerPsql(database, `select public.finish_operational_notification_job('${recoveredLease.job_id}'::uuid,'${recoveredLease.lease_token}'::uuid,true,null,30);`);

  dockerPsql(database, `
    insert into public.annie_chat_state(id, history, saved_chats, revision, updated_at)
    values ('default', '[]'::jsonb, '[]'::jsonb, 1, now())
    on conflict (id) do update set history='[]'::jsonb, saved_chats='[]'::jsonb, revision=1, updated_at=now();
  `);
  const saveSql = (value) => `
    select (public.moxie_save_chat_state(1, '[{"role":"user","text":"${value}"}]'::jsonb, '[]'::jsonb)).revision;
  `;
  const saves = await Promise.all([
    dockerPsqlConcurrent(database, saveSql("browser-a")),
    dockerPsqlConcurrent(database, saveSql("browser-b")),
  ]);
  const successfulSaves = saves.filter((result) => result.status === 0);
  const conflictedSaves = saves.filter((result) => result.status !== 0 && /changed in another browser/i.test(result.stderr));
  if (successfulSaves.length !== 1 || conflictedSaves.length !== 1) {
    throw new Error(`Moxie compare-and-swap did not produce one winner and one conflict: ${JSON.stringify(saves)}`);
  }

  dockerPsql(database, `
    select * from public.rotate_moxie_auth_credential(
      'moxie-rebuild-test', 0, repeat('a', 64), repeat('b', 128), 'empty-database-rebuild'
    );
  `);
  const rotateSql = (saltCharacter, hashCharacter) => `
    select password_version from public.rotate_moxie_auth_credential(
      'moxie-rebuild-test', 1, repeat('${saltCharacter}', 64), repeat('${hashCharacter}', 128), 'empty-database-rebuild'
    );
  `;
  const rotations = await Promise.all([
    dockerPsqlConcurrent(database, rotateSql("c", "d")),
    dockerPsqlConcurrent(database, rotateSql("e", "f")),
  ]);
  const successfulRotations = rotations.filter((result) => result.status === 0 && outputLines(result).includes("2"));
  const conflictedRotations = rotations.filter((result) => result.status !== 0 && /changed concurrently/i.test(result.stderr));
  if (successfulRotations.length !== 1 || conflictedRotations.length !== 1) {
    throw new Error(`Moxie credential rotation did not produce one winner and one conflict: ${JSON.stringify(rotations)}`);
  }
  const rotationState = dockerPsql(database, `
    select count(*)::text || '|' || min(password_version)::text || '|' ||
           bool_and(password_salt ~ '^[0-9a-f]{64}$')::text || '|' ||
           bool_and(password_hash ~ '^[0-9a-f]{128}$')::text
    from public.moxie_auth_credentials
    where credential_key = 'moxie-rebuild-test';
  `).trim();
  if (rotationState !== "1|2|true|true") throw new Error(`Moxie credential rotation invariant failed: ${rotationState}`);

  dockerPsql(database, `
    insert into public.ops_manager_managers(manager_id, display_name, roles, active)
    select
      ('00000000-0000-4000-8000-' || lpad((9000 + value)::text, 12, '0'))::uuid,
      'Concurrent Shared Messenger Manager ' || value,
      array['OPS_MANAGER']::text[],
      true
    from generate_series(1, 10) value;
  `);
  const sharedRoomCalls = await Promise.all(Array.from({ length: 10 }, (_, index) => {
    const managerId = `00000000-0000-4000-8000-${String(9001 + index).padStart(12, "0")}`;
    return dockerPsqlConcurrent(database, `select id from public.msg_get_or_create_ops_manager_thread('${managerId}'::uuid);`);
  }));
  if (sharedRoomCalls.some((result) => result.status !== 0)) {
    throw new Error(`Concurrent Ops Manager room reconciliation failed:\n${sharedRoomCalls.map((item) => item.stderr).filter(Boolean).join("\n")}`);
  }
  const sharedRoomIds = sharedRoomCalls.flatMap(outputLines);
  if (sharedRoomIds.length !== 10 || new Set(sharedRoomIds).size !== 1) {
    throw new Error(`Concurrent Ops Managers did not converge on one room: ${JSON.stringify(sharedRoomIds)}`);
  }
  const sharedRoomState = dockerPsql(database, `
    with room as (
      select id from public.msg_threads where system_key = 'ops_manager_shared_chat_v1'
    )
    select
      (select count(*) from room)::text || '|' ||
      (select count(*)
       from public.msg_thread_participants p
       join public.msg_users u on u.id = p.user_id
       where p.thread_id = (select id from room)
         and p.left_at is null
         and u.ops_manager_id is not null)::text;
  `).trim();
  if (sharedRoomState !== "1|10") throw new Error(`Shared Ops Manager room invariant failed: ${sharedRoomState}`);
  const deletionMessageId = dockerPsql(database, `
    select id from public.msg_send_message(
      (select id from public.msg_threads where system_key = 'ops_manager_shared_chat_v1'),
      (select id from public.msg_users where ops_manager_id = '00000000-0000-4000-8000-000000009001'::uuid),
      'Concurrent deletion test', 'text', '{}'::jsonb,
      '00000000-0000-4000-8000-000000009901'
    );
  `).trim();
  const deletionCalls = await Promise.all([
    dockerPsqlConcurrent(database, `select id from public.msg_delete_message('${deletionMessageId}'::uuid, (select id from public.msg_users where ops_manager_id = '00000000-0000-4000-8000-000000009001'::uuid));`),
    dockerPsqlConcurrent(database, `select id from public.msg_delete_message('${deletionMessageId}'::uuid, (select id from public.msg_users where ops_manager_id = '00000000-0000-4000-8000-000000009002'::uuid));`),
  ]);
  if (deletionCalls.some((result) => result.status !== 0)) {
    throw new Error(`Concurrent message deletion failed:\n${deletionCalls.map((item) => item.stderr).filter(Boolean).join("\n")}`);
  }
  const deletionState = dockerPsql(database, `
    select count(*)::text || '|' || bool_and(is_deleted)::text || '|' || min(body) || '|' || bool_and(updated_at >= created_at)::text
    from public.msg_messages where id = '${deletionMessageId}'::uuid;
  `).trim();
  if (deletionState !== "1|true|[deleted]|true") throw new Error(`Concurrent message deletion invariant failed: ${deletionState}`);
  console.log("verified 10-way exact finish, two-worker outbox claims, restart lease recovery, two-browser Moxie CAS, atomic Moxie password rotation, 10-manager shared-room convergence, and concurrent idempotent message deletion");
}

function runDocker(args, options = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16,
    ...options,
  });
  if (result.status !== 0) {
    const detail = [
      result.stderr ? `stderr: ${result.stderr.trim()}` : "",
      result.stdout ? `stdout: ${result.stdout.trim()}` : "",
    ].filter(Boolean).join("\n");
    throw new Error(`docker ${args.join(" ")} failed (${result.status}).${detail ? `\n${detail}` : ""}`);
  }
  return result.stdout;
}

function assertRebuildInvariants(result) {
  const failures = [];
  if (Number(result.members_night_rows) !== 1) failures.push("Members Night restoration row count must equal 1");
  if (Number(result.members_night_history_rows) !== 2) failures.push("Members Night correction/recovery history count must equal 2");
  if (String(result.members_night_status || "") !== "ARCHIVED") failures.push("Members Night must be retained as ARCHIVED history");
  if (result.history_delete_rule !== "r") failures.push("Event history foreign key must use ON DELETE RESTRICT");
  if (result.exact_finish_rpc !== true) failures.push("Exact session finish RPC is missing");
  if (result.manager_messaging_rpc !== true) failures.push("Server-derived manager messaging RPC is missing");
  if (result.manager_shared_messaging_rpc !== true) failures.push("Canonical shared Ops Manager messaging RPC is missing");
  if (result.message_change_cursor !== true) failures.push("Message cross-device change cursor is missing");
  if (result.message_delete_public_execute !== false) failures.push("Message deletion RPC is executable by public/anonymous/authenticated roles");
  if (result.message_audit !== true) failures.push("Immutable message audit table is missing");
  if (result.notification_outbox !== true) failures.push("Operational notification outbox is missing");
  if (result.memphis_outbox_rpc !== true) failures.push("Targeted Memphis outbox claim RPC is missing");
  if (result.feedback_image_backup !== true) failures.push("Legacy feedback image recovery table is missing");
  if (result.moxie_revision !== true) failures.push("Moxie revision/CAS column is missing");
  if (result.moxie_password_rotation !== true) failures.push("Atomic Moxie password rotation RPC is missing");
  if (result.moxie_rotation_public_execute !== false) failures.push("Moxie password rotation RPC is executable by public/anonymous/authenticated roles");
  if (failures.length) throw new Error(`Empty-database invariants failed:\n- ${failures.join("\n- ")}`);
}

const exactFinishFunctionalSql = `
begin;
insert into public.employees(id, employee_code, display_name, active, role)
values ('00000000-0000-4000-8000-00000000f101', 'REBUILD-FINISH', 'Rebuild Finish Test', true, 'staff');
insert into public.locations(id, location_code, location_name, location_type, form_type, active)
values ('00000000-0000-4000-8000-00000000f102', 'REBUILD_FINISH', 'Rebuild Finish Location', 'restroom', 'restroom', true);
insert into public.devices(id, device_id, device_name, active, assigned_employee_id)
values ('00000000-0000-4000-8000-00000000f103', 'REBUILD-FINISH-DEVICE', 'Rebuild Finish Device', true, '00000000-0000-4000-8000-00000000f101');
do $functional_test$
declare
  v_start jsonb;
  v_finish jsonb;
  v_replay jsonb;
  v_session_uuid text;
  v_issue_start jsonb;
  v_issue_session_uuid text;
  v_manager_user public.msg_users%rowtype;
  v_manager_user_b public.msg_users%rowtype;
  v_shared_thread_a public.msg_threads%rowtype;
  v_shared_thread_b public.msg_threads%rowtype;
  v_message public.msg_messages%rowtype;
begin
  v_start := public.tool_start_session_v2(
    'REBUILD_FINISH',
    'REBUILD-FINISH-DEVICE',
    '00000000-0000-4000-8000-00000000f104',
    now() - interval '5 minutes',
    'rebuild-functional-start'
  );
  v_session_uuid := v_start ->> 'session_uuid';
  if v_session_uuid is null or v_start ->> 'status' <> 'active' then
    raise exception 'Exact finish functional start did not create an active session: %', v_start;
  end if;
  v_finish := public.tool_finish_session_exact(
    v_session_uuid,
    'REBUILD-FINISH-DEVICE',
    '00000000-0000-4000-8000-00000000f105',
    now() - interval '1 minute'
  );
  if v_finish ->> 'status' <> 'pending_submit' or (v_finish ->> 'replayed')::boolean is not false then
    raise exception 'First exact finish did not produce one authoritative transition: %', v_finish;
  end if;
  v_replay := public.tool_finish_session_exact(
    v_session_uuid,
    'REBUILD-FINISH-DEVICE',
    '00000000-0000-4000-8000-00000000f105',
    now() - interval '1 minute'
  );
  if v_replay ->> 'status' <> 'pending_submit' or (v_replay ->> 'replayed')::boolean is not true then
    raise exception 'Exact finish replay was not recognized idempotently: %', v_replay;
  end if;
  begin
    perform public.tool_finish_session_exact(
      v_session_uuid,
      'REBUILD-FINISH-DEVICE',
      '00000000-0000-4000-8000-00000000f106',
      now()
    );
    raise exception 'A second finish operation id was incorrectly accepted';
  exception when unique_violation then
    null;
  end;
  if (select count(*) from public.sessions where session_uuid = v_session_uuid) <> 1 then
    raise exception 'Exact finish functional check produced a duplicate session';
  end if;

  perform public.tool_complete_session(
    v_session_uuid,
    '{"services_performed":["trash_removed"],"notes":"Routine cleaning completed without a maintenance issue."}'::jsonb,
    'Rebuild Finish Test',
    'REBUILD-FINISH-DEVICE',
    'rebuild-routine-notes-completion'
  );
  if exists (select 1 from public.maintenance_tickets where session_id = (select id from public.sessions where session_uuid = v_session_uuid)) then
    raise exception 'Routine cleaning notes incorrectly created a maintenance ticket';
  end if;

  v_issue_start := public.tool_start_session_v2(
    'REBUILD_FINISH',
    'REBUILD-FINISH-DEVICE',
    '00000000-0000-4000-8000-00000000f111',
    now() - interval '5 minutes',
    'rebuild-explicit-issue-start'
  );
  v_issue_session_uuid := v_issue_start ->> 'session_uuid';
  perform public.tool_finish_session_exact(
    v_issue_session_uuid,
    'REBUILD-FINISH-DEVICE',
    '00000000-0000-4000-8000-00000000f112',
    now() - interval '1 minute'
  );
  perform public.tool_complete_session(
    v_issue_session_uuid,
    '{"services_performed":["trash_removed"],"notes":"Routine context.","maintenance_issues":[{"label":"Leaking toilet","fixture_identifier":"stall 2"}]}'::jsonb,
    'Rebuild Finish Test',
    'REBUILD-FINISH-DEVICE',
    'rebuild-explicit-issue-completion'
  );
  if (select count(*) from public.maintenance_tickets where session_id = (select id from public.sessions where session_uuid = v_issue_session_uuid)) <> 1 then
    raise exception 'Explicit maintenance issue did not create exactly one ticket';
  end if;

  insert into public.ops_manager_managers(manager_id, display_name, roles, active)
  values ('00000000-0000-4000-8000-00000000f107', 'Rebuild Messaging Manager', array['OPS_MANAGER','CUSTODIAL_MANAGER']::text[], true);
  v_manager_user := public.msg_ensure_ops_manager_user('00000000-0000-4000-8000-00000000f107');
  if v_manager_user.ops_manager_id <> '00000000-0000-4000-8000-00000000f107'::uuid
     or v_manager_user.role <> 'manager' then
    raise exception 'Manager messaging principal was not server-derived correctly: %', row_to_json(v_manager_user);
  end if;
  v_shared_thread_a := public.msg_get_or_create_ops_manager_thread('00000000-0000-4000-8000-00000000f107');
  v_message := public.msg_send_message(
    v_shared_thread_a.id, v_manager_user.id,
    'Shared manager history before second manager joins', 'text', '{}'::jsonb,
    '00000000-0000-4000-8000-00000000f114'
  );
  insert into public.ops_manager_managers(manager_id, display_name, roles, active)
  values ('00000000-0000-4000-8000-00000000f115', 'Rebuild Messaging Manager Two', array['OPS_MANAGER']::text[], true);
  v_manager_user_b := public.msg_ensure_ops_manager_user('00000000-0000-4000-8000-00000000f115');
  v_shared_thread_b := public.msg_get_or_create_ops_manager_thread('00000000-0000-4000-8000-00000000f115');
  if v_shared_thread_a.id <> v_shared_thread_b.id
     or v_shared_thread_a.system_key <> 'ops_manager_shared_chat_v1'
     or (select count(*) from public.msg_thread_participants where thread_id = v_shared_thread_a.id and left_at is null) <> 2 then
    raise exception 'Ops Managers did not reconcile into one canonical shared room';
  end if;
  if not exists (
    select 1 from public.msg_receipts
    where message_id = v_message.id and user_id = v_manager_user_b.id
  ) then
    raise exception 'Late-joining Ops Manager did not receive shared-room history receipt';
  end if;
  insert into public.msg_threads(id, thread_type, title, created_by_user_id, is_active)
  values ('00000000-0000-4000-8000-00000000f108', 'group', 'Rebuild messaging authority', v_manager_user.id, true);
  insert into public.msg_thread_participants(thread_id, user_id)
  values ('00000000-0000-4000-8000-00000000f108', v_manager_user.id);
  v_message := public.msg_send_message(
    '00000000-0000-4000-8000-00000000f108', v_manager_user.id,
    'Manager authority audit test', 'text', '{}'::jsonb,
    '00000000-0000-4000-8000-00000000f109'
  );
  if not exists (
    select 1 from public.msg_message_audit a
    where a.message_id = v_message.id
      and a.sender_user_id = v_manager_user.id
      and a.sender_ops_manager_id = '00000000-0000-4000-8000-00000000f107'::uuid
  ) then
    raise exception 'Immutable manager message audit was not written in the message transaction';
  end if;
  insert into public.msg_users(id, display_name, role, is_active)
  values ('00000000-0000-4000-8000-00000000f116', 'Rebuild Ordinary Employee', 'employee', true);
  begin
    perform public.msg_delete_message(v_message.id, '00000000-0000-4000-8000-00000000f116');
    raise exception 'Ordinary employee deleted another sender''s message';
  exception when insufficient_privilege then
    null;
  end;
  v_message := public.msg_delete_message(v_message.id, v_manager_user_b.id);
  if v_message.is_deleted is not true
     or v_message.body <> '[deleted]'
     or v_message.updated_at is null
     or not (v_message.metadata_json ? 'deleted_by')
     or (select count(*) from public.msg_messages where id = v_message.id) <> 1 then
    raise exception 'Manager message soft-delete did not preserve one authoritative tombstone: %', row_to_json(v_message);
  end if;
  v_message := public.msg_delete_message(v_message.id, v_manager_user_b.id);
  if v_message.is_deleted is not true or (select count(*) from public.msg_messages where id = v_message.id) <> 1 then
    raise exception 'Message soft-delete retry was not idempotent';
  end if;
  v_message := public.msg_send_message(
    '00000000-0000-4000-8000-00000000f108', v_manager_user.id,
    'Durable Memphis job test', 'text', '{"channel":"memphis","device_id":"REBUILD-FINISH-DEVICE"}'::jsonb,
    '00000000-0000-4000-8000-00000000f110'
  );
  if not exists (
    select 1 from public.operational_notification_jobs j
    where j.job_key = 'memphis-reply:' || v_message.id::text
      and j.job_type = 'memphis_bot_reply'
      and j.status = 'pending'
  ) then
    raise exception 'Memphis background work was not committed with the user message';
  end if;
end
$functional_test$;
rollback;
`;

if (dockerImage) {
  dockerContainer = `mz_schema_rebuild_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  ownsDockerContainer = true;
  try {
    runDocker([
      "run",
      "-d",
      "--name",
      dockerContainer,
      "--tmpfs",
      "/var/lib/postgresql/data:rw,size=1g",
      "-e",
      "POSTGRES_PASSWORD=postgres",
      dockerImage,
      "-c",
      "shared_preload_libraries=pg_cron,pg_net,pg_stat_statements",
    ]);
    let ready = false;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const check = spawnSync(
        "docker",
        ["exec", dockerContainer, "psql", "-At", "-U", "supabase_admin", "-d", "postgres", "-c", "select 1"],
        { encoding: "utf8" },
      );
      if (check.status === 0 && check.stdout.trim() === "1") {
        ready = true;
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
    if (!ready) throw new Error(`Disposable rebuild container ${dockerContainer} did not become ready.`);
    let healthy = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const status = spawnSync(
        "docker",
        ["inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{end}}", dockerContainer],
        { encoding: "utf8" },
      ).stdout.trim();
      if (!status || status === "healthy") {
        healthy = true;
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
    if (!healthy) throw new Error(`Disposable rebuild container ${dockerContainer} did not become healthy.`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
  } catch (error) {
    execFileSync("docker", ["rm", "-f", dockerContainer], { stdio: "ignore" });
    throw error;
  }
}

if (dockerContainer) {
  try {
    execFileSync("docker", ["inspect", dockerContainer], { stdio: "ignore" });
    const targetDatabase = ownsDockerContainer ? "postgres" : databaseName;
    if (!ownsDockerContainer) dockerPsql("postgres", `create database ${quoteIdentifier(databaseName)};`);
    for (const file of migrationFiles) {
      const sql = readFileSync(resolve(migrationsDir, file), "utf8");
      dockerPsql(targetDatabase, sql);
      console.log(`applied ${file}`);
    }
    dockerPsql(targetDatabase, exactFinishFunctionalSql);
    console.log("verified exact session finish transition and idempotent replay");
    await verifyDockerConcurrency(targetDatabase);
    const counts = dockerPsql(
      targetDatabase,
      `
      select json_build_object(
        'tables', (select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE'),
        'functions', (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
        'views', (select count(*)::int from information_schema.views where table_schema='public'),
        'members_night_rows', (select count(*)::int from public.events_app_events where id='8204c7d4-b4bd-4417-b43d-b7fe2ced5e16'::uuid and event_scope='ZOO_WIDE' and display_location='Zoo Footprint'),
        'members_night_history_rows', (select count(*)::int from public.events_app_event_history where event_id='8204c7d4-b4bd-4417-b43d-b7fe2ced5e16'::uuid),
        'members_night_status', (select status from public.events_app_events where id='8204c7d4-b4bd-4417-b43d-b7fe2ced5e16'::uuid),
        'history_delete_rule', (select confdeltype::text from pg_constraint where conname='events_app_event_history_event_id_fkey' and conrelid='public.events_app_event_history'::regclass),
        'exact_finish_rpc', to_regprocedure('public.tool_finish_session_exact(text,text,uuid,timestamp with time zone)') is not null,
        'manager_messaging_rpc', to_regprocedure('public.msg_ensure_ops_manager_user(uuid)') is not null,
        'manager_shared_messaging_rpc', to_regprocedure('public.msg_get_or_create_ops_manager_thread(uuid)') is not null,
        'message_change_cursor', exists(select 1 from information_schema.columns where table_schema='public' and table_name='msg_messages' and column_name='updated_at'),
        'message_delete_public_execute', has_function_privilege('public', 'public.msg_delete_message(uuid,uuid)', 'EXECUTE')
          or has_function_privilege('anon', 'public.msg_delete_message(uuid,uuid)', 'EXECUTE')
          or has_function_privilege('authenticated', 'public.msg_delete_message(uuid,uuid)', 'EXECUTE'),
        'message_audit', to_regclass('public.msg_message_audit') is not null,
        'notification_outbox', to_regclass('public.operational_notification_jobs') is not null,
        'memphis_outbox_rpc', to_regprocedure('public.claim_operational_notification_job_by_key(text,text,integer)') is not null,
        'feedback_image_backup', to_regclass('public.system_feedback_legacy_image_backups') is not null,
        'moxie_revision', exists(select 1 from information_schema.columns where table_schema='public' and table_name='annie_chat_state' and column_name='revision'),
        'moxie_password_rotation', to_regprocedure('public.rotate_moxie_auth_credential(text,integer,text,text,text)') is not null,
        'moxie_rotation_public_execute', has_function_privilege('public', 'public.rotate_moxie_auth_credential(text,integer,text,text,text)', 'EXECUTE')
          or has_function_privilege('anon', 'public.rotate_moxie_auth_credential(text,integer,text,text,text)', 'EXECUTE')
          or has_function_privilege('authenticated', 'public.rotate_moxie_auth_credential(text,integer,text,text,text)', 'EXECUTE')
      )::text;
      `,
    ).trim().split("\n").find((line) => line.trim().startsWith("{"));
    const rebuildResult = JSON.parse(counts);
    assertRebuildInvariants(rebuildResult);
    console.log(JSON.stringify({ ok: true, database: targetDatabase, migrations: migrationFiles.length, counts: rebuildResult }, null, 2));
  } finally {
    try {
      if (!ownsDockerContainer && !keepDatabase) {
        dockerPsql(
          "postgres",
          `
          select pg_terminate_backend(pid)
          from pg_stat_activity
          where datname = ${quoteIdentifier(databaseName).replaceAll('"', "'")} and pid <> pg_backend_pid();
          `,
        );
        dockerPsql("postgres", `drop database if exists ${quoteIdentifier(databaseName)};`);
      }
      if (!ownsDockerContainer && keepDatabase) console.log(JSON.stringify({ retained_test_database: databaseName }));
    } catch {
      // Best-effort cleanup for local/CI disposable databases.
    } finally {
      if (ownsDockerContainer && !keepDatabase) {
        execFileSync("docker", ["rm", "-f", dockerContainer], { stdio: "ignore" });
      }
      if (ownsDockerContainer && keepDatabase) console.log(JSON.stringify({ retained_test_container: dockerContainer, retained_test_database: "postgres" }));
    }
  }
  process.exit(0);
}

const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 10000 });
let adminConnected = false;

function databaseUrlFor(dbName) {
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  return String(url);
}

try {
  await admin.connect();
  adminConnected = true;
  await admin.query(`create database ${pg.escapeIdentifier(databaseName)}`);
  const db = new Client({ connectionString: databaseUrlFor(databaseName) });
  await db.connect();
  try {
    await db.query("set statement_timeout = 0");
    for (const file of migrationFiles) {
      const sql = readFileSync(resolve(migrationsDir, file), "utf8");
      await db.query(sql);
      console.log(`applied ${file}`);
    }
    await db.query(exactFinishFunctionalSql);
    console.log("verified exact session finish transition and idempotent replay");
    const counts = await db.query(`
      select
        (select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE') as tables,
        (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') as functions,
        (select count(*)::int from information_schema.views where table_schema='public') as views,
        (select count(*)::int from public.events_app_events where id='8204c7d4-b4bd-4417-b43d-b7fe2ced5e16'::uuid and event_scope='ZOO_WIDE' and display_location='Zoo Footprint') as members_night_rows,
        (select count(*)::int from public.events_app_event_history where event_id='8204c7d4-b4bd-4417-b43d-b7fe2ced5e16'::uuid) as members_night_history_rows,
        (select status from public.events_app_events where id='8204c7d4-b4bd-4417-b43d-b7fe2ced5e16'::uuid) as members_night_status,
        (select confdeltype::text from pg_constraint where conname='events_app_event_history_event_id_fkey' and conrelid='public.events_app_event_history'::regclass) as history_delete_rule,
        to_regprocedure('public.tool_finish_session_exact(text,text,uuid,timestamp with time zone)') is not null as exact_finish_rpc,
        to_regprocedure('public.msg_ensure_ops_manager_user(uuid)') is not null as manager_messaging_rpc,
        to_regprocedure('public.msg_get_or_create_ops_manager_thread(uuid)') is not null as manager_shared_messaging_rpc,
        exists(select 1 from information_schema.columns where table_schema='public' and table_name='msg_messages' and column_name='updated_at') as message_change_cursor,
        has_function_privilege('public', 'public.msg_delete_message(uuid,uuid)', 'EXECUTE')
          or has_function_privilege('anon', 'public.msg_delete_message(uuid,uuid)', 'EXECUTE')
          or has_function_privilege('authenticated', 'public.msg_delete_message(uuid,uuid)', 'EXECUTE') as message_delete_public_execute,
        to_regclass('public.msg_message_audit') is not null as message_audit,
        to_regclass('public.operational_notification_jobs') is not null as notification_outbox,
        to_regprocedure('public.claim_operational_notification_job_by_key(text,text,integer)') is not null as memphis_outbox_rpc,
        to_regclass('public.system_feedback_legacy_image_backups') is not null as feedback_image_backup,
        exists(select 1 from information_schema.columns where table_schema='public' and table_name='annie_chat_state' and column_name='revision') as moxie_revision,
        to_regprocedure('public.rotate_moxie_auth_credential(text,integer,text,text,text)') is not null as moxie_password_rotation,
        has_function_privilege('public', 'public.rotate_moxie_auth_credential(text,integer,text,text,text)', 'EXECUTE')
          or has_function_privilege('anon', 'public.rotate_moxie_auth_credential(text,integer,text,text,text)', 'EXECUTE')
          or has_function_privilege('authenticated', 'public.rotate_moxie_auth_credential(text,integer,text,text,text)', 'EXECUTE') as moxie_rotation_public_execute
    `);
    assertRebuildInvariants(counts.rows[0]);
    console.log(JSON.stringify({ ok: true, database: databaseName, migrations: migrationFiles.length, ...counts.rows[0] }, null, 2));
  } finally {
    await db.end().catch(() => {});
  }
} finally {
  if (adminConnected) {
    await admin.query(
      `
      select pg_terminate_backend(pid)
      from pg_stat_activity
      where datname = $1 and pid <> pg_backend_pid()
      `,
      [databaseName],
    ).catch(() => {});
    await admin.query(`drop database if exists ${pg.escapeIdentifier(databaseName)}`).catch(() => {});
    await admin.end().catch(() => {});
  }
}
