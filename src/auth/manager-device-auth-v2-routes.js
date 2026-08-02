import crypto from "node:crypto";
import { createManagerDeviceAttestationVerifier } from "./manager-device-auth-v2-attestation.js";
import { createPostgresManagerDeviceAuthV2Repository } from "./manager-device-auth-v2-postgres.js";
import { createManagerDeviceAuthV2Service, managerV2SessionTokenVerifier } from "./manager-device-auth-v2-service.js";
import { createOpsManagerSession, getSessionSecret } from "./shared-access-auth.js";

const ROUTE_PREFIX = "/manager-device-auth/v2";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_ERROR_CODES = new Set([
  "manager_v2_attestation_invalid",
  "manager_v2_attestation_policy_denied",
  "manager_v2_attestation_replayed",
  "manager_v2_authority_revoked",
  "manager_v2_challenge_capacity",
  "manager_v2_challenge_rate_limited",
  "manager_v2_contract_version_required",
  "manager_v2_credential_mismatch",
  "manager_v2_enrollment_rate_limited",
  "manager_v2_idempotency_conflict",
  "manager_v2_invalid_action",
  "manager_v2_invalid_app_attest_key_id",
  "manager_v2_invalid_attestation",
  "manager_v2_invalid_attestation_app_id",
  "manager_v2_invalid_attestation_challenge_id",
  "manager_v2_invalid_attestation_provider",
  "manager_v2_invalid_challenge_request",
  "manager_v2_invalid_cancel_request",
  "manager_v2_invalid_code",
  "manager_v2_invalid_confirm_request",
  "manager_v2_invalid_device_credential",
  "manager_v2_invalid_device_id",
  "manager_v2_invalid_enrollment",
  "manager_v2_invalid_enrollment_request",
  "manager_v2_invalid_flow",
  "manager_v2_invalid_platform",
  "manager_v2_invalid_proof",
  "manager_v2_invalid_proof_algorithm",
  "manager_v2_invalid_purpose",
  "manager_v2_invalid_removal_request",
  "manager_v2_invalid_resume_request",
  "manager_v2_invalid_session_request",
  "manager_v2_invalid_signature",
  "manager_v2_nonce_replayed",
  "manager_v2_operation_conflict",
  "manager_v2_operation_confirmed",
  "manager_v2_operation_cancelled",
  "manager_v2_operation_expired",
  "manager_v2_operation_key_mismatch",
  "manager_v2_operation_not_found",
  "manager_v2_proof_expired",
]);

function failure(code, status = 503) {
  return Object.assign(new Error(code), { code, status });
}

function enabled(env) {
  return /^(1|true|yes|on)$/i.test(String(env.MANAGER_V2_ENABLED || "").trim());
}

function serverSecret(env) {
  const value = String(env.MANAGER_V2_SERVER_SECRET || "");
  if (Buffer.byteLength(value, "utf8") < 32) throw failure("manager_v2_server_secret_required");
  return value;
}

function idempotencyKey(req) {
  const raw = req?.headers?.["idempotency-key"];
  if (Array.isArray(raw) || typeof raw !== "string" || !UUID_PATTERN.test(raw)) {
    throw failure("manager_v2_idempotency_conflict", 409);
  }
  return raw;
}

function deviceCredential(req, { required = true } = {}) {
  const raw = req?.headers?.authorization;
  if (Array.isArray(raw) || (raw !== undefined && typeof raw !== "string")) {
    throw failure("manager_v2_invalid_device_credential", 401);
  }
  const match = /^(?:Device) ([0-9a-f-]{36}\.[A-Za-z0-9_-]{43})$/.exec(raw || "");
  if (!match && required) throw failure("manager_v2_invalid_device_credential", 401);
  return match?.[1] || "";
}

function privacyRateKey(req, secret) {
  // Express is configured to trust exactly one deployment proxy. req.ip is
  // therefore the canonical address resolved by proxy-addr; never hash the
  // attacker-controlled leftmost X-Forwarded-For value directly, and never
  // include user-agent/device-label fields that make a brute-force bucket
  // trivial to rotate.
  const ip = String(req?.ip || req?.socket?.remoteAddress || "unknown").slice(0, 200);
  return crypto.createHmac("sha256", secret)
    .update("manager-device-auth-v2:http-rate\u0000", "utf8")
    .update(ip, "utf8")
    .digest("hex");
}

function responseSecurity(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Authorization, Idempotency-Key");
}

function statusFor(error) {
  const status = Number(error?.status);
  return Number.isSafeInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function sendFailure(res, error) {
  const status = statusFor(error);
  const requestedCode = String(error?.code || "");
  const code = SAFE_ERROR_CODES.has(requestedCode)
    ? requestedCode
    : status >= 500 ? "manager_v2_unavailable" : "manager_v2_request_rejected";
  if (status === 429) res.setHeader("Retry-After", "900");
  res.status(status).json({ ok: false, code, error: "Manager device authorization failed." });
}

export function createManagerDeviceAuthV2HttpRuntime({
  env = process.env,
  pool = null,
  repository = null,
  attestationVerifier = null,
  sessionIssuer = null,
  now,
  randomBytes,
  randomUuid,
} = {}) {
  if (!enabled(env)) throw failure("manager_v2_unavailable");
  const secret = serverSecret(env);
  const enrollmentCodeSecret = getSessionSecret(env);
  if (Buffer.byteLength(enrollmentCodeSecret, "utf8") < 32) throw failure("manager_v2_session_secret_required");
  const store = repository || createPostgresManagerDeviceAuthV2Repository({ env, pool, now });
  const verifier = attestationVerifier || createManagerDeviceAttestationVerifier({ env, now });
  const issueSession = sessionIssuer || ((options) => createOpsManagerSession({ ...options, env }));
  const service = createManagerDeviceAuthV2Service({
    repository: store,
    attestationVerifier: verifier,
    sessionIssuer: issueSession,
    serverSecret: secret,
    enrollmentCodeSecret,
    now,
    randomBytes,
    randomUuid,
  });
  return Object.freeze({
    service,
    repository: store,
    serverSecret: secret,
    async close() {
      if (!repository && store?.pool?.end) await store.pool.end();
    },
  });
}

export function installManagerDeviceAuthV2Routes(app, options = {}) {
  if (!app || typeof app.post !== "function") throw failure("manager_v2_http_app_required");
  const env = options.env || process.env;
  let runtimePromise = null;
  let sweepTimer = null;

  async function runtime() {
    if (!runtimePromise) {
      runtimePromise = Promise.resolve()
        .then(() => options.runtime || createManagerDeviceAuthV2HttpRuntime(options))
        .then((value) => {
          if (!options.runtime && !sweepTimer) {
            const intervalMillis = Math.min(300_000, Math.max(30_000, Number(env.MANAGER_V2_SWEEP_INTERVAL_MS) || 60_000));
            sweepTimer = setInterval(() => {
              runtimePromise?.then((active) => active.service.sweepExpired()).catch(() => null);
            }, intervalMillis);
            sweepTimer.unref?.();
          }
          return value;
        })
        .catch((error) => {
          runtimePromise = null;
          throw error;
        });
    }
    return runtimePromise;
  }

  function route(handler) {
    return async (req, res) => {
      responseSecurity(res);
      try {
        const active = await runtime();
        const value = await handler(active, req);
        res.status(200).json(value);
      } catch (error) {
        sendFailure(res, error);
      }
    };
  }

  app.post(`${ROUTE_PREFIX}/attestation-challenges`, route(async (active, req) => {
    const purpose = String(req?.body?.purpose || "");
    return active.service.challenge(req.body, {
      idempotencyKey: idempotencyKey(req),
      rateKey: privacyRateKey(req, active.serverSecret),
      deviceCredential: deviceCredential(req, { required: purpose === "authorized_session" }),
    });
  }));
  app.post(`${ROUTE_PREFIX}/enrollment-operations`, route(async (active, req) => active.service.create(req.body, {
    idempotencyKey: idempotencyKey(req),
    rateKey: privacyRateKey(req, active.serverSecret),
  })));
  for (const action of ["resume", "confirm", "cancel"]) {
    app.post(`${ROUTE_PREFIX}/enrollment-operations/:operation_id/${action}`, route(async (active, req) => {
      if (String(req.params?.operation_id || "") !== String(req.body?.operation_id || "")) {
        throw failure("manager_v2_operation_conflict", 409);
      }
      if (idempotencyKey(req) !== req.body.operation_id) throw failure("manager_v2_idempotency_conflict", 409);
      if (action === "confirm") return active.service.confirm(req.body, deviceCredential(req));
      if (action === "cancel") return active.service.cancel(req.body);
      return active.service.resume(req.body);
    }));
  }
  app.post(`${ROUTE_PREFIX}/removal-operations`, route(async (active, req) => active.service.remove(
    req.body,
    deviceCredential(req),
    { idempotencyKey: idempotencyKey(req) },
  )));
  app.post(`${ROUTE_PREFIX}/authorized-sessions`, route(async (active, req) => active.service.authorizedSession(
    req.body,
    deviceCredential(req),
    { idempotencyKey: idempotencyKey(req) },
  )));

  return Object.freeze({
    async validateAuthorizedSession(session) {
      const active = await runtime();
      if (!active.repository || typeof active.repository.validateAuthorizedSession !== "function") {
        throw failure("manager_v2_unavailable");
      }
      return active.repository.validateAuthorizedSession({
        sessionId: session.session_id,
        credentialId: session.credential_id,
        deviceId: session.device_id,
        managerId: session.manager_id,
        authorityEpoch: session.authority_epoch,
        accessLevel: session.access_level,
        roles: session.roles,
        tokenHash: managerV2SessionTokenVerifier(active.serverSecret, session.token),
        at: new Date().toISOString(),
      });
    },
    async close() {
      if (sweepTimer) clearInterval(sweepTimer);
      sweepTimer = null;
      const active = await runtimePromise?.catch(() => null);
      if (!options.runtime) await active?.close?.();
    },
  });
}

export const managerDeviceAuthV2RouteInternals = Object.freeze({
  ROUTE_PREFIX,
  deviceCredential,
  enabled,
  idempotencyKey,
  privacyRateKey,
  sendFailure,
});
