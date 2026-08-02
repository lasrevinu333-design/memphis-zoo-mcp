import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { canonicalManagerRoles } from "./manager-device-auth-v2-crypto.js";

function failure(code, status = 503) {
  return Object.assign(new Error(code), { code, status });
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function iso(value) {
  return value?.toISOString?.() || value || null;
}

function canonicalRoles(value) {
  try {
    return canonicalManagerRoles(value);
  } catch {
    return [];
  }
}

function mapEnvelope(row) {
  if (!row?.envelope_algorithm) return null;
  return {
    algorithm: row.envelope_algorithm,
    ephemeral_public_key_jwk: row.envelope_ephemeral_public_key_jwk,
    ephemeral_key_id: row.envelope_ephemeral_key_id,
    wrapping_key_id: row.wrapping_key_id,
    salt: row.envelope_salt,
    iv: row.envelope_iv,
    ciphertext: row.envelope_ciphertext,
    tag: row.envelope_tag,
  };
}

function mapChallenge(row) {
  if (!row) return null;
  return {
    challengeId: row.challenge_id,
    operationId: row.operation_id,
    generation: Number(row.generation),
    purpose: row.purpose,
    requestFingerprint: row.request_fingerprint,
    rateKey: row.rate_key_hash,
    deviceId: row.device_id,
    deviceLabel: row.device_label,
    platform: row.platform,
    provider: row.provider,
    signingKeyId: row.signing_key_id,
    signingPublicKeyJwk: row.signing_public_key_jwk,
    wrappingKeyId: row.wrapping_key_id,
    wrappingPublicKeyJwk: row.wrapping_public_key_jwk,
    proofNonce: row.proof_nonce,
    policyVersion: row.policy_version,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    consumedAt: iso(row.consumed_at),
    consumedEvidenceDigest: row.consumed_evidence_digest,
    supersededAt: iso(row.superseded_at),
  };
}

function mapOperation(row) {
  if (!row) return null;
  return {
    operationId: row.operation_id,
    flow: row.flow,
    status: row.status,
    requestFingerprint: row.request_fingerprint,
    proofNonce: row.proof_nonce,
    deviceId: row.device_id,
    deviceLabel: row.device_label,
    platform: row.platform,
    managerId: row.manager_id,
    managerRoles: row.manager_roles || [],
    roleSnapshot: row.role_snapshot,
    codeId: row.enrollment_code_id,
    installationId: row.installation_id,
    keyGenerationId: row.key_generation_id,
    credentialId: row.credential_id,
    credentialVerifier: row.credential_verifier,
    credentialExpiresAt: iso(row.credential_expires_at),
    resumeExpiresAt: iso(row.resume_expires_at),
    signingKeyId: row.signing_key_id,
    signingPublicKeyJwk: row.signing_public_key_jwk,
    wrappingKeyId: row.wrapping_key_id,
    wrappingPublicKeyJwk: row.wrapping_public_key_jwk,
    requestedAccessLevel: row.requested_access_level,
    grantedAccessLevel: row.granted_access_level,
    attestationChallengeId: row.attestation_challenge_id,
    attestationProvider: row.attestation_provider,
    attestationAppId: row.attestation_app_id,
    attestationPolicyVersion: row.attestation_policy_version,
    attestationEvidenceDigest: row.attestation_evidence_digest,
    attestationVerifiedAt: iso(row.attestation_verified_at),
    attestationKeyId: row.attestation_key_id,
    attestationPublicKeySpki: row.attestation_public_key_spki,
    attestationReceipt: row.attestation_receipt,
    attestationAssertionCounter: Number(row.attestation_assertion_counter || 0),
    attestationValidationCategory: row.attestation_validation_category,
    attestationBundleVersion: row.attestation_bundle_version,
    resultEnvelope: mapEnvelope(row),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    confirmedAt: iso(row.confirmed_at),
    cancelledAt: iso(row.cancelled_at),
    expiredAt: iso(row.expired_at),
  };
}

function mapSession(row) {
  if (!row) return null;
  return {
    operationId: row.operation_id,
    sessionId: row.session_id,
    requestFingerprint: row.request_fingerprint,
    proofNonce: row.proof_nonce,
    credentialId: row.credential_id,
    installationId: row.installation_id,
    keyGenerationId: row.key_generation_id,
    managerId: row.manager_id,
    managerRoles: row.manager_roles || [],
    deviceId: row.device_id,
    authorityEpoch: Number(row.authority_epoch),
    requestedAccessLevel: row.requested_access_level,
    grantedAccessLevel: row.granted_access_level,
    tokenHash: row.token_hash,
    attestationChallengeId: row.attestation_challenge_id,
    attestationEvidenceDigest: row.attestation_evidence_digest,
    resultEnvelope: mapEnvelope(row),
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    revokedAt: iso(row.revoked_at),
    revokedReason: row.revoked_reason,
  };
}

function retryable(error) {
  return new Set(["40001", "40P01"]).has(String(error?.code || ""));
}

export function managerDeviceAuthV2PoolConfig(env = process.env) {
  const raw = String(env.SUPABASE_DB_URL || env.DATABASE_URL || "").trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw failure("manager_v2_repository_required");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol) || !url.hostname) throw failure("manager_v2_repository_required");
  const local = new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname);
  const sslMode = String(url.searchParams.get("sslmode") || "").toLowerCase();
  if (sslMode && sslMode !== "verify-full") throw failure("manager_v2_database_tls_invalid");
  for (const parameter of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(parameter);
  let ssl = false;
  if (!local) {
    if (String(env.MANAGER_V2_DATABASE_SSL || "").toLowerCase() === "disable") throw failure("manager_v2_database_tls_invalid");
    const caPath = String(env.SUPABASE_DB_CA_CERT_PATH || "").trim();
    if (!caPath) throw failure("manager_v2_database_ca_required");
    let ca;
    try {
      ca = readFileSync(resolve(caPath), "utf8");
    } catch {
      throw failure("manager_v2_database_ca_required");
    }
    if (!ca.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----")) {
      throw failure("manager_v2_database_ca_required");
    }
    ssl = { ca, rejectUnauthorized: true };
  }
  return {
    connectionString: url.toString(),
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    query_timeout: 20_000,
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 20_000,
    ssl,
    application_name: "memphis_manager_device_auth_v2",
  };
}

export function createManagerDeviceAuthV2Pool(env = process.env) {
  return new Pool(managerDeviceAuthV2PoolConfig(env));
}

export class PostgresManagerDeviceAuthV2Repository {
  constructor({ pool, now = () => Date.now() } = {}) {
    if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function") throw failure("manager_v2_repository_required");
    this.pool = pool;
    this.now = now;
  }

  async transaction(work) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const client = await this.pool.connect();
      try {
        await client.query("begin isolation level serializable");
        await client.query("set local lock_timeout='5s'");
        await client.query("set local statement_timeout='15s'");
        await client.query("set local idle_in_transaction_session_timeout='20s'");
        const result = await work(client);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => null);
        if (retryable(error) && attempt < 2) continue;
        throw error;
      } finally {
        client.release();
      }
    }
    throw failure("manager_v2_repository_unavailable");
  }

  async claimProof(client, proof) {
    const inserted = await client.query(
      `insert into public.ops_manager_device_auth_v2_nonces(
         signing_key_id,nonce,operation_id,request_fingerprint,resource_kind,created_at,expires_at
       ) values($1,$2,$3,$4,$5,$6,$7)
       on conflict(signing_key_id,nonce) do nothing returning signing_key_id`,
      [proof.signingKeyId, proof.nonce, proof.operationId, proof.requestFingerprint,
        proof.resourceKind, proof.createdAt, proof.expiresAt],
    );
    if (inserted.rowCount === 1) return { replayed: false };
    const existing = await client.query(
      `select operation_id,request_fingerprint,resource_kind
         from public.ops_manager_device_auth_v2_nonces
        where signing_key_id=$1 and nonce=$2 for update`,
      [proof.signingKeyId, proof.nonce],
    );
    const row = existing.rows[0];
    if (!row || row.operation_id !== proof.operationId || row.resource_kind !== proof.resourceKind
        || !safeEqual(row.request_fingerprint, proof.requestFingerprint)) throw failure("manager_v2_nonce_replayed", 409);
    return { replayed: true };
  }

  async getChallengeByOperation(operationId, client = this.pool) {
    const result = await client.query(
      `select * from public.ops_manager_device_auth_v2_attestation_challenges
        where operation_id=$1 order by generation desc limit 1`,
      [operationId],
    );
    return mapChallenge(result.rows[0]);
  }

  async createOrRefreshChallenge({ candidate, proof, rateKey, activeChallengeLimit }) {
    return this.transaction(async (client) => {
      await this.claimProof(client, proof);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`manager-device-auth-v2-challenge:${candidate.operationId}`]);
      const existingResult = await client.query(
        `select * from public.ops_manager_device_auth_v2_attestation_challenges
          where operation_id=$1 order by generation desc limit 1 for update`,
        [candidate.operationId],
      );
      const existing = mapChallenge(existingResult.rows[0]);
      if (existing) {
        for (const field of ["requestFingerprint", "deviceId", "deviceLabel", "platform", "provider", "signingKeyId", "wrappingKeyId", "purpose"]) {
          if (existing[field] !== candidate[field]) throw failure("manager_v2_operation_conflict", 409);
        }
        if (existing.consumedAt) return existing;
        if (!existing.supersededAt && existing.policyVersion === candidate.policyVersion
            && Date.parse(existing.expiresAt) > Date.parse(candidate.createdAt)) return existing;
      }
      const rateResult = await client.query(
        `select * from public.ops_manager_device_auth_v2_rate_limits where key_hash=$1 for update`,
        [rateKey],
      );
      const rate = rateResult.rows[0];
      const candidateMillis = Date.parse(candidate.createdAt);
      if (rate?.locked_until && Date.parse(rate.locked_until) > candidateMillis) {
        throw failure("manager_v2_challenge_rate_limited", 429);
      }
      const requestWindowActive = rate?.request_window_started_at
        && Date.parse(rate.request_window_started_at) > candidateMillis - 15 * 60 * 1000;
      if (requestWindowActive && Number(rate.request_count || 0) >= 30) {
        throw failure("manager_v2_challenge_rate_limited", 429);
      }
      const active = await client.query(
        `select count(*)::integer as count
           from public.ops_manager_device_auth_v2_attestation_challenges
          where consumed_at is null and superseded_at is null and expires_at>$1 and operation_id<>$2`,
        [candidate.createdAt, candidate.operationId],
      );
      if (Number(active.rows[0]?.count || 0) >= activeChallengeLimit) throw failure("manager_v2_challenge_capacity", 503);
      const perKey = await client.query(
        `select count(*)::integer as count
           from public.ops_manager_device_auth_v2_attestation_challenges
          where rate_key_hash=$1 and consumed_at is null and superseded_at is null and expires_at>$2 and operation_id<>$3`,
        [rateKey, candidate.createdAt, candidate.operationId],
      );
      if (Number(perKey.rows[0]?.count || 0) >= 10) throw failure("manager_v2_challenge_rate_limited", 429);
      await client.query(
        `insert into public.ops_manager_device_auth_v2_rate_limits(
           key_hash,failure_count,first_failed_at,last_failed_at,locked_until,
           request_count,request_window_started_at,last_request_at
         ) values($1,0,$2,$2,null,1,$2,$2)
         on conflict(key_hash) do update set
           request_count=case
             when public.ops_manager_device_auth_v2_rate_limits.request_window_started_at is null
               or public.ops_manager_device_auth_v2_rate_limits.request_window_started_at<=$2::timestamptz-interval '15 minutes'
             then 1 else public.ops_manager_device_auth_v2_rate_limits.request_count+1 end,
           request_window_started_at=case
             when public.ops_manager_device_auth_v2_rate_limits.request_window_started_at is null
               or public.ops_manager_device_auth_v2_rate_limits.request_window_started_at<=$2::timestamptz-interval '15 minutes'
             then $2 else public.ops_manager_device_auth_v2_rate_limits.request_window_started_at end,
           last_request_at=$2`,
        [rateKey, candidate.createdAt],
      );
      if (existing && !existing.supersededAt) {
        await client.query(
          `update public.ops_manager_device_auth_v2_attestation_challenges
              set superseded_at=$2
            where challenge_id=$1 and consumed_at is null and superseded_at is null`,
          [existing.challengeId, candidate.createdAt],
        );
      }
      const generation = (existing?.generation || 0) + 1;
      const inserted = await client.query(
        `insert into public.ops_manager_device_auth_v2_attestation_challenges(
           challenge_id,operation_id,generation,purpose,request_fingerprint,rate_key_hash,device_id,device_label,
           platform,provider,signing_key_id,signing_public_key_jwk,wrapping_key_id,wrapping_public_key_jwk,
           proof_nonce,policy_version,created_at,expires_at
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14::jsonb,$15,$16,$17,$18)
         returning *`,
        [candidate.challengeId, candidate.operationId, generation, candidate.purpose, candidate.requestFingerprint,
          rateKey, candidate.deviceId, candidate.deviceLabel, candidate.platform, candidate.provider,
          candidate.signingKeyId, JSON.stringify(candidate.signingPublicKeyJwk), candidate.wrappingKeyId,
          JSON.stringify(candidate.wrappingPublicKeyJwk), candidate.proofNonce, candidate.policyVersion,
          candidate.createdAt, candidate.expiresAt],
      );
      return mapChallenge(inserted.rows[0]);
    });
  }

  async resolveEnrollmentCode({ codeHash, nowMillis, rateKey }) {
    return this.transaction(async (client) => {
      const at = new Date(nowMillis).toISOString();
      const rate = await client.query(
        "select * from public.ops_manager_device_auth_v2_rate_limits where key_hash=$1 for update",
        [rateKey],
      );
      if (rate.rows[0]?.locked_until && Date.parse(rate.rows[0].locked_until) > nowMillis) throw failure("manager_v2_enrollment_rate_limited", 429);
      const code = await client.query(
        `select c.*,m.roles,m.active as manager_active,m.revoked_at as manager_revoked_at,m.is_system_principal
           from public.ops_manager_enrollment_codes c
           join public.ops_manager_managers m on m.manager_id=c.manager_id
          where c.code_hash=$1 for update of c,m`,
        [codeHash],
      );
      const row = code.rows[0];
      const valid = row && row.status === "active" && !row.consumed_at && !row.revoked_at
        && Date.parse(row.expires_at) > nowMillis && row.manager_active === true && !row.manager_revoked_at
        && row.is_system_principal === false && Array.isArray(row.roles) && row.roles.includes(row.role_snapshot);
      if (!valid) {
        await client.query(
          `insert into public.ops_manager_device_auth_v2_rate_limits(key_hash,failure_count,first_failed_at,last_failed_at,locked_until)
           values($1,1,$2,$2,null)
           on conflict(key_hash) do update set
             failure_count=case when public.ops_manager_device_auth_v2_rate_limits.first_failed_at<$2::timestamptz-interval '15 minutes'
               then 1 else least(public.ops_manager_device_auth_v2_rate_limits.failure_count+1,1000) end,
             first_failed_at=case when public.ops_manager_device_auth_v2_rate_limits.first_failed_at<$2::timestamptz-interval '15 minutes'
               then $2 else public.ops_manager_device_auth_v2_rate_limits.first_failed_at end,
             last_failed_at=$2,
             locked_until=case when public.ops_manager_device_auth_v2_rate_limits.failure_count+1>=5
               then $2::timestamptz+interval '15 minutes' else null end`,
          [rateKey, at],
        );
        return null;
      }
      return { codeId: row.id, managerId: row.manager_id, roleSnapshot: row.role_snapshot, managerRoles: row.roles };
    });
  }

  async getAttestationVerification(challengeId, evidenceDigest, client = this.pool) {
    const result = await client.query(
      `select result_json from public.ops_manager_device_auth_v2_attestation_verifications
        where challenge_id=$1 and evidence_digest=$2`,
      [challengeId, evidenceDigest],
    );
    return result.rows[0]?.result_json || null;
  }

  async getRecoveryProofAuthority({ deviceId, platform, at }, client = this.pool) {
    const result = await client.query(
      `select i.installation_id,g.key_generation_id,g.signing_key_id,g.signing_public_key_jwk,
              g.wrapping_key_id,g.wrapping_public_key_jwk
         from public.ops_manager_trusted_devices d
         join public.ops_manager_managers m on m.manager_id=d.manager_id
         join public.ops_manager_device_auth_v2_installations i
           on i.installation_id=d.manager_v2_installation_id and i.status='active' and i.platform=$2
         join public.ops_manager_device_auth_v2_key_generations g
           on g.key_generation_id=i.current_key_generation_id and g.status='active'
        where d.device_id=$1 and d.auth_contract_version='manager-device-auth.v2'
          and d.revoked_at is null and d.expires_at>$3 and m.active=true and m.revoked_at is null`,
      [deviceId, platform, at],
    );
    if (result.rowCount !== 1) return null;
    const row = result.rows[0];
    return {
      installationId: row.installation_id,
      keyGenerationId: row.key_generation_id,
      signingKeyId: row.signing_key_id,
      signingPublicKeyJwk: row.signing_public_key_jwk,
      wrappingKeyId: row.wrapping_key_id,
      wrappingPublicKeyJwk: row.wrapping_public_key_jwk,
    };
  }

  async recordAttestationVerification(candidate) {
    return this.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`manager-device-auth-v2-verification:${candidate.challengeId}:${candidate.evidenceDigest}`]);
      const existing = await this.getAttestationVerification(candidate.challengeId, candidate.evidenceDigest, client);
      if (existing) return existing;
      await client.query(
        `insert into public.ops_manager_device_auth_v2_attestation_verifications(
           verification_id,challenge_id,evidence_digest,provider,app_id,result_json,verified_at,retain_until
         ) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
        [candidate.verificationId, candidate.challengeId, candidate.evidenceDigest, candidate.provider,
          candidate.appId, JSON.stringify(candidate.result), candidate.verifiedAt, candidate.retainUntil],
      );
      return structuredClone(candidate.result);
    });
  }

  async getRecoveryInstallation({ managerId, deviceId, platform, provider, appId, keyId, at }, client = this.pool) {
    const result = await client.query(
      `select i.*,g.key_generation_id,g.signing_key_id,g.signing_public_key_jwk,g.wrapping_key_id,g.wrapping_public_key_jwk
         from public.ops_manager_device_auth_v2_installations i
         join public.ops_manager_device_auth_v2_key_generations g on g.key_generation_id=i.current_key_generation_id and g.status='active'
        where i.manager_id=$1 and i.device_id=$2 and i.platform=$3 and i.provider=$4 and i.app_id=$5
          and i.status='active' and ($6::text is null or i.key_id=$6)`,
      [managerId, deviceId, platform, provider, appId, keyId],
    );
    const row = result.rows[0];
    if (!row || Date.parse(row.verified_at) > Date.parse(at) + 600_000) return null;
    return {
      installationId: row.installation_id,
      managerId: row.manager_id,
      deviceId: row.device_id,
      platform: row.platform,
      signingKeyId: row.signing_key_id,
      wrappingKeyId: row.wrapping_key_id,
      attestation: {
        provider: row.provider,
        appId: row.app_id,
        policyVersion: row.policy_version,
        verifiedAt: iso(row.verified_at),
        keyId: row.key_id,
        publicKeySpki: row.public_key_spki,
        receipt: row.receipt,
        assertionCounter: Number(row.assertion_counter || 0),
        validationCategory: row.validation_category,
        bundleVersion: row.bundle_version,
      },
    };
  }

  async getOperation(operationId, client = this.pool) {
    const result = await client.query(
      `select o.*,c.role_snapshot,g.signing_key_id,g.signing_public_key_jwk,g.wrapping_key_id,g.wrapping_public_key_jwk
         from public.ops_manager_device_auth_v2_operations o
         join public.ops_manager_enrollment_codes c on c.id=o.enrollment_code_id
         join public.ops_manager_device_auth_v2_key_generations g on g.key_generation_id=o.key_generation_id
        where o.operation_id=$1`,
      [operationId],
    );
    return mapOperation(result.rows[0]);
  }

  async createOrReplayEnrollment({ candidate, proof }) {
    return this.transaction(async (client) => {
      await this.claimProof(client, proof);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`manager-device-auth-v2-operation:${candidate.operationId}`]);
      const existing = await this.getOperation(candidate.operationId, client);
      if (existing) {
        for (const field of ["requestFingerprint", "deviceId", "managerId", "signingKeyId", "wrappingKeyId", "attestationEvidenceDigest"]) {
          if (existing[field] !== candidate[field]) throw failure("manager_v2_operation_conflict", 409);
        }
        return existing;
      }
      const challengeResult = await client.query(
        `select * from public.ops_manager_device_auth_v2_attestation_challenges
          where challenge_id=$1 for update`,
        [candidate.attestationChallengeId],
      );
      const challenge = mapChallenge(challengeResult.rows[0]);
      if (!challenge || challenge.operationId !== candidate.operationId || challenge.purpose !== candidate.flow
          || challenge.deviceId !== candidate.deviceId || challenge.platform !== candidate.platform
          || challenge.signingKeyId !== candidate.signingKeyId || challenge.wrappingKeyId !== candidate.wrappingKeyId
          || challenge.policyVersion !== candidate.attestationPolicyVersion
          || challenge.consumedAt || challenge.supersededAt
          || Date.parse(challenge.expiresAt) <= Date.parse(candidate.createdAt)) throw failure("manager_v2_attestation_invalid", 401);
      const codeResult = await client.query(
        `select c.*,m.roles,m.active as manager_active,m.revoked_at as manager_revoked_at,m.is_system_principal
           from public.ops_manager_enrollment_codes c
           join public.ops_manager_managers m on m.manager_id=c.manager_id
          where c.id=$1 for update of c,m`,
        [candidate.codeId],
      );
      const code = codeResult.rows[0];
      if (!code || !safeEqual(code.code_hash, candidate.codeHash) || code.manager_id !== candidate.managerId
          || code.status !== "active" || code.consumed_at || code.revoked_at
          || Date.parse(code.expires_at) <= Date.parse(candidate.createdAt) || code.manager_active !== true
          || code.manager_revoked_at || code.is_system_principal !== false || !code.roles.includes(code.role_snapshot)
          || JSON.stringify(canonicalRoles(code.roles)) !== JSON.stringify(candidate.managerRoles)) throw failure("manager_v2_invalid_enrollment", 401);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`manager-device-auth-binding:${candidate.deviceId}`]);
      if (candidate.flow === "enroll") {
        await client.query(
          `insert into public.ops_manager_device_auth_v2_installations(
             installation_id,manager_id,device_id,platform,provider,app_id,policy_version,verified_at,
             key_id,public_key_spki,receipt,assertion_counter,validation_category,bundle_version,status,
             created_at,updated_at,metadata_json
           ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending',$15,$15,
             jsonb_build_object('enrollment_operation_id',$16::text))`,
          [candidate.installationId, candidate.managerId, candidate.deviceId, candidate.platform,
            candidate.attestationProvider, candidate.attestationAppId, candidate.attestationPolicyVersion,
            candidate.attestationVerifiedAt, candidate.attestationKeyId, candidate.attestationPublicKeySpki,
            candidate.attestationReceipt, candidate.attestationAssertionCounter, candidate.attestationValidationCategory,
            candidate.attestationBundleVersion, candidate.createdAt, candidate.operationId],
        );
      } else {
        const installation = await client.query(
          `select i.*,g.signing_key_id as current_signing_key_id
             from public.ops_manager_device_auth_v2_installations i
             join public.ops_manager_device_auth_v2_key_generations g
               on g.key_generation_id=i.current_key_generation_id and g.status='active'
            where i.installation_id=$1 for update of i,g`,
          [candidate.installationId],
        );
        const row = installation.rows[0];
        if (!row || row.status !== "active" || row.manager_id !== candidate.managerId || row.device_id !== candidate.deviceId
            || row.platform !== candidate.platform || row.provider !== candidate.attestationProvider
            || row.app_id !== candidate.attestationAppId
            || (row.provider === "apple_app_attest" && row.key_id !== candidate.attestationKeyId)) {
          throw failure("manager_v2_invalid_enrollment", 401);
        }
        const recoveryProof = await client.query(
          `select signing_key_id
             from public.ops_manager_device_auth_v2_nonces
            where nonce=$1 and operation_id=$2 and request_fingerprint=$3 and resource_kind='challenge'`,
          [challenge.proofNonce, challenge.operationId, challenge.requestFingerprint],
        );
        if (recoveryProof.rowCount !== 1 || recoveryProof.rows[0].signing_key_id !== row.current_signing_key_id) {
          throw failure("manager_v2_authority_revoked", 403);
        }
        if (row.provider === "apple_app_attest") {
          const advanced = await client.query(
            `update public.ops_manager_device_auth_v2_installations
                set assertion_counter=$2,verified_at=$3,policy_version=$4,validation_category=$5,
                    bundle_version=$6,updated_at=$3
              where installation_id=$1 and assertion_counter<$2 returning installation_id`,
            [candidate.installationId, candidate.attestationAssertionCounter, candidate.attestationVerifiedAt,
              candidate.attestationPolicyVersion, candidate.attestationValidationCategory,
              candidate.attestationBundleVersion],
          );
          if (advanced.rowCount !== 1) throw failure("manager_v2_attestation_replayed", 409);
        } else {
          await client.query(
            `update public.ops_manager_device_auth_v2_installations
                set verified_at=$2,policy_version=$3,updated_at=$2
              where installation_id=$1`,
            [candidate.installationId, candidate.attestationVerifiedAt, candidate.attestationPolicyVersion],
          );
        }
      }
      await client.query(
        `insert into public.ops_manager_device_auth_v2_key_generations(
           key_generation_id,installation_id,operation_id,signing_key_id,signing_public_key_jwk,
           wrapping_key_id,wrapping_public_key_jwk,status,created_at,updated_at,retain_until
         ) values($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,'pending',$8,$8,$9)`,
        [candidate.keyGenerationId, candidate.installationId, candidate.operationId, candidate.signingKeyId,
          JSON.stringify(candidate.signingPublicKeyJwk), candidate.wrappingKeyId,
          JSON.stringify(candidate.wrappingPublicKeyJwk), candidate.createdAt, candidate.retainUntil],
      );
      const envelope = candidate.resultEnvelope;
      await client.query(
        `insert into public.ops_manager_device_auth_v2_operations(
           operation_id,flow,status,request_fingerprint,proof_nonce,device_id,device_label,platform,manager_id,
           manager_roles,enrollment_code_id,installation_id,key_generation_id,credential_id,credential_verifier,
           credential_expires_at,resume_expires_at,signing_key_id,signing_public_key_jwk,wrapping_key_id,
           wrapping_public_key_jwk,requested_access_level,granted_access_level,attestation_challenge_id,
           attestation_provider,attestation_app_id,attestation_policy_version,attestation_evidence_digest,
           attestation_verified_at,attestation_key_id,attestation_public_key_spki,attestation_receipt,
           attestation_assertion_counter,attestation_validation_category,attestation_bundle_version,
           envelope_algorithm,envelope_ephemeral_public_key_jwk,envelope_ephemeral_key_id,envelope_salt,
           envelope_iv,envelope_ciphertext,envelope_tag,created_at,updated_at,retain_until,metadata_json
         ) values(
           $1,$2,'pending_confirmation',$3,$4,$5,$6,$7,$8,$9::text[],$10,$11,$12,$13,$14,$15,$16,
           $17,$18::jsonb,$19,$20::jsonb,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,
           $35,$36::jsonb,$37,$38,$39,$40,$41,$42,$42,$43,
           jsonb_build_object('credential_material','sealed_to_device_wrapping_key','code_fingerprint','server_hmac_only'))`,
        [candidate.operationId, candidate.flow, candidate.requestFingerprint, candidate.proofNonce,
          candidate.deviceId, candidate.deviceLabel, candidate.platform, candidate.managerId, candidate.managerRoles,
          candidate.codeId, candidate.installationId, candidate.keyGenerationId, candidate.credentialId,
          candidate.credentialVerifier, candidate.credentialExpiresAt, candidate.resumeExpiresAt,
          candidate.signingKeyId, JSON.stringify(candidate.signingPublicKeyJwk), candidate.wrappingKeyId,
          JSON.stringify(candidate.wrappingPublicKeyJwk), candidate.requestedAccessLevel, candidate.grantedAccessLevel,
          candidate.attestationChallengeId, candidate.attestationProvider, candidate.attestationAppId,
          candidate.attestationPolicyVersion, candidate.attestationEvidenceDigest, candidate.attestationVerifiedAt,
          candidate.attestationKeyId, candidate.attestationPublicKeySpki, candidate.attestationReceipt,
          candidate.attestationAssertionCounter, candidate.attestationValidationCategory, candidate.attestationBundleVersion,
          envelope.algorithm, JSON.stringify(envelope.ephemeral_public_key_jwk), envelope.ephemeral_key_id,
          envelope.salt, envelope.iv, envelope.ciphertext, envelope.tag, candidate.createdAt, candidate.retainUntil],
      );
      await client.query(
        `update public.ops_manager_device_auth_v2_attestation_challenges
            set consumed_at=$2,consumed_evidence_digest=$3
          where challenge_id=$1 and consumed_at is null and superseded_at is null`,
        [candidate.attestationChallengeId, candidate.createdAt, candidate.attestationEvidenceDigest],
      );
      await client.query(
        `update public.ops_manager_enrollment_codes
            set status='pending_confirmation',reserved_operation_id=$2,reserved_at=$3,
                metadata_json=metadata_json||jsonb_build_object('manager_device_auth_v2_operation_id',$2::uuid)
          where id=$1`,
        [candidate.codeId, candidate.operationId, candidate.createdAt],
      );
      await client.query(
        `insert into public.ops_manager_auth_events(credential_id,device_id,event_type,success,detail_json)
         values(null,$1,'manager_device_auth_v2_operation_created',true,
           jsonb_build_object('operation_id',$2::uuid,'manager_id',$3::uuid,'installation_id',$4::uuid,'flow',$5::text))`,
        [candidate.deviceId, candidate.operationId, candidate.managerId, candidate.installationId, candidate.flow],
      );
      return this.getOperation(candidate.operationId, client);
    });
  }

  async recordActionProof(proof) {
    return this.transaction(async (client) => this.claimProof(client, proof));
  }

  async revokeCredentialSet(client, credentialIds, at, reason) {
    if (!credentialIds.length) return { push: 0, jobs: 0, sessions: 0 };
    const push = await client.query(
      `update public.ops_manager_push_devices
          set enabled=false,revoked_at=coalesce(revoked_at,$2),updated_at=$2,last_error=$3
        where credential_id=any($1::uuid[]) and (enabled=true or revoked_at is null)
        returning push_device_id`,
      [credentialIds, at, reason],
    );
    const jobs = await client.query(
      `update public.ops_manager_notification_queue
          set status='cancelled',completed_at=$2,leased_at=null,leased_until=null,lease_token=null,
              worker_id=null,updated_at=$2,last_error=$3
        where credential_id=any($1::uuid[]) and status in ('pending','leased') returning queue_id`,
      [credentialIds, at, reason],
    );
    const sessions = await client.query(
      `update public.ops_manager_device_auth_v2_sessions
          set revoked_at=coalesce(revoked_at,$2),revoked_reason=coalesce(revoked_reason,$3)
        where credential_id=any($1::uuid[]) and revoked_at is null returning session_id`,
      [credentialIds, at, reason],
    );
    return { push: push.rowCount, jobs: jobs.rowCount, sessions: sessions.rowCount };
  }

  async confirm({ operationId, credentialVerifier, at }) {
    return this.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`manager-device-auth-v2-operation:${operationId}`]);
      const operation = await this.getOperation(operationId, client);
      if (!operation) throw failure("manager_v2_operation_not_found", 404);
      if (operation.status === "confirmed") {
        const active = await client.query(
          `select credential_id from public.ops_manager_trusted_devices
            where credential_id=$1 and token_hash=$2 and revoked_at is null and expires_at>$3`,
          [operation.credentialId, credentialVerifier, at],
        );
        if (active.rowCount !== 1) throw failure("manager_v2_credential_mismatch", 401);
        return operation;
      }
      if (operation.status !== "pending_confirmation") throw failure(`manager_v2_operation_${operation.status}`, 409);
      if (!safeEqual(operation.credentialVerifier, credentialVerifier)) throw failure("manager_v2_credential_mismatch", 401);
      if (Date.parse(operation.resumeExpiresAt) <= Date.parse(at)) throw failure("manager_v2_operation_expired", 409);
      const authority = await client.query(
        `select c.*,m.roles,m.active as manager_active,m.revoked_at as manager_revoked_at,m.is_system_principal,
                i.status as installation_status,g.status as generation_status
           from public.ops_manager_enrollment_codes c
           join public.ops_manager_managers m on m.manager_id=c.manager_id
           join public.ops_manager_device_auth_v2_installations i on i.installation_id=$2
           join public.ops_manager_device_auth_v2_key_generations g on g.key_generation_id=$3
          where c.id=$1 for update of c,m,i,g`,
        [operation.codeId, operation.installationId, operation.keyGenerationId],
      );
      const row = authority.rows[0];
      if (!row || row.status !== "pending_confirmation" || row.reserved_operation_id !== operationId
          || row.consumed_at || row.revoked_at || row.manager_active !== true || row.manager_revoked_at
          || row.is_system_principal !== false || row.generation_status !== "pending"
          || JSON.stringify(canonicalRoles(row.roles)) !== JSON.stringify(operation.managerRoles)
          || (operation.flow === "enroll" && row.installation_status !== "pending")
          || (operation.flow === "recover" && row.installation_status !== "active")) {
        throw failure("manager_v2_authority_revoked", 403);
      }
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`manager-device-auth-binding:${operation.deviceId}`]);
      const revoked = await client.query(
        `update public.ops_manager_trusted_devices
            set revoked_at=$2,revoked_reason='superseded_by_manager_device_auth_v2',authority_epoch=authority_epoch+1
          where device_id=$1 and revoked_at is null returning credential_id,manager_v2_installation_id`,
        [operation.deviceId, at],
      );
      const revokedIds = revoked.rows.map((item) => item.credential_id);
      await this.revokeCredentialSet(client, revokedIds, at, "credential_superseded");
      if (revokedIds.length) {
        await client.query(
          `update public.ops_manager_device_auth_v2_credential_installations
              set unlinked_at=$2,unlinked_reason='credential_superseded'
            where credential_id=any($1::uuid[]) and unlinked_at is null`,
          [revokedIds, at],
        );
      }
      if (operation.flow === "enroll") {
        const oldInstallations = [...new Set(revoked.rows.map((item) => item.manager_v2_installation_id).filter(Boolean))]
          .filter((id) => id !== operation.installationId);
        if (oldInstallations.length) {
          await client.query(
            `update public.ops_manager_device_auth_v2_installations
                set status='retired',retired_at=$2,retired_reason='device_reassigned',updated_at=$2
              where installation_id=any($1::uuid[]) and status<>'retired'`,
            [oldInstallations, at],
          );
          await client.query(
            `update public.ops_manager_device_auth_v2_key_generations
                set status='retired',retired_at=$2,retired_reason='device_reassigned',updated_at=$2
              where installation_id=any($1::uuid[]) and status<>'retired'`,
            [oldInstallations, at],
          );
        }
      }
      await client.query(
        `update public.ops_manager_device_auth_v2_key_generations
            set status='retired',retired_at=$2,retired_reason='transport_keys_rotated',updated_at=$2
          where installation_id=$1 and status='active' and key_generation_id<>$3`,
        [operation.installationId, at, operation.keyGenerationId],
      );
      await client.query(
        `update public.ops_manager_device_auth_v2_key_generations
            set status='active',activated_at=$2,updated_at=$2
          where key_generation_id=$1 and status='pending'`,
        [operation.keyGenerationId, at],
      );
      await client.query(
        `update public.ops_manager_device_auth_v2_installations
            set status='active',current_key_generation_id=$2,activated_at=coalesce(activated_at,$3),updated_at=$3
          where installation_id=$1`,
        [operation.installationId, operation.keyGenerationId, at],
      );
      await client.query(
        `insert into public.ops_manager_trusted_devices(
           credential_id,device_id,device_label,token_hash,max_access_level,manager_id,manager_enrollment_code_id,
           platform_summary,expires_at,last_used_at,metadata_json,auth_contract_version,authority_epoch,
           signing_key_id,wrapping_key_id,attestation_provider,attestation_app_id,attestation_policy_version,
           attestation_verified_at,manager_v2_installation_id
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
           jsonb_build_object('enrollment_source','manager_device_auth_v2','operation_id',$11::uuid,'role_snapshot',$12::text),
           'manager-device-auth.v2',1,$13,$14,$15,$16,$17,$18,$19)`,
        [operation.credentialId, operation.deviceId, operation.deviceLabel, credentialVerifier,
          operation.grantedAccessLevel, operation.managerId, operation.codeId, operation.platform,
          operation.credentialExpiresAt, at, operation.operationId, operation.roleSnapshot,
          operation.signingKeyId, operation.wrappingKeyId, operation.attestationProvider,
          operation.attestationAppId, operation.attestationPolicyVersion, operation.attestationVerifiedAt,
          operation.installationId],
      );
      await client.query(
        `insert into public.ops_manager_device_auth_v2_credential_installations(
           credential_id,installation_id,linked_at
         ) values($1,$2,$3)`,
        [operation.credentialId, operation.installationId, at],
      );
      await client.query(
        `update public.ops_manager_enrollment_codes
            set status='used',consumed_at=$2,consumed_credential_id=$3,consumed_device_id=$4,
                reserved_operation_id=null,reserved_at=null
          where id=$1`,
        [operation.codeId, at, operation.credentialId, operation.deviceId],
      );
      await client.query(
        `update public.ops_manager_device_auth_v2_operations
            set status='confirmed',credential_verifier=null,envelope_algorithm=null,
                envelope_ephemeral_public_key_jwk=null,envelope_ephemeral_key_id=null,envelope_salt=null,
                envelope_iv=null,envelope_ciphertext=null,envelope_tag=null,confirmed_at=$2,updated_at=$2
          where operation_id=$1`,
        [operationId, at],
      );
      await client.query("update public.ops_manager_managers set last_access_at=$2 where manager_id=$1", [operation.managerId, at]);
      await client.query(
        `insert into public.ops_manager_auth_events(credential_id,device_id,event_type,success,detail_json)
         values($1,$2,'manager_device_auth_v2_operation_confirmed',true,
           jsonb_build_object('operation_id',$3::uuid,'manager_id',$4::uuid,'installation_id',$5::uuid,'revoked_credentials',$6::integer))`,
        [operation.credentialId, operation.deviceId, operationId, operation.managerId,
          operation.installationId, revokedIds.length],
      );
      return this.getOperation(operationId, client);
    });
  }

  async terminatePendingOperation(client, operation, status, at) {
    const timestampColumn = status === "cancelled" ? "cancelled_at" : "expired_at";
    const codeStatus = status === "cancelled" ? "revoked" : "expired";
    await client.query(
      `update public.ops_manager_device_auth_v2_operations
          set status=$2,credential_verifier=null,envelope_algorithm=null,envelope_ephemeral_public_key_jwk=null,
              envelope_ephemeral_key_id=null,envelope_salt=null,envelope_iv=null,envelope_ciphertext=null,
              envelope_tag=null,${timestampColumn}=$3,updated_at=$3
        where operation_id=$1`,
      [operation.operationId, status, at],
    );
    await client.query(
      `update public.ops_manager_enrollment_codes
          set status=$2,reserved_operation_id=null,reserved_at=null,
              revoked_at=case when $2='revoked' then coalesce(revoked_at,$3) else revoked_at end,
              revoked_reason=case when $2='revoked' then coalesce(revoked_reason,'manager_device_auth_v2_cancelled') else revoked_reason end
        where id=$1 and reserved_operation_id=$4`,
      [operation.codeId, codeStatus, at, operation.operationId],
    );
    await client.query(
      `update public.ops_manager_device_auth_v2_key_generations
          set status='retired',retired_at=$2,retired_reason=$3,updated_at=$2
        where key_generation_id=$1 and status='pending'`,
      [operation.keyGenerationId, at, `operation_${status}`],
    );
    if (operation.flow === "enroll") {
      await client.query(
        `update public.ops_manager_device_auth_v2_installations
            set status='retired',retired_at=$2,retired_reason=$3,updated_at=$2
          where installation_id=$1 and status='pending'`,
        [operation.installationId, at, `operation_${status}`],
      );
    }
  }

  async cancel({ operationId, at }) {
    return this.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`manager-device-auth-v2-operation:${operationId}`]);
      const operation = await this.getOperation(operationId, client);
      if (!operation) throw failure("manager_v2_operation_not_found", 404);
      if (operation.status === "confirmed") throw failure("manager_v2_operation_confirmed", 409);
      if (operation.status !== "pending_confirmation") return operation;
      await this.terminatePendingOperation(client, operation, "cancelled", at);
      await client.query(
        `insert into public.ops_manager_auth_events(credential_id,device_id,event_type,success,detail_json)
         values(null,$1,'manager_device_auth_v2_operation_cancelled',true,jsonb_build_object('operation_id',$2::uuid,'manager_id',$3::uuid))`,
        [operation.deviceId, operationId, operation.managerId],
      );
      return this.getOperation(operationId, client);
    });
  }

  async expire({ operationId, at }) {
    return this.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`manager-device-auth-v2-operation:${operationId}`]);
      const operation = await this.getOperation(operationId, client);
      if (!operation) throw failure("manager_v2_operation_not_found", 404);
      if (operation.status !== "pending_confirmation" || Date.parse(operation.resumeExpiresAt) > Date.parse(at)) return operation;
      await this.terminatePendingOperation(client, operation, "expired", at);
      return this.getOperation(operationId, client);
    });
  }

  async authenticateCredential({ credentialId, credentialVerifier, deviceId }, client = this.pool) {
    const result = await client.query(
      `select d.*,d.signing_key_id as credential_signing_key_id,d.wrapping_key_id as credential_wrapping_key_id,
              m.display_name as manager_display_name,m.roles as manager_roles,m.active as manager_active,
              m.revoked_at as manager_revoked_at,i.installation_id,i.platform,i.provider,i.app_id,i.policy_version,
              i.verified_at,i.key_id,i.public_key_spki,i.receipt,i.assertion_counter,i.validation_category,
              i.bundle_version,g.key_generation_id,g.signing_key_id,g.signing_public_key_jwk,
              g.wrapping_key_id,g.wrapping_public_key_jwk
         from public.ops_manager_trusted_devices d
         join public.ops_manager_managers m on m.manager_id=d.manager_id
         join public.ops_manager_device_auth_v2_installations i
           on i.installation_id=d.manager_v2_installation_id and i.status='active'
         join public.ops_manager_device_auth_v2_key_generations g
           on g.key_generation_id=i.current_key_generation_id and g.status='active'
        where d.credential_id=$1 and d.device_id=$2 and d.token_hash=$3
          and d.auth_contract_version='manager-device-auth.v2'`,
      [credentialId, deviceId, credentialVerifier],
    );
    const row = result.rows[0];
    if (!row || row.revoked_at || Date.parse(row.expires_at) <= this.now() || row.manager_active !== true
        || row.manager_revoked_at || row.credential_signing_key_id !== row.signing_key_id
        || row.credential_wrapping_key_id !== row.wrapping_key_id) return null;
    return {
      credentialId: row.credential_id,
      credentialVerifier: row.token_hash,
      installationId: row.installation_id,
      keyGenerationId: row.key_generation_id,
      deviceId: row.device_id,
      managerId: row.manager_id,
      managerDisplayName: row.manager_display_name,
      managerRoles: row.manager_roles,
      maximumAccessLevel: row.max_access_level,
      authorityEpoch: Number(row.authority_epoch),
      signingKeyId: row.signing_key_id,
      signingPublicKeyJwk: row.signing_public_key_jwk,
      wrappingKeyId: row.wrapping_key_id,
      wrappingPublicKeyJwk: row.wrapping_public_key_jwk,
      platform: row.platform,
      attestation: {
        provider: row.provider,
        appId: row.app_id,
        policyVersion: row.policy_version,
        verifiedAt: iso(row.verified_at),
        keyId: row.key_id,
        publicKeySpki: row.public_key_spki,
        receipt: row.receipt,
        assertionCounter: Number(row.assertion_counter || 0),
        validationCategory: row.validation_category,
        bundleVersion: row.bundle_version,
      },
    };
  }

  async getSession(operationId, client = this.pool) {
    const result = await client.query(
      `select s.*,g.wrapping_key_id
         from public.ops_manager_device_auth_v2_sessions s
         join public.ops_manager_device_auth_v2_key_generations g on g.key_generation_id=s.key_generation_id
        where s.operation_id=$1`,
      [operationId],
    );
    return mapSession(result.rows[0]);
  }

  async createOrReplaySession({ candidate, proof }) {
    return this.transaction(async (client) => {
      await this.claimProof(client, proof);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`manager-device-auth-v2-session:${candidate.operationId}`]);
      const existing = await this.getSession(candidate.operationId, client);
      if (existing) {
        if (!safeEqual(existing.requestFingerprint, candidate.requestFingerprint)
            || existing.credentialId !== candidate.credentialId
            || existing.attestationEvidenceDigest !== candidate.attestationEvidenceDigest
            || existing.authorityEpoch !== candidate.authorityEpoch) throw failure("manager_v2_operation_conflict", 409);
        return existing;
      }
      const authority = await client.query(
        `select d.*,m.roles,m.active as manager_active,m.revoked_at as manager_revoked_at,
                i.status as installation_status,i.current_key_generation_id,i.provider,i.key_id,i.assertion_counter,
                g.status as generation_status,g.signing_key_id,g.wrapping_key_id
           from public.ops_manager_trusted_devices d
           join public.ops_manager_managers m on m.manager_id=d.manager_id
           join public.ops_manager_device_auth_v2_installations i on i.installation_id=d.manager_v2_installation_id
           join public.ops_manager_device_auth_v2_key_generations g on g.key_generation_id=i.current_key_generation_id
          where d.credential_id=$1 for update of d,m,i,g`,
        [candidate.credentialId],
      );
      const row = authority.rows[0];
      if (!row || row.device_id !== candidate.deviceId || !safeEqual(row.token_hash, candidate.credentialVerifier)
          || row.revoked_at || Date.parse(row.expires_at) <= Date.parse(candidate.createdAt)
          || row.manager_active !== true || row.manager_revoked_at || row.installation_status !== "active"
          || row.generation_status !== "active" || row.current_key_generation_id !== candidate.keyGenerationId
          || Number(row.authority_epoch) !== candidate.authorityEpoch || row.signing_key_id !== candidate.signingKeyId
          || row.wrapping_key_id !== candidate.wrappingKeyId || row.manager_id !== candidate.managerId
          || JSON.stringify(canonicalRoles(row.roles)) !== JSON.stringify(candidate.managerRoles)) throw failure("manager_v2_authority_revoked", 403);
      const challengeResult = await client.query(
        `select * from public.ops_manager_device_auth_v2_attestation_challenges
          where challenge_id=$1 for update`,
        [candidate.attestationChallengeId],
      );
      const challenge = mapChallenge(challengeResult.rows[0]);
      if (!challenge || challenge.operationId !== candidate.operationId || challenge.purpose !== "authorized_session"
          || challenge.deviceId !== candidate.deviceId || challenge.signingKeyId !== candidate.signingKeyId
          || challenge.wrappingKeyId !== candidate.wrappingKeyId
          || challenge.policyVersion !== candidate.attestationPolicyVersion
          || challenge.consumedAt || challenge.supersededAt
          || Date.parse(challenge.expiresAt) <= Date.parse(candidate.createdAt)) throw failure("manager_v2_attestation_invalid", 401);
      if (candidate.attestationProvider === "apple_app_attest") {
        if (row.provider !== "apple_app_attest" || row.key_id !== candidate.attestationKeyId
            || candidate.assertionCounter <= Number(row.assertion_counter)) throw failure("manager_v2_attestation_replayed", 409);
        const advanced = await client.query(
          `update public.ops_manager_device_auth_v2_installations
              set assertion_counter=$2,verified_at=$3,policy_version=$4,validation_category=$5,
                  bundle_version=$6,updated_at=$3
            where installation_id=$1 and assertion_counter<$2 returning installation_id`,
          [candidate.installationId, candidate.assertionCounter, candidate.attestationVerifiedAt,
            candidate.attestationPolicyVersion, candidate.attestationValidationCategory,
            candidate.attestationBundleVersion],
        );
        if (advanced.rowCount !== 1) throw failure("manager_v2_attestation_replayed", 409);
      } else {
        await client.query(
          `update public.ops_manager_device_auth_v2_installations set verified_at=$2,policy_version=$3,updated_at=$2
            where installation_id=$1`,
          [candidate.installationId, candidate.attestationVerifiedAt, candidate.attestationPolicyVersion],
        );
      }
      const envelope = candidate.resultEnvelope;
      await client.query(
        `insert into public.ops_manager_device_auth_v2_sessions(
           session_id,operation_id,request_fingerprint,proof_nonce,credential_id,installation_id,key_generation_id,
           manager_id,manager_roles,device_id,authority_epoch,requested_access_level,granted_access_level,token_hash,
           attestation_challenge_id,attestation_evidence_digest,envelope_algorithm,envelope_ephemeral_public_key_jwk,
           envelope_ephemeral_key_id,envelope_salt,envelope_iv,envelope_ciphertext,envelope_tag,created_at,expires_at,retain_until
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21,$22,$23,$24,$25,$26)`,
        [candidate.sessionId, candidate.operationId, candidate.requestFingerprint, candidate.proofNonce,
          candidate.credentialId, candidate.installationId, candidate.keyGenerationId, candidate.managerId,
          candidate.managerRoles, candidate.deviceId, candidate.authorityEpoch, candidate.requestedAccessLevel,
          candidate.grantedAccessLevel, candidate.tokenHash, candidate.attestationChallengeId,
          candidate.attestationEvidenceDigest, envelope.algorithm, JSON.stringify(envelope.ephemeral_public_key_jwk),
          envelope.ephemeral_key_id, envelope.salt, envelope.iv, envelope.ciphertext, envelope.tag,
          candidate.createdAt, candidate.expiresAt, candidate.retainUntil],
      );
      await client.query(
        `update public.ops_manager_device_auth_v2_attestation_challenges
            set consumed_at=$2,consumed_evidence_digest=$3
          where challenge_id=$1 and consumed_at is null and superseded_at is null`,
        [candidate.attestationChallengeId, candidate.createdAt, candidate.attestationEvidenceDigest],
      );
      await client.query("update public.ops_manager_trusted_devices set last_used_at=$2 where credential_id=$1", [candidate.credentialId, candidate.createdAt]);
      return this.getSession(candidate.operationId, client);
    });
  }

  async getRemoval(operationId, client = this.pool) {
    const result = await client.query(
      `select * from public.ops_manager_device_auth_v2_removal_operations where operation_id=$1`,
      [operationId],
    );
    const row = result.rows[0];
    return row ? {
      operationId: row.operation_id,
      requestFingerprint: row.request_fingerprint,
      credentialId: row.credential_id,
      credentialVerifier: row.credential_verifier,
      result: row.result_json,
    } : null;
  }

  async removeCredential({ candidate, proof }) {
    return this.transaction(async (client) => {
      await this.claimProof(client, proof);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`manager-device-auth-v2-removal:${candidate.operationId}`]);
      const replay = await this.getRemoval(candidate.operationId, client);
      if (replay) {
        if (!safeEqual(replay.requestFingerprint, candidate.requestFingerprint)
            || replay.credentialId !== candidate.credentialId
            || !safeEqual(replay.credentialVerifier, candidate.credentialVerifier)) throw failure("manager_v2_operation_conflict", 409);
        return replay.result;
      }
      const credential = await client.query(
        `select d.*,m.active as manager_active,m.revoked_at as manager_revoked_at,i.status as installation_status
           from public.ops_manager_trusted_devices d
           join public.ops_manager_managers m on m.manager_id=d.manager_id
           join public.ops_manager_device_auth_v2_installations i on i.installation_id=d.manager_v2_installation_id
          where d.credential_id=$1 for update of d,m,i`,
        [candidate.credentialId],
      );
      const row = credential.rows[0];
      if (!row || row.device_id !== candidate.deviceId || !safeEqual(row.token_hash, candidate.credentialVerifier)
          || row.auth_contract_version !== "manager-device-auth.v2" || row.manager_v2_installation_id !== candidate.installationId
          || row.revoked_at || row.installation_status !== "active") throw failure("manager_v2_credential_mismatch", 401);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`manager-device-auth-binding:${candidate.deviceId}`]);
      const revoked = await client.query(
        `update public.ops_manager_trusted_devices
            set revoked_at=$2,revoked_reason='manager_device_auth_v2_removed',authority_epoch=authority_epoch+1
          where manager_v2_installation_id=$1 and revoked_at is null returning credential_id`,
        [candidate.installationId, candidate.at],
      );
      const credentialIds = revoked.rows.map((item) => item.credential_id);
      const effects = await this.revokeCredentialSet(client, credentialIds, candidate.at, "credential_removed");
      if (credentialIds.length) {
        await client.query(
          `update public.ops_manager_device_auth_v2_credential_installations
              set unlinked_at=$2,unlinked_reason='installation_removed'
            where credential_id=any($1::uuid[]) and unlinked_at is null`,
          [credentialIds, candidate.at],
        );
      }
      await client.query(
        `update public.ops_manager_device_auth_v2_key_generations
            set status='retired',retired_at=$2,retired_reason='installation_removed',updated_at=$2
          where installation_id=$1 and status<>'retired'`,
        [candidate.installationId, candidate.at],
      );
      await client.query(
        `update public.ops_manager_device_auth_v2_installations
            set status='retired',retired_at=$2,retired_reason='credential_removed',updated_at=$2
          where installation_id=$1 and status<>'retired'`,
        [candidate.installationId, candidate.at],
      );
      const result = {
        contract_version: "manager-device-auth.v2",
        operation_id: candidate.operationId,
        status: "removed",
        credential_id: candidate.credentialId,
        device_id: candidate.deviceId,
        manager_id: row.manager_id,
        removed_at: candidate.at,
        push_registrations_deactivated: effects.push,
        notification_jobs_cancelled: effects.jobs,
        sessions_revoked: effects.sessions,
      };
      await client.query(
        `insert into public.ops_manager_device_auth_v2_removal_operations(
           operation_id,request_fingerprint,proof_nonce,credential_id,credential_verifier,installation_id,
           manager_id,device_id,status,result_json,created_at,updated_at,retain_until
         ) values($1,$2,$3,$4,$5,$6,$7,$8,'removed',$9::jsonb,$10,$10,$11)`,
        [candidate.operationId, candidate.requestFingerprint, candidate.proofNonce, candidate.credentialId,
          candidate.credentialVerifier, candidate.installationId, row.manager_id, candidate.deviceId,
          JSON.stringify(result), candidate.at, candidate.retainUntil],
      );
      await client.query(
        `insert into public.ops_manager_auth_events(credential_id,device_id,event_type,success,detail_json)
         values($1,$2,'manager_device_auth_v2_removed',true,
           jsonb_build_object('operation_id',$3::uuid,'installation_id',$4::uuid,'sessions_revoked',$5::integer,'jobs_cancelled',$6::integer))`,
        [candidate.credentialId, candidate.deviceId, candidate.operationId, candidate.installationId,
          effects.sessions, effects.jobs],
      );
      return result;
    });
  }

  async validateAuthorizedSession(candidate) {
    const result = await this.pool.query(
      `select s.*,d.manager_id as credential_manager_id,d.device_id as credential_device_id,
              d.authority_epoch as credential_authority_epoch,d.max_access_level,d.expires_at as credential_expires_at,
              d.revoked_at as credential_revoked_at,m.roles as live_manager_roles,m.active as manager_active,
              m.revoked_at as manager_revoked_at,i.status as installation_status,i.current_key_generation_id,
              g.status as generation_status
         from public.ops_manager_device_auth_v2_sessions s
         join public.ops_manager_trusted_devices d on d.credential_id=s.credential_id
         join public.ops_manager_managers m on m.manager_id=s.manager_id
         join public.ops_manager_device_auth_v2_installations i on i.installation_id=s.installation_id
         join public.ops_manager_device_auth_v2_key_generations g on g.key_generation_id=s.key_generation_id
        where s.session_id=$1`,
      [candidate.sessionId],
    );
    const row = result.rows[0];
    const at = Date.parse(candidate.at);
    const valid = row && safeEqual(row.token_hash, candidate.tokenHash)
      && row.credential_id === candidate.credentialId && row.device_id === candidate.deviceId
      && row.manager_id === candidate.managerId && Number(row.authority_epoch) === Number(candidate.authorityEpoch)
      && row.granted_access_level === candidate.accessLevel
      && JSON.stringify(row.manager_roles) === JSON.stringify(candidate.roles)
      && row.credential_manager_id === candidate.managerId && row.credential_device_id === candidate.deviceId
      && Number(row.credential_authority_epoch) === Number(candidate.authorityEpoch)
      && !row.revoked_at && !row.credential_revoked_at
      && Date.parse(row.expires_at) > at && Date.parse(row.credential_expires_at) > at
      && row.manager_active === true && !row.manager_revoked_at
      && JSON.stringify(canonicalRoles(row.live_manager_roles)) === JSON.stringify(row.manager_roles)
      && row.installation_status === "active" && row.generation_status === "active"
      && row.current_key_generation_id === row.key_generation_id;
    if (!valid) return { ok: false, status: 401 };
    return {
      ok: true,
      session: {
        session_id: row.session_id,
        credential_id: row.credential_id,
        device_id: row.device_id,
        manager_id: row.manager_id,
        authority_epoch: Number(row.authority_epoch),
        roles: row.manager_roles,
        access_level: row.granted_access_level,
        read_only: row.granted_access_level === "read_only",
      },
    };
  }

  async sweepExpired({ at = new Date(this.now()).toISOString() } = {}) {
    return this.transaction(async (client) => {
      const pending = await client.query(
        `select operation_id from public.ops_manager_device_auth_v2_operations
          where status='pending_confirmation' and resume_expires_at<=$1
          order by resume_expires_at limit 100 for update skip locked`,
        [at],
      );
      for (const row of pending.rows) {
        const operation = await this.getOperation(row.operation_id, client);
        if (operation?.status === "pending_confirmation") await this.terminatePendingOperation(client, operation, "expired", at);
      }
      const sessions = await client.query(
        `update public.ops_manager_device_auth_v2_sessions
            set revoked_at=coalesce(revoked_at,$1),revoked_reason=coalesce(revoked_reason,'session_expired')
          where revoked_at is null and expires_at<=$1 returning session_id`,
        [at],
      );
      const nonces = await client.query(
        `delete from public.ops_manager_device_auth_v2_nonces where expires_at<=$1 returning nonce`,
        [at],
      );
      const challenges = await client.query(
        `update public.ops_manager_device_auth_v2_attestation_challenges
            set superseded_at=$1
          where consumed_at is null and superseded_at is null and expires_at<=$1 returning challenge_id`,
        [at],
      );
      await client.query(
        `delete from public.ops_manager_device_auth_v2_rate_limits
          where last_failed_at<$1::timestamptz-interval '24 hours'
            and (last_request_at is null or last_request_at<$1::timestamptz-interval '24 hours')
            and (locked_until is null or locked_until<$1)`,
        [at],
      );
      return {
        operationsExpired: pending.rowCount,
        sessionsRevoked: sessions.rowCount,
        noncesDeleted: nonces.rowCount,
        challengesExpired: challenges.rowCount,
      };
    });
  }
}

export function createPostgresManagerDeviceAuthV2Repository({ env = process.env, pool = null, now } = {}) {
  return new PostgresManagerDeviceAuthV2Repository({ pool: pool || createManagerDeviceAuthV2Pool(env), now });
}
