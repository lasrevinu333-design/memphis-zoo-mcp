import {coverAllAccessTokenHash,coverAllCanonicalBinding,scopeCanonicalCoverAllDocument} from './static-weekly-coverall-access.js';
import { AsyncLocalStorage } from "node:async_hooks";
import { types } from "node:util";
import { hasManagerPermission } from "./auth/manager-permissions.js";
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
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { MANAGER_OPERATION_MILLISECONDS, CLEANUP_RESERVE_MILLISECONDS } from "./static-weekly-manager-operation.js";
import { assertOwnerRecurringWorkdays } from "./static-weekly-owner-workdays.js";
import { createCoverAllPrintDocument } from "./static-weekly-coverall-print.js";
import {listCoverAllEventBriefPreviews,confirmCoverAllEventBrief,revalidateConfirmedCoverAllEventBrief} from './coverall-event-brief.js';
import { Pool } from "pg";
import { createStaticWeeklyDraftRpcInput } from "./static-weekly-schedule-database-adapter.js";
import { createStaticWeeklyProjectionWithLunchRpcInput } from "./static-weekly-lunch-publication.js";
import { createStaffingCommandRequest } from "./static-weekly-staffing-command.js";
import { createStaffingCandidateSet } from "./static-weekly-staffing-candidates.js";
import { createStaffingPreparationMeter, enumerateStaffingServiceWindow } from "./static-weekly-staffing-preparation.js";
import { createStaffingWeekPreviewInput } from "./static-weekly-staffing-preview.js";
import { createVacancyManagerPreview } from "./static-weekly-vacancy-preview.js";
import { assertRecurringManagerDecision, assertRecurringAdmissionCandidate } from "./static-weekly-recurring-preview.js";
import { assertRecurringWeekCommitment } from "./static-weekly-recurring-week-commitment.js";
import {createRecurringCorrectionBinding,recurringCorrectionWitness,
  requireMatchingRecurringCorrectionWitness} from './static-weekly-recurring-correction-binding.js';
import {OPENING_COVERAGE_ERROR,sanitizeOpeningCoverageDiagnostic,assertOpeningCoverageReport} from './static-weekly-opening-coverage-report.js';
import { recurringPatternAuthority, assertRecurringRepairCandidate } from "./static-weekly-recurring-repair-basis.js";
import { withRecurringDependencyStatus } from "./static-weekly-recurring-dependency-result.js";
import { placePublicationInput, placePublicationSummary } from "./place-operational-adapter.js";
import {capacitySourceBasisSummary,capacitySourcePublicationInput,capacitySourcePreviewSummary} from "./static-weekly-contractor-source-bridge.js";
import {createContractorCapacityTransitionCandidate} from "./static-weekly-contractor-source-transition.js";
import { canonicalJson } from "./static-weekly-schedule-model.js";
import { postgresJsonbContentDigest } from "./static-weekly-schedule-compiler.js";
import {prepareApprovedStaticTemplateProjection} from './static-weekly-recurring-staffing-adaptation.js';
import {prepareStaticWeeklySchedulingProblem} from './static-weekly-schedule-program.js';
import {readApprovedManualWeek} from './approved-manual-week.js';
import {staffingWindowFromOwnerFrames,approvedManualStaffingWorkerInput,approvedManualPendingStaffingTransport} from './approved-manual-staffing-transport.js';
import {
  compileAndPrepareStaticWeeklyScheduleIsolated,
  compileStaticWeeklyScheduleIsolated,
  prepareRecurringCandidateIsolated,
  prepareRecurringAdmissionCandidateIsolated,
  getStaticWeeklyCompilerReadiness,
  initializeStaticWeeklyCompiler,
  shutdownStaticWeeklyCompiler,
  prepareApprovedManualPeriodIsolated,
  STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS,
} from "./static-weekly-schedule-compiler-runtime.js";

export const STATIC_WEEKLY_CONTROL_PLANE_SCHEMA = "memphis-zoo.static-weekly-control-plane.v1";
export const STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS = 60_000;
export const STATIC_WEEKLY_MANAGER_OPERATION_DEADLINE_MS = MANAGER_OPERATION_MILLISECONDS;
export const STATIC_WEEKLY_MANAGER_CLEANUP_RESERVE_MS = CLEANUP_RESERVE_MILLISECONDS;
const STATIC_WEEKLY_AUTHORITY_LOCK_IDENTITY = "memphis-static-weekly-authority";
const APPROVED_FULL_NINE_IDENTITY = JSON.parse(readFileSync(new URL(
  "../config/custodial-full-nine-family-owners-20260926.json", import.meta.url)));
const APPROVED_FULL_NINE_SOURCE_ID = APPROVED_FULL_NINE_IDENTITY.baseSourceId;

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

function requireManager(manager, options = {}) {
  const readOnlyOperation = options?.readOnlyOperation === true;
  const delegated = typeof options === "string" ? options : null;
  const managerId = text(manager?.manager_id || manager?.managerId);
  if (!managerId || !text(manager?.manager_display_name || manager?.managerName) || (!readOnlyOperation && (delegated ? !hasManagerPermission(manager, delegated) : manager?.read_only)) || manager?.auth_mode === "operations_first" || manager?.auth_mode === "admin_api_key") {
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

// Dated absence authority is delegated, unlike roster/recurring-plan authority.
// On resumed operations the kind must come from the protected original ledger.
function requireStaffingManager(manager, commandKind) {
  if (manager?.read_only !== true) return requireManager(manager);
  const actor = requireManager(manager, "manage_absences");
  if (!["absence", "cancel_absence"].includes(commandKind))
    throw fail("static_weekly_named_manager_required", "This staffing command requires owner authority.");
  return actor;
}
function requireOriginalStaffingManager(manager, command) {
  const actor = requireStaffingManager(manager, command?.semantic_body?.commandKind);
  if (manager?.read_only === true && command?.prepared_by_manager_id !== actor.managerId)
    throw fail("staffing_original_preparer_required", "Resume only this manager's original staffing operation.");
  return actor;
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

function seasonWorkFromAssignments(assignments) {
  if (!Array.isArray(assignments) || assignments.length > 10000) throw fail("static_weekly_sch022_work_unavailable");
  return assignments.map((row) => {
    const work = row?.workSnapshot;
    if (!work || typeof work !== "object" || !Array.isArray(work.includedLocations)
      || !text(work.locationCodeSnapshot) || work.includedLocations.length > 256) {
      throw fail("static_weekly_sch022_work_unavailable", "The exact scheduled work identities are unavailable for seasonal admission.");
    }
    return { locationId: work.locationId || null, locationCode: work.locationCodeSnapshot,
      includedLocationIds: work.includedLocations.map((location) => location?.locationId) };
  });
}

function requireSeasonWitness(value) {
  if (!/^[a-f0-9]{64}$/.test(text(value))) throw fail("static_weekly_sch022_witness_unavailable");
  return value;
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
      const breakChoice = entry.breakChoice ?? entry.break_choice;
      if (breakChoice != null && breakChoice !== 'NONE') throw fail('static_weekly_contractor_break_choice_invalid');
      return { operation: "cover_all", slotId, shift: entry.shift == null ? null : requireWindow(entry.shift, "contractor shift"), reason, ...(breakChoice === 'NONE' ? { breakChoice } : {}) };
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

function contractorAvailabilityFromSource(source, slotId, serviceDate, requestedShift, breakChoice = null) {
  const raw = source?.compiler_input;
  const id = text(slotId);
  const slot = Array.isArray(raw?.slots) ? raw.slots.find((entry) => text(entry?.id) === id && entry?.contractorCapacity === true) : null;
  const weekday = new Date(`${requireDate(serviceDate, "service date")}T00:00:00Z`).getUTCDay();
  const template = Array.isArray(slot?.contractorAvailability) ? slot.contractorAvailability.find((entry) => entry?.dayOfWeek === weekday) : null;
  if (!slot || !template) throw fail("static_weekly_control_plane_contractor_slot_required", "The selected slot is not registered contractor capacity for this service day.");
  if (breakChoice === 'NONE' && slot.kind !== 'CONTRACTOR_CAPACITY') throw fail('static_weekly_contractor_no_break_typed_capacity_required');
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
    ...(breakChoice === 'NONE' ? { breakChoice } : {}),
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
  maxConnections = 4,
} = {}) {
  if (pool) return pool;
  if (!Number.isSafeInteger(maxConnections) || maxConnections < 1 || maxConnections > 4) {
    throw fail("static_weekly_control_plane_database_pool_invalid");
  }
  const database = new Pool({
    ...staticWeeklyDatabaseConnectionOptions({ connectionString, caPem, allowInsecureLoopbackRehearsal }),
    max: maxConnections,
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
  recurringCandidatePreparer = prepareRecurringCandidateIsolated,
  recurringAdmissionPreparer = prepareRecurringAdmissionCandidateIsolated,
  initializeSolver = initializeStaticWeeklyCompiler,
  getSolverReadiness = getStaticWeeklyCompilerReadiness,
  shutdownCompiler = compiler === compileStaticWeeklyScheduleIsolated ? shutdownStaticWeeklyCompiler : async () => {},
  transactionKeepaliveMs = 4_000,
  transactionConcurrency = 3,
  maxQueuedTransactions = 16,
  transactionAdmissionMilliseconds = STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS.requestMilliseconds,
  operationStatementMilliseconds = STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS,
  healthTransactionMilliseconds = 5_000,
  recurringCorrectionSourceBinding = null,
} = {}) {
  if (!database?.connect) throw fail("static_weekly_control_plane_database_required");
  const correctionBinding = createRecurringCorrectionBinding(recurringCorrectionSourceBinding);
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
  if (!Number.isSafeInteger(operationStatementMilliseconds) || operationStatementMilliseconds < 30_000 || operationStatementMilliseconds > STATIC_WEEKLY_MANAGER_OPERATION_DEADLINE_MS) {
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

  async function runExternalRecurringOperation({ signal = null, deadlineAt, action }) {
    if (typeof action !== "function" || !Number.isFinite(deadlineAt)) throw fail("static_weekly_recurring_operation_deadline_invalid");
    operationRemaining(deadlineAt, signal);
    let grant, release;
    const granted = new Promise((resolve) => { grant = resolve; });
    const held = new Promise((resolve) => { release = resolve; });
    // This is the SAME three-active/sixteen-queued admission used by every
    // ordinary authority transaction. A detached child does not gain a
    // second, parallel concurrency budget or borrow the health slot.
    const admitted = admitTransaction(async () => { grant(); await held; }, signal);
    admitted.catch(() => {});
    await Promise.race([granted, admitted.then(
      () => { throw fail("static_weekly_control_plane_closing"); },
      (error) => { throw error; })]);
    let safeToRelease = true;
    try {
      operationRemaining(deadlineAt, signal);
      return await action();
    } catch (error) {
      if (error?.code === "static_weekly_recurring_operation_custody_unknown") safeToRelease = false;
      throw error;
    } finally {
      if (safeToRelease) { release(); await admitted; }
      // On unproved process-group custody the slot and exact restore lease
      // remain held. The existing expired-row reconciliation controls recovery.
    }
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
    const placeholders = values.map((_, index) => `$${index+1}`).join(",");
    const { rows } = await client.query(`select public.${functionName}(${placeholders}) as result`, values);
    return rows[0]?.result;
  }

  async function authorizeAbsenceOperations(client, manager, serviceDate, publicationId, operations) {
    return call(client,"custodial_authorize_absence_operations_v1",[
      manager.manager_id,manager.credential_id,manager.device_id,manager.access_level,
      serviceDate,publicationId,JSON.stringify(operations)]);
  }
  async function authorizeRouteRegeneration(client,manager,weekStart,publicationId) {
    return call(client,"custodial_authorize_route_regeneration_v1",[
      manager.manager_id,manager.credential_id,manager.device_id,manager.access_level,weekStart,publicationId]);
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

  async function acceptedCoverAllDocument(client,{manager,weekStart,serviceDate,expectedRevision,projectionId}){
    const issuingManager=requireManager(manager,"manage_coverall");
    const verifiedActor=await call(client,"custodial_action_actor_v1",[
      manager.manager_id,manager.credential_id,manager.device_id,manager.access_level,"manage_coverall"]);
    if(verifiedActor?.manager_id!==manager.manager_id)throw fail("42501","Current CoverAll manager identity is required.");
    return readAcceptedCoverAllDocument(client,{weekStart,serviceDate,expectedRevision,projectionId,issuingManager});
  }
  async function readAcceptedCoverAllDocument(client,{weekStart,serviceDate,expectedRevision,projectionId,issuingManager}){
    const week=requireMonday(weekStart,'week start'),date=requireDateInWeek(serviceDate,week,'service date');
    const revision=requireRevision(expectedRevision);
    await lockStaticWeeklyAuthority(client);
    const snapshot=await snapshotFor(client,week);
    const source=await sourceFor(client,requirePublicationId(snapshot?.current_publication?.publication_id),date);
    const lunch=await call(client,'static_weekly_v8_read_lunch_document',[date]);
    return createCoverAllPrintDocument({snapshot,source,lunch,serviceDate:date,expectedRevision:revision,projectionId:text(projectionId),issuingManager});
  }
  function coverAllWithBriefs(document,briefs){
    if(!briefs.length)return document;
    const {documentDigest,...base}=document;
    const next={...base,baseDocumentDigest:documentDigest,eventBriefs:briefs};
    return {...next,documentDigest:createHash('sha256').update(canonicalJson(next)).digest('hex')};
  }
  function coverAllSelections(value){
    if(!Array.isArray(value)||value.length>16)throw fail('coverall_event_selection_limit');
    const seen=new Set();
    for(const item of value){
      const keys=['event_id','event_revision','capacity_slot_id','preview','confirmation'];
      if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).length!==keys.length||keys.some(key=>!Object.hasOwn(item,key)))throw fail('coverall_event_selection_invalid');
      const key=String(item.capacity_slot_id)+'|'+String(item.event_id);
      if(seen.has(key))throw fail('coverall_event_selection_duplicate');seen.add(key);
    }
    return value;
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
        requireDate(request.effectiveStart,'original approved initial window');
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
    const actor=requireManager(manager),id=requireSourceId(sourceId),date=requireDate(effectiveStart,'effective start'),
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
      if(new Date(date+'T12:00:00Z').getUTCDay()!==1
        &&source.version?.manualGroupRatingAuthority?.manifestSha256!=='fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f')
        throw fail('static_weekly_control_plane_projection_week_required');
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
      const compactEnvelope={...body,schema:'custodial.approved-static-initial-materialization.compact.v1',
        feasibilityDigest:feasibility.digest,previewDigest:digest,request};
      delete compactEnvelope.feasibility;
      const accepted=await call(client,'static_weekly_materialize_approved_initial_baseline',
        [actor.managerId,id,date,revision,basis.generation,request.idempotencyKey,compactEnvelope]);
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

  async function recurringGenerationFor(client) {
    const raw = await call(client, "static_weekly_v15_read_recurring_generation", []);
    if (!(typeof raw === "number" || (typeof raw === "string" && /^(0|[1-9][0-9]*)$/.test(raw)))
      || !Number.isSafeInteger(Number(raw)) || Number(raw) < 0) {
      throw fail("static_weekly_recurring_generation_invalid", "The recurring roster generation is unavailable.");
    }
    return Number(raw);
  }

  async function registeredSourceFor(client, sourceId, effectiveStart) {
    return call(client, "static_weekly_v3_read_authority_source", [
      requireSourceId(sourceId),
      requireMonday(effectiveStart, "effective start"),
    ]);
  }

  function approvedRecurringFullSource(sourceId) {
    const value = text(sourceId);
    if (value && value !== APPROVED_FULL_NINE_SOURCE_ID) {
      throw fail("static_weekly_recurring_full_source_not_approved",
        "The nine-position template must be the exact approved registered source.");
    }
    return value || null;
  }

  async function recurringBasisFor(client, { actor, date, revision, fullNineSourceId }) {
    await lockStaticWeeklyAuthority(client);
    const recurringGeneration = await recurringGenerationFor(client);
    const snapshot = await snapshotFor(client, date);
    if (requireRevision(snapshot?.authority_revision) !== revision) {
      throw fail("static_weekly_recurring_preview_revision_changed", "The manager roster changed before preview.");
    }
    const publicationId = requirePublicationId(snapshot?.current_publication?.publication_id);
    const source = await call(client, "static_weekly_v20_read_recurring_preview_basis", [actor.managerId, date]);
    const patternAuthority = recurringPatternAuthority({ publishedSource: source, managerSnapshot: snapshot,
      effectiveDate: date, expectedRevision: revision });
    if (patternAuthority.publicationId !== publicationId) {
      throw fail("static_weekly_recurring_preview_revision_changed", "The recurring repair winner changed.");
    }
    // The historical split publication needs its exact registered base even
    // when the manager is reducing current positions and did not supply an
    // internal source ID. Fetch only the pinned source, under this authority
    // lock. Keep the request's explicit ID separate for replay/preview binding.
    const sourceRows = source?.compiler_input?.version?.assignments;
    const registeredFullNineSourceId = fullNineSourceId
      || (Array.isArray(sourceRows) && sourceRows.length === 313 ? APPROVED_FULL_NINE_SOURCE_ID : null);
    const fullNineSource = registeredFullNineSourceId
      ? await registeredSourceFor(client, registeredFullNineSourceId, date) : null;
    if (registeredFullNineSourceId && fullNineSource?.source_id !== registeredFullNineSourceId) {
      throw fail("static_weekly_recurring_full_source_not_approved",
        "The exact registered nine-position source is unavailable or changed.");
    }
    // The correction is a different registered CURRENT source only for a
    // reduction. The exact historical nine-position static template remains
    // usable without depending on that separately registered correction.
    let needsCorrection=false;
    if(correctionBinding&&Array.isArray(sourceRows)&&sourceRows.length===313){
      const ordinary=source.compiler_input.slots?.filter(s=>s.contractorCapacity!==true&&!s.kind);
      if(!Array.isArray(ordinary)||ordinary.length!==9)throw fail('static_weekly_recurring_correction_roster_invalid');
      let staffed=0;
      for(const slot of ordinary){
        const matches=snapshot.roster?.filter(r=>r.slot_id===slot.id);
        if(matches?.length!==1||matches[0].contractor_capacity===true)
          throw fail('static_weekly_recurring_correction_roster_invalid');
        const active=(matches[0].incumbencies||[]).filter(p=>p.effective_start<=date&&(!p.effective_end||date<p.effective_end));
        if(active.length>1)throw fail('static_weekly_recurring_correction_roster_invalid');
        staffed+=active.length;
      }
      needsCorrection=staffed<9;
    }
    const correctionSource = needsCorrection
      ? await registeredSourceFor(client, correctionBinding.sourceId, date) : null;
    if(correctionSource&&correctionSource.source_id===fullNineSource?.source_id)
      throw fail('static_weekly_recurring_correction_source_not_distinct');
    const correctionWitness = correctionSource ? recurringCorrectionWitness({binding:correctionBinding,
      snapshot,patternSource:source,correctionSource,effectiveWeek:date,expectedRevision:revision,
      recurringGeneration,effectivePublicationId:publicationId}) : null;
    return { snapshot, source, fullNineSource, correctionSource, correctionWitness,
      requestedFullNineSourceId: fullNineSourceId || null,
      recurringGeneration, patternAuthority };
  }

  function recurringPreparationInput(basis, date, revision) {
    return { publishedSource: basis.source, managerSnapshot: basis.snapshot,
      fullNineSource: basis.fullNineSource, correctionSource:basis.correctionSource,
      correctionWitness:basis.correctionWitness,effectiveDate: date, expectedRevision: revision };
  }

  function validateRecurringCandidate(candidate, basis, revision) {
    if (candidate?.status !== "CANDIDATE_ONLY" || candidate?.compilerStatus !== "FEASIBLE"
      || candidate?.publicationAuthority !== "ACCEPTABLE" || candidate?.verifierOk !== true
      || candidate?.reviewWorkCount !== 0 || candidate?.sourceId !== basis.source.source_id
      || candidate?.publicationId !== basis.patternAuthority.publicationId || candidate?.authorityRevision !== revision) {
      throw fail("static_weekly_recurring_preview_rejected", "The isolated recurring preview was not bound to the exact source and revision.");
    }
    const digest64 = value => /^[a-f0-9]{64}$/.test(text(value));
    if (candidate.publishedSourceDigest !== postgresJsonbContentDigest(basis.source.compiler_input)
      || candidate.managerSnapshotDigest !== postgresJsonbContentDigest(basis.snapshot)
      || candidate.fullNineSourceDigest !== (basis.fullNineSource ? postgresJsonbContentDigest(basis.fullNineSource.compiler_input) : null)
      || (basis.correctionSource
        ?candidate.correctionSourceDigest !== postgresJsonbContentDigest(basis.correctionSource.compiler_input)
        :candidate.correctionSourceDigest!=null)
      || (basis.correctionWitness
        ?candidate.correctionWitnessDigest!==basis.correctionWitness.digest
        :candidate.correctionWitnessDigest!=null)
      || ![candidate.candidateSourceDigest, candidate.readbackPatternDigest, candidate.modelBasisDigest,
        candidate.assignmentWitnessDigest, candidate.finalWitnessDigest, candidate.weeklyAssignmentsDigest,
        candidate.metricsDigest, candidate.lunchFactsDigest, candidate.openWorkDigest, candidate.shiftEndDerivationDigest].every(digest64)
      || !Number.isSafeInteger(candidate.lunchLoanCount) || candidate.lunchLoanCount < 0
      || !Number.isSafeInteger(candidate.openWorkCount) || candidate.openWorkCount < 0) {
      throw fail("static_weekly_recurring_preview_rejected",
        "The isolated recurring preview was not bound to the exact authority inputs and verified decision.");
    }
    try {
      assertRecurringManagerDecision(candidate);
      assertRecurringRepairCandidate(candidate, basis.patternAuthority);
      if (candidate.weekOptimizationScope === "HISTORICAL_FULL_NINE_STATIC_TEMPLATE_ONLY"
        && (basis.requestedFullNineSourceId !== APPROVED_FULL_NINE_SOURCE_ID
          || basis.fullNineSource?.source_id !== APPROVED_FULL_NINE_SOURCE_ID)) {
        throw new Error("Exact approved registered full-nine source required.");
      }
      if (candidate.weekOptimizationScope === "HISTORICAL_FULL_NINE_STATIC_TEMPLATE_ONLY"
        && (candidate.staticTemplateCommitment?.approvedBasePacketDigest !== APPROVED_FULL_NINE_IDENTITY.basePacketSha256
          || candidate.staticTemplateCommitment?.approvedFullConfigDigest !== APPROVED_FULL_NINE_IDENTITY.fullConfigSha256)) {
        throw new Error("Exact approved historical template identities required.");
      }
      assertRecurringWeekCommitment(candidate, basis, revision);
    } catch (error) {
      if(error?.code===OPENING_COVERAGE_ERROR&&sanitizeOpeningCoverageDiagnostic(error.openingCoverageDiagnostic))throw error;
      throw fail("static_weekly_recurring_preview_rejected",
        `The complete manager decision does not match its verified compiler result: ${error.message}`);
    }
  }

  function recurringPreviewDigest(actor, basis, candidate) {
    return createHash("sha256").update(canonicalJson({
      managerId: actor.managerId, recurringGeneration: basis.recurringGeneration,
      requestedFullNineSourceId: basis.requestedFullNineSourceId,
      ...(basis.correctionWitness?{correctionWitnessDigest:basis.correctionWitness.digest}:{}),
      splashSeasonWitness: requireSeasonWitness(basis.splashSeasonWitness), candidate,
    })).digest("hex");
  }

  async function compileOrFail(input, options = {}) {
    const result = await compiler(input, options);
    if (result?.status !== "FEASIBLE" || result?.publicationAuthority !== "ACCEPTABLE" || result?.verifier?.ok !== true) {
      throw fail("static_weekly_control_plane_compiler_rejected", "Canonical source did not produce a publishable verified schedule.");
    }
    return result;
  }

  async function prepareDraft(input, { expectedRevision, actor, signal = null, deadlineAt = null }) {
    assertOwnerRecurringWorkdays(input);
    if (compilerPreparer) {
      return compilerPreparer(input, { kind: "draft", expectedRevision, actor },
        deadlineAt == null ? {} : { signal, deadlineMilliseconds: operationRemaining(deadlineAt, signal) });
    }
    return createStaticWeeklyDraftRpcInput({ result: await compileOrFail(input,
      deadlineAt == null ? {} : { signal, deadlineMilliseconds: operationRemaining(deadlineAt, signal) }), expectedRevision, actor });
  }

  async function prepareProjection(input, { publicationId, expectedRevision, actor, deadlineMilliseconds = null,
    signal = null, deadlineAt = null }) {
    assertOwnerRecurringWorkdays(input);
    if (compilerPreparer) {
      return compilerPreparer(input, { kind: "projection", publicationId, expectedRevision, actor },
        deadlineAt == null ? deadlineMilliseconds == null ? {} : { deadlineMilliseconds }
          : { signal, deadlineMilliseconds: operationRemaining(deadlineAt, signal) });
    }
    return createStaticWeeklyProjectionWithLunchRpcInput({ result: await compileOrFail(input,
      deadlineAt == null ? {} : { signal, deadlineMilliseconds: operationRemaining(deadlineAt, signal) }), publicationId, expectedRevision, actor });
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

  async function materializeCurrentProjection(client, { actor, publicationId, weekStart, expectedRevision, idempotencyKey,
    signal = null, deadlineAt = null, preparedProjection = null }) {
    const source = await sourceFor(client, requirePublicationId(publicationId), weekStart);
    const effectivePublicationId = requirePublicationId(publicationId);
    const revision = requireRevision(expectedRevision);
    const preparedActor = { ...actor, idempotencyKey: requireIdempotencyKey(idempotencyKey) };
    const projection = preparedProjection || await prepareInsideTransaction(client, () => prepareProjection(
      compilerInputFromPublishedSource(source, weekStart),
      { publicationId: effectivePublicationId, expectedRevision: revision, actor: preparedActor, signal, deadlineAt },
    ));
    if (preparedProjection && (projection.publicationId !== effectivePublicationId || projection.serviceDate !== weekStart
      || projection.expectedRevision !== revision || projection.actorManagerId !== actor.managerId
      || projection.idempotencyKey !== preparedActor.idempotencyKey)) {
      throw fail("static_weekly_prepared_projection_binding_changed");
    }
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

  async function prepareVacancyOnCurrentTransaction(client, input, confirmDigest = null) {
    const actor = requireManager(input.manager), sourceId = requireSourceId(input.sourceId);
    const slotId = requireUuid(input.slotId, "static_weekly_vacancy_slot_required");
    const employeeId = requireUuid(input.employeeId, "static_weekly_vacancy_employee_required");
    const date = requireDate(input.effectiveStart, "vacancy effective start");
    const weekStart = mondayForDate(date, "vacancy effective start");
    const revision = requireRevision(input.expectedRevision), key = requireIdempotencyKey(input.idempotencyKey);
    const reason = text(input.reason);
    const requestedSignal = input.signal ?? null, requestedDeadlineAt = input.deadlineAt ?? null;
    if (!reason || reason.length > 2000) throw fail("static_weekly_vacancy_reason_required");
    const manager = managerRequest.getStore()?.manager ?? input.manager;
    if (requireManager(manager).managerId !== actor.managerId) throw fail("static_weekly_named_manager_required");
    const credentialId = requireUuid(manager.credential_id, "static_weekly_vacancy_credential_required");
    const deviceId = text(manager.device_id), access = text(manager.access_level);
    if (!deviceId || access !== "full_access") throw fail("static_weekly_named_manager_required");
    const auth = [actor.managerId, credentialId, deviceId, access, key];
    await lockStaticWeeklyAuthority(client);
    const before = await snapshotFor(client, weekStart);
    if (requireRevision(before?.authority_revision) !== revision || before?.current_service_date !== date) {
      throw fail("static_weekly_vacancy_preview_currentness_changed");
    }
    const publicationId = requirePublicationId(before?.current_publication?.publication_id);
    const currentSource = await registeredSourceFor(client, sourceId, weekStart);
    const originalSource = await call(client, "static_weekly_v3_read_authority_source", [sourceId]);
    if (currentSource?.source_id !== sourceId || originalSource?.source_id !== sourceId
      || !currentSource.compiler_input || !originalSource.compiler_input) {
      throw fail("static_weekly_vacancy_source_unavailable");
    }
    const binding = { managerId: actor.managerId, sourceId, slotId, employeeId,
      effectiveStart: date, weekStart, expectedRevision: revision, idempotencyKey: key,
      reasonDigest: createHash("sha256").update(reason, "utf8").digest("hex"),
      registeredSourceDigest: postgresJsonbContentDigest(originalSource.compiler_input),
      currentSourceDigest: postgresJsonbContentDigest(currentSource.compiler_input), publicationId };
    const preInput = compilerInputFromPublishedSource(await sourceFor(client, publicationId, weekStart), weekStart);
    const mutate = async () => {
      const mutation = await call(client, "static_weekly_v8_vacate_roster_slot", [
        sourceId, slotId, employeeId, date, reason, revision, actor.managerId, key,
      ]);
      if (mutation?.revision !== revision + 1 || mutation?.data?.completion_mode !== "projection_required"
        || mutation.data.original_publication_id !== publicationId) {
        throw fail("static_weekly_vacancy_original_status_required",
          "Read this request's original outcome; do not resend it.");
      }
      return mutation;
    };
    let retained = await call(client, "static_weekly_read_vacancy_reviewed_preparation", auth);
    let stagedPacketUtf8 = null;
    if (retained?.found === false && Object.keys(retained).length === 1 && confirmDigest === null) {
      // The generation/actor/authority locks were acquired BEFORE this
      // savepoint. Roll back the hypothetical vacancy, not those outer fences.
      await client.query("savepoint vacancy_reviewed_preparation");
      await mutate();
      const postInput = compilerInputFromPublishedSource(await sourceFor(client, publicationId, weekStart), weekStart);
      const requestContext = managerRequest.getStore();
      const signal = requestedSignal ?? requestContext?.signal ?? null;
      const deadlineAt = requestedDeadlineAt == null ? requestContext?.deadlineAt ?? null
        : requestContext?.deadlineAt == null ? requestedDeadlineAt : Math.min(requestedDeadlineAt, requestContext.deadlineAt);
      const projection = await prepareInsideTransaction(client, () => prepareProjection(postInput,
        { publicationId, expectedRevision: revision + 1, actor: { ...actor, idempotencyKey: projectionIdempotencyKey(key) },
          signal, deadlineAt }));
      const preview = createVacancyManagerPreview({ ...binding, projection });
      stagedPacketUtf8 = JSON.stringify({ schema: "custodial.vacancy-reviewed-preparation.v1", reason,
        preInputUtf8: JSON.stringify(preInput), postInputUtf8: JSON.stringify(postInput),
        preparedProjectionUtf8: JSON.stringify(projection), previewUtf8: JSON.stringify(preview),
        previewCanonicalUtf8: canonicalJson({ schema: preview.schema, binding, projection }) });
      await client.query("rollback to savepoint vacancy_reviewed_preparation");
      await client.query("release savepoint vacancy_reviewed_preparation");
      // Commit only the private UNSUBMITTED candidate. This is not a roster,
      // work, projection, lunch, notification or device acceptance.
      await call(client, "static_weekly_stage_vacancy_reviewed_preparation", [...auth, stagedPacketUtf8]);
      retained = await call(client, "static_weekly_read_vacancy_reviewed_preparation", auth);
    }
    if (retained?.found !== true || retained.state !== "UNSUBMITTED" || retained.current !== true
      || Object.keys(retained).sort().join(",") !== ["found", "state", "current", "replayed", "preview_digest",
        "worker_candidate_digest", "generation", "staged_at", "packet_utf8", "payload_sha256"].sort().join(",")
      || typeof retained.replayed !== "boolean" || !Number.isSafeInteger(retained.generation) || retained.generation < 0
      || typeof retained.staged_at !== "string" || !Number.isFinite(Date.parse(retained.staged_at))
      || typeof retained.packet_utf8 !== "string" || typeof retained.payload_sha256 !== "string"
      || createHash("sha256").update(retained.packet_utf8, "utf8").digest("hex") !== retained.payload_sha256
      || (stagedPacketUtf8 !== null && retained.packet_utf8 !== stagedPacketUtf8)) {
      throw fail("static_weekly_vacancy_reviewed_preparation_unavailable",
        "The original reviewed preparation is unavailable or stale. Retain the request and read its original outcome.");
    }
    let packet, projection, preview, originalPreInput, originalPostInput;
    try {
      packet = JSON.parse(retained.packet_utf8);
      if (!packet || Array.isArray(packet) || Object.keys(packet).sort().join(",") !==
        ["schema", "reason", "preInputUtf8", "postInputUtf8", "preparedProjectionUtf8", "previewUtf8", "previewCanonicalUtf8"].sort().join(",")
        || packet.schema !== "custodial.vacancy-reviewed-preparation.v1" || packet.reason !== reason
        || [packet.preInputUtf8, packet.postInputUtf8, packet.preparedProjectionUtf8, packet.previewUtf8,
          packet.previewCanonicalUtf8].some(value => typeof value !== "string")) throw new Error("packet binding");
      projection = JSON.parse(packet.preparedProjectionUtf8);
      preview = JSON.parse(packet.previewUtf8);
      originalPreInput = JSON.parse(packet.preInputUtf8);
      originalPostInput = JSON.parse(packet.postInputUtf8);
      const reproduced = createVacancyManagerPreview({ ...binding, projection });
      if (projection.actorManagerName !== actor.managerName || canonicalJson(reproduced) !== canonicalJson(preview)
        || packet.previewCanonicalUtf8 !== canonicalJson({ schema: preview.schema, binding, projection })
        || reproduced.previewDigest !== retained.preview_digest
        || reproduced.workerCandidateDigest !== retained.worker_candidate_digest
        || canonicalJson(preInput) !== canonicalJson(originalPreInput)) throw new Error("original binding");
    } catch {
      throw fail("static_weekly_vacancy_reviewed_preparation_changed",
        "The original reviewed preparation does not match this request and current source. No replacement was prepared.");
    }
    let mutation = null, actualPostInputUtf8 = null;
    if (confirmDigest !== null) {
      if (preview.previewDigest !== confirmDigest) throw fail("static_weekly_vacancy_preview_changed",
        "The original reviewed preview does not match this confirmation. Read its original outcome.");
      mutation = await mutate();
      const actualPostInput = compilerInputFromPublishedSource(await sourceFor(client, publicationId, weekStart), weekStart);
      if (canonicalJson(actualPostInput) !== canonicalJson(originalPostInput)) throw fail("static_weekly_vacancy_preview_changed",
        "The current vacancy source differs from the original reviewed preparation. No change was accepted.");
      actualPostInputUtf8 = JSON.stringify(actualPostInput);
    }
    return { actor, auth, weekStart, publicationId, key, mutation, projection, preview, actualPostInputUtf8,
      packetUtf8: retained.packet_utf8 };
  }

  return {
    runManagerOperation,
    runExternalRecurringOperation,
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
      const actor=requireManager(manager, { readOnlyOperation: true });
      return transaction(async client=>{
        const week=requireDate(weekStart,'week start'),snapshot=await snapshotFor(client,week);
        if(snapshot.projection_status!=='current'||!['approved-static-fixed-v1','approved-manual-period-v1'].includes(snapshot.latest_projection?.compiler_version)
          ||!snapshot.current_publication?.publication_id)return snapshot;
        const frame=requireDate(snapshot.week_start,'current publication window');
        const registered=await call(client,'static_weekly_v3_read_publication_source',[snapshot.current_publication.publication_id,frame]);
        if(!registered.compiler_input?.version?.manualGroupRatingAuthority)return snapshot;
        const lunch=await call(client,'static_weekly_v8_read_lunch_document',[frame]);
        let projectionAvailability=null;
        if(snapshot.latest_projection.compiler_version==='approved-manual-period-v1'){
          const view=await call(client,'static_weekly_manual_projection_view_basis',[actor.managerId,snapshot.latest_projection.projection_id]);
          if(view?.schema!=='custodial.approved-manual-projection-view-basis.v1'||view.projectionId!==snapshot.latest_projection.projection_id
            ||view.publicationId!==snapshot.current_publication.publication_id||view.frameStart!==frame
            ||!Array.isArray(view.projectionAvailability))throw fail('static_manual_current_projection_view_changed');
          projectionAvailability=view.projectionAvailability;
        }
        return{...snapshot,approved_manual_schedule:approvedManualManagerView({snapshot,source:registered.compiler_input,lunchDocument:lunch,projectionAvailability})};
      });
    },
    async getApprovedManualActivationRoster({manager}) {
      const actor=requireManager(manager);
      return transaction(client=>call(client,'static_weekly_read_manual_activation_roster',[actor.managerId]));
    },
    async previewApprovedManualActivation({manager,packetId,expectedRevision}) {
      const actor=requireManager(manager),id=requireUuid(packetId,'static_manual_activation_packet_required'),revision=requireRevision(expectedRevision);
      return transaction(async client=>{
        await lockStaticWeeklyAuthority(client);
        const basis=await call(client,'static_weekly_read_manual_activation_basis',[actor.managerId,id,revision]);
        if(basis?.schema!=='custodial.approved-manual-activation-preview-basis.v1'||basis.managerId!==actor.managerId
          ||basis.packetId!==id||basis.expectedRevision!==revision||!/^[a-f0-9]{64}$/.test(basis.previewDigest||''))
          throw fail('static_manual_activation_basis_invalid');
        return{...basis,schema:'custodial.approved-manual-activation-preview.v1',status:'PREVIEW_ONLY',
          solverInvoked:false,published:false,atomicRosterAndPublication:true};
      });
    },
    async activateApprovedManualSchedule({manager,packetId,expectedRevision,previewDigest,idempotencyKey}) {
      const actor=requireManager(manager),id=requireUuid(packetId,'static_manual_activation_packet_required'),revision=requireRevision(expectedRevision),
        key=requireIdempotencyKey(idempotencyKey),preview=text(previewDigest);
      if(key.length>120||!/^[a-f0-9]{64}$/.test(preview))throw fail('static_manual_activation_identity_invalid');
      const request={managerId:actor.managerId,packetId:id,expectedRevision:revision,previewDigest:preview,idempotencyKey:key};
      return transaction(async client=>{
        await lockStaticWeeklyAuthority(client);
        const prior=await call(client,'static_weekly_read_manual_activation_confirmation',[actor.managerId,key]);
        if(prior){
          if(canonicalJson(prior.request)!==canonicalJson(request)||prior.receipt?.schema!=='custodial.approved-manual-activation-confirmation.v1')
            throw fail('static_manual_activation_original_identity_conflict');
          return{...prior.receipt,status:'ACCEPTED_ORIGINAL_RECEIPT',replayed:true,currentReadbackNotRepeated:true};
        }
        const accepted=await call(client,'static_weekly_activate_approved_manual_schedule',[actor.managerId,id,revision,preview,key]);
        if(accepted?.schema!=='custodial.approved-manual-activation-confirmation.v1'||accepted.status!=='PERSISTED_CURRENT'
          ||accepted.ok!==true||accepted.persistence_status!=='PERSISTED'||accepted.packetId!==id||accepted.previewDigest!==preview
          ||accepted.atomicRosterAndPublication!==true||accepted.solverInvoked!==false||accepted.weeklyBaselineChanged!==false)
          throw fail('static_manual_activation_not_persisted');
        const date=requireDate(accepted.serviceDate,'manual activation date'),snapshot=await snapshotFor(client,date),
          lunch=await call(client,'static_weekly_v8_read_lunch_document',[date]);
        if(snapshot.projection_status!=='current'||snapshot.current_publication?.publication_id!==accepted.publication_id
          ||snapshot.latest_projection?.projection_id!==accepted.projection_id||snapshot.authority_revision!==accepted.authority_revision
          ||snapshot.week_start!==date||lunch.persistence_status!=='PERSISTED'||lunch.projection_id!==accepted.projection_id
          ||lunch.document_identity!==accepted.lunch_document_identity)
          throw fail('static_manual_activation_current_readback_mismatch');
        return accepted;
      },{reconcileManagerId:actor.managerId});
    },
    async getApprovedManualActivationOutcome({manager,idempotencyKey}) {
      const actor=requireManager(manager),key=requireIdempotencyKey(idempotencyKey);
      return transaction(async client=>{
        await lockStaticWeeklyAuthority(client);
        const original=await call(client,'static_weekly_read_manual_activation_confirmation',[actor.managerId,key]);
        return{schema:'custodial.approved-manual-activation-status.v1',state:original?'ACCEPTED':'NOT_FOUND',
          idempotencyKey:key,original:original||null,doesNotAuthorizeRetry:true};
      });
    },
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
    async previewRecurringStaffing({ manager, effectiveStart, expectedRevision, fullNineSourceId = null,
      signal = null, deadlineAt = null }) {
      const enteredAt = performance.now();
      const expiresAt = deadlineAt == null ? enteredAt + STATIC_WEEKLY_MANAGER_OPERATION_DEADLINE_MS
        : Math.min(Number(deadlineAt), enteredAt + STATIC_WEEKLY_MANAGER_OPERATION_DEADLINE_MS);
      if (!Number.isFinite(expiresAt)) throw fail("static_weekly_recurring_operation_deadline_invalid");
      const controller = new AbortController();
      const relayAbort = () => controller.abort(signal?.reason);
      signal?.addEventListener?.("abort", relayAbort, { once: true });
      if (signal?.aborted) relayAbort();
      const timeout = setTimeout(() => controller.abort(fail("static_weekly_recurring_operation_deadline_exceeded",
        "The recurring operation exceeded its one-minute deadline; preview the current plan again.")),
      Math.max(1, expiresAt - performance.now() - STATIC_WEEKLY_MANAGER_CLEANUP_RESERVE_MS));
      timeout.unref?.();
      try {
      operationRemaining(expiresAt, controller.signal);
      const actor = requireManager(manager);
      const date = requireMonday(effectiveStart, "recurring effective start");
      const revision = requireRevision(expectedRevision);
      const sourceId = approvedRecurringFullSource(fullNineSourceId);
      const basis = await transaction(client => recurringBasisFor(client, { actor, date, revision, fullNineSourceId: sourceId }),
        { signal: controller.signal, deadlineAt: expiresAt });
      // Public preview does not hold an idle transaction during its solve.
      const candidate = await recurringCandidatePreparer(recurringPreparationInput(basis, date, revision), {
        signal: controller.signal, deadlineMilliseconds: operationRemaining(expiresAt, controller.signal),
      });
      operationRemaining(expiresAt, controller.signal);
      validateRecurringCandidate(candidate, basis, revision);
      // Recheck after it completes; a later confirmation must do the same
      // under a serial authority lock and compare this exact digest.
      const current = await transaction(async (client) => {
        await lockStaticWeeklyAuthority(client);
        const snapshot=await snapshotFor(client,date),recurringGeneration=await recurringGenerationFor(client);
        const correctionSource=basis.correctionWitness?await registeredSourceFor(client,basis.correctionWitness.sourceId,date):null;
        const correctionWitness=correctionSource?recurringCorrectionWitness({binding:correctionBinding,snapshot,
          patternSource:basis.source,correctionSource,effectiveWeek:date,expectedRevision:revision,
          recurringGeneration,effectivePublicationId:basis.patternAuthority.publicationId}):null;
        return { snapshot,recurringGeneration,correctionWitness,
          splashSeasonWitness: await call(client, "static_weekly_sch022_preview_witness", [date,
            JSON.stringify(seasonWorkFromAssignments(candidate.decision.assignments)),actor.managerId]) };
      }, { signal: controller.signal, deadlineAt: expiresAt });
      if (requireRevision(current.snapshot?.authority_revision) !== revision
        || text(current.snapshot?.current_publication?.publication_id) !== candidate.publicationId
        || current.recurringGeneration !== basis.recurringGeneration) {
        throw fail("static_weekly_recurring_preview_revision_changed", "The manager roster changed during preview.");
      }
      if(basis.correctionWitness)requireMatchingRecurringCorrectionWitness(basis.correctionWitness,current.correctionWitness);
      basis.splashSeasonWitness = requireSeasonWitness(current.splashSeasonWitness);
      // Hash every byte of the manager-visible candidate result, not only its
      // final area map. This binds source/roster inputs, compiler authority and
      // replay, metrics and the exact preview changes to the named manager.
      const previewDigest = recurringPreviewDigest(actor, basis, candidate);
      operationRemaining(expiresAt, controller.signal);
      return { ...candidate, recurringGeneration: basis.recurringGeneration,
        previewDigest, source: "AUTHENTICATED_MANAGER_READBACK",
        admitted: false, published: false, affectedPhonesUpdated: false };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener?.("abort", relayAbort);
      }
    },
    async confirmRecurringStaffing({ manager, confirmationKey, effectiveStart, expectedRevision, previewDigest,
      fullNineSourceId = null, signal = null, deadlineAt = null }) {
      const enteredAt = performance.now();
      const expiresAt = deadlineAt == null ? enteredAt + STATIC_WEEKLY_MANAGER_OPERATION_DEADLINE_MS
        : Math.min(Number(deadlineAt), enteredAt + STATIC_WEEKLY_MANAGER_OPERATION_DEADLINE_MS);
      if (!Number.isFinite(expiresAt)) throw fail("static_weekly_recurring_operation_deadline_invalid");
      const controller = new AbortController();
      const relayAbort = () => controller.abort(signal?.reason);
      signal?.addEventListener?.("abort", relayAbort, { once: true });
      if (signal?.aborted) relayAbort();
      const timeout = setTimeout(() => controller.abort(fail("static_weekly_recurring_operation_deadline_exceeded",
        "The recurring operation exceeded its one-minute deadline; check its exact status before retrying.")),
      Math.max(1, expiresAt - performance.now() - STATIC_WEEKLY_MANAGER_CLEANUP_RESERVE_MS));
      timeout.unref?.();
      try {
      operationRemaining(expiresAt, controller.signal);
      const actor = requireManager(manager);
      const key = requireUuid(confirmationKey, "recurring_confirmation_key_required");
      const date = requireMonday(effectiveStart, "recurring effective start");
      const revision = requireRevision(expectedRevision);
      const expectedDigest = text(previewDigest);
      if (!/^[a-f0-9]{64}$/.test(expectedDigest)) throw fail("static_weekly_recurring_preview_digest_required");
      const sourceId = approvedRecurringFullSource(fullNineSourceId);
      const confirmation = await transaction(async client => {
        // One checked-out client owns every child and the final receipt. Never
        // invoke the public preview/publish methods from this transaction.
        await lockStaticWeeklyAuthority(client);
        const parent = await call(client, "static_weekly_v13_begin_recurring_confirmation",
          [actor.managerId, key, date, revision, expectedDigest, sourceId]);
        // Database checks identical request/manager first. Accepted retries
        // return BEFORE current time, revision, generation or compiler checks.
        if (parent?.state === "ACCEPTED") return parent;
        if (parent?.state !== "RESERVED") throw fail("static_weekly_recurring_parent_unavailable");
        requireUuid(parent.operationId, "static_weekly_recurring_parent_unavailable");
        const basis = await recurringBasisFor(client, { actor, date, revision, fullNineSourceId: sourceId });
        const prepared = clone(await prepareInsideTransaction(client, () =>
          recurringAdmissionPreparer(recurringPreparationInput(basis, date, revision), {
            signal: controller.signal, deadlineMilliseconds: operationRemaining(expiresAt, controller.signal),
          })));
        try { assertRecurringAdmissionCandidate(prepared); }
        catch (error) {
          if(error?.code===OPENING_COVERAGE_ERROR&&sanitizeOpeningCoverageDiagnostic(error.openingCoverageDiagnostic))throw error;
          throw fail("static_weekly_recurring_private_candidate_rejected", `The private recurring candidate is invalid: ${error.message}`);
        }
        const candidate = prepared.candidate;
        validateRecurringCandidate(candidate, basis, revision);
        basis.splashSeasonWitness = requireSeasonWitness(await call(client,
          "static_weekly_sch022_preview_witness", [date,
            JSON.stringify(seasonWorkFromAssignments(candidate.decision.assignments)),actor.managerId]));
        if (recurringPreviewDigest(actor, basis, candidate) !== expectedDigest) {
          throw fail("static_weekly_recurring_preview_changed", "The complete recurring preview changed. Preview the current plan again before confirming.");
        }
        const admission = await call(client, "static_weekly_v14_admit_recurring_source",
          [actor.managerId, key, prepared.canonicalSource, candidate.candidateSourceDigest]);
        const admittedSourceId = requireUuid(admission?.source_id, "static_weekly_recurring_source_admission_failed");
        const draftInput = clone(prepared.canonicalSource);
        draftInput.version.id = randomUUID();
        draftInput.version.publicationId = randomUUID();
        draftInput.versions = [draftInput.version];
        delete draftInput.version;
        const childPrefix = `recurring:${actor.managerId}:${key}`;
        const draftInputPrepared = await prepareInsideTransaction(client, () => prepareDraft(draftInput,
          { expectedRevision: revision, actor: { ...actor, idempotencyKey: `${childPrefix}:draft` },
            signal: controller.signal, deadlineAt: expiresAt }));
        const draft = await call(client, "static_weekly_v3_create_draft", [draftInputPrepared.effectiveStart,
          draftInputPrepared.objectiveVersion, draftInputPrepared.objective, draftInputPrepared.inputProvenance,
          draftInputPrepared.document, revision, actor.managerId, `${childPrefix}:draft`, admittedSourceId]);
        const publication = await call(client, "static_weekly_v3_publish_draft", [
          requireUuid(draft?.data?.version_id, "static_weekly_recurring_draft_unavailable"),
          requireRevision(draft?.data?.draft_revision), requireRevision(draft?.revision), actor.managerId,
          `${childPrefix}:publish`, "supersede", null]);
        const publicationId = requirePublicationId(publication?.data?.publication_id);
        // Our own publication is a semantic authority change. The preview was
        // checked before writing under the common lock; bind the dependency
        // generation AFTER this exact parent-owned publication, not its stale
        // pre-publication value. Other writers cannot enter this transaction.
        const publicationGeneration = await recurringGenerationFor(client);
        await call(client, "static_weekly_v18_bind_recurring_publication",
          [actor.managerId, key, publicationId, publicationGeneration, candidate.decision]);
        const projection = await materializeCurrentProjection(client, { actor, publicationId, weekStart: date,
          expectedRevision: requireRevision(publication?.revision), idempotencyKey: `${childPrefix}:projection:${date}`,
          signal: controller.signal, deadlineAt: expiresAt });
        const receipt = await call(client, "static_weekly_v23_finalize_recurring_confirmation", [actor.managerId, key]);
        if (receipt?.accepted !== true || receipt.operationId !== parent.operationId
          || receipt.managerId !== actor.managerId || receipt.confirmationKey !== key || receipt.previewDigest !== expectedDigest
          || receipt.sourceId !== admittedSourceId || receipt.sourceDigest !== candidate.candidateSourceDigest
          || receipt.publicationId !== publicationId || receipt.projectionId !== projection?.data?.projection_id
          || receipt.authorityRevision !== projection?.revision || receipt.effectiveStart !== date
          || receipt.phoneDeliveryState !== "PENDING" || receipt.affectedPhonesUpdated !== false) {
          throw fail("static_weekly_recurring_acceptance_receipt_mismatch");
        }
        // Immutable original acceptance, NOT a claim about current validity or
        // phone delivery. Later exact status/readback supplies those facts.
        return { state: "ACCEPTED", operationId: parent.operationId, receipt };
      }, { signal: controller.signal, deadlineAt: expiresAt });
      if (controller.signal.aborted || performance.now() >= expiresAt) {
        throw fail("static_weekly_recurring_confirmation_outcome_unknown",
          "The confirmation outlived its one-minute response deadline; read its exact status before retrying.");
      }
      return confirmation;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener?.("abort", relayAbort);
      }
    },
    async getApprovedInitialConfirmationStatus(input) { return approvedConfirmationStatus('initial',input); },
    async getApprovedStaticConfirmationStatus(input) { return approvedConfirmationStatus('recurring',input); },
    async getRecurringConfirmationStatus({ manager, confirmationKey }) {
      const actor = requireManager(manager);
      const key = requireUuid(confirmationKey, "recurring_confirmation_key_required");
      // Exact status is a locking DB read, not an inference from a transport
      // timeout. The SQL reader waits for an uncertain writer before deciding
      // ACCEPTED versus NOT_FOUND; the authenticated HTTP route never infers it.
      return transaction((client) => call(client, "static_weekly_v13_read_recurring_confirmation", [
        actor.managerId, key,
      ]));
    },
    async getCurrentRecurringDelivery({ manager, serviceDate }) {
      const actor = requireManager(manager);
      const date = requireDate(serviceDate, "service date");
      return transaction((client) => call(client, "static_weekly_v25_read_current_recurring_delivery", [date, actor.managerId]));
    },
    async beginStaffingCommand({ manager, ...input }) {
      const actor = requireStaffingManager(manager, input.commandKind);
      return transaction(async(client) => {
        // A byte-identical begin may be an idempotent recovery after its response
        // was lost before midnight. PostgreSQL first resolves the authenticated
        // manager + prepare-key identity, then rejects an elapsed *new* command.
        // Delegate the canonical operational-date check to that existing typed
        // RPC, not an invoker read of generic settings by this restricted role.
        const request = createStaffingCommandRequest(input,{allowElapsedAuthorityReplay:true});
        return call(client, "static_weekly_v10_begin_staffing_command", [request.semanticBody,
          request.clientPrepareKey,request.expectedRevision,actor.managerId]);
      });
    },
    async prepareStaffingCommand({ manager, operationId }) {
      const actor = requireManager(manager, manager?.read_only === true ? "manage_absences" : undefined);
      const operation = requireUuid(operationId, "staffing_operation_id_required");
      const principalFields=['manager_id','managerId','manager_display_name','managerName','credential_id','device_id','access_level','auth_mode','read_only'];
      const originalPrincipal=principalFields.map(key=>manager?.[key]);
      const requirePrincipal=command=>{
        const current=requireOriginalStaffingManager(manager,command);
        if(current.managerId!==actor.managerId||current.managerName!==actor.managerName||principalFields.map(key=>manager?.[key])
          .some((value,index)=>value!==originalPrincipal[index]))throw fail('staffing_original_principal_changed');
      };
      return transaction(async (client) => {
        await lockStaticWeeklyAuthority(client);
        const command = await call(client, "static_weekly_v10_read_staffing_command", [operation, actor.managerId]);
        if (!command) throw fail("staffing_operation_unavailable");
        // PREPARED is still an awaited original read. Do not return it using
        // a changed caller credential or authentication mode merely because
        // no further preparation is necessary.
        requirePrincipal(command);
        if (command.state === "PREPARED") return command;
        if (command.state !== "PREPARING") throw fail("staffing_operation_not_preparable");
        if (text(command.prepared_by_manager_id) !== actor.managerId) throw fail("staffing_original_preparer_required");
        const originalCommand=canonicalJson(command),capturedCommand=clone(command);
        // The fixed authenticated command read owns the private original.
        // Capture its primitive pins before any other source await; a current
        // incumbent or a request field cannot substitute for this ledger fact.
        const semantic = Object.freeze({ ...command.semantic_body });
        const semanticDigest = command.semantic_digest;
        const expectedRevision = requireRevision(command.expected_revision);
        const currentServiceDate = command.current_service_date;
        let originalCancellationTarget = null;
        if (semantic.commandKind === "cancel_absence") {
          const target = command.original_cancellation_target;
          if (target == null) throw fail("staffing_original_cancellation_target_required");
          const fields = ["absenceId", "employeeId", "startDate", "endDate", "acceptedOperationId", "status"];
          const exactUuid = value => typeof value === "string"
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
          if (typeof target !== "object" || Array.isArray(target)
            || Object.keys(target).length !== fields.length || fields.some(field => !Object.hasOwn(target, field))
            || ![target.absenceId, target.employeeId, target.acceptedOperationId].every(exactUuid)
            || target.status !== "accepted" || target.absenceId !== semantic.targetAbsenceId
            || target.employeeId !== semantic.employeeId || target.acceptedOperationId !== target.absenceId
            || command.operation_id !== operation || semantic.absenceKind !== null
            || Object.keys(semantic).sort().join(",") !== "absenceKind,commandKind,employeeId,endDate,startDate,targetAbsenceId"
            || postgresJsonbContentDigest(semantic) !== semanticDigest) {
            throw fail("staffing_original_cancellation_target_invalid");
          }
          enumerateStaffingServiceWindow(target.startDate, target.endDate);
          enumerateStaffingServiceWindow(currentServiceDate, currentServiceDate);
          if (semantic.startDate !== (target.startDate > currentServiceDate ? target.startDate : currentServiceDate)
            || semantic.startDate > target.endDate || semantic.endDate !== target.endDate) {
            throw fail("staffing_original_cancellation_target_window_changed");
          }
          originalCancellationTarget = Object.freeze(Object.fromEntries(fields.map(field => [field, target[field]])));
        } else if (command.original_cancellation_target != null) {
          throw fail("staffing_original_cancellation_target_forbidden");
        }
        const meter = createStaffingPreparationMeter();
        const frameVector=await call(client,'static_weekly_staffing_period_frames',[operation,actor.managerId]);
        requirePrincipal(command);meter.checkpoint();
        const originalFrameVector=canonicalJson(frameVector),window=staffingWindowFromOwnerFrames({command:capturedCommand,managerId:actor.managerId,frameVector});
        const currentTargets=await call(client,"static_weekly_v11_read_current_refresh_targets",
          [semantic.startDate,semantic.endDate,actor.managerId]);
        requirePrincipal(command);
        if (!Array.isArray(currentTargets)) throw fail("staffing_current_refresh_targets_unavailable");
        const priorByDate=new Map();
        for(const row of currentTargets){
          if(!priorByDate.has(row.serviceDate))priorByDate.set(row.serviceDate,new Set());
          priorByDate.get(row.serviceDate).add(text(row.employeeId));
        }
        const {prepareApprovedPendingStaffingWeekIsolated}=await import('./static-weekly-schedule-compiler-runtime.js');
        requirePrincipal(command);meter.checkpoint();
        const prepared = await prepareInsideTransaction(client, async () => {
          const candidates = []; const weeks = []; const inputDigests = [];
          for (const weekStart of window.weeks) {
            const budget = meter.checkpoint();
            const weekDeadline=performance.now()+Math.max(1,Math.floor(budget.remainingMilliseconds));
            const snapshot = await snapshotFor(client, weekStart);
            requirePrincipal(command);meter.checkpoint();
            if (requireRevision(snapshot?.authority_revision) !== expectedRevision) {
              throw fail("staffing_preparation_revision_changed");
            }
            const publicationId = requirePublicationId(snapshot?.current_publication?.publication_id);
            const source = await sourceFor(client, publicationId, weekStart);
            requirePrincipal(command);meter.checkpoint();
            const manual=source.compiler_input?.version?.manualGroupRatingAuthority?.manifestSha256===
              'fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f';
            let overlay,manualBasis=null,manualWorkerInput=null;
            const originalSource=canonicalJson(source),originalSnapshot=canonicalJson(snapshot),bases=[];
            if(manual){
              manualBasis=await call(client,'static_weekly_manual_period_basis',[actor.managerId,publicationId,weekStart,expectedRevision,operation]);
              requirePrincipal(command);meter.checkpoint();
              if(canonicalJson(manualBasis.originalSource)!==originalSource)throw fail('staffing_approved_original_source_changed');
              manualWorkerInput=approvedManualStaffingWorkerInput({basis:manualBasis,week:readApprovedManualWeek(),actor,
                operationId:operation,expectedRevision,frameStart:weekStart});
            }else{
              overlay=createStaffingWeekPreviewInput({operationId:operation,managerId:actor.managerId,
                semanticBody:semantic,expectedRevision,weekStart,source,currentServiceDate,originalCancellationTarget});
              for(const date of overlay.dates){
                const basis=await call(client,'static_weekly_read_approved_template_basis',
                  [actor.managerId,publicationId,date,'DATED_ABSENCE',null,expectedRevision]);
                requirePrincipal(command);meter.checkpoint();bases.push(clone(basis));
              }
            }
            // Await the SAME serialized owned child queue. Native transaction
            // keepalives can run during fixed CPU preparation. The captured
            // absolute deadline includes all earlier basis/Source reads.
            let projection,unresolvedPreparationError=null;
            try{
              if(manual){
                const result=await prepareApprovedManualPeriodIsolated(manualWorkerInput,{deadlineAtMilliseconds:weekDeadline});
                projection=approvedManualPendingStaffingTransport({workerInput:manualWorkerInput,workerResult:result,basis:manualBasis});
                overlay={dates:projection.envelope.semantic_snapshot.scopeDates,input:manualWorkerInput,
                  publication:{weekStart,publicationId,versionId:manualBasis.versionId,authorityRevision:expectedRevision}};
              }else{
                projection=await prepareApprovedPendingStaffingWeekIsolated({
                  schema:'custodial.approved-static-pending-staffing-worker-input.v1',
                  command:capturedCommand,managerId:actor.managerId,actor,weekStart,source,bases,snapshot,window
                },{deadlineAtMilliseconds:weekDeadline});
              }
            }catch(error){
              requirePrincipal(command);meter.checkpoint();
              if(!error||types.isProxy(error)||!['static_template_dated_coverage_unresolved','static_template_missing_approved_pattern']
                .includes(Object.getOwnPropertyDescriptor(error,'code')?.value))throw error;
              // Closed unresolved DATA also crossed an await. It may leave
              // only after the same original-currentness reads as a result.
              // The catalog dependency likewise cannot describe a stale
              // original/principal merely because it carries no candidate.
              unresolvedPreparationError=error;
            }
            meter.checkpoint();requirePrincipal(command);
            // PREPARE stages DATA only. Recheck every actual original before
            // the existing season/candidate staging boundary; never accept an
            // exception early or borrow a replacement command/principal.
            const currentCommand=await call(client,'static_weekly_v10_read_staffing_command',[operation,actor.managerId]);
            requirePrincipal(currentCommand);meter.checkpoint();
            if(canonicalJson(currentCommand)!==originalCommand)throw fail('staffing_approved_original_command_changed');
            const currentSnapshot=await snapshotFor(client,weekStart);
            requirePrincipal(command);meter.checkpoint();
            if(canonicalJson(currentSnapshot)!==originalSnapshot)throw fail('staffing_preparation_revision_changed');
            const currentSource=await sourceFor(client,publicationId,weekStart);
            requirePrincipal(command);meter.checkpoint();
            if(canonicalJson(currentSource)!==originalSource)throw fail('staffing_approved_original_source_changed');
            if(manual){
              const current=await call(client,'static_weekly_manual_period_basis',[actor.managerId,publicationId,weekStart,expectedRevision,operation]);
              requirePrincipal(command);meter.checkpoint();
              if(canonicalJson(current)!==canonicalJson(manualBasis))throw fail('staffing_approved_pending_basis_changed');
            }else for(let index=0;index<overlay.dates.length;index++){
                const current=await call(client,'static_weekly_read_approved_template_basis',
                  [actor.managerId,publicationId,overlay.dates[index],'DATED_ABSENCE',null,expectedRevision]);
                requirePrincipal(command);meter.checkpoint();
                if(canonicalJson(current)!==canonicalJson(bases[index]))throw fail('staffing_approved_pending_basis_changed');
              }
            if(unresolvedPreparationError)throw unresolvedPreparationError;
            if (!projection.lunchDocument?.document_identity) throw fail("static_weekly_lunch_publication_missing");
            // The fused worker checks planned source/assignment coverage before
            // returning this derived report. Recheck its source/context binding;
            // never reinterpret it as physical opening-readiness authority.
            // Keep the original worker response/report intact. Only the canonical
            // adapter's projection fields belong in v11's closed SQL payload.
            if (Object.hasOwn(projection, "openingCoverageReport")) {
              assertOpeningCoverageReport(projection.openingCoverageReport, {
                sourceDigest: postgresJsonbContentDigest(overlay.input),
                publicationId, authorityRevision: expectedRevision,
              });
            }
            const { lunchDocument, openingCoverageReport: _openingCoverageReport, ...projectionPayload } = projection;
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
              // Match the SQL affected vector: cancellation uses independently
              // named prior/new work, never the ledger person alone.
              if (semantic.commandKind === "absence") employees.add(semantic.employeeId);
              for (const employeeId of [...employees].sort()) candidates.push({ candidateKind: "schedule_refresh",
                candidateKey: `date:${serviceDate}:employee:${employeeId}`, serviceDate,
                payload: { employeeId, weekStart, publicationId, projectionIdentity: projection.envelope.database_projection_identity,
                  lunchDocumentIdentity: lunchDocument.document_identity } });
            }
            weeks.push(overlay.publication);
            inputDigests.push(createHash("sha256").update(canonicalJson(overlay.input)).digest("hex"));
            meter.checkpoint();
          }
          const currentFrames=await call(client,'static_weekly_staffing_period_frames',[operation,actor.managerId]);
          requirePrincipal(command);meter.checkpoint();
          if(canonicalJson(currentFrames)!==originalFrameVector)throw fail('staffing_original_period_frames_changed');
          const candidateSet = createStaffingCandidateSet({ window, candidates, meter });
          const databaseCandidates = candidateSet.rows.map(({ candidateKind, candidateKey, serviceDate, payload }) => ({
            candidateKind, candidateKey, payload, serviceDate,
          }));
          const seasonWitness = await call(client,"static_weekly_sch022_preview_staffing_witness",
            [JSON.stringify(databaseCandidates),actor.managerId]);
          requirePrincipal(command);meter.checkpoint();
          const seasonWitnessDigest = requireSeasonWitness(seasonWitness?.digest);
          const publicationVector = { expectedRevision, weeks };
          const inputDigest = createHash("sha256").update(canonicalJson({ operationId: operation,
            semanticDigest, publicationVector, inputDigests })).digest("hex");
          const previewDigest = createHash("sha256").update(canonicalJson({ operationId: operation,
            semanticDigest, candidateSetDigest: candidateSet.digest,
            publicationVector, summary: candidateSet.summary, seasonWitnessDigest })).digest("hex");
          return { candidateSet, publicationVector, inputDigest, previewDigest, seasonWitnessDigest };
        });
        const databaseCandidates = prepared.candidateSet.rows.map(({ candidateKind, candidateKey, serviceDate, payload }) => ({
          candidateKind, candidateKey, payload, serviceDate,
        }));
        requirePrincipal(command);meter.checkpoint();
        const staged=await call(client, "static_weekly_sch022_stage_staffing_command", [operation, JSON.stringify(databaseCandidates),
          prepared.previewDigest, prepared.inputDigest, prepared.publicationVector, actor.managerId,
          prepared.seasonWitnessDigest]);
        requirePrincipal(command);meter.checkpoint();return staged;
      });
    },
    async stageStaffingCommand({ manager, operationId, window, candidates, previewDigest, inputDigest, publicationVector,
      seasonWitnessDigest = null }) {
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
      return transaction(async (client) => {
        const currentWitness = await call(client,"static_weekly_sch022_preview_staffing_witness",
          [JSON.stringify(databaseCandidates),actor.managerId]);
        if (currentWitness?.target_week_count > 0 && seasonWitnessDigest !== currentWitness.digest) {
          throw fail("static_weekly_sch022_witness_required", "Target-bearing staffing must retain the exact original seasonal preview witness.");
        }
        return call(client, "static_weekly_sch022_stage_staffing_command", [
        requireUuid(operationId, "staffing_operation_id_required"),
        JSON.stringify(databaseCandidates),
        requireDigest(previewDigest, "staffing_preview_digest_required"),
        requireDigest(inputDigest, "staffing_input_digest_required"),
        structuredClone(publicationVector),
        actor.managerId,
        requireSeasonWitness(currentWitness?.digest),
      ]);
      });
    },
    async getStaffingCommand({ manager, operationId }) {
      const actor = requireManager(manager, manager?.read_only === true ? "manage_absences" : undefined);
      return transaction(async client => {
        const command = await call(client, "static_weekly_v10_read_staffing_command", [
          requireUuid(operationId, "staffing_operation_id_required"), actor.managerId]);
        if (command) requireOriginalStaffingManager(manager, command);
        return command;
      });
    },
    async listPendingStaffingCommands({ manager, limit = 50, afterCreatedAt = null, afterOperationId = null }) {
      const actor = requireManager(manager, manager?.read_only === true ? "manage_absences" : undefined);
      const pageLimit = Number(limit);
      if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 100) throw fail("staffing_page_limit_invalid");
      const hasCreatedAt = text(afterCreatedAt).length > 0;
      const hasOperationId = text(afterOperationId).length > 0;
      if (hasCreatedAt !== hasOperationId || (hasCreatedAt && Number.isNaN(Date.parse(afterCreatedAt)))) {
        throw fail("staffing_page_cursor_invalid");
      }
      return transaction(async client => {
        const page = await call(client, "static_weekly_v10_list_pending_staffing_commands", [
        actor.managerId,
        pageLimit,
        hasCreatedAt ? new Date(afterCreatedAt).toISOString() : null,
        hasOperationId ? requireUuid(afterOperationId, "staffing_page_cursor_invalid") : null,
        ]);
        if (manager?.read_only === true) {
          if (!Array.isArray(page?.commands)) throw fail("staffing_operation_unavailable");
          page.commands = page.commands.filter(command => command.prepared_by_manager_id === actor.managerId);
          for (const command of page.commands) requireOriginalStaffingManager(manager, command);
        }
        return page;
      });
    },
    async getStaffingDeliveryStatus({ manager, operationId }) {
      const actor = requireManager(manager, manager?.read_only === true ? "manage_absences" : undefined);
      const operation = requireUuid(operationId, "staffing_operation_id_required");
      return transaction(async client => {
        const command = await call(client, "static_weekly_v10_read_staffing_command", [operation, actor.managerId]);
        if (!command) throw fail("staffing_operation_unavailable");
        requireOriginalStaffingManager(manager, command);
        return call(client, "static_weekly_v10_read_staffing_delivery_status", [operation, actor.managerId]);
      });
    },
    async acceptStaffingCommand({ manager, operationId, previewDigest, confirmationKey }) {
      const actor = requireManager(manager, manager?.read_only === true ? "manage_absences" : undefined);
      const digest = text(previewDigest);
      if (!/^[0-9a-f]{64}$/.test(digest)) throw fail("staffing_preview_digest_required");
      const operation = requireUuid(operationId, "staffing_operation_id_required");
      return transaction(async client => {
        const command = await call(client, "static_weekly_v10_read_staffing_command", [operation, actor.managerId]);
        if (!command) throw fail("staffing_operation_unavailable");
        requireOriginalStaffingManager(manager, command);
        return call(client, "static_weekly_v11_accept_staffing_command", [
        operation,
        digest,
        requireUuid(confirmationKey, "staffing_confirmation_key_required"),
        actor.managerId,
        ]);
      });
    },
    async cancelStaffingPreparation({ manager, operationId }) {
      const actor = requireManager(manager, manager?.read_only === true ? "manage_absences" : undefined);
      const operation = requireUuid(operationId, "staffing_operation_id_required");
      return transaction(async client => {
        const command = await call(client, "static_weekly_v10_read_staffing_command", [operation, actor.managerId]);
        if (!command) throw fail("staffing_operation_unavailable");
        requireOriginalStaffingManager(manager, command);
        return call(client, "static_weekly_v10_cancel_staffing_preparation", [operation, actor.managerId]);
      });
    },
    async previewCoverAllEventNotes(input){
      const actor=requireManager(input.manager);
      return transaction(async client=>{
        const document=await acceptedCoverAllDocument(client,input),groups=[];
        for(const capacity of document.contractors){
          const result=await listCoverAllEventBriefPreviews({runRpc:(name,args)=>call(client,name,args),manager:actor,
            capacitySlotId:capacity.slotId,printDocument:document});
          if(result.status!=='PREVIEW_ONLY'||result.limited!==false)throw fail('coverall_event_preview_unavailable',`Event preview unavailable (${result.status}); no empty or partial approval inferred.`);
          groups.push({capacitySlotId:capacity.slotId,capacityName:capacity.name,previews:result.previews});
        }
        return {schema:'custodial.coverall-event-preview-page.v1',status:'PREVIEW_ONLY',disclosureApproved:false,
          serviceDate:document.serviceDate,projectionId:document.projectionId,authorityRevision:document.authorityRevision,
          documentDigest:document.documentDigest,groups};
      });
    },
    async issueCoverAllAssignmentLink(input){
      const actor=requireManager(input.manager,"manage_coverall"),ttl=input.ttlHours;
      if(!Number.isSafeInteger(ttl)||ttl<1||ttl>168)throw fail('coverall_link_ttl_invalid');
      if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.requestId))throw fail('coverall_link_request_id_required');
      return transaction(async client=>{
        const document=await acceptedCoverAllDocument(client,input);
        const binding=coverAllCanonicalBinding(document,input.capacityId);
        const token=randomBytes(32).toString('base64url'),id=input.requestId;
        const result=await call(client,'static_weekly_issue_coverall_link',[
          input.manager.manager_id,input.manager.credential_id,input.manager.device_id,input.manager.access_level,
          id,coverAllAccessTokenHash(token),binding,ttl]);
        if(result?.link_id!==id||typeof result.expires_at!=='string')throw fail('coverall_link_issue_response_invalid');
        return {schema:'custodial.coverall-canonical-link.v1',link_id:id,capacity_id:binding.capacity_id,
          service_date:binding.service_date,authority_revision:binding.authority_revision,projection_id:binding.projection_id,
          expires_at:result.expires_at,assignment_path:'/static-weekly/coverall-links/assignment?'+new URLSearchParams({lang:'both'})+'#'+new URLSearchParams({access_token:token})};
      });
    },
    async readCoverAllAssignmentLink({accessToken}){
      const tokenHash=coverAllAccessTokenHash(accessToken);
      return transaction(async client=>{
        await lockStaticWeeklyAuthority(client);
        const current=await call(client,'static_weekly_read_coverall_link',[tokenHash]);
        if(current?.schema!=='custodial.coverall-canonical-access.v1'||!current.binding
          ||typeof current.issuing_manager?.managerId!=='string'||typeof current.issuing_manager?.managerName!=='string')
          throw fail('coverall_link_invalid');
        const b=current.binding;
        const document=await readAcceptedCoverAllDocument(client,{weekStart:b.week_start,serviceDate:b.service_date,
          expectedRevision:b.authority_revision,projectionId:b.projection_id,issuingManager:current.issuing_manager});
        return scopeCanonicalCoverAllDocument(document,b);
      });
    },
    async revokeCoverAllAssignmentLink({manager,linkId}){
      requireManager(manager,"manage_coverall");
      if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(linkId))throw fail('coverall_link_invalid');
      return transaction(client=>call(client,'static_weekly_revoke_coverall_link',[
        manager.manager_id,manager.credential_id,manager.device_id,manager.access_level,linkId]));
    },
    async getCoverAllPrintDocument(input) {
      const selections=coverAllSelections(input.eventSelections??[]);
      // Viewing the accepted route is delegated. Adding selected event notes
      // remains the separate, explicit owner-only disclosure action.
      const actor=selections.length?requireManager(input.manager):requireManager(input.manager,"manage_coverall");
      return transaction(async client=>{
        const document=await acceptedCoverAllDocument(client,input),briefs=[];
        for(const selected of selections)briefs.push(await confirmCoverAllEventBrief({
          runRpc:(name,args)=>call(client,name,args),manager:actor,printDocument:document,
          eventId:selected.event_id,eventRevision:selected.event_revision,capacitySlotId:selected.capacity_slot_id,
          preview:selected.preview,confirmation:selected.confirmation}));
        return coverAllWithBriefs(document,briefs);
      });
    },
    async revalidateCoverAllPrintDocument(input){
      const original=input.document;
      const actor=original?.eventBriefs?.length?requireManager(input.manager):requireManager(input.manager,"manage_coverall");
      if(!original||!Array.isArray(original.eventBriefs??[])||(original.eventBriefs??[]).length>16)throw fail('coverall_event_confirmation_invalid');
      return transaction(async client=>{
        const document=await acceptedCoverAllDocument(client,input),briefs=[];
        for(const confirmed of original.eventBriefs??[])briefs.push(await revalidateConfirmedCoverAllEventBrief({
          runRpc:(name,args)=>call(client,name,args),manager:actor,printDocument:document,
          eventId:confirmed.eventId,eventRevision:confirmed.eventRevision,capacitySlotId:confirmed.capacitySlotId,confirmed}));
        const checked=coverAllWithBriefs(document,briefs);
        if(checked.documentDigest!==original.documentDigest)throw fail('coverall_print_source_changed_reprepare_required');
        return checked;
      });
    },
    async getCapacitySourceBasis({manager,sourcePublicationId,effectiveStart,expectedRevision}) {
      const actor=requireManager(manager);
      const basis=await transaction(client=>call(client,"static_weekly_capacity_source_basis",[
        actor.managerId,requirePublicationId(sourcePublicationId),requireMonday(effectiveStart,"effective start"),requireRevision(expectedRevision),
      ]));
      return capacitySourceBasisSummary(basis);
    },
    async previewCapacitySource({manager,sourcePublicationId,effectiveStart,expectedRevision,selection,reason}) {
      const actor=requireManager(manager);
      const date=requireMonday(effectiveStart,"effective start"),revision=requireRevision(expectedRevision),publication=requirePublicationId(sourcePublicationId);
      const preview=await transaction(async client=>{
        const basis=await call(client,"static_weekly_capacity_source_basis",[actor.managerId,publication,date,revision]);
        const candidate=createContractorCapacityTransitionCandidate({basis,selection,effectiveStart:date,expectedRevision:revision,
          reason:text(reason),candidateVersionId:randomUUID(),candidatePublicationId:randomUUID()});
        return call(client,"static_weekly_capacity_source_preview",[actor.managerId,publication,date,revision,
          JSON.stringify(selection),text(reason),JSON.stringify(candidate.candidateSource)]);
      });
      await prepareDraft(capacitySourcePublicationInput(preview),{expectedRevision:preview.expected_revision,
        actor:{...actor,idempotencyKey:`capacity-preview:${preview.preview_id}`}});
      return capacitySourcePreviewSummary(preview);
    },
    async confirmCapacitySource({manager,operationId,previewId}) {
      const actor=requireManager(manager),operation=requireUuid(operationId,"capacity_source_operation_required"),
        preview=requireUuid(previewId,"capacity_source_preview_required");
      return transaction(async client=>{
        await lockStaticWeeklyAuthority(client);
        const prepared=await call(client,"static_weekly_capacity_source_begin",[actor.managerId,operation,preview]);
        if(prepared?.replayed===true)return {...prepared.receipt,replayed:true};
        const draft=await prepareInsideTransaction(client,()=>prepareDraft(capacitySourcePublicationInput(prepared),{
          expectedRevision:prepared.expected_revision,actor:{...actor,idempotencyKey:`capacity-source:${operation}:draft`},
        }));
        const created=await call(client,"static_weekly_v3_create_draft",[draft.effectiveStart,draft.objectiveVersion,
          draft.objective,draft.inputProvenance,draft.document,draft.expectedRevision,actor.managerId,draft.idempotencyKey,prepared.source_id]);
        const publication=await call(client,"static_weekly_v3_publish_draft",[created.data.version_id,1,created.revision,
          actor.managerId,`capacity-source:${operation}:publish`,"supersede",null]);
        const publicationId=requirePublicationId(publication.data.publication_id);
        const projection=await materializeCurrentProjection(client,{actor,publicationId,weekStart:prepared.effective_start,
          expectedRevision:publication.revision,idempotencyKey:`capacity-source:${operation}:projection:${prepared.effective_start}`});
        return call(client,"static_weekly_capacity_source_finalize",[actor.managerId,operation,publicationId,projection.data.projection_id]);
      });
    },
    async getCapacitySourceStatus({manager,operationId}) {
      const actor=requireManager(manager);
      return transaction(client=>call(client,"static_weekly_capacity_source_status",[
        actor.managerId,requireUuid(operationId,"capacity_source_operation_required"),
      ]));
    },
    async previewPlaceRepublish({ manager, sourcePublicationId, effectiveStart, expectedRevision, selection, reason }) {
      const actor = requireManager(manager);
      const date = requireMonday(effectiveStart, "effective start");
      const preview = await transaction(client => call(client, "custodial_place_operational_preview", [
        actor.managerId, requirePublicationId(sourcePublicationId), date, requireRevision(expectedRevision),
        JSON.stringify(selection), text(reason),
      ]));
      // The selected source is server-derived, never an HTTP compiler document.
      // Preparation does not reserve/publish or run recurring staffing repair.
      await prepareDraft(placePublicationInput(preview), {expectedRevision: preview.expected_revision,
        actor:{...actor,idempotencyKey:`place-preview:${preview.preview_id}`}});
      return {...placePublicationSummary(preview), expires_at:preview.expires_at, compiler_verified:true};
    },
    async confirmPlaceRepublish({ manager, operationId, previewId }) {
      const actor = requireManager(manager);
      const operation = requireUuid(operationId, "place_operation_id_required");
      const preview = requireUuid(previewId, "place_preview_id_required");
      return transaction(async client => {
        await lockStaticWeeklyAuthority(client);
        const prepared = await call(client, "custodial_place_operational_begin", [actor.managerId, operation, preview]);
        // Complete original receipt wins before mutable expiry/source checks.
        if (prepared?.replayed === true) return {...prepared.receipt,replayed:true};
        const draft = await prepareInsideTransaction(client, () => prepareDraft(placePublicationInput(prepared), {
          expectedRevision: prepared.expected_revision, actor:{...actor,idempotencyKey:`place:${operation}:draft`},
        }));
        const created = await call(client, "static_weekly_v3_create_draft", [draft.effectiveStart,draft.objectiveVersion,
          draft.objective,draft.inputProvenance,draft.document,draft.expectedRevision,actor.managerId,draft.idempotencyKey,prepared.source_id]);
        const publication = await call(client, "static_weekly_v3_publish_draft", [created.data.version_id,1,
          created.revision,actor.managerId,`place:${operation}:publish`,"supersede",null]);
        const publicationId = requirePublicationId(publication.data.publication_id);
        const projection = await materializeCurrentProjection(client, {actor,publicationId,weekStart:prepared.effective_start,
          expectedRevision:publication.revision,idempotencyKey:`place:${operation}:projection:${prepared.effective_start}`});
        return call(client,"custodial_place_operational_finalize",[actor.managerId,operation,publicationId,projection.data.projection_id]);
      });
    },
    async getPlaceRepublishStatus({ manager, operationId }) {
      const actor = requireManager(manager);
      return transaction(client => call(client,"custodial_place_operational_status",[
        actor.managerId,requireUuid(operationId,"place_operation_id_required"),
      ]));
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
    async applyException({manager,exceptionType,serviceDate,startsAt=null,endsAt=null,baseVersionId,publicationId,
      reason,payload,expectedRevision,idempotencyKey,projectionWeekStart,reversesExceptionId=null,signal=null,deadlineAt=null}) {
      requireManager(manager,"manage_absences");
      return this.applyDayChanges({manager,serviceDate,baseVersionId,publicationId,expectedRevision,idempotencyKey,
        projectionWeekStart,signal,deadlineAt,operations:[{operation:"exception",exceptionType,startsAt,endsAt,reason,payload,reversesExceptionId}]});
    },
    async applyContractorCapacity({ manager, serviceDate, baseVersionId, publicationId, slotId, shift, lunch, breakChoice, reason, expectedRevision, idempotencyKey, projectionWeekStart,signal=null,deadlineAt=null }) {
      requireManager(manager,"manage_coverall");
      const actualShift=requireWindow(shift,"actual contractor shift");
      if (breakChoice === 'NONE') {
        if (lunch != null) throw fail('static_weekly_contractor_break_choice_invalid', 'No-break cannot also contain a lunch window.');
        return this.applyDayChanges({manager,serviceDate,baseVersionId,publicationId,expectedRevision,idempotencyKey,projectionWeekStart,signal,deadlineAt,
          operations:[{operation:'cover_all',slotId,shift:actualShift,breakChoice:'NONE',reason}]});
      }
      if (breakChoice != null && breakChoice !== 'SCHEDULED') throw fail('static_weekly_contractor_break_choice_invalid');
      const actualLunch=requireWindow(lunch,"actual contractor lunch");
      const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
      if(actualLunch.start<actualShift.start||actualLunch.end>actualShift.end){
        throw fail("static_weekly_contractor_actual_lunch_required","Enter the actual CoverAll lunch start and end within its shift; no lunch time is assumed.");
      }
      // Reuse the accepted complete-action receipt and one transaction for both
      // dated facts. A retry must bind lunch as well as capacity and shift.
      return this.applyDayChanges({manager,serviceDate,baseVersionId,publicationId,expectedRevision,idempotencyKey,projectionWeekStart,signal,deadlineAt,operations:[
        {operation:"cover_all",slotId,shift:actualShift,reason},
        {operation:"exception",exceptionType:"lunch",startsAt:actualLunch.start,endsAt:actualLunch.end,payload:{slotId},reason:"Manager recorded actual CoverAll lunch"},
      ]});
    },
    async applyDayChanges({ manager, serviceDate, baseVersionId, publicationId, versionId = null, operations, expectedRevision, idempotencyKey, projectionWeekStart, signal=null, deadlineAt=null }) {
      const actor = requireManager(manager,"manage_absences");
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
        await authorizeAbsenceOperations(client,manager,date,effectivePublicationId,requestedOperations);
        const batch = await call(client, "static_weekly_v4_begin_day_changes", [date, weekStart, effectiveVersionId, effectivePublicationId, JSON.stringify(requestedOperations), initialRevision, actor.managerId, key]);
        if (batch?.replayed === true) return batch.response;
        // Resolve and validate every operation before invoking the first writer;
        // a malformed CoverAll entry therefore cannot leave a call-out prefix.
        const source = requireBatchPublicationSource(await sourceFor(client, effectivePublicationId, date), effectivePublicationId, effectiveVersionId);
        const commands = requestedOperations.map((operation, index) => operation.operation === "cover_all"
          ? { ...operation, payload: { availability: contractorAvailabilityFromSource(source, operation.slotId, date, operation.shift, operation.breakChoice) }, idempotencyKey: dayChangeOperationIdempotencyKey(key, index) }
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
          idempotencyKey: projectionIdempotencyKey(key),signal,deadlineAt,
        });
        await authorizeAbsenceOperations(client,manager,date,effectivePublicationId,requestedOperations);
        return {
          ...projection,
          operation: "apply_day_changes",
          data: {
            ...projection.data,
            mutations,
          },
        };
      }, { reconcileManagerId: actor.managerId, signal, deadlineAt });
    },
    async markEmployeeDeparted({ manager, slotId, reason, expectedRevision, idempotencyKey, projectionWeekStart }) {
      const actor = requireManager(manager); const weekStart = requireMonday(projectionWeekStart, "projection week start"); const key = requireIdempotencyKey(idempotencyKey);
      return transaction((client) => mutateAndMaterializeCurrentProjection(client, {
        actor,
        weekStart,
        idempotencyKey: key,
        publicationId: async () => requirePublicationId((await snapshotFor(client, weekStart))?.current_publication?.publication_id),
        mutate: () => call(client, "static_weekly_v4_mark_employee_departed", [text(slotId), text(reason), requireRevision(expectedRevision), actor.managerId, key]),
      }), { reconcileManagerId: actor.managerId });
    },
    async replaceEmployee({ manager, slotId, newEmployeeName, reason, expectedRevision, idempotencyKey, projectionWeekStart }) {
      const actor = requireManager(manager); const weekStart = requireMonday(projectionWeekStart, "projection week start"); const key = requireIdempotencyKey(idempotencyKey);
      return transaction((client) => mutateAndMaterializeCurrentProjection(client, {
        actor,
        weekStart,
        idempotencyKey: key,
        publicationId: async () => requirePublicationId((await snapshotFor(client, weekStart))?.current_publication?.publication_id),
        mutate: () => call(client, "static_weekly_v4_replace_employee", [text(slotId), text(newEmployeeName), text(reason), requireRevision(expectedRevision), actor.managerId, key]),
      }), { reconcileManagerId: actor.managerId });
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
      }), { reconcileManagerId: actor.managerId });
    },
    async previewVacancyRosterSlot(input) {
      requireManager(input.manager);
      return transaction(async client => {
        const prepared = await prepareVacancyOnCurrentTransaction(client, input);
        return { ...prepared.preview, preview_retained: true, published: false };
      }, { signal: input.signal ?? null, deadlineAt: input.deadlineAt ?? null });
    },
    async vacateRosterSlot(input) {
      const actor = requireManager(input.manager), digest = text(input.previewDigest);
      if (!/^[a-f0-9]{64}$/.test(digest)) throw fail("static_weekly_vacancy_reviewed_preview_required");
      return transaction(async client => {
        const prepared = await prepareVacancyOnCurrentTransaction(client, input, digest);
        const projection = await materializeCurrentProjection(client, {
          actor: prepared.actor, publicationId: prepared.publicationId, weekStart: prepared.weekStart,
          expectedRevision: prepared.mutation.revision, idempotencyKey: projectionIdempotencyKey(prepared.key),
          preparedProjection: prepared.projection,
        });
        const consumed = await call(client, "static_weekly_consume_vacancy_reviewed_preparation",
          [...prepared.auth, digest, prepared.actualPostInputUtf8]);
        if (consumed?.found !== true || consumed.state !== "CONSUMED" || consumed.preview_digest !== digest
          || consumed.worker_candidate_digest !== prepared.preview.workerCandidateDigest
          || consumed.packet_utf8 !== prepared.packetUtf8
          || consumed.payload_sha256 !== createHash("sha256").update(prepared.packetUtf8, "utf8").digest("hex")) {
          throw fail("static_weekly_vacancy_reviewed_preparation_unconfirmed",
            "The original preparation was not confirmed with its exact accepted receipt.");
        }
        return { ...projection, data: { ...prepared.mutation.data, ...projection.data,
          mutation: prepared.mutation.data, vacancy_preview: prepared.preview } };
      }, { reconcileManagerId: actor.managerId, signal: input.signal ?? null, deadlineAt: input.deadlineAt ?? null });
    },
    async readSeparation({ manager, slotId }) {
      const actor = requireManager(manager);
      return transaction((client) => call(client, "custodial_v12_read_separation", [
        text(slotId), actor.managerId,
      ]));
    },
    async readOriginalStaffingOutcome({ manager, operation, idempotencyKey }) {
      const actor = requireManager(manager), key = requireIdempotencyKey(idempotencyKey);
      if (!["vacate_roster_slot","fill_vacant_slot","restore_existing_employee"].includes(operation))
        throw fail("static_weekly_staffing_operation_invalid");
      return transaction(client => call(client, "static_weekly_read_original_staffing_outcome_v1",
        [actor.managerId, key, operation]));
    },
    async getRosterSourceDetails({ manager, sourceId, effectiveStart, expectedRevision }) {
      const actor = requireManager(manager), id = requireSourceId(sourceId);
      const date = requireDate(effectiveStart,"staffing effective start"), week = mondayForDate(date);
      const revision = requireRevision(expectedRevision);
      return transaction(async client => {
        await lockStaticWeeklyAuthority(client);
        const snapshot = await snapshotFor(client,week);
        if (snapshot?.authority_revision !== revision) throw fail("static_weekly_staffing_source_revision_changed");
        if (!Array.isArray(snapshot.roster)) throw fail("static_weekly_staffing_roster_unavailable");
        const registered = await registeredSourceFor(client,id,week);
        const original = await call(client,"static_weekly_v3_read_authority_source",[id]);
        if (registered?.source_id !== id || !registered.compiler_input?.version || !Array.isArray(registered.compiler_input.slots))
          throw fail("static_weekly_staffing_source_unavailable");
        if (original?.source_id !== id || !original.compiler_input || !Array.isArray(original.compiler_input.slots))
          throw fail("static_weekly_staffing_registered_source_unavailable");
        return {schema:"custodial.roster-source-details.v1",manager_id:actor.managerId,
          source_id:id,effective_start:date,week_start:week,authority_revision:revision,
          current_source_digest:postgresJsonbContentDigest(registered.compiler_input),
          registered_source_digest:postgresJsonbContentDigest(original.compiler_input),
          registered_compiler_input:clone(original.compiler_input),
          compiler_input:clone(registered.compiler_input),current_roster:clone(snapshot.roster),
          publication_id:snapshot.current_publication?.publication_id || null,
          phone_released:false};
      });
    },
    async createVacantRosterSlot({ manager, slotId, slotLabel, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager); const key = requireIdempotencyKey(idempotencyKey);
      return transaction((client) => call(client, "static_weekly_v7_create_vacant_roster_slot", [
        text(slotId), text(slotLabel), requireRevision(expectedRevision), actor.managerId, key,
      ]), { reconcileManagerId: actor.managerId });
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
      }), { reconcileManagerId: actor.managerId });
    },
    async materializeProjection({ manager, publicationId, serviceDate, expectedRevision, idempotencyKey, signal=null, deadlineAt=null }) {
      const actor = requireManager(manager,"regenerate_routes"); const weekStart = requireMonday(serviceDate, "projection start"); const effectivePublicationId = requirePublicationId(publicationId); const revision = requireRevision(expectedRevision); const key = requireIdempotencyKey(idempotencyKey);
      return transaction(async (client) => {
        await lockStaticWeeklyAuthority(client);
        await client.query("select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))", ["memphis-static-weekly-authority"]);
        await authorizeRouteRegeneration(client,manager,weekStart,effectivePublicationId);
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
        const result=await materializeCurrentProjection(client, { actor, publicationId: effectivePublicationId, weekStart, expectedRevision: revision, idempotencyKey: key,signal,deadlineAt });
        await authorizeRouteRegeneration(client,manager,weekStart,effectivePublicationId);
        return result;
      }, {signal,deadlineAt,reconcileManagerId:actor.managerId});
    },
    async rebuildCurrentProjection({ manager, weekStart, expectedRevision, idempotencyKey, signal=null, deadlineAt=null }) {
      const actor = requireManager(manager,"regenerate_routes"); const projectionWeekStart = requireMonday(weekStart, "projection week start"); const key = requireIdempotencyKey(idempotencyKey);
      return transaction(async (client) => {
        await lockStaticWeeklyAuthority(client);
        const snapshot = await snapshotFor(client, projectionWeekStart);
        const effectivePublicationId=requirePublicationId(snapshot?.current_publication?.publication_id);
        await authorizeRouteRegeneration(client,manager,projectionWeekStart,effectivePublicationId);
        const result=await materializeCurrentProjection(client, {
          actor,
          publicationId: requirePublicationId(snapshot?.current_publication?.publication_id),
          weekStart: projectionWeekStart,
          expectedRevision: requireRevision(expectedRevision),
          idempotencyKey: projectionIdempotencyKey(key),signal,deadlineAt,
        });
        await authorizeRouteRegeneration(client,manager,projectionWeekStart,effectivePublicationId);
        return result;
      }, {signal,deadlineAt,reconcileManagerId:actor.managerId});
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
import {approvedManualManagerView} from './approved-manual-manager-view.js';
