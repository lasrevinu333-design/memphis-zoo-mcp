import { randomUUID, createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, mkdtempSync, rmSync, chmodSync, openSync, closeSync, writeFileSync, fsyncSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadCiFreshOnlyReplay } from "./ci-fresh-only-replay.mjs";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const adminUrl = process.env.SCHEMA_REBUILD_ADMIN_URL || process.env.DATABASE_URL;
let dockerContainer = process.env.SCHEMA_REBUILD_DOCKER_CONTAINER;
const dockerImage = process.env.SCHEMA_REBUILD_DOCKER_IMAGE;
const keepDatabase = /^(1|true|yes)$/i.test(String(process.env.SCHEMA_REBUILD_KEEP_DATABASE || ""));
const useEmptyContainerPostgres = /^(1|true|yes)$/i.test(String(process.env.SCHEMA_REBUILD_USE_EMPTY_CONTAINER_POSTGRES || ""));
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
if (process.env.SCHEMA_REBUILD_FRESH_ONLY !== undefined && process.env.SCHEMA_REBUILD_FRESH_ONLY !== '1')
  throw new Error('SCHEMA_REBUILD_FRESH_ONLY must be the explicit value 1.');
const freshOnly = process.env.SCHEMA_REBUILD_FRESH_ONLY === '1';
if (freshOnly && (!dockerImage || dockerContainer || adminUrl || useEmptyContainerPostgres
  || (process.env.SCHEMA_REBUILD_DOCKER_USER && process.env.SCHEMA_REBUILD_DOCKER_USER !== 'supabase_admin')))
  throw new Error('Fresh-only replay requires its own new pinned-image container, never an existing container/URL or another installer.');
if (process.env.SCHEMA_REBUILD_MIGRATIONS_ONLY !== undefined && process.env.SCHEMA_REBUILD_MIGRATIONS_ONLY !== '1')
  throw new Error('SCHEMA_REBUILD_MIGRATIONS_ONLY must be the explicit value 1.');
const migrationsOnly = process.env.SCHEMA_REBUILD_MIGRATIONS_ONLY === '1';
const fixtureName = process.env.SCHEMA_REBUILD_FIXTURE_NAME || '';
const fixtureSocket = process.env.SCHEMA_REBUILD_FIXTURE_SOCKET_DIRECTORY || '';
if (process.env.SCHEMA_REBUILD_NO_AUTO_TABLE_GRANTS !== undefined && process.env.SCHEMA_REBUILD_NO_AUTO_TABLE_GRANTS !== '1')
  throw new Error('SCHEMA_REBUILD_NO_AUTO_TABLE_GRANTS must be the explicit value 1.');
const noAutoTableGrants = process.env.SCHEMA_REBUILD_NO_AUTO_TABLE_GRANTS === '1';
if (noAutoTableGrants && process.env.VACANCY_REFRESH_CATALOG === '1')
  throw new Error('Noncanonical no-auto construction cannot refresh canonical catalog authority.');
if (noAutoTableGrants && (!migrationsOnly || fixtureSocket || !/^mz_schema_rebuild_roster_[A-Za-z0-9_]+$/.test(fixtureName)))
  throw new Error('No-auto-table-grants construction is the explicit isolated vacate-roster fixture profile only.');
if (migrationsOnly && (!freshOnly || !keepDatabase))
  throw new Error('Migrations-only construction requires explicit fresh-only ownership and retained handoff.');
if ((fixtureName || fixtureSocket) && !migrationsOnly)
  throw new Error('Fixture name/socket inputs require explicit migrations-only construction.');
if (fixtureName && !/^mz_schema_rebuild_[A-Za-z0-9_]{1,100}$/.test(fixtureName))
  throw new Error('Exact disposable fixture name required.');
if (fixtureSocket) {
  const parent = resolve(fixtureSocket, '..'), base = resolve(parent, '..');
  const runtime = '/run/user/' + process.getuid();
  const parentName = parent.slice(base.length + 1);
  const allowed = (base === runtime && /^custodial-s27-[A-Za-z0-9]+$/.test(parentName))
    || (base === '/tmp' && /^custodial-s27-sock-[A-Za-z0-9]+$/.test(parentName));
  const baseStat = lstatSync(base), parentStat = lstatSync(parent), socketStat = lstatSync(fixtureSocket);
  if (!allowed || realpathSync(base) !== base || !baseStat.isDirectory() || baseStat.isSymbolicLink()
    || (base === runtime ? baseStat.uid !== process.getuid() || (baseStat.mode & 0o777) !== 0o700 : baseStat.uid !== 0 || (baseStat.mode & 0o7777) !== 0o1777)
    || fixtureSocket !== resolve(parent, 'socket') || realpathSync(parent) !== parent || realpathSync(fixtureSocket) !== fixtureSocket
    || !parentStat.isDirectory() || parentStat.isSymbolicLink() || parentStat.uid !== process.getuid() || (parentStat.mode & 0o777) !== 0o700
    || !socketStat.isDirectory() || socketStat.isSymbolicLink() || socketStat.uid !== process.getuid() || (socketStat.mode & 0o777) !== 0o777
    || readdirSync(parent).join(',') !== 'socket' || readdirSync(fixtureSocket).length !== 0
    || Buffer.byteLength(fixtureSocket + '/.s.PGSQL.5432') >= 108)
    throw new Error('Host socket requires a short empty owned socket leaf inside its private runtime/tmp parent.');
}
const freshSelection = freshOnly ? loadCiFreshOnlyReplay(root, dockerImage, migrationFiles, { noAutoTableGrants }) : null;
let freshConstructionCompleted = false;
let freshInitDirectory = null;
let freshChecksPassed = false;
let freshCustody = null;
let freshContainerCID = null;
let freshContainerMayExist = false;

function freshCustodyReceipt(name, data) {
  const fd = openSync(resolve(freshCustody.directory, name), 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(data, null, 2) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  const directory = openSync(freshCustody.directory, 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
}
function freshInspect(target) {
  const result = spawnSync('docker', ['inspect', '--format', '{{json .}}', target], { encoding: 'utf8' });
  if (result.status === 0) return JSON.parse(result.stdout);
  const absent = ['Error: No such object: ', 'Error: No such container: ', 'error: no such object: ']
    .some(prefix => result.stderr === prefix + target + '\n');
  if (result.status === 1 && !result.stdout.trim() && absent) return null;
  throw new Error('Fresh container inspect unresolved: ' + target);
}
function freshOwnedIdentity() {
  const fromFile = existsSync(freshCustody.cidfile) ? readFileSync(freshCustody.cidfile, 'utf8').trim() : null;
  if (fromFile && !/^[a-f0-9]{64}$/.test(fromFile)) throw new Error('Invalid original fresh CID file');
  if (freshContainerCID && fromFile && freshContainerCID !== fromFile) throw new Error('Original fresh CID changed');
  const expected = freshContainerCID || fromFile;
  const observed = freshInspect(expected || freshCustody.name);
  if (!observed) {
    if (expected && freshInspect(freshCustody.name)) throw new Error('Fresh name/CID absence disagrees');
    return null;
  }
  if (!/^[a-f0-9]{64}$/.test(observed.Id) || observed.Name !== '/' + freshCustody.name
    || (expected && observed.Id !== expected)
    || observed.Config.Labels?.['custodial.owner'] !== freshCustody.owner
    || observed.Config.Image !== freshCustody.image)
    throw new Error('Fresh container ownership/image mismatch; no cleanup permitted');
  // Docker run retains its original first-pull behavior. Bind the local image only after birth.
  const imageId = runDocker(['image', 'inspect', '--format', '{{.Id}}', freshCustody.image]).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId) || observed.Image !== imageId
    || (freshCustody.image_id && freshCustody.image_id !== imageId))
    throw new Error('Original pinned image ID mismatch; no cleanup permitted');
  if (!freshCustody.image_id) {
    freshCustody.image_id = imageId;
    freshCustodyReceipt('BOUND_ORIGINAL_IMAGE_ID.json', { image: freshCustody.image, image_id: imageId });
  }
  if (!freshContainerCID) {
    freshContainerCID = observed.Id;
    freshCustodyReceipt('BOUND_ORIGINAL_CID.json', { id: freshContainerCID, name: freshCustody.name,
      owner: freshCustody.owner, image: freshCustody.image, image_id: freshCustody.image_id });
  }
  return observed;
}
function cleanupFreshOwnedContainer() {
  if (!freshContainerMayExist) return;
  const observed = freshOwnedIdentity();
  if (observed) {
    execFileSync('docker', ['rm', '-f', observed.Id], { stdio: 'ignore' });
    if (freshInspect(observed.Id) || freshInspect(freshCustody.name))
      throw new Error('Original fresh container removal not confirmed');
  }
  freshCustodyReceipt('EXACT_CONTAINER_ABSENT.json', { id: freshContainerCID,
    name: freshCustody.name, owner: freshCustody.owner, exact_absence: true });
  freshContainerMayExist = false;
}

const retirementCorrectionPath = resolve(migrationsDir, "20260810130000_harden_named_manager_retired_archive_and_concurrency.sql");
const retirementCorrection = readFileSync(retirementCorrectionPath, "utf8");
const retirementCorrectionBody = retirementCorrection
  .replace(/^\s*begin;\s*/i, "")
  .replace(/\s*commit;\s*$/i, "");
const finalCorrectionPath = resolve(migrationsDir, "20260810140000_finalize_named_manager_messenger_retirement_integrity.sql");
const finalCorrection = readFileSync(finalCorrectionPath, "utf8");
const finalCorrectionBody = finalCorrection
  .replace(/^\s*begin;\s*/i, "")
  .replace(/\s*commit;\s*$/i, "");
const requestedDatabaseName = String(process.env.SCHEMA_REBUILD_DATABASE_NAME || "").trim();
if (requestedDatabaseName && !/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(requestedDatabaseName)) {
  throw new Error("SCHEMA_REBUILD_DATABASE_NAME must use the disposable mz_schema_rebuild_* namespace.");
}
const databaseName = requestedDatabaseName || `mz_schema_rebuild_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function dockerPsql(database, sql, atomicMode = null) {
  const user = process.env.SCHEMA_REBUILD_DOCKER_USER || "supabase_admin";
  const result = spawnSync(
    "docker",
    ["exec", "-i", ...(freshOnly ? ["--user", "postgres"] : []), dockerContainer, "psql",
      ...(freshOnly ? ["-X", "-q"] : []), "-v", "ON_ERROR_STOP=1", "-At", "-U", user, "-d", database,
      ...(atomicMode === 'psql-single-transaction' ? ['--single-transaction'] : []),
      ...(atomicMode ? ['-c', "DO $identity$ BEGIN IF session_user<>'supabase_admin' OR current_user<>'supabase_admin' THEN RAISE EXCEPTION 'Original installer session changed'; END IF; END $identity$;", '-f', '-'] : [])],
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

async function verifyNamedManagerRetirementMigrationModes(database) {
  const archiveState = () => dockerPsql(database, `
    select count(*)::text || '|' || bool_and(is_active is false)::text || '|' ||
      bool_and(title='Operations Leadership Chat (Retired)')::text || '|' ||
      (select count(*)::text from public.msg_thread_participants p join public.msg_threads t on t.id=p.thread_id where t.system_key='ops_manager_shared_chat_v1' and p.left_at is null)
    from public.msg_threads where system_key='ops_manager_shared_chat_v1';
  `).trim();
  const canonicalState = archiveState();
  if (canonicalState !== "1|true|true|0") throw new Error(`One-archive precondition failed: ${canonicalState}`);

  const absentOutput = dockerPsql(database, `
    begin;
    alter table public.msg_threads disable trigger trg_msg_reject_retired_ops_manager_shared_thread_mutation;
    alter table public.msg_thread_participants disable trigger trg_msg_reject_retired_ops_manager_shared_participation;
    alter table public.msg_messages disable trigger trg_msg_reject_retired_ops_manager_shared_message_mutation;
    alter table public.msg_message_audit disable trigger trg_msg_reject_retired_ops_manager_shared_audit_guard;
    alter table public.msg_receipts disable trigger trg_msg_reject_retired_ops_manager_shared_receipt_mutation;
    alter table public.msg_message_deletions disable trigger trg_msg_reject_retired_ops_manager_shared_message_delete;
    delete from public.msg_threads where system_key='ops_manager_shared_chat_v1';
    ${retirementCorrectionBody}
    ${finalCorrectionBody}
    do $absent_archive$
    declare v_user uuid;
    begin
      select id into v_user from public.msg_users where is_active is true order by id limit 1;
      begin
        insert into public.msg_threads(thread_type,title,created_by_user_id,is_active,system_key)
        values('group','fabricated retired room',v_user,true,'ops_manager_shared_chat_v1');
        raise exception 'absent archive could be recreated';
      exception when check_violation then null;
      end;
    end
    $absent_archive$;
    select 'ABSENT:' || count(*)::text || ':' ||
      (to_regprocedure('public.msg_get_or_create_ops_manager_thread(uuid)') is null)::text || ':' ||
      (to_regclass('public.msg_canonical_thread_pairs') is not null)::text
    from public.msg_threads where system_key='ops_manager_shared_chat_v1';
    rollback;
  `);
  const absentState = absentOutput.split("\n").find((line) => line.startsWith("ABSENT:"));
  if (absentState !== "ABSENT:0:true:true") throw new Error(`Absent-archive correction failed: ${absentOutput}`);
  if (archiveState() !== canonicalState) throw new Error("Absent-archive test did not roll back to the exact preserved archive state.");

  const duplicatePairInjection = await dockerPsqlConcurrent(database, `
    begin;
    alter table public.msg_threads disable trigger trg_msg_enforce_canonical_active_pair_thread;
    alter table public.msg_thread_participants disable trigger trg_msg_enforce_canonical_active_pair_participants;
    do $duplicate_pair$
    declare
      v_user_a uuid;
      v_user_b uuid;
      v_thread uuid;
    begin
      select p.user_id into v_user_a
      from public.msg_thread_participants p join public.msg_threads t on t.id=p.thread_id
      where t.system_key='ops_manager_shared_chat_v1' order by p.id limit 1;
      select p.user_id into v_user_b
      from public.msg_thread_participants p join public.msg_threads t on t.id=p.thread_id
      where t.system_key='ops_manager_shared_chat_v1' order by p.id offset 1 limit 1;
      for ordinal in 1..2 loop
        insert into public.msg_threads(thread_type,created_by_user_id,is_active)
        values('direct',v_user_a,true) returning id into v_thread;
        insert into public.msg_thread_participants(thread_id,user_id)
        values(v_thread,v_user_a),(v_thread,v_user_b);
      end loop;
    end
    $duplicate_pair$;
    ${retirementCorrectionBody}
    commit;
  `);
  if (duplicatePairInjection.status === 0 || !/duplicate active direct or bot conversations/i.test(duplicatePairInjection.stderr)) {
    throw new Error(`Pre-existing duplicate direct/Memphis pair did not fail closed: ${JSON.stringify(duplicatePairInjection)}`);
  }
  if (archiveState() !== canonicalState) throw new Error("Duplicate-pair rejection leaked a partial archive mutation.");

  const rollbackInjection = await dockerPsqlConcurrent(database, `
    begin;
    alter table public.msg_threads disable trigger trg_msg_reject_retired_ops_manager_shared_thread_mutation;
    alter table public.msg_thread_participants disable trigger trg_msg_reject_retired_ops_manager_shared_participation;
    update public.msg_threads
    set is_active=true,title='Operations Leadership Chat'
    where system_key='ops_manager_shared_chat_v1';
    update public.msg_thread_participants p
    set left_at=null
    from public.msg_threads t
    where t.id=p.thread_id and t.system_key='ops_manager_shared_chat_v1';
    ${retirementCorrectionBody}
    ${finalCorrectionBody}
    select 1/0;
    commit;
  `);
  if (rollbackInjection.status === 0 || !/division by zero/i.test(rollbackInjection.stderr)) {
    throw new Error(`Retirement rollback injection did not fail inside the migration transaction: ${JSON.stringify(rollbackInjection)}`);
  }
  if (archiveState() !== canonicalState) throw new Error("Rollback injection leaked partial retirement normalization or guard DDL.");
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
    insert into public.locations(id, location_code, location_name, location_type, form_type, active)
    values ('00000000-0000-4000-8000-00000000f211', 'GPS_HARDENING', 'GPS Hardening Test', 'restroom', 'restroom', true);
    insert into public.devices(id, device_id, device_name, active)
    values ('00000000-0000-4000-8000-00000000f212', 'GPS-HARDENING-DEVICE', 'GPS Hardening Device', true);
    insert into public.location_proximity_settings(location_id, latitude, longitude, coordinate_source, coordinate_confidence, authority_radius_m, authority_surveyed_at, active)
    values ('00000000-0000-4000-8000-00000000f211', 35.1495, -90.0490, 'empty_database_rebuild', 'surveyed', 175, clock_timestamp(), true);
  `);
  const gpsResults = [];
  const runIsolatedGpsEvaluation = (clientEventId, latitude, observedAtSql) => {
    dockerPsql(database, `
      delete from public.device_location_proximity_status
      where device_id='00000000-0000-4000-8000-00000000f212'::uuid
        and location_id='00000000-0000-4000-8000-00000000f211'::uuid;
    `);
    return dockerPsql(database, `
      select public.tool_evaluate_location_proximity_v2(
        'GPS_HARDENING','GPS-HARDENING-DEVICE',${latitude},-90.0490,8,null,
        '${clientEventId}','${clientEventId}',${observedAtSql}
      )->>'result';
    `).trim();
  };
  gpsResults.push(runIsolatedGpsEvaluation('rebuild-gps-current', 35.1495, 'now()'));
  gpsResults.push(runIsolatedGpsEvaluation('rebuild-gps-stale', 35.1495, "now()-interval '10 minutes'"));
  gpsResults.push(runIsolatedGpsEvaluation('rebuild-gps-future', 35.1495, "now()+interval '10 minutes'"));
  gpsResults.push(runIsolatedGpsEvaluation('rebuild-gps-boundary', 35.15107, 'now()'));
  const gpsState = gpsResults.join('|');
  if (gpsState !== "near|stale|future_clock|boundary_uncertain") {
    throw new Error(`GPS freshness/boundary invariants failed: ${gpsState}`);
  }
  dockerPsql(database, `
    delete from public.device_location_proximity_status
    where device_id='00000000-0000-4000-8000-00000000f212'::uuid
      and location_id='00000000-0000-4000-8000-00000000f211'::uuid;
    select public.tool_evaluate_location_proximity_v2(
      'GPS_HARDENING','GPS-HARDENING-DEVICE',35.1495,-90.0490,8,null,
      'rebuild-gps-future-recovery-bad','rebuild-gps-future-recovery-bad',now()+interval '10 minutes'
    );
    select pg_sleep(0.01);
    select public.tool_evaluate_location_proximity_v2(
      'GPS_HARDENING','GPS-HARDENING-DEVICE',35.1495,-90.0490,8,null,
      'rebuild-gps-future-recovery-good','rebuild-gps-future-recovery-good',now()
    );
  `);
  const futureRecoveryState = dockerPsql(database, `
    select result || '|' || (observed_at <= evaluated_at)::text || '|' || (metadata_json ? 'reported_observed_at')::text
    from public.device_location_proximity_status
    where device_id='00000000-0000-4000-8000-00000000f212'::uuid
      and location_id='00000000-0000-4000-8000-00000000f211'::uuid
      and session_uuid='';
  `).trim();
  if (futureRecoveryState !== "near|true|true") {
    throw new Error(`Future phone clock prevented recovery to a current GPS reading: ${futureRecoveryState}`);
  }
  dockerPsql(database, `
    delete from public.device_location_proximity_status
    where device_id='00000000-0000-4000-8000-00000000f212'::uuid
      and location_id='00000000-0000-4000-8000-00000000f211'::uuid;
    select public.tool_evaluate_location_proximity_v2(
      'GPS_HARDENING','GPS-HARDENING-DEVICE',35.1495,-90.0490,8,null,
      'rebuild-gps-motion-origin','rebuild-gps-motion-origin',now()-interval '10 seconds'
    );
  `);
  const motionResult = dockerPsql(database, `
    select public.tool_evaluate_location_proximity_v2(
      'GPS_HARDENING','GPS-HARDENING-DEVICE',35.1695,-90.0490,8,null,
      'rebuild-gps-motion-jump','rebuild-gps-motion-jump',now()
    )->>'result';
  `).trim();
  if (motionResult !== "implausible_jump") throw new Error(`Implausible GPS motion was accepted: ${motionResult}`);

  dockerPsql(database, `
    delete from public.device_location_proximity_status
    where device_id='00000000-0000-4000-8000-00000000f212'::uuid
      and location_id='00000000-0000-4000-8000-00000000f211'::uuid;
    select public.tool_evaluate_location_proximity_v2(
      'GPS_HARDENING','GPS-HARDENING-DEVICE',35.1495,-90.0490,8,null,
      'rebuild-gps-newest','rebuild-gps-newest',now()
    );
    select public.tool_evaluate_location_proximity_v2(
      'GPS_HARDENING','GPS-HARDENING-DEVICE',35.1695,-90.0490,8,null,
      'rebuild-gps-old-replay','rebuild-gps-old-replay',now()-interval '10 minutes'
    );
  `);
  const replayState = dockerPsql(database, `
    select result || '|' || (observed_at > now()-interval '1 minute')::text
    from public.device_location_proximity_status
    where device_id='00000000-0000-4000-8000-00000000f212'::uuid
      and location_id='00000000-0000-4000-8000-00000000f211'::uuid
      and session_uuid='';
  `).trim();
  if (replayState !== "near|true") throw new Error(`Stale offline GPS replay replaced current status: ${replayState}`);

  const duplicateGpsSql = `
    select public.tool_evaluate_location_proximity_v2(
      'GPS_HARDENING','GPS-HARDENING-DEVICE',35.1495,-90.0490,8,null,
      'rebuild-gps-concurrent-duplicate','rebuild-gps-concurrent-duplicate',now()
    )->>'scan_event_id';
  `;
  const duplicateGpsCalls = await Promise.all(Array.from({ length: 10 }, () => dockerPsqlConcurrent(database, duplicateGpsSql)));
  if (duplicateGpsCalls.some((result) => result.status !== 0)) {
    throw new Error(`Concurrent duplicate GPS events failed:\n${duplicateGpsCalls.map((item) => item.stderr).filter(Boolean).join("\n")}`);
  }
  const duplicateGpsIds = duplicateGpsCalls.flatMap(outputLines);
  if (duplicateGpsIds.length !== 10 || new Set(duplicateGpsIds).size !== 1) {
    throw new Error(`Concurrent duplicate GPS events did not converge: ${JSON.stringify(duplicateGpsIds)}`);
  }
  const duplicateGpsCount = dockerPsql(database, `
    select count(*) from public.scan_events where client_event_id='rebuild-gps-concurrent-duplicate';
  `).trim();
  if (duplicateGpsCount !== "1") throw new Error(`Concurrent GPS event produced ${duplicateGpsCount} rows instead of one.`);

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
      'Concurrent Named Messenger Manager ' || value,
      array['OPS_MANAGER']::text[],
      true
    from generate_series(1, 10) value;
  `);
  const namedIdentityCalls = await Promise.all(Array.from({ length: 10 }, (_, index) => {
    const managerId = `00000000-0000-4000-8000-${String(9001 + index).padStart(12, "0")}`;
    return dockerPsqlConcurrent(database, `select id from public.msg_ensure_ops_manager_user('${managerId}'::uuid);`);
  }));
  if (namedIdentityCalls.some((result) => result.status !== 0)) {
    throw new Error(`Concurrent named-manager identity reconciliation failed:\n${namedIdentityCalls.map((item) => item.stderr).filter(Boolean).join("\n")}`);
  }
  const namedIdentityIds = namedIdentityCalls.flatMap(outputLines);
  if (namedIdentityIds.length !== 10 || new Set(namedIdentityIds).size !== 10) {
    throw new Error(`Concurrent named managers did not retain distinct principals: ${JSON.stringify(namedIdentityIds)}`);
  }
  const repeatedIdentityCalls = await Promise.all(Array.from({ length: 10 }, (_, index) => {
    const managerId = `00000000-0000-4000-8000-${String(9001 + index).padStart(12, "0")}`;
    return dockerPsqlConcurrent(database, `select id from public.msg_ensure_ops_manager_user('${managerId}'::uuid);`);
  }));
  if (repeatedIdentityCalls.some((result) => result.status !== 0)) {
    throw new Error(`Repeated named-manager identity reconciliation failed:\n${repeatedIdentityCalls.map((item) => item.stderr).filter(Boolean).join("\n")}`);
  }
  const repeatedIdentityIds = repeatedIdentityCalls.flatMap(outputLines);
  if (repeatedIdentityIds.length !== 10 || repeatedIdentityIds.some((id, index) => id !== namedIdentityIds[index])) {
    throw new Error(`Named manager principal was not stable across sessions: ${JSON.stringify({ namedIdentityIds, repeatedIdentityIds })}`);
  }
  const retiredRoomState = dockerPsql(database, `
    with room as (
      select id, is_active from public.msg_threads where system_key = 'ops_manager_shared_chat_v1'
    ), concurrent_managers as (
      select ('00000000-0000-4000-8000-' || lpad((9000 + value)::text, 12, '0'))::uuid as manager_id
      from generate_series(1, 10) value
    )
    select
      (select count(*) from room)::text || '|' ||
      (select bool_and(is_active is false)::text from room) || '|' ||
      (select count(*)
       from public.msg_thread_participants p
       where p.thread_id = (select id from room)
         and p.left_at is null)::text || '|' ||
      (select count(*)
       from public.msg_users u
       where u.is_active is true
         and u.role='manager'
         and u.ops_manager_id in (select manager_id from concurrent_managers))::text;
  `).trim();
  if (retiredRoomState !== "1|true|0|10") throw new Error(`Named manager/archive invariant failed: ${retiredRoomState}`);
  const retiredRpcCount = dockerPsql(database, `
    select count(*) from pg_proc
    where pronamespace='public'::regnamespace
      and proname='msg_get_or_create_ops_manager_thread'
      and pg_get_function_identity_arguments(oid)='p_manager_id uuid';
  `).trim();
  if (retiredRpcCount !== "0") throw new Error("Retired Ops Manager shared-room RPC remains available.");
  const archivedThreadId = dockerPsql(database, `
    select id from public.msg_threads where system_key='ops_manager_shared_chat_v1';
  `).trim();
  const reactivateArchivedRoom = await dockerPsqlConcurrent(database, `
    update public.msg_threads set is_active=true where id='${archivedThreadId}'::uuid;
  `);
  if (reactivateArchivedRoom.status === 0 || !/immutable/i.test(reactivateArchivedRoom.stderr)) {
    throw new Error(`Archived Ops Manager room reactivation did not fail closed: ${reactivateArchivedRoom.stderr}`);
  }
  const recreateArchivedRoom = await dockerPsqlConcurrent(database, `
    insert into public.msg_threads(thread_type,title,created_by_user_id,is_active,system_key)
    values ('group','Illegal Operations Leadership recreation','${namedIdentityIds[0]}'::uuid,true,'ops_manager_shared_chat_v1');
  `);
  if (recreateArchivedRoom.status === 0 || !/cannot be recreated/i.test(recreateArchivedRoom.stderr)) {
    throw new Error(`Archived Ops Manager room recreation did not fail closed: ${recreateArchivedRoom.stderr}`);
  }
  const addArchivedParticipant = await dockerPsqlConcurrent(database, `
    insert into public.msg_thread_participants(thread_id,user_id,left_at)
    values ('${archivedThreadId}'::uuid,'${namedIdentityIds[0]}'::uuid,null);
  `);
  if (addArchivedParticipant.status === 0 || !/participant history is immutable/i.test(addArchivedParticipant.stderr)) {
    throw new Error(`Archived Ops Manager participant insertion did not fail closed: ${addArchivedParticipant.stderr}`);
  }
  const restoreArchivedParticipant = await dockerPsqlConcurrent(database, `
    update public.msg_thread_participants set left_at=null
    where id=(select id from public.msg_thread_participants where thread_id='${archivedThreadId}'::uuid order by id limit 1);
  `);
  if (restoreArchivedParticipant.status === 0 || !/participant history is immutable/i.test(restoreArchivedParticipant.stderr)) {
    throw new Error(`Archived Ops Manager participant restoration did not fail closed: ${restoreArchivedParticipant.stderr}`);
  }
  const teamRoomCall = await dockerPsqlConcurrent(database, `select id from public.msg_get_or_create_custodial_team_thread((select id from public.msg_users where ops_manager_id='00000000-0000-4000-8000-000000009001'::uuid));`);
  if (teamRoomCall.status === 0 || !/retired/i.test(teamRoomCall.stderr)) {
    throw new Error(`Retired Custodial Team room entry point did not fail closed: ${teamRoomCall.stderr}`);
  }
  dockerPsql(database, `
    insert into public.employees(id,employee_code,display_name,active,role)
    values
      ('00000000-0000-4000-8000-000000009101','EMP99101','Rebuild Group One',true,'staff'),
      ('00000000-0000-4000-8000-000000009102','EMP99102','Rebuild Group Two',true,'staff'),
      ('00000000-0000-4000-8000-000000009103','EMP99103','Rebuild Group Three',true,'staff');
    insert into public.msg_users(id,employee_id,display_name,role,is_active)
    values
      ('00000000-0000-4000-8000-000000009111','00000000-0000-4000-8000-000000009101','Rebuild Group One','employee',true),
      ('00000000-0000-4000-8000-000000009112','00000000-0000-4000-8000-000000009102','Rebuild Group Two','employee',true),
      ('00000000-0000-4000-8000-000000009113','00000000-0000-4000-8000-000000009103','Rebuild Group Three','employee',true);
    insert into public.msg_device_assignments(device_identifier,msg_user_id,is_active)
    values
      ('REBUILD-GROUP-DEVICE-1','00000000-0000-4000-8000-000000009111',true),
      ('REBUILD-GROUP-DEVICE-2','00000000-0000-4000-8000-000000009112',true),
      ('REBUILD-GROUP-DEVICE-3','00000000-0000-4000-8000-000000009113',true);
  `);

  // Every caller waits on one database-clock barrier, then resolves the same
  // principal pair together. This makes the ten-way race reproducible instead
  // of relying on scheduler luck; the replay must return the original id too.
  const barrierSql = (expression, barrierAt) => `
    select pg_sleep(greatest(0, extract(epoch from ('${barrierAt}'::timestamptz - clock_timestamp()))));
    select (${expression}).id;
  `;
  const assertTenWayStable = async (label, expression) => {
    const run = async () => {
      const barrierAt = new Date(Date.now() + 1500).toISOString();
      const calls = await Promise.all(Array.from(
        { length: 10 },
        () => dockerPsqlConcurrent(database, barrierSql(expression, barrierAt)),
      ));
      if (calls.some((result) => result.status !== 0)) {
        throw new Error(`${label} ten-way barrier calls failed:\n${calls.map((item) => item.stderr).filter(Boolean).join("\n")}`);
      }
      const ids = calls.flatMap(outputLines);
      if (ids.length !== 10 || new Set(ids).size !== 1) {
        throw new Error(`${label} ten-way barrier calls did not converge: ${JSON.stringify(ids)}`);
      }
      return ids[0];
    };
    const first = await run();
    const replay = await run();
    if (first !== replay) throw new Error(`${label} replay changed the canonical thread id: ${JSON.stringify({ first, replay })}`);
    return first;
  };
  const directThreadId = await assertTenWayStable(
    "direct get-or-create",
    "public.msg_get_or_create_direct_thread('00000000-0000-4000-8000-000000009111'::uuid,'00000000-0000-4000-8000-000000009112'::uuid)",
  );
  if (dockerPsql(database, `select count(*) from public.msg_canonical_thread_pairs where thread_id='${directThreadId}'::uuid;`).trim() !== "1") {
    throw new Error("Direct get-or-create did not record exactly one canonical pair authority row.");
  }
  dockerPsql(database, `
    insert into public.msg_users(id,display_name,role,is_active)
    values ('00000000-0000-4000-8000-000000009119','Memphis','bot',true)
    on conflict (id) do update set display_name='Memphis',role='bot',is_active=true;
  `);
  const memphisThreadId = await assertTenWayStable(
    "Memphis get-or-create",
    "public.msg_get_or_create_memphis_thread('00000000-0000-4000-8000-000000009113'::uuid)",
  );
  if (dockerPsql(database, `select count(*) from public.msg_canonical_thread_pairs where thread_id='${memphisThreadId}'::uuid and conversation_type='bot';`).trim() !== "1") {
    throw new Error("Memphis get-or-create did not record exactly one canonical pair authority row.");
  }
  const groupOperationCalls = await Promise.all([
    dockerPsqlConcurrent(database, `select id from public.msg_create_group_thread_v2(
      '00000000-0000-4000-8000-000000009111'::uuid,
      'Concurrent Employee Group',
      array[
        '00000000-0000-4000-8000-000000009112'::uuid,
        '00000000-0000-4000-8000-000000009113'::uuid
      ],
      'thread:concurrent-empty-db-group'
    );`),
    dockerPsqlConcurrent(database, `select id from public.msg_create_group_thread_v2(
      '00000000-0000-4000-8000-000000009111'::uuid,
      'Concurrent Employee Group',
      array[
        '00000000-0000-4000-8000-000000009112'::uuid,
        '00000000-0000-4000-8000-000000009113'::uuid
      ],
      'thread:concurrent-empty-db-group'
    );`),
  ]);
  if (groupOperationCalls.some((result) => result.status !== 0)) {
    throw new Error(`Concurrent idempotent group creation failed:\n${groupOperationCalls.map((item) => item.stderr).filter(Boolean).join("\n")}`);
  }
  const groupIds = groupOperationCalls.flatMap(outputLines);
  if (groupIds.length !== 2 || new Set(groupIds).size !== 1) {
    throw new Error(`Concurrent group retries produced multiple conversations: ${JSON.stringify(groupIds)}`);
  }
  const deletionThreadId = groupIds[0];
  dockerPsql(database, `
    select id from public.msg_send_message(
      '${deletionThreadId}'::uuid,
      '00000000-0000-4000-8000-000000009111'::uuid,
      'Concurrent conversation deletion test','text','{}'::jsonb,
      '00000000-0000-4000-8000-000000009902'
    );
  `);
  const threadDeletionCalls = await Promise.all([
    dockerPsqlConcurrent(database, `select public.msg_delete_thread('${deletionThreadId}'::uuid,'00000000-0000-4000-8000-000000009111'::uuid,'00000000-0000-4000-8000-000000009903'::uuid);`),
    dockerPsqlConcurrent(database, `select public.msg_delete_thread('${deletionThreadId}'::uuid,'00000000-0000-4000-8000-000000009111'::uuid,'00000000-0000-4000-8000-000000009903'::uuid);`),
  ]);
  if (threadDeletionCalls.some((result) => result.status !== 0)) {
    throw new Error(`Concurrent user-scoped conversation removal failed:\n${threadDeletionCalls.map((item) => item.stderr).filter(Boolean).join("\n")}`);
  }
  const threadDeletionState = dockerPsql(database, `
    select
      (select is_active::text from public.msg_threads where id='${deletionThreadId}'::uuid) || '|' ||
      (select count(*)::text from public.msg_thread_deletion_operations where operation_id='00000000-0000-4000-8000-000000009903'::uuid) || '|' ||
      (select count(*)::text from public.msg_thread_visibility where thread_id='${deletionThreadId}'::uuid and user_id='00000000-0000-4000-8000-000000009111'::uuid and device_identifier is null) || '|' ||
      (select bool_and(is_deleted is false)::text from public.msg_messages where thread_id='${deletionThreadId}'::uuid);
  `).trim();
  if (threadDeletionState !== "true|1|1|true") {
    throw new Error(`Concurrent user-scoped conversation removal invariant failed: ${threadDeletionState}`);
  }
  const deletionMessageId = dockerPsql(database, `
    select id from public.msg_send_message(
      '${deletionThreadId}'::uuid,
      '00000000-0000-4000-8000-000000009111'::uuid,
      'Named group individual deletion test', 'text', '{}'::jsonb,
      '00000000-0000-4000-8000-000000009901'
    );
  `).trim();
  const retiredMessageDelete = await dockerPsqlConcurrent(
    database,
    `select id from public.msg_delete_message('${deletionMessageId}'::uuid, '00000000-0000-4000-8000-000000009111'::uuid);`
  );
  if (retiredMessageDelete.status === 0 || !/Individual-message deletion is retired/i.test(retiredMessageDelete.stderr)) {
    throw new Error(`Individual-message deletion did not fail closed: ${retiredMessageDelete.stderr}`);
  }
  console.log("verified 10-way exact finish, direct/Memphis canonical-pair barrier races with replay, GPS freshness/boundary/motion/replay/duplicate handling, two-worker outbox claims, restart lease recovery, two-browser Moxie CAS, atomic Moxie password rotation, stable/distinct named-manager identities, archived shared-room authority closure, idempotent ordinary group creation, concurrent user-scoped conversation removal, and retired individual-message deletion");
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
  if (result.manager_shared_messaging_rpc !== false) failures.push("Retired shared Ops Manager messaging RPC remains available");
  if (result.custodial_team_retired_rpc !== true) failures.push("Fail-closed retired Custodial Team compatibility RPC is missing");
  if (result.employee_group_messaging_rpc !== true) failures.push("Idempotent employee group messaging RPC is missing");
  if (result.thread_client_operation !== true) failures.push("Stable group operation identity column is missing");
  if (result.team_or_group_public_execute !== false) failures.push("Team/group creation RPC is executable by public/anonymous/authenticated roles");
  if (result.message_change_cursor !== true) failures.push("Message cross-device change cursor is missing");
  if (result.message_retention_columns !== true) failures.push("Deleted-message 14-day retention columns are missing");
  if (result.thread_delete_rpc !== true) failures.push("Authoritative conversation deletion RPC is missing");
  if (result.deleted_content_purge_rpc !== true) failures.push("Deleted-content retention purge RPC is missing");
  if (result.message_delete_public_execute !== false) failures.push("Message deletion RPC is executable by public/anonymous/authenticated roles");
  if (result.message_audit !== true) failures.push("Immutable message audit table is missing");
  if (result.notification_outbox !== true) failures.push("Operational notification outbox is missing");
  if (result.memphis_outbox_rpc !== true) failures.push("Targeted Memphis outbox claim RPC is missing");
  if (result.feedback_image_backup !== true) failures.push("Legacy feedback image recovery table is missing");
  if (result.moxie_revision !== true) failures.push("Moxie revision/CAS column is missing");
  if (result.moxie_password_rotation !== true) failures.push("Atomic Moxie password rotation RPC is missing");
  if (result.moxie_rotation_public_execute !== false) failures.push("Moxie password rotation RPC is executable by public/anonymous/authenticated roles");
  if (result.gps_v2_rpc !== true) failures.push("GPS v2 evidence RPC is missing");
  if (result.gps_v2_columns !== true) failures.push("GPS v2 observation/motion columns are missing");
  if (result.gps_v2_public_execute !== false) failures.push("GPS v2 evidence RPC is executable by public/anonymous/authenticated roles");
  if (result.employee_history_rls_hardened !== true) failures.push("Employee audit history tables do not have enabled and forced RLS");
  if (result.employee_history_browser_privileges !== false) failures.push("Employee audit history tables are accessible to browser roles");
  if (Number(result.employee_history_service_policies) !== 2) failures.push("Employee audit history service-role policies are incomplete");
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
insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at)
values ('00000000-0000-4000-8000-00000000f110','00000000-0000-4000-8000-00000000f103',repeat('f',64),now(),now()+interval '1 day');
insert into public.custodial_offline_scan_authority_snapshots(
  snapshot_id,device_id,employee_id,assignment_epoch,credential_id,generated_at,expires_at,locations_json
) values (
  repeat('1',64),'00000000-0000-4000-8000-00000000f103','00000000-0000-4000-8000-00000000f101',1,
  '00000000-0000-4000-8000-00000000f110',now(),now()+interval '12 hours','[]'::jsonb
);
insert into public.custodial_employee_device_assignment_history(device_id,device_identifier,new_employee_id,new_employee_name,change_reason,source)
values ('00000000-0000-4000-8000-00000000f103','REBUILD-FINISH-DEVICE','00000000-0000-4000-8000-00000000f101','Rebuild Finish Test','empty rebuild authority fixture','test');
insert into public.employees(id, employee_code, display_name, active, role)
values ('00000000-0000-4000-8000-00000000f127', 'REBUILD-FINISH-SECOND', 'Rebuild Finish Second Test', true, 'staff');
insert into public.devices(id, device_id, device_name, active, assigned_employee_id)
values ('00000000-0000-4000-8000-00000000f123', 'REBUILD-FINISH-DEVICE-SECOND', 'Rebuild Finish Second Device', true, '00000000-0000-4000-8000-00000000f127');
insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at)
values ('00000000-0000-4000-8000-00000000f126','00000000-0000-4000-8000-00000000f123',repeat('e',64),now(),now()+interval '1 day');
insert into public.custodial_employee_device_assignment_history(device_id,device_identifier,new_employee_id,new_employee_name,change_reason,source)
values ('00000000-0000-4000-8000-00000000f123','REBUILD-FINISH-DEVICE-SECOND','00000000-0000-4000-8000-00000000f127','Rebuild Finish Second Test','empty rebuild authority fixture','test');
select public.custodial_configure_backend_execution_key(encode(extensions.digest(convert_to('empty-rebuild-offline-authority-secret-0123456789','UTF8'),'sha256'),'hex'),'empty-rebuild');
select public.custodial_configure_native_route_proof_key(encode(extensions.digest(convert_to('empty-rebuild-native-route-secret-012345678901','UTF8'),'sha256'),'hex'),'empty-rebuild');
do $functional_test$
declare
  v_start jsonb;
  v_finish jsonb;
  v_replay jsonb;
  v_session_uuid text;
  v_issue_start jsonb;
  v_issue_completion jsonb;
  v_issue_session_uuid text;
  v_manager_user public.msg_users%rowtype;
  v_manager_user_again public.msg_users%rowtype;
  v_manager_user_b public.msg_users%rowtype;
  v_direct_thread public.msg_threads%rowtype;
  v_memphis_thread public.msg_threads%rowtype;
  v_scan_alert_thread_id uuid;
  v_group_thread_a public.msg_threads%rowtype;
  v_group_thread_b public.msg_threads%rowtype;
  v_delete jsonb;
  v_purge jsonb;
  v_message public.msg_messages%rowtype;
  v_old_message public.msg_messages%rowtype;
begin
  perform public.tool_report_device_sync_status_v2(
    'REBUILD-FINISH-DEVICE',3,now()-interval '3 hours',2,null,'rebuild-v2',null,'rebuild-sync-v2',
    jsonb_build_array(jsonb_build_object(
      'employee_id','00000000-0000-4000-8000-00000000f101','assignment_epoch',1,
      'snapshot_id',repeat('1',64),'queue_count',2,'oldest_item_at',now()-interval '2 hours'))
  );
  if not exists(
    select 1 from public.device_sync_status s
    where s.device_id='00000000-0000-4000-8000-00000000f103'
      and s.queue_count=3 and jsonb_array_length(s.queue_authority_groups)=1
      and s.queue_authority_groups->0->>'employee_id'='00000000-0000-4000-8000-00000000f101'
      and (s.queue_authority_groups->0->>'assignment_epoch')::integer=1
      and (s.queue_authority_groups->0->>'queue_count')::integer=2
  ) then raise exception 'Actor-bound device sync status was not persisted exactly'; end if;
  begin
    perform public.tool_report_device_sync_status_v2(
      'REBUILD-FINISH-DEVICE',1,now(),0,null,'rebuild-v2',null,'wrong-epoch',
      jsonb_build_array(jsonb_build_object(
        'employee_id','00000000-0000-4000-8000-00000000f101','assignment_epoch',2,
        'snapshot_id',repeat('1',64),'queue_count',1,'oldest_item_at',now()))
    );
    raise exception 'Wrong assignment epoch was accepted for actor-bound pending work';
  exception when insufficient_privilege then null; end;
  begin
    perform public.tool_report_device_sync_status_v2(
      'REBUILD-FINISH-DEVICE',1,now(),0,null,'rebuild-v2',null,'missing-epoch',
      jsonb_build_array(jsonb_build_object(
        'employee_id','00000000-0000-4000-8000-00000000f101',
        'snapshot_id',repeat('1',64),'queue_count',1,'oldest_item_at',now()))
    );
    raise exception 'Missing assignment epoch was accepted for actor-bound pending work';
  exception when invalid_parameter_value then null; end;
  perform public.tool_report_device_sync_status(
    'REBUILD-FINISH-DEVICE',1,now(),0,null,'build-22',null,'rebuild-sync-legacy'
  );
  if not exists(
    select 1 from public.device_sync_status s
    where s.device_id='00000000-0000-4000-8000-00000000f103'
      and s.queue_count=1 and s.queue_authority_groups='[]'::jsonb
  ) then raise exception 'Build 22 aggregate sync reporter compatibility was not retained'; end if;
  if has_function_privilege(
    'service_role',
    'public.custodial_report_device_sync_status_internal(text,integer,timestamp with time zone,integer,timestamp with time zone,text,text,text,jsonb)',
    'EXECUTE'
  ) then raise exception 'Service role can execute the internal device sync reporter directly'; end if;
  v_start := public.tool_start_session_v2(
    'REBUILD_FINISH',
    'REBUILD-FINISH-DEVICE',
    '00000000-0000-4000-8000-00000000f104',
    now() - interval '120 minutes',
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
    now() - interval '90 minutes'
  );
  if v_finish ->> 'status' <> 'pending_submit' or (v_finish ->> 'replayed')::boolean is not false then
    raise exception 'First exact finish did not produce one authoritative transition: %', v_finish;
  end if;
  v_replay := public.tool_finish_session_exact(
    v_session_uuid,
    'REBUILD-FINISH-DEVICE',
    '00000000-0000-4000-8000-00000000f105',
    now() - interval '90 minutes'
  );
  if v_replay ->> 'status' <> 'pending_submit' or (v_replay ->> 'replayed')::boolean is not true then
    raise exception 'Exact finish replay was not recognized idempotently: %', v_replay;
  end if;
  begin
    perform public.tool_finish_session_exact(
      v_session_uuid,
      'REBUILD-FINISH-DEVICE',
      '00000000-0000-4000-8000-00000000f106',
    now() - interval '89 minutes'
    );
    raise exception 'A second finish operation id was incorrectly accepted';
  exception when unique_violation then
    null;
  end;
  if (select count(*) from public.sessions where session_uuid = v_session_uuid) <> 1 then
    raise exception 'Exact finish functional check produced a duplicate session';
  end if;

  v_issue_completion := public.tool_complete_session_authoritative(
    v_session_uuid,
    '{"work_result":"details","services_performed":["trash_removed"],"notes":"Routine cleaning completed without a maintenance issue."}'::jsonb,
    'REBUILD-FINISH-DEVICE',
    '10000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-00000000f110',
    'empty-rebuild-offline-authority-secret-0123456789'
  );
  if v_issue_completion->>'status' <> 'closed' then
    raise exception 'Explicit maintenance issue completion was not accepted: %', v_issue_completion;
  end if;
  v_issue_completion := public.tool_complete_session_authoritative(
    v_session_uuid,
    '{"work_result":"details","services_performed":["trash_removed"],"notes":"Routine cleaning completed without a maintenance issue."}'::jsonb,
    'REBUILD-FINISH-DEVICE',
    '10000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-00000000f110',
    'empty-rebuild-offline-authority-secret-0123456789'
  );
  if v_issue_completion->>'status' <> 'closed' or coalesce((v_issue_completion->>'replayed')::boolean,false) is not true then
    raise exception 'Legacy adapter exact replay was not accepted idempotently: %', v_issue_completion;
  end if;
  if exists (select 1 from public.maintenance_tickets where session_id = (select id from public.sessions where session_uuid = v_session_uuid)) then
    raise exception 'Routine cleaning notes incorrectly created a maintenance ticket';
  end if;

  v_issue_start := public.tool_start_session_v2(
    'REBUILD_FINISH',
    'REBUILD-FINISH-DEVICE-SECOND',
    '00000000-0000-4000-8000-00000000f111',
    now() - interval '60 minutes',
    'rebuild-explicit-issue-start'
  );
  v_issue_session_uuid := v_issue_start ->> 'session_uuid';
  perform public.tool_finish_session_exact(
    v_issue_session_uuid,
    'REBUILD-FINISH-DEVICE-SECOND',
    '00000000-0000-4000-8000-00000000f112',
    now() - interval '30 minutes'
  );
  v_issue_completion := public.tool_complete_session_authoritative(
    v_issue_session_uuid,
    '{"work_result":"details","services_performed":["trash_removed"],"notes":"Routine context.","maintenance_issues":[{"label":"Leaking toilet","fixture_identifier":"stall 2"}]}'::jsonb,
    'REBUILD-FINISH-DEVICE-SECOND',
    '10000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-00000000f126',
    'empty-rebuild-offline-authority-secret-0123456789'
  );
  if v_issue_completion->>'status' <> 'closed' then
    raise exception 'Explicit maintenance issue completion was not accepted: %', v_issue_completion;
  end if;
  if (select count(*) from public.maintenance_tickets where session_id = (select id from public.sessions where session_uuid = v_issue_session_uuid)) <> 1 then
    raise exception 'Explicit maintenance issue did not create exactly one ticket: %', (select count(*) from public.maintenance_tickets where session_id = (select id from public.sessions where session_uuid = v_issue_session_uuid));
  end if;

  insert into public.ops_manager_managers(manager_id, display_name, roles, active)
  values ('00000000-0000-4000-8000-00000000f107', 'Rebuild Messaging Manager', array['OPS_MANAGER','CUSTODIAL_MANAGER','SECURITY_ADMIN']::text[], true);
  v_manager_user := public.msg_ensure_ops_manager_user('00000000-0000-4000-8000-00000000f107');
  if v_manager_user.messaging_identity_key <> 'ops_manager_named_0000000000004000800000000000f107'
     or v_manager_user.ops_manager_id <> '00000000-0000-4000-8000-00000000f107'::uuid
     or v_manager_user.display_name <> 'Rebuild Messaging Manager'
     or v_manager_user.role <> 'manager' then
    raise exception 'Named manager messaging principal was not server-derived correctly: %', row_to_json(v_manager_user);
  end if;
  insert into public.ops_manager_managers(manager_id, display_name, roles, active)
  values ('00000000-0000-4000-8000-00000000f115', 'Rebuild Messaging Manager Two', array['OPS_MANAGER']::text[], true);
  v_manager_user_b := public.msg_ensure_ops_manager_user('00000000-0000-4000-8000-00000000f115');
  v_manager_user_again := public.msg_ensure_ops_manager_user('00000000-0000-4000-8000-00000000f107');
  if v_manager_user.id <> v_manager_user_again.id then
    raise exception 'Named manager identity was not stable across devices';
  end if;
  v_direct_thread := public.msg_get_or_create_direct_thread(v_manager_user.id, v_manager_user_b.id);
  if v_manager_user.id = v_manager_user_b.id
     or v_manager_user_b.ops_manager_id <> '00000000-0000-4000-8000-00000000f115'::uuid
     or v_manager_user_b.display_name <> 'Rebuild Messaging Manager Two'
     or v_direct_thread.thread_type <> 'direct'
     or (select count(*) from public.msg_thread_participants where thread_id = v_direct_thread.id and left_at is null) <> 2
     or (select count(*) from public.msg_users where is_active is true and role='manager' and ops_manager_id in (
       '00000000-0000-4000-8000-00000000f107'::uuid,
       '00000000-0000-4000-8000-00000000f115'::uuid
     )) <> 2 then
    raise exception 'Named Ops Managers did not retain distinct identities in a direct conversation';
  end if;
  v_message := public.msg_send_message_as_ops_manager(
    '00000000-0000-4000-8000-00000000f107', v_direct_thread.id,
    'Named manager direct conversation', 'text', '{}'::jsonb,
    '00000000-0000-4000-8000-00000000f114'
  );
  if not exists (
    select 1 from public.msg_message_audit a
    where a.message_id=v_message.id
      and a.sender_user_id=v_manager_user.id
      and a.sender_ops_manager_id='00000000-0000-4000-8000-00000000f107'::uuid
  ) then
    raise exception 'Named authenticated manager attribution was not preserved in a direct conversation';
  end if;
  insert into public.msg_users(id,display_name,role,is_active)
  values ('00000000-0000-4000-8000-00000000f125','Memphis','bot',true)
  on conflict (id) do update set display_name='Memphis',role='bot',is_active=true;
  v_memphis_thread := public.msg_get_or_create_memphis_thread(v_manager_user.id);
  if v_memphis_thread.thread_type <> 'bot'
     or v_memphis_thread.title <> 'Memphis'
     or (select count(*) from public.msg_thread_participants where thread_id=v_memphis_thread.id and left_at is null) <> 2 then
    raise exception 'Named manager Memphis conversation was not created correctly';
  end if;
  v_scan_alert_thread_id := public.sch_get_or_create_scan_alert_thread(v_manager_user.id);
  if v_scan_alert_thread_id <> v_memphis_thread.id
     or (select count(*) from public.msg_threads t
         join public.msg_thread_participants a on a.thread_id=t.id and a.user_id=v_manager_user.id and a.left_at is null
         join public.msg_thread_participants b on b.thread_id=t.id and b.user_id='00000000-0000-4000-8000-00000000f125'::uuid and b.left_at is null
         where t.is_active is true and t.thread_type in ('direct','bot')
           and 2=(select count(*) from public.msg_thread_participants p where p.thread_id=t.id and p.left_at is null)) <> 1 then
    raise exception 'Scan alerts did not reuse exactly one canonical Memphis conversation';
  end if;
  insert into public.msg_threads(id, thread_type, title, created_by_user_id, is_active)
  values ('00000000-0000-4000-8000-00000000f108', 'group', 'Rebuild messaging authority', v_manager_user.id, true);
  insert into public.msg_thread_participants(thread_id, user_id)
  values ('00000000-0000-4000-8000-00000000f108', v_manager_user.id);
  v_message := public.msg_send_message_as_ops_manager(
    '00000000-0000-4000-8000-00000000f107', '00000000-0000-4000-8000-00000000f108',
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
  insert into public.employees(id, employee_code, display_name, active, role)
  values
    ('00000000-0000-4000-8000-00000000f117', 'EMP99117', 'Rebuild Ordinary Employee', true, 'staff'),
    ('00000000-0000-4000-8000-00000000f118', 'EMP99118', 'Rebuild Second Employee', true, 'staff');
  insert into public.msg_users(id, employee_id, display_name, role, is_active)
  values
    ('00000000-0000-4000-8000-00000000f116','00000000-0000-4000-8000-00000000f117','Rebuild Ordinary Employee','employee',true),
    ('00000000-0000-4000-8000-00000000f119','00000000-0000-4000-8000-00000000f118','Rebuild Second Employee','employee',true);
  insert into public.msg_device_assignments(device_identifier, msg_user_id, is_active)
  values
    ('REBUILD-MESSENGER-EMPLOYEE', '00000000-0000-4000-8000-00000000f116', true),
    ('REBUILD-MESSENGER-EMPLOYEE-2', '00000000-0000-4000-8000-00000000f119', true);
  if exists (select 1 from public.msg_threads where system_key='custodial_team_chat_v1') then
    raise exception 'Retired Custodial Team singleton still exists';
  end if;
  begin
    perform public.msg_get_or_create_custodial_team_thread('00000000-0000-4000-8000-00000000f116');
    raise exception 'Retired Custodial Team entry point created a conversation';
  exception when feature_not_supported then
    null;
  end;
  v_group_thread_a := public.msg_create_group_thread_v2(
    '00000000-0000-4000-8000-00000000f116',
    'Everyone',
    array[v_manager_user.id, '00000000-0000-4000-8000-00000000f119'::uuid],
    'thread:empty-db-employee-group'
  );
  v_group_thread_b := public.msg_create_group_thread_v2(
    '00000000-0000-4000-8000-00000000f116',
    'Everyone',
    array[v_manager_user.id, '00000000-0000-4000-8000-00000000f119'::uuid],
    'thread:empty-db-employee-group'
  );
  if v_group_thread_a.id <> v_group_thread_b.id
     or (select count(*) from public.msg_threads where client_thread_id='thread:empty-db-employee-group') <> 1
     or (select count(*) from public.msg_thread_participants where thread_id=v_group_thread_a.id and left_at is null) <> 3 then
    raise exception 'Employee group creation was not idempotent and exact';
  end if;
  begin
    perform public.msg_mark_thread_deleted(
      v_group_thread_a.id,
      '00000000-0000-4000-8000-00000000f116',
      'REBUILD-FINISH-DEVICE'
    );
    raise exception 'Retired archive entry point accepted a conversation';
  exception when feature_not_supported then
    null;
  end;

  v_old_message := public.msg_send_message(
    '00000000-0000-4000-8000-00000000f108',v_manager_user.id,
    'Old but not deleted history must remain', 'text', '{}'::jsonb,
    '00000000-0000-4000-8000-00000000f120'
  );
  update public.msg_messages
  set sent_at=now()-interval '45 days',created_at=now()-interval '45 days',updated_at=now()-interval '45 days'
  where id=v_old_message.id;

  perform public.msg_send_message(
    v_group_thread_a.id,'00000000-0000-4000-8000-00000000f116',
    'Disposable deleted conversation content','text','{}'::jsonb,
    '00000000-0000-4000-8000-00000000f121'
  );
  v_delete := public.msg_delete_thread(
    v_group_thread_a.id,
    '00000000-0000-4000-8000-00000000f116',
    '00000000-0000-4000-8000-00000000f122'
  );
  if (v_delete->>'deleted')::boolean is not true
     or v_delete->>'deletion_scope' <> 'user'
     or (v_delete->>'replayed')::boolean is not false
     or (select is_active from public.msg_threads where id=v_group_thread_a.id) is not true
     or exists (select 1 from public.msg_messages where thread_id=v_group_thread_a.id and is_deleted is true)
     or not exists (
       select 1 from public.msg_thread_visibility
       where thread_id=v_group_thread_a.id
         and user_id='00000000-0000-4000-8000-00000000f116'::uuid
         and device_identifier is null
     ) then
    raise exception 'Conversation removal was not user-scoped: %',v_delete;
  end if;
  v_delete := public.msg_delete_thread(
    v_group_thread_a.id,
    '00000000-0000-4000-8000-00000000f116',
    '00000000-0000-4000-8000-00000000f122'
  );
  if (v_delete->>'replayed')::boolean is not true then
    raise exception 'Conversation removal retry was not idempotent: %',v_delete;
  end if;

  begin
    perform public.msg_delete_message(v_message.id, v_manager_user_b.id);
    raise exception 'Retired individual-message deletion was accepted';
  exception when feature_not_supported then
    null;
  end;

  v_delete := public.msg_admin_tombstone_thread(
    v_group_thread_a.id,
    v_manager_user.id,
    '00000000-0000-4000-8000-00000000f124'
  );
  if (v_delete->>'deleted')::boolean is not true
     or v_delete->>'deletion_scope' <> 'global'
     or (select is_active from public.msg_threads where id=v_group_thread_a.id) is not false
     or exists (select 1 from public.msg_messages where thread_id=v_group_thread_a.id and is_deleted is false) then
    raise exception 'Admin global tombstone was not authoritative: %',v_delete;
  end if;

  v_purge := public.msg_purge_deleted_content(((v_delete->>'deleted_at')::timestamptz)+interval '13 days',1000);
  if not exists (select 1 from public.msg_threads where id=v_group_thread_a.id)
     or not exists (select 1 from public.msg_messages where thread_id=v_group_thread_a.id) then
    raise exception 'Globally tombstoned content was purged before the exact 14-day retention completed';
  end if;
  v_purge := public.msg_purge_deleted_content(((v_delete->>'deleted_at')::timestamptz)+interval '15 days',1000);
  if exists (select 1 from public.msg_threads where id=v_group_thread_a.id)
     or exists (select 1 from public.msg_messages where thread_id=v_group_thread_a.id)
     or not exists (select 1 from public.msg_messages where id=v_old_message.id and is_deleted is false) then
    raise exception 'Retention purge removed ordinary old history or failed to purge an admin tombstone: %',v_purge;
  end if;
  v_message := public.msg_send_message_as_ops_manager(
    '00000000-0000-4000-8000-00000000f107', v_memphis_thread.id,
    'Durable named-manager Memphis job test', 'text', '{"channel":"memphis","device_id":"REBUILD-FINISH-DEVICE"}'::jsonb,
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

  insert into public.employees(id,employee_code,display_name,active,role)
  values
    ('00000000-0000-4000-8000-00000000f301','EMP9901','Native Push Recipient',true,'staff'),
    ('00000000-0000-4000-8000-00000000f302','EMP9902','Native Push Sender',true,'staff');
  insert into public.devices(id,device_id,device_name,active,assigned_employee_id)
  values (
    '00000000-0000-4000-8000-00000000f303','NATIVE-PUSH-REBUILD','Native Push Rebuild Device',true,
    '00000000-0000-4000-8000-00000000f301'
  );
  insert into public.device_auth_credentials(
    credential_id,device_id,token_hash,device_label,confirmed_at,expires_at
  ) values (
    '00000000-0000-4000-8000-00000000f304','00000000-0000-4000-8000-00000000f303',
    repeat('a',64),'Native Push Rebuild Credential',now(),now()+interval '1 day'
  );
  insert into public.employee_push_registrations(
    registration_id,device_id,credential_id,employee_id,assignment_epoch,platform,fcm_token,token_hash
  ) values (
    '00000000-0000-4000-8000-00000000f305','00000000-0000-4000-8000-00000000f303',
    '00000000-0000-4000-8000-00000000f304','00000000-0000-4000-8000-00000000f301',
    1,'android','rebuild-native-fcm-token-1234567890',repeat('b',64)
  );
  insert into public.msg_users(id,employee_id,display_name,role,is_active)
  values
    ('00000000-0000-4000-8000-00000000f306','00000000-0000-4000-8000-00000000f301','Native Push Recipient','employee',true),
    ('00000000-0000-4000-8000-00000000f307','00000000-0000-4000-8000-00000000f302','Native Push Sender','employee',true);
  insert into public.msg_threads(id,thread_type,title,created_by_user_id,is_active)
  values (
    '00000000-0000-4000-8000-00000000f308','direct','Native push functional test',
    '00000000-0000-4000-8000-00000000f307',true
  );
  insert into public.msg_thread_participants(thread_id,user_id)
  values
    ('00000000-0000-4000-8000-00000000f308','00000000-0000-4000-8000-00000000f306'),
    ('00000000-0000-4000-8000-00000000f308','00000000-0000-4000-8000-00000000f307');
  v_message := public.msg_send_message(
    '00000000-0000-4000-8000-00000000f308','00000000-0000-4000-8000-00000000f307',
    'Native employee message push functional test','text','{}'::jsonb,
    '00000000-0000-4000-8000-00000000f309'
  );
  if not exists (
    select 1 from public.operational_notification_jobs job
    where job.job_key='employee-message-push:'||v_message.id::text||':00000000-0000-4000-8000-00000000f304'
      and job.job_type='employee_native_push'
      and job.status='pending'
      and job.payload_json->>'channel_id'='employee-messages'
      and job.payload_json->'data_json'->>'kind'='employee_message'
      and job.payload_json->'data_json'->>'thread_id'='00000000-0000-4000-8000-00000000f308'
  ) then
    raise exception 'Employee Messenger insert did not atomically queue the assignment-bound native push';
  end if;
  if coalesce((public.mz_enqueue_employee_location_pushes(now())->>'ok')::boolean,false) is not true then
    raise exception 'Employee location-state native push sweep did not execute successfully';
  end if;
end
$functional_test$;
rollback;
`;

if (dockerImage) {
  dockerContainer = fixtureName || `mz_schema_rebuild_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  ownsDockerContainer = true;
  try {
    if (freshOnly) {
      freshInitDirectory = mkdtempSync(resolve(tmpdir(), 'custodial-ci-fresh-empty-init-'));
      chmodSync(freshInitDirectory, 0o755);
      const directory = mkdtempSync(resolve(tmpdir(), 'custodial-ci-fresh-custody-'));
      chmodSync(directory, 0o700);
      freshCustody = { schema: 'custodial.ci-fresh-original-container-custody.v1', directory,
        name: dockerContainer, image: dockerImage, image_id: null, owner: randomUUID(),
        cidfile: resolve(directory, 'original-container.cid'), empty_init_directory: freshInitDirectory,
        ...(migrationsOnly ? { construction_only: true, host_socket_directory: fixtureSocket || null,
          max_connections: fixtureSocket ? 32 : 10, no_auto_table_grants: noAutoTableGrants } : {}) };
      freshCustodyReceipt('PREBIRTH_ORIGINAL_CONTAINER.json', freshCustody);
      const parent = openSync(tmpdir(), 'r');
      try { fsyncSync(parent); } finally { closeSync(parent); }
      if (freshInspect(dockerContainer)) throw new Error('Fresh name already exists; no adoption or cleanup');
      freshContainerMayExist = true;
    }
    const returnedCID = runDocker(freshOnly ? [
      'run', '-d', '--name', dockerContainer, '--label', 'custodial.owner=' + freshCustody.owner,
      '--cidfile', freshCustody.cidfile, '--network', 'none', '--read-only',
      '--memory', '512m', '--memory-swap', '512m', '--cpus', '1', '--pids-limit', '64', '--no-healthcheck',
      '--log-driver', 'local', '--log-opt', 'max-size=1m', '--log-opt', 'max-file=2',
      '--tmpfs', '/tmp:rw,size=64m', '--tmpfs', '/var/run/postgresql:rw,size=8m',
      ...(fixtureSocket ? ['--mount', `type=bind,source=${fixtureSocket},target=/custodial-fixture-socket`] : []),
      '--tmpfs', '/var/lib/postgresql/data:rw,size=1g',
      '--mount', `type=bind,source=${freshInitDirectory},target=/docker-entrypoint-initdb.d,readonly`,
      '-e', 'POSTGRES_USER=supabase_admin', '-e', 'POSTGRES_DB=postgres', '-e', 'PGDATA=/var/lib/postgresql/data',
      '-e', 'POSTGRES_PASSWORD=isolated-new-clean-no-network-test-only',
      '-e', 'POSTGRES_INITDB_ARGS=--auth-local=trust --auth-host=scram-sha-256', dockerImage,
      'postgres', '-D', '/var/lib/postgresql/data', '-c', 'shared_buffers=64MB', '-c', fixtureSocket ? 'max_connections=32' : 'max_connections=10',
      '-c', 'listen_addresses=',
      ...(fixtureSocket ? ['-c', 'unix_socket_directories=/var/run/postgresql,/custodial-fixture-socket'] : []),
      '-c', 'shared_preload_libraries=pg_cron,pg_net,pg_stat_statements',
      '-c', 'cron.launch_active_jobs=off', '-c', 'cron.database_name=postgres',
      '-c', 'statement_timeout=20000', '-c', fixtureSocket ? 'lock_timeout=0' : 'lock_timeout=5000',
    ] : [
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
      "-c",
      "cron.launch_active_jobs=off",
    ]);
    if (freshOnly) {
      const cid = returnedCID.trim();
      if (!/^[a-f0-9]{64}$/.test(cid) || readFileSync(freshCustody.cidfile, 'utf8').trim() !== cid)
        throw new Error('Returned fresh CID and original CID file disagree');
      freshContainerCID = cid;
      if (!freshOwnedIdentity()) throw new Error('Original fresh container absent after launch');
      freshCustodyReceipt('RETURNED_ORIGINAL_CID.json', { id: cid, name: freshCustody.name,
        owner: freshCustody.owner, image: freshCustody.image, image_id: freshCustody.image_id });
      dockerContainer = cid; // Every subsequent original check targets the exact owned object.
    }
    let ready = false;
    // Supabase's PostgreSQL image performs substantial first-boot initialization.
    // Busy developer workstations can legitimately need more than three minutes.
    for (let attempt = 0; attempt < 600; attempt += 1) {
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
    try {
      if (freshOnly) cleanupFreshOwnedContainer();
      else execFileSync("docker", ["rm", "-f", dockerContainer], { stdio: "ignore" });
    } finally { if (freshInitDirectory) rmSync(freshInitDirectory, { recursive: true }); }
    throw error;
  }
}

async function captureFailedNormalSelectedInventory(database, failure) {
  // Failure observation only, before owned cleanup; never continue or adopt a failed replay.
  const names = ['20261006113610_custodial_shared_events_outlook.sql', '20261006162427_custodial_shared_events_recovery_binding.sql'];
  if (noAutoTableGrants || !freshOnly || !freshSelection || !freshCustody
    || ![227, 228].includes(failure.order) || failure.name !== names[failure.order - 227])
    throw new Error('Normal inventory observation requires the exact selected227/228 owned fresh failure');
  const selected = freshSelection.entries[failure.order - 1];
  if (selected.name !== failure.name || failure.selected_sha256 !== selected.selected.sha256
    || failure.selected_sha256 !== failure.expected_selected_sha256)
    throw new Error('Normal failed selected source identity differs');
  const owned = freshOwnedIdentity();
  if (!owned || !owned.State.Running) throw new Error('Original failed normal fixture absent before inventory observation');
  const raw = dockerPsql(database, `select jsonb_build_object(
    'rows',coalesce(jsonb_agg(jsonb_build_object('object_kind',object_kind,'object_identity',object_identity,
      'restore_order',restore_order,'definition_sql',definition_sql,'definition_sha256',definition_sha256)
      order by object_kind,object_identity,restore_order),'[]'::jsonb),
    'count',count(*),'semantic_sha256',encode(extensions.digest(convert_to(coalesce(jsonb_agg(jsonb_build_object(
      'kind',object_kind,'identity',object_identity,'order',restore_order,'definition',definition_sql,'sha256',definition_sha256)
      order by object_kind,object_identity,restore_order),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex'))::text
    from public.custodial_release_authority_restore_inventory`);
  if (Buffer.byteLength(raw, 'utf8') > 16 * 1024 * 1024) throw new Error('Normal failed inventory exceeds private observation bound');
  const measured = JSON.parse(raw);
  if (!Array.isArray(measured.rows) || measured.count !== measured.rows.length
    || !Number.isSafeInteger(measured.count) || measured.count < 0 || !/^[a-f0-9]{64}$/.test(measured.semantic_sha256))
    throw new Error('Normal failed inventory observation shape differs');
  const inventory = { schema: 'custodial.normal-failed-selected-inventory.v1', rows: measured.rows };
  if (Buffer.byteLength(JSON.stringify(inventory, null, 2) + '\n', 'utf8') > 16 * 1024 * 1024)
    throw new Error('Normal formatted inventory exceeds private observation bound');
  // Revalidate the exact original CID/name/owner/image immediately before persistence.
  if (freshOwnedIdentity()?.Id !== owned.Id) throw new Error('Original failed normal fixture identity changed');
  const name = 'FAILED_NORMAL_SELECTED_INVENTORY.json';
  freshCustodyReceipt(name, inventory);
  const path = resolve(freshCustody.directory, name), bytes = readFileSync(path);
  freshCustodyReceipt('FAILED_NORMAL_SELECTED_METADATA.json', {
    schema: 'custodial.normal-failed-selected-inventory-metadata.v1',
    profile: 'NORMAL_SELECTED_FRESH_FAILURE_OBSERVATION_ONLY',
    container: owned.Id, name: freshCustody.name, owner: freshCustody.owner,
    image: freshCustody.image, image_id: freshCustody.image_id, database,
    failed_selected_migration: failure, inventory_count: measured.count,
    inventory_semantic_sha256: measured.semantic_sha256,
    inventory: { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length },
    observation_only: true, original_exception_preserved: true, continuation_permitted: false,
    canonical_fingerprint_PASS: false, full_suite_PASS: false, new_authority: false
  });
}

async function captureFailedNoAutoMigration(database, failure, witnesses) {
  // Failure observation only: no migration continuation, canonical admission or restoration.
  if (!noAutoTableGrants || !freshSelection || !freshOnly || !freshCustody)
    throw new Error('Failed-migration diagnostics require the explicit owned no-auto profile');
  const owned = freshOwnedIdentity();
  if (!owned || !owned.State.Running) throw new Error('Exact original failed fixture absent before diagnostic observation');
  const metadata = { schema: 'custodial.no-auto-failed-selected-migration-observation.v1',
    profile: 'NONCANONICAL_NO_AUTO_GRANTS_TEST_FIXTURE', container: freshContainerCID,
    name: freshCustody.name, owner: freshCustody.owner, image: freshCustody.image,
    image_id: freshCustody.image_id, database, failed_selected_migration: failure,
    successful_migration_witness_count: witnesses.length, observation_only: true,
    canonical_fingerprint_PASS: false, canonical_catalog_authority: false,
    full_suite_PASS: false, new_authority: false, continuation_permitted: false };
  freshCustodyReceipt('FAILED_SELECTED_MIGRATION_ORIGINAL.json', metadata);
  const references = {}, captureErrors = [];
  const privateReference = name => { const path = resolve(freshCustody.directory, name), bytes = readFileSync(path);
    return { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }; };
  const observe = async (name, capture) => {
    try {
      const value = await capture();
      freshCustodyReceipt(name, { ...metadata, ...value });
      references[name] = privateReference(name);
    } catch (error) { captureErrors.push({ diagnostic: name, name: error.name, message: String(error.message) }); }
  };
  await observe('FAILED_SELECTED_MIGRATION_FULL_CATALOG.json', async () => {
    const { captureSchemaCatalog, fingerprintSchemaCatalog } = await import('./schema-fingerprint-catalog.mjs');
    const catalog = await captureSchemaCatalog({ query: async statement => ({ rows: JSON.parse(dockerPsql(database,
      `select coalesce(json_agg(row_to_json(measured)), '[]'::json)::text from (${statement.replace(/;\s*$/, '')}) measured`).trim()) }) });
    return { catalog, measured_fingerprint: fingerprintSchemaCatalog(catalog).fingerprint,
      counts: Object.fromEntries(Object.entries(catalog).map(([name, rows]) => [name, rows.length])),
      capture_snapshot_authority: 'READ_ONLY_OWNED_FAILED_FIXTURE_SEPARATE_QUERIES_NOT_CANONICAL_AUTHORITY' };
  });
  await observe('FAILED_SELECTED_MIGRATION_FULL_RECOVERY_INVENTORY.json', async () => ({
    rows: JSON.parse(dockerPsql(database, `select coalesce(jsonb_agg(jsonb_build_object(
      'object_kind',object_kind,'object_identity',object_identity,'restore_order',restore_order,
      'definition_sql',definition_sql,'definition_sha256',definition_sha256)
      order by object_kind,object_identity),'[]'::jsonb)::text from public.custodial_release_authority_restore_inventory`).trim()),
  }));
  await observe('FAILED_SELECTED_MIGRATION_RAW_TABLE_SEQUENCE_ACL.json', async () => {
    const rows = JSON.parse(dockerPsql(database, `select coalesce(json_agg(row_to_json(observed) order by observed.relname,observed.relkind),'[]'::json)::text from (
      select c.relname,c.relkind::text as relkind,c.relacl::text as relacl_text from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','S')) observed`).trim());
    const aclDigestSql = "select md5(coalesce(string_agg(c.relname||'|'||c.relkind::text||'|'||coalesce(c.relacl::text,'<owner-default>'),E'\\n' order by c.relname,c.relkind),'')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','S')";
    return { rows, md5: dockerPsql(database, aclDigestSql).trim(), exact_existing_vacancy_acl_digest_sql: aclDigestSql };
  });
  await observe('FAILED_SELECTED_MIGRATION_COMPLETED_WITNESSES.json', async () => ({ witnesses }));
  freshCustodyReceipt('FAILED_SELECTED_MIGRATION_DIAGNOSTICS.json', { ...metadata, references, capture_errors: captureErrors,
    original_exception_preserved: true, observations_complete: captureErrors.length === 0 });
}

if (dockerContainer) {
  try {
    migrationConstruction: {
    execFileSync("docker", ["inspect", dockerContainer], { stdio: "ignore" });
    const targetDatabase = ownsDockerContainer || useEmptyContainerPostgres ? "postgres" : databaseName;
    if (useEmptyContainerPostgres) {
      const publicObjects = dockerPsql("postgres", `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public';`).trim();
      if (publicObjects !== "0") throw new Error("SCHEMA_REBUILD_USE_EMPTY_CONTAINER_POSTGRES requires an empty disposable public schema.");
    } else if (!ownsDockerContainer) {
      dockerPsql("postgres", `create database ${quoteIdentifier(databaseName)};`);
    }
    if (freshSelection) {
      if (dockerPsql(targetDatabase, "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public';").trim() !== '0')
        throw new Error('Fresh-only selected bootstrap requires an empty public schema.');
      freshSelection.assertBootstrap(dockerPsql(targetDatabase, freshSelection.bootstrap));
    }
    const noAutoWitnesses = [];
    const defaultsSql = "select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
    const noAutoCount = () => Number(dockerPsql(targetDatabase, defaultsSql).trim());
    const removeFixtureDefaults = () => {
      for (const owner of ['postgres','supabase_admin']) for (const scope of ['', 'in schema public'])
        dockerPsql(targetDatabase, `alter default privileges for role ${owner} ${scope} revoke all on tables from public,anon,authenticated,service_role; alter default privileges for role ${owner} ${scope} revoke all on sequences from public,anon,authenticated,service_role;`);
    };
    if (noAutoTableGrants) {
      removeFixtureDefaults();
      if (noAutoCount() !== 0) throw new Error('No-auto fixture default grants present before replay');
    }
    for (let index = 0; index < migrationFiles.length; index++) {
      const file = migrationFiles[index];
      const selected = freshSelection?.entries[index];
      const sql = selected ? selected.sql : readFileSync(resolve(migrationsDir, file), "utf8");
      if (noAutoTableGrants && index === 226) {
        const rows = JSON.parse(dockerPsql(targetDatabase, `select coalesce(jsonb_agg(jsonb_build_object(
          'object_kind',object_kind,'object_identity',object_identity,'restore_order',restore_order,
          'definition_sql',definition_sql,'definition_sha256',definition_sha256)
          order by object_kind,object_identity),'[]'::jsonb)::text from public.custodial_release_authority_restore_inventory`).trim());
        freshCustodyReceipt('NO_AUTO_PREFIX226_FULL_INVENTORY.json', {
          profile: 'NONCANONICAL_NO_AUTO_GRANTS_TEST_FIXTURE', rows,
          canonical_catalog_authority: false, new_authority: false, observation_only: true });
      }
      if (noAutoTableGrants && noAutoCount() !== 0) throw new Error('Automatic grants before selected migration ' + file);
      try {
        dockerPsql(targetDatabase, sql, selected?.atomicMode);
      } catch (error) {
        if (!noAutoTableGrants && freshSelection && [227, 228].includes(index + 1)) {
          try {
            const status = /^docker psql failed \((-?\d+)\):/.exec(String(error.message));
            await captureFailedNormalSelectedInventory(targetDatabase, { order: index + 1, name: file,
              original_sha256: createHash('sha256').update(readFileSync(resolve(migrationsDir, file))).digest('hex'),
              selected_sha256: createHash('sha256').update(sql).digest('hex'), expected_selected_sha256: selected.selected.sha256,
              atomic_mode: selected.atomicMode, original_psql_child_exit_code: status ? Number(status[1]) : null });
          } catch { /* Observation refusal must never replace the original selected-migration exception. */ }
        }
        if (noAutoTableGrants && freshSelection) {
          let failure = null;
          try {
          const status = /^docker psql failed \((-?\d+)\):/.exec(String(error.message));
          failure = { order: index + 1, name: file,
            original_sha256: createHash('sha256').update(readFileSync(resolve(migrationsDir, file))).digest('hex'),
            selected_sha256: createHash('sha256').update(sql).digest('hex'), expected_selected_sha256: selected.selected.sha256,
            atomic_mode: selected.atomicMode, original_error: { name: error.name, message: String(error.message) },
            original_psql_child_exit_code: status ? Number(status[1]) : null,
            exit_code_source: status ? 'EXACT_ORIGINAL_DOCKER_PSQL_FAILURE_MESSAGE' : 'NOT_AVAILABLE_IN_ORIGINAL_ERROR',
            original_helper_exit_code: null };
          await captureFailedNoAutoMigration(targetDatabase, failure, noAutoWitnesses);
          } catch (captureError) {
            try { freshCustodyReceipt('FAILED_SELECTED_MIGRATION_CAPTURE_REFUSAL.json', {
              failed_selected_migration: failure, diagnostic_error: { name: captureError.name, message: String(captureError.message) },
              observation_only: true, new_authority: false, original_exception_preserved: true }); } catch {}
          }
        }
        throw error;
      }
      if (noAutoTableGrants) {
        const normalizationNeeded = noAutoCount() !== 0;
        if (normalizationNeeded) {
          if (!['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file)
            || /create\s+(?:unlogged\s+)?table|create\s+sequence/i.test(sql))
            throw new Error('Unreviewed automatic grant construction in selected migration ' + file);
          removeFixtureDefaults();
        }
        if (noAutoCount() !== 0) throw new Error('Automatic grants after selected migration ' + file);
        noAutoWitnesses.push({ order: index + 1, name: file, original_sha256: createHash('sha256').update(readFileSync(resolve(migrationsDir, file))).digest('hex'),
          selected_sha256: createHash('sha256').update(sql).digest('hex'), atomic_mode: selected.atomicMode,
          exit: 0, before_default_grants: 0, after_default_grants: 0, normalization_removed: normalizationNeeded,
          ...(index + 1 === 153 ? { current_profile_153_raw_public_r_S_acl_md5: dockerPsql(targetDatabase, "select md5(coalesce(string_agg(c.relname||'|'||c.relkind::text||'|'||coalesce(c.relacl::text,'<owner-default>'),E'\\n' order by c.relname,c.relkind),'')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','S')").trim() } : {}) });
      }
      console.log(`applied ${file}`);
    }
    if (freshOnly && !freshOwnedIdentity()) throw new Error('Original fresh container absent before fingerprint capture');
    let measuredNoAutoCatalog = null;
    if (noAutoTableGrants) {
      if (noAutoWitnesses.length !== 294) throw new Error('No-auto fixture lacks all294 per-migration witnesses');
      const { captureSchemaCatalog, fingerprintSchemaCatalog } = await import('./schema-fingerprint-catalog.mjs');
      const catalog = await captureSchemaCatalog({ query: async statement => ({ rows: JSON.parse(dockerPsql(targetDatabase,
        `select coalesce(json_agg(row_to_json(measured)), '[]'::json)::text from (${statement.replace(/;\s*$/, '')}) measured`).trim()) }) });
      measuredNoAutoCatalog = { profile: 'NONCANONICAL_NO_AUTO_GRANTS_TEST_FIXTURE',
        measured_fingerprint: fingerprintSchemaCatalog(catalog).fingerprint,
        counts: Object.fromEntries(Object.entries(catalog).map(([name, rows]) => [name, rows.length])),
        canonical_fingerprint_PASS: false, new_authority: false };
      const rawAclRows = JSON.parse(dockerPsql(targetDatabase, `select coalesce(json_agg(row_to_json(observed) order by observed.relname,observed.relkind),'[]'::json)::text from (
        select c.relname,c.relkind::text as relkind,c.relacl::text as relacl_text from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind in ('r','S')) observed`).trim());
      const aclDigestSql = "select md5(coalesce(string_agg(c.relname||'|'||c.relkind::text||'|'||coalesce(c.relacl::text,'<owner-default>'),E'\\n' order by c.relname,c.relkind),'')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','S')";
      const rawAclMd5 = dockerPsql(targetDatabase, aclDigestSql).trim();
      const privateReference = name => { const path = resolve(freshCustody.directory, name), bytes = readFileSync(path);
        return { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }; };
      const prefix226 = privateReference('NO_AUTO_PREFIX226_FULL_INVENTORY.json');
      freshCustodyReceipt('NO_AUTO_TABLE_GRANTS_FULL_MEASURED_CATALOG.json', {
        ...measuredNoAutoCatalog, catalog, prefix226_inventory: prefix226,
        raw_public_table_sequence_acl: { rows: rawAclRows, md5: rawAclMd5, exact_existing_vacancy_acl_digest_sql: aclDigestSql },
        observation_only: true });
      measuredNoAutoCatalog = { ...measuredNoAutoCatalog, prefix226_inventory: prefix226,
        full_catalog: privateReference('NO_AUTO_TABLE_GRANTS_FULL_MEASURED_CATALOG.json') };
      freshCustodyReceipt('NO_AUTO_TABLE_GRANTS_MIGRATION_WITNESSES.json', { profile: measuredNoAutoCatalog.profile, witnesses: noAutoWitnesses });
      freshCustodyReceipt('NO_AUTO_TABLE_GRANTS_MEASURED_CATALOG.json', measuredNoAutoCatalog);
    } else {
    execFileSync(process.execPath, [resolve(root, "scripts/refresh-schema-fingerprint.mjs"), "--check"], {
      cwd: root,
      env: {
        ...process.env,
        SCHEMA_FINGERPRINT_DOCKER_CONTAINER: dockerContainer,
        SCHEMA_FINGERPRINT_DATABASE: targetDatabase,
        SCHEMA_FINGERPRINT_FRESH_CUSTODY: freshOnly ? freshCustody.directory : "",
        SCHEMA_FINGERPRINT_MCP_URL: "",
      },
      stdio: "inherit",
    });
    console.log("verified clean-rebuild schema inventory equals the committed canonical fingerprint");
    }
    if (migrationsOnly) {
      if (!freshOwnedIdentity()) throw new Error('Original fresh container absent at construction handoff');
      freshSelection.assertPreserved();
      const fingerprintBytes = readFileSync(resolve(root, 'supabase/canonical/schema-fingerprint.txt'));
      const construction = {
        schema: 'custodial.ci-fresh-only-migrations-construction.v1',
        state: noAutoTableGrants ? 'NONCANONICAL_NO_AUTO_GRANTS_TEST_FIXTURE' : 'CONSTRUCTED_NOT_FUNCTIONALLY_QUALIFIED',
        container: freshContainerCID, name: freshCustody.name, owner: freshCustody.owner,
        database: targetDatabase, image: freshCustody.image, image_id: freshCustody.image_id,
        custody_directory: freshCustody.directory, socket_directory: fixtureSocket || null,
        max_connections: fixtureSocket ? 32 : 10, selected_replay: freshSelection.receipt,
        fingerprint_check: noAutoTableGrants ? 'NOT_CANONICAL_PROFILE_MEASURED_ONLY' : 'PASS_COMMITTED_CANONICAL_FILE',
        no_auto_table_grants: noAutoTableGrants, measured_no_auto_catalog: measuredNoAutoCatalog,
        fingerprint_file_sha256: createHash('sha256').update(fingerprintBytes).digest('hex'),
        full_suite_PASS: false, synthetic_fixture_checks_executed: false,
      };
      freshCustodyReceipt('MIGRATIONS_ONLY_CONSTRUCTION.json', construction);
      freshConstructionCompleted = true;
      console.log(JSON.stringify({ migrations_only_construction: construction }));
      break migrationConstruction;
    }
    dockerPsql(targetDatabase, exactFinishFunctionalSql);
    console.log("verified exact session finish transition and idempotent replay");
    await verifyNamedManagerRetirementMigrationModes(targetDatabase);
    console.log("verified absent/one/replay retirement migration behavior, duplicate-pair fail-closed handling, and rollback injection");
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
        'custodial_team_retired_rpc', to_regprocedure('public.msg_get_or_create_custodial_team_thread(uuid)') is not null,
        'employee_group_messaging_rpc', to_regprocedure('public.msg_create_group_thread_v2(uuid,text,uuid[],text)') is not null,
        'thread_client_operation', exists(select 1 from information_schema.columns where table_schema='public' and table_name='msg_threads' and column_name='client_thread_id'),
        'team_or_group_public_execute', has_function_privilege('public', 'public.msg_get_or_create_custodial_team_thread(uuid)', 'EXECUTE')
          or has_function_privilege('anon', 'public.msg_get_or_create_custodial_team_thread(uuid)', 'EXECUTE')
          or has_function_privilege('authenticated', 'public.msg_get_or_create_custodial_team_thread(uuid)', 'EXECUTE')
          or has_function_privilege('public', 'public.msg_create_group_thread_v2(uuid,text,uuid[],text)', 'EXECUTE')
          or has_function_privilege('anon', 'public.msg_create_group_thread_v2(uuid,text,uuid[],text)', 'EXECUTE')
          or has_function_privilege('authenticated', 'public.msg_create_group_thread_v2(uuid,text,uuid[],text)', 'EXECUTE'),
        'message_change_cursor', exists(select 1 from information_schema.columns where table_schema='public' and table_name='msg_messages' and column_name='updated_at'),
        'message_retention_columns', exists(select 1 from information_schema.columns where table_schema='public' and table_name='msg_messages' and column_name='deleted_at')
          and exists(select 1 from information_schema.columns where table_schema='public' and table_name='msg_messages' and column_name='purge_after'),
        'thread_delete_rpc', to_regprocedure('public.msg_delete_thread(uuid,uuid,uuid)') is not null,
        'deleted_content_purge_rpc', to_regprocedure('public.msg_purge_deleted_content(timestamp with time zone,integer)') is not null,
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
          or has_function_privilege('authenticated', 'public.rotate_moxie_auth_credential(text,integer,text,text,text)', 'EXECUTE'),
        'gps_v2_rpc', to_regprocedure('public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)') is not null,
        'gps_v2_columns', exists(select 1 from information_schema.columns where table_schema='public' and table_name='device_location_proximity_status' and column_name='observed_at')
          and exists(select 1 from information_schema.columns where table_schema='public' and table_name='device_location_proximity_status' and column_name='observation_age_seconds')
          and exists(select 1 from information_schema.columns where table_schema='public' and table_name='device_location_proximity_status' and column_name='motion_speed_mps'),
        'gps_v2_public_execute', has_function_privilege('public', 'public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)', 'EXECUTE')
          or has_function_privilege('anon', 'public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)', 'EXECUTE')
          or has_function_privilege('authenticated', 'public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)', 'EXECUTE'),
        'employee_history_rls_hardened', not exists(
          select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public'
            and c.relname in ('custodial_employee_device_assignment_history','custodial_employee_status_history')
            and not (c.relrowsecurity and c.relforcerowsecurity)
        ),
        'employee_history_browser_privileges', exists(
          select 1 from information_schema.table_privileges
          where table_schema='public'
            and table_name in ('custodial_employee_device_assignment_history','custodial_employee_status_history')
            and grantee in ('PUBLIC','anon','authenticated')
        ),
        'employee_history_service_policies', (
          select count(*)::int from pg_policies
          where schemaname='public'
            and tablename in ('custodial_employee_device_assignment_history','custodial_employee_status_history')
            and roles @> array['service_role']::name[]
        )
      )::text;
      `,
    ).trim().split("\n").find((line) => line.trim().startsWith("{"));
    const rebuildResult = JSON.parse(counts);
    assertRebuildInvariants(rebuildResult);
    console.log(JSON.stringify({ ok: true, database: targetDatabase, migrations: migrationFiles.length, counts: rebuildResult }, null, 2));
    if (freshSelection) {
      freshSelection.assertPreserved();
      console.log(JSON.stringify({ scoped_fresh_only_replay: freshSelection.receipt }));
      freshChecksPassed = true;
    }
    } // migrationConstruction: default path retains every original functional check.
  } finally {
    try {
      if (!ownsDockerContainer && !useEmptyContainerPostgres && !keepDatabase) {
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
      if (!ownsDockerContainer && keepDatabase) console.log(JSON.stringify({ retained_test_database: targetDatabase }));
    } catch {
      // Best-effort cleanup for local/CI disposable databases.
    } finally {
      if (ownsDockerContainer && (!keepDatabase || (freshOnly && !freshChecksPassed && !freshConstructionCompleted))) {
        if (freshOnly) cleanupFreshOwnedContainer();
        else execFileSync("docker", ["rm", "-f", dockerContainer], { stdio: "ignore" });
      }
      if (ownsDockerContainer && keepDatabase && freshOnly && freshChecksPassed) {
        const owned = freshOwnedIdentity();
        if (!owned || !owned.State.Running) throw new Error('Full fresh fixture absent before retained handoff');
        const complete = {
          schema: 'custodial.ci-fresh-full-rebuild-functional-complete.v1',
          container: freshContainerCID, name: freshCustody.name, owner: freshCustody.owner,
          image: freshCustody.image, image_id: freshCustody.image_id, database: 'postgres',
          custody_directory: freshCustody.directory, selected_replay: freshSelection.receipt,
          full_suite_PASS: true, fingerprint_check: 'PASS_COMMITTED_CANONICAL_FILE',
          synthetic_fixture_checks_executed: true,
          fingerprint_file_sha256: createHash('sha256').update(readFileSync(resolve(root, 'supabase/canonical/schema-fingerprint.txt'))).digest('hex'),
        };
        freshCustodyReceipt('FULL_REBUILD_FUNCTIONAL_COMPLETE.json', complete);
        console.log(JSON.stringify({ retained_test_container: freshCustody.name,
          retained_test_container_id: freshContainerCID, retained_test_custody_directory: freshCustody.directory,
          retained_test_database: 'postgres' }));
      } else if (ownsDockerContainer && keepDatabase && (!freshOnly || freshConstructionCompleted))
        console.log(JSON.stringify({ retained_test_container: dockerContainer, retained_test_database: "postgres" }));
      if (freshInitDirectory) rmSync(freshInitDirectory, { recursive: true });
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
        to_regprocedure('public.msg_get_or_create_custodial_team_thread(uuid)') is not null as custodial_team_retired_rpc,
        to_regprocedure('public.msg_create_group_thread_v2(uuid,text,uuid[],text)') is not null as employee_group_messaging_rpc,
        exists(select 1 from information_schema.columns where table_schema='public' and table_name='msg_threads' and column_name='client_thread_id') as thread_client_operation,
        has_function_privilege('public', 'public.msg_get_or_create_custodial_team_thread(uuid)', 'EXECUTE')
          or has_function_privilege('anon', 'public.msg_get_or_create_custodial_team_thread(uuid)', 'EXECUTE')
          or has_function_privilege('authenticated', 'public.msg_get_or_create_custodial_team_thread(uuid)', 'EXECUTE')
          or has_function_privilege('public', 'public.msg_create_group_thread_v2(uuid,text,uuid[],text)', 'EXECUTE')
          or has_function_privilege('anon', 'public.msg_create_group_thread_v2(uuid,text,uuid[],text)', 'EXECUTE')
          or has_function_privilege('authenticated', 'public.msg_create_group_thread_v2(uuid,text,uuid[],text)', 'EXECUTE') as team_or_group_public_execute,
        exists(select 1 from information_schema.columns where table_schema='public' and table_name='msg_messages' and column_name='updated_at') as message_change_cursor,
        exists(select 1 from information_schema.columns where table_schema='public' and table_name='msg_messages' and column_name='deleted_at')
          and exists(select 1 from information_schema.columns where table_schema='public' and table_name='msg_messages' and column_name='purge_after') as message_retention_columns,
        to_regprocedure('public.msg_delete_thread(uuid,uuid,uuid)') is not null as thread_delete_rpc,
        to_regprocedure('public.msg_purge_deleted_content(timestamp with time zone,integer)') is not null as deleted_content_purge_rpc,
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
          or has_function_privilege('authenticated', 'public.rotate_moxie_auth_credential(text,integer,text,text,text)', 'EXECUTE') as moxie_rotation_public_execute,
        to_regprocedure('public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)') is not null as gps_v2_rpc,
        exists(select 1 from information_schema.columns where table_schema='public' and table_name='device_location_proximity_status' and column_name='observed_at')
          and exists(select 1 from information_schema.columns where table_schema='public' and table_name='device_location_proximity_status' and column_name='observation_age_seconds')
          and exists(select 1 from information_schema.columns where table_schema='public' and table_name='device_location_proximity_status' and column_name='motion_speed_mps') as gps_v2_columns,
        has_function_privilege('public', 'public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)', 'EXECUTE')
          or has_function_privilege('anon', 'public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)', 'EXECUTE')
          or has_function_privilege('authenticated', 'public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)', 'EXECUTE') as gps_v2_public_execute,
        not exists(
          select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public'
            and c.relname in ('custodial_employee_device_assignment_history','custodial_employee_status_history')
            and not (c.relrowsecurity and c.relforcerowsecurity)
        ) as employee_history_rls_hardened,
        exists(
          select 1 from information_schema.table_privileges
          where table_schema='public'
            and table_name in ('custodial_employee_device_assignment_history','custodial_employee_status_history')
            and grantee in ('PUBLIC','anon','authenticated')
        ) as employee_history_browser_privileges,
        (
          select count(*)::int from pg_policies
          where schemaname='public'
            and tablename in ('custodial_employee_device_assignment_history','custodial_employee_status_history')
            and roles @> array['service_role']::name[]
        ) as employee_history_service_policies
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
