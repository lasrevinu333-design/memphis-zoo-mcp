import { AsyncLocalStorage } from "node:async_hooks";
import { types } from "node:util";
import { MANAGER_OPERATION_MILLISECONDS, CLEANUP_RESERVE_MILLISECONDS } from "./static-weekly-manager-operation.js";
import { withRecurringDependencyStatus } from "./static-weekly-recurring-dependency-result.js";
import { postgresJsonbContentDigest } from "./static-weekly-schedule-compiler.js";
import {prepareApprovedStaticTemplateProjection} from './static-weekly-recurring-staffing-adaptation.js';
import {prepareStaticWeeklySchedulingProblem} from './static-weekly-schedule-program.js';
/*
 * Separately deployed static-weekly scheduler control plane.
 *
 * This module deliberately has no access to the ordinary Supabase service-role
 * client and never reads a scheduler HMAC. Its database connection is a
 * separately provisioned identity that SET ROLEs to
 * static_weekly_control_plane; PostgreSQL owns signing, verification, key
 * rotation state, and every mutation. Manager identity comes from the trusted
 * request session and the database re-resolves its active display name.
 */
import { createHash, randomUUID } from "node:crypto";
import { assertOwnerRecurringWorkdays } from "./static-weekly-owner-workdays.js";
import { createCoverAllPrintDocument } from "./static-weekly-coverall-print.js";
import { Pool } from "pg";
import { createStaticWeeklyDraftRpcInput } from "./static-weekly-schedule-database-adapter.js";
import { createStaticWeeklyProjectionWithLunchRpcInput } from "./static-weekly-lunch-publication.js";
import { createStaffingCommandRequest } from "./static-weekly-staffing-command.js";
import { createStaffingCandidateSet } from "./static-weekly-staffing-candidates.js";
import { createStaffingPreparationMeter, enumerateStaffingServiceWindow } from "./static-weekly-staffing-preparation.js";
import { createStaffingWeekPreviewInput } from "./static-weekly-staffing-preview.js";
import { canonicalJson } from "./static-weekly-schedule-model.js";
import {
  compileAndPrepareStaticWeeklyScheduleIsolated,
  compileStaticWeeklyScheduleIsolated,
  getStaticWeeklyCompilerReadiness,
  initializeStaticWeeklyCompiler,
  shutdownStaticWeeklyCompiler,
  STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS,
} from "./static-weekly-schedule-compiler-runtime.js";

export const STATIC_WEEKLY_CONTROL_PLANE_SCHEMA = "memphis-zoo.static-weekly-control-plane.v1";
export const STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS = 120_000;
export const STATIC_WEEKLY_MANAGER_OPERATION_DEADLINE_MS = MANAGER_OPERATION_MILLISECONDS;
export const STATIC_WEEKLY_MANAGER_CLEANUP_RESERVE_MS = CLEANUP_RESERVE_MILLISECONDS;
const STATIC_WEEKLY_AUTHORITY_LOCK_IDENTITY = "memphis-static-weekly-authority";

const text = (value) => typeof value === "string" ? value.trim() : "";
const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (code, message = code) => Object.assign(new Error(message), { code });

function assertOperationActive(signal) {
  if (signal?.aborted) {
    const error = fail("static_weekly_recurring_operation_aborted",
      "The recurring operation was interrupted; check its exact status before retrying.");
    if (signal.reason instanceof Error) error.cause = signal.reason;
    throw error;
  }
}

function operationRemaining(deadlineAt, signal) {
  assertOperationActive(signal);
  const remaining = Math.floor(deadlineAt - performance.now());
  if (remaining < 1) throw fail("static_weekly_recurring_operation_deadline_exceeded",
    "The recurring operation exceeded its one-minute deadline; check its exact status before retrying.");
  return remaining;
}

async function acquireOperationClient(database, signal) {
  if (!signal) return database.connect();
  assertOperationActive(signal);
  const connecting = Promise.resolve().then(() => database.connect());
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => {
      try { assertOperationActive(signal); }
      catch (error) { reject(error); }
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const client = await Promise.race([connecting, aborted]);
    assertOperationActive(signal);
    return client;
  } catch (error) {
    // A checkout can settle after the request has failed. It never starts a
    // transaction; return ONLY that exact late client to its owning pool.
    void connecting.then(client => client.release(error), () => {});
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function databaseConnectionFailure(error) {
  return Object.assign(new Error("The scheduler database connection was interrupted. The outcome is unknown; check the exact operation status before retrying."), {
    code: "static_weekly_control_plane_database_unavailable",
    cause: error instanceof Error ? error : undefined,
  });
}

function isDatabaseConnectionFailure(error) {
  const code = text(error?.code).toUpperCase();
  const message = text(error?.message).toLowerCase();
  return code.startsWith("08")
    || new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "53300", "53400", "57P01", "57P02", "57P03"]).has(code)
    || message.includes("connection terminated")
    || message.includes("connection error")
    || message.includes("not queryable")
    || message.includes("timeout exceeded when trying to connect");
}

function requireManager(manager) {
  const managerId = text(manager?.manager_id || manager?.managerId);
  if (!managerId || !text(manager?.manager_display_name || manager?.managerName) || manager?.read_only || manager?.auth_mode === "operations_first" || manager?.auth_mode === "admin_api_key") {
    throw fail("static_weekly_named_manager_required", "A trusted, write-enabled named manager session is required.");
  }
  return {
    managerId,
    // This is intentionally used only by the pure adapter's local request
    // shape. PostgreSQL ignores it and binds the persisted actor name from the
    // active manager registry using managerId.
    managerName: text(manager.manager_display_name || manager.managerName),
  };
}

function requireDate(value, label) {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail("static_weekly_control_plane_invalid_date", `${label} must be YYYY-MM-DD.`);
  return date;
}

function requireMonday(value, label) {
  const date = requireDate(value, label);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || parsed.getUTCDay() !== 1) {
    throw fail("static_weekly_control_plane_projection_week_required", `${label} must be a Monday-aligned YYYY-MM-DD date.`);
  }
  return date;
}

function requireDateInWeek(value, weekStart, label) {
  const date = requireDate(value, label);
  const startsAt = Date.parse(`${weekStart}T00:00:00Z`);
  const occursAt = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(occursAt) || date !== new Date(occursAt).toISOString().slice(0, 10) || occursAt < startsAt || occursAt > startsAt + (6 * 86_400_000)) {
    throw fail("static_weekly_control_plane_projection_week_mismatch", `${label} must fall within the Monday-aligned projection week.`);
  }
  return date;
}

function mondayForDate(value, label) {
  const date = requireDate(value, label);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw fail("static_weekly_control_plane_invalid_date", `${label} must be YYYY-MM-DD.`);
  }
  const daysSinceMonday = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - daysSinceMonday);
  return parsed.toISOString().slice(0, 10);
}

function projectionWeekForDate(projectionWeekStart, serviceDate) {
  const weekStart = text(projectionWeekStart)
    ? requireMonday(projectionWeekStart, "projection week start")
    : mondayForDate(serviceDate, "service date");
  requireDateInWeek(serviceDate, weekStart, "service date");
  return weekStart;
}

function requireRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw fail("static_weekly_control_plane_expected_revision_required");
  return value;
}

function requireIdempotencyKey(value) {
  const key = text(value);
  if (!key || key.length > 200) throw fail("static_weekly_control_plane_idempotency_required");
  return key;
}

function requireUuid(value, code) {
  const candidate = text(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(candidate)) throw fail(code);
  return candidate;
}

function projectionIdempotencyKey(value) {
  return `projection-${createHash("sha256").update(requireIdempotencyKey(value)).digest("hex")}`;
}

function dayChangeOperationIdempotencyKey(value, index) {
  if (!Number.isSafeInteger(index) || index < 0) throw fail("static_weekly_control_plane_day_changes_invalid");
  return `day-change-${createHash("sha256").update(`${requireIdempotencyKey(value)}:${index}`).digest("hex")}`;
}

function requireSourceId(value) {
  const sourceId = text(value);
  if (!sourceId) throw fail("static_weekly_control_plane_source_required");
  return sourceId;
}

function requirePublicationId(value) {
  const publicationId = text(value);
  if (!publicationId) throw fail("static_weekly_control_plane_current_publication_required", "A current published schedule is required before its weekly projection can be compiled.");
  return publicationId;
}

function requireWindow(value, label) {
  const start = text(value?.start);
  const end = text(value?.end);
  const startValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(start);
  const endValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end === "24:00";
  const toMinute = (time) => time === "24:00" ? 1440 : (Number(time.slice(0, 2)) * 60) + Number(time.slice(3));
  if (!startValid || !endValid || toMinute(start) >= toMinute(end)) {
    throw fail("static_weekly_control_plane_invalid_window", `${label} must be one ordered HH:MM window.`);
  }
  return { start, end };
}

function requireDayChangeOperations(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 25) {
    throw fail("static_weekly_control_plane_day_changes_invalid", "Day changes must contain between one and 25 operations.");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw fail("static_weekly_control_plane_day_changes_invalid", `Day change ${index + 1} must be an object.`);
    const operation = text(entry.operation || entry.type);
    const reason = text(entry.reason);
    if (!reason) throw fail("static_weekly_control_plane_day_changes_invalid", `Day change ${index + 1} requires a reason.`);
    if (operation === "exception") {
      const exceptionType = text(entry.exceptionType || entry.exception_type);
      const startsAt = text(entry.startsAt || entry.starts_at) || null;
      const endsAt = text(entry.endsAt || entry.ends_at) || null;
      if (!exceptionType || Boolean(startsAt) !== Boolean(endsAt) || !entry.payload || typeof entry.payload !== "object" || Array.isArray(entry.payload)) {
        throw fail("static_weekly_control_plane_day_changes_invalid", `Day change ${index + 1} has an invalid exception payload.`);
      }
      return { operation, exceptionType, startsAt, endsAt, reason, payload: clone(entry.payload), reversesExceptionId: text(entry.reversesExceptionId || entry.reverses_exception_id) || null };
    }
    if (operation === "cover_all" || operation === "contractor_capacity") {
      const slotId = text(entry.slotId || entry.slot_id);
      if (!slotId) throw fail("static_weekly_control_plane_day_changes_invalid", `Day change ${index + 1} requires a contractor slot.`);
      if (entry.shift != null && (!entry.shift || typeof entry.shift !== "object" || Array.isArray(entry.shift))) throw fail("static_weekly_control_plane_day_changes_invalid", `Day change ${index + 1} has an invalid contractor shift.`);
      return { operation: "cover_all", slotId, shift: entry.shift == null ? null : requireWindow(entry.shift, "contractor shift"), reason };
    }
    throw fail("static_weekly_control_plane_day_changes_invalid", `Day change ${index + 1} has an unsupported operation.`);
  });
}

function requireBatchPublicationSource(source, publicationId, versionId) {
  if (text(source?.publication_id) !== publicationId || text(source?.version_id) !== versionId) {
    throw fail("static_weekly_control_plane_day_changes_publication_mismatch", "Day changes must name the effective published schedule version.");
  }
  return source;
}

function contractorAvailabilityFromSource(source, slotId, serviceDate, requestedShift) {
  const raw = source?.compiler_input;
  const id = text(slotId);
  const slot = Array.isArray(raw?.slots) ? raw.slots.find((entry) => text(entry?.id) === id && entry?.contractorCapacity === true) : null;
  const weekday = new Date(`${requireDate(serviceDate, "service date")}T00:00:00Z`).getUTCDay();
  const template = Array.isArray(slot?.contractorAvailability) ? slot.contractorAvailability.find((entry) => entry?.dayOfWeek === weekday) : null;
  if (!slot || !template) throw fail("static_weekly_control_plane_contractor_slot_required", "The selected slot is not registered contractor capacity for this service day.");
  const requiredText = (field) => {
    const value = text(template[field]);
    if (!value) throw fail("static_weekly_control_plane_contractor_template_invalid", `Contractor capacity is missing ${field}.`);
    return value;
  };
  const effort = template.maxServiceEffortMinutes;
  if (!Number.isSafeInteger(effort) || effort < 1 || effort > 1440) throw fail("static_weekly_control_plane_contractor_template_invalid", "Contractor capacity has an invalid maximum service effort.");
  if (!Array.isArray(template.qualifications) || !Array.isArray(template.restrictions)) throw fail("static_weekly_control_plane_contractor_template_invalid", "Contractor capacity is missing qualifications or restrictions.");
  return {
    slotId: id,
    shift: requireWindow(requestedShift || template.shift, "contractor shift"),
    productiveCapacityProvenance: requiredText("productiveCapacityProvenance"),
    maxServiceEffortMinutes: effort,
    maxServiceEffortProvenance: requiredText("maxServiceEffortProvenance"),
    qualifications: clone(template.qualifications),
    qualificationProvenance: requiredText("qualificationProvenance"),
    restrictions: clone(template.restrictions),
    restrictionProvenance: requiredText("restrictionProvenance"),
    acceptedRouteAnchorLocationId: requiredText("acceptedRouteAnchorLocationId"),
    acceptedRouteProvenance: requiredText("acceptedRouteProvenance"),
  };
}

function compilerInputFromPublishedSource(source, serviceDate) {
  const raw = source?.compiler_input;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !raw.version || !Array.isArray(raw.slots) || !Array.isArray(raw.proximity)) throw fail("static_weekly_control_plane_source_invalid");
  return {
    serviceDate,
    timezone: raw.timezone || "America/Chicago",
    slots: clone(raw.slots),
    proximity: clone(raw.proximity),
    exceptions: clone(source.exceptions || []),
    versions: [clone(raw.version)],
  };
}

function replacementDraftInput(source, effectiveStart, { versionId = randomUUID() } = {}) {
  const raw = source?.compiler_input;
  const input = compilerInputFromPublishedSource({ compiler_input: raw, exceptions: [] }, effectiveStart);
  const resolvedVersionId = text(versionId);
  if (!resolvedVersionId) throw fail("static_weekly_control_plane_draft_version_required");
  input.versions[0] = {
    ...input.versions[0],
    id: resolvedVersionId,
    publicationId: randomUUID(),
    status: "published",
    effectiveStart,
    effectiveEnd: null,
  };
  return input;
}

export function staticWeeklyDatabaseConnectionOptions({
  connectionString = process.env.STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL,
  caPem = process.env.STATIC_WEEKLY_CONTROL_PLANE_DATABASE_CA_PEM,
  allowInsecureLoopbackRehearsal = /^(1|true|yes)$/i.test(String(process.env.STATIC_WEEKLY_CONTROL_PLANE_ALLOW_INSECURE_LOOPBACK_REHEARSAL || "")),
} = {}) {
  const rawConnectionString = text(connectionString);
  if (!rawConnectionString) throw fail("static_weekly_control_plane_database_url_required");
  const ca = String(caPem || "").replaceAll("\\n", "\n").trim();
  let url;
  try {
    url = new URL(rawConnectionString);
  } catch {
    throw fail("static_weekly_control_plane_database_url_invalid");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw fail("static_weekly_control_plane_database_url_invalid");
  }
  if (allowInsecureLoopbackRehearsal
      && /^(127\.0\.0\.1|localhost)$/.test(url.hostname)
      && /^\/mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(url.pathname)) {
    return { connectionString: url.toString(), ssl: false };
  }
  if (!/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(ca)) {
    throw fail(
      "static_weekly_control_plane_database_ca_required",
      "A PEM database certificate authority is required for the static weekly control plane.",
    );
  }

  // pg-connection-string lets URL TLS options replace an explicitly supplied
  // `ssl` object. Remove every URL-level TLS override so the reviewed CA,
  // certificate validation, and hostname validation below remain authoritative.
  for (const key of ["ssl", "sslcert", "sslkey", "sslmode", "sslnegotiation", "sslrootcert", "uselibpqcompat"]) {
    url.searchParams.delete(key);
  }
  return {
    connectionString: url.toString(),
    ssl: { ca: `${ca}\n`, rejectUnauthorized: true },
  };
}

export function createStaticWeeklyControlPlaneDatabase({
  connectionString = process.env.STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL,
  caPem = process.env.STATIC_WEEKLY_CONTROL_PLANE_DATABASE_CA_PEM,
  allowInsecureLoopbackRehearsal,
  pool = null,
} = {}) {
  if (pool) return pool;
  const database = new Pool({
    ...staticWeeklyDatabaseConnectionOptions({ connectionString, caPem, allowInsecureLoopbackRehearsal }),
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    application_name: "memphis-static-weekly-control-plane",
  });
  // pg-pool removes a failed idle connection before emitting this event. A
  // listener is still mandatory: EventEmitter otherwise converts a transient
  // idle connection loss into an uncaught process exception.
  database.on("error", (error) => {
    console.error("Static weekly control plane discarded an unavailable idle database connection.", {
      code: text(error?.code) || null,
      message: text(error?.message) || "Database connection unavailable.",
    });
  });
  return database;
}

export function createStaticWeeklyControlPlane({
  database,
  compiler = compileStaticWeeklyScheduleIsolated,
  compilerPreparer = compiler === compileStaticWeeklyScheduleIsolated ? compileAndPrepareStaticWeeklyScheduleIsolated : null,
  initializeSolver = initializeStaticWeeklyCompiler,
  getSolverReadiness = getStaticWeeklyCompilerReadiness,
  shutdownCompiler = compiler === compileStaticWeeklyScheduleIsolated ? shutdownStaticWeeklyCompiler : async () => {},
  transactionKeepaliveMs = 4_000,
  transactionConcurrency = 3,
  maxQueuedTransactions = 16,
  transactionAdmissionMilliseconds = STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS.requestMilliseconds,
  operationStatementMilliseconds = STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS,
  healthTransactionMilliseconds = 5_000,
} = {}) {
  if (!database?.connect) throw fail("static_weekly_control_plane_database_required");
  if (!Number.isSafeInteger(transactionKeepaliveMs) || transactionKeepaliveMs < 1 || transactionKeepaliveMs > 10_000) {
    throw fail("static_weekly_control_plane_keepalive_invalid");
  }
  if (!Number.isSafeInteger(transactionConcurrency) || transactionConcurrency < 1 || transactionConcurrency > 3) {
    throw fail("static_weekly_control_plane_transaction_concurrency_invalid");
  }
  if (!Number.isSafeInteger(maxQueuedTransactions) || maxQueuedTransactions < 1 || maxQueuedTransactions > 64) {
    throw fail("static_weekly_control_plane_transaction_queue_invalid");
  }
  if (!Number.isSafeInteger(transactionAdmissionMilliseconds) || transactionAdmissionMilliseconds < 1) {
    throw fail("static_weekly_control_plane_transaction_deadline_invalid");
  }
  if (!Number.isSafeInteger(operationStatementMilliseconds) || operationStatementMilliseconds < 30_000 || operationStatementMilliseconds > 180_000) {
    throw fail("static_weekly_control_plane_statement_deadline_invalid");
  }
  if (!Number.isSafeInteger(healthTransactionMilliseconds) || healthTransactionMilliseconds < 1 || healthTransactionMilliseconds > 10_000) {
    throw fail("static_weekly_control_plane_health_deadline_invalid");
  }

  // Carry the request through queueing and nested asynchronous helpers without
  // sharing mutable credentials between concurrent manager operations.
  const managerRequest = new AsyncLocalStorage();
  async function runManagerOperation({manager,signal,deadlineAt,permission="write"},work) {
    if(typeof work!=="function" || !signal || !Number.isFinite(deadlineAt))
      throw fail("static_weekly_recurring_operation_deadline_invalid");
    operationRemaining(deadlineAt,signal);
    return managerRequest.run(Object.freeze({manager:Object.freeze({...manager}),signal,deadlineAt,permission}),work);
  }
  async function verifyRequestActor(client,context){
    if(!context)return;
    const manager=context.manager;
    const actor=await call(client,"custodial_action_actor_v1",[
      manager.manager_id,manager.credential_id,manager.device_id,manager.access_level,context.permission]);
    if(actor?.manager_id!==manager.manager_id || actor?.credential_id!==manager.credential_id
      ||actor?.device_id!==manager.device_id || (context.permission==="write"&&actor.owner!==true))
      throw fail("42501","Current manager authority is required at the scheduler transaction boundary.");
  }
  let closing = false;
  let closePromise = null;
  let activeTransactions = 0;
  let activeHealthCheck = null;
  const activeTransactionPromises = new Set();
  const transactionQueue = [];

  function drainTransactionQueue() {
    while (!closing && activeTransactions < transactionConcurrency && transactionQueue.length) {
      const record = transactionQueue.shift();
      clearTimeout(record.timer);
      beginAdmittedTransaction(record);
    }
  }

  function beginAdmittedTransaction(record) {
    activeTransactions += 1;
    const execution = Promise.resolve().then(record.work);
    activeTransactionPromises.add(execution);
    execution.then(record.resolve, record.reject).finally(() => {
      activeTransactionPromises.delete(execution);
      activeTransactions -= 1;
      drainTransactionQueue();
    });
  }

  function admitTransaction(work, signal = null) {
    assertOperationActive(signal);
    if (closing) return Promise.reject(fail("static_weekly_control_plane_closing", "The scheduler is closing and cannot admit another operation."));
    if (transactionQueue.length >= maxQueuedTransactions) {
      return Promise.reject(fail("static_weekly_control_plane_busy", "The scheduler already has its maximum bounded operation queue."));
    }
    return new Promise((resolve, reject) => {
      const record = { work, resolve, reject, timer: null, onAbort: null };
      if (signal) {
        record.onAbort = () => {
          const index = transactionQueue.indexOf(record);
          if (index < 0) return;
          transactionQueue.splice(index, 1);
          clearTimeout(record.timer);
          reject(signal.reason instanceof Error ? signal.reason : fail("static_weekly_recurring_operation_aborted"));
        };
        signal.addEventListener("abort", record.onAbort, { once: true });
        if (signal.aborted) { signal.removeEventListener("abort", record.onAbort); reject(signal.reason); return; }
      }
      const priorResolve = record.resolve, priorReject = record.reject;
      record.resolve = (value) => { signal?.removeEventListener("abort", record.onAbort); priorResolve(value); };
      record.reject = (error) => { signal?.removeEventListener("abort", record.onAbort); priorReject(error); };
      if (activeTransactions < transactionConcurrency) {
        beginAdmittedTransaction(record);
        return;
      }
      record.timer = setTimeout(() => {
        const index = transactionQueue.indexOf(record);
        if (index >= 0) transactionQueue.splice(index, 1);
        record.reject(fail("static_weekly_control_plane_queue_timeout", "The scheduler operation expired before a database transaction was opened."));
      }, transactionAdmissionMilliseconds);
      record.timer.unref?.();
      transactionQueue.push(record);
    });
  }

  function admitHealthCheck(work) {
    if (closing) return Promise.reject(fail("static_weekly_control_plane_closing", "The scheduler is closing and cannot admit another health check."));
    // Render may overlap /healthz and /ready probes. Coalesce them onto one
    // reserved fourth-pool-slot transaction instead of creating an unbounded
    // pg-pool FIFO that can starve ordinary work during a slow database check.
    if (activeHealthCheck) return activeHealthCheck;
    const execution = Promise.resolve().then(work);
    activeHealthCheck = execution;
    execution.then(
      () => { if (activeHealthCheck === execution) activeHealthCheck = null; },
      () => { if (activeHealthCheck === execution) activeHealthCheck = null; },
    );
    return execution;
  }

  function transaction(work, { health = false, reconcileManagerId = null, signal = null, deadlineAt = null, rollbackOnly = false } = {}) {
    const request = health ? null : managerRequest.getStore();
    if(request){
      signal = signal ? AbortSignal.any([request.signal,signal]) : request.signal;
      deadlineAt = deadlineAt==null ? request.deadlineAt : Math.min(deadlineAt,request.deadlineAt);
    }
    const execute = async () => {
      assertOperationActive(signal);
      if (closing) throw fail("static_weekly_control_plane_closing", "The scheduler is closing and cannot open another database transaction.");
      let client;
      try {
        client = await acquireOperationClient(database, signal);
      } catch (error) {
        if (isDatabaseConnectionFailure(error)) throw databaseConnectionFailure(error);
        throw error;
      }
      let asynchronousConnectionError = null;
      let discardClientError = null;
      let commitCompleted = false;
      let commitStarted = false;
      const onConnectionError = (error) => { asynchronousConnectionError ||= error instanceof Error ? error : new Error("Database connection unavailable."); };
      const onAbort = () => {
        // pg Client.end() destroys its socket when a query is active. Awaited
        // query settlement below remains the transaction/lease boundary.
        discardClientError ||= fail("static_weekly_recurring_operation_aborted");
        try { void client.end?.()?.catch?.((error) => { asynchronousConnectionError ||= error; }); }
        catch (error) { asynchronousConnectionError ||= error; }
      };
      // pg-pool intentionally removes its idle error listener while a client
      // is checked out. The transaction owner must therefore catch the
      // client's asynchronous error event itself or Node terminates the whole
      // control-plane process before rollback/fail-closed handling can run.
      client.on?.("error", onConnectionError);
      signal?.addEventListener?.("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      try {
        assertOperationActive(signal);
        await client.query("begin");
        assertOperationActive(signal);
        // The login identity is provisioned separately and granted this NOLOGIN
        // capability group. Ordinary service-role credentials lack membership.
        await client.query("set local role static_weekly_control_plane");
        assertOperationActive(signal);
        await client.query(`set local statement_timeout = '${health ? healthTransactionMilliseconds
          : deadlineAt == null ? operationStatementMilliseconds
            : Math.min(operationStatementMilliseconds, operationRemaining(deadlineAt, signal))}ms'`);
        assertOperationActive(signal);
        if (!health) {
          // Acquire the shared disaster-recovery generation fence before any
          // source read or isolated compile. A restore therefore drains this
          // complete transaction and a later generation can never accept a
          // write prepared from pre-restore state.
          await client.query("select public.custodial_begin_application_mutation()");
          assertOperationActive(signal);
        }
        // Every in-flight SQL statement is awaited to settlement. Aborting
        // never releases a checked-out client or promises a rollback while a
        // query may still be changing state.
        const workClient = signal ? Object.assign(Object.create(client), {
          query: async (...args) => {
            assertOperationActive(signal);
            // A fresh SQL statement does not get a fresh minute. Its server
            // timeout is reduced to the remainder of this SAME request clock.
            if (deadlineAt != null) {
              await client.query(`set local statement_timeout = '${Math.min(operationStatementMilliseconds,
                operationRemaining(deadlineAt, signal))}ms'`);
              assertOperationActive(signal);
            }
            const result = await client.query(...args);
            assertOperationActive(signal);
            return result;
          },
        }) : client;
        // The existing SQL actor check locks the manager and credential until
        // commit/rollback, defining an order relative to concurrent revocation.
        await verifyRequestActor(workClient,request);
        let result = await work(workClient);
        assertOperationActive(signal);
        if (reconcileManagerId !== null) {
          // Finish the existing immutable mutation/projection/lunch receipt
          // before advancing future validity. The deferred DB guard and this
          // checked-out client keep both parts inside the SAME transaction.
          const validity = await call(client, "static_weekly_v21_reconcile_dependency_changes", [reconcileManagerId]);
          result = withRecurringDependencyStatus(result, validity);
        }
        if (asynchronousConnectionError) throw asynchronousConnectionError;
        assertOperationActive(signal);
        if (deadlineAt != null) {
          await client.query(`set local statement_timeout = '${Math.min(operationStatementMilliseconds,
            operationRemaining(deadlineAt, signal))}ms'`);
          assertOperationActive(signal);
        }
        await verifyRequestActor(workClient,request);
        assertOperationActive(signal);
        if (rollbackOnly) {
          // A vacancy preview exercises the ordinary authenticated mutation
          // and compiler on this SAME client, but cannot accept any change.
          // Return its candidate only after rollback actually settles. This
          // is not an exception/error swallowed into a successful preview.
          await client.query("rollback");
          assertOperationActive(signal);
          if (asynchronousConnectionError) throw asynchronousConnectionError;
          return result;
        }
        commitStarted = true;
        await client.query("commit");
        commitCompleted = true;
        if (signal?.aborted) throw fail("static_weekly_recurring_confirmation_outcome_unknown",
          "The response was interrupted during commit; read the exact confirmation status before retrying.");
        return result;
      } catch (error) {
        if (commitCompleted) throw error;
        if (commitStarted && signal?.aborted) {
          discardClientError = error instanceof Error ? error : new Error("Commit outcome unknown after abort.");
          throw fail("static_weekly_recurring_confirmation_outcome_unknown",
            "The transaction was interrupted during commit; read the exact confirmation status before retrying.");
        }
        let rollbackError = null;
        await client.query("rollback").catch((candidate) => { rollbackError = candidate; });
        const connectionError = asynchronousConnectionError
          || (isDatabaseConnectionFailure(error) ? error : null)
          || (isDatabaseConnectionFailure(rollbackError) ? rollbackError : null);
        if (connectionError) {
          discardClientError = connectionError;
          throw databaseConnectionFailure(connectionError);
        }
        throw error;
      } finally {
        signal?.removeEventListener?.("abort", onAbort);
        client.removeListener?.("error", onConnectionError);
        // Passing an error tells pg-pool to destroy a broken client rather than
        // return it to the pool for another authority transaction.
        client.release(discardClientError || asynchronousConnectionError || undefined);
      }
    };
    // The pool has four connections. Ordinary operations may occupy at most
    // three; one coalesced and separately bounded health transaction retains
    // the fourth slot while compiles or idempotent replays are queued.
    return health ? execute() : admitTransaction(execute, signal);
  }

  async function call(client, functionName, args) {
    const values = Array.isArray(args) ? args : [];
    const placeholders = values.map((_, index) => `$${index + 1}`).join(",");
    const { rows } = await client.query(`select public.${functionName}(${placeholders}) as result`, values);
    return rows[0]?.result;
  }

  async function lockStaticWeeklyAuthority(client) {
    await client.query(
      "select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))",
      [STATIC_WEEKLY_AUTHORITY_LOCK_IDENTITY],
    );
  }

  async function sourceFor(client, publicationId, serviceDate) {
    return call(client, "static_weekly_v3_read_publication_source", [publicationId, serviceDate]);
  }

  async function snapshotFor(client, weekStart) {
    return call(client, "static_weekly_v3_read_manager_snapshot", [weekStart]);
  }

  // Descriptive projection of the existing feasibility DTO for the preview
  // consumer. It is not an admission certificate or a new policy.
  function approvedStaticConstraintView(feasibility) {
    return {
      schema: 'custodial.approved-static-constraint-view.v1',
      contract: feasibility.contract,
      hardConstraintDigest: feasibility.hardConstraintDigest,
      hardConstraintCount: feasibility.hardConstraintCount,
      physicalCoverageDigest: feasibility.mapping?.physicalCoverageDigest,
      mappingDigest: feasibility.mapping?.digest,
      slotAvailability: feasibility.slotAvailability,
      projectionAvailability: feasibility.projectionAvailability,
      shiftEndDerivation: feasibility.shiftEndDerivation,
      geography: { digest: feasibility.mapping?.candidateDigest, policy: 'APPROVED_SOURCE_BOUND' },
      balance: { policy: 'FIXED_APPROVED_PATTERN_HARD_ROWS', optimized: false },
      opening: { policy: 'SOURCE_BOUND_WINDOWS_AND_REQUIRED_COVERAGE', proven: false },
    };
  }

  // Only the synchronous local serializer failure can enter this private join.
  // An error/code supplied by a SQL port or caller is never a preview token.
  const approvedStaticUnresolvedPreparations=new WeakMap();
  function approvedStaticUnresolvedPreview(error,{basis,target,choice,selection,publicationId,date,templateId,revision,deadlineAt}) {
    const invalid=()=>{throw fail('static_template_unresolved_preview_invalid');};
    if(!error||types.isProxy(error))invalid();
    const descriptor=Object.getOwnPropertyDescriptor(error,'unresolved');
    if(!descriptor||!Object.hasOwn(descriptor,'value')||descriptor.enumerable||descriptor.writable||descriptor.configurable)invalid();
    const diagnostic=descriptor.value,seen=new Set();let nodes=0;
    // The genuine producer owns a recursively frozen plain DATA graph. Inspect
    // descriptors before reading values/digesting; never execute diagnostic code.
    const graph=(value,depth=0)=>{
      if(++nodes>1000000||depth>64)invalid();
      if(value===null||typeof value==='string'||typeof value==='boolean')return;
      if(typeof value==='number'){if(!Number.isFinite(value))invalid();return;}
      if(!value||typeof value!=='object'||types.isProxy(value)||!Object.isFrozen(value)||seen.has(value))invalid();
      seen.add(value);
      if(Array.isArray(value)){
        if(value.length>100000||Reflect.ownKeys(value).length!==value.length+1)invalid();
        for(let i=0;i<value.length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));
          if(!d||!Object.hasOwn(d,'value')||!d.enumerable)invalid();graph(d.value,depth+1);}
      }else{
        if(Object.getPrototypeOf(value)!==Object.prototype)invalid();
        for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);
          if(typeof key!=='string'||!Object.hasOwn(d,'value')||!d.enumerable)invalid();graph(d.value,depth+1);}
      }
      seen.delete(value);
    };
    graph(diagnostic);
    const exact=(value,keys)=>{
      if(!value||Array.isArray(value)||typeof value!=='object'||Reflect.ownKeys(value).length!==keys.length
        ||keys.some(key=>!Object.hasOwn(value,key)))invalid();
    };
    exact(diagnostic,['schema','status','operationDate','dayOfWeek','originalWeekSourceDigest','currentWeekSourceDigest',
      'approvedTemplateSourceDigest','ownerConfigDigest','parentReferences','selectedAvailability','appliedExceptions',
      'namedHandoffReferences','unresolved','originalWeekSource']);
    const day=new Date(`${date}T00:00:00Z`).getUTCDay(),pre={...target.baselineCanonicalInput,exceptions:target.canonicalInput.exceptions};
    if(diagnostic.schema!=='custodial.approved-dated-mapped-shift-end-unresolved.v1'||diagnostic.status!=='UNRESOLVED'
      ||diagnostic.operationDate!==date||diagnostic.dayOfWeek!==day
      ||diagnostic.originalWeekSourceDigest!==postgresJsonbContentDigest(pre)
      ||diagnostic.currentWeekSourceDigest!==postgresJsonbContentDigest(pre)
      ||canonicalJson(diagnostic.originalWeekSource)!==canonicalJson(pre)
      ||diagnostic.ownerConfigDigest!==postgresJsonbContentDigest(basis.ownerConfig)
      ||!(templateId===null||typeof templateId==='string'&&templateId.trim()===templateId&&templateId.length>0&&templateId.length<=128))invalid();
    const approvedWire=clone(choice.source);
    if(approvedWire.version&&!approvedWire.versions){approvedWire.versions=[approvedWire.version];delete approvedWire.version;}
    const approved=prepareStaticWeeklySchedulingProblem(approvedWire,deadlineAt);
    if(approved.error||diagnostic.approvedTemplateSourceDigest!==postgresJsonbContentDigest(approved.baselineCanonicalInput))invalid();
    const parents=approved.baselineCanonicalInput.version.assignments.filter(row=>row.dayOfWeek===day),byId=new Map(parents.map(row=>[row.workId,row])),
      references=new Map(),roleMap=new Map(),actualRoles=new Map();
    if(!Array.isArray(diagnostic.parentReferences)||diagnostic.parentReferences.length!==parents.length)invalid();
    for(const reference of diagnostic.parentReferences){
      exact(reference,['dayOfWeek','parentWorkId','originalParent','mappedParent','originalOwnerSlotId','mappedOwnerSlotId','currentPersonId']);
      const original=byId.get(reference.parentWorkId),person=target.incumbencyByDaySlot.get(`${day}\u0000${reference.mappedOwnerSlotId}`);
      if(!original||references.has(original.workId)||reference.dayOfWeek!==day
        ||canonicalJson(reference.originalParent)!==canonicalJson(original)||reference.originalOwnerSlotId!==original.ownerSlotId
        ||canonicalJson(reference.mappedParent)!==canonicalJson({...original,ownerSlotId:reference.mappedOwnerSlotId})
        ||!person?.personId||person.personId!==reference.currentPersonId||!selection.availablePersonIds.includes(person.personId)
        ||roleMap.has(original.ownerSlotId)&&roleMap.get(original.ownerSlotId)!==reference.mappedOwnerSlotId
        ||actualRoles.has(reference.mappedOwnerSlotId)&&actualRoles.get(reference.mappedOwnerSlotId)!==original.ownerSlotId)invalid();
      references.set(original.workId,reference);roleMap.set(original.ownerSlotId,reference.mappedOwnerSlotId);actualRoles.set(reference.mappedOwnerSlotId,original.ownerSlotId);
    }
    const state=target.states.get(day),availability=[...state.availability].map(([slotId,value])=>{
      const person=target.incumbencyByDaySlot.get(`${day}\u0000${slotId}`);
      return {slotId,personId:person?.personId??null,vacant:person?.vacant===true,availability:clone(value)};
    }).sort((a,b)=>a.slotId.localeCompare(b.slotId)),handoffs=(approved.baselineCanonicalInput.version.shiftEndContinuityPolicy?.namedHandoffs||[])
      .filter(h=>h.dayOfWeek===day).map(h=>({originalHandoff:h,mappedFromSlotId:roleMap.get(h.fromSlotId)||h.fromSlotId,mappedToSlotId:roleMap.get(h.toSlotId)||h.toSlotId}));
    if(canonicalJson(diagnostic.selectedAvailability)!==canonicalJson(availability)
      ||canonicalJson(diagnostic.appliedExceptions)!==canonicalJson(target.applied.filter(e=>e.serviceDate===date))
      ||canonicalJson(diagnostic.namedHandoffReferences)!==canonicalJson(handoffs))invalid();
    const reasons=['NO_ELIGIBLE_INTERVAL_OWNER','ORIGINAL_BUDGET_INSUFFICIENT_FOR_POSITIVE_SEGMENTS','NAMED_HANDOFF_UNAVAILABLE',
      'FIXED_VISIT_REQUIRES_SINGLE_AVAILABLE_OWNER','LOCKED_PARENT_UNAVAILABLE'],clock=/^([01][0-9]|2[0-3]):[0-5][0-9]$/;
    const final=availability.filter(a=>a.personId&&!a.vacant).map(a=>a.availability.shift.end).sort().at(-1);
    if(!Array.isArray(diagnostic.unresolved)||diagnostic.unresolved.length<1||diagnostic.unresolved.length>10000)invalid();
    const rows=diagnostic.unresolved.map(row=>{
      exact(row,['dayOfWeek','parentWorkId','window','reason','originalBudget','requiredSegments']);exact(row.window,['start','end']);
      const parent=byId.get(row.parentWorkId),end=parent?.window.start==='09:45'?final:parent?.window.end;
      if(row.dayOfWeek!==day||typeof row.parentWorkId!=='string'||row.parentWorkId.trim()!==row.parentWorkId
        ||!row.parentWorkId||row.parentWorkId.length>512||/[\x00-\x1f\x7f]/.test(row.parentWorkId)||!parent
        ||typeof row.window.start!=='string'||typeof row.window.end!=='string'||!clock.test(row.window.start)||!clock.test(row.window.end)
        ||row.window.start>=row.window.end||row.window.start<parent.window.start||!end||row.window.end>end
        ||!reasons.includes(row.reason)||!Number.isSafeInteger(row.originalBudget)||row.originalBudget<1
        ||row.originalBudget!==parent.serviceEffortMinutes
        ||(row.reason==='ORIGINAL_BUDGET_INSUFFICIENT_FOR_POSITIVE_SEGMENTS'
          ?!Number.isSafeInteger(row.requiredSegments)||row.requiredSegments<=row.originalBudget:row.requiredSegments!==null))invalid();
      return Object.freeze({...row,window:Object.freeze({...row.window})});
    });
    return Object.freeze({schema:'custodial.approved-static-unresolved-preview.v1',status:'UNRESOLVED',sourcePublicationId:publicationId,
      authorityRevision:revision,serviceDate:date,kind:'DATED_ABSENCE',templateId,unresolved:Object.freeze(rows)});
  }

  async function approvedStaticPreparation(client,{actor,publicationId,date,kind,templateId,revision,deadlineAt,signal}) {
    operationRemaining(deadlineAt,signal);
    const basis=await call(client,'static_weekly_read_approved_template_basis',
      [actor.managerId,publicationId,date,kind,templateId,revision]);
    if(basis?.schema!=='custodial.approved-static-template-basis.v1'
      || basis.publicationId!==publicationId || basis.serviceDate!==date || basis.kind!==kind
      || basis.authorityRevision!==revision || !Number.isSafeInteger(basis.generation) || basis.generation<0
      || !Array.isArray(basis.templates) || !Array.isArray(basis.admittedBindings)
      || basis.templates.length>4 || basis.admittedBindings.length>4
      || !Array.isArray(basis.templateCatalogEntries)||basis.templateCatalogEntries.length!==basis.templates.length
      || basis.admittedBindings.length!==basis.templates.length
      || new Set(basis.templateCatalogEntries.map(entry=>entry?.templateId)).size!==basis.templates.length
      || basis.templateCatalogEntries.some((entry,i)=>!entry||typeof entry!=='object'||Array.isArray(entry)
        ||Object.keys(entry).length!==2||!Object.hasOwn(entry,'templateId')||!Object.hasOwn(entry,'entryDigest')
        ||entry.templateId!==basis.templates[i]?.templateId||entry.templateId!==basis.admittedBindings[i]?.templateId
        ||typeof entry.entryDigest!=='string'||entry.entryDigest.length!==64||!/^[a-f0-9]{64}$/.test(entry.entryDigest))
      // The SQL fingerprint includes release approval evidence, not merely
      // returned compiler inputs. Preserve BOTH distinct original bindings.
      || basis.templateCatalogDigest!==postgresJsonbContentDigest(basis.templateCatalogEntries)
      || basis.templateInputsDigest!==postgresJsonbContentDigest({templates:basis.templates,
        admittedBindings:basis.admittedBindings,ownerConfig:basis.ownerConfig}))
      throw fail('static_template_trusted_basis_invalid');
    const source=clone(basis.currentSource);
    if(source?.serviceDate!==date)throw fail('static_template_trusted_basis_invalid');
    const wire=clone(source);
    if(kind==='DATED_ABSENCE'){
      // The trusted basis carries the COMPLETE Monday week, while source and
      // command retain the original operation date. Do not require history
      // for the following Monday or choose Monday's person for Tuesday.
      const week=new Date(`${date}T00:00:00Z`);
      week.setUTCDate(week.getUTCDate()-((week.getUTCDay()+6)%7));
      wire.serviceDate=week.toISOString().slice(0,10);
    }
    if(wire.version&&!wire.versions){wire.versions=[wire.version];delete wire.version;}
    const target=prepareStaticWeeklySchedulingProblem(wire,deadlineAt);
    if(target.error)throw fail('static_template_target_authority_invalid');
    const day=new Date(`${date}T00:00:00Z`).getUTCDay();
    const operationRoster=kind==='DATED_ABSENCE'
      ?target.slots.map(slot=>target.incumbencyByDaySlot.get(`${day}\u0000${slot.id}`)):target.roster;
    const available=operationRoster.filter(p=>p.personId&&p.kind!=='CONTRACTOR_CAPACITY'
      && !target.version.namedAbsentSlotIds?.includes(p.slotId)
      && (kind!=='DATED_ABSENCE'||target.availabilityByDaySlot.has(`${day}\u0000${p.slotId}`)));
    const choices=basis.templates.filter(t=>t.staffingCount===available.length&&(!templateId||t.templateId===templateId));
    if(choices.length!==1)throw fail('static_template_missing_approved_pattern');
    const selection={schema:'custodial.static-template-selection.v1',kind,templateId:choices[0].templateId,
      serviceDate:date,availablePersonIds:available.map(p=>p.personId)};
    operationRemaining(deadlineAt,signal);
    const originalBasis=canonicalJson(basis);
    let feasibility;
    try{
      feasibility=prepareApprovedStaticTemplateProjection({templates:basis.templates,
        admittedBindings:basis.admittedBindings,currentSource:source,currentOwnerConfig:basis.ownerConfig,
        selection,deadline:deadlineAt});
    }catch(error){
      if(kind==='DATED_ABSENCE'&&error&&!types.isProxy(error)
        &&Object.getOwnPropertyDescriptor(error,'code')?.value==='static_template_dated_coverage_unresolved'){
        const preview=approvedStaticUnresolvedPreview(error,{basis,target,choice:choices[0],selection,publicationId,date,templateId,revision,deadlineAt});
        approvedStaticUnresolvedPreparations.set(error,{preview,originalBasis});
      }
      throw error;
    }
    operationRemaining(deadlineAt,signal);
    const body={schema:'custodial.approved-static-materialization.v1',managerId:actor.managerId,
      sourcePublicationId:publicationId,serviceDate:date,kind,expectedRevision:revision,
      generation:basis.generation,templateCatalogDigest:basis.templateCatalogDigest,
      templateInputsDigest:basis.templateInputsDigest,feasibility};
    const previewDigest=postgresJsonbContentDigest(body);
    return {...body,previewDigest};
  }

  async function approvedStaticOperation({manager,publicationId,serviceDate,kind='RECURRING_STAFFING',
    templateId=null,expectedRevision,previewDigest=null,idempotencyKey=null,signal=null,deadlineAt=null},confirm) {
    const entered=performance.now(),expires=deadlineAt==null?entered+STATIC_WEEKLY_MANAGER_OPERATION_DEADLINE_MS:
      Math.min(Number(deadlineAt),entered+STATIC_WEEKLY_MANAGER_OPERATION_DEADLINE_MS);
    if(!Number.isFinite(expires))throw fail('static_weekly_recurring_operation_deadline_invalid');
    const actor=requireManager(manager),requestedPublication=publicationId==null?null:requirePublicationId(publicationId),revision=requireRevision(expectedRevision);
    const originalManagerContext=managerRequest.getStore(),principalFields=['manager_id','managerId','manager_display_name','managerName',
      'credential_id','device_id','access_level','auth_mode','read_only'],originalPrincipal=principalFields.map(key=>manager?.[key]);
    const date=kind==='RECURRING_STAFFING'?requireMonday(serviceDate,'static effective start'):requireDate(serviceDate,'static service date');
    if(!['RECURRING_STAFFING','DATED_ABSENCE'].includes(kind))throw fail('static_template_selection_kind_invalid');
    // A dated projection retains one explicitly named original publication.
    // Unlike a recurring replacement it cannot adopt whichever plan happens
    // to be current after a lost response or a later principal/date change.
    if(kind==='DATED_ABSENCE'&&requestedPublication===null)throw fail('static_template_current_publication_required');
    if(templateId!==null&&(typeof templateId!=='string'||!templateId.trim()||templateId.length>128))throw fail('static_template_selection_invalid');
    const controller=new AbortController(),relay=()=>controller.abort(signal?.reason);
    signal?.addEventListener?.('abort',relay,{once:true});if(signal?.aborted)relay();
    const timeout=setTimeout(()=>controller.abort(fail('static_weekly_recurring_operation_deadline_exceeded')),
      Math.max(1,expires-performance.now()-STATIC_WEEKLY_MANAGER_CLEANUP_RESERVE_MS));timeout.unref?.();
    try {
      return await transaction(async client=>{
        await lockStaticWeeklyAuthority(client);
        const request={publicationId:requestedPublication,serviceDate:date,kind,templateId,
          expectedRevision:revision,previewDigest:confirm?text(previewDigest):null,
          idempotencyKey:confirm?requireIdempotencyKey(idempotencyKey):null};
        if(confirm){
          const original=await call(client,'static_weekly_read_approved_template_confirmation',[actor.managerId,request.idempotencyKey]);
          if(original){
            if(canonicalJson(original.request)!==canonicalJson(request)||original.receipt?.status!=='PERSISTED_CURRENT')
              throw fail('static_template_confirmation_identity_conflict');
            return {...original.receipt,replayed:true,status:'ACCEPTED_ORIGINAL_RECEIPT',currentReadbackNotRepeated:true};
          }
        }
        const week=new Date(`${date}T00:00:00Z`);week.setUTCDate(week.getUTCDate()-((week.getUTCDay()+6)%7));
        const before=await snapshotFor(client,week.toISOString().slice(0,10));
        if(before?.authority_revision!==revision)throw fail('static_template_revision_changed');
        const publication=requirePublicationId(before?.current_publication?.publication_id);
        if(requestedPublication&&requestedPublication!==publication)throw fail('static_template_current_publication_changed');
        const originalSnapshot=canonicalJson(before);
        let prepared;
        try{
          prepared=await approvedStaticPreparation(client,{actor,publicationId:publication,date,kind,templateId,
            revision,deadlineAt:expires,signal:controller.signal});
        }catch(error){
          const unresolved=error&&typeof error==='object'?approvedStaticUnresolvedPreparations.get(error):null;
          if(unresolved)approvedStaticUnresolvedPreparations.delete(error);
          if(confirm||!unresolved)throw error;
          const current=()=>{
            operationRemaining(expires,controller.signal);
            const now=requireManager(manager);
            if(managerRequest.getStore()!==originalManagerContext||now.managerId!==actor.managerId||now.managerName!==actor.managerName
              ||principalFields.some((key,i)=>manager?.[key]!==originalPrincipal[i]))throw fail('static_template_unresolved_principal_changed');
          };
          current();await verifyRequestActor(client,originalManagerContext);current();
          const currentBasis=await call(client,'static_weekly_read_approved_template_basis',[actor.managerId,publication,date,kind,templateId,revision]);
          current();
          if(canonicalJson(currentBasis)!==unresolved.originalBasis)throw fail('static_template_unresolved_source_changed');
          const currentSnapshot=await snapshotFor(client,week.toISOString().slice(0,10));
          current();
          if(canonicalJson(currentSnapshot)!==originalSnapshot)throw fail('static_template_unresolved_source_changed');
          await verifyRequestActor(client,originalManagerContext);current();
          return unresolved.preview;
        }
        if(!confirm)return {schema:'custodial.approved-static-preview.v1',status:'PREVIEW_ONLY',
          previewDigest:prepared.previewDigest,authorityRevision:revision,sourcePublicationId:publication,
          serviceDate:date,kind,templateId:prepared.feasibility.mapping.templateId,
          mapping:prepared.feasibility.mapping,assignments:prepared.feasibility.assignments,
          lunch:prepared.feasibility.lunchDocument,
          constraintView:approvedStaticConstraintView(prepared.feasibility),
          solverInvoked:false,published:false};
        if(!/^[a-f0-9]{64}$/.test(text(previewDigest))||previewDigest!==prepared.previewDigest)
          throw fail('static_template_preview_changed');
        const key=requireIdempotencyKey(idempotencyKey);
        operationRemaining(expires,controller.signal);
        const accepted=await call(client,'static_weekly_materialize_approved_template',
          [actor.managerId,publication,date,kind,revision,prepared.generation,key,previewDigest,{...prepared,request}]);
        if(accepted?.ok!==true||accepted.persistence_status!=='PERSISTED'
          || !/^[a-f0-9]{64}$/.test(text(accepted.lunch_document_identity))
          || accepted.feasibility_digest!==prepared.feasibility.digest
          || (kind==='DATED_ABSENCE'&&accepted.publication_id!==publication))
          throw fail('static_template_materialization_not_persisted');
        requirePublicationId(accepted.publication_id);requireUuid(accepted.projection_id,'static_template_materialization_not_persisted');
        const current=await snapshotFor(client,week.toISOString().slice(0,10));
        const lunch=await call(client,'static_weekly_v8_read_lunch_document',[date]);
        if(current?.projection_status!=='current'||current.authority_revision!==accepted.authority_revision
          || current.current_publication?.publication_id!==accepted.publication_id
          || current.latest_projection?.projection_id!==accepted.projection_id
          || lunch?.persistence_status!=='PERSISTED'||lunch.projection_id!==accepted.projection_id
          || lunch.document_identity!==accepted.lunch_document_identity)
          throw fail('static_template_current_readback_mismatch');
        operationRemaining(expires,controller.signal);
        return {schema:'custodial.approved-static-confirmation.v1',status:'PERSISTED_CURRENT',
          ...accepted,revision:accepted.authority_revision,previewDigest,solverInvoked:false};
      },{signal:controller.signal,deadlineAt:expires,reconcileManagerId:confirm?actor.managerId:null});
    } finally {clearTimeout(timeout);signal?.removeEventListener?.('abort',relay);}
  }

  // First fixed-approved baseline admission is not a staffing-change command
  // and does not borrow an optimized certificate. Source/catalog/roster are
  // server reads; only the distinct initial SQL boundary may publish it.
  async function approvedConfirmationStatus(kind,{manager,confirmationKey}) {
    const actor=requireManager(manager),key=requireUuid(confirmationKey,'recurring_confirmation_key_required');
    const refuse=()=>{throw fail('static_template_original_confirmation_unavailable',
      'The exact approved schedule receipt is unavailable. Keep the saved original; do not resend it.');};
    const data=(value,keys)=>{
      if(!value||typeof value!=='object'||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)refuse();
      const fields=Object.getOwnPropertyDescriptors(value);
      if(Reflect.ownKeys(fields).length!==keys.length||keys.some(name=>!Object.hasOwn(fields,name)
        ||!Object.hasOwn(fields[name],'value')||!fields[name].enumerable))refuse();
      return Object.fromEntries(keys.map(name=>[name,fields[name].value]));
    };
    return transaction(async client=>{
      // Use the SAME authority queue as the fixed-approved writer. A transport
      // timeout or the older compiler ledger cannot answer for this original.
      await lockStaticWeeklyAuthority(client);
      const raw=await call(client,kind==='initial'?'static_weekly_read_approved_initial_confirmation'
        :'static_weekly_read_approved_template_confirmation',[actor.managerId,key]);
      const result={schema:'custodial.approved-static-confirmation-status.v1',kind,
        state:'NOT_FOUND',confirmationKey:key,request:null,receipt:null};
      // Absence is DATA only: it does not cancel a queued writer, allow a
      // resend, discard the original or manufacture a new operation identity.
      if(raw===null)return result;
      const stored=data(raw,['request','receipt']);
      const request=data(stored.request,kind==='initial'
        ?['sourceId','effectiveStart','templateId','expectedRevision','previewDigest','idempotencyKey']
        :['publicationId','serviceDate','kind','templateId','expectedRevision','previewDigest','idempotencyKey']);
      if(request.idempotencyKey!==key||!Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<0
        ||typeof request.previewDigest!=='string'||request.previewDigest.length!==64||!/^[a-f0-9]{64}$/.test(request.previewDigest))refuse();
      const template=request.templateId;
      if(template!==null&&(typeof template!=='string'||!template.trim()||template!==template.trim()||template.length>128))refuse();
      if(kind==='initial'){
        requireUuid(request.sourceId,'static_template_original_confirmation_unavailable');
        requireMonday(request.effectiveStart,'original approved initial week');
        if(template===null)refuse();
      }else if(request.kind==='DATED_ABSENCE'){
        // The fixed ledger owns this original. A dated projection retains its
        // publication and may target any real day, not just a recurring Monday.
        if(typeof request.publicationId!=='string'
          ||requireUuid(request.publicationId,'static_template_original_confirmation_unavailable')!==request.publicationId
          ||typeof request.serviceDate!=='string'
          ||requireDate(request.serviceDate,'original approved operation date')!==request.serviceDate)refuse();
        const date=new Date(`${request.serviceDate}T00:00:00Z`);
        if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==request.serviceDate)refuse();
      }else{
        if(request.publicationId!==null||request.kind!=='RECURRING_STAFFING')refuse();
        requireMonday(request.serviceDate,'original approved recurring week');
      }
      const receipt=stored.receipt;
      if(!receipt||typeof receipt!=='object'||types.isProxy(receipt)||Object.getPrototypeOf(receipt)!==Object.prototype
        ||Object.values(Object.getOwnPropertyDescriptors(receipt)).some(field=>!Object.hasOwn(field,'value'))
        ||receipt.schema!==`custodial.approved-static${kind==='initial'?'-initial':''}-confirmation.v1`
        ||receipt.status!=='PERSISTED_CURRENT'||receipt.ok!==true||receipt.persistence_status!=='PERSISTED'
        ||receipt.solverInvoked!==false||receipt.previewDigest!==request.previewDigest
        ||!Number.isSafeInteger(receipt.authority_revision)||receipt.authority_revision<=request.expectedRevision
        ||receipt.revision!==receipt.authority_revision
        ||!['feasibility_digest','lunch_document_identity'].every(name=>typeof receipt[name]==='string'&&receipt[name].length===64&&/^[a-f0-9]{64}$/.test(receipt[name])))refuse();
      requireUuid(receipt.publication_id,'static_template_original_confirmation_unavailable');
      requireUuid(receipt.projection_id,'static_template_original_confirmation_unavailable');
      if(kind==='initial'&&receipt.source_id!==request.sourceId)refuse();
      if(kind!=='initial'&&request.kind==='DATED_ABSENCE'
        &&(receipt.publication_id!==request.publicationId||typeof receipt.projection_id!=='string'
          ||requireUuid(receipt.projection_id,'static_template_original_confirmation_unavailable')!==receipt.projection_id))refuse();
      return {...result,state:'ACCEPTED',request:clone(request),receipt:clone(receipt)};
    });
  }

  async function approvedInitialOperation({manager,sourceId,effectiveStart,templateId,
    expectedRevision,previewDigest=null,idempotencyKey=null,signal=null,deadlineAt=null},confirm){
    const entered=performance.now(),expires=deadlineAt==null?entered+STATIC_WEEKLY_MANAGER_OPERATION_DEADLINE_MS:
      Math.min(Number(deadlineAt),entered+STATIC_WEEKLY_MANAGER_OPERATION_DEADLINE_MS);
    if(!Number.isFinite(expires))throw fail('static_weekly_recurring_operation_deadline_invalid');
    const actor=requireManager(manager),id=requireSourceId(sourceId),date=requireMonday(effectiveStart,'effective start'),
      revision=requireRevision(expectedRevision);
    if(typeof templateId!=='string'||!templateId.trim()||templateId.length>128)throw fail('static_template_selection_invalid');
    const controller=new AbortController(),relay=()=>controller.abort(signal?.reason);
    signal?.addEventListener?.('abort',relay,{once:true});if(signal?.aborted)relay();
    const timeout=setTimeout(()=>controller.abort(fail('static_weekly_recurring_operation_deadline_exceeded')),
      Math.max(1,expires-performance.now()-STATIC_WEEKLY_MANAGER_CLEANUP_RESERVE_MS));timeout.unref?.();
    try{return await transaction(async client=>{
      operationRemaining(expires,controller.signal);
      await lockStaticWeeklyAuthority(client);
      const request={sourceId:id,effectiveStart:date,templateId,expectedRevision:revision,
        previewDigest:confirm?text(previewDigest):null,idempotencyKey:confirm?requireIdempotencyKey(idempotencyKey):null};
      if(confirm){
        const prior=await call(client,'static_weekly_read_approved_initial_confirmation',[actor.managerId,request.idempotencyKey]);
        if(prior){
          if(canonicalJson(prior.request)!==canonicalJson(request)||prior.receipt?.status!=='PERSISTED_CURRENT')
            throw fail('static_template_confirmation_identity_conflict');
          return {...prior.receipt,replayed:true,status:'ACCEPTED_ORIGINAL_RECEIPT',currentReadbackNotRepeated:true};
        }
      }
      // Initial admission already names an exact registered source/template.
      // The generic unbound snapshot deliberately requires a single active
      // source before the first publication, so it cannot arbitrate this
      // source-specific path when immutable historical sources are retained.
      // Keep that generic guard untouched: the private initial-basis RPC checks
      // the named actor, current revision, live template and hydrated roster
      // under this same authority lock and restore-generation fence.
      let basis;
      try {
        basis=await call(client,'static_weekly_read_approved_initial_basis',[actor.managerId,id,date,revision,templateId]);
      } catch(error) {
        if(error?.code==='40001')throw fail('static_template_revision_changed');
        throw error;
      }
      if(basis?.authorityRevision!==revision)throw fail('static_template_revision_changed');
      const registered=await registeredSourceFor(client,id,date);
      if(!registered?.compiler_input||typeof registered.compiler_input!=='object')throw fail('static_template_initial_source_invalid');
      const source=clone(registered?.compiler_input);
      if(registered?.source_id!==id||source?.serviceDate!==date||source.version?.effectiveStart!==date
        || !Array.isArray(source.exceptions)||source.exceptions.length||registered.exceptions?.length)
        throw fail('static_template_initial_source_invalid');
      if(basis?.schema!=='custodial.approved-static-initial-basis.v1'||basis.sourceId!==id||basis.serviceDate!==date
        ||basis.authorityRevision!==revision||!Number.isSafeInteger(basis.generation)||basis.generation<0
        ||!Array.isArray(basis.templates)||basis.templates.length!==1||!Array.isArray(basis.admittedBindings)||basis.admittedBindings.length!==1
        ||basis.currentSourceDigest!==postgresJsonbContentDigest(source)||canonicalJson(basis.currentSource)!==canonicalJson(source)
        ||basis.templateCatalogDigest!==postgresJsonbContentDigest({templates:basis.templates,
          admittedBindings:basis.admittedBindings,ownerConfig:basis.ownerConfig}))
        throw fail('static_template_trusted_basis_invalid');
      const configPeople=Object.values(basis.ownerConfig?.slots||{}).filter(s=>!s.vacancy).map(s=>s.personId);
      const feasibility=prepareApprovedStaticTemplateProjection({templates:basis.templates,admittedBindings:basis.admittedBindings,
        currentSource:source,currentOwnerConfig:basis.ownerConfig,selection:{schema:'custodial.static-template-selection.v1',
          kind:'INITIAL_BASELINE',templateId,serviceDate:date,availablePersonIds:configPeople},deadline:expires});
      if(!feasibility.initialBaseline||!feasibility.mapping.unchanged||feasibility.currentSourceDigest!==basis.currentSourceDigest)
        throw fail('static_template_initial_baseline_must_be_exact');
      const body={schema:'custodial.approved-static-initial-materialization.v1',managerId:actor.managerId,sourceId:id,
        effectiveStart:date,expectedRevision:revision,generation:basis.generation,
        templateCatalogDigest:basis.templateCatalogDigest,feasibility};
      const digest=postgresJsonbContentDigest(body);
      operationRemaining(expires,controller.signal);
      if(!confirm)return {schema:'custodial.approved-static-initial-preview.v1',status:'PREVIEW_ONLY',previewDigest:digest,
        sourceId:id,effectiveStart:date,serviceDate:date,templateId,authorityRevision:revision,assignments:feasibility.assignments,
        lunch:feasibility.lunchDocument,mapping:feasibility.mapping,
        constraintView:approvedStaticConstraintView(feasibility),
        solverInvoked:false,published:false};
      if(!/^[a-f0-9]{64}$/.test(text(previewDigest))||previewDigest!==digest)throw fail('static_template_preview_changed');
      const accepted=await call(client,'static_weekly_materialize_approved_initial_baseline',
        [actor.managerId,id,date,revision,basis.generation,request.idempotencyKey,{...body,previewDigest:digest,request}]);
      if(accepted?.ok!==true||accepted.persistence_status!=='PERSISTED'||accepted.feasibility_digest!==feasibility.digest
        ||accepted.source_id!==id||!Number.isSafeInteger(accepted.authority_revision)
        ||!accepted.lunch_document_identity||accepted.lunch_document_identity!==feasibility.lunchDocument.document_identity)
        throw fail('static_template_materialization_not_persisted');
      requirePublicationId(accepted.publication_id);requireUuid(accepted.projection_id,'static_template_materialization_not_persisted');
      const current=await snapshotFor(client,date),lunch=await call(client,'static_weekly_v8_read_lunch_document',[date]);
      if(current?.projection_status!=='current'||current.authority_revision!==accepted.authority_revision
        ||current.current_publication?.publication_id!==accepted.publication_id||current.latest_projection?.projection_id!==accepted.projection_id
        ||lunch?.persistence_status!=='PERSISTED'||lunch.projection_id!==accepted.projection_id
        ||lunch.document_identity!==accepted.lunch_document_identity)throw fail('static_template_current_readback_mismatch');
      operationRemaining(expires,controller.signal);
      return {schema:'custodial.approved-static-initial-confirmation.v1',status:'PERSISTED_CURRENT',...accepted,
        revision:accepted.authority_revision,previewDigest:digest,solverInvoked:false};
    },{signal:controller.signal,deadlineAt:expires,reconcileManagerId:confirm?actor.managerId:null});
    }finally{clearTimeout(timeout);signal?.removeEventListener?.('abort',relay);}
  }

  async function registeredSourceFor(client, sourceId, effectiveStart) {
    return call(client, "static_weekly_v3_read_authority_source", [
      requireSourceId(sourceId),
      requireMonday(effectiveStart, "effective start"),
    ]);
  }

  async function compileOrFail(input) {
    const result = await compiler(input);
    if (result?.status !== "FEASIBLE" || result?.publicationAuthority !== "ACCEPTABLE" || result?.verifier?.ok !== true) {
      throw fail("static_weekly_control_plane_compiler_rejected", "Canonical source did not produce a publishable verified schedule.");
    }
    return result;
  }

  async function prepareDraft(input, { expectedRevision, actor }) {
    assertOwnerRecurringWorkdays(input);
    if (compilerPreparer) {
      return compilerPreparer(input, { kind: "draft", expectedRevision, actor });
    }
    return createStaticWeeklyDraftRpcInput({ result: await compileOrFail(input), expectedRevision, actor });
  }

  async function prepareProjection(input, { publicationId, expectedRevision, actor, deadlineMilliseconds = null }) {
    assertOwnerRecurringWorkdays(input);
    if (compilerPreparer) {
      return compilerPreparer(input, { kind: "projection", publicationId, expectedRevision, actor },
        deadlineMilliseconds == null ? {} : { deadlineMilliseconds });
    }
    return createStaticWeeklyProjectionWithLunchRpcInput({ result: await compileOrFail(input), publicationId, expectedRevision, actor });
  }

  async function prepareInsideTransaction(client, work) {
    // Production deliberately gives the runtime login a short
    // idle-in-transaction timeout. Both the canonical compiler and the pure
    // database adapter perform substantial deterministic CPU work. Keep all of
    // that work in the isolated compiler process so the transaction owner can
    // continue its read-only keepalive until the prepared RPC input is ready.
    // Never relax the database timeout or split mutation and projection
    // authority merely to accommodate event-loop starvation.
    let heartbeatFailure = null;
    let pendingHeartbeat = Promise.resolve();
    const timer = setInterval(() => {
      if (heartbeatFailure) return;
      pendingHeartbeat = pendingHeartbeat
        .then(() => client.query("select 1"))
        .catch((error) => { heartbeatFailure ||= error; });
    }, transactionKeepaliveMs);
    timer.unref?.();
    try {
      const result = await work();
      // Stop scheduling before awaiting the last queued heartbeat. Otherwise a
      // timer tick can extend the chain after this await has captured it and a
      // late failure could be missed immediately before the authority write.
      clearInterval(timer);
      await pendingHeartbeat;
      if (heartbeatFailure) throw heartbeatFailure;
      return result;
    } finally {
      clearInterval(timer);
      await pendingHeartbeat.catch(() => {});
    }
  }

  async function materializeCurrentProjection(client, { actor, publicationId, weekStart, expectedRevision, idempotencyKey }) {
    const source = await sourceFor(client, requirePublicationId(publicationId), weekStart);
    const effectivePublicationId = requirePublicationId(publicationId);
    const revision = requireRevision(expectedRevision);
    const preparedActor = { ...actor, idempotencyKey: requireIdempotencyKey(idempotencyKey) };
    const projection = await prepareInsideTransaction(client, () => prepareProjection(
      compilerInputFromPublishedSource(source, weekStart),
      { publicationId: effectivePublicationId, expectedRevision: revision, actor: preparedActor },
    ));
    if (!projection.lunchDocument?.document_identity
      || projection.lunchDocument.base_replay_digest !== projection.replayDigest
      || projection.lunchDocument.base_authority_digest !== projection.envelope?.authority_digest) {
      throw fail("static_weekly_lunch_publication_missing", "The verified projection must include its lunch responsibilities.");
    }
    const materialized = await call(client, "static_weekly_v3_materialize_projection", [projection.publicationId, projection.serviceDate, projection.exceptionSetDigest, projection.compilerVersion, projection.objective, projection.metrics, projection.replayDigest, projection.envelope, projection.expectedRevision, actor.managerId, projection.idempotencyKey]);
    const lunchPublication = await call(client, "static_weekly_v8_materialize_lunch_document",
      [materialized?.data?.projection_id, projection.lunchDocument, actor.managerId]);
    if (lunchPublication?.ok !== true || lunchPublication.persistence_status !== "PERSISTED"
      || lunchPublication.projection_id !== materialized?.data?.projection_id
      || lunchPublication.document_identity !== projection.lunchDocument.document_identity) {
      throw fail("static_weekly_lunch_publication_failed", "Lunch responsibilities were not accepted with the weekly projection.");
    }
    const current = await snapshotFor(client, weekStart);
    if (current?.projection_status !== "current" || text(current?.current_publication?.publication_id) !== projection.publicationId || text(current?.latest_projection?.projection_id) !== text(materialized?.data?.projection_id)) {
      throw fail("static_weekly_control_plane_projection_not_current", "The compiled weekly projection did not become the current authority projection.");
    }
    return {
      ...materialized,
      data: {
        ...materialized.data,
        current_projection: current.latest_projection,
      },
    };
  }

  async function mutateAndMaterializeCurrentProjection(client, { actor, publicationId, weekStart, idempotencyKey, mutate }) {
    const mutation = await mutate();
    const effectiveWeekStart = typeof weekStart === "function" ? await weekStart(mutation) : weekStart;
    const projection = await materializeCurrentProjection(client, {
      actor,
      publicationId: typeof publicationId === "function" ? await publicationId(mutation) : publicationId,
      weekStart: effectiveWeekStart,
      expectedRevision: requireRevision(mutation?.revision),
      idempotencyKey: projectionIdempotencyKey(idempotencyKey),
    });
    return {
      ...projection,
      data: {
        ...mutation.data,
        ...projection.data,
        mutation: mutation.data,
      },
    };
  }

  async function completeRosterChange(client, { actor, weekStart, idempotencyKey, expectedRevision, operation, mutate }) {
    await lockStaticWeeklyAuthority(client);
    const current = await snapshotFor(client, weekStart);
    const priorRevision = requireRevision(current?.authority_revision);
    const mutation = await mutate(); // Authenticates all original semantic inputs even on retry.
    if (priorRevision !== expectedRevision || mutation?.data?.completion_mode === "mutation_only") {
      const completed = await call(client, "static_weekly_v9_read_completed_roster_change", [actor.managerId, idempotencyKey, operation]);
      if (!completed) throw fail("static_weekly_roster_completion_missing", "The original staffing completion is missing; no new schedule change was accepted.");
      return completed;
    }
    if (mutation?.data?.completion_mode !== "projection_required"
      || text(mutation.data.original_publication_id) !== text(current?.current_publication?.publication_id)) {
      throw fail("static_weekly_roster_completion_mismatch", "The staffing change does not bind the original published schedule.");
    }
    return mutateAndMaterializeCurrentProjection(client, {
      actor, weekStart, idempotencyKey,
      publicationId: requirePublicationId(mutation.data.original_publication_id), mutate: async () => mutation,
    });
  }

  return {
    runManagerOperation,
    async getApprovedScheduleChoices({manager}) {
      requireManager(manager);
      return transaction(client=>call(client,"custodial_read_approved_schedule_choices_v1",[
        manager.manager_id,manager.credential_id,manager.device_id,manager.access_level]));
    },
    async getApprovedInitialSelection({manager,weekStart,signal,deadlineAt}) {
      requireManager(manager);
      const week=requireMonday(weekStart,'initial selection week');
      return transaction(client=>call(client,'custodial_read_approved_initial_selection_v1',[
        manager.manager_id,manager.credential_id,manager.device_id,manager.access_level,week]),{signal,deadlineAt});
    },
    async previewApprovedStaticPattern(input) { return approvedStaticOperation(input,false); },
    async confirmApprovedStaticPattern(input) { return approvedStaticOperation(input,true); },
    async previewApprovedInitialBaseline(input) { return approvedInitialOperation(input,false); },
    async publishApprovedInitialBaseline(input) { return approvedInitialOperation(input,true); },
    async getApprovedInitialConfirmationStatus(input) { return approvedConfirmationStatus('initial',input); },
    async getApprovedStaticConfirmationStatus(input) { return approvedConfirmationStatus('recurring',input); },
    schema: STATIC_WEEKLY_CONTROL_PLANE_SCHEMA,
    health() {
      return admitHealthCheck(async () => {
        const authority = await transaction(async (client) => {
          const base = await call(client, "static_weekly_v3_authority_health", []);
          const dayChanges = await call(client, "static_weekly_v4_day_changes_health", []);
          return {
            ...base,
            day_changes: dayChanges,
            ready: base?.ready === true && dayChanges?.ready === true,
          };
        }, { health: true });
        try {
          await initializeSolver();
        } catch (error) {
          return {
            ...authority,
            ready: false,
            authority_ready: authority?.ready === true,
            solver: { ...getSolverReadiness(), error: error?.message || "Static weekly solver initialization failed." },
          };
        }
        const solver = getSolverReadiness();
        return {
          ...authority,
          authority_ready: authority?.ready === true,
          solver,
          ready: authority?.ready === true && solver?.available === true,
        };
      });
    },
    async getManagerSnapshot({ manager, weekStart }) {
      requireManager(manager);
      return transaction((client) => snapshotFor(client, requireMonday(weekStart, "week start")));
    },
    async beginStaffingCommand({ manager, ...input }) {
      const actor = requireManager(manager);
      return transaction(async(client) => {
        const {rows}=await client.query("select public.sch_service_date(statement_timestamp())::text as service_date");
        // A byte-identical begin may be an idempotent recovery after its response
        // was lost before midnight. PostgreSQL first resolves the authenticated
        // manager + prepare-key identity, then rejects an elapsed *new* command.
        const request = createStaffingCommandRequest(input,{minimumServiceDate:rows[0]?.service_date,
          allowElapsedAuthorityReplay:true});
        return call(client, "static_weekly_v10_begin_staffing_command", [request.semanticBody,
          request.clientPrepareKey,request.expectedRevision,actor.managerId]);
      });
    },
    async prepareStaffingCommand({ manager, operationId }) {
      const actor = requireManager(manager);
      const operation = requireUuid(operationId, "staffing_operation_id_required");
      return transaction(async (client) => {
        const command = await call(client, "static_weekly_v10_read_staffing_command", [operation, actor.managerId]);
        if (!command) throw fail("staffing_operation_unavailable");
        if (command.state === "PREPARED") return command;
        if (command.state !== "PREPARING") throw fail("staffing_operation_not_preparable");
        if (text(command.prepared_by_manager_id) !== actor.managerId) throw fail("staffing_original_preparer_required");
        const semantic = command.semantic_body;
        const window = enumerateStaffingServiceWindow(semantic.startDate, semantic.endDate);
        const currentTargets=await call(client,"static_weekly_v11_read_current_refresh_targets",
          [semantic.startDate,semantic.endDate,actor.managerId]);
        const priorByDate=new Map();
        for(const row of Array.isArray(currentTargets)?currentTargets:[]){
          if(!priorByDate.has(row.serviceDate))priorByDate.set(row.serviceDate,new Set());
          priorByDate.get(row.serviceDate).add(text(row.employeeId));
        }
        const meter = createStaffingPreparationMeter();
        const prepared = await prepareInsideTransaction(client, async () => {
          const candidates = []; const weeks = []; const inputDigests = [];
          for (const weekStart of window.weeks) {
            const budget = meter.checkpoint();
            const snapshot = await snapshotFor(client, weekStart);
            if (requireRevision(snapshot?.authority_revision) !== command.expected_revision) {
              throw fail("staffing_preparation_revision_changed");
            }
            const publicationId = requirePublicationId(snapshot?.current_publication?.publication_id);
            const source = await sourceFor(client, publicationId, weekStart);
            const overlay = createStaffingWeekPreviewInput({ operationId: operation, managerId: actor.managerId,
              semanticBody: semantic, expectedRevision: command.expected_revision, weekStart, source,
              currentServiceDate: command.current_service_date });
            const projection = await prepareProjection(overlay.input, {
              publicationId, expectedRevision: command.expected_revision,
              actor: { ...actor, idempotencyKey: `staffing:${operation}:${weekStart}` },
              deadlineMilliseconds: Math.max(1, Math.floor(budget.remainingMilliseconds)),
            });
            if (!projection.lunchDocument?.document_identity) throw fail("static_weekly_lunch_publication_missing");
            const { lunchDocument, ...projectionPayload } = projection;
            candidates.push({ candidateKind: "lunch", candidateKey: `week:${weekStart}`, serviceDate: weekStart,
              payload: lunchDocument });
            candidates.push({ candidateKind: "projection", candidateKey: `week:${weekStart}`, serviceDate: weekStart,
              payload: projectionPayload });
            for (const serviceDate of overlay.dates) {
              const employees = new Set(priorByDate.get(serviceDate)||[]);
              for(const employeeId of projection.envelope.assignments
                .filter(row => row.service_date === serviceDate && text(row.status).toLowerCase() === "assigned" && text(row.owner_person_id))
                .map(row => text(row.owner_person_id)))employees.add(employeeId);
              for(const responsibility of Array.isArray(lunchDocument.responsibilities)?lunchDocument.responsibilities:[]){
                if(responsibility?.service_date!==serviceDate)continue;
                for(const employeeId of [responsibility.normal_owner_person_id,responsibility.coverer_person_id])if(text(employeeId))employees.add(text(employeeId));
              }
              employees.add(semantic.employeeId);
              for (const employeeId of [...employees].sort()) candidates.push({ candidateKind: "schedule_refresh",
                candidateKey: `date:${serviceDate}:employee:${employeeId}`, serviceDate,
                payload: { employeeId, weekStart, publicationId, projectionIdentity: projection.envelope.database_projection_identity,
                  lunchDocumentIdentity: lunchDocument.document_identity } });
            }
            weeks.push(overlay.publication);
            inputDigests.push(createHash("sha256").update(canonicalJson(overlay.input)).digest("hex"));
            meter.checkpoint();
          }
          const candidateSet = createStaffingCandidateSet({ window, candidates, meter });
          const publicationVector = { expectedRevision: command.expected_revision, weeks };
          const inputDigest = createHash("sha256").update(canonicalJson({ operationId: operation,
            semanticDigest: command.semantic_digest, publicationVector, inputDigests })).digest("hex");
          const previewDigest = createHash("sha256").update(canonicalJson({ operationId: operation,
            semanticDigest: command.semantic_digest, candidateSetDigest: candidateSet.digest,
            publicationVector, summary: candidateSet.summary })).digest("hex");
          return { candidateSet, publicationVector, inputDigest, previewDigest };
        });
        const databaseCandidates = prepared.candidateSet.rows.map(({ candidateKind, candidateKey, serviceDate, payload }) => ({
          candidateKind, candidateKey, payload, serviceDate,
        }));
        return call(client, "static_weekly_v10_stage_staffing_command", [operation, databaseCandidates,
          prepared.previewDigest, prepared.inputDigest, prepared.publicationVector, actor.managerId]);
      });
    },
    async stageStaffingCommand({ manager, operationId, window, candidates, previewDigest, inputDigest, publicationVector }) {
      const actor = requireManager(manager);
      const candidateSet = createStaffingCandidateSet({ window, candidates });
      const requireDigest = (value, code) => {
        const normalized = text(value);
        if (!/^[0-9a-f]{64}$/.test(normalized)) throw fail(code);
        return normalized;
      };
      if (!publicationVector || typeof publicationVector !== "object" || Array.isArray(publicationVector)) {
        throw fail("staffing_publication_vector_required");
      }
      const databaseCandidates = candidateSet.rows.map(({ candidateKind, candidateKey, serviceDate, payload }) => ({
        candidateKind, candidateKey, payload, serviceDate,
      }));
      return transaction((client) => call(client, "static_weekly_v10_stage_staffing_command", [
        requireUuid(operationId, "staffing_operation_id_required"),
        databaseCandidates,
        requireDigest(previewDigest, "staffing_preview_digest_required"),
        requireDigest(inputDigest, "staffing_input_digest_required"),
        structuredClone(publicationVector),
        actor.managerId,
      ]));
    },
    async getStaffingCommand({ manager, operationId }) {
      const actor = requireManager(manager);
      return transaction((client) => call(client, "static_weekly_v10_read_staffing_command", [
        requireUuid(operationId, "staffing_operation_id_required"),
        actor.managerId,
      ]));
    },
    async listPendingStaffingCommands({ manager, limit = 50, afterCreatedAt = null, afterOperationId = null }) {
      const actor = requireManager(manager);
      const pageLimit = Number(limit);
      if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 100) throw fail("staffing_page_limit_invalid");
      const hasCreatedAt = text(afterCreatedAt).length > 0;
      const hasOperationId = text(afterOperationId).length > 0;
      if (hasCreatedAt !== hasOperationId || (hasCreatedAt && Number.isNaN(Date.parse(afterCreatedAt)))) {
        throw fail("staffing_page_cursor_invalid");
      }
      return transaction((client) => call(client, "static_weekly_v10_list_pending_staffing_commands", [
        actor.managerId,
        pageLimit,
        hasCreatedAt ? new Date(afterCreatedAt).toISOString() : null,
        hasOperationId ? requireUuid(afterOperationId, "staffing_page_cursor_invalid") : null,
      ]));
    },
    async getStaffingDeliveryStatus({ manager, operationId }) {
      const actor = requireManager(manager);
      return transaction((client) => call(client, "static_weekly_v10_read_staffing_delivery_status", [
        requireUuid(operationId, "staffing_operation_id_required"),
        actor.managerId,
      ]));
    },
    async acceptStaffingCommand({ manager, operationId, previewDigest, confirmationKey }) {
      const actor = requireManager(manager);
      const digest = text(previewDigest);
      if (!/^[0-9a-f]{64}$/.test(digest)) throw fail("staffing_preview_digest_required");
      return transaction((client) => call(client, "static_weekly_v11_accept_staffing_command", [
        requireUuid(operationId, "staffing_operation_id_required"),
        digest,
        requireUuid(confirmationKey, "staffing_confirmation_key_required"),
        actor.managerId,
      ]));
    },
    async cancelStaffingPreparation({ manager, operationId }) {
      const actor = requireManager(manager);
      return transaction((client) => call(client, "static_weekly_v10_cancel_staffing_preparation", [
        requireUuid(operationId, "staffing_operation_id_required"),
        actor.managerId,
      ]));
    },
    async getCoverAllPrintDocument({ manager, weekStart, serviceDate, expectedRevision, projectionId }) {
      requireManager(manager);
      const week=requireMonday(weekStart,"week start"),date=requireDateInWeek(serviceDate,week,"service date");
      const revision=requireRevision(expectedRevision);
      return transaction(async(client)=>{
        // Read all three immutable/current bindings in the same authority-lock
        // boundary as schedule changes. PDF rendering runs AFTER commit.
        await lockStaticWeeklyAuthority(client);
        const snapshot=await snapshotFor(client,week);
        const publicationId=requirePublicationId(snapshot?.current_publication?.publication_id);
        const source=await sourceFor(client,publicationId,date);
        const lunch=await call(client,"static_weekly_v8_read_lunch_document",[date]);
        return createCoverAllPrintDocument({snapshot,source,lunch,serviceDate:date,expectedRevision:revision,projectionId:text(projectionId)});
      });
    },
    async createReplacementDraft({ manager, sourcePublicationId, effectiveStart, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager); const date = requireDate(effectiveStart, "effective start");
      return transaction(async (client) => {
        const source = await sourceFor(client, sourcePublicationId, date);
        const draft = await prepareInsideTransaction(client, () => prepareDraft(
          replacementDraftInput(source, date),
          { expectedRevision: requireRevision(expectedRevision), actor: { ...actor, idempotencyKey: requireIdempotencyKey(idempotencyKey) } },
        ));
        return call(client, "static_weekly_v3_create_draft", [draft.effectiveStart, draft.objectiveVersion, draft.objective, draft.inputProvenance, draft.document, draft.expectedRevision, actor.managerId, draft.idempotencyKey, requireSourceId(source.source_id)]);
      });
    },
    async createInitialDraft({ manager, sourceId, effectiveStart, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager); const date = requireDate(effectiveStart, "effective start");
      return transaction(async (client) => {
        // The registered document records which stable positions may be
        // vacant.  The dated read hydrates current incumbencies and derives
        // which of those positions are still actually vacant before the
        // compiler creates a draft.  Without this boundary, a position filled
        // immediately before the first publication is misrepresented as
        // vacant even though the append-only roster ledger is authoritative.
        const source = await registeredSourceFor(client, sourceId, date);
        const draft = await prepareInsideTransaction(client, () => prepareDraft(
          replacementDraftInput(source, date),
          { expectedRevision: requireRevision(expectedRevision), actor: { ...actor, idempotencyKey: requireIdempotencyKey(idempotencyKey) } },
        ));
        return call(client, "static_weekly_v3_create_draft", [draft.effectiveStart, draft.objectiveVersion, draft.objective, draft.inputProvenance, draft.document, draft.expectedRevision, actor.managerId, draft.idempotencyKey, requireSourceId(source.source_id)]);
      });
    },
    async refreshInitialDraft({ manager, draftVersionId, sourceId, effectiveStart, expectedDraftRevision, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager); const date = requireDate(effectiveStart, "effective start");
      return transaction(async (client) => {
        const source = await registeredSourceFor(client, sourceId, date);
        const draft = await prepareInsideTransaction(client, () => prepareDraft(
          replacementDraftInput(source, date, { versionId: draftVersionId }),
          { expectedRevision: requireRevision(expectedRevision), actor: { ...actor, idempotencyKey: requireIdempotencyKey(idempotencyKey) } },
        ));
        return call(client, "static_weekly_v3_update_draft", [
          text(draftVersionId), draft.document, draft.objective, draft.inputProvenance,
          requireRevision(expectedDraftRevision), draft.expectedRevision, actor.managerId, draft.idempotencyKey,
        ]);
      });
    },
    async publishDraft({ manager, draftVersionId, expectedDraftRevision, expectedRevision, idempotencyKey, projectionWeekStart, publicationKind = "publish", rollbackOfVersionId = null }) {
      const actor = requireManager(manager); const requestedWeekStart = text(projectionWeekStart) ? requireMonday(projectionWeekStart, "projection week start") : null; const key = requireIdempotencyKey(idempotencyKey);
      return transaction((client) => mutateAndMaterializeCurrentProjection(client, {
        actor,
        weekStart: (mutation) => requireMonday(requestedWeekStart || mutation?.data?.effective_start, "projection week start"),
        idempotencyKey: key,
        publicationId: (mutation) => requirePublicationId(mutation?.data?.publication_id),
        mutate: () => call(client, "static_weekly_v3_publish_draft", [text(draftVersionId), requireRevision(expectedDraftRevision), requireRevision(expectedRevision), actor.managerId, key, text(publicationKind), rollbackOfVersionId || null]),
      }));
    },
    async applyException({ manager, exceptionType, serviceDate, startsAt = null, endsAt = null, baseVersionId, publicationId, reason, payload, expectedRevision, idempotencyKey, projectionWeekStart, reversesExceptionId = null }) {
      const actor = requireManager(manager); const weekStart = projectionWeekForDate(projectionWeekStart, serviceDate); const date = requireDateInWeek(serviceDate, weekStart, "service date"); const key = requireIdempotencyKey(idempotencyKey);
      return transaction((client) => mutateAndMaterializeCurrentProjection(client, {
        actor,
        publicationId: requirePublicationId(publicationId),
        weekStart,
        idempotencyKey: key,
        mutate: () => call(client, "static_weekly_v3_apply_exception", [text(exceptionType), date, startsAt || null, endsAt || null, text(baseVersionId), requirePublicationId(publicationId), text(reason), payload, requireRevision(expectedRevision), actor.managerId, key, reversesExceptionId || null]),
      }));
    },
    async applyContractorCapacity({ manager, serviceDate, baseVersionId, publicationId, slotId, shift, lunch, reason, expectedRevision, idempotencyKey, projectionWeekStart }) {
      requireManager(manager);
      const actualShift=requireWindow(shift,"actual contractor shift"),actualLunch=requireWindow(lunch,"actual contractor lunch");
      const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
      if(minutes(actualLunch.end)-minutes(actualLunch.start)!==60||actualLunch.start<actualShift.start||actualLunch.end>actualShift.end){
        throw fail("static_weekly_contractor_actual_lunch_required","Enter the actual one-hour CoverAll lunch within its shift; no lunch time is assumed.");
      }
      // Reuse the accepted complete-action receipt and one transaction for both
      // dated facts. A retry must bind lunch as well as capacity and shift.
      return this.applyDayChanges({manager,serviceDate,baseVersionId,publicationId,expectedRevision,idempotencyKey,projectionWeekStart,operations:[
        {operation:"cover_all",slotId,shift:actualShift,reason},
        {operation:"exception",exceptionType:"lunch",startsAt:actualLunch.start,endsAt:actualLunch.end,payload:{slotId},reason:"Manager recorded actual CoverAll lunch"},
      ]});
    },
    async applyDayChanges({ manager, serviceDate, baseVersionId, publicationId, versionId = null, operations, expectedRevision, idempotencyKey, projectionWeekStart }) {
      const actor = requireManager(manager);
      const weekStart = projectionWeekForDate(projectionWeekStart, serviceDate);
      const date = requireDateInWeek(serviceDate, weekStart, "service date");
      const key = requireIdempotencyKey(idempotencyKey);
      const effectivePublicationId = requirePublicationId(publicationId);
      const effectiveVersionId = text(versionId || baseVersionId);
      const requestedBaseVersionId = text(baseVersionId);
      const initialRevision = requireRevision(expectedRevision);
      const requestedOperations = requireDayChangeOperations(operations);
      if (!effectiveVersionId || !requestedBaseVersionId || (text(versionId) && requestedBaseVersionId !== effectiveVersionId)) {
        throw fail("static_weekly_control_plane_day_changes_version_required", "Day changes must name one published schedule version.");
      }
      return transaction(async (client) => {
        // Acquire the transaction lock in its own top-level statement so a
        // waiter begins the receipt-gate statement with a snapshot taken after
        // the winner commits. The gate reauthorizes the current manager and
        // reacquires the same lock defensively; it remains held through commit.
        await lockStaticWeeklyAuthority(client);
        const batch = await call(client, "static_weekly_v4_begin_day_changes", [date, weekStart, effectiveVersionId, effectivePublicationId, JSON.stringify(requestedOperations), initialRevision, actor.managerId, key]);
        if (batch?.replayed === true) return batch.response;
        // Resolve and validate every operation before invoking the first writer;
        // a malformed CoverAll entry therefore cannot leave a call-out prefix.
        const source = requireBatchPublicationSource(await sourceFor(client, effectivePublicationId, date), effectivePublicationId, effectiveVersionId);
        const commands = requestedOperations.map((operation, index) => operation.operation === "cover_all"
          ? { ...operation, payload: { availability: contractorAvailabilityFromSource(source, operation.slotId, date, operation.shift) }, idempotencyKey: dayChangeOperationIdempotencyKey(key, index) }
          : { ...operation, idempotencyKey: dayChangeOperationIdempotencyKey(key, index) });
        let revision = initialRevision;
        const mutations = [];
        for (const command of commands) {
          const mutation = await call(client, "static_weekly_v3_apply_exception", command.operation === "cover_all"
            ? ["cover_all", date, null, null, effectiveVersionId, effectivePublicationId, command.reason, command.payload, revision, actor.managerId, command.idempotencyKey, null]
            : [command.exceptionType, date, command.startsAt, command.endsAt, effectiveVersionId, effectivePublicationId, command.reason, command.payload, revision, actor.managerId, command.idempotencyKey, command.reversesExceptionId]);
          revision = requireRevision(mutation?.revision);
          mutations.push(mutation?.data);
        }
        const projection = await materializeCurrentProjection(client, {
          actor,
          publicationId: effectivePublicationId,
          weekStart,
          expectedRevision: revision,
          idempotencyKey: projectionIdempotencyKey(key),
        });
        return {
          ...projection,
          operation: "apply_day_changes",
          data: {
            ...projection.data,
            mutations,
          },
        };
      });
    },
    async markEmployeeDeparted({ manager, slotId, reason, expectedRevision, idempotencyKey, projectionWeekStart }) {
      const actor = requireManager(manager); const weekStart = requireMonday(projectionWeekStart, "projection week start"); const key = requireIdempotencyKey(idempotencyKey);
      return transaction((client) => mutateAndMaterializeCurrentProjection(client, {
        actor,
        weekStart,
        idempotencyKey: key,
        publicationId: async () => requirePublicationId((await snapshotFor(client, weekStart))?.current_publication?.publication_id),
        mutate: () => call(client, "static_weekly_v4_mark_employee_departed", [text(slotId), text(reason), requireRevision(expectedRevision), actor.managerId, key]),
      }));
    },
    async replaceEmployee({ manager, slotId, newEmployeeName, reason, expectedRevision, idempotencyKey, projectionWeekStart }) {
      const actor = requireManager(manager); const weekStart = requireMonday(projectionWeekStart, "projection week start"); const key = requireIdempotencyKey(idempotencyKey);
      return transaction((client) => mutateAndMaterializeCurrentProjection(client, {
        actor,
        weekStart,
        idempotencyKey: key,
        publicationId: async () => requirePublicationId((await snapshotFor(client, weekStart))?.current_publication?.publication_id),
        mutate: () => call(client, "static_weekly_v4_replace_employee", [text(slotId), text(newEmployeeName), text(reason), requireRevision(expectedRevision), actor.managerId, key]),
      }));
    },
    async restoreExistingEmployee({ manager, sourceId, slotId, employeeId, effectiveStart, reason, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager); const key = requireIdempotencyKey(idempotencyKey);
      const date = requireDate(effectiveStart, "restoration effective start"); const revision = requireRevision(expectedRevision);
      const source = requireSourceId(sourceId);
      return transaction((client) => completeRosterChange(client, {
        actor, weekStart: mondayForDate(date), idempotencyKey: key, expectedRevision: revision, operation: "restore_existing_employee",
        mutate: () => call(client, "static_weekly_v8_restore_existing_employee", [
          source, text(slotId), text(employeeId), date, text(reason), revision, actor.managerId, key,
        ]),
      }));
    },
    async vacateRosterSlot({ manager, sourceId, slotId, employeeId, effectiveStart, reason, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager); const key = requireIdempotencyKey(idempotencyKey);
      const date = requireDate(effectiveStart, "vacancy effective start");
      const weekStart = mondayForDate(date, "vacancy effective start");
      return transaction(async (client) => {
        await client.query("select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))", ["memphis-static-weekly-authority"]);
        const current = await snapshotFor(client, weekStart);
        const priorRevision = requireRevision(current?.authority_revision);
        const mutate = () => call(client, "static_weekly_v8_vacate_roster_slot", [
          text(sourceId), text(slotId), text(employeeId), date, text(reason),
          requireRevision(expectedRevision), actor.managerId, key,
        ]);
        const mutation = await mutate(); // Validates the complete original request on retries, too.
        // The lock-held revision BEFORE the writer distinguishes a new mutation
        // from a replay. A committed command has already advanced authority;
        // it must have its ORIGINAL completion, never manufacture a new one.
        if (priorRevision !== requireRevision(expectedRevision) || mutation?.data?.completion_mode === "mutation_only") {
          const completed = await call(client, "static_weekly_v8_read_completed_vacancy", [actor.managerId, key]);
          if (!completed) throw fail("static_weekly_vacancy_completion_missing", "The original vacancy completion is missing; no new schedule change was accepted.");
          return completed;
        }
        if (mutation?.data?.completion_mode !== "projection_required"
          || text(mutation.data.original_publication_id) !== text(current?.current_publication?.publication_id)) {
          throw fail("static_weekly_vacancy_completion_mismatch", "The vacancy does not bind the original published schedule.");
        }
        return mutateAndMaterializeCurrentProjection(client, {
          actor, weekStart, idempotencyKey: key,
          publicationId: requirePublicationId(current.current_publication.publication_id), mutate: async () => mutation,
        });
      });
    },
    async createVacantRosterSlot({ manager, slotId, slotLabel, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager); const key = requireIdempotencyKey(idempotencyKey);
      return transaction((client) => call(client, "static_weekly_v7_create_vacant_roster_slot", [
        text(slotId), text(slotLabel), requireRevision(expectedRevision), actor.managerId, key,
      ]));
    },
    async fillVacantRosterSlot({ manager, sourceId, slotId, newEmployeeName, effectiveStart, reason, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager); const key = requireIdempotencyKey(idempotencyKey);
      const date = requireMonday(effectiveStart, "vacancy effective start"); const revision = requireRevision(expectedRevision);
      const source = requireSourceId(sourceId);
      return transaction((client) => completeRosterChange(client, {
        actor, weekStart: date, idempotencyKey: key, expectedRevision: revision, operation: "fill_vacant_slot",
        mutate: () => call(client, "static_weekly_v9_fill_vacant_roster_slot", [
          source, text(slotId), text(newEmployeeName), date, text(reason), revision, actor.managerId, key,
        ]),
      }));
    },
    async materializeProjection({ manager, publicationId, serviceDate, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager); const weekStart = requireMonday(serviceDate, "projection start"); const effectivePublicationId = requirePublicationId(publicationId); const revision = requireRevision(expectedRevision); const key = requireIdempotencyKey(idempotencyKey);
      return transaction(async (client) => {
        await client.query("select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))", ["memphis-static-weekly-authority"]);
        const current = await snapshotFor(client, weekStart);
        if (current?.projection_status === "current" && text(current?.current_publication?.publication_id) === effectivePublicationId && text(current?.latest_projection?.week_start) === weekStart) {
          // The legacy split caller may replay the atomic publication, but a
          // current base projection alone cannot prove its lunch companion.
          // Keep the authority lock across both reads; missing companions must
          // use the explicit rebuild path, never report a successful no-op.
          const lunch = await call(client, "static_weekly_v8_read_lunch_document", [weekStart]);
          if (lunch?.persistence_status !== "PERSISTED"
            || text(lunch.projection_id) !== text(current.latest_projection.projection_id)
            || !/^[0-9a-f]{64}$/.test(text(lunch.document_identity))) {
            throw fail("static_weekly_lunch_publication_missing", "Current lunch responsibilities are unavailable; rebuild the weekly projection.");
          }
          return {
            operation: "materialize_projection",
            revision: current.authority_revision,
            replayed: true,
            data: {
              ...current.latest_projection,
              current_projection: current.latest_projection,
              no_op: true,
            },
          };
        }
        return materializeCurrentProjection(client, { actor, publicationId: effectivePublicationId, weekStart, expectedRevision: revision, idempotencyKey: key });
      });
    },
    async rebuildCurrentProjection({ manager, weekStart, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager); const projectionWeekStart = requireMonday(weekStart, "projection week start"); const key = requireIdempotencyKey(idempotencyKey);
      return transaction(async (client) => {
        const snapshot = await snapshotFor(client, projectionWeekStart);
        return materializeCurrentProjection(client, {
          actor,
          publicationId: requirePublicationId(snapshot?.current_publication?.publication_id),
          weekStart: projectionWeekStart,
          expectedRevision: requireRevision(expectedRevision),
          idempotencyKey: projectionIdempotencyKey(key),
        });
      });
    },
    async close() {
      if (closePromise) return closePromise;
      closing = true;
      const cause = fail("static_weekly_control_plane_closing", "The scheduler closed before this queued operation opened a database transaction.");
      while (transactionQueue.length) {
        const record = transactionQueue.shift();
        clearTimeout(record.timer);
        record.reject(cause);
      }
      closePromise = (async () => {
        await shutdownCompiler();
        await Promise.allSettled([
          ...activeTransactionPromises,
          ...(activeHealthCheck ? [activeHealthCheck] : []),
        ]);
        if (typeof database.end === "function") await database.end();
      })();
      return closePromise;
    },
  };
}
