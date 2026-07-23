import "dotenv/config";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import express from "express";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { Octokit } from "octokit";
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
import { buildReleaseManifest } from "./release-manifest.js";
import { authenticateOpsAccessRequest, createSupabaseTrustedDeviceStore, installSharedAuthRoutes, makeOpsAccessMiddleware } from "./auth/shared-access-auth.js";
import { makeMcpConnectorMiddleware } from "./auth/mcp-connector-auth.js";
import { installDeviceCredentialRoutes, makeDeviceCredentialMiddleware } from "./auth/device-credential-auth.js";
import { runReadOnlySql as runSupabaseReadOnlySql } from "./supabase/read.js";
import { createGeminiConsoleRouter } from "./gemini-console-api.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

const MOXIE_MOUNT_PATH = (String(process.env.MOXIE_PREFIX || "/moxie").trim() || "/moxie").replace(/\/+$/, "") || "/moxie";
const MOXIE_STATIC_DIR = fileURLToPath(new URL("../public/moxie-assets/", import.meta.url));

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
const opsTrustedDeviceStore = createSupabaseTrustedDeviceStore(supabaseAdmin);

const SCAN_RPC_ALLOWLIST = new Set([
  "tool_get_system_settings",
  "tool_list_active_employees",
  "tool_get_location_scan_state",
  "tool_start_session",
  "tool_start_session_v2",
  "tool_finish_session",
  "tool_complete_session",
  "tool_ping_device",
  "tool_record_scan_event",
  "tool_commit_cleaning_workflow",
  "tool_report_device_sync_status",
  "tool_evaluate_location_proximity",
  "tool_evaluate_location_proximity_v2"
]);

const SCAN_CONTRACT_VERSION = "scan.v2";
const DASHBOARD_CONTRACT_VERSION = "dashboard.v1";
const MESSAGING_CONTRACT_VERSION = "messaging.v5";
const SCHEDULE_CONTRACT_VERSION = "schedule.v2";
const OPERATIONAL_ANALYTICS_CONTRACT_VERSION = "operational-analytics.v1";
const GUEST_REPORTS_CONTRACT_VERSION = "guest-reports.v1";
const FEEDBACK_CONTRACT_VERSION = "feedback.v1";
const OPS_MANAGER_AUTH_CONTRACT_VERSION = "ops-manager-auth.v5.named-leadership";
const GEMINI_CONSOLE_CONTRACT_VERSION = "gemini-console.v2";
const CANARY_RESTROOM_CODE = "TETM";
const CANARY_EXHIBIT_CODE = "TETX";
const CANARY_DEVICE_ID = "canary-check";
const ATTENDANCE_SOURCE_URL = String(process.env.ND_MEMZOO_ATTENDANCE_URL || "https://nd.memzoo.org").trim();
const ATTENDANCE_TIMEOUT_MS = toSafeInt(process.env.ND_MEMZOO_ATTENDANCE_TIMEOUT_MS, 8000);
const ATTENDANCE_CACHE_MS = toSafeInt(process.env.ND_MEMZOO_ATTENDANCE_CACHE_MS, 60000);
const ATTENDANCE_CF_CLEARANCE = String(process.env.ND_MEMZOO_CF_CLEARANCE || "").trim();
const FEEDBACK_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const FEEDBACK_IMAGE_BUCKET = String(process.env.FEEDBACK_IMAGE_BUCKET || "system-feedback-private").trim();
const FEEDBACK_REMINDER_SWEEP_MS = toSafeNonNegativeInt(process.env.FEEDBACK_REMINDER_SWEEP_MS, 60000);
const FEEDBACK_REMINDER_MAX_COUNT = toSafeInt(process.env.FEEDBACK_REMINDER_MAX_COUNT, 3);
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

const requireOpsManagerAuth = makeOpsAccessMiddleware({ trustedDeviceStore: opsTrustedDeviceStore });
const requireOpsManagerWrite = makeOpsAccessMiddleware({ requireWrite: true, trustedDeviceStore: opsTrustedDeviceStore });
// Streamable HTTP permits a tokenless, least-privilege handshake so ChatGPT can stay connected.
// Legacy SSE remains token-only because its follow-up /messages request uses a separate HTTP request.
const requireMcpAuth = makeMcpConnectorMiddleware();
const requireLegacyMcpAuth = makeMcpConnectorMiddleware({ allowReadOnlyNoAuth: false });
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
  if (req.memphisAuth?.read_only && !SCAN_READ_FUNCTIONS.has(fn)) {
    res.status(403).json({ ok: false, error: "Read-only Ops Manager access cannot run scan mutations." });
    return;
  }
  next();
}

// Simple in-memory rate limiter: max 10 requests per minute per IP
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimitBuckets = new Map();

function rateLimit(req, res, next) {
  const ip = String(req.headers["x-forwarded-for"] || req.ip || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const now = Date.now();
  let bucket = rateLimitBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    bucket = { windowStart: now, count: 0 };
    rateLimitBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    res.status(429).json({ ok: false, error: "Rate limit exceeded. Try again in a minute." });
    return;
  }
  next();
}

// Purge stale rate limit buckets periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateLimitBuckets) {
    if (now - bucket.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitBuckets.delete(ip);
    }
  }
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
]);

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
  const canonicalArgs = { ...(args && typeof args === "object" ? args : {}) };
  const canonicalDeviceId = String(device?.canonical_device_id || device?.device_id || "").trim();
  if (canonicalDeviceId) {
    if ("p_device_id" in canonicalArgs || [
      "tool_get_location_scan_state",
      "tool_start_session",
      "tool_finish_session",
      "tool_complete_session",
      "tool_ping_device",
      "tool_commit_cleaning_workflow",
    ].includes(fn)) canonicalArgs.p_device_id = canonicalDeviceId;
    if ("p_device_identifier" in canonicalArgs || [
      "tool_record_scan_event",
      "tool_report_device_sync_status",
      "tool_evaluate_location_proximity",
      "tool_evaluate_location_proximity_v2",
    ].includes(fn)) canonicalArgs.p_device_identifier = canonicalDeviceId;
  }

  const assignedEmployeeName = String(device?.assigned_employee_name || "").trim();
  if (assignedEmployeeName && fn === "tool_start_session") canonicalArgs.p_employee_name = assignedEmployeeName;
  if (assignedEmployeeName && fn === "tool_complete_session") canonicalArgs.p_submitted_by_employee_name = assignedEmployeeName;
  return canonicalArgs;
}

function prepareScanRpcCall(fn, args) {
  const normalizedFn = String(fn || "").trim();
  const nextArgs = { ...(args && typeof args === "object" ? args : {}) };
  if (normalizedFn === "tool_start_session") {
    const clientSessionId = String(nextArgs.p_client_session_id || nextArgs.client_session_id || "").trim();
    if (!clientSessionId) {
      const error = new Error("p_client_session_id is required for scan start idempotency.");
      error.status = 422;
      throw error;
    }
    return {
      fn: "tool_start_session_v2",
      args: {
        p_location_code: nextArgs.p_location_code,
        p_device_id: nextArgs.p_device_id,
        p_client_session_id: clientSessionId,
        p_client_started_at: nextArgs.p_client_started_at || nextArgs.started_at || null,
        p_correlation_id: nextArgs.p_correlation_id || `scan-start:${clientSessionId}`,
      },
    };
  }
  if (normalizedFn === "tool_start_session_v2") {
    const clientSessionId = String(nextArgs.p_client_session_id || nextArgs.client_session_id || "").trim();
    if (!clientSessionId) {
      const error = new Error("p_client_session_id is required for scan start idempotency.");
      error.status = 422;
      throw error;
    }
    nextArgs.p_client_session_id = clientSessionId;
    if (!nextArgs.p_correlation_id) nextArgs.p_correlation_id = `scan-start:${clientSessionId}`;
  }
  if (normalizedFn === "tool_finish_session") {
    const sessionIdentifier = String(nextArgs.p_session_uuid || nextArgs.p_client_session_id || "").trim();
    const finishOperationId = String(nextArgs.p_finish_operation_id || nextArgs.p_operation_id || nextArgs.p_client_event_id || "").trim();
    if (!sessionIdentifier) {
      const error = new Error("Exact p_session_uuid or p_client_session_id is required for a finish transition.");
      error.status = 422;
      throw error;
    }
    if (!isUuid(finishOperationId)) {
      const error = new Error("p_finish_operation_id must be a stable UUID for a finish transition.");
      error.status = 422;
      throw error;
    }
    return {
      fn: "tool_finish_session_exact",
      args: {
        p_session_identifier: sessionIdentifier,
        p_device_id: nextArgs.p_device_id,
        p_finish_operation_id: finishOperationId,
        p_client_ended_at: nextArgs.p_client_ended_at || nextArgs.ended_at || null,
      },
    };
  }
  if (normalizedFn === "tool_complete_session") {
    const sessionIdentifier = String(nextArgs.p_session_uuid || nextArgs.p_client_session_id || "").trim();
    const completionId = String(nextArgs.p_client_completion_id || nextArgs.p_operation_id || "").trim();
    if (!sessionIdentifier) {
      const error = new Error("Exact p_session_uuid or p_client_session_id is required for completion.");
      error.status = 422;
      throw error;
    }
    if (!completionId) {
      const error = new Error("p_client_completion_id is required for idempotent completion.");
      error.status = 422;
      throw error;
    }
    return {
      fn: normalizedFn,
      args: {
        p_session_uuid: sessionIdentifier,
        p_response_json: nextArgs.p_response_json || {},
        p_submitted_by_employee_name: nextArgs.p_submitted_by_employee_name || null,
        p_device_id: nextArgs.p_device_id || null,
        p_client_completion_id: completionId,
      },
    };
  }
  if (normalizedFn === "tool_commit_cleaning_workflow") {
    const clientSessionId = String(nextArgs.p_client_session_id || "").trim();
    const clientCompletionId = String(nextArgs.p_client_completion_id || "").trim();
    if (!clientSessionId || !clientCompletionId) {
      const error = new Error("p_client_session_id and p_client_completion_id are required for idempotent completion.");
      error.status = 422;
      throw error;
    }
    if (!nextArgs.p_correlation_id) nextArgs.p_correlation_id = `scan-commit:${clientSessionId}:${clientCompletionId}`;
  }
  return { fn: normalizedFn, args: nextArgs };
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
    operational_analytics: OPERATIONAL_ANALYTICS_CONTRACT_VERSION,
    events: EVENTS_CONTRACT_VERSION,
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

function getAllowedGithubRepos(defaultRepo) {
  const raw = process.env.GITHUB_ALLOWED_REPOS || defaultRepo;
  return Array.from(
    new Set(
      String(raw || "")
        .split(",")
        .map((repoName) => repoName.trim())
        .filter(Boolean)
    )
  );
}

function getGithubConfig(targetRepo) {
  const owner = process.env.GITHUB_OWNER;
  const defaultRepo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !defaultRepo || !token) {
    throw new Error("GitHub is not configured. Check GITHUB_OWNER, GITHUB_REPO, and GITHUB_TOKEN in .env.");
  }

  const allowedRepos = getAllowedGithubRepos(defaultRepo);
  const repo = (targetRepo || defaultRepo).trim();

  if (!allowedRepos.includes(repo)) {
    throw new Error(`Repo \"${repo}\" is not allowed. Allowed repos: ${allowedRepos.join(", ")}`);
  }

  return { owner, repo, defaultRepo, allowedRepos };
}

function getSupabaseConfig() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !supabaseAdmin) {
    throw new Error("Supabase is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.");
  }
  return supabaseAdmin;
}

function normalizeGithubPath(path) {
  return String(path || "").trim().replace(/^\/+/, "");
}

function getGithubErrorDetail(error) {
  if (error?.status) return `status=${error.status} ${error.message}`;
  return error?.message || "Unknown GitHub error";
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
  const id = String(feedbackId || "").trim();
  const secret = getFeedbackLinkSecret();
  if (!id || !secret) return "";
  const payload = Buffer.from(JSON.stringify({ v: 1, purpose, feedback_id: id }), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyFeedbackLinkToken(token, feedbackId, purpose = "ack") {
  const secret = getFeedbackLinkSecret();
  const raw = String(token || "").trim();
  const [payload, signature, extra] = raw.split(".");
  if (!secret || !payload || !signature || extra !== undefined) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeStringEqual(signature, expected)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return decoded?.v === 1 && decoded?.purpose === purpose && String(decoded?.feedback_id || "") === String(feedbackId || "");
  } catch {
    return false;
  }
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
    if (error) throw new Error(error.message || "RPC failed: sch_generate_daily_schedule_privileged");
    return data;
  }
  const client = getSupabaseConfig();
  const { data, error } = await client.rpc(functionName, args);
  if (error) throw new Error(error.message || `RPC failed: ${functionName}`);
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

function toNullableInt(value) {
  if (value == null || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
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

function normalizeAttendanceRecord(row) {
  if (!row) return null;
  const attendance = toNullableInt(row.attendance);
  const lastYear = toNullableInt(row.last_year);
  const planned = toNullableInt(row.planned);
  const yesterday = toNullableInt(row.yesterday);
  const yesterdayPlan = toNullableInt(row.yesterday_plan);
  if (attendance == null && lastYear == null && planned == null && yesterday == null && yesterdayPlan == null) {
    return null;
  }
  return {
    attendance,
    last_year: lastYear,
    planned,
    yesterday,
    yesterday_plan: yesterdayPlan,
    parse_method: row.parse_method || "stored_state",
    source_url: row.source_url || null,
    source: row.source || null,
    content_type: row.content_type || null,
    fetched_at: row.fetched_at || null,
    updated_at: row.updated_at || null,
    cached: false,
    stale: false,
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
  return normalizeAttendanceRecord(rows[0]);
}

async function persistAttendanceState(payload = {}) {
  const attendance = toNullableInt(payload.attendance);
  const lastYear = toNullableInt(payload.last_year);
  const planned = toNullableInt(payload.planned);
  const yesterday = toNullableInt(payload.yesterday);
  const yesterdayPlan = toNullableInt(payload.yesterday_plan);
  const source = payload.source == null ? null : String(payload.source);
  const fetchedAt = payload.fetched_at == null ? null : String(payload.fetched_at);

  if (attendance == null) {
    throw new Error("attendance is required and must be an integer.");
  }

  await runWriteSql(
    "attendance_state_upsert",
    `insert into public.current_attendance_state (
       id, attendance, last_year, planned, yesterday, yesterday_plan, source, fetched_at, updated_at
     ) values (
       1,
       ${sqlLiteral(attendance)},
       ${sqlLiteral(lastYear)},
       ${sqlLiteral(planned)},
       ${sqlLiteral(yesterday)},
       ${sqlLiteral(yesterdayPlan)},
       ${sqlLiteral(source)},
       ${fetchedAt ? `${sqlLiteral(fetchedAt)}::timestamptz` : "null"},
       now()
     )
     on conflict (id) do update set
       attendance = excluded.attendance,
       last_year = excluded.last_year,
       planned = excluded.planned,
       yesterday = excluded.yesterday,
       yesterday_plan = excluded.yesterday_plan,
       source = excluded.source,
       fetched_at = excluded.fetched_at,
       updated_at = now();`
  );

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

async function runWriteSql(namePrefix, sql) {
  const client = getSupabaseConfig();
  const operationName = String(namePrefix || "application_write").trim().slice(0, 120) || "application_write";
  const { data, error } = await client.rpc("run_application_write", {
    p_name: operationName,
    p_sql: String(sql || "").trim(),
  });
  if (error) throw new Error(error.message || "run_application_write failed");
  return data;
}

const eventMaintenanceController = createEventMaintenanceController({ runReadOnlySql, runWriteSql, runRpc });

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
    select distinct mu.id as user_id, mu.display_name, mu.role
    from public.msg_users mu
    where coalesce(mu.is_active, true) = true
      and (
        lower(coalesce(mu.role, '')) like '%ops manager%'
        or lower(coalesce(mu.role, '')) like '%operations manager%'
        or lower(coalesce(mu.role, '')) = 'manager'
      )
    order by mu.display_name
  `);
  return Array.isArray(rows) ? rows.filter((row) => isUuid(row.user_id)) : [];
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
  const rows = await runWriteSql(
    "guest_cleanliness_report_insert",
    `with inserted as (
       insert into public.guest_cleanliness_reports (
         operation_id, request_fingerprint, location_code, location_name,
         issue_type, severity, notes, metadata_json
       ) values (
         ${sqlLiteral(operationId)}::uuid,
         ${sqlLiteral(requestFingerprint)},
         ${sqlLiteral(location.location_code)},
         ${sqlLiteral(location.location_name || null)},
         ${sqlLiteral(issue)},
         ${sqlLiteral(level)},
         ${sqlLiteral(noteText)},
         ${sqlLiteral(JSON.stringify(metadata))}::jsonb
       )
       on conflict (operation_id) do nothing
       returning *, true as newly_inserted
     ), authoritative as (
       select * from inserted
       union all
       select existing.*, false as newly_inserted
       from public.guest_cleanliness_reports existing
       where existing.operation_id = ${sqlLiteral(operationId)}::uuid
         and not exists (select 1 from inserted)
     ), queued as (
       insert into public.operational_notification_jobs(job_key, job_type, source_id, payload_json)
       select 'guest-report:' || id::text, 'guest_cleanliness_report', id,
              jsonb_build_object('operation_id', operation_id)
       from authoritative
       on conflict (job_key) do nothing
       returning job_id
     )
     select id, operation_id, request_fingerprint, location_code, location_name,
            issue_type, severity, notes, status, source, submitted_at, resolved_at,
            notification_status, notified_employee_user_id, notified_ops_count,
            metadata_json, newly_inserted
     from authoritative`
  );
  if (!Array.isArray(rows) || !rows.length) throw new Error("Guest report could not be created.");
  if (rows[0].request_fingerprint && rows[0].request_fingerprint !== requestFingerprint) {
    throw Object.assign(new Error("operation_id conflicts with another guest report submission."), { status: 409 });
  }
  return rows[0];
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

  await runWriteSql(
    "guest_report_notification_status",
    `update public.guest_cleanliness_reports
       set notification_status = ${sqlLiteral(notificationStatus)},
           notified_employee_user_id = ${sqlLiteral(notified.employee_user_id)}${notified.employee_user_id ? "::uuid" : ""},
           notified_ops_count = ${Number(notified.ops_count || 0)},
           metadata_json = coalesce(metadata_json, '{}'::jsonb) || ${sqlLiteral(JSON.stringify({ notification_errors: notified.errors }))}::jsonb
     where id = ${sqlLiteral(report.id)}::uuid`
  );

  return notified;
}

async function getGuestCleanlinessReportById(reportId) {
  if (!isUuid(reportId)) throw new Error("Guest report id is invalid.");
  const rows = await runReadOnlySql(`
    select id, operation_id, location_code, location_name, issue_type, severity, notes,
           status, source, submitted_at, resolved_at, notification_status,
           notified_employee_user_id, notified_ops_count, metadata_json
    from public.guest_cleanliness_reports
    where id = ${sqlLiteral(reportId)}::uuid
    limit 1
  `);
  if (!Array.isArray(rows) || !rows.length) throw new Error("Guest report was not found.");
  return rows[0];
}

async function processGuestCleanlinessNotificationJob(job) {
  const report = await getGuestCleanlinessReportById(job.source_id);
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
      }
      const retrySeconds = Math.min(3600, Math.max(15, 15 * (2 ** Math.min(8, Number(job.attempts || 1) - 1))));
      await runRpc("finish_operational_notification_job", {
        p_job_id: job.job_id,
        p_lease_token: job.lease_token,
        p_succeeded: succeeded,
        p_error: errorMessage,
        p_retry_seconds: retrySeconds,
      });
      results.push({ job_id: job.job_id, succeeded, error: errorMessage });
    }
    return {
      ok: true,
      claimed: jobs.length,
      completed: results.filter((item) => item.succeeded).length,
      results,
    };
  } finally {
    operationalNotificationWorkerInFlight = false;
  }
}

async function listGuestCleanlinessReports({ status, locationCode, limit = 100, publicFieldsOnly = false } = {}) {
  const filters = [];
  if (status) filters.push(`status = ${sqlLiteral(String(status).trim().toLowerCase())}`);
  if (locationCode) filters.push(`upper(location_code) = ${sqlLiteral(String(locationCode).trim().toUpperCase())}`);
  const where = filters.length ? `where ${filters.join(" and ")}` : "";
  const projection = publicFieldsOnly
    ? "id, location_code, location_name, issue_type, severity, status, submitted_at, resolved_at"
    : `id, operation_id, location_code, location_name, issue_type, severity, notes, status, source,
       submitted_at, resolved_at, notification_status, notified_employee_user_id,
       notified_ops_count, metadata_json`;
  const rows = await runReadOnlySql(`
    select ${projection}
    from public.guest_cleanliness_reports
    ${where}
    order by submitted_at desc
    limit ${Math.max(1, Math.min(500, Number(limit) || 100))}
  `);
  return Array.isArray(rows) ? rows : [];
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
    await runWriteSql(
      "system_feedback_legacy_image_migration",
      `update public.system_feedback_items
          set metadata_json = ${sqlLiteral(JSON.stringify(updatedMetadata))}::jsonb,
              updated_at = now()
        where id = ${sqlLiteral(feedbackId)}::uuid
          and metadata_json->'image_attachment'->>'data_url' is not null;
       update public.system_feedback_legacy_image_backups
          set migrated_at = now(),
              storage_bucket = ${sqlLiteral(persistedImage.storage_bucket)},
              storage_path = ${sqlLiteral(persistedImage.storage_path)}
        where feedback_id = ${sqlLiteral(feedbackId)}::uuid;`,
    );
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
  const category = normalizeFeedbackCategory(payload.category);
  const priority = normalizeFeedbackPriority(payload.priority);
  const message = String(payload.message || payload.body || "").trim();
  const submittedBy = String(payload.submitted_by || payload.name || "").trim() || null;
  const hubContext = String(payload.hub_context || payload.hub || "unknown").trim().toLowerCase() || "unknown";
  const deviceId = String(payload.device_id || payload.device || "").trim() || null;
  const pageUrl = String(payload.page_url || payload.url || "").trim().slice(0, 1000) || null;
  const feedbackId = randomUUID();
  const operationId = String(payload.operation_id || payload.operationId || "").trim();
  if (!isUuid(operationId)) throw Object.assign(new Error("operation_id must be a UUID."), { status: 422 });
  if (!message) throw Object.assign(new Error("message is required."), { status: 422 });
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
    await runWriteSql(
      "system_feedback_insert",
      `insert into public.system_feedback_items (
       id, operation_id, request_fingerprint, category, priority, message, submitted_by, hub_context, device_id, page_url, summary, metadata_json
     ) values (
       ${sqlLiteral(feedbackId)}::uuid,
       ${sqlLiteral(operationId)}::uuid,
       ${sqlLiteral(requestFingerprint)},
       ${sqlLiteral(category)},
       ${sqlLiteral(priority)},
       ${sqlLiteral(message)},
       ${sqlLiteral(submittedBy)},
       ${sqlLiteral(hubContext)},
       ${sqlLiteral(deviceId)},
       ${sqlLiteral(pageUrl)},
       ${sqlLiteral(summary)},
       ${sqlLiteral(JSON.stringify(metadata))}::jsonb
       ) on conflict (operation_id) do nothing`,
    );

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

  await runWriteSql(
      "system_feedback_notification_status",
    `update public.system_feedback_items
       set notification_status = ${sqlLiteral(eligibleRecipients.length === 0 ? "failed" : (notified.errors.length === 0 ? "sent" : (notified.ops_count ? "partial" : "failed")))},
           notified_ops_count = coalesce(notified_ops_count, 0) + ${Number(notified.ops_count || 0)},
           last_feedback_reminder_at = now(),
           feedback_reminder_count = coalesce(feedback_reminder_count, 0) + ${reminder ? 1 : 0},
           updated_at = now(),
           metadata_json = coalesce(metadata_json, '{}'::jsonb) || ${sqlLiteral(JSON.stringify({ notification_errors: notified.errors }))}::jsonb
     where id = ${sqlLiteral(item.id)}::uuid`
  );

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
  await runWriteSql(
    "system_feedback_acknowledge",
    `update public.system_feedback_items
       set status = 'acknowledged',
           acknowledged_at = now(),
           acknowledged_by = ${sqlLiteral(actor)},
           updated_at = now(),
           metadata_json = coalesce(metadata_json, '{}'::jsonb) || ${sqlLiteral(JSON.stringify({ acknowledged_via: "feedback-api" }))}::jsonb
     where id = ${sqlLiteral(feedbackId)}::uuid`
  );
  return getSystemFeedbackItemById(feedbackId);
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
  await runWriteSql(
    "system_feedback_reminder_exhausted",
    `update public.system_feedback_items
       set status = 'reminder_exhausted',
           updated_at = now(),
           metadata_json = coalesce(metadata_json, '{}'::jsonb) || ${sqlLiteral(JSON.stringify({ reminder_exhausted_reason: reason }))}::jsonb
     where id = ${sqlLiteral(item.id)}::uuid
       and status not in ('acknowledged', 'resolved', 'closed')`
  );
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
      p_device_id: CANARY_DEVICE_ID,
    });
    if (!state || state.location_code !== CANARY_RESTROOM_CODE) throw new Error("restroom scan state missing expected location code");
    if (String(state.form_type || state.location_type || "").toLowerCase() !== "restroom") throw new Error(`expected restroom form_type, got ${state.form_type || state.location_type || "unknown"}`);
    return { location_code: state.location_code, form_type: state.form_type || null, location_type: state.location_type || null, suggested_action: state.suggested_action || null };
  });

  await safeCheck("exhibit_scan_state", async () => {
    const state = await runRpc("tool_get_location_scan_state", {
      p_location_code: CANARY_EXHIBIT_CODE,
      p_device_id: CANARY_DEVICE_ID,
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
  const server = new McpServer({
    name: process.env.APP_NAME || "Memphis Zoo MCP",
    version: APP_VERSION,
  });

  function textToolResponse(text) {
    return {
      content: [
        {
          type: "text",
          text: String(text),
        },
      ],
    };
  }

  function jsonToolResponse(value) {
    return textToolResponse(JSON.stringify(value, null, 2));
  }

  function normalizeToolRepoInput(repoInput) {
    const raw = String(repoInput || "").trim();
    if (!raw) return undefined;

    if (raw.includes("/")) {
      const [owner, repo, ...extra] = raw.split("/");
      if (!owner || !repo || extra.length > 0) {
        throw new Error(`Invalid repo "${raw}". Expected repo name or owner/repo.`);
      }

      if (process.env.GITHUB_OWNER && owner !== process.env.GITHUB_OWNER) {
        throw new Error(
          `Repo owner "${owner}" is not allowed. This server is configured for "${process.env.GITHUB_OWNER}".`
        );
      }

      return repo;
    }

    return raw;
  }

  function getGithubToolConfig(repoInput) {
    return getGithubConfig(normalizeToolRepoInput(repoInput));
  }

  function normalizeGithubToolPath(path, options = {}) {
    const clean = normalizeGithubPath(path);

    if (!clean && options.requireFilePath) {
      throw new Error("path is required.");
    }

    const parts = clean.split("/").filter(Boolean);
    if (parts.some((part) => part === "." || part === "..")) {
      throw new Error("Path cannot contain '.' or '..' segments.");
    }

    return parts.join("/");
  }

  function getGithubRef(ref) {
    return String(ref || process.env.GITHUB_BRANCH || "main").trim() || "main";
  }

  function decodeGithubContent(base64Content) {
    return Buffer.from(String(base64Content || "").replace(/\n/g, ""), "base64");
  }

  function encodeGithubContent(content) {
    return Buffer.from(String(content), "utf8").toString("base64");
  }

  function looksBinary(buffer) {
    return buffer.includes(0);
  }

  async function getGithubContentOrNull({ repo, path, ref }) {
    const { owner, repo: resolvedRepo } = getGithubToolConfig(repo);

    try {
      const response = await octokit.rest.repos.getContent({
        owner,
        repo: resolvedRepo,
        path,
        ref: getGithubRef(ref),
      });

      return response.data;
    } catch (error) {
      if (error?.status === 404) return null;
      throw error;
    }
  }

  function assertGithubFile(contentResult, path) {
    if (!contentResult) {
      throw new Error(`File not found: ${path}`);
    }

    if (Array.isArray(contentResult)) {
      throw new Error(`"${path}" is a directory, not a file.`);
    }

    if (contentResult.type !== "file") {
      throw new Error(`"${path}" is not a file. GitHub type: ${contentResult.type}`);
    }
  }

  server.tool("ping", { message: z.string().optional() }, async ({ message }) => {
    return textToolResponse(`MCP server is alive. ${message || ""}`.trim());
  });

  if (readOnly) {
    server.tool("server_connection_diagnostic", {}, async () => {
      return jsonToolResponse({
        ...buildHealthPayload("mcp-connection"),
        access: "read_only",
        privileged_tools_exposed: false,
        note: "GitHub, database, and migration tools require privileged connector authorization.",
      });
    });
    return server;
  }

  server.tool("github_debug_config", {}, async () => {
    const owner = process.env.GITHUB_OWNER || null;
    const defaultRepo = process.env.GITHUB_REPO || null;

    return jsonToolResponse({
      ok: true,
      github_token_present: Boolean(process.env.GITHUB_TOKEN),
      github_owner: owner,
      github_repo: defaultRepo,
      github_allowed_repos: getAllowedGithubRepos(defaultRepo),
      github_branch: process.env.GITHUB_BRANCH || "main",
      supabase_configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      app_version: APP_VERSION,
      release_id: RELEASE_ID,
      node_version: process.version,
      added_tools: [
        "github_restore_file_from_ref"
      ],
    });
  });

  server.tool(
    "github_list_directory",
    {
      repo: z.string().optional(),
      path: z.string().optional(),
      ref: z.string().optional(),
      recursive: z.boolean().optional(),
      max_entries: z.number().int().positive().max(10000).optional(),
    },
    async ({ repo, path = "", ref, recursive = false, max_entries = 500 }) => {
      const { owner, repo: resolvedRepo } = getGithubToolConfig(repo);
      const resolvedPath = normalizeGithubToolPath(path);
      const resolvedRef = getGithubRef(ref);
      const maxEntries = Number.isFinite(max_entries) ? max_entries : 500;

      if (recursive) {
        const treeResponse = await octokit.rest.git.getTree({
          owner,
          repo: resolvedRepo,
          tree_sha: resolvedRef,
          recursive: "true",
        });

        const prefix = resolvedPath ? `${resolvedPath}/` : "";

        const entries = treeResponse.data.tree
          .filter((item) => {
            if (!resolvedPath) return true;
            return item.path === resolvedPath || String(item.path || "").startsWith(prefix);
          })
          .slice(0, maxEntries)
          .map((item) => ({
            path: item.path,
            type: item.type === "blob" ? "file" : item.type === "tree" ? "directory" : item.type,
            size: item.size ?? null,
            sha: item.sha,
            url: item.url,
          }));

        return jsonToolResponse({
          ok: true,
          repo: `${owner}/${resolvedRepo}`,
          ref: resolvedRef,
          path: resolvedPath,
          recursive: true,
          truncated: entries.length >= maxEntries,
          count: entries.length,
          entries,
        });
      }

      const response = await octokit.rest.repos.getContent({
        owner,
        repo: resolvedRepo,
        path: resolvedPath,
        ref: resolvedRef,
      });

      const result = response.data;

      if (Array.isArray(result)) {
        return jsonToolResponse({
          ok: true,
          repo: `${owner}/${resolvedRepo}`,
          ref: resolvedRef,
          path: resolvedPath,
          count: result.length,
          entries: result.map((item) => ({
            name: item.name,
            path: item.path,
            type: item.type,
            size: item.size,
            sha: item.sha,
            html_url: item.html_url,
          })),
        });
      }

      return jsonToolResponse({
        ok: true,
        repo: `${owner}/${resolvedRepo}`,
        ref: resolvedRef,
        name: result.name,
        path: result.path,
        type: result.type,
        size: result.size,
        sha: result.sha,
        html_url: result.html_url,
      });
    }
  );

  server.tool(
    "github_read_file",
    {
      repo: z.string().optional(),
      path: z.string().min(1),
      ref: z.string().optional(),
      format: z.enum(["text", "json", "base64"]).optional(),
      max_bytes: z.number().int().positive().max(10_000_000).optional(),
    },
    async ({ repo, path, ref, format = "json", max_bytes = 1_000_000 }) => {
      const { owner, repo: resolvedRepo } = getGithubToolConfig(repo);
      const resolvedPath = normalizeGithubToolPath(path, { requireFilePath: true });
      const resolvedRef = getGithubRef(ref);
      const maxBytes = Number.isFinite(max_bytes) ? max_bytes : 1_000_000;

      const contentResult = await getGithubContentOrNull({
        repo: resolvedRepo,
        path: resolvedPath,
        ref: resolvedRef,
      });

      assertGithubFile(contentResult, resolvedPath);

      if (contentResult.size > maxBytes) {
        throw new Error(
          `File is too large to read safely. Size: ${contentResult.size} bytes. Limit: ${maxBytes} bytes.`
        );
      }

      if (format === "base64") {
        return jsonToolResponse({
          ok: true,
          repo: `${owner}/${resolvedRepo}`,
          ref: resolvedRef,
          path: contentResult.path,
          name: contentResult.name,
          sha: contentResult.sha,
          size: contentResult.size,
          encoding: "base64",
          html_url: contentResult.html_url,
          content: contentResult.content,
        });
      }

      const buffer = decodeGithubContent(contentResult.content);

      if (looksBinary(buffer)) {
        throw new Error(`File appears to be binary. Use format: "base64" if you need raw content.`);
      }

      const fileText = buffer.toString("utf8");

      if (format === "text") {
        return textToolResponse(fileText);
      }

      return jsonToolResponse({
        ok: true,
        repo: `${owner}/${resolvedRepo}`,
        ref: resolvedRef,
        path: contentResult.path,
        name: contentResult.name,
        sha: contentResult.sha,
        size: contentResult.size,
        encoding: "utf8",
        html_url: contentResult.html_url,
        content: fileText,
      });
    }
  );

  server.tool(
    "github_write_file",
    {
      repo: z.string().optional(),
      path: z.string().min(1),
      content: z.string(),
      commit_message: z.string().min(1),
      branch: z.string().optional(),
      overwrite: z.boolean().optional(),
      dry_run: z.boolean().optional(),
    },
    async ({
      repo,
      path,
      content,
      commit_message,
      branch,
      overwrite = false,
      dry_run = false,
    }) => {
      const { owner, repo: resolvedRepo } = getGithubToolConfig(repo);
      const resolvedPath = normalizeGithubToolPath(path, { requireFilePath: true });
      const targetBranch = getGithubRef(branch);

      const existing = await getGithubContentOrNull({
        repo: resolvedRepo,
        path: resolvedPath,
        ref: targetBranch,
      });

      if (existing && Array.isArray(existing)) {
        throw new Error(`"${resolvedPath}" is a directory, not a file.`);
      }

      if (existing && !overwrite) {
        throw new Error(
          `File already exists: ${resolvedPath}. Use github_update_file, or set overwrite: true.`
        );
      }

      if (dry_run) {
        return jsonToolResponse({
          ok: true,
          dry_run: true,
          action: existing ? "would_overwrite" : "would_create",
          repo: `${owner}/${resolvedRepo}`,
          branch: targetBranch,
          path: resolvedPath,
          previous_sha: existing?.sha || null,
          new_content_bytes: Buffer.byteLength(content, "utf8"),
          commit_message,
        });
      }

      const request = {
        owner,
        repo: resolvedRepo,
        path: resolvedPath,
        message: commit_message,
        content: encodeGithubContent(content),
        branch: targetBranch,
      };

      if (existing?.sha) {
        request.sha = existing.sha;
      }

      const response = await octokit.rest.repos.createOrUpdateFileContents(request);

      return jsonToolResponse({
        ok: true,
        message: existing ? "File overwritten." : "File created.",
        action: existing ? "overwrite" : "create",
        repo: `${owner}/${resolvedRepo}`,
        branch: targetBranch,
        path: resolvedPath,
        previous_sha: existing?.sha || null,
        new_sha: response.data.content?.sha || null,
        commit_url: response.data.commit?.html_url || null,
        file_url: response.data.content?.html_url || null,
      });
    }
  );

  server.tool(
    "github_update_file",
    {
      repo: z.string().optional(),
      path: z.string().min(1),
      content: z.string(),
      commit_message: z.string().min(1),
      branch: z.string().optional(),
      expected_sha: z.string().optional(),
      dry_run: z.boolean().optional(),
    },
    async ({
      repo,
      path,
      content,
      commit_message,
      branch,
      expected_sha,
      dry_run = false,
    }) => {
      const { owner, repo: resolvedRepo } = getGithubToolConfig(repo);
      const resolvedPath = normalizeGithubToolPath(path, { requireFilePath: true });
      const targetBranch = getGithubRef(branch);

      const existing = await getGithubContentOrNull({
        repo: resolvedRepo,
        path: resolvedPath,
        ref: targetBranch,
      });

      assertGithubFile(existing, resolvedPath);

      if (expected_sha && existing.sha !== expected_sha) {
        throw new Error(
          [
            "Refusing to update because expected_sha does not match current file SHA.",
            `Path: ${resolvedPath}`,
            `Expected: ${expected_sha}`,
            `Current:  ${existing.sha}`,
            "Read the file again, inspect the current content, then retry with the current SHA.",
          ].join("\n")
        );
      }

      const oldContent = decodeGithubContent(existing.content).toString("utf8");

      if (oldContent === content) {
        return jsonToolResponse({
          ok: true,
          message: "No update needed. Content is unchanged.",
          repo: `${owner}/${resolvedRepo}`,
          branch: targetBranch,
          path: resolvedPath,
          sha: existing.sha,
          file_url: existing.html_url,
        });
      }

      if (dry_run) {
        return jsonToolResponse({
          ok: true,
          dry_run: true,
          action: "would_update",
          repo: `${owner}/${resolvedRepo}`,
          branch: targetBranch,
          path: resolvedPath,
          current_sha: existing.sha,
          old_content_bytes: Buffer.byteLength(oldContent, "utf8"),
          new_content_bytes: Buffer.byteLength(content, "utf8"),
          old_line_count: oldContent.split("\n").length,
          new_line_count: content.split("\n").length,
          commit_message,
        });
      }

      const response = await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo: resolvedRepo,
        path: resolvedPath,
        message: commit_message,
        content: encodeGithubContent(content),
        sha: existing.sha,
        branch: targetBranch,
      });

      return jsonToolResponse({
        ok: true,
        message: "File updated.",
        action: "update",
        repo: `${owner}/${resolvedRepo}`,
        branch: targetBranch,
        path: resolvedPath,
        previous_sha: existing.sha,
        new_sha: response.data.content?.sha || null,
        commit_url: response.data.commit?.html_url || null,
        file_url: response.data.content?.html_url || null,
      });
    }
  );



  server.tool(
    "supabase_sql_read",
    {
      sql: z.string().min(1),
    },
    async ({ sql }) => {
      const rows = await runReadOnlySql(sql);

      return jsonToolResponse({
        ok: true,
        rowCount: Array.isArray(rows) ? rows.length : null,
        rows,
      });
    }
  );

  server.tool(
    "supabase_migration_apply",
    {
      name: z.string().min(1),
      sql: z.string().min(1),
    },
    async ({ name, sql }) => {
      const client = getSupabaseConfig();
      const migrationName = String(name || "").trim();
      const migrationSql = String(sql || "").trim();

      if (!migrationName) throw new Error("Migration name is required.");
      if (!migrationSql) throw new Error("Migration SQL is required.");

      const { data, error } = await client.rpc("run_sql_migration", {
        p_name: migrationName,
        p_sql: migrationSql,
      });

      if (error) {
        throw new Error(error.message || "run_sql_migration failed");
      }

      return jsonToolResponse({
        ok: true,
        name: migrationName,
        data,
      });
    }
  );

  return server;
}

installSharedAuthRoutes(app, { setCors: setAdminApiCors, supabase: supabaseAdmin, trustedDeviceStore: opsTrustedDeviceStore });
installDeviceCredentialRoutes(app, {
  setCors: setAdminApiCors,
  supabase: supabaseAdmin,
  runReadOnlySql,
  requireOpsAuth: requireOpsManagerAuth,
  requireOpsWrite: requireOpsManagerWrite,
});

app.use(MOXIE_MOUNT_PATH, createMoxieRouter({ supabase: supabaseAdmin, staticDir: MOXIE_STATIC_DIR }));

app.use("/admin-api", (req, res, next) => { setAdminApiCors(res, req); if (req.method === "OPTIONS") { res.sendStatus(200); return; } next(); });
app.use("/dashboard-api", (req, res, next) => { setPublicDashboardCors(res, req); if (req.method === "OPTIONS") { res.sendStatus(200); return; } next(); });
app.use("/scan-api", (req, res, next) => { setScanApiCors(res, req); if (req.method === "OPTIONS") { res.sendStatus(200); return; } next(); });
app.use("/messaging-api", (req, res, next) => { setMessagingApiCors(res, req); if (req.method === "OPTIONS") { res.sendStatus(200); return; } next(); }, createMessagingRouter({ runReadOnlySql, runRpc, buildHealthPayload, requireDeviceAccess: requireDeviceOrOpsAccess, requireOpsManagerAuth, registerOperationalJobHandler: registerOperationalNotificationJobHandler, appVersion: APP_VERSION, releaseId: RELEASE_ID, contractVersion: MESSAGING_CONTRACT_VERSION }));
app.use("/schedule-api", (req, res, next) => { setScheduleApiCors(res, req); if (req.method === "OPTIONS") { res.sendStatus(200); return; } next(); }, createScheduleRouter({ runReadOnlySql, runRpc, runWriteSql, buildHealthPayload, requireAdminApiAuth: requireOpsManagerWrite, requireOpsManagerAuth, requireDeviceAccess: requireDeviceOrOpsAccess, appVersion: APP_VERSION, releaseId: RELEASE_ID, contractVersion: SCHEDULE_CONTRACT_VERSION }));
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
    frontendCommit: process.env.FRONTEND_COMMIT_SHA || "unknown",
  }),
);
app.use("/dashboard-api/events", createEventsPublicRouter({ runReadOnlySql, runWriteSql, buildHealthPayload, appVersion: APP_VERSION, releaseId: RELEASE_ID, maintenanceController: eventMaintenanceController }));
app.use("/admin-api/events", createEventsAdminRouter({ runReadOnlySql, runWriteSql, buildHealthPayload, appVersion: APP_VERSION, releaseId: RELEASE_ID, maintenanceController: eventMaintenanceController, requireAdminApiAuth: requireOpsManagerAuth, requireAdminApiWrite: requireOpsManagerWrite }));
app.use(["/version", "/release-manifest", "/health/dependencies"], (req, res, next) => {
  setPublicDashboardCors(res, req);
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});
app.get("/version", (_req, res) => { setPublicDashboardCors(res, _req); res.status(200).json(buildHealthPayload("version")); });
app.get("/release-manifest", (_req, res) => { setPublicDashboardCors(res, _req); res.status(200).json(buildReleaseManifest({ appVersion: APP_VERSION, releaseId: RELEASE_ID, contracts: buildHealthPayload("contracts").contracts })); });
app.get("/health/dependencies", async (req, res) => {
  setPublicDashboardCors(res, req);
  try {
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
    const requiredSchemaPresent = [
      "sessions_table",
      "messages_table",
      "notification_outbox_table",
      "message_audit_table",
      "exact_finish_rpc",
      "manager_messaging_rpc",
      "worker_claim_rpc",
    ].every((key) => dependencies[key] === true);
    const ok = dependencies.database_reachable === true && requiredSchemaPresent;
    res.status(ok ? 200 : 503).json(buildHealthPayload("dependencies", {
      ok,
      process_alive: true,
      database_reachable: dependencies.database_reachable === true,
      required_schema_present: requiredSchemaPresent,
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
    const item = await acknowledgeSystemFeedbackItem(String(req.params.feedbackId || ""), req.query.by || "ops_manager");
    res.status(200).send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Feedback acknowledged</title><style>body{font-family:Arial,sans-serif;background:#111827;color:#f8fafc;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:620px;padding:28px;border-radius:24px;background:rgba(8,17,29,.92);border:1px solid rgba(255,255,255,.14)}.ok{color:#84c341;font-weight:900}</style></head><body><main class="card"><div class="ok">Acknowledged</div><h1>Program feedback will stop reminding you.</h1><p>${escapeHtml(item.summary || item.message || item.id)}</p></main></body></html>`);
  } catch (error) {
    res.status(404).send(error?.message || "Feedback acknowledgement failed");
  }
});
app.post("/feedback-api/acknowledge/:feedbackId", requireFeedbackSignedLinkOrOps("ack"), async (req, res) => {
  try {
    await ensureSystemFeedbackSchema();
    const item = await acknowledgeSystemFeedbackItem(String(req.params.feedbackId || ""), req.body?.acknowledged_by || req.body?.by || "ops_manager");
    res.status(200).json({ ok: true, data: item, meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: FEEDBACK_CONTRACT_VERSION } });
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
app.post("/feedback-api/submit", rateLimit, async (req, res) => {
  try {
    await ensureSystemFeedbackSchema();
    const operationId = requestOperationId(req);
    const item = await createSystemFeedbackItem({
      ...(req.body && typeof req.body === "object" ? req.body : {}),
      operation_id: operationId,
      user_agent: String(req.get("user-agent") || "").slice(0, 500),
    });
    await runWriteSql(
      "system_feedback_dashboard_only",
      `update public.system_feedback_items
         set notification_status = 'dashboard_only',
             notified_ops_count = 0,
             updated_at = now(),
             metadata_json = coalesce(metadata_json, '{}'::jsonb) || ${sqlLiteral(JSON.stringify({ notification_delivery: "dashboard_only" }))}::jsonb
       where id = ${sqlLiteral(item.id)}::uuid`
    );
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
app.get("/guest-api/locations/:locationCode", async (req, res) => {
  try {
    const location = await resolveGuestReportLocation(req.params.locationCode);
    res.status(200).json({ ok: true, data: location, meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: GUEST_REPORTS_CONTRACT_VERSION } });
  } catch (error) {
    res.status(404).json({ ok: false, error: error?.message || "Location lookup failed" });
  }
});
app.post("/guest-api/report-cleanliness", rateLimit, async (req, res) => {
  try {
    await ensureGuestReportsSchema();
    const locationCode = String(req.body?.location_code || req.body?.code || "").trim();
    const issueType = String(req.body?.issue_type || req.body?.issue || "").trim();
    const severity = String(req.body?.severity || "normal").trim();
    const notes = req.body?.notes == null ? null : String(req.body.notes);
    const reporter = {
      name: req.body?.guest_name ?? req.body?.name ?? null,
      phone: req.body?.guest_phone ?? req.body?.phone ?? null,
      email: req.body?.guest_email ?? req.body?.email ?? null,
    };
    if (!locationCode) {
      res.status(400).json({ ok: false, error: "location_code is required." });
      return;
    }
    if (!issueType) {
      res.status(400).json({ ok: false, error: "issue_type is required." });
      return;
    }
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
    runOperationalNotificationWorker({ limit: 10 }).catch((error) => console.error("operational notification worker kick failed:", error));
    res.status(report.newly_inserted === false ? 200 : 202).json({
      ok: true,
      data: { report: safeReport, location, notification: { status: "pending" } },
      meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: GUEST_REPORTS_CONTRACT_VERSION },
    });
  } catch (error) {
    console.error("guest cleanliness report failed:", error);
    res.status(error?.status || 500).json({ ok: false, error: error?.message || "Guest cleanliness report failed" });
  }
});
app.get("/guest-api/locations/:locationCode/issues", async (req, res) => {
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
app.get("/dashboard-api/guest-cleanliness-issues", requireOpsManagerAuth, async (req, res) => {
  try {
    await ensureGuestReportsSchema();
    const status = req.query.status ? String(req.query.status) : "";
    const locationCode = req.query.location_code ? String(req.query.location_code) : "";
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const rows = await listGuestCleanlinessReports({ status, locationCode, limit });
    res.status(200).json({ ok: true, data: rows, meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: GUEST_REPORTS_CONTRACT_VERSION } });
  } catch (error) {
    console.error("guest cleanliness issue list failed:", error);
    res.status(500).json({ ok: false, error: error?.message || "Guest cleanliness issue list failed" });
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
app.get("/dashboard-api/canary", async (_req, res) => {
  try { const result = await runCanaryChecks(); res.status(result.ok ? 200 : 503).json(buildHealthPayload("dashboard_canary", result)); }
  catch (error) { console.error("dashboard canary failed:", error); res.status(500).json({ ok: false, area: "dashboard_canary", version: APP_VERSION, release_id: RELEASE_ID, error: error.message || "Dashboard canary failed" }); }
});
app.get("/dashboard-api/current-attendance", async (_req, res) => {
  try {
    const stored = await loadStoredAttendance();
    if (stored) {
      res.status(200).json({ ok: true, data: stored, meta: { version: APP_VERSION, release_id: RELEASE_ID, mode: "stored" } });
      return;
    }
    const data = await fetchCurrentAttendance();
    res.status(200).json({ ok: true, data, meta: { version: APP_VERSION, release_id: RELEASE_ID, mode: "scrape" } });
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
  try { const ticketId = String(req.body?.ticket_id || "").trim(); const closedBy = String(req.body?.closed_by || "").trim(); const closeNotes = req.body?.close_notes == null ? null : String(req.body.close_notes); if (!ticketId || !closedBy) { res.status(400).json({ ok: false, error: "ticket_id and closed_by are required." }); return; } await runWriteSql("admin_close_ticket", `select public.close_maintenance_ticket(${sqlLiteral(ticketId)}::uuid, ${sqlLiteral(closedBy)}, ${sqlLiteral(closeNotes)});`); res.status(200).json({ ok: true, ticket_id: ticketId, status: "closed" }); }
  catch (error) { console.error("close ticket failed:", error); res.status(500).json({ ok: false, error: error.message || "Close ticket failed" }); }
});
app.post("/admin-api/force-close-session", requireOpsManagerWrite, async (req, res) => {
  try { const sessionUuid = String(req.body?.session_uuid || "").trim(); const closedBy = String(req.body?.closed_by || "").trim(); const reason = req.body?.reason == null ? null : String(req.body.reason); if (!sessionUuid || !closedBy) { res.status(400).json({ ok: false, error: "session_uuid and closed_by are required." }); return; } await runWriteSql("admin_force_close_session", `select public.force_close_session(${sqlLiteral(sessionUuid)}, ${sqlLiteral(closedBy)}, ${sqlLiteral(reason)});`); res.status(200).json({ ok: true, session_uuid: sessionUuid, status: "closed" }); }
  catch (error) { console.error("force close session failed:", error); res.status(500).json({ ok: false, error: error.message || "Force close session failed" }); }
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
    await runWriteSql("dashboard_close_ticket", `select public.close_maintenance_ticket(${sqlLiteral(ticketId)}::uuid, ${sqlLiteral(closedBy)}, null);`);
    res.status(200).json({ ok: true, ticket_id: ticketId, status: "closed" });
  }
  catch (error) { console.error("dashboard close ticket failed:", error); res.status(500).json({ ok: false, error: error.message || "Dashboard close ticket failed" }); }
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
app.post("/scan-api/rpc", requireDeviceOrOpsAccess, requireScanRpcAuthorization, scanRpcRateLimit, async (req, res) => {
  try {
    const fn = String(req.body?.fn || "").trim();
    if (!SCAN_RPC_ALLOWLIST.has(fn)) {
      res.status(400).json({ ok: false, error: `Function not allowed: ${fn}` });
      return;
    }
    const args = canonicalizeScanArguments(fn, req.body?.args, req.memphisDevice);
    const prepared = prepareScanRpcCall(fn, args);
    const data = await runRpc(prepared.fn, prepared.args);
    res.status(200).json({
      ok: true,
      data,
      meta: {
        version: APP_VERSION,
        release_id: RELEASE_ID,
        contract_version: SCAN_CONTRACT_VERSION,
        requested_device_id: req.memphisDevice?.requested_device_id || null,
        canonical_device_id: req.memphisDevice?.canonical_device_id || req.memphisDevice?.device_id || null,
      },
    });
  } catch (error) {
    console.error("scan rpc failed:", error);
    const message = String(error?.message || "Scan RPC failed");
    const status = error?.status
      || (/not found/i.test(message)
        ? 404
        : /invalid|required|cannot|must|too (?:old|far|large)|exceeds/i.test(message)
          ? 422
      : /already has|already bound|manager recovery|required review|transition/i.test(message)
        ? 409
      : /unauthor|not assigned|another device/i.test(message)
        ? 403
        : 500);
    res.status(status).json({ ok: false, error: message });
  }
});
app.get("/", (_req, res) => { res.status(200).send("Memphis Zoo MCP server is running."); });
// MCP transport accepts a tokenless read-only handshake; privileged GitHub and Supabase tools
// are registered only when connector-token authentication succeeds.
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
app.listen(port, () => {
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
