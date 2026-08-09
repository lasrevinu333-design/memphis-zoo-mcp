#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import {
  managerJwkThumbprint,
  normalizeManagerKeyPair,
} from "../src/auth/manager-device-auth-v2-crypto.js";
import {
  PostgresManagerDeviceAuthV2Repository,
  managerDeviceAuthV2PoolConfig,
} from "../src/auth/manager-device-auth-v2-postgres.js";

const { Pool } = pg;
const image = String(process.env.MANAGER_V2_TEST_DOCKER_IMAGE || "supabase/postgres:17.6.1.143").trim();
if (!/^supabase\/postgres:[A-Za-z0-9._-]+$/.test(image)) throw new Error("A pinned Supabase PostgreSQL test image is required.");
const root = resolve(new URL("..", import.meta.url).pathname);
const container = `mz_manager_v2_${Date.now()}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
let pool = null;
let restartPool = null;
let cancelRacePool = null;
let createRacePool = null;
let cancelReplayPool = null;

function docker(args, options = {}) {
  return execFileSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options }).trim();
}

function dockerPsql(sql) {
  const result = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", "postgres"],
    { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`Disposable PostgreSQL migration failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

async function delay(millis) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, millis));
}

async function waitForAdvisoryLockWait(targetPool, applicationName) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const waiting = await targetPool.query(
      `select count(*)::integer as count
         from pg_stat_activity
        where application_name=$1 and state='active' and wait_event_type='Lock'`,
      [applicationName],
    );
    if (waiting.rows[0].count > 0) return;
    await delay(25);
  }
  throw new Error(`${applicationName} did not reach the advisory-lock race boundary.`);
}

function iso(millis) { return new Date(millis).toISOString(); }
function uuid() { return crypto.randomUUID(); }
function nonce(value) { return Buffer.alloc(16, value).toString("base64url"); }
function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function keyMaterial() {
  const signing = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const wrapping = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return normalizeManagerKeyPair(
    signing.publicKey.export({ format: "jwk" }),
    wrapping.publicKey.export({ format: "jwk" }),
  );
}

function proofClaim({ keys, operationId, value, fingerprint, kind, at }) {
  return {
    signingKeyId: keys.signingKeyId,
    nonce: nonce(value),
    operationId,
    requestFingerprint: fingerprint,
    resourceKind: kind,
    createdAt: iso(at),
    expiresAt: iso(at + 10 * 60_000),
  };
}

function envelope() {
  const ephemeral = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "jwk" });
  return {
    algorithm: "ECDH-P256-HKDF-SHA256+A256GCM",
    ephemeral_public_key_jwk: { kty: "EC", crv: "P-256", x: ephemeral.x, y: ephemeral.y },
    ephemeral_key_id: managerJwkThumbprint(ephemeral),
    wrapping_key_id: null,
    salt: Buffer.alloc(32, 0x21).toString("base64url"),
    iv: Buffer.alloc(12, 0x22).toString("base64url"),
    ciphertext: Buffer.alloc(96, 0x23).toString("base64url"),
    tag: Buffer.alloc(16, 0x24).toString("base64url"),
  };
}

async function seedCode(targetPool, { id, managerId, codeHash, at }) {
  await targetPool.query(
    `insert into public.ops_manager_enrollment_codes(
       id,manager_id,code_hash,role_snapshot,expires_at,max_attempts,metadata_json
     ) values($1,$2,$3,'DIRECTOR',$4,5,'{}'::jsonb)`,
    [id, managerId, codeHash, iso(at + 60 * 60_000)],
  );
}

async function createChallenge(repository, {
  operationId,
  deviceId,
  keys,
  proofKeys = keys,
  at,
  rateKey,
  value = 1,
  purpose = "enroll",
}) {
  const requestFingerprint = digest(`challenge:${operationId}:${purpose}`);
  const candidate = {
    challengeId: uuid(),
    operationId,
    purpose,
    requestFingerprint,
    rateKey,
    deviceId,
    deviceLabel: "Manager database test phone",
    platform: "android",
    provider: "play_integrity",
    signingKeyId: keys.signingKeyId,
    signingPublicKeyJwk: keys.signing,
    wrappingKeyId: keys.wrappingKeyId,
    wrappingPublicKeyJwk: keys.wrapping,
    proofNonce: nonce(value),
    policyVersion: "manager-device-attestation.v1",
    createdAt: iso(at),
    expiresAt: iso(at + 5 * 60_000),
  };
  const proof = proofClaim({ keys: proofKeys, operationId, value, fingerprint: requestFingerprint, kind: "challenge", at });
  return { candidate, proof, result: await repository.createOrRefreshChallenge({ candidate, proof, rateKey, activeChallengeLimit: 1000 }) };
}

function enrollmentCandidate({
  operationId,
  managerId,
  codeId,
  codeHash,
  deviceId,
  keys,
  challengeId,
  at,
  flow = "enroll",
  installationId = uuid(),
}) {
  const resultEnvelope = envelope();
  resultEnvelope.wrapping_key_id = keys.wrappingKeyId;
  return {
    operationId,
    flow,
    requestFingerprint: digest(`enrollment:${operationId}`),
    proofNonce: nonce(40),
    deviceId,
    deviceLabel: "Manager database test phone",
    platform: "android",
    managerId,
    managerRoles: ["OPS_MANAGER", "CUSTODIAL_MANAGER", "DIRECTOR", "SECURITY_ADMIN"],
    roleSnapshot: "DIRECTOR",
    codeId,
    codeHash,
    installationId,
    keyGenerationId: uuid(),
    credentialId: uuid(),
    credentialVerifier: digest(`credential:${operationId}`),
    credentialExpiresAt: iso(at + 365 * 24 * 60 * 60_000),
    resumeExpiresAt: iso(at + 30 * 60_000),
    signingKeyId: keys.signingKeyId,
    signingPublicKeyJwk: keys.signing,
    wrappingKeyId: keys.wrappingKeyId,
    wrappingPublicKeyJwk: keys.wrapping,
    requestedAccessLevel: "full_access",
    grantedAccessLevel: "full_access",
    attestationChallengeId: challengeId,
    attestationProvider: "play_integrity",
    attestationAppId: "org.memphiszoo.ops",
    attestationPolicyVersion: "manager-device-attestation.v1",
    attestationEvidenceDigest: digest(`evidence:${operationId}`),
    attestationVerifiedAt: iso(at),
    attestationKeyId: null,
    attestationPublicKeySpki: null,
    attestationReceipt: null,
    attestationAssertionCounter: 0,
    attestationValidationCategory: null,
    attestationBundleVersion: null,
    resultEnvelope,
    createdAt: iso(at),
    retainUntil: iso(at + 91 * 24 * 60 * 60_000),
  };
}

function cancellationInput({ operationId, challenge, keys, at, value }) {
  const actionRequestFingerprint = digest(`cancel:${operationId}`);
  return {
    cancellation: {
      operationId,
      challengeId: challenge.challengeId,
      challengeGeneration: challenge.generation,
      challengeRequestFingerprint: challenge.requestFingerprint,
      actionRequestFingerprint,
      deviceId: challenge.deviceId,
      platform: challenge.platform,
      signingKeyId: keys.signingKeyId,
      signingPublicKeyJwk: keys.signing,
      wrappingKeyId: keys.wrappingKeyId,
      wrappingPublicKeyJwk: keys.wrapping,
      retainUntil: iso(at + 91 * 24 * 60 * 60_000),
    },
    proof: proofClaim({
      keys,
      operationId,
      value,
      fingerprint: actionRequestFingerprint,
      kind: "cancel",
      at,
    }),
  };
}

try {
  // Pool configuration itself is a release boundary: remote connections may
  // never silently downgrade certificate validation.
  assert.equal(managerDeviceAuthV2PoolConfig({ DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test" }).ssl, false);
  assert.throws(() => managerDeviceAuthV2PoolConfig({
    DATABASE_URL: "postgresql://test:test@example.supabase.co:5432/postgres?sslmode=require",
    SUPABASE_DB_CA_CERT_PATH: "/etc/ssl/certs/ca-certificates.crt",
  }), /manager_v2_database_tls_invalid/);
  assert.throws(() => managerDeviceAuthV2PoolConfig({
    DATABASE_URL: "postgresql://test:test@example.supabase.co:5432/postgres",
  }), /manager_v2_database_ca_required/);
  const remoteConfig = managerDeviceAuthV2PoolConfig({
    DATABASE_URL: "postgresql://test:test@example.supabase.co:5432/postgres?sslmode=verify-full",
    SUPABASE_DB_CA_CERT_PATH: "/etc/ssl/certs/ca-certificates.crt",
  });
  assert.equal(remoteConfig.ssl.rejectUnauthorized, true);
  assert.equal(remoteConfig.connectionString.includes("sslmode"), false);

  docker([
    "run", "-d", "--name", container,
    "--tmpfs", "/var/lib/postgresql/data:rw,size=1g",
    "-p", "127.0.0.1::5432",
    "-e", "POSTGRES_PASSWORD=postgres",
    image,
    "-c", "shared_preload_libraries=pg_cron,pg_net,pg_stat_statements",
    "-c", "listen_addresses=*",
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const check = spawnSync("docker", ["exec", container, "psql", "-At", "-U", "supabase_admin", "-d", "postgres", "-c", "select 1"], { encoding: "utf8" });
    if (check.status === 0 && check.stdout.trim() === "1") { ready = true; break; }
    await delay(500);
  }
  if (!ready) throw new Error("Disposable manager v2 PostgreSQL container did not become ready.");
  let healthy = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = spawnSync(
      "docker",
      ["inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{end}}", container],
      { encoding: "utf8" },
    ).stdout.trim();
    if (!status || status === "healthy") { healthy = true; break; }
    await delay(1_000);
  }
  if (!healthy) throw new Error("Disposable manager v2 PostgreSQL container did not become healthy.");
  // The Supabase image briefly accepts connections before its first-boot
  // scripts perform their final restart. Wait for that boundary to settle.
  await delay(10_000);
  const settled = spawnSync("docker", ["exec", container, "psql", "-At", "-U", "supabase_admin", "-d", "postgres", "-c", "select 1"], { encoding: "utf8" });
  if (settled.status !== 0 || settled.stdout.trim() !== "1") throw new Error("Disposable manager v2 PostgreSQL container did not remain ready.");

  const migrations = readdirSync(resolve(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) dockerPsql(readFileSync(resolve(root, "supabase/migrations", name), "utf8"));
  const mapped = docker(["port", container, "5432/tcp"]);
  const port = Number(mapped.split(":").at(-1));
  if (!Number.isSafeInteger(port) || port < 1) throw new Error("Disposable PostgreSQL port was not resolved.");
  const connectionString = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
  pool = new Pool({ connectionString, max: 20, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
  await pool.query("select 1");
  const repository = new PostgresManagerDeviceAuthV2Repository({ pool });
  const at = Date.now();
  const managerId = uuid();
  const deviceId = `ops-app-${uuid()}`;
  await pool.query(
    `insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal,metadata_json)
     values($1,'Manager v2 database test',array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN'],true,false,'{}'::jsonb)`,
    [managerId],
  );

  const operationId = uuid();
  const codeId = uuid();
  const codeHash = digest("manager-v2-code");
  const keys = keyMaterial();
  const rateKey = digest("manager-v2-rate-key");
  await seedCode(pool, { id: codeId, managerId, codeHash, at });
  const challengeSeed = await createChallenge(repository, { operationId, deviceId, keys, at, rateKey, value: 1 });
  const duplicateChallenges = await Promise.all(Array.from({ length: 10 }, () => repository.createOrRefreshChallenge({
    candidate: { ...challengeSeed.candidate, challengeId: uuid() },
    proof: challengeSeed.proof,
    rateKey,
    activeChallengeLimit: 1000,
  })));
  assert.equal(new Set(duplicateChallenges.map((item) => item.challengeId)).size, 1);
  assert.equal(Number((await pool.query("select request_count from public.ops_manager_device_auth_v2_rate_limits where key_hash=$1", [rateKey])).rows[0].request_count), 1);

  const policyOperationId = uuid();
  const policySeed = await createChallenge(repository, {
    operationId: policyOperationId,
    deviceId,
    keys,
    at,
    rateKey: digest("manager-v2-policy-rate"),
    value: 3,
  });
  const policyAt = at + 1_000;
  const policyCandidate = {
    ...policySeed.candidate,
    challengeId: uuid(),
    proofNonce: nonce(4),
    policyVersion: `manager-device-attestation.v1.${"b".repeat(32)}`,
    createdAt: iso(policyAt),
    expiresAt: iso(policyAt + 5 * 60_000),
  };
  const policyReplacement = await repository.createOrRefreshChallenge({
    candidate: policyCandidate,
    proof: proofClaim({
      keys,
      operationId: policyOperationId,
      value: 4,
      fingerprint: policyCandidate.requestFingerprint,
      kind: "challenge",
      at: policyAt,
    }),
    rateKey: policyCandidate.rateKey,
    activeChallengeLimit: 1000,
  });
  assert.notEqual(policyReplacement.challengeId, policySeed.result.challengeId);
  assert.equal(policyReplacement.generation, 2);
  assert.equal(policyReplacement.policyVersion, policyCandidate.policyVersion);
  assert.ok((await repository.getChallengeByOperation(policyOperationId)).policyVersion.endsWith("b".repeat(32)));

  const activeBudgetRateKey = digest("manager-v2-active-budget-rate");
  for (let index = 0; index < 10; index += 1) {
    await createChallenge(repository, {
      operationId: uuid(),
      deviceId: `ops-app-${uuid()}`,
      keys,
      at: at + index * 100,
      rateKey: activeBudgetRateKey,
      value: 100 + index,
    });
  }
  await assert.rejects(
    () => createChallenge(repository, {
      operationId: uuid(),
      deviceId: `ops-app-${uuid()}`,
      keys,
      at: at + 1_100,
      rateKey: activeBudgetRateKey,
      value: 110,
    }),
    (error) => error.code === "manager_v2_challenge_rate_limited" && error.status === 429,
  );

  const requestBudgetRateKey = digest("manager-v2-request-budget-rate");
  for (let index = 0; index < 30; index += 1) {
    const budget = await createChallenge(repository, {
      operationId: uuid(),
      deviceId: `ops-app-${uuid()}`,
      keys,
      at: at + index * 1_000,
      rateKey: requestBudgetRateKey,
      value: 150 + index,
    });
    await pool.query(
      "update public.ops_manager_device_auth_v2_attestation_challenges set superseded_at=$2 where challenge_id=$1",
      [budget.result.challengeId, iso(at + index * 1_000 + 1)],
    );
  }
  await assert.rejects(
    () => createChallenge(repository, {
      operationId: uuid(),
      deviceId: `ops-app-${uuid()}`,
      keys,
      at: at + 30_000,
      rateKey: requestBudgetRateKey,
      value: 180,
    }),
    (error) => error.code === "manager_v2_challenge_rate_limited" && error.status === 429,
  );

  const replacementAt = at + 5 * 60_000 + 1;
  const replacement = await createChallenge(repository, { operationId, deviceId, keys, at: replacementAt, rateKey, value: 2 });
  assert.notEqual(replacement.result.challengeId, challengeSeed.result.challengeId);
  assert.equal(replacement.result.generation, 2);
  assert.equal((await pool.query(
    "select count(*)::integer as count from public.ops_manager_device_auth_v2_attestation_challenges where operation_id=$1",
    [operationId],
  )).rows[0].count, 2);

  const candidate = enrollmentCandidate({
    operationId, managerId, codeId, codeHash, deviceId, keys,
    challengeId: replacement.result.challengeId,
    at: replacementAt,
  });
  const enrollmentProof = proofClaim({
    keys, operationId, value: 40, fingerprint: candidate.requestFingerprint, kind: "enrollment", at: replacementAt,
  });
  const enrollmentResults = await Promise.all(Array.from({ length: 10 }, () => repository.createOrReplayEnrollment({ candidate, proof: enrollmentProof })));
  assert.equal(new Set(enrollmentResults.map((item) => item.credentialId)).size, 1);
  assert.ok(enrollmentResults.every((item) => item.resultEnvelope.ciphertext === candidate.resultEnvelope.ciphertext));
  assert.equal((await pool.query("select count(*)::integer as count from public.ops_manager_device_auth_v2_operations where operation_id=$1", [operationId])).rows[0].count, 1);
  assert.equal((await pool.query("select count(*)::integer as count from public.ops_manager_device_auth_v2_installations where installation_id=$1", [candidate.installationId])).rows[0].count, 1);
  assert.equal((await pool.query("select status from public.ops_manager_enrollment_codes where id=$1", [codeId])).rows[0].status, "pending_confirmation");

  // A new repository/pool must replay the exact durable envelope after an HTTP
  // response is lost and the process restarts.
  restartPool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
  const restarted = new PostgresManagerDeviceAuthV2Repository({ pool: restartPool });
  const afterRestart = await restarted.getOperation(operationId);
  assert.deepEqual(afterRestart.resultEnvelope, enrollmentResults[0].resultEnvelope);

  // Inject a database exception after the installation and key-generation
  // writes. The enclosing serializable transaction must roll back every row,
  // including the proof nonce and enrollment-code reservation, so an exact
  // retry remains possible.
  const faultOperationId = uuid();
  const faultDeviceId = `ops-app-${uuid()}`;
  const faultCodeId = uuid();
  const faultCodeHash = digest("manager-v2-fault-code");
  const faultKeys = keyMaterial();
  await seedCode(pool, { id: faultCodeId, managerId, codeHash: faultCodeHash, at: replacementAt });
  const faultChallenge = await createChallenge(restarted, {
    operationId: faultOperationId,
    deviceId: faultDeviceId,
    keys: faultKeys,
    at: replacementAt,
    rateKey: digest("manager-v2-fault-rate"),
    value: 50,
  });
  const faultCandidate = enrollmentCandidate({
    operationId: faultOperationId,
    managerId,
    codeId: faultCodeId,
    codeHash: faultCodeHash,
    deviceId: faultDeviceId,
    keys: faultKeys,
    challengeId: faultChallenge.result.challengeId,
    at: replacementAt,
  });
  const faultProof = proofClaim({
    keys: faultKeys,
    operationId: faultOperationId,
    value: 51,
    fingerprint: faultCandidate.requestFingerprint,
    kind: "enrollment",
    at: replacementAt,
  });
  dockerPsql(`
    create or replace function public.manager_v2_test_fail_operation_insert()
    returns trigger language plpgsql as $test$ begin raise exception 'injected manager v2 transaction failure'; end $test$;
    create trigger manager_v2_test_fail_operation_insert
    before insert on public.ops_manager_device_auth_v2_operations
    for each row execute function public.manager_v2_test_fail_operation_insert();
  `);
  await assert.rejects(() => restarted.createOrReplayEnrollment({ candidate: faultCandidate, proof: faultProof }), /injected manager v2 transaction failure/);
  const rolledBack = await pool.query(
    `select
       (select count(*) from public.ops_manager_device_auth_v2_operations where operation_id=$1)::integer as operations,
       (select count(*) from public.ops_manager_device_auth_v2_installations where installation_id=$2)::integer as installations,
       (select count(*) from public.ops_manager_device_auth_v2_key_generations where key_generation_id=$3)::integer as generations,
       (select count(*) from public.ops_manager_device_auth_v2_nonces where operation_id=$1 and resource_kind='enrollment')::integer as nonces,
       (select status from public.ops_manager_enrollment_codes where id=$4) as code_status,
       (select consumed_at is null from public.ops_manager_device_auth_v2_attestation_challenges where challenge_id=$5) as challenge_unconsumed`,
    [faultOperationId, faultCandidate.installationId, faultCandidate.keyGenerationId, faultCodeId, faultChallenge.result.challengeId],
  );
  assert.deepEqual(rolledBack.rows[0], {
    operations: 0, installations: 0, generations: 0, nonces: 0, code_status: "active", challenge_unconsumed: true,
  });
  dockerPsql(`
    drop trigger manager_v2_test_fail_operation_insert on public.ops_manager_device_auth_v2_operations;
    drop function public.manager_v2_test_fail_operation_insert();
  `);
  const faultRetry = await restarted.createOrReplayEnrollment({ candidate: faultCandidate, proof: faultProof });
  assert.equal(faultRetry.status, "pending_confirmation");
  const faultCancelAt = replacementAt + 1_000;
  const faultCancelled = await restarted.cancel({
    operationId: faultOperationId,
    at: iso(faultCancelAt),
    ...cancellationInput({
      operationId: faultOperationId,
      challenge: faultChallenge.result,
      keys: faultKeys,
      at: faultCancelAt,
      value: 52,
    }),
  });
  assert.equal(faultCancelled.status, "cancelled");

  // Deterministically queue cancellation ahead of an enrollment transaction
  // on the exact advisory lock used in production. Cancellation must commit a
  // retained tombstone, the already in-flight create must fail (including
  // after SERIALIZABLE retry), and a fresh pool must replay the same terminal
  // receipt without consuming the code or creating credential authority.
  const raceOperationId = uuid();
  const raceDeviceId = `ops-app-${uuid()}`;
  const raceCodeId = uuid();
  const raceCodeHash = digest("manager-v2-cancel-before-create-code");
  const raceKeys = keyMaterial();
  const raceAt = replacementAt + 1_500;
  await seedCode(pool, { id: raceCodeId, managerId, codeHash: raceCodeHash, at: raceAt });
  const raceChallenge = await createChallenge(restarted, {
    operationId: raceOperationId,
    deviceId: raceDeviceId,
    keys: raceKeys,
    at: raceAt,
    rateKey: digest("manager-v2-cancel-before-create-rate"),
    value: 90,
  });
  const raceCandidate = enrollmentCandidate({
    operationId: raceOperationId,
    managerId,
    codeId: raceCodeId,
    codeHash: raceCodeHash,
    deviceId: raceDeviceId,
    keys: raceKeys,
    challengeId: raceChallenge.result.challengeId,
    at: raceAt,
  });
  const raceEnrollmentProof = proofClaim({
    keys: raceKeys,
    operationId: raceOperationId,
    value: 91,
    fingerprint: raceCandidate.requestFingerprint,
    kind: "enrollment",
    at: raceAt,
  });
  const firstRaceCancellation = cancellationInput({
    operationId: raceOperationId,
    challenge: raceChallenge.result,
    keys: raceKeys,
    at: raceAt + 1,
    value: 92,
  });
  const raceBlocker = await pool.connect();
  let raceBlockerOpen = true;
  try {
    await raceBlocker.query("begin");
    await raceBlocker.query(
      "select pg_advisory_xact_lock(hashtextextended($1,0))",
      [`manager-device-auth-v2-operation:${raceOperationId}`],
    );
    cancelRacePool = new Pool({
      connectionString,
      max: 2,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 20_000,
      application_name: "mz_manager_v2_cancel_race",
    });
    createRacePool = new Pool({
      connectionString,
      max: 2,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 20_000,
      application_name: "mz_manager_v2_create_race",
    });
    const cancelRepository = new PostgresManagerDeviceAuthV2Repository({ pool: cancelRacePool });
    const createRepository = new PostgresManagerDeviceAuthV2Repository({ pool: createRacePool });
    const cancelPromise = cancelRepository.cancel({
      operationId: raceOperationId,
      at: iso(raceAt + 1),
      ...firstRaceCancellation,
    });
    await waitForAdvisoryLockWait(pool, "mz_manager_v2_cancel_race");
    const createPromise = createRepository.createOrReplayEnrollment({
      candidate: raceCandidate,
      proof: raceEnrollmentProof,
    }).then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error }),
    );
    await waitForAdvisoryLockWait(pool, "mz_manager_v2_create_race");
    await raceBlocker.query("commit");
    raceBlockerOpen = false;
    const cancelledBeforeCreate = await cancelPromise;
    const createOutcome = await createPromise;
    assert.equal(cancelledBeforeCreate.status, "cancelled");
    assert.equal(cancelledBeforeCreate.replayed, false);
    assert.equal(createOutcome.value, null);
    assert.equal(createOutcome.error?.code, "manager_v2_operation_cancelled");
  } finally {
    if (raceBlockerOpen) await raceBlocker.query("rollback").catch(() => null);
    raceBlocker.release();
  }
  await cancelRacePool.end();
  cancelRacePool = null;
  await createRacePool.end();
  createRacePool = null;

  cancelReplayPool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    application_name: "mz_manager_v2_cancel_replay",
  });
  const cancelReplayRepository = new PostgresManagerDeviceAuthV2Repository({ pool: cancelReplayPool });
  const retainedRaceCancellation = await cancelReplayRepository.getCancellation(raceOperationId);
  assert.equal(retainedRaceCancellation.status, "cancelled");
  assert.equal(retainedRaceCancellation.cancelledAt, iso(raceAt + 1));
  const replayRaceInput = cancellationInput({
    operationId: raceOperationId,
    challenge: raceChallenge.result,
    keys: raceKeys,
    at: raceAt + 2,
    value: 93,
  });
  const replayedRaceCancellation = await cancelReplayRepository.cancel({
    operationId: raceOperationId,
    at: iso(raceAt + 2),
    ...replayRaceInput,
  });
  assert.equal(replayedRaceCancellation.status, "cancelled");
  assert.equal(replayedRaceCancellation.replayed, true);
  assert.equal(replayedRaceCancellation.cancelledAt, iso(raceAt + 1));
  const raceRows = await pool.query(
    `select
       (select count(*) from public.ops_manager_device_auth_v2_cancellation_tombstones where operation_id=$1)::integer as tombstones,
       (select identity_kind from public.ops_manager_device_auth_v2_operation_identities where operation_id=$1) as identity_kind,
       (select count(*) from public.ops_manager_device_auth_v2_operations where operation_id=$1)::integer as operations,
       (select count(*) from public.ops_manager_device_auth_v2_installations where installation_id=$2)::integer as installations,
       (select count(*) from public.ops_manager_device_auth_v2_key_generations where key_generation_id=$3)::integer as generations,
       (select count(*) from public.ops_manager_device_auth_v2_nonces where operation_id=$1 and resource_kind='enrollment')::integer as enrollment_nonces,
       (select status from public.ops_manager_enrollment_codes where id=$4) as code_status,
       (select consumed_at is null from public.ops_manager_device_auth_v2_attestation_challenges where challenge_id=$5) as challenge_unconsumed,
       (select count(*) from public.ops_manager_auth_events
         where event_type='manager_device_auth_v2_cancelled_before_create'
           and detail_json->>'operation_id'=$1::text)::integer as cancel_events`,
    [raceOperationId, raceCandidate.installationId, raceCandidate.keyGenerationId,
      raceCodeId, raceChallenge.result.challengeId],
  );
  assert.deepEqual(raceRows.rows[0], {
    tombstones: 1,
    identity_kind: "cancelled",
    operations: 0,
    installations: 0,
    generations: 0,
    enrollment_nonces: 0,
    code_status: "active",
    challenge_unconsumed: true,
    cancel_events: 1,
  });
  await assert.rejects(
    () => createChallenge(cancelReplayRepository, {
      operationId: raceOperationId,
      deviceId: raceDeviceId,
      keys: raceKeys,
      at: raceAt + 3,
      rateKey: digest("manager-v2-cancel-before-create-rate"),
      value: 94,
    }),
    (error) => error.code === "manager_v2_operation_cancelled" && error.status === 409,
    "a retained cancellation must reject later challenge/create replay for the same operation UUID",
  );

  const oldCredentialId = uuid();
  await pool.query(
    `insert into public.ops_manager_trusted_devices(
       credential_id,device_id,device_label,token_hash,max_access_level,manager_id,platform_summary,expires_at,metadata_json
     ) values($1,$2,'Old manager credential',$3,'full_access',$4,'android',$5,'{}'::jsonb)`,
    [oldCredentialId, deviceId, digest("old-credential"), managerId, iso(replacementAt + 24 * 60 * 60_000)],
  );
  await pool.query(
    `insert into public.ops_manager_push_devices(credential_id,manager_id,device_id,platform,fcm_token)
     values($1,$2,$3,'android',$4)`,
    [oldCredentialId, managerId, deviceId, `old-fcm-token-${"x".repeat(32)}`],
  );
  await pool.query(
    `insert into public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,title,body)
     values($1,$2,$3,'test','Old queued notice','Must be cancelled')`,
    [`manager-v2-old-job-${uuid()}`, oldCredentialId, managerId],
  );
  const confirmed = await Promise.all(Array.from({ length: 10 }, () => restarted.confirm({
    operationId,
    credentialVerifier: candidate.credentialVerifier,
    at: iso(replacementAt + 2_000),
  })));
  assert.ok(confirmed.every((item) => item.status === "confirmed"));
  assert.equal((await pool.query(
    "select count(*)::integer as count from public.ops_manager_trusted_devices where device_id=$1 and revoked_at is null",
    [deviceId],
  )).rows[0].count, 1);
  assert.equal((await pool.query("select revoked_reason from public.ops_manager_trusted_devices where credential_id=$1", [oldCredentialId])).rows[0].revoked_reason, "superseded_by_manager_device_auth_v2");
  assert.equal((await pool.query("select enabled from public.ops_manager_push_devices where credential_id=$1", [oldCredentialId])).rows[0].enabled, false);
  assert.equal((await pool.query("select status from public.ops_manager_notification_queue where credential_id=$1", [oldCredentialId])).rows[0].status, "cancelled");
  const authority = await restarted.authenticateCredential({
    credentialId: candidate.credentialId,
    credentialVerifier: candidate.credentialVerifier,
    deviceId,
  });
  assert.equal(authority.keyGenerationId, candidate.keyGenerationId);
  assert.equal(authority.authorityEpoch, 1);
  const recoveryAuthority = await restarted.getRecoveryProofAuthority({
    deviceId,
    platform: "android",
    at: iso(replacementAt + 2_500),
  });
  assert.equal(recoveryAuthority.keyGenerationId, candidate.keyGenerationId);
  assert.equal(recoveryAuthority.signingKeyId, keys.signingKeyId);

  // The database independently revalidates that a recover challenge was
  // signed by the currently active generation. This closes the race between
  // challenge issuance and enrollment creation and protects callers even if a
  // future HTTP-layer regression accepts a self-signed pending key.
  const staleRecoveryOperationId = uuid();
  const staleRecoveryCodeId = uuid();
  const staleRecoveryCodeHash = digest("manager-v2-stale-recovery-code");
  const staleRecoveryKeys = keyMaterial();
  const unauthorizedProofKeys = keyMaterial();
  const recoveryAt = replacementAt + 2_500;
  await seedCode(pool, {
    id: staleRecoveryCodeId,
    managerId,
    codeHash: staleRecoveryCodeHash,
    at: recoveryAt,
  });
  const staleRecoveryChallenge = await createChallenge(restarted, {
    operationId: staleRecoveryOperationId,
    deviceId,
    keys: staleRecoveryKeys,
    proofKeys: unauthorizedProofKeys,
    at: recoveryAt,
    rateKey: digest("manager-v2-stale-recovery-rate"),
    value: 70,
    purpose: "recover",
  });
  const staleRecoveryCandidate = enrollmentCandidate({
    operationId: staleRecoveryOperationId,
    managerId,
    codeId: staleRecoveryCodeId,
    codeHash: staleRecoveryCodeHash,
    deviceId,
    keys: staleRecoveryKeys,
    challengeId: staleRecoveryChallenge.result.challengeId,
    at: recoveryAt,
    flow: "recover",
    installationId: candidate.installationId,
  });
  await assert.rejects(
    () => restarted.createOrReplayEnrollment({
      candidate: staleRecoveryCandidate,
      proof: proofClaim({
        keys: staleRecoveryKeys,
        operationId: staleRecoveryOperationId,
        value: 71,
        fingerprint: staleRecoveryCandidate.requestFingerprint,
        kind: "enrollment",
        at: recoveryAt,
      }),
    }),
    (error) => error.code === "manager_v2_authority_revoked" && error.status === 403,
  );
  assert.equal((await pool.query(
    "select status from public.ops_manager_enrollment_codes where id=$1",
    [staleRecoveryCodeId],
  )).rows[0].status, "active", "failed recovery authority validation must roll back code reservation");

  const recoveryOperationId = uuid();
  const recoveryCodeId = uuid();
  const recoveryCodeHash = digest("manager-v2-recovery-code");
  const recoveryKeys = keyMaterial();
  await seedCode(pool, { id: recoveryCodeId, managerId, codeHash: recoveryCodeHash, at: recoveryAt });
  const recoveryChallenge = await createChallenge(restarted, {
    operationId: recoveryOperationId,
    deviceId,
    keys: recoveryKeys,
    proofKeys: keys,
    at: recoveryAt,
    rateKey: digest("manager-v2-recovery-rate"),
    value: 72,
    purpose: "recover",
  });
  const recoveryCandidate = enrollmentCandidate({
    operationId: recoveryOperationId,
    managerId,
    codeId: recoveryCodeId,
    codeHash: recoveryCodeHash,
    deviceId,
    keys: recoveryKeys,
    challengeId: recoveryChallenge.result.challengeId,
    at: recoveryAt,
    flow: "recover",
    installationId: candidate.installationId,
  });
  const pendingRecovery = await restarted.createOrReplayEnrollment({
    candidate: recoveryCandidate,
    proof: proofClaim({
      keys: recoveryKeys,
      operationId: recoveryOperationId,
      value: 73,
      fingerprint: recoveryCandidate.requestFingerprint,
      kind: "enrollment",
      at: recoveryAt,
    }),
  });
  assert.equal(pendingRecovery.status, "pending_confirmation");
  assert.equal((await pool.query(
    "select count(*)::integer as count from public.ops_manager_trusted_devices where device_id=$1 and revoked_at is null",
    [deviceId],
  )).rows[0].count, 1, "pending recovery must preserve current credential authority");
  assert.deepEqual((await restarted.getOperation(recoveryOperationId)).resultEnvelope, recoveryCandidate.resultEnvelope,
    "a restarted backend must replay the exact durable recovery envelope");
  const recoveryCancelAt = recoveryAt + 250;
  const cancelledRecovery = await restarted.cancel({
    operationId: recoveryOperationId,
    at: iso(recoveryCancelAt),
    ...cancellationInput({
      operationId: recoveryOperationId,
      challenge: recoveryChallenge.result,
      keys: recoveryKeys,
      at: recoveryCancelAt,
      value: 74,
    }),
  });
  assert.equal(cancelledRecovery.status, "cancelled");
  assert.equal((await pool.query(
    "select status from public.ops_manager_device_auth_v2_installations where installation_id=$1",
    [candidate.installationId],
  )).rows[0].status, "active", "recovery cancellation must preserve the established installation");
  assert.equal((await pool.query(
    "select status from public.ops_manager_device_auth_v2_key_generations where key_generation_id=$1",
    [recoveryCandidate.keyGenerationId],
  )).rows[0].status, "retired", "recovery cancellation must retire only its pending key generation");

  const sessionOperationId = uuid();
  const sessionChallenge = await createChallenge(restarted, {
    operationId: sessionOperationId,
    deviceId,
    keys,
    at: replacementAt + 3_000,
    rateKey: digest("manager-v2-session-rate"),
    value: 60,
    purpose: "authorized_session",
  });
  const sessionEnvelope = envelope();
  sessionEnvelope.wrapping_key_id = keys.wrappingKeyId;
  const sessionCandidate = {
    operationId: sessionOperationId,
    sessionId: uuid(),
    requestFingerprint: digest(`session:${sessionOperationId}`),
    proofNonce: nonce(61),
    credentialId: candidate.credentialId,
    credentialVerifier: candidate.credentialVerifier,
    installationId: candidate.installationId,
    keyGenerationId: candidate.keyGenerationId,
    managerId,
    managerRoles: ["OPS_MANAGER", "CUSTODIAL_MANAGER", "DIRECTOR", "SECURITY_ADMIN"],
    deviceId,
    authorityEpoch: 1,
    signingKeyId: keys.signingKeyId,
    wrappingKeyId: keys.wrappingKeyId,
    requestedAccessLevel: "full_access",
    grantedAccessLevel: "full_access",
    tokenHash: digest(`token:${sessionOperationId}`),
    attestationChallengeId: sessionChallenge.result.challengeId,
    attestationEvidenceDigest: digest(`session-evidence:${sessionOperationId}`),
    attestationProvider: "play_integrity",
    attestationPolicyVersion: "manager-device-attestation.v1",
    attestationKeyId: null,
    assertionCounter: 0,
    attestationValidationCategory: null,
    attestationBundleVersion: null,
    attestationVerifiedAt: iso(replacementAt + 3_000),
    resultEnvelope: sessionEnvelope,
    createdAt: iso(replacementAt + 3_000),
    expiresAt: iso(replacementAt + 18 * 60_000),
    retainUntil: iso(replacementAt + 91 * 24 * 60 * 60_000),
  };
  const sessionProof = proofClaim({
    keys,
    operationId: sessionOperationId,
    value: 61,
    fingerprint: sessionCandidate.requestFingerprint,
    kind: "session",
    at: replacementAt + 3_000,
  });
  const sessions = await Promise.all(Array.from({ length: 10 }, () => restarted.createOrReplaySession({
    candidate: sessionCandidate,
    proof: sessionProof,
  })));
  assert.equal(new Set(sessions.map((item) => item.sessionId)).size, 1);
  const validSession = await restarted.validateAuthorizedSession({
    sessionId: sessionCandidate.sessionId,
    credentialId: candidate.credentialId,
    deviceId,
    managerId,
    authorityEpoch: 1,
    accessLevel: "full_access",
    roles: ["OPS_MANAGER", "CUSTODIAL_MANAGER", "DIRECTOR", "SECURITY_ADMIN"],
    tokenHash: sessionCandidate.tokenHash,
    at: iso(replacementAt + 4_000),
  });
  assert.equal(validSession.ok, true);
  assert.equal((await restarted.validateAuthorizedSession({
    sessionId: sessionCandidate.sessionId,
    credentialId: candidate.credentialId,
    deviceId,
    managerId,
    authorityEpoch: 1,
    accessLevel: "full_access",
    roles: ["OPS_MANAGER"],
    tokenHash: sessionCandidate.tokenHash,
    at: iso(replacementAt + 4_000),
  })).ok, false);
  await pool.query("update public.ops_manager_managers set roles=array['OPS_MANAGER']::text[] where manager_id=$1", [managerId]);
  assert.equal((await restarted.validateAuthorizedSession({
    sessionId: sessionCandidate.sessionId,
    credentialId: candidate.credentialId,
    deviceId,
    managerId,
    authorityEpoch: 1,
    accessLevel: "full_access",
    roles: ["OPS_MANAGER", "CUSTODIAL_MANAGER", "DIRECTOR", "SECURITY_ADMIN"],
    tokenHash: sessionCandidate.tokenHash,
    at: iso(replacementAt + 4_000),
  })).ok, false, "a live manager role change must invalidate the earlier signed authority snapshot");
  await pool.query(
    "update public.ops_manager_managers set roles=array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[] where manager_id=$1",
    [managerId],
  );
  await pool.query("update public.ops_manager_managers set active=false where manager_id=$1", [managerId]);
  assert.equal((await restarted.validateAuthorizedSession({
    sessionId: sessionCandidate.sessionId,
    credentialId: candidate.credentialId,
    deviceId,
    managerId,
    authorityEpoch: 1,
    accessLevel: "full_access",
    roles: ["OPS_MANAGER", "CUSTODIAL_MANAGER", "DIRECTOR", "SECURITY_ADMIN"],
    tokenHash: sessionCandidate.tokenHash,
    at: iso(replacementAt + 4_000),
  })).ok, false, "manager deactivation must revoke durable session authority immediately");
  await pool.query("update public.ops_manager_managers set active=true where manager_id=$1", [managerId]);

  await pool.query(
    `insert into public.ops_manager_push_devices(credential_id,manager_id,device_id,platform,fcm_token)
     values($1,$2,$3,'android',$4)`,
    [candidate.credentialId, managerId, deviceId, `active-fcm-token-${"y".repeat(32)}`],
  );
  await pool.query(
    `insert into public.ops_manager_notification_preferences(credential_id,manager_id)
     values($1,$2)`,
    [candidate.credentialId, managerId],
  );
  await pool.query(
    `update public.ops_manager_notification_preferences set messages_enabled=false where credential_id=$1`,
    [candidate.credentialId],
  );
  assert.equal((await pool.query(
    "select messages_enabled from public.ops_manager_notification_preferences where credential_id=$1",
    [candidate.credentialId],
  )).rows[0].messages_enabled, false);
  await pool.query(
    `insert into public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,title,body)
     values($1,$2,$3,'test','Active queued notice','Must be cancelled atomically')`,
    [`manager-v2-active-job-${uuid()}`, candidate.credentialId, managerId],
  );

  // A future legacy writer must share the same binding boundary. Exercise the
  // trigger inside a rollback-only transaction so the primary removal test
  // remains intact: the v2 credential, push, jobs, session, key generation,
  // and installation all fail closed together. The narrow deactivation path
  // must not permit a revoked row to change its delivery token.
  const boundaryClient = await pool.connect();
  try {
    await boundaryClient.query("begin");
    await boundaryClient.query(
      `insert into public.ops_manager_trusted_devices(
         credential_id,device_id,device_label,token_hash,max_access_level,manager_id,platform_summary,expires_at,metadata_json
       ) values($1,$2,'Legacy replacement credential',$3,'full_access',$4,'android',$5,'{}'::jsonb)`,
      [uuid(), deviceId, digest("legacy-replacement"), managerId, iso(replacementAt + 24 * 60 * 60_000)],
    );
    const boundary = await boundaryClient.query(
      `select
         (select revoked_at is not null from public.ops_manager_trusted_devices where credential_id=$1) as credential_revoked,
         (select enabled=false and revoked_at is not null from public.ops_manager_push_devices where credential_id=$1) as push_revoked,
         (select bool_and(status='cancelled') from public.ops_manager_notification_queue where credential_id=$1) as jobs_cancelled,
         (select revoked_at is not null from public.ops_manager_device_auth_v2_sessions where session_id=$2) as session_revoked,
         (select status='retired' from public.ops_manager_device_auth_v2_key_generations where key_generation_id=$3) as generation_retired,
         (select status='retired' from public.ops_manager_device_auth_v2_installations where installation_id=$4) as installation_retired`,
      [candidate.credentialId, sessionCandidate.sessionId, candidate.keyGenerationId, candidate.installationId],
    );
    assert.deepEqual(boundary.rows[0], {
      credential_revoked: true,
      push_revoked: true,
      jobs_cancelled: true,
      session_revoked: true,
      generation_retired: true,
      installation_retired: true,
    });
    await boundaryClient.query("savepoint reject_push_identity_mutation");
    await assert.rejects(
      () => boundaryClient.query(
        `update public.ops_manager_push_devices set fcm_token=$2 where credential_id=$1`,
        [candidate.credentialId, `forbidden-token-change-${"z".repeat(32)}`],
      ),
      (error) => error.code === "23514",
    );
    await boundaryClient.query("rollback to savepoint reject_push_identity_mutation");
    await boundaryClient.query("rollback");
  } finally {
    boundaryClient.release();
  }

  const removalOperationId = uuid();
  const removalCandidate = {
    operationId: removalOperationId,
    requestFingerprint: digest(`removal:${removalOperationId}`),
    proofNonce: nonce(70),
    credentialId: candidate.credentialId,
    credentialVerifier: candidate.credentialVerifier,
    installationId: candidate.installationId,
    deviceId,
    at: iso(replacementAt + 5_000),
    retainUntil: iso(replacementAt + 91 * 24 * 60 * 60_000),
  };
  const removalProof = proofClaim({
    keys,
    operationId: removalOperationId,
    value: 70,
    fingerprint: removalCandidate.requestFingerprint,
    kind: "removal",
    at: replacementAt + 5_000,
  });
  const removals = await Promise.all(Array.from({ length: 10 }, () => restarted.removeCredential({
    candidate: removalCandidate,
    proof: removalProof,
  })));
  assert.ok(removals.every((item) => item.status === "removed"));
  assert.ok(removals.every((item) => item.push_registrations_deactivated === 1));
  assert.ok(removals.every((item) => item.notification_jobs_cancelled === 1));
  assert.ok(removals.every((item) => item.sessions_revoked === 1));
  assert.equal((await restarted.validateAuthorizedSession({
    sessionId: sessionCandidate.sessionId,
    credentialId: candidate.credentialId,
    deviceId,
    managerId,
    authorityEpoch: 1,
    accessLevel: "full_access",
    roles: ["OPS_MANAGER", "CUSTODIAL_MANAGER", "DIRECTOR", "SECURITY_ADMIN"],
    tokenHash: sessionCandidate.tokenHash,
    at: iso(replacementAt + 6_000),
  })).ok, false);
  assert.equal((await restarted.getRemoval(removalOperationId)).result.status, "removed");

  const replayNonce = proofClaim({
    keys,
    operationId: uuid(),
    value: 80,
    fingerprint: digest("nonce-exact"),
    kind: "resume",
    at: replacementAt + 7_000,
  });
  await restarted.recordActionProof(replayNonce);
  await restarted.recordActionProof(replayNonce);
  await assert.rejects(() => restarted.recordActionProof({ ...replayNonce, requestFingerprint: digest("nonce-conflict") }), (error) => error.code === "manager_v2_nonce_replayed");

  const security = await pool.query(`
    select
      (select bool_and(c.relrowsecurity and c.relforcerowsecurity)
         from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind in ('r','p')
          and c.relname like 'ops\_manager\_device\_auth\_v2\_%' escape '\\') as rls_forced,
      not has_table_privilege('service_role','public.ops_manager_device_auth_v2_operations','SELECT') as service_role_denied,
      (select count(*)=0 from information_schema.columns
        where table_schema='public' and table_name like 'ops\_manager\_device\_auth\_v2\_%' escape '\\'
          and (column_name ilike '%plaintext%' or column_name ilike '%device_credential%')) as no_plaintext_columns
  `);
  assert.deepEqual(security.rows[0], { rls_forced: true, service_role_denied: true, no_plaintext_columns: true });
  const missingIndexes = await pool.query(`
    select c.conname
      from pg_constraint c
      join pg_class t on t.oid=c.conrelid
      join pg_namespace n on n.oid=t.relnamespace
     where c.contype='f' and n.nspname='public'
       and t.relname like 'ops\_manager\_device\_auth\_v2\_%' escape '\\'
       and not exists (
         select 1 from pg_index i
          where i.indrelid=c.conrelid and i.indisvalid
            and (select array_agg(k.attnum::smallint order by k.ordinality)
                   from unnest(i.indkey) with ordinality k(attnum,ordinality)
                  where k.ordinality<=cardinality(c.conkey)) = c.conkey
       )
  `);
  assert.deepEqual(missingIndexes.rows, [], `manager v2 foreign keys lack indexes: ${missingIndexes.rows.map((row) => row.conname).join(", ")}`);

  console.log("MANAGER_DEVICE_AUTH_V2_DATABASE_PASS");
} catch (error) {
  try {
    const diagnostics = docker(["logs", "--tail", "80", container]);
    if (diagnostics) console.error(diagnostics);
  } catch {}
  throw error;
} finally {
  await cancelReplayPool?.end().catch(() => null);
  await createRacePool?.end().catch(() => null);
  await cancelRacePool?.end().catch(() => null);
  await restartPool?.end().catch(() => null);
  await pool?.end().catch(() => null);
  try { docker(["rm", "-f", container]); } catch {}
}
