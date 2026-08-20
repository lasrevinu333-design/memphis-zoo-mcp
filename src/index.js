import "dotenv/config";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import express from "express";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createClient } from "@supabase/supabase-js";
import {
  EVENTS_CONTRACT_VERSION,
  createEventMaintenanceController,
  createEventsAdminRouter,
  createEventsPublicRouter,
  createMessagingRouter,
  createMoxieRouter,
  createScheduleRouter,
} from "./routes/index.js";
import { APP_VERSION, RELEASE_ID } from "./app-version.js";
import { assertConfiguredReleaseIdentity, buildReleaseManifest } from "./release-manifest.js";
import { observeProductionSchemaIdentity } from "./production-schema-identity.js";
import { authenticateOpsAccessRequest, createSupabaseTrustedDeviceStore, installSharedAuthRoutes, makeOpsAccessMiddleware } from "./auth/shared-access-auth.js";
import { makeMcpConnectorMiddleware } from "./auth/mcp-connector-auth.js";
import {
  installDeviceCredentialRoutes,
  makeDeviceCredentialMiddleware,
  verifyNativeDeviceRequestAttestation,
  verifyNativeOfflineWorkAttestation,
} from "./auth/device-credential-auth.js";
import { runReadOnlySql as runSupabaseReadOnlySql } from "./supabase/read.js";
import { createGeminiConsoleRouter } from "./gemini-console-api.js";
import { createGeminiControlledRepairWorker } from "./gemini-controlled-worker.js";
import { createMcpServer as createCanonicalMcpServer } from "./mcp/create-mcp-server.js";
import { getToolManifest } from "./mcp/tool-manifest.js";
import { validateRuntimeEnv } from "./config/env.js";
import { authorityHttpFailure, deferJsonParserErrors, malformedScanAuthorityOutcome, rpcFailure, scanRpcHttpOutcome, sqlStateHttpStatus } from "./offline-authority-http.js";
import { installAnnieMoxieRoutes } from "./annie-moxie-bootstrap.js";
import { installLeadershipHttpRoutes } from "./leadership-bootstrap.js";
import { installCustodialEmployeeAdminRoutes } from "./custodial-employee-admin.js";
import { installManagerNotificationRoutes } from "./manager-notifications.js";
import { installEmployeeNotificationRoutes } from "./employee-notifications.js";
import { installOperationalAnalyticsRoutes } from "./operational-analytics-api.js";
import { normalizeAttendanceRecord, toNullableNonNegativeInteger } from "./attendance-state.js";
import { normalizeCanonicalScanEvidence } from "./scan-evidence.js";
import { buildReleaseCanaryTransportProbeCall } from "./native-phone-transport.js";
import { makeRestoreMutationGate } from "./restore-mutation-gate.js";
import {
  guestFeatureState,
  normalizeFeedbackInput,
  normalizeGuestReportInput,
  signExpiringFeedbackToken,
  verifyExpiringFeedbackToken,
} from "./public-submission-controls.js";

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  if (String(req.headers["x-forwarded-proto"] || req.protocol || "").toLowerCase() === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
// The scan authority route owns a bounded parser that exposes valid function
// identity to authentication while deferring malformed-input handling until an
// authenticated device can durably quarantine it.
const generalJsonParser = express.json({ limit: "10mb" });
app.use((req, res, next) => {
  if (req.path === "/scan-api/rpc") return next();
  return generalJsonParser(req, res, next);
});
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

const MOXIE_MOUNT_PATH = (String(process.env.MOXIE_PREFIX || "/moxie").trim() || "/moxie").replace(/\/+$/, "") || "/moxie";
const MOXIE_STATIC_DIR = fileURLToPath(new URL("../public/moxie-assets/", import.meta.url));

const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
const restoreGateRequired = process.env.NODE_ENV === "production"
  || /^(1|true|yes)$/i.test(String(process.env.CUSTODIAL_RESTORE_GATE_REQUIRED || ""));
app.use(makeRestoreMutationGate({ supabase: supabaseAdmin, required: restoreGateRequired }));
const BACKEND_COMMIT_SHA = String(
  process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || process.env.SOURCE_VERSION || "unknown"
).trim() || "unknown";
const geminiControlledRepairWorker = createGeminiControlledRepairWorker({
  supabase: supabaseAdmin,
  releaseId: RELEASE_ID,
  backendCommit: BACKEND_COMMIT_SHA,
});
geminiControlledRepairWorker.start();
const opsTrustedDeviceStore = createSupabaseTrustedDeviceStore(supabaseAdmin);

const SCAN_RPC_ALLOWLIST = new Set([
  "tool_get_system_settings",
  "tool_list_active_employees",
  "tool_get_location_scan_state",
  "tool_get_offline_scan_authority_snapshot",
  "tool_start_offline_occurrence",
  "tool_finish_session",
  "tool_complete_session",
  "tool_ping_device",
  "tool_commit_cleaning_workflow",
  "tool_report_device_sync_status",
  "tool_report_device_sync_status_v2",
  "tool_get_device_rollback_readiness",
  "tool_evaluate_location_proximity",
  "tool_evaluate_location_proximity_v2"
]);
const OFFLINE_RECOVERY_FUNCTIONS = new Set([
  "tool_start_offline_occurrence",
  "tool_commit_cleaning_workflow",
]);
const NATIVE_CUSTODIAL_ORIGINS = new Set([
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "ionic://localhost",
]);

const SCAN_CONTRACT_VERSION = "scan.v4.snapshot-bound-authority";
const DASHBOARD_CONTRACT_VERSION = "dashboard.v1";
const MESSAGING_CONTRACT_VERSION = "messaging.v5";
const SCHEDULE_CONTRACT_VERSION = "schedule.v2";
const COVERALL_ASSIGNMENTS_CONTRACT_VERSION = "coverall-assignments.v2.secure-links";
const OPERATIONAL_ANALYTICS_CONTRACT_VERSION = "operational-analytics.v1";
const GUEST_REPORTS_CONTRACT_VERSION = "guest-reports.v2.approval-gated";
const FEEDBACK_CONTRACT_VERSION = "feedback.v2.json-triage";
const OPS_MANAGER_AUTH_CONTRACT_VERSION = "ops-manager-auth.v5.named-leadership";
const GEMINI_CONSOLE_CONTRACT_VERSION = "gemini-console.v2";
const CANARY_RESTROOM_CODE = "TETM";
const CANARY_EXHIBIT_CODE = "TETX";
const HEALTH_PROBE_DEVICE_ID = "canary-check";
const ATTENDANCE_SOURCE_URL = String(process.env.ND_MEMZOO_ATTENDANCE_URL || "https://nd.memzoo.org").trim();
const ATTENDANCE_TIMEOUT_MS = toSafeInt(process.env.ND_MEMZOO_ATTENDANCE_TIMEOUT_MS, 8000);
const ATTENDANCE_CACHE_MS = toSafeInt(process.env.ND_MEMZOO_ATTENDANCE_CACHE_MS, 60000);
const ATTENDANCE_STALE_AFTER_MS = toSafeInt(process.env.ND_MEMZOO_ATTENDANCE_STALE_AFTER_MS, 60 * 60 * 1000);
const ATTENDANCE_CF_CLEARANCE = String(process.env.ND_MEMZOO_CF_CLEARANCE || "").trim();
const FEEDBACK_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const FEEDBACK_IMAGE_BUCKET = String(process.env.FEEDBACK_IMAGE_BUCKET || "system-feedback-private").trim();
const FEEDBACK_REMINDER_SWEEP_MS = toSafeNonNegativeInt(process.env.FEEDBACK_REMINDER_SWEEP_MS, 60000);
const FEEDBACK_REMINDER_MAX_COUNT = toSafeInt(process.env.FEEDBACK_REMINDER_MAX_COUNT, 3);
const FEEDBACK_LINK_TTL_MS = toSafeInt(process.env.FEEDBACK_LINK_TTL_MS, 7 * 24 * 60 * 60 * 1000);
const GUEST_FEATURE = guestFeatureState(process.env);
const OPERATIONAL_NOTIFICATION_WORKER_ID = `render-${process.pid}-${randomUUID()}`;
const OPERATIONAL_NOTIFICATION_SWEEP_MS = toSafeNonNegativeInt(process.env.OPERATIONAL_NOTIFICATION_SWEEP_MS, 15_000);
let attendanceCache = { data: null, fetched_at_ms: 0 };
let feedbackReminderSweepInFlight = false;
let feedbackSchemaEnsured = false;
let feedbackSchemaEnsurePromise = null;
let operationalNotificationWorkerInFlight = false;
const operationalNotificationJobHandlers = new Map();

function registerOperationalNotificationJobHandler(jobType, handler) {
  const normalizedType = String(jobType || "").trim();
  if (!normalizedType || typeof handler !== "function") throw new Error("A durable operational job handler is required.");
  operationalNotificationJobHandlers.set(normalizedType, handler);
}

function requireGuestIssuesApproved(req, res, next) {
  if (!GUEST_FEATURE.enabled) {
    res.status(503).json({
      ok: false,
      error: "Guest cleanliness reporting is awaiting Memphis Zoo approval.",
      code: "guest_feature_not_approved",
      feature: GUEST_FEATURE,
    });
    return;
  }
  next();
}

function requireGuestMarketingReviewAuth(req, res, next) {
  if (!GUEST_FEATURE.enabled) return requireGuestIssuesApproved(req, res, next);
  const configured = String(process.env.GUEST_MARKETING_REVIEW_SECRET || "").trim();
  if (!configured) {
    res.status(503).json({ ok: false, error: "The Memphis Zoo Marketing review integration is not configured.", code: "marketing_review_not_configured" });
    return;
  }
  const supplied = String(req.get("x-guest-marketing-review-secret") || "").trim();
  if (!supplied || !safeStringEqual(supplied, configured)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }
  req.guestMarketingReview = { actor: "marketing_review_integration" };
  next();
}

const requireOpsManagerAuth = makeOpsAccessMiddleware({ trustedDeviceStore: opsTrustedDeviceStore });
const requireOpsManagerWrite = makeOpsAccessMiddleware({ requireWrite: true, trustedDeviceStore: opsTrustedDeviceStore });
// Streamable HTTP defaults to the full connector tool set so connected ChatGPT
// sessions can read and write without a second credential prompt.
// Legacy SSE remains token-only because its follow-up /messages request uses a separate HTTP request.
const requireMcpAuth = makeMcpConnectorMiddleware();
const requireLegacyMcpAuth = makeMcpConnectorMiddleware({
  allowFullNoAuth: false,
  allowReadOnlyNoAuth: false,
});
const requireEmployeeDeviceCredential = makeDeviceCredentialMiddleware({
  supabase: supabaseAdmin,
  runReadOnlySql,
});

function requireDeviceOrOpsAccess(req, res, next) {
  const ops = authenticateOpsAccessRequest(req);
  if (ops.ok) {
    requireOpsManagerAuth(req, res, () => {
      req.memphisDevice = null;
      next();
    });
    return;
  }
  if (ops.presented) {
    res.status(ops.status || 401).json({ ok: false, error: ops.error || "Unauthorized" });
    return;
  }
  requireEmployeeDeviceCredential(req, res, next);
}

function requireScanRpcAuthorization(req, res, next) {
  const fn = String(req.body?.fn || "").trim();
  if (req.memphisDeviceAuth?.offline_recovery_only === true && !OFFLINE_RECOVERY_FUNCTIONS.has(fn)) {
    res.status(403).json({ ok: false, error: "A revoked or stale device credential may activate or submit only work bound to its frozen offline snapshot." });
    return;
  }
  if (req.memphisAuth?.read_only && !SCAN_READ_FUNCTIONS.has(fn)) {
    res.status(403).json({ ok: false, error: "Read-only Ops Manager access cannot run scan mutations." });
    return;
  }
  next();
}

// Durable public-ingest limiter. Raw IP addresses are never persisted.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

function publicSubmissionRateLimit(scope) {
  return async (req, res, next) => {
    try {
      const ip = String(req.ip || req.socket?.remoteAddress || "unknown").trim();
      const bucketKey = createHmac("sha256", getFeedbackLinkSecret()).update(`${scope}:${ip}`).digest("hex");
      await runOperationalCommand("public_rate_limit", { bucket_key: bucketKey, scope });
      const rows = await runReadOnlySql(
        `select request_count from public.public_submission_rate_limits where bucket_key=${sqlLiteral(bucketKey)} limit 1`
      );
      const count = Number(rows?.[0]?.request_count);
      if (!Number.isFinite(count) || count > RATE_LIMIT_MAX) {
        res.setHeader("Retry-After", "60");
        res.status(429).json({ ok: false, error: "Rate limit exceeded. Try again in a minute." });
        return;
      }
      next();
    } catch (error) {
      console.error(`${scope} submission rate limit failed:`, error?.message || error);
      res.status(503).json({ ok: false, error: "Submission protection is temporarily unavailable." });
    }
  };
}

// Purge stale rate limit buckets periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of scanRateLimitBuckets) {
    if (now - bucket.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      scanRateLimitBuckets.delete(key);
    }
  }
}, RATE_LIMIT_WINDOW_MS).unref?.();

const SCAN_READ_LIMIT_PER_MINUTE = toSafeInt(process.env.SCAN_READ_LIMIT_PER_MINUTE, 120);
const SCAN_WRITE_LIMIT_PER_MINUTE = toSafeInt(process.env.SCAN_WRITE_LIMIT_PER_MINUTE, 30);
const SCAN_SHARED_IP_EMERGENCY_LIMIT_PER_MINUTE = toSafeInt(process.env.SCAN_SHARED_IP_EMERGENCY_LIMIT_PER_MINUTE, 1000);
const scanRateLimitBuckets = new Map();

const SCAN_READ_FUNCTIONS = new Set([
  "tool_get_system_settings",
  "tool_list_active_employees",
  "tool_get_location_scan_state",
  "tool_get_offline_scan_authority_snapshot",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.ip || req.socket?.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function consumeRateLimitBucket({ key, limit, now = Date.now() }) {
  const normalizedLimit = Math.max(1, Number(limit) || 1);
  let bucket = scanRateLimitBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    bucket = { windowStart: now, count: 0 };
    scanRateLimitBuckets.set(key, bucket);
  }
  bucket.count += 1;
  return {
    allowed: bucket.count <= normalizedLimit,
    count: bucket.count,
    limit: normalizedLimit,
    retryAfterSeconds: Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - bucket.windowStart)) / 1000)),
  };
}

function canonicalizeScanArguments(fn, args, device) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw Object.assign(new Error("Scan RPC args must be a JSON object."), { status: 422, code: "22023" });
  }
  const canonicalArgs = { ...args };
  const canonicalDeviceId = String(device?.canonical_device_id || device?.device_id || "").trim();
  if (canonicalDeviceId) {
    if ("p_device_id" in canonicalArgs || [
      "tool_get_location_scan_state",
      "tool_get_offline_scan_authority_snapshot",
      "tool_start_offline_occurrence",
      "tool_finish_session",
      "tool_complete_session",
      "tool_ping_device",
      "tool_commit_cleaning_workflow",
    ].includes(fn)) canonicalArgs.p_device_id = canonicalDeviceId;
    if ("p_device_identifier" in canonicalArgs || [
      "tool_report_device_sync_status",
      "tool_report_device_sync_status_v2",
      "tool_get_device_rollback_readiness",
      "tool_evaluate_location_proximity",
      "tool_evaluate_location_proximity_v2",
    ].includes(fn)) canonicalArgs.p_device_identifier = canonicalDeviceId;
  }

  const assignedEmployeeName = String(device?.assigned_employee_name || "").trim();
  if (assignedEmployeeName && fn === "tool_complete_session") canonicalArgs.p_submitted_by_employee_name = assignedEmployeeName;
  return canonicalArgs;
}

function prepareScanRpcCall(fn, args) {
  const normalizedFn = String(fn || "").trim();
  const nextArgs = { ...args };
  if (normalizedFn === "tool_start_offline_occurrence") {
    const clientSessionId = String(nextArgs.p_client_session_id || nextArgs.client_session_id || "").trim();
    const clientStartedAt = String(nextArgs.p_client_started_at || nextArgs.started_at || "").trim();
    if (!clientSessionId || !clientStartedAt) {
      const error = new Error("p_client_session_id and p_client_started_at are required to activate an offline occurrence.");
      error.status = 422;
      throw error;
    }
    nextArgs.p_client_session_id = clientSessionId;
    nextArgs.p_client_started_at = clientStartedAt;
    const snapshotId = String(nextArgs.p_snapshot_id || nextArgs.snapshot_id || "").trim().toLowerCase();
    const snapshotEmployeeId = String(nextArgs.p_snapshot_employee_id || nextArgs.snapshot_employee_id || nextArgs.employee_id || "").trim().toLowerCase();
    const snapshotEpoch = Number(nextArgs.p_snapshot_assignment_epoch ?? nextArgs.snapshot_assignment_epoch ?? nextArgs.assignment_epoch);
    const nativeScanEntryId = String(nextArgs.p_native_scan_entry_id || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(snapshotId) || !/^[0-9a-f-]{36}$/.test(snapshotEmployeeId)
        || !Number.isInteger(snapshotEpoch) || snapshotEpoch < 1
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nativeScanEntryId)) {
      throw Object.assign(new Error("p_snapshot_id, p_snapshot_employee_id, and p_snapshot_assignment_epoch from the issued offline snapshot are required."), { status: 422, code: "22023" });
    }
    nextArgs.p_snapshot_id = snapshotId;
    nextArgs.p_snapshot_employee_id = snapshotEmployeeId;
    nextArgs.p_snapshot_assignment_epoch = snapshotEpoch;
    nextArgs.p_native_scan_entry_id = nativeScanEntryId;
  }
  if (normalizedFn === "tool_complete_session") {
    const sessionIdentifier = String(nextArgs.p_session_uuid || nextArgs.p_client_session_id || "").trim();
    const completionId = String(nextArgs.p_client_completion_id || nextArgs.p_operation_id || "").trim();
    if (!sessionIdentifier) {
      const error = new Error("Exact p_session_uuid or p_client_session_id is required for completion.");
      error.status = 422;
      throw error;
    }
    if (!UUID_PATTERN.test(completionId)) {
      const error = new Error("p_client_completion_id must be a UUID for idempotent completion.");
      error.status = 422;
      throw error;
    }
    return {
      fn: normalizedFn,
      args: {
        p_session_uuid: sessionIdentifier,
        p_response_json: nextArgs.p_response_json,
        p_submitted_by_employee_name: nextArgs.p_submitted_by_employee_name || null,
        p_device_id: nextArgs.p_device_id || null,
        p_client_completion_id: completionId,
      },
    };
  }
  if (normalizedFn === "tool_finish_session") {
    const sessionIdentifier = String(nextArgs.p_session_uuid || nextArgs.p_client_session_id || "").trim();
    const finishOperationId = String(nextArgs.p_finish_operation_id || nextArgs.p_operation_id || "").trim();
    const clientEndedAt = String(nextArgs.p_client_ended_at || "").trim();
    if (!UUID_PATTERN.test(sessionIdentifier) || !UUID_PATTERN.test(finishOperationId)) {
      throw Object.assign(new Error("Exact UUID session and finish operation identities are required for a historical finish."), { status: 422, code: "22023" });
    }
    if (clientEndedAt && !Number.isFinite(Date.parse(clientEndedAt))) {
      throw Object.assign(new Error("p_client_ended_at must be an ISO-8601 timestamp when supplied."), { status: 422, code: "22007" });
    }
    return {
      fn: "custodial_finish_historical_session_authoritative",
      args: {
        p_session_identifier: sessionIdentifier,
        p_device_id: nextArgs.p_device_id,
        p_finish_operation_id: finishOperationId,
        p_client_ended_at: clientEndedAt || null,
        p_backend_execution_secret: offlineAuthoritySecret(),
      },
    };
  }
  if (normalizedFn === "tool_commit_cleaning_workflow") {
    const clientSessionId = String(nextArgs.p_client_session_id || "").trim();
    const clientCompletionId = String(nextArgs.p_client_completion_id || "").trim();
    if (!clientSessionId || !UUID_PATTERN.test(clientCompletionId)) {
      const error = new Error("p_client_session_id is required and p_client_completion_id must be a UUID for idempotent completion.");
      error.status = 422;
      throw error;
    }
    if (!nextArgs.p_correlation_id) nextArgs.p_correlation_id = `scan-commit:${clientSessionId}:${clientCompletionId}`;
    if (!nextArgs.p_response_json || typeof nextArgs.p_response_json !== "object" || Array.isArray(nextArgs.p_response_json)) {
      throw Object.assign(new Error("p_response_json must be a JSON object."), { status: 422, code: "22023" });
    }
    nextArgs.p_scan_evidence = normalizeCanonicalScanEvidence(nextArgs.p_scan_evidence);
  }
  return { fn: normalizedFn, args: nextArgs };
}

function offlineAuthoritySecret() {
  const secret = String(process.env.CUSTODIAL_BACKEND_PROOF_SECRET || "").trim();
  if (secret.length < 32) {
    const error = new Error("Offline authority is unavailable until CUSTODIAL_BACKEND_PROOF_SECRET is configured.");
    error.status = 503;
    error.code = "offline_authority_not_configured";
    throw error;
  }
  return secret;
}

function nativeRouteProofSecret() {
  const secret = String(process.env.CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET || "").trim();
  if (secret.length < 32 || secret === offlineAuthoritySecret()) {
    const error = new Error("Native route authority is unavailable until a distinct CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET is configured.");
    error.status = 503;
    error.code = "native_route_authority_not_configured";
    throw error;
  }
  return secret;
}

function bindOfflineActorProof(fn, args, credential) {
  const normalizedFn = String(fn || "").trim();
  if (!["tool_commit_cleaning_workflow", "tool_complete_session", "tool_start_offline_occurrence", "tool_get_offline_scan_authority_snapshot"].includes(normalizedFn)) return { fn: normalizedFn, args };
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw Object.assign(new Error("Offline authority arguments must be a JSON object."), { status: 422, code: "22023" });
  }
  const nextArgs = { ...args };
  const secret = offlineAuthoritySecret();
  if (!credential?.credential_id) {
    const error = new Error("An authenticated device credential is required for offline authority.");
    error.status = 401;
    throw error;
  }
  if (normalizedFn === "tool_get_offline_scan_authority_snapshot") {
    return {
      fn: normalizedFn,
      args: {
        p_device_id: nextArgs.p_device_id,
        p_authenticated_credential_id: credential.credential_id,
        p_backend_execution_secret: secret,
      },
    };
  }
  if (normalizedFn === "tool_start_offline_occurrence") {
    nextArgs.p_authenticated_credential_id = credential.credential_id;
    // Credential identity is authenticated server-side; never accept a
    // client-provided snapshot credential as authority.
    nextArgs.p_snapshot_credential_id = credential.credential_id;
    nextArgs.p_backend_execution_secret = secret;
    return { fn: normalizedFn, args: nextArgs };
  }
  if (normalizedFn === "tool_complete_session") {
    const authoritativeArgs = {
      p_session_uuid: nextArgs.p_session_uuid,
      p_response_json: nextArgs.p_response_json,
      p_device_id: nextArgs.p_device_id || null,
      p_client_completion_id: nextArgs.p_client_completion_id,
      p_authenticated_credential_id: credential.credential_id,
      p_backend_execution_secret: secret,
    };
    return {
      fn: "tool_complete_session_authoritative",
      args: authoritativeArgs,
      // The bridge release is safe to deploy before Phase B: while the new
      // command does not exist it calls the accepted legacy writer; the first
      // Phase B transaction atomically makes the canonical command available.
      fallback: {
        fn: "tool_complete_session",
        args: {
          p_session_uuid: nextArgs.p_session_uuid,
          p_response_json: nextArgs.p_response_json,
          p_submitted_by_employee_name: nextArgs.p_submitted_by_employee_name || null,
          p_device_id: nextArgs.p_device_id || null,
          p_client_completion_id: nextArgs.p_client_completion_id,
        },
      },
    };
  }
  if (!nextArgs.p_response_json || typeof nextArgs.p_response_json !== "object" || Array.isArray(nextArgs.p_response_json)) {
    throw Object.assign(new Error("p_response_json must be a JSON object."), { status: 422, code: "22023" });
  }
  nextArgs.p_scan_evidence = normalizeCanonicalScanEvidence(nextArgs.p_scan_evidence);
  const response = { ...nextArgs.p_response_json };
  const requested = response.__custodial_offline_reconciliation_v1;
  if (!requested || typeof requested !== "object" || Array.isArray(requested)) {
    throw Object.assign(new Error("A canonical offline reconciliation control object is required."), { status: 422, code: "22023" });
  }
  const requestedControl = requested;
  delete response.__custodial_offline_reconciliation_v1;
  const authoritativeArgs = {
    p_client_session_id: nextArgs.p_client_session_id,
    p_client_completion_id: nextArgs.p_client_completion_id,
    p_device_id: nextArgs.p_device_id,
    p_location_code: nextArgs.p_location_code,
    p_client_started_at: String(nextArgs.p_client_started_at || ""),
    p_client_ended_at: String(nextArgs.p_client_ended_at || ""),
    p_response_json: response,
    p_scan_evidence: nextArgs.p_scan_evidence,
    p_correlation_id: nextArgs.p_correlation_id || null,
    p_context_id: String(requestedControl.context_id || ""),
    p_submission_proof: String(requestedControl.submission_proof || ""),
    p_authenticated_credential_id: credential.credential_id,
    p_native_finish_scan_entry_id: nextArgs.p_native_finish_scan_entry_id,
    p_native_completion_attestation_version: nextArgs.p_native_completion_attestation_version,
    p_native_completion_attestation: nextArgs.p_native_completion_attestation,
    p_native_route_proof_secret: nextArgs.p_native_route_proof_secret,
    p_backend_execution_secret: secret,
  };
  return {
    fn: "tool_commit_cleaning_workflow_authoritative",
    args: authoritativeArgs,
    fallback: {
      fn: "tool_commit_cleaning_workflow",
      args: {
        p_client_session_id: nextArgs.p_client_session_id,
        p_client_completion_id: nextArgs.p_client_completion_id,
        p_device_id: nextArgs.p_device_id,
        p_location_code: nextArgs.p_location_code,
        p_client_started_at: nextArgs.p_client_started_at,
        p_client_ended_at: nextArgs.p_client_ended_at,
        p_response_json: response,
        p_scan_evidence: nextArgs.p_scan_evidence,
        p_correlation_id: nextArgs.p_correlation_id || null,
      },
    },
  };
}

async function runPreparedScanRpc(prepared) {
  try {
    return await runRpc(prepared.fn, prepared.args);
  } catch (error) {
    if (["42883", "PGRST202"].includes(error?.code) && prepared?.fallback?.fn) {
      return runRpc(prepared.fallback.fn, prepared.fallback.args);
    }
    throw error;
  }
}

async function executeScanRpcTransport(fn, args, device, credential, req) {
  const normalizedFn = String(fn || "").trim();
  if (!SCAN_RPC_ALLOWLIST.has(normalizedFn)) {
    throw Object.assign(new Error(`Function not allowed: ${normalizedFn}`), { status: 400, code: "scan_function_not_allowed" });
  }
  if (isNativeCustodialScanRequest(req)) {
    req.memphisNativeRequestAttestation = verifyNativeDeviceRequestAttestation(req);
  }
  const canonicalArgs = canonicalizeScanArguments(normalizedFn, args, device);
  const preparedBase = prepareScanRpcCall(normalizedFn, canonicalArgs);
  if (normalizedFn === "tool_start_offline_occurrence") {
    const attestation = verifyNativeOfflineWorkAttestation(req, preparedBase.args, "start");
    preparedBase.args.p_native_start_attestation_version = attestation.version;
    preparedBase.args.p_native_start_attestation = attestation.signature;
    preparedBase.args.p_native_scan_entry_id = attestation.native_scan_entry_id;
    preparedBase.args.p_native_route_proof_secret = nativeRouteProofSecret();
  } else if (normalizedFn === "tool_commit_cleaning_workflow") {
    const attestation = verifyNativeOfflineWorkAttestation(req, preparedBase.args, "completion");
    preparedBase.args.p_native_completion_attestation_version = attestation.version;
    preparedBase.args.p_native_completion_attestation = attestation.signature;
    preparedBase.args.p_native_finish_scan_entry_id = attestation.native_finish_scan_entry_id;
    preparedBase.args.p_native_route_proof_secret = nativeRouteProofSecret();
  }
  const proofBound = bindOfflineActorProof(preparedBase.fn, preparedBase.args, credential);
  const prepared = { ...preparedBase, ...proofBound };
  const data = await runPreparedScanRpc(prepared);
  return scanRpcHttpOutcome(normalizedFn, data);
}

async function collectBackendAuthorityHealth() {
  const authorityHealth = await runRpc("custodial_backend_authority_health", {
    p_backend_execution_secret: offlineAuthoritySecret(),
  });
  const canaryDeviceId = configuredReleaseCanaryDeviceId();
  const scanTransportProbe = canaryDeviceId
    ? await runRpc("custodial_get_release_canary_transport_probe_health", {
        p_device_identifier: canaryDeviceId,
        p_backend_commit_sha: BACKEND_COMMIT_SHA,
        p_release_id: RELEASE_ID,
        p_backend_execution_secret: offlineAuthoritySecret(),
      })
    : { ready: true, configured: false, reason: "release_canary_not_required" };
  const scanTransportReady = scanTransportProbe?.ready === true;
  return {
    ...authorityHealth,
    ok: authorityHealth?.ok === true && scanTransportReady,
    scan_rpc_transport: {
      ...scanTransportProbe,
      ready: scanTransportReady,
      probe_function: "tool_get_system_settings",
      path: "/scan-api/rpc",
    },
  };
}

function isNativeCustodialScanRequest(req) {
  const origin = String(req.headers?.origin || "").trim();
  const edition = String(req.headers?.["x-memphis-app-edition"] || "").trim().toLowerCase();
  return NATIVE_CUSTODIAL_ORIGINS.has(origin) && edition === "custodial";
}

async function recordReleaseCanaryTransportProbe(req, deviceIdentifier) {
  const call = buildReleaseCanaryTransportProbeCall({
    req,
    deviceIdentifier,
    backendCommitSha: BACKEND_COMMIT_SHA,
    releaseId: RELEASE_ID,
    nativeRouteProofSecret: nativeRouteProofSecret(),
  });
  return runRpc(call.fn, call.args);
}

const MAX_SCAN_RPC_BYTES = 1024 * 1024;
const scanAuthorityJsonParser = express.json({
  limit: `${MAX_SCAN_RPC_BYTES}b`,
  strict: true,
  verify(req, _res, buffer) {
    req.scanAuthorityRawBody = Buffer.from(buffer);
  },
});
const parseScanAuthorityJsonBeforeAuthentication = deferJsonParserErrors(
  scanAuthorityJsonParser,
  "scanAuthorityJsonError",
);

async function rejectInvalidAuthenticatedScanAuthorityJson(req, res, next) {
  const parseError = req.scanAuthorityJsonError;
  if (!parseError) {
    next();
    return;
  }
    const credentialId = String(req.memphisDeviceCredential?.credential_id || "").trim();
    const rawBody = req.scanAuthorityRawBody || parseError.body || Buffer.alloc(0);
    const declaredLength = Number.parseInt(String(req.headers["content-length"] || rawBody.length || 0), 10);
    const contentLength = Number.isFinite(declaredLength) && declaredLength >= 0
      ? Math.min(declaredLength, 10 * 1024 * 1024)
      : Math.min(rawBody.length, 10 * 1024 * 1024);
    const digest = createHash("sha256")
      .update(`${credentialId}:${parseError.type || "invalid_json"}:${contentLength}:`)
      .update(rawBody)
      .digest("hex");
    try {
      if (credentialId && offlineAuthoritySecret()) {
        await runRpc("custodial_quarantine_malformed_scan_http", {
          p_request_digest: digest,
          p_authenticated_credential_id: credentialId,
          p_content_length: contentLength,
          p_backend_execution_secret: offlineAuthoritySecret(),
        });
      }
    } catch (quarantineError) {
      const failure = authorityHttpFailure(quarantineError, "Malformed scan payload quarantine is unavailable.");
      res.status(failure.status).json(failure.body);
      return;
    }
    const outcome = malformedScanAuthorityOutcome({ deviceQuarantined: Boolean(credentialId && offlineAuthoritySecret()) });
    res.status(outcome.status).json(outcome.body);
}

function scanRpcRateLimit(req, res, next) {
  const fn = String(req.body?.fn || "").trim();
  const ip = clientIp(req);
  const now = Date.now();
  const shared = consumeRateLimitBucket({ key: `scan:ip:${ip}`, limit: SCAN_SHARED_IP_EMERGENCY_LIMIT_PER_MINUTE, now });
  if (!shared.allowed) {
    res.setHeader("Retry-After", String(shared.retryAfterSeconds));
    res.status(429).json({ ok: false, error: "Shared network emergency rate limit exceeded.", scope: "shared_ip_emergency" });
    return;
  }

  const deviceKey = String(req.memphisDevice?.canonical_device_id || req.memphisDevice?.device_id || req.memphisAuth?.device_id || "ops").trim();
  const isRead = SCAN_READ_FUNCTIONS.has(fn);
  const limit = isRead ? SCAN_READ_LIMIT_PER_MINUTE : SCAN_WRITE_LIMIT_PER_MINUTE;
  const deviceBucket = consumeRateLimitBucket({ key: `scan:${isRead ? "read" : "write"}:${deviceKey}`, limit, now });
  if (!deviceBucket.allowed) {
    res.setHeader("Retry-After", String(deviceBucket.retryAfterSeconds));
    res.status(429).json({
      ok: false,
      error: `Device ${isRead ? "read" : "write"} rate limit exceeded.`,
      scope: isRead ? "device_read" : "device_write",
      device_id: deviceKey,
    });
    return;
  }
  next();
}

function isHealthPath(req) {
  return String(req.path || "") === "/health";
}

function buildHealthPayload(area, extra = {}) {
  const contracts = {
    scan: SCAN_CONTRACT_VERSION,
    dashboard: DASHBOARD_CONTRACT_VERSION,
    messaging: MESSAGING_CONTRACT_VERSION,
    schedule: SCHEDULE_CONTRACT_VERSION,
    coverall_assignments: COVERALL_ASSIGNMENTS_CONTRACT_VERSION,
    operational_analytics: OPERATIONAL_ANALYTICS_CONTRACT_VERSION,
    events: EVENTS_CONTRACT_VERSION,
    guest_reports: GUEST_REPORTS_CONTRACT_VERSION,
    feedback: FEEDBACK_CONTRACT_VERSION,
    ops_manager_auth: OPS_MANAGER_AUTH_CONTRACT_VERSION,
    gemini_console: GEMINI_CONSOLE_CONTRACT_VERSION,
  };
  return {
    ok: true,
    app: "memphis-zoo-mcp",
    area,
    version: APP_VERSION,
    release_id: RELEASE_ID,
    contracts,
    release_manifest: area === "version" ? buildReleaseManifest({ appVersion: APP_VERSION, releaseId: RELEASE_ID, contracts }) : undefined,
    ...extra,
  };
}

function staticWeeklyControlPlanePublicUrl(env = process.env) {
  const value = String(env.STATIC_WEEKLY_CONTROL_PLANE_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (!value) return null;
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(value) && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(value)) {
    throw new Error("STATIC_WEEKLY_CONTROL_PLANE_PUBLIC_URL must be one HTTPS origin or a local HTTP origin.");
  }
  return value;
}

function getSupabaseConfig() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !supabaseAdmin) {
    throw new Error("Supabase is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.");
  }
  return supabaseAdmin;
}

function normalizeDashboardCloser(value) {
  const normalized = String(value || "").trim();
  return normalized || "Dashboard";
}

const ALLOWED_CORS_ORIGINS = String(process.env.ALLOWED_CORS_ORIGINS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const DEFAULT_CORS_ORIGINS = [
  "https://memphis-zoo-mcp.onrender.com",
  "https://lasrevinu333-design.github.io",
  "https://nousresearch.github.io",
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "ionic://localhost",
];
const CORS_ORIGINS_SET = new Set([...ALLOWED_CORS_ORIGINS, ...DEFAULT_CORS_ORIGINS]);
const TRUSTED_DEVICE_CORS_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-Memphis-Auth",
  "X-Device-Id",
  "X-Device-Label",
  "X-Device-Credential",
  "X-Memphis-Device-Credential",
  "X-Memphis-App-Edition",
  "X-Memphis-Native-Attestation-Version",
  "X-Memphis-Native-Request-Id",
  "X-Memphis-Native-Request-Timestamp",
  "X-Memphis-Native-Request-Attestation",
  "X-Device-Security-CSRF",
  "X-Admin-Key",
  "X-Ops-Access-Key",
  "Idempotency-Key",
].join(", ");

function setCorsOrigin(res, req) {
  const origin = String(req?.headers?.origin || "").trim();
  if (origin && CORS_ORIGINS_SET.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", DEFAULT_CORS_ORIGINS[0]);
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Expose-Headers", "X-Device-Enrollment-Required, Retry-After");
  res.setHeader("Vary", "Origin");
}

function setAdminApiCors(res, req) {
  setCorsOrigin(res, req);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", TRUSTED_DEVICE_CORS_HEADERS);
}

function setPublicDashboardCors(res, req) {
  setCorsOrigin(res, req);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", TRUSTED_DEVICE_CORS_HEADERS);
}

function setScanApiCors(res, req) {
  setCorsOrigin(res, req);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", TRUSTED_DEVICE_CORS_HEADERS);
}

function setMessagingApiCors(res, req) {
  setCorsOrigin(res, req);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", TRUSTED_DEVICE_CORS_HEADERS);
}

function setScheduleApiCors(res, req) {
  setCorsOrigin(res, req);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,PATCH,DELETE");
  res.setHeader("Access-Control-Allow-Headers", TRUSTED_DEVICE_CORS_HEADERS);
}

function setGuestApiCors(res, req) {
  setCorsOrigin(res, req);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", TRUSTED_DEVICE_CORS_HEADERS);
}

function setFeedbackApiCors(res, req) {
  setCorsOrigin(res, req);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Memphis-Auth, X-Device-Id, X-Feedback-Reminder-Secret, X-Ops-Access-Key, X-Admin-Key");
}

function setGeminiApiCors(res, req) {
  setCorsOrigin(res, req);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", TRUSTED_DEVICE_CORS_HEADERS);
}


function getFeedbackReminderSecret() {
  return String(process.env.FEEDBACK_REMINDER_SECRET || "").trim();
}

function safeStringEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function releaseCanaryConfigurationRequired(env = process.env) {
  return env.NODE_ENV === "production" && /^(1|true|yes)$/i.test(String(env.RENDER || ""));
}

function configuredReleaseCanaryDeviceId({ required = releaseCanaryConfigurationRequired() } = {}) {
  const deviceId = String(process.env.CUSTODIAL_RELEASE_CANARY_DEVICE_ID || "").trim().toUpperCase();
  if (!deviceId) {
    if (required) {
      throw Object.assign(new Error("CUSTODIAL_RELEASE_CANARY_DEVICE_ID is required for the production release."), {
        status: 503,
        code: "release_canary_not_configured",
      });
    }
    return null;
  }
  if (!/^KIOSK_(0[2-9]|10)$/.test(deviceId)) {
    throw new Error("CUSTODIAL_RELEASE_CANARY_DEVICE_ID must identify KIOSK_02 through KIOSK_10.");
  }
  return deviceId;
}

function requireReleaseSchemaIdentityToken(req, res, next) {
  const configured = String(process.env.MEMPHIS_RELEASE_SCHEMA_IDENTITY_TOKEN || "").trim();
  if (configured.length < 32) {
    res.status(503).json({ ok: false, error: "Release schema observation is not configured." });
    return;
  }
  const match = String(req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  const supplied = String(match?.[1] || "").trim();
  if (!supplied || !safeStringEqual(supplied, configured)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }
  next();
}

let _feedbackLinkSecretGenerated = null;
function getFeedbackLinkSecret() {
  const secret = String(process.env.FEEDBACK_LINK_SECRET || "").trim();
  if (secret) return secret;
  const serviceSecret = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (serviceSecret) return serviceSecret;
  if (!_feedbackLinkSecretGenerated) {
    _feedbackLinkSecretGenerated = randomUUID() + randomUUID();
    console.warn("[security] FEEDBACK_LINK_SECRET is unset. Generated a random feedback link secret at startup. Feedback links will not survive restarts.");
  }
  return _feedbackLinkSecretGenerated;
}

function signFeedbackLinkToken(feedbackId, purpose = "ack") {
  return signExpiringFeedbackToken({
    secret: getFeedbackLinkSecret(),
    feedbackId,
    purpose,
    ttlMs: FEEDBACK_LINK_TTL_MS,
  });
}

function verifyFeedbackLinkToken(token, feedbackId, purpose = "ack") {
  return verifyExpiringFeedbackToken({ secret: getFeedbackLinkSecret(), token, feedbackId, purpose });
}

function requireFeedbackSignedLinkOrOps(purpose) {
  return (req, res, next) => {
    const feedbackId = String(req.params.feedbackId || "").trim();
    if (verifyFeedbackLinkToken(req.query.token || req.body?.token, feedbackId, purpose)) {
      req.feedbackSignedLink = { purpose, feedback_id: feedbackId };
      next();
      return;
    }
    const result = authenticateOpsAccessRequest(req);
    if (!result.ok) {
      res.status(result.status || 401).json({ ok: false, error: result.error || "Unauthorized" });
      return;
    }
    req.memphisAuth = result.session;
    next();
  };
}

function requireFeedbackReminderSecret(req, res) {
  const configuredSecret = getFeedbackReminderSecret();
  if (!configuredSecret) {
    res.status(503).json({ ok: false, error: "FEEDBACK_REMINDER_SECRET is not configured on the server." });
    return false;
  }
  const providedSecret = String(req.header("x-feedback-reminder-secret") || req.body?.secret || "").trim();
  if (!providedSecret || !safeStringEqual(providedSecret, configuredSecret)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

async function runRpc(functionName, args = {}) {
  if (functionName === "sch_generate_daily_schedule") {
    const client = getSupabaseConfig();
    const { data, error } = await client.rpc("sch_generate_daily_schedule_privileged", {
      p_service_date: args?.p_service_date,
      p_force: args?.p_force === true,
    });
    if (error) throw rpcFailure(error, "sch_generate_daily_schedule_privileged");
    return data;
  }
  const client = getSupabaseConfig();
  const { data, error } = await client.rpc(functionName, args);
  if (error) throw rpcFailure(error, functionName);
  return data;
}

function toSafeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return Math.max(1, fallback);
  return parsed;
}

function toSafeNonNegativeInt(value, fallback = 0) {
  const raw = value == null || String(value).trim() === "" ? fallback : value;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return Math.max(0, Number(fallback) || 0);
  return parsed;
}

function sqlLiteral(value) {
  if (value == null) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function stableRequestFingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requestOperationId(req) {
  const value = String(
    req?.body?.operation_id
      || req?.body?.operationId
      || req?.header?.("idempotency-key")
      || "",
  ).trim();
  if (!value) return randomUUID();
  if (!isUuid(value)) throw Object.assign(new Error("operation_id must be a UUID."), { status: 422 });
  return value;
}

function requiredRequestOperationId(req) {
  const value = String(
    req?.body?.operation_id
      || req?.body?.operationId
      || req?.header?.("idempotency-key")
      || "",
  ).trim();
  if (!isUuid(value)) {
    throw Object.assign(new Error("operation_id must be a stable UUID."), { status: 422, code: "22023" });
  }
  return value;
}

function parseAttendanceMetric(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}:\\s*([\\d,]+)`, "i");
  const match = text.match(pattern);
  if (!match) return null;
  const parsed = Number.parseInt(String(match[1]).replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAttendanceHtml(html) {
  const normalized = String(html || "").replace(/\r/g, "");
  const attendanceBlock = normalized.match(/<h5[^>]*>\s*Attendance\s*<\/h5>[\s\S]{0,2500}?<\/div>\s*<\/div>/i);
  const source = attendanceBlock ? attendanceBlock[0] : normalized;
  const currentMatch = source.match(/<h1[^>]*>\s*([\d,]+)\s*<\/h1>/i);
  if (!currentMatch) throw new Error("Attendance card found but current attendance value was not found.");
  const attendance = Number.parseInt(String(currentMatch[1]).replace(/,/g, ""), 10);
  if (!Number.isFinite(attendance) || attendance < 0) throw new Error("Parsed attendance value is invalid.");
  const text = source.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return {
    attendance,
    last_year: parseAttendanceMetric(text, "Last Year"),
    planned: parseAttendanceMetric(text, "Planned"),
    yesterday: parseAttendanceMetric(text, "Yesterday"),
    yesterday_plan: parseAttendanceMetric(text, "Yesterday Plan"),
    parse_method: "html_attendance_card",
  };
}

async function loadStoredAttendance() {
  const rows = await runReadOnlySql(`
    select attendance, last_year, planned, yesterday, yesterday_plan, source, fetched_at, updated_at
    from public.current_attendance_state
    where id = 1
    limit 1
  `);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return normalizeAttendanceRecord(rows[0], { staleAfterMs: ATTENDANCE_STALE_AFTER_MS });
}

async function persistAttendanceState(payload = {}) {
  const attendance = toNullableNonNegativeInteger(payload.attendance);
  const lastYear = toNullableNonNegativeInteger(payload.last_year);
  const planned = toNullableNonNegativeInteger(payload.planned);
  const yesterday = toNullableNonNegativeInteger(payload.yesterday);
  const yesterdayPlan = toNullableNonNegativeInteger(payload.yesterday_plan);
  const source = payload.source == null ? null : String(payload.source);
  const fetchedAt = payload.fetched_at == null ? null : String(payload.fetched_at);

  if (attendance == null) {
    throw Object.assign(new Error("attendance is required and must be a nonnegative integer."), { status: 422 });
  }
  for (const [name, original, normalized] of [
    ["last_year", payload.last_year, lastYear],
    ["planned", payload.planned, planned],
    ["yesterday", payload.yesterday, yesterday],
    ["yesterday_plan", payload.yesterday_plan, yesterdayPlan],
  ]) {
    if (original != null && original !== "" && normalized == null) {
      throw Object.assign(new Error(`${name} must be a nonnegative integer when provided.`), { status: 422 });
    }
  }

  await runOperationalCommand("attendance_state_upsert", {
    attendance, last_year: lastYear, planned, yesterday, yesterday_plan: yesterdayPlan,
    source, fetched_at: fetchedAt,
  });

  return await loadStoredAttendance();
}

async function fetchCurrentAttendance(options = {}) {
  const now = Date.now();
  if (!options.force && attendanceCache.data && now - attendanceCache.fetched_at_ms < ATTENDANCE_CACHE_MS) {
    return { ...attendanceCache.data, cached: true, stale: false };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTENDANCE_TIMEOUT_MS);

  try {
    const requestHeaders = {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "accept-encoding": "gzip, deflate, br, zstd",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
      priority: "u=0, i",
      "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    };

    if (ATTENDANCE_CF_CLEARANCE) {
      requestHeaders.cookie = `cf_clearance=${ATTENDANCE_CF_CLEARANCE}`;
    }

    const response = await fetch(ATTENDANCE_SOURCE_URL, {
      method: "GET",
      signal: controller.signal,
      headers: requestHeaders,
    });

    if (!response.ok) throw new Error(`Attendance source returned HTTP ${response.status}`);

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const html = await response.text();
    const parsed = parseAttendanceHtml(html);

    const data = {
      ...parsed,
      source_url: ATTENDANCE_SOURCE_URL,
      source: "scrape",
      content_type: contentType,
      fetched_at: new Date().toISOString(),
      cached: false,
      stale: false,
    };

    attendanceCache = { data, fetched_at_ms: now };
    return data;
  } catch (error) {
    if (attendanceCache.data) {
      return {
        ...attendanceCache.data,
        cached: true,
        stale: true,
        warning: error?.message || "Attendance fetch failed.",
      };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function runReadOnlySql(sql) {
  const client = getSupabaseConfig();
  const result = await runSupabaseReadOnlySql({ client, sql });
  return result.rows;
}

async function runSchemaCatalogSql(sql) {
  return runSupabaseReadOnlySql({
    client: getSupabaseConfig(),
    sql,
    maxRows: 250_000,
    maxResponseBytes: 100_000_000,
  });
}

async function runOperationalCommand(command, payload = {}) {
  return runRpc("app_apply_operational_command", {
    p_command: String(command || "").trim(),
    p_payload: payload,
  });
}

async function runEventCommand(command, payload = {}) {
  const normalized = String(command || "").trim();
  const commands = {
    event_create: "create",
    event_update: "update",
    event_cancel: "cancel",
  };
  const eventCommand = commands[normalized];
  if (!eventCommand) throw new Error(`Unsupported bounded event command: ${normalized}`);
  return runRpc("app_apply_event_command", {
    p_command: eventCommand,
    p_event_id: payload.event_id || null,
    p_record: payload.record || {},
    p_actor: payload.actor || null,
    p_reason: payload.reason || null,
  });
}

async function runScheduleCommand(command, payload = {}) {
  return runRpc("app_apply_schedule_command", {
    p_command: String(command || "").trim(),
    p_payload: payload,
  });
}

const eventMaintenanceController = createEventMaintenanceController({ runReadOnlySql, runCommand: runEventCommand, runRpc });

async function runAdminBundleViaSqlRead(limits = {}) {
  const pLocationLimit = toSafeInt(limits.p_location_limit, 60);
  const pActivityLimit = toSafeInt(limits.p_activity_limit, 20);
  const pTicketLimit = toSafeInt(limits.p_ticket_limit, 100);
  const pExceptionLimit = toSafeInt(limits.p_exception_limit, 25);
  const pDeviceLimit = toSafeInt(limits.p_device_limit, 100);
  const sql = `select public.tool_admin_bundle(${pLocationLimit},${pActivityLimit},${pTicketLimit},${pExceptionLimit},${pDeviceLimit}) as data`;
  const rows = await runReadOnlySql(sql);
  if (Array.isArray(rows) && rows.length > 0) return rows[0]?.data ?? {};
  return {};
}

async function ensureGuestReportsSchema() {
  const rows = await runReadOnlySql("select to_regclass('public.guest_cleanliness_reports') is not null as present");
  if (!rows?.[0]?.present) throw new Error("Required table public.guest_cleanliness_reports is missing. Apply source-controlled migrations.");
}

async function resolveGuestReportLocation(locationCode) {
  const code = String(locationCode || "").trim().toUpperCase();
  if (!code) throw new Error("location_code is required.");
  const rows = await runReadOnlySql(`
    select l.id as location_id, l.location_code, l.location_name, l.location_type, l.form_type
    from public.locations l
    where l.active = true and upper(l.location_code) = ${sqlLiteral(code)}
    order by l.location_name
    limit 1
  `);
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("Location not found.");
  }
  return rows[0];
}

async function resolveOpsManagerRecipients() {
  const rows = await runReadOnlySql(`
    select distinct mu.id as user_id, mu.display_name, mu.role, m.manager_id
    from public.msg_users mu
    join public.ops_manager_managers m on m.manager_id = mu.ops_manager_id
    where coalesce(mu.is_active, true) = true
      and m.active = true
      and m.revoked_at is null
      and m.is_system_principal = false
    order by mu.display_name
  `);
  return Array.isArray(rows) ? rows.filter((row) => isUuid(row.user_id)) : [];
}

async function deliverCustodialOfflineReconciliationNotification(notification) {
  const recipients = await resolveOpsManagerRecipients();
  if (!recipients.length) {
    const error = new Error("No active named manager recipient is available for offline reconciliation recovery.");
    error.terminal = true;
    throw error;
  }
  const memphisRows = await runReadOnlySql("select public.msg_get_memphis_user_id() as memphis_user_id");
  const memphisUserId = Array.isArray(memphisRows) && memphisRows.length ? memphisRows[0].memphis_user_id : null;
  if (!isUuid(memphisUserId)) throw new Error("Memphis bot identity is unavailable.");
  const payload = notification?.payload_json && typeof notification.payload_json === "object" ? notification.payload_json : {};
  const isDisposition = notification?.notification_kind === "offline_reconciliation_disposition";
  const subject = isDisposition ? "Offline reconciliation disposition recorded" : "Offline reconciliation quarantined";
  const body = [
    subject,
    `Reconciliation: ${payload.reconciliation_id || notification?.reconciliation_id || "unknown"}`,
    isDisposition ? `Disposition: ${payload.disposition || "recorded"}` : `Reason: ${payload.reason || "offline_authority_rejected"}`,
    "Open the named-manager offline reconciliation queue to review immutable evidence.",
  ].join("\n");
  const claimed = await runRpc("custodial_claim_offline_reconciliation_notification_recipients", {
    p_outbox_id: notification.outbox_id,
    p_worker_id: OPERATIONAL_NOTIFICATION_WORKER_ID,
    p_outbox_lease_token: notification.lease_token,
    p_recipients: recipients.map((recipient) => ({ manager_id: recipient.manager_id, user_id: recipient.user_id })),
    p_backend_execution_secret: offlineAuthoritySecret(),
  });
  const claimedRecipients = Array.isArray(claimed) ? claimed : (claimed ? [claimed] : []);
  const results = [];
  for (const recipient of claimedRecipients) {
    let succeeded = false;
    let terminal = false;
    let errorMessage = null;
    let message = null;
    try {
      const thread = await runRpc("msg_get_or_create_direct_thread", { p_user_a: memphisUserId, p_user_b: recipient.recipient_user_id });
      message = await runRpc("msg_send_message", {
        p_thread_id: thread.id,
        p_sender_user_id: memphisUserId,
        p_body: body,
        p_message_type: "bot_response",
        p_metadata_json: {
          channel: "offline_reconciliation_recovery",
          reconciliation_id: payload.reconciliation_id || notification?.reconciliation_id || null,
          disposition_id: payload.disposition_id || notification?.disposition_id || null,
          recipient_manager_id: recipient.manager_id || null,
          client_message_id: recipient.client_message_id,
          notification_instance_key: recipient.notification_instance_key,
        },
      });
      if (!isUuid(message?.id)) throw new Error("Messenger did not return the durable message identity.");
      succeeded = true;
    } catch (error) {
      terminal = error?.terminal === true;
      errorMessage = String(error?.message || "Offline reconciliation recipient delivery failed.").slice(0, 500);
    }
    const retrySeconds = Math.min(3600, Math.max(15, 15 * (2 ** Math.min(8, Number(recipient.attempts || 1) - 1))));
    const finished = await runRpc("custodial_finish_offline_reconciliation_notification_recipient", {
      p_delivery_recipient_id: recipient.delivery_recipient_id,
      p_worker_id: OPERATIONAL_NOTIFICATION_WORKER_ID,
      p_lease_token: recipient.lease_token,
      p_succeeded: succeeded,
      p_message_id: message?.id || null,
      p_error: errorMessage,
      p_retry_seconds: retrySeconds,
      p_terminal: terminal,
      p_delivery_evidence: {
        channel: "messenger",
        reconciliation_id: payload.reconciliation_id || notification?.reconciliation_id || null,
        disposition_id: payload.disposition_id || notification?.disposition_id || null,
        recipient_manager_id: recipient.manager_id || null,
      },
      p_backend_execution_secret: offlineAuthoritySecret(),
    });
    results.push({
      manager_id: recipient.manager_id,
      recipient_user_id: recipient.recipient_user_id,
      state: finished?.state,
      message_id: finished?.message_id || message?.id || null,
      error: errorMessage,
    });
  }
  const failed = results.filter((result) => result.state === "failed");
  const incomplete = results.filter((result) => result.state !== "delivered");
  return {
    recipient_manager_ids: recipients.map((recipient) => recipient.manager_id).filter(isUuid),
    delivered_count: results.filter((result) => result.state === "delivered").length,
    recipient_results: results,
    succeeded: incomplete.length === 0,
    terminal: failed.length > 0,
    error: failed.length ? "One or more named-manager recipients are unavailable." : (incomplete.length ? "One or more named-manager recipient deliveries are pending retry." : null),
  };
}

async function runCustodialOfflineReconciliationNotificationWorker({ limit = 10 } = {}) {
  let executionSecret;
  try {
    executionSecret = offlineAuthoritySecret();
  } catch (error) {
    return { claimed: 0, completed: 0, skipped: "offline_authority_not_configured", error: error.code || "offline_authority_not_configured", results: [] };
  }
  const claimed = await runRpc("custodial_claim_offline_reconciliation_notifications", {
    p_worker_id: OPERATIONAL_NOTIFICATION_WORKER_ID,
    p_limit: Math.max(1, Math.min(50, Number(limit) || 10)),
    p_lease_seconds: 120,
    p_backend_execution_secret: executionSecret,
  });
  const notifications = Array.isArray(claimed) ? claimed : (claimed ? [claimed] : []);
  const results = [];
  for (const notification of notifications) {
    let succeeded = false;
    let terminal = false;
    let errorMessage = null;
    let delivery = {};
    try {
      delivery = await deliverCustodialOfflineReconciliationNotification(notification);
      succeeded = delivery?.succeeded === true;
      terminal = delivery?.terminal === true;
      errorMessage = delivery?.error || null;
    } catch (error) {
      terminal = error?.terminal === true;
      errorMessage = String(error?.message || "Offline reconciliation notification delivery failed.").slice(0, 2000);
    }
    const retrySeconds = Math.min(3600, Math.max(15, 15 * (2 ** Math.min(8, Number(notification.attempts || 1) - 1))));
    const finished = await runRpc("custodial_finish_offline_reconciliation_notification", {
      p_outbox_id: notification.outbox_id,
      p_worker_id: OPERATIONAL_NOTIFICATION_WORKER_ID,
      p_lease_token: notification.lease_token,
      p_succeeded: succeeded,
      p_error: errorMessage,
      p_retry_seconds: retrySeconds,
      p_terminal: terminal,
      p_delivery_json: delivery,
      p_backend_execution_secret: executionSecret,
    });
    results.push({ outbox_id: notification.outbox_id, succeeded, terminal: finished?.terminal === true, state: finished?.state, error: errorMessage });
  }
  return { claimed: notifications.length, completed: results.filter((result) => result.succeeded).length, results };
}

async function createGuestCleanlinessReport({ operationId, requestFingerprint, location, issueType, severity, notes, reporter = {}, reporterContext = {} }) {
  const issue = String(issueType || "Cleanliness issue").trim() || "Cleanliness issue";
  const level = String(severity || "normal").trim().toLowerCase() || "normal";
  const noteText = notes == null ? null : String(notes).trim() || null;
  const metadata = {
    ...reporterContext,
    reporter: {
      name: String(reporter.name || "").trim() || null,
      phone: String(reporter.phone || "").trim() || null,
      email: String(reporter.email || "").trim() || null,
    },
    submitted_via: "guest_qr",
  };
  const existingRows = await runReadOnlySql(`
    select id, operation_id, request_fingerprint, location_code, location_name,
           issue_type, severity, notes, status, source, submitted_at, resolved_at,
           notification_status, notified_employee_user_id, notified_ops_count,
           marketing_review_status, marketing_reviewed_at, marketing_reviewed_by,
           marketing_review_notes, dispatched_at, resolved_by, metadata_json
    from public.guest_cleanliness_reports
    where operation_id=${sqlLiteral(operationId)}::uuid
    limit 1
  `);
  if (existingRows?.[0]) {
    if (existingRows[0].request_fingerprint && existingRows[0].request_fingerprint !== requestFingerprint) {
      throw Object.assign(new Error("operation_id conflicts with another guest report submission."), { status: 409 });
    }
    return { ...existingRows[0], newly_inserted: false };
  }
  const reportId = randomUUID();
  await runOperationalCommand("guest_report_create", {
    id: reportId, operation_id: operationId, request_fingerprint: requestFingerprint,
    location_code: location.location_code, location_name: location.location_name || null,
    issue_type: issue, severity: level, notes: noteText, metadata_json: metadata,
  });
  const rows = await runReadOnlySql(`
    select id, operation_id, request_fingerprint, location_code, location_name,
           issue_type, severity, notes, status, source, submitted_at, resolved_at,
           notification_status, notified_employee_user_id, notified_ops_count,
           marketing_review_status, marketing_reviewed_at, marketing_reviewed_by,
           marketing_review_notes, dispatched_at, resolved_by, metadata_json
    from public.guest_cleanliness_reports
    where operation_id=${sqlLiteral(operationId)}::uuid
    limit 1
  `);
  if (!Array.isArray(rows) || !rows.length) throw new Error("Guest report could not be created.");
  if (rows[0].request_fingerprint && rows[0].request_fingerprint !== requestFingerprint) {
    throw Object.assign(new Error("operation_id conflicts with another guest report submission."), { status: 409 });
  }
  return { ...rows[0], newly_inserted: rows[0].id === reportId };
}

function buildGuestReportNotificationBody(report, ownerName) {
  const severityLabel = String(report.severity || "normal").toUpperCase();
  const notes = report.notes ? ` Notes: ${report.notes}` : "";
  const owner = ownerName ? ` Current owner: ${ownerName}.` : "";
  return `Guest cleanliness report for ${report.location_name || report.location_code} (${report.location_code}). Issue: ${report.issue_type}. Severity: ${severityLabel}.${owner}${notes}`.trim();
}

async function notifyGuestReportRecipients({ report, currentOwner, opsRecipients, memphisUserId }) {
  const notified = { employee_user_id: null, ops_count: 0, errors: [] };
  const recipientIds = [];
  const ownerUserId = currentOwner?.msg_user_id || currentOwner?.user_id || null;
  if (isUuid(ownerUserId)) {
    recipientIds.push({ user_id: ownerUserId, kind: "current_owner", display_name: currentOwner?.assigned_employee_name || currentOwner?.display_name || null });
  }
  for (const ops of opsRecipients || []) {
    if (!recipientIds.some((entry) => entry.user_id === ops.user_id)) {
      recipientIds.push({ user_id: ops.user_id, kind: "ops_manager", display_name: ops.display_name || null });
    }
  }

  const body = buildGuestReportNotificationBody(report, currentOwner?.assigned_employee_name || null);
  const sendResults = await Promise.allSettled(recipientIds.map(async (recipient) => {
    const thread = await runRpc("msg_get_or_create_direct_thread", { p_user_a: memphisUserId, p_user_b: recipient.user_id });
    await runRpc("msg_send_message", {
      p_thread_id: thread.id,
      p_sender_user_id: memphisUserId,
      p_body: body,
      p_message_type: "bot_response",
      p_metadata_json: {
        channel: "memphis",
        source: "guest_cleanliness_report",
        report_id: report.id,
        location_code: report.location_code,
        recipient_kind: recipient.kind,
      },
      p_client_message_id: `guest-report:${report.id}:${recipient.user_id}`,
    });
    return recipient;
  }));
  for (let i = 0; i < recipientIds.length; i++) {
    const recipient = recipientIds[i];
    const result = sendResults[i];
    if (result.status === "fulfilled") {
      if (recipient.kind === "current_owner") notified.employee_user_id = recipient.user_id;
      if (recipient.kind === "ops_manager") notified.ops_count += 1;
    } else {
      notified.errors.push({ user_id: recipient.user_id, error: result.reason?.message || "notification_failed" });
    }
  }

  const totalAttempted = recipientIds.length;
  const totalSucceeded = totalAttempted - notified.errors.length;
  const notificationStatus = totalAttempted === 0
    ? "failed"
    : (notified.errors.length === 0 ? "sent" : (totalSucceeded === 0 ? "failed" : "partial"));

  await runOperationalCommand("guest_report_notification", {
    id: report.id, notification_status: notificationStatus, notified_employee_user_id: notified.employee_user_id,
    notified_ops_count: Number(notified.ops_count || 0), delivered_count: totalSucceeded,
    notification_errors: notified.errors,
  });

  return notified;
}

async function getGuestCleanlinessReportById(reportId) {
  if (!isUuid(reportId)) throw new Error("Guest report id is invalid.");
  const rows = await runReadOnlySql(`
    select id, operation_id, location_code, location_name, issue_type, severity, notes,
           status, source, submitted_at, resolved_at, notification_status,
           notified_employee_user_id, notified_ops_count, marketing_review_status,
           marketing_reviewed_at, marketing_reviewed_by, marketing_review_notes,
           dispatched_at, resolved_by, metadata_json
    from public.guest_cleanliness_reports
    where id = ${sqlLiteral(reportId)}::uuid
    limit 1
  `);
  if (!Array.isArray(rows) || !rows.length) throw new Error("Guest report was not found.");
  return rows[0];
}

async function processGuestCleanlinessNotificationJob(job) {
  const report = await getGuestCleanlinessReportById(job.source_id);
  if (report.status !== "open" || report.marketing_review_status !== "approved") {
    throw new Error("Guest report has not completed Marketing approval.");
  }
  const currentOwnerRows = await runReadOnlySql(`select * from public.sch_get_current_owner(${sqlLiteral(report.location_code)}, now())`);
  const currentOwner = Array.isArray(currentOwnerRows) && currentOwnerRows.length ? currentOwnerRows[0] : null;
  const opsRecipients = await resolveOpsManagerRecipients();
  const memphisRows = await runReadOnlySql("select public.msg_get_memphis_user_id() as memphis_user_id");
  const memphisUserId = Array.isArray(memphisRows) && memphisRows.length ? memphisRows[0].memphis_user_id : null;
  if (!isUuid(memphisUserId)) throw new Error("Memphis bot identity is unavailable.");
  const notification = await notifyGuestReportRecipients({ report, currentOwner, opsRecipients, memphisUserId });
  const deliveredCount = Number(notification.ops_count || 0) + (notification.employee_user_id ? 1 : 0);
  if (notification.errors.length || deliveredCount === 0) {
    throw new Error(notification.errors.length
      ? `Notification delivery failed for ${notification.errors.length} recipient(s).`
      : "No active notification recipient was available.");
  }
  return notification;
}

async function runOperationalNotificationWorker({ limit = 10 } = {}) {
  if (operationalNotificationWorkerInFlight) return { ok: true, skipped: "in_flight" };
  operationalNotificationWorkerInFlight = true;
  try {
    const claimed = await runRpc("claim_operational_notification_jobs", {
      p_worker_id: OPERATIONAL_NOTIFICATION_WORKER_ID,
      p_limit: Math.max(1, Math.min(50, Number(limit) || 10)),
      p_lease_seconds: 120,
    });
    const jobs = Array.isArray(claimed) ? claimed : (claimed ? [claimed] : []);
    const results = [];
    for (const job of jobs) {
      let succeeded = false;
      let errorMessage = null;
      let terminal = false;
      let deferFinish = false;
      try {
        if (job.job_type === "guest_cleanliness_report") {
          await processGuestCleanlinessNotificationJob(job);
        } else {
          const handler = operationalNotificationJobHandlers.get(String(job.job_type || "").trim());
          if (!handler) throw new Error(`Unsupported operational notification job type: ${job.job_type}`);
          await handler(job);
        }
        succeeded = true;
      } catch (error) {
        errorMessage = String(error?.message || "Operational notification failed.").slice(0, 2000);
        terminal = error?.terminal === true;
        deferFinish = error?.deferFinish === true;
      }
      if (deferFinish) {
        results.push({ job_id: job.job_id, succeeded: false, terminal: false, deferred: true, error: errorMessage });
        continue;
      }
      const retrySeconds = Math.min(3600, Math.max(15, 15 * (2 ** Math.min(8, Number(job.attempts || 1) - 1))));
      if (terminal) {
        await runRpc("finish_operational_notification_job_terminal", {
          p_job_id: job.job_id,
          p_lease_token: job.lease_token,
          p_error: errorMessage,
        });
      } else {
        await runRpc("finish_operational_notification_job", {
          p_job_id: job.job_id,
          p_lease_token: job.lease_token,
          p_succeeded: succeeded,
          p_error: errorMessage,
          p_retry_seconds: retrySeconds,
        });
      }
      results.push({ job_id: job.job_id, succeeded, terminal, error: errorMessage });
    }
    const custodial = await runCustodialOfflineReconciliationNotificationWorker({ limit });
    return {
      ok: true,
      claimed: jobs.length,
      completed: results.filter((item) => item.succeeded).length,
      results,
      custodial_offline_reconciliation: custodial,
    };
  } finally {
    operationalNotificationWorkerInFlight = false;
  }
}

async function listGuestCleanlinessReports({ status, locationCode, marketingReviewStatus, limit = 100, publicFieldsOnly = false } = {}) {
  const filters = [];
  if (status) filters.push(`status = ${sqlLiteral(String(status).trim().toLowerCase())}`);
  if (locationCode) filters.push(`upper(location_code) = ${sqlLiteral(String(locationCode).trim().toUpperCase())}`);
  if (marketingReviewStatus) filters.push(`marketing_review_status = ${sqlLiteral(String(marketingReviewStatus).trim().toLowerCase())}`);
  const where = filters.length ? `where ${filters.join(" and ")}` : "";
  const projection = publicFieldsOnly
    ? "id, location_code, location_name, issue_type, severity, status, submitted_at, resolved_at"
    : `id, operation_id, location_code, location_name, issue_type, severity, notes, status, source,
       submitted_at, resolved_at, notification_status, notified_employee_user_id,
       notified_ops_count, marketing_review_status, marketing_reviewed_at,
       marketing_reviewed_by, marketing_review_notes, dispatched_at, resolved_by, metadata_json`;
  const rows = await runReadOnlySql(`
    select ${projection}
    from public.guest_cleanliness_reports
    ${where}
    order by submitted_at desc
    limit ${Math.max(1, Math.min(500, Number(limit) || 100))}
  `);
  return Array.isArray(rows) ? rows : [];
}

async function reviewGuestCleanlinessReport(reportId, { action, actor, notes = null } = {}) {
  if (!isUuid(reportId)) throw Object.assign(new Error("Guest report id is invalid."), { status: 422 });
  const normalizedAction = String(action || "").trim().toLowerCase();
  if (!["approve", "reject"].includes(normalizedAction)) throw Object.assign(new Error("action must be approve or reject."), { status: 422 });
  const reviewedBy = String(actor || "authenticated_manager").trim().slice(0, 160) || "authenticated_manager";
  const reviewNotes = notes == null ? null : String(notes).trim().slice(0, 2000) || null;
  const before = await getGuestCleanlinessReportById(reportId);
  if (before.status !== "pending_marketing_review" || before.marketing_review_status !== "pending") {
    throw Object.assign(new Error("Guest report is not awaiting Marketing review."), { status: 409 });
  }
  if (normalizedAction === "approve") {
    await runOperationalCommand("guest_report_review", { id: reportId, action: "approve", actor: reviewedBy, notes: reviewNotes });
  } else {
    await runOperationalCommand("guest_report_review", { id: reportId, action: "reject", actor: reviewedBy, notes: reviewNotes });
  }
  const reviewed = await getGuestCleanlinessReportById(reportId);
  if (reviewed.marketing_review_status !== (normalizedAction === "approve" ? "approved" : "rejected")) {
    throw Object.assign(new Error("Guest Marketing review did not complete."), { status: 409 });
  }
  return reviewed;
}

async function resolveGuestCleanlinessReport(reportId, { actor, notes = null } = {}) {
  if (!isUuid(reportId)) throw Object.assign(new Error("Guest report id is invalid."), { status: 422 });
  const resolvedBy = String(actor || "authenticated_manager").trim().slice(0, 160) || "authenticated_manager";
  const closeNotes = notes == null ? null : String(notes).trim().slice(0, 2000) || null;
  const before = await getGuestCleanlinessReportById(reportId);
  if (before.status !== "open" || before.marketing_review_status !== "approved") {
    throw Object.assign(new Error("Only an approved open guest report can be resolved."), { status: 409 });
  }
  await runOperationalCommand("guest_report_resolve", { id: reportId, actor: resolvedBy, notes: closeNotes });
  const resolved = await getGuestCleanlinessReportById(reportId);
  if (resolved.status !== "resolved") throw Object.assign(new Error("Guest report resolution did not complete."), { status: 409 });
  return resolved;
}

async function ensureSystemFeedbackSchema() {
  if (feedbackSchemaEnsured) return;
  if (feedbackSchemaEnsurePromise) return feedbackSchemaEnsurePromise;
  feedbackSchemaEnsurePromise = (async () => {
    const rows = await runReadOnlySql(`
      select
        to_regclass('public.system_feedback_items') is not null as table_present,
        exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = 'system_feedback_items'
            and column_name = 'metadata_json'
        ) as metadata_column_present
    `);
    if (!rows?.[0]?.table_present || !rows?.[0]?.metadata_column_present) {
      throw new Error("Required table public.system_feedback_items is missing or incomplete. Apply source-controlled migrations.");
    }
    feedbackSchemaEnsured = true;
  })();
  try {
    await feedbackSchemaEnsurePromise;
  } finally {
    feedbackSchemaEnsurePromise = null;
  }
}

function normalizeFeedbackCategory(value) {
  const category = String(value || "other").trim().toLowerCase().replace(/[^a-z0-9_ -]/g, "").replace(/\s+/g, "_");
  return category || "other";
}

function normalizeFeedbackPriority(value) {
  const priority = String(value || "normal").trim().toLowerCase();
  if (["low", "normal", "high", "urgent"].includes(priority)) return priority;
  return "normal";
}

function getFeedbackPublicOrigin() {
  return String(process.env.FEEDBACK_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.SCHEDULE_PUBLIC_BASE_URL || "https://memphis-zoo-mcp.onrender.com").replace(/\/+$/, "");
}

function buildSystemFeedbackAckUrl(feedbackId) {
  const id = String(feedbackId || "");
  const token = signFeedbackLinkToken(id, "ack");
  const suffix = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${getFeedbackPublicOrigin()}/feedback-api/acknowledge/${encodeURIComponent(id)}${suffix}`;
}

function buildSystemFeedbackImageUrl(feedbackId) {
  const id = String(feedbackId || "");
  const token = signFeedbackLinkToken(id, "image");
  const suffix = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${getFeedbackPublicOrigin()}/feedback-api/image/${encodeURIComponent(id)}${suffix}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
}

function getSystemFeedbackMetadata(item) {
  const value = item?.metadata_json;
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return {};
}

function validateSystemFeedbackImageAttachment(input) {
  if (!input) return null;
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("image_attachment must be an object.");
  const dataUrl = String(input.data_url || input.dataUrl || "").trim();
  const type = String(input.type || input.mime_type || "").trim().toLowerCase();
  const name = String(input.name || input.filename || "feedback-image").replace(/[\r\n]/g, " ").trim().slice(0, 180) || "feedback-image";
  const dataUrlMatch = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([a-z0-9+/=\s]+)$/i);
  if (!dataUrlMatch) throw new Error("image_attachment must be a base64 data URL for png, jpg, webp, or gif.");
  const mimeType = (type && type.startsWith("image/") ? type : dataUrlMatch[1]).replace("image/jpg", "image/jpeg");
  const base64 = dataUrlMatch[2].replace(/\s+/g, "");
  const size = Number(input.size || Math.floor((base64.length * 3) / 4)) || 0;
  if (size > FEEDBACK_IMAGE_MAX_BYTES) throw new Error("image_attachment is too large. Maximum size is 5 MB.");
  const body = Buffer.from(base64, "base64");
  const signatures = {
    "image/png": (value) => value.length >= 8 && value.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),
    "image/jpeg": (value) => value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff,
    "image/gif": (value) => value.length >= 6 && ["GIF87a","GIF89a"].includes(value.subarray(0, 6).toString("ascii")),
    "image/webp": (value) => value.length >= 12 && value.subarray(0, 4).toString("ascii") === "RIFF" && value.subarray(8, 12).toString("ascii") === "WEBP",
  };
  if (!body.length || !signatures[mimeType]?.(body)) throw new Error("image_attachment content does not match its declared image type.");
  return {
    name,
    type: mimeType,
    size,
    base64,
    sha256: createHash("sha256").update(body).digest("hex"),
    uploaded_at: new Date().toISOString(),
  };
}

async function storeSystemFeedbackImageAttachment(feedbackId, operationId, imageAttachment) {
  if (!imageAttachment) return null;
  if (!supabaseAdmin) throw new Error("Feedback image storage is not configured.");
  const extension = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  }[imageAttachment.type] || "bin";
  const objectPath = `feedback/${operationId}/${imageAttachment.sha256}.${extension}`;
  const body = Buffer.from(String(imageAttachment.base64 || ""), "base64");
  if (!body.length || body.length > FEEDBACK_IMAGE_MAX_BYTES) throw new Error("image_attachment is empty or too large.");
  const { error } = await supabaseAdmin.storage
    .from(FEEDBACK_IMAGE_BUCKET)
    .upload(objectPath, body, {
      contentType: imageAttachment.type,
      upsert: false,
      cacheControl: "private, max-age=3600",
    });
  if (error && !/already exists|duplicate/i.test(String(error.message || ""))) throw new Error(error.message || "Feedback image upload failed.");
  return {
    name: imageAttachment.name,
    type: imageAttachment.type,
    size: body.length,
    storage_bucket: FEEDBACK_IMAGE_BUCKET,
    storage_path: objectPath,
    uploaded_at: imageAttachment.uploaded_at,
    _newly_uploaded: !error,
  };
}

async function removeUnreferencedSystemFeedbackImage(imageAttachment) {
  if (!imageAttachment?._newly_uploaded || !imageAttachment.storage_path || !supabaseAdmin) return;
  try {
    const rows = await runReadOnlySql(`
      select exists (
        select 1
        from public.system_feedback_items
        where metadata_json->'image_attachment'->>'storage_path' = ${sqlLiteral(imageAttachment.storage_path)}
      ) as referenced
    `);
    if (rows?.[0]?.referenced) return;
    const { error } = await supabaseAdmin.storage
      .from(imageAttachment.storage_bucket || FEEDBACK_IMAGE_BUCKET)
      .remove([imageAttachment.storage_path]);
    if (error) console.error("feedback image orphan cleanup failed:", error.message || "storage remove failed");
  } catch (error) {
    console.error("feedback image orphan cleanup failed:", error?.message || "unknown cleanup error");
  }
}

function persistedSystemFeedbackImageMetadata(imageAttachment) {
  if (!imageAttachment) return null;
  const { _newly_uploaded, ...persisted } = imageAttachment;
  return persisted;
}

async function migrateLegacySystemFeedbackImageJob(job) {
  const feedbackId = String(job?.source_id || "").trim();
  if (!isUuid(feedbackId)) throw new Error("Legacy feedback image job has an invalid feedback id.");
  const rows = await runReadOnlySql(`
    select id, operation_id, metadata_json
    from public.system_feedback_items
    where id = ${sqlLiteral(feedbackId)}::uuid
    limit 1
  `);
  const item = rows?.[0];
  if (!item) return { migrated: false, reason: "feedback_missing" };
  const metadata = getSystemFeedbackMetadata(item);
  const legacy = metadata?.image_attachment?.data_url;
  if (!legacy) return { migrated: false, reason: "already_migrated_or_no_image" };
  const validatedImage = validateSystemFeedbackImageAttachment(metadata.image_attachment);
  const storedImage = await storeSystemFeedbackImageAttachment(
    feedbackId,
    `legacy-${feedbackId}`,
    validatedImage,
  );
  const persistedImage = persistedSystemFeedbackImageMetadata(storedImage);
  const updatedMetadata = { ...metadata, image_attachment: persistedImage };
  try {
    await runOperationalCommand("feedback_legacy_image_migration", {
      id: feedbackId, metadata_json: updatedMetadata,
      storage_bucket: persistedImage.storage_bucket, storage_path: persistedImage.storage_path,
    });
  } catch (error) {
    await removeUnreferencedSystemFeedbackImage(storedImage);
    throw error;
  }
  return { migrated: true, feedback_id: feedbackId };
}

registerOperationalNotificationJobHandler("feedback_image_migration", migrateLegacySystemFeedbackImageJob);

function summarizeSystemFeedback({ category, priority, message, hubContext, submittedBy }) {
  const cleanMessage = String(message || "").replace(/\s+/g, " ").trim();
  const clipped = cleanMessage.length > 220 ? `${cleanMessage.slice(0, 217)}...` : cleanMessage;
  const who = submittedBy ? ` from ${submittedBy}` : "";
  return `${priority.toUpperCase()} ${category.replace(/_/g, " ")} feedback${who} via ${hubContext}: ${clipped}`;
}

async function createSystemFeedbackItem(payload = {}) {
  const normalized = normalizeFeedbackInput(payload);
  const { category, priority, message, submittedBy, hubContext, deviceId, pageUrl } = normalized;
  const feedbackId = randomUUID();
  const operationId = String(payload.operation_id || payload.operationId || "").trim();
  if (!isUuid(operationId)) throw Object.assign(new Error("operation_id must be a UUID."), { status: 422 });
  const validatedImage = validateSystemFeedbackImageAttachment(payload.image_attachment || payload.image || null);
  const requestFingerprint = stableRequestFingerprint({
    category,
    priority,
    message,
    submittedBy,
    hubContext,
    deviceId,
    pageUrl,
    imageSha256: validatedImage?.sha256 || null,
  });
  const existingRows = await runReadOnlySql(`
    select id, operation_id, request_fingerprint, category, priority, message, submitted_by,
           hub_context, device_id, page_url, status, summary, notification_status,
           notified_ops_count, last_feedback_reminder_at, feedback_reminder_count,
           acknowledged_at, acknowledged_by, metadata_json, created_at, updated_at
    from public.system_feedback_items
    where operation_id = ${sqlLiteral(operationId)}::uuid
    limit 1
  `);
  if (Array.isArray(existingRows) && existingRows.length) {
    if (existingRows[0].request_fingerprint && existingRows[0].request_fingerprint !== requestFingerprint) {
      throw Object.assign(new Error("operation_id conflicts with another feedback submission."), { status: 409 });
    }
    return { ...existingRows[0], newly_inserted: false };
  }
  const imageAttachment = await storeSystemFeedbackImageAttachment(
    feedbackId,
    operationId,
    validatedImage,
  );
  const metadata = {
    submitted_via: "system_feedback",
    user_agent: String(payload.user_agent || "").slice(0, 500) || null,
    page_title: String(payload.page_title || "").slice(0, 200) || null,
    image_attachment: persistedSystemFeedbackImageMetadata(imageAttachment),
  };
  const summary = summarizeSystemFeedback({ category, priority, message, hubContext, submittedBy });
  try {
    await runOperationalCommand("feedback_create", {
      id: feedbackId, operation_id: operationId, request_fingerprint: requestFingerprint,
      category, priority, message, submitted_by: submittedBy, hub_context: hubContext,
      device_id: deviceId, page_url: pageUrl, summary, metadata_json: metadata,
    });

    const rows = await runReadOnlySql(`
      select id, operation_id, request_fingerprint, category, priority, message, submitted_by, hub_context, device_id, page_url,
             status, summary, notification_status, notified_ops_count, last_feedback_reminder_at,
             feedback_reminder_count, acknowledged_at, acknowledged_by, metadata_json, created_at, updated_at
      from public.system_feedback_items
      where operation_id = ${sqlLiteral(operationId)}::uuid
      limit 1
    `);
    if (!Array.isArray(rows) || !rows.length) throw new Error("System feedback could not be created.");
    if (rows[0].request_fingerprint && rows[0].request_fingerprint !== requestFingerprint) {
      throw Object.assign(new Error("operation_id conflicts with another feedback submission."), { status: 409 });
    }
    return { ...rows[0], newly_inserted: rows[0].id === feedbackId };
  } catch (error) {
    await removeUnreferencedSystemFeedbackImage(imageAttachment);
    throw error;
  }
}

function buildSystemFeedbackNotificationBody(item, { reminder = false } = {}) {
  const category = String(item.category || "feedback").replace(/_/g, " ");
  const who = item.submitted_by ? ` Submitted by: ${item.submitted_by}.` : "";
  const device = item.device_id ? ` Device: ${item.device_id}.` : "";
  const image = getSystemFeedbackMetadata(item).image_attachment ? ` Image: ${buildSystemFeedbackImageUrl(item.id)}.` : "";
  const ack = item.id ? ` Acknowledge: ${buildSystemFeedbackAckUrl(item.id)}.` : "";
  const prefix = reminder ? "Reminder: unacknowledged program feedback is still open." : "Program feedback submitted.";
  return `${prefix} Priority: ${String(item.priority || "normal").toUpperCase()}. Category: ${category}. Hub: ${item.hub_context || "unknown"}.${who}${device}${image}${ack} Message: ${item.message}`.trim();
}

async function notifySystemFeedbackRecipients({ item, opsRecipients, memphisUserId, reminder = false }) {
  const notified = { ops_count: 0, errors: [] };
  const body = buildSystemFeedbackNotificationBody(item, { reminder });
  const eligibleRecipients = (opsRecipients || []).filter((ops) => isUuid(ops.user_id));
  const sendResults = await Promise.allSettled(eligibleRecipients.map(async (ops) => {
    const thread = await runRpc("msg_get_or_create_direct_thread", { p_user_a: memphisUserId, p_user_b: ops.user_id });
    await runRpc("msg_send_message", {
      p_thread_id: thread.id,
      p_sender_user_id: memphisUserId,
      p_body: body,
      p_message_type: "bot_response",
      p_metadata_json: {
        channel: "memphis",
        source: "system_feedback",
        feedback_id: item.id,
        priority: item.priority,
        category: item.category,
        reminder,
      },
    });
    return ops;
  }));
  for (let i = 0; i < eligibleRecipients.length; i++) {
    const result = sendResults[i];
    if (result.status === "fulfilled") {
      notified.ops_count += 1;
    } else {
      notified.errors.push({ user_id: eligibleRecipients[i].user_id, error: result.reason?.message || "notification_failed" });
    }
  }

  await runOperationalCommand("feedback_notification", {
    id: item.id,
    notification_status: eligibleRecipients.length === 0 ? "failed" : (notified.errors.length === 0 ? "sent" : (notified.ops_count ? "partial" : "failed")),
    notified_ops_count: Number(notified.ops_count || 0), reminder_increment: reminder ? 1 : 0,
    notification_errors: notified.errors,
  });

  return notified;
}

async function listSystemFeedbackItems({ status, priority, hubContext, limit = 100 } = {}) {
  const filters = [];
  if (status) filters.push(`status = ${sqlLiteral(String(status).trim().toLowerCase())}`);
  if (priority) filters.push(`priority = ${sqlLiteral(normalizeFeedbackPriority(priority))}`);
  if (hubContext) filters.push(`hub_context = ${sqlLiteral(String(hubContext).trim().toLowerCase())}`);
  const where = filters.length ? `where ${filters.join(" and ")}` : "";
  const rows = await runReadOnlySql(`
    select id, category, priority, message, submitted_by, hub_context, device_id, page_url,
           status, summary, notification_status, notified_ops_count, last_feedback_reminder_at,
           feedback_reminder_count, acknowledged_at, acknowledged_by, metadata_json, created_at, updated_at
    from public.system_feedback_items
    ${where}
    order by created_at desc
    limit ${Math.max(1, Math.min(500, Number(limit) || 100))}
  `);
  return Array.isArray(rows) ? rows : [];
}

async function getSystemFeedbackItemById(feedbackId) {
  if (!isUuid(feedbackId)) throw new Error("feedback id is invalid.");
  const rows = await runReadOnlySql(`
    select id, category, priority, message, submitted_by, hub_context, device_id, page_url,
           status, summary, notification_status, notified_ops_count, last_feedback_reminder_at,
           feedback_reminder_count, acknowledged_at, acknowledged_by, metadata_json, created_at, updated_at
    from public.system_feedback_items
    where id = ${sqlLiteral(feedbackId)}::uuid
    limit 1
  `);
  if (!Array.isArray(rows) || !rows.length) throw new Error("System feedback item not found.");
  return rows[0];
}

async function acknowledgeSystemFeedbackItem(feedbackId, acknowledgedBy = "ops_manager") {
  if (!isUuid(feedbackId)) throw new Error("feedback id is invalid.");
  const actor = String(acknowledgedBy || "ops_manager").trim().slice(0, 120) || "ops_manager";
  await runOperationalCommand("feedback_status", {
    id: feedbackId, status: "acknowledged", actor, metadata_patch: { acknowledged_via: "feedback-api" },
  });
  return getSystemFeedbackItemById(feedbackId);
}

async function setSystemFeedbackStatus(feedbackId, status, actor = "ops_manager") {
  if (!isUuid(feedbackId)) throw Object.assign(new Error("feedback id is invalid."), { status: 422 });
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (!["acknowledged", "resolved"].includes(normalizedStatus)) throw Object.assign(new Error("status must be acknowledged or resolved."), { status: 422 });
  const changedBy = String(actor || "ops_manager").trim().slice(0, 160) || "ops_manager";
  const before = await getSystemFeedbackItemById(feedbackId);
  if (["closed", "resolved"].includes(before.status)) {
    throw Object.assign(new Error("Feedback item is already resolved or unavailable."), { status: 409 });
  }
  await runOperationalCommand("feedback_status", {
    id: feedbackId, status: normalizedStatus, actor: changedBy,
    metadata_patch: { status_changed_via: "manager_feedback_inbox", status_changed_by: changedBy },
  });
  const changed = await getSystemFeedbackItemById(feedbackId);
  if (changed.status !== normalizedStatus) throw Object.assign(new Error("Feedback status update did not complete."), { status: 409 });
  return changed;
}

async function listSystemFeedbackReminderDueItems({ limit = 25 } = {}) {
  const rows = await runReadOnlySql(`
    select id, category, priority, message, submitted_by, hub_context, device_id, page_url,
           status, summary, notification_status, notified_ops_count, last_feedback_reminder_at,
           feedback_reminder_count, acknowledged_at, acknowledged_by, metadata_json, created_at, updated_at
    from public.system_feedback_items
    where status not in ('acknowledged', 'resolved', 'closed', 'reminder_exhausted')
      and feedback_reminder_count < ${Number(FEEDBACK_REMINDER_MAX_COUNT)}
      and (last_feedback_reminder_at is null or last_feedback_reminder_at <= now() - interval '10 minutes')
    order by coalesce(last_feedback_reminder_at, created_at) asc
    limit ${Math.max(1, Math.min(100, Number(limit) || 25))}
  `);
  return Array.isArray(rows) ? rows : [];
}

async function markSystemFeedbackReminderExhausted(item, reason = "max_reminders_reached") {
  if (!item?.id) return null;
  await runOperationalCommand("feedback_reminder_exhausted", { id: item.id, reason });
  return { ...item, status: "reminder_exhausted" };
}

async function runSystemFeedbackReminderSweep() {
  // Dashboard-only: reminders are surfaced via the dashboard, not via Messenger.
  // The schema and reminder-count logic exist for future activation, but the
  // contract test explicitly requires that this sweep does NOT send messages.
  if (feedbackReminderSweepInFlight) return { ok: true, skipped: "in_flight" };
  feedbackReminderSweepInFlight = true;
  try {
    await ensureSystemFeedbackSchema();
    return { ok: true, checked: 0, reminded: 0, skipped: "dashboard_only" };
  } finally {
    feedbackReminderSweepInFlight = false;
  }
}

async function runPublicDashboardSummary() {
  const [snapshotRows, locationRows, ticketRows] = await Promise.all([
    runReadOnlySql(`
      select snapshot_at, operational_day_start, active_sessions, pending_submit_sessions, closed_sessions_today, open_ticket_count,
             overdue_locations, due_soon_locations, in_progress_locations, active_locations, operational_day_start::text as operational_day_start_text
      from public.v_admin_health_snapshot
      order by snapshot_at desc
      limit 1
    `),
    runReadOnlySql(`
      select location_code, location_name, location_type, form_type, latest_employee_name, latest_completed_at,
             latest_completed_at_display, services_performed, open_ticket_count, status_code, status_color, duration_display,
             open_session_status, open_session_employee_name
      from public.v_location_dashboard_status
      order by case status_color when 'red' then 1 when 'yellow' then 2 when 'blue' then 3 when 'green' then 4 when 'black' then 5 else 9 end,
               open_ticket_count desc, location_name
    `),
    runReadOnlySql(`
      select ticket_id, location_code, location_name, maintenance_issue, reported_by, fixture_type, fixture_identifier,
             out_of_order, date_submitted_display, created_at_display
      from public.v_open_maintenance_tickets
      order by date_submitted desc nulls last, created_at desc nulls last, location_code
    `),
  ]);

  const snapshot = Array.isArray(snapshotRows) && snapshotRows.length ? snapshotRows[0] : {};
  const locations = Array.isArray(locationRows) ? locationRows : [];
  const tickets = Array.isArray(ticketRows) ? ticketRows : [];
  return {
    snapshot,
    meta: {
      app: "memphis-zoo-mcp",
      version: APP_VERSION,
      release_id: RELEASE_ID,
      contracts: {
        scan: SCAN_CONTRACT_VERSION,
        dashboard: DASHBOARD_CONTRACT_VERSION,
        messaging: MESSAGING_CONTRACT_VERSION,
        schedule: SCHEDULE_CONTRACT_VERSION,
        events: EVENTS_CONTRACT_VERSION,
      },
      generated_at: new Date().toISOString(),
    },
    restrooms: locations.filter((row) => String(row.location_type || row.form_type || "").toLowerCase() === "restroom"),
    exhibits: locations.filter((row) => String(row.location_type || row.form_type || "").toLowerCase() !== "restroom"),
    open_tickets: tickets,
  };
}

async function runCanaryChecks() {
  const checks = {};
  const failures = [];

  async function safeCheck(name, fn) {
    try {
      const result = await fn();
      checks[name] = { ok: true, ...result };
      return true;
    } catch (error) {
      const message = error?.message || String(error);
      checks[name] = { ok: false, error: message };
      failures.push(`${name}: ${message}`);
      return false;
    }
  }

  await safeCheck("restroom_scan_state", async () => {
    const state = await runRpc("tool_get_location_scan_state", {
      p_location_code: CANARY_RESTROOM_CODE,
      p_device_id: HEALTH_PROBE_DEVICE_ID,
    });
    if (!state || state.location_code !== CANARY_RESTROOM_CODE) throw new Error("restroom scan state missing expected location code");
    if (String(state.form_type || state.location_type || "").toLowerCase() !== "restroom") throw new Error(`expected restroom form_type, got ${state.form_type || state.location_type || "unknown"}`);
    return { location_code: state.location_code, form_type: state.form_type || null, location_type: state.location_type || null, suggested_action: state.suggested_action || null };
  });

  await safeCheck("exhibit_scan_state", async () => {
    const state = await runRpc("tool_get_location_scan_state", {
      p_location_code: CANARY_EXHIBIT_CODE,
      p_device_id: HEALTH_PROBE_DEVICE_ID,
    });
    if (!state || state.location_code !== CANARY_EXHIBIT_CODE) throw new Error("exhibit scan state missing expected location code");
    if (String(state.form_type || state.location_type || "").toLowerCase() !== "exhibit") throw new Error(`expected exhibit form_type, got ${state.form_type || state.location_type || "unknown"}`);
    return { location_code: state.location_code, form_type: state.form_type || null, location_type: state.location_type || null, suggested_action: state.suggested_action || null };
  });

  await safeCheck("dashboard_summary", async () => {
    const summary = await runPublicDashboardSummary();
    if (!summary || !summary.meta || summary.meta.version !== APP_VERSION) throw new Error("dashboard summary missing expected meta version");
    if (!Array.isArray(summary.restrooms) || !Array.isArray(summary.exhibits) || !Array.isArray(summary.open_tickets)) throw new Error("dashboard summary missing expected arrays");
    const restroomFound = summary.restrooms.some((row) => row.location_code === CANARY_RESTROOM_CODE);
    const exhibitFound = summary.exhibits.some((row) => row.location_code === CANARY_EXHIBIT_CODE);
    if (!restroomFound) throw new Error(`restroom canary ${CANARY_RESTROOM_CODE} not found in restroom rows`);
    if (!exhibitFound) throw new Error(`exhibit canary ${CANARY_EXHIBIT_CODE} not found in exhibit rows`);
    return { restrooms_count: summary.restrooms.length, exhibits_count: summary.exhibits.length, open_tickets_count: summary.open_tickets.length };
  });

  await safeCheck("open_session_consistency", async () => {
    const rows = await runReadOnlySql(`
      select count(*)::int as inconsistent_count
      from public.v_location_dashboard_status
      where (open_session_status in ('active','pending_submit') and open_session_employee_name is null)
         or (open_session_status is null and open_session_employee_name is not null)
    `);
    const inconsistentCount = Array.isArray(rows) && rows.length ? Number(rows[0].inconsistent_count || 0) : 0;
    if (inconsistentCount !== 0) throw new Error(`found ${inconsistentCount} inconsistent open session rows`);
    return { inconsistent_count: inconsistentCount };
  });

  await safeCheck("ticket_count_consistency", async () => {
    const rows = await runReadOnlySql(`
      select
        (select count(*)::int from public.v_open_maintenance_tickets) as view_count,
        (select count(*)::int from public.maintenance_tickets where status = 'open') as table_count
    `);
    const row = Array.isArray(rows) && rows.length ? rows[0] : {};
    const viewCount = Number(row.view_count || 0);
    const tableCount = Number(row.table_count || 0);
    if (viewCount !== tableCount) throw new Error(`ticket counts differ: view=${viewCount}, table=${tableCount}`);
    return { view_count: viewCount, table_count: tableCount };
  });

  return {
    ok: failures.length === 0,
    checks,
    failure_count: failures.length,
    failures,
  };
}

function createMcpServer({ readOnly = false } = {}) {
  return createCanonicalMcpServer({
    name: process.env.APP_NAME,
    version: RELEASE_ID,
    releaseId: RELEASE_ID,
    readOnly,
  });
}

installSharedAuthRoutes(app, { setCors: setAdminApiCors, supabase: supabaseAdmin, trustedDeviceStore: opsTrustedDeviceStore });
installDeviceCredentialRoutes(app, {
  setCors: setAdminApiCors,
  supabase: supabaseAdmin,
  runReadOnlySql,
  requireOpsAuth: requireOpsManagerAuth,
  requireOpsWrite: requireOpsManagerWrite,
});

// Production integrations are installed explicitly at their canonical route
// boundary. Startup must never depend on prototype interception or import-order
// side effects.
installAnnieMoxieRoutes(app, { supabase: supabaseAdmin });
installLeadershipHttpRoutes(app, { supabase: supabaseAdmin });
installCustodialEmployeeAdminRoutes(app, { supabase: supabaseAdmin });
const managerNotificationRuntime = installManagerNotificationRoutes(app, { supabase: supabaseAdmin });
installEmployeeNotificationRoutes(app, {
  supabase: supabaseAdmin,
  pushRuntime: managerNotificationRuntime,
  runReadOnlySql: async (sql) => runSupabaseReadOnlySql({ sql }).then((result) => result.rows),
  requireManager: requireOpsManagerWrite,
  registerOperationalJobHandler: registerOperationalNotificationJobHandler,
});
installOperationalAnalyticsRoutes(app, { supabase: supabaseAdmin });
app.get("/mcp-tools.json", requireOpsManagerAuth, (_req, res) => {
  res.status(200).json(getToolManifest({ includePlanned: true }));
});
app.get("/status/deep", requireOpsManagerAuth, (_req, res) => {
  const env = validateRuntimeEnv({ strict: false });
  res.status(env.ok ? 200 : 503).json({
    ok: env.ok,
    app: {
      name: process.env.APP_NAME || "memphis-zoo-mcp",
      version: RELEASE_ID,
      release_id: RELEASE_ID,
    },
    env,
    tools: getToolManifest({ includePlanned: true }),
    generated_at: new Date().toISOString(),
  });
});

app.use(MOXIE_MOUNT_PATH, createMoxieRouter({ supabase: supabaseAdmin, staticDir: MOXIE_STATIC_DIR }));

app.use("/admin-api", (req, res, next) => { setAdminApiCors(res, req); if (req.method === "OPTIONS") { res.sendStatus(200); return; } next(); });
app.use("/dashboard-api", (req, res, next) => { setPublicDashboardCors(res, req); if (req.method === "OPTIONS") { res.sendStatus(200); return; } next(); });
app.use("/scan-api", (req, res, next) => { setScanApiCors(res, req); if (req.method === "OPTIONS") { res.sendStatus(200); return; } next(); });
app.use("/messaging-api", (req, res, next) => { setMessagingApiCors(res, req); if (req.method === "OPTIONS") { res.sendStatus(200); return; } next(); }, createMessagingRouter({ runReadOnlySql, runRpc, buildHealthPayload, requireDeviceAccess: requireDeviceOrOpsAccess, requireOpsManagerAuth, registerOperationalJobHandler: registerOperationalNotificationJobHandler, appVersion: APP_VERSION, releaseId: RELEASE_ID, contractVersion: MESSAGING_CONTRACT_VERSION }));
app.use("/schedule-api", (req, res, next) => { setScheduleApiCors(res, req); if (req.method === "OPTIONS") { res.sendStatus(200); return; } next(); }, createScheduleRouter({ runReadOnlySql, runRpc, runCommand: runScheduleCommand, buildHealthPayload, requireAdminApiAuth: requireOpsManagerWrite, requireOpsManagerAuth, requireDeviceAccess: requireDeviceOrOpsAccess, publicTrafficRateLimit: publicSubmissionRateLimit, appVersion: APP_VERSION, releaseId: RELEASE_ID, contractVersion: SCHEDULE_CONTRACT_VERSION }));
app.use("/guest-api", (req, res, next) => { setGuestApiCors(res, req); if (req.method === "OPTIONS") { res.sendStatus(200); return; } next(); });
app.use("/feedback-api", (req, res, next) => { setFeedbackApiCors(res, req); if (req.method === "OPTIONS") { res.sendStatus(200); return; } next(); });
app.use(
  "/gemini-api",
  (req, res, next) => { setGeminiApiCors(res, req); if (req.method === "OPTIONS") { res.sendStatus(200); return; } next(); },
  createGeminiConsoleRouter({
    supabase: supabaseAdmin,
    runReadOnlySql,
    requireOpsManagerAuth,
    buildHealthPayload,
    appVersion: APP_VERSION,
    releaseId: RELEASE_ID,
    schemaFingerprint: buildReleaseManifest({ appVersion: APP_VERSION, releaseId: RELEASE_ID }).schema.fingerprint,
    backendCommit: BACKEND_COMMIT_SHA,
    frontendCommit: buildReleaseManifest({ appVersion: APP_VERSION, releaseId: RELEASE_ID }).frontend.commit_sha,
  }),
);
app.use("/dashboard-api/events", createEventsPublicRouter({ runReadOnlySql, runCommand: runEventCommand, buildHealthPayload, appVersion: APP_VERSION, releaseId: RELEASE_ID, maintenanceController: eventMaintenanceController }));
app.use("/admin-api/events", createEventsAdminRouter({ runReadOnlySql, runCommand: runEventCommand, buildHealthPayload, appVersion: APP_VERSION, releaseId: RELEASE_ID, maintenanceController: eventMaintenanceController, requireAdminApiAuth: requireOpsManagerAuth, requireAdminApiWrite: requireOpsManagerWrite }));
app.use(["/version", "/release-manifest", "/scheduler-runtime-config", "/health", "/health/dependencies"], (req, res, next) => {
  setPublicDashboardCors(res, req);
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});
app.get("/version", (_req, res) => { setPublicDashboardCors(res, _req); res.status(200).json(buildHealthPayload("version")); });
app.get("/release-manifest", (_req, res) => { setPublicDashboardCors(res, _req); res.status(200).json(buildReleaseManifest({ appVersion: APP_VERSION, releaseId: RELEASE_ID, contracts: buildHealthPayload("contracts").contracts })); });
app.get("/scheduler-runtime-config", (req, res) => {
  setPublicDashboardCors(res, req);
  try {
    const publicUrl = staticWeeklyControlPlanePublicUrl();
    res.status(publicUrl ? 200 : 503).json({
      ok: Boolean(publicUrl),
      data: { configured: Boolean(publicUrl), public_url: publicUrl },
      meta: { version: APP_VERSION, release_id: RELEASE_ID },
      ...(publicUrl ? {} : { error: "The weekly scheduler service is not configured." }),
    });
  } catch (error) {
    res.status(503).json({ ok: false, data: { configured: false, public_url: null }, error: error.message });
  }
});
app.get(["/health", "/health/dependencies"], async (req, res) => {
  setPublicDashboardCors(res, req);
  try {
    const canaryDeviceId = configuredReleaseCanaryDeviceId();
    const rows = await runReadOnlySql(`
      select
        true as database_reachable,
        to_regclass('public.sessions') is not null as sessions_table,
        to_regclass('public.msg_messages') is not null as messages_table,
        to_regclass('public.operational_notification_jobs') is not null as notification_outbox_table,
        to_regclass('public.msg_message_audit') is not null as message_audit_table,
        to_regprocedure('public.tool_finish_session_exact(text,text,uuid,timestamp with time zone)') is not null as exact_finish_rpc,
        to_regprocedure('public.msg_ensure_ops_manager_user(uuid)') is not null as manager_messaging_rpc,
        to_regprocedure('public.claim_operational_notification_jobs(text,integer,integer)') is not null as worker_claim_rpc,
        (select count(*)::int from public.operational_notification_jobs where status in ('pending','leased')) as notification_backlog,
        (select count(*)::int from public.operational_notification_jobs where status = 'dead') as notification_dead_letters,
        (select count(*)::int from public.operational_notification_jobs where status = 'leased' and leased_until < now()) as expired_worker_leases
    `);
    const dependencies = rows?.[0] || {};
    let canaryPaused = null;
    let canaryControlInitialized = false;
    if (canaryDeviceId) {
      canaryPaused = await runRpc("custodial_release_canary_is_paused", {
        p_device_identifier: canaryDeviceId,
        p_backend_execution_secret: offlineAuthoritySecret(),
      });
      canaryControlInitialized = typeof canaryPaused === "boolean";
    }
    const requiredSchemaPresent = [
      "sessions_table",
      "messages_table",
      "notification_outbox_table",
      "message_audit_table",
      "exact_finish_rpc",
      "manager_messaging_rpc",
      "worker_claim_rpc",
    ].every((key) => dependencies[key] === true);
    const canaryReady = !releaseCanaryConfigurationRequired()
      || (Boolean(canaryDeviceId) && canaryControlInitialized && canaryPaused === false);
    const ok = dependencies.database_reachable === true && requiredSchemaPresent && canaryReady;
    res.status(ok ? 200 : 503).json(buildHealthPayload("dependencies", {
      ok,
      process_alive: true,
      database_reachable: dependencies.database_reachable === true,
      required_schema_present: requiredSchemaPresent,
      release_canary: {
        configured: Boolean(canaryDeviceId),
        device_identifier: canaryDeviceId,
        control_initialized: canaryControlInitialized,
        paused: canaryPaused,
      },
      worker: {
        durable_database_leases: dependencies.worker_claim_rpc === true,
        backlog: Number(dependencies.notification_backlog || 0),
        dead_letters: Number(dependencies.notification_dead_letters || 0),
        expired_leases: Number(dependencies.expired_worker_leases || 0),
      },
      schema_fingerprint: buildReleaseManifest({ appVersion: APP_VERSION, releaseId: RELEASE_ID }).schema.fingerprint,
    }));
  } catch (error) {
    res.status(503).json(buildHealthPayload("dependencies", {
      ok: false,
      process_alive: true,
      database_reachable: false,
      required_schema_present: false,
      error: "Dependency verification failed.",
    }));
  }
});
app.get("/admin-api/health", requireOpsManagerAuth, (_req, res) => { res.status(200).json(buildHealthPayload("admin", { authenticated: true })); });
app.post("/admin-api/release-canary-rollback", requireOpsManagerWrite, async (req, res) => {
  try {
    const action = String(req.body?.action || "").trim();
    const reason = String(req.body?.reason || "").trim();
    const canaryDeviceId = configuredReleaseCanaryDeviceId();
    if (!canaryDeviceId) {
      throw Object.assign(new Error("No physical release canary is configured."), { status: 503, code: "release_canary_not_configured" });
    }
    if (!["pause_canary", "resume_canary", "restore_authority"].includes(action) || !reason) {
      throw Object.assign(new Error("action, reason, and the configured physical canary are required."), { status: 422 });
    }
    let authoritativeHealth;
    try {
      authoritativeHealth = await collectBackendAuthorityHealth();
    } catch (error) {
      // A missing or failing authoritative RPC is the reason this post-
      // enforcement safety control exists. Preserve its bounded evidence;
      // never route to a legacy/direct-SQL writer.
      authoritativeHealth = { ok: false, code: error?.code || "authority_probe_failed", message: String(error?.message || "authority probe failed") };
    }
    if (action === "resume_canary" && authoritativeHealth?.ok !== true) {
      throw Object.assign(new Error("The physical release canary cannot resume until database authority and scan RPC transport are healthy."), {
        status: 503,
        code: "release_canary_health_not_ready",
      });
    }
    const control = await runRpc("custodial_control_release_canary", {
      p_manager_id: offlineAuthorityManagerId(req), p_request_id: requiredRequestOperationId(req),
      p_device_identifier: canaryDeviceId, p_action: action, p_reason: reason, p_authoritative_health: authoritativeHealth,
      p_backend_execution_secret: offlineAuthoritySecret(),
    });
    if (action === "restore_authority") {
      authoritativeHealth = await collectBackendAuthorityHealth();
    }
    res.status(200).json({ ok: true, ...control, authoritative_health: authoritativeHealth });
  } catch (error) {
    const failure = authorityHttpFailure(error, "Canary rollback control is unavailable.");
    res.status(failure.status).json(failure.body);
  }
});
app.get("/admin-api/release-schema-identity", requireReleaseSchemaIdentityToken, async (_req, res) => {
  try {
    // This endpoint is intentionally authenticated and uses only the shared
    // SELECT-only executor. It reports a fingerprint calculated from the
    // connected catalog, never the source target fingerprint.
    const observed = await observeProductionSchemaIdentity({ runReadOnlySql: runSchemaCatalogSql });
    res.status(200).json({ ok: true, ...observed });
  } catch (error) {
    res.status(503).json({ ok: false, error: "Production schema identity observation failed." });
  }
});
app.get("/dashboard-api/health", (_req, res) => { res.status(200).json(buildHealthPayload("dashboard")); });
app.get("/schedule-api/health", (_req, res) => { res.status(200).json(buildHealthPayload("schedule", { contract_version: SCHEDULE_CONTRACT_VERSION })); });
app.get("/guest-api/health", (_req, res) => { res.status(200).json(buildHealthPayload("guest_reports", { contract_version: GUEST_REPORTS_CONTRACT_VERSION })); });
app.get("/feedback-api/health", (_req, res) => { res.status(200).json(buildHealthPayload("feedback", { contract_version: FEEDBACK_CONTRACT_VERSION })); });
app.get("/feedback-api/image/:feedbackId", requireFeedbackSignedLinkOrOps("image"), async (req, res) => {
  try {
    await ensureSystemFeedbackSchema();
    const item = await getSystemFeedbackItemById(String(req.params.feedbackId || ""));
    const image = getSystemFeedbackMetadata(item).image_attachment;
    if (image?.storage_bucket && image?.storage_path) {
      if (!supabaseAdmin) throw new Error("Feedback image storage is not configured.");
      const { data, error } = await supabaseAdmin.storage
        .from(String(image.storage_bucket))
        .download(String(image.storage_path));
      if (error) throw new Error(error.message || "Feedback image download failed.");
      const arrayBuffer = await data.arrayBuffer();
      res.setHeader("Content-Type", String(image.type || data.type || "application/octet-stream"));
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.status(200).send(Buffer.from(arrayBuffer));
      return;
    }
    const dataUrl = String(image?.data_url || "");
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([a-z0-9+/=\s]+)$/i);
    if (!match) {
      res.status(404).send("No feedback image found.");
      return;
    }
    const body = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
    res.setHeader("Content-Type", match[1].replace("image/jpg", "image/jpeg"));
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.status(200).send(body);
  } catch (error) {
    res.status(404).send(error?.message || "Feedback image lookup failed");
  }
});
app.get("/feedback-api/acknowledge/:feedbackId", requireFeedbackSignedLinkOrOps("ack"), async (req, res) => {
  try {
    await ensureSystemFeedbackSchema();
    const item = await getSystemFeedbackItemById(String(req.params.feedbackId || ""));
    const token = String(req.query.token || "");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirm feedback acknowledgement</title><style>body{font-family:Arial,sans-serif;background:#111827;color:#f8fafc;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:620px;padding:28px;border-radius:24px;background:rgba(8,17,29,.92);border:1px solid rgba(255,255,255,.14)}button{min-height:48px;border:0;border-radius:999px;padding:0 20px;background:#84c341;color:#102106;font-weight:900}</style></head><body><main class="card"><h1>Confirm acknowledgement</h1><p>${escapeHtml(item.summary || item.message || item.id)}</p><form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Acknowledge feedback</button></form></main></body></html>`);
  } catch (error) {
    res.status(404).send(error?.message || "Feedback acknowledgement failed");
  }
});
app.post("/feedback-api/acknowledge/:feedbackId", requireFeedbackSignedLinkOrOps("ack"), async (req, res) => {
  try {
    await ensureSystemFeedbackSchema();
    const actor = req.feedbackSignedLink
      ? "confirmed_signed_feedback_link"
      : String(req.memphisAuth?.manager_display_name || req.memphisAuth?.manager_id || "ops_manager");
    const item = await acknowledgeSystemFeedbackItem(String(req.params.feedbackId || ""), actor);
    if (/application\/json/i.test(String(req.get("accept") || "")) || /application\/json/i.test(String(req.get("content-type") || ""))) {
      res.status(200).json({ ok: true, data: item, meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: FEEDBACK_CONTRACT_VERSION } });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Feedback acknowledged</title></head><body><main><h1>Feedback acknowledged</h1><p>${escapeHtml(item.summary || item.id)}</p></main></body></html>`);
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || "Feedback acknowledgement failed" });
  }
});
app.post("/feedback-api/reminders/run", async (req, res) => {
  try {
    if (!requireFeedbackReminderSecret(req, res)) return;
    const result = await runSystemFeedbackReminderSweep();
    res.status(200).json({ ok: true, data: result, meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: FEEDBACK_CONTRACT_VERSION } });
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || "Feedback reminder sweep failed" });
  }
});
app.post("/feedback-api/submit", publicSubmissionRateLimit("feedback"), async (req, res) => {
  try {
    await ensureSystemFeedbackSchema();
    const operationId = requestOperationId(req);
    const item = await createSystemFeedbackItem({
      ...(req.body && typeof req.body === "object" ? req.body : {}),
      operation_id: operationId,
      user_agent: String(req.get("user-agent") || "").slice(0, 500),
    });
    await runOperationalCommand("feedback_dashboard_only", { id: item.id });
    item.notification_status = "dashboard_only";
    item.notified_ops_count = 0;
    const notification = { ops_count: 0, errors: [], skipped: "dashboard_only" };
    const safeItem = {
      id: item.id,
      operation_id: item.operation_id,
      status: item.status,
      notification_status: item.notification_status,
      created_at: item.created_at,
      newly_inserted: item.newly_inserted,
    };
    res.status(item.newly_inserted === false ? 200 : 201).json({ ok: true, data: { item: safeItem, notification }, meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: FEEDBACK_CONTRACT_VERSION } });
  } catch (error) {
    console.error("system feedback submit failed:", error);
    res.status(error?.status || 500).json({ ok: false, error: error?.message || "System feedback submit failed" });
  }
});
app.get("/guest-api/status", (_req, res) => {
  res.status(200).json({ ok: true, data: GUEST_FEATURE, meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: GUEST_REPORTS_CONTRACT_VERSION } });
});
app.get("/guest-api/locations/:locationCode", requireGuestIssuesApproved, async (req, res) => {
  try {
    const location = await resolveGuestReportLocation(req.params.locationCode);
    res.status(200).json({ ok: true, data: location, meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: GUEST_REPORTS_CONTRACT_VERSION } });
  } catch (error) {
    res.status(404).json({ ok: false, error: error?.message || "Location lookup failed" });
  }
});
app.post("/guest-api/report-cleanliness", requireGuestIssuesApproved, publicSubmissionRateLimit("guest"), async (req, res) => {
  try {
    await ensureGuestReportsSchema();
    const { locationCode, issueType, severity, notes, reporter } = normalizeGuestReportInput(req.body || {});
    const location = await resolveGuestReportLocation(locationCode);
    const operationId = requestOperationId(req);
    const requestFingerprint = stableRequestFingerprint({
      locationCode: String(location.location_code || "").trim().toUpperCase(),
      issueType,
      severity: severity.toLowerCase(),
      notes: notes == null ? null : String(notes).trim() || null,
      reporter: {
        name: String(reporter.name || "").trim() || null,
        phone: String(reporter.phone || "").trim() || null,
        email: String(reporter.email || "").trim().toLowerCase() || null,
      },
    });
    const report = await createGuestCleanlinessReport({
      operationId,
      requestFingerprint,
      location,
      issueType,
      severity,
      notes,
      reporter,
      reporterContext: {
        ip: req.ip || null,
        user_agent: String(req.get("user-agent") || "").slice(0, 500),
      },
    });
    const safeReport = {
      id: report.id,
      operation_id: report.operation_id,
      location_code: report.location_code,
      location_name: report.location_name,
      issue_type: report.issue_type,
      severity: report.severity,
      status: report.status,
      submitted_at: report.submitted_at,
      notification_status: report.notification_status,
      newly_inserted: report.newly_inserted,
    };
    res.status(report.newly_inserted === false ? 200 : 202).json({
      ok: true,
      data: { report: safeReport, location, notification: { status: "awaiting_marketing_review" } },
      meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: GUEST_REPORTS_CONTRACT_VERSION },
    });
  } catch (error) {
    console.error("guest cleanliness report failed:", error);
    res.status(error?.status || 500).json({ ok: false, error: error?.message || "Guest cleanliness report failed" });
  }
});
app.get("/guest-api/locations/:locationCode/issues", requireGuestIssuesApproved, async (req, res) => {
  try {
    await ensureGuestReportsSchema();
    const location = await resolveGuestReportLocation(req.params.locationCode);
    const rows = await listGuestCleanlinessReports({
      status: "open",
      locationCode: location.location_code,
      limit: Math.max(1, Math.min(25, Number(req.query.limit) || 10)),
      publicFieldsOnly: true,
    });
    res.status(200).json({ ok: true, data: rows, meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: GUEST_REPORTS_CONTRACT_VERSION } });
  } catch (error) {
    res.status(error?.status || 404).json({ ok: false, error: error?.message || "Guest issue list failed" });
  }
});
app.get("/dashboard-api/guest-cleanliness-issues", requireOpsManagerAuth, requireGuestIssuesApproved, async (req, res) => {
  try {
    await ensureGuestReportsSchema();
    const status = req.query.status ? String(req.query.status) : "";
    const locationCode = req.query.location_code ? String(req.query.location_code) : "";
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const rows = await listGuestCleanlinessReports({ status, locationCode, marketingReviewStatus: "approved", limit });
    res.status(200).json({ ok: true, data: rows, meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: GUEST_REPORTS_CONTRACT_VERSION } });
  } catch (error) {
    console.error("guest cleanliness issue list failed:", error);
    res.status(500).json({ ok: false, error: error?.message || "Guest cleanliness issue list failed" });
  }
});
app.get("/marketing-api/guest-cleanliness-issues", requireGuestMarketingReviewAuth, async (req, res) => {
  try {
    await ensureGuestReportsSchema();
    const rows = await listGuestCleanlinessReports({
      status: "pending_marketing_review",
      marketingReviewStatus: "pending",
      limit: req.query.limit ? Number(req.query.limit) : 100,
    });
    res.status(200).json({ ok: true, data: rows, meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: GUEST_REPORTS_CONTRACT_VERSION } });
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || "Guest Marketing review queue failed" });
  }
});
app.post("/marketing-api/guest-cleanliness-issues/:reportId/review", requireGuestMarketingReviewAuth, async (req, res) => {
  try {
    const item = await reviewGuestCleanlinessReport(String(req.params.reportId || ""), {
      action: req.body?.action,
      notes: req.body?.notes,
      actor: req.guestMarketingReview.actor,
    });
    if (item.status === "open") runOperationalNotificationWorker({ limit: 10 }).catch((error) => console.error("guest dispatch worker kick failed:", error));
    res.status(200).json({ ok: true, data: item, meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: GUEST_REPORTS_CONTRACT_VERSION } });
  } catch (error) {
    res.status(error?.status || 500).json({ ok: false, error: error?.message || "Guest Marketing review failed" });
  }
});
app.post("/dashboard-api/guest-cleanliness-issues/:reportId/resolve", requireOpsManagerWrite, requireGuestIssuesApproved, async (req, res) => {
  try {
    const actor = String(req.memphisAuth?.manager_display_name || req.memphisAuth?.manager_id || "authenticated_manager");
    const item = await resolveGuestCleanlinessReport(String(req.params.reportId || ""), { actor, notes: req.body?.notes });
    res.status(200).json({ ok: true, data: item, meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: GUEST_REPORTS_CONTRACT_VERSION } });
  } catch (error) {
    res.status(error?.status || 500).json({ ok: false, error: error?.message || "Guest report resolution failed" });
  }
});
app.get("/dashboard-api/system-feedback", requireOpsManagerAuth, async (req, res) => {
  try {
    await ensureSystemFeedbackSchema();
    const status = req.query.status ? String(req.query.status) : "";
    const priority = req.query.priority ? String(req.query.priority) : "";
    const hubContext = req.query.hub_context ? String(req.query.hub_context) : "";
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const rows = await listSystemFeedbackItems({ status, priority, hubContext, limit });
    res.status(200).json({ ok: true, data: rows, meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: FEEDBACK_CONTRACT_VERSION } });
  } catch (error) {
    console.error("system feedback list failed:", error);
    res.status(500).json({ ok: false, error: error?.message || "System feedback list failed" });
  }
});
app.post("/dashboard-api/system-feedback/:feedbackId/status", requireOpsManagerWrite, async (req, res) => {
  try {
    const actor = String(req.memphisAuth?.manager_display_name || req.memphisAuth?.manager_id || "authenticated_manager");
    const item = await setSystemFeedbackStatus(String(req.params.feedbackId || ""), req.body?.status, actor);
    res.status(200).json({ ok: true, data: item, meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: FEEDBACK_CONTRACT_VERSION } });
  } catch (error) {
    res.status(error?.status || 500).json({ ok: false, error: error?.message || "Feedback status update failed" });
  }
});
app.get("/dashboard-api/canary", async (_req, res) => {
  try { const result = await runCanaryChecks(); res.status(result.ok ? 200 : 503).json(buildHealthPayload("dashboard_canary", result)); }
  catch (error) { console.error("dashboard canary failed:", error); res.status(500).json({ ok: false, area: "dashboard_canary", version: APP_VERSION, release_id: RELEASE_ID, error: error.message || "Dashboard canary failed" }); }
});
app.get("/dashboard-api/current-attendance", async (_req, res) => {
  try {
    const stored = await loadStoredAttendance();
    if (stored && !stored.stale) {
      res.status(200).json({ ok: true, data: stored, meta: { version: APP_VERSION, release_id: RELEASE_ID, mode: "stored" } });
      return;
    }
    try {
      const data = await fetchCurrentAttendance({ force: Boolean(stored) });
      res.status(200).json({ ok: true, data, meta: { version: APP_VERSION, release_id: RELEASE_ID, mode: "scrape_fallback" } });
    } catch (error) {
      if (!stored) throw error;
      res.status(200).json({
        ok: true,
        data: { ...stored, stale: true, warning: error?.message || stored.warning || "Attendance source refresh failed." },
        meta: { version: APP_VERSION, release_id: RELEASE_ID, mode: "stale_stored_fallback" },
      });
    }
  }
  catch (error) { console.error("current attendance fetch failed:", error); res.status(502).json({ ok: false, error: error.message || "Current attendance fetch failed", source_url: ATTENDANCE_SOURCE_URL }); }
});
app.post("/admin-api/attendance-update", requireOpsManagerWrite, async (req, res) => {
  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const data = await persistAttendanceState(payload);
    attendanceCache = { data: null, fetched_at_ms: 0 };
    res.status(200).json({ ok: true, data, meta: { version: APP_VERSION, release_id: RELEASE_ID } });
  } catch (error) {
    console.error("attendance update failed:", error);
    res.status(400).json({ ok: false, error: error.message || "Attendance update failed" });
  }
});
app.post("/admin-api/bundle", requireOpsManagerWrite, async (req, res) => {
  try { const payload = req.body && typeof req.body === "object" ? req.body : {}; const data = await runAdminBundleViaSqlRead(payload); res.status(200).json({ ok: true, data }); }
  catch (error) { console.error("admin bundle failed:", error); res.status(500).json({ ok: false, error: error.message || "Admin bundle failed" }); }
});
app.post("/admin-api/close-ticket", requireOpsManagerWrite, async (req, res) => {
  try { const ticketId = String(req.body?.ticket_id || "").trim(); const closedBy = String(req.body?.closed_by || "").trim(); const closeNotes = req.body?.close_notes == null ? null : String(req.body.close_notes); if (!ticketId || !closedBy) { res.status(400).json({ ok: false, error: "ticket_id and closed_by are required." }); return; } await runRpc("custodial_close_maintenance_ticket_authoritative", { p_ticket_id: ticketId, p_closed_by: closedBy, p_close_notes: closeNotes, p_backend_execution_secret: offlineAuthoritySecret() }); res.status(200).json({ ok: true, ticket_id: ticketId, status: "closed" }); }
  catch (error) { console.error("close ticket failed:", error); res.status(500).json({ ok: false, error: error.message || "Close ticket failed" }); }
});
app.get("/dashboard-api/summary", requireOpsManagerAuth, async (_req, res) => {
  try { const data = await runPublicDashboardSummary(); res.status(200).json({ ok: true, data }); }
  catch (error) { console.error("dashboard summary failed:", error); res.status(500).json({ ok: false, error: error.message || "Dashboard summary failed" }); }
});
app.get("/dashboard-api/work-session-alerts", requireOpsManagerAuth, async (_req, res) => {
  try {
    const rows = await runReadOnlySql(`
      select
        s.id as session_id,
        s.session_uuid,
        s.client_session_id,
        s.status as session_status,
        s.started_at,
        l.location_code,
        l.location_name,
        d.device_id as device_identifier,
        e.display_name as employee_name,
        coalesce(latest.result, 'gps_unverified') as result,
        latest.notes,
        coalesce(latest.payload_json, '{}'::jsonb) as payload_json,
        latest.scanned_at
      from public.sessions s
      join public.locations l on l.id = s.location_id
      join public.devices d on d.id = s.device_id
      join public.employees e on e.id = s.employee_id
      left join lateral (
        select se.result, se.notes, se.payload_json, se.scanned_at
        from public.scan_events se
        where se.event_type = 'work_position_check'
          and (
            se.session_id = s.id
            or se.payload_json->>'session_uuid' = s.session_uuid
            or (s.client_session_id is not null and se.payload_json->>'client_session_id' = s.client_session_id)
          )
        order by se.scanned_at desc
        limit 1
      ) latest on true
      where s.status in ('active', 'pending_submit')
      order by s.started_at
    `);
    res.status(200).json({ ok: true, data: rows || [], meta: { version: APP_VERSION, release_id: RELEASE_ID } });
  } catch (error) {
    console.error("work session alert lookup failed:", error);
    res.status(500).json({ ok: false, error: error.message || "Work session alert lookup failed" });
  }
});
app.post("/dashboard-api/close-ticket", requireOpsManagerWrite, async (req, res) => {
  try {
    const ticketId = String(req.body?.ticket_id || "").trim();
    const closedBy = normalizeDashboardCloser(req.body?.closed_by);
    if (!ticketId) {
      res.status(400).json({ ok: false, error: "ticket_id is required." });
      return;
    }
    await runRpc("custodial_close_maintenance_ticket_authoritative", { p_ticket_id: ticketId, p_closed_by: closedBy, p_close_notes: null, p_backend_execution_secret: offlineAuthoritySecret() });
    res.status(200).json({ ok: true, ticket_id: ticketId, status: "closed" });
  }
  catch (error) { console.error("dashboard close ticket failed:", error); res.status(500).json({ ok: false, error: error.message || "Dashboard close ticket failed" }); }
});
function offlineAuthorityManagerId(req) {
  const managerId = String(req?.memphisAuth?.manager_id || "").trim();
  if (!isUuid(managerId)) {
    const error = new Error("An authenticated named manager identity is required.");
    error.status = 403;
    throw error;
  }
  return managerId;
}

// Original occurrence evidence is append-only. These bounded, named-manager
// endpoints can inspect it and append a disposition, never rewrite it.
app.get("/admin-api/custodial/offline-reconciliations", requireOpsManagerAuth, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number.parseInt(String(req.query?.limit || "50"), 10) || 50));
    const before = String(req.query?.before || "").trim() || null;
    if (before && Number.isNaN(Date.parse(before))) throw Object.assign(new Error("before must be an ISO timestamp."), { status: 400 });
    const data = await runRpc("custodial_manager_list_offline_reconciliations", {
      p_manager_id: offlineAuthorityManagerId(req), p_limit: limit, p_before: before,
      p_backend_execution_secret: offlineAuthoritySecret(),
    });
    res.status(200).json({ ok: true, contract_version: "offline-authority.v2", data });
  } catch (error) { const failure = authorityHttpFailure(error, "Offline reconciliation recovery is unavailable."); res.status(failure.status).json(failure.body); }
});
app.get("/admin-api/custodial/offline-reconciliations/:reconciliationId", requireOpsManagerAuth, async (req, res) => {
  try {
    const reconciliationId = String(req.params?.reconciliationId || "").trim();
    if (!isUuid(reconciliationId)) throw Object.assign(new Error("reconciliationId must be a UUID."), { status: 400 });
    const data = await runRpc("custodial_manager_get_offline_reconciliation", {
      p_manager_id: offlineAuthorityManagerId(req), p_reconciliation_id: reconciliationId,
      p_backend_execution_secret: offlineAuthoritySecret(),
    });
    res.status(200).json({ ok: true, contract_version: "offline-authority.v2", data });
  } catch (error) { const failure = authorityHttpFailure(error, "Offline reconciliation recovery is unavailable."); res.status(failure.status).json(failure.body); }
});
app.post("/admin-api/custodial/offline-reconciliations/:reconciliationId/dispositions", requireOpsManagerWrite, async (req, res) => {
  try {
    const reconciliationId = String(req.params?.reconciliationId || "").trim();
    const disposition = String(req.body?.disposition || "").trim();
    const reason = String(req.body?.reason || "").trim();
    if (!isUuid(reconciliationId) || !["reviewed", "retained_for_recovery", "superseded_by_new_occurrence"].includes(disposition) || !reason) {
      throw Object.assign(new Error("A reconciliation UUID, supported disposition, and reason are required."), { status: 400 });
    }
    const data = await runRpc("custodial_manager_dispose_offline_reconciliation", {
      p_manager_id: offlineAuthorityManagerId(req), p_reconciliation_id: reconciliationId,
      p_disposition: disposition, p_reason: reason, p_request_id: requiredRequestOperationId(req),
      p_backend_execution_secret: offlineAuthoritySecret(),
    });
    res.status(data?.replayed === true ? 200 : 201).json({ ok: true, contract_version: "offline-authority.v2", data });
  } catch (error) { const failure = authorityHttpFailure(error, "Offline reconciliation disposition is unavailable."); res.status(failure.status).json(failure.body); }
});
app.get("/scan-api/health", (_req, res) => {
  res.status(200).json(buildHealthPayload("scan", {
    available_functions: Array.from(SCAN_RPC_ALLOWLIST),
    rate_limits: {
      reads_per_device_per_minute: SCAN_READ_LIMIT_PER_MINUTE,
      writes_per_device_per_minute: SCAN_WRITE_LIMIT_PER_MINUTE,
      shared_ip_emergency_per_minute: SCAN_SHARED_IP_EMERGENCY_LIMIT_PER_MINUTE,
    },
  }));
});
app.get("/scan-api/authority-health", async (_req, res) => {
  try {
    const canaryDeviceId = configuredReleaseCanaryDeviceId();
    let canaryPaused = null;
    let canaryControlInitialized = false;
    if (canaryDeviceId) {
      canaryPaused = await runRpc("custodial_release_canary_is_paused", {
        p_device_identifier: canaryDeviceId,
        p_backend_execution_secret: offlineAuthoritySecret(),
      });
      canaryControlInitialized = typeof canaryPaused === "boolean";
    }
    const data = await collectBackendAuthorityHealth();
    const canaryReady = !releaseCanaryConfigurationRequired()
      || (Boolean(canaryDeviceId) && canaryControlInitialized && canaryPaused === false);
    const ok = data?.ok === true && canaryReady;
    res.status(ok ? 200 : 503).json({
      ok,
      data: {
        ...data,
        release_canary: {
          configured: Boolean(canaryDeviceId),
          device_identifier: canaryDeviceId,
          control_initialized: canaryControlInitialized,
          paused: canaryPaused,
        },
      },
    });
  } catch (error) {
    const failure = authorityHttpFailure(error, "Offline authority health is unavailable.");
    res.status(failure.status).json(failure.body);
  }
});
app.post("/scan-api/rpc", parseScanAuthorityJsonBeforeAuthentication, requireDeviceOrOpsAccess, rejectInvalidAuthenticatedScanAuthorityJson, requireScanRpcAuthorization, scanRpcRateLimit, async (req, res) => {
  try {
    const canaryDeviceId = configuredReleaseCanaryDeviceId();
    const requestDeviceId = String(req.memphisDevice?.canonical_device_id || req.memphisDevice?.device_id || "").trim().toUpperCase();
    const fn = String(req.body?.fn || "").trim();
    let canaryPaused = false;
    if (canaryDeviceId && requestDeviceId === canaryDeviceId) {
      canaryPaused = await runRpc("custodial_release_canary_is_paused", {
        p_device_identifier: canaryDeviceId,
        p_backend_execution_secret: offlineAuthoritySecret(),
      });
      const nativeProbe = fn === "tool_get_system_settings" && isNativeCustodialScanRequest(req);
      if (canaryPaused === true && !nativeProbe) {
        res.status(503).json({ ok: false, code: "release_canary_paused", retryable: false, error: "The physical release canary is operator-paused." });
        return;
      }
    }
    const outcome = await executeScanRpcTransport(fn, req.body?.args, req.memphisDevice, req.memphisDeviceCredential, req);
    let canaryTransportProbe = null;
    if (canaryPaused === true && outcome.status === 200 && outcome.body?.ok === true) {
      canaryTransportProbe = await recordReleaseCanaryTransportProbe(req, canaryDeviceId);
    }
    res.status(outcome.status).json({
      ...outcome.body,
      meta: {
        version: APP_VERSION,
        release_id: RELEASE_ID,
        contract_version: SCAN_CONTRACT_VERSION,
        requested_device_id: req.memphisDevice?.requested_device_id || null,
        canonical_device_id: req.memphisDevice?.canonical_device_id || req.memphisDevice?.device_id || null,
        release_canary_transport_probe: canaryTransportProbe,
      },
    });
  } catch (error) {
    console.error("scan rpc failed:", error);
    const failure = authorityHttpFailure(error, "Scan RPC failed.");
    res.status(failure.status).json(failure.body);
  }
});
app.get("/", (_req, res) => { res.status(200).send("Memphis Zoo MCP server is running."); });
// Streamable HTTP accepts connected ChatGPT sessions with the full GitHub and
// Supabase tool set by default. Legacy SSE remains token-only.
app.get("/mcp", requireMcpAuth, (_req, res) => { res.status(405).send("GET not supported on /mcp for this server."); });
app.options("/mcp", (_req, res) => { res.sendStatus(200); });
app.post("/mcp", requireMcpAuth, async (req, res) => {
  let server;
  try { server = createMcpServer({ readOnly: Boolean(req.memphisMcpAuth?.read_only) }); const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }); res.on("close", () => { transport.close(); try { server.close(); } catch {} }); await server.connect(transport); await transport.handleRequest(req, res, req.body); }
  catch (error) { console.error("MCP request failed:", error); if (!res.headersSent) { res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }); } }
});
const sseTransports = new Map();
app.get("/sse", requireLegacyMcpAuth, async (req, res) => {
  let server;
  try {
    server = createMcpServer();
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId || randomUUID();
    sseTransports.set(sessionId, { transport, server });
    res.on("close", () => {
      sseTransports.delete(sessionId);
      try { server.close(); } catch {}
    });
    await server.connect(transport);
  }
  catch (error) { console.error("SSE connection failed:", error); if (!res.headersSent) res.status(500).send("SSE connection failed"); }
});
app.post("/messages", requireLegacyMcpAuth, async (req, res) => {
  try {
    const sessionId = String(req.query.sessionId || req.query.session_id || "").trim();
    if (!sessionId) { res.status(400).send("sessionId is required"); return; }
    const entry = sseTransports.get(sessionId);
    if (!entry) { res.status(404).send("Unknown or expired SSE session"); return; }
    await entry.transport.handlePostMessage(req, res, req.body);
  }
  catch (error) { console.error("SSE post message failed:", error); if (!res.headersSent) res.status(500).send("SSE post message failed"); }
});

// Global Express error handler
app.use((err, req, res, next) => {
  console.error('[unhandled-error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT || 3000);
// A production Render process must never start with a silently disabled canary boundary.
configuredReleaseCanaryDeviceId();
if (releaseCanaryConfigurationRequired()) {
  offlineAuthoritySecret();
  nativeRouteProofSecret();
}
assertConfiguredReleaseIdentity();
const EVENT_MAINTENANCE_SWEEP_MS = toSafeNonNegativeInt(process.env.EVENT_MAINTENANCE_SWEEP_MS, 60_000);
if (EVENT_MAINTENANCE_SWEEP_MS > 0) {
  setInterval(() => {
    eventMaintenanceController.kick("scheduled_worker");
  }, EVENT_MAINTENANCE_SWEEP_MS).unref?.();
}
if (FEEDBACK_REMINDER_SWEEP_MS > 0) {
  setInterval(() => {
    runSystemFeedbackReminderSweep().catch((error) => console.error("system feedback reminder sweep failed:", error));
  }, FEEDBACK_REMINDER_SWEEP_MS).unref?.();
}
if (OPERATIONAL_NOTIFICATION_SWEEP_MS > 0) {
  setInterval(() => {
    runOperationalNotificationWorker({ limit: 10 }).catch((error) => console.error("operational notification worker failed:", error));
  }, OPERATIONAL_NOTIFICATION_SWEEP_MS).unref?.();
}
const httpServer = app.listen(port, () => {
  console.log("Memphis Zoo MCP server initialized.");
  console.log(`App version: ${APP_VERSION}`);
  console.log(`Listening on http://localhost:${port}`);
  console.log("Version endpoint: /version");
  console.log("Dashboard canary endpoint: /dashboard-api/canary");
  console.log("Dashboard attendance endpoint: /dashboard-api/current-attendance");
  console.log("Admin attendance update endpoint: /admin-api/attendance-update");
  console.log("Messaging API endpoint: /messaging-api");
  console.log("Dashboard events endpoint: /dashboard-api/events");
  console.log("Admin events endpoint: /admin-api/events");
  console.log("Schedule API endpoint: /schedule-api");
  console.log("Feedback API endpoint: /feedback-api");
  console.log(`Moxie endpoint: ${MOXIE_MOUNT_PATH}/`);
  console.log("MCP endpoint: /mcp");
  console.log("Legacy SSE endpoint: /sse");
  console.log("Legacy messages endpoint: /messages");
  console.log("Admin API endpoint: /admin-api");
  console.log("Dashboard API endpoint: /dashboard-api");
  console.log("Scan API endpoint: /scan-api");
  runOperationalNotificationWorker({ limit: 10 }).catch((error) => console.error("operational notification startup sweep failed:", error));
});

let shutdownStarted = false;
async function gracefulShutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log(`[shutdown] ${signal} received; draining active connections.`);

  for (const { transport, server } of sseTransports.values()) {
    try { transport.close(); } catch {}
    try { server.close(); } catch {}
  }
  sseTransports.clear();
  try { await geminiControlledRepairWorker.stop(); } catch (error) {
    console.error("[shutdown] Gemini worker stop failed:", error);
  }

  const forcedExit = setTimeout(() => {
    console.error("[shutdown] Grace period expired; forcing process exit.");
    process.exit(1);
  }, 25_000);
  forcedExit.unref?.();

  httpServer.close((error) => {
    if (error) console.error("[shutdown] HTTP server close failed:", error);
    else console.log("[shutdown] HTTP server drained cleanly.");
    process.exit(error ? 1 : 0);
  });
}

process.once("SIGTERM", () => { gracefulShutdown("SIGTERM"); });
process.once("SIGINT", () => { gracefulShutdown("SIGINT"); });
