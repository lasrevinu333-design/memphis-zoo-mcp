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
import { Pool } from "pg";
import { compileStaticWeeklySchedule } from "./static-weekly-schedule-compiler.js";
import { createStaticWeeklyDraftRpcInput, createStaticWeeklyProjectionRpcInput } from "./static-weekly-schedule-database-adapter.js";
import { getStaticWeeklySolverReadiness, initializeStaticWeeklySolver } from "./static-weekly-schedule-solver.js";

export const STATIC_WEEKLY_CONTROL_PLANE_SCHEMA = "memphis-zoo.static-weekly-control-plane.v1";

const text = (value) => typeof value === "string" ? value.trim() : "";
const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (code, message = code) => Object.assign(new Error(message), { code });

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
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || start >= end) {
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

function replacementDraftInput(source, effectiveStart) {
  const raw = source?.compiler_input;
  const input = compilerInputFromPublishedSource({ compiler_input: raw, exceptions: [] }, effectiveStart);
  input.versions[0] = {
    ...input.versions[0],
    id: randomUUID(),
    publicationId: randomUUID(),
    status: "published",
    effectiveStart,
    effectiveEnd: null,
  };
  return input;
}

export function createStaticWeeklyControlPlaneDatabase({ connectionString = process.env.STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL, pool = null } = {}) {
  if (pool) return pool;
  if (!text(connectionString)) throw fail("static_weekly_control_plane_database_url_required");
  return new Pool({ connectionString, max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000, application_name: "memphis-static-weekly-control-plane" });
}

export function createStaticWeeklyControlPlane({
  database,
  compiler = compileStaticWeeklySchedule,
  initializeSolver = initializeStaticWeeklySolver,
  getSolverReadiness = getStaticWeeklySolverReadiness,
} = {}) {
  if (!database?.connect) throw fail("static_weekly_control_plane_database_required");

  async function transaction(work) {
    const client = await database.connect();
    try {
      await client.query("begin");
      // The login identity is provisioned separately and granted this NOLOGIN
      // capability group. Ordinary service-role credentials lack membership.
      await client.query("set local role static_weekly_control_plane");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function call(client, functionName, args) {
    const values = Array.isArray(args) ? args : [];
    const placeholders = values.map((_, index) => `$${index + 1}`).join(",");
    const { rows } = await client.query(`select public.${functionName}(${placeholders}) as result`, values);
    return rows[0]?.result;
  }

  async function sourceFor(client, publicationId, serviceDate) {
    return call(client, "static_weekly_v3_read_publication_source", [publicationId, serviceDate]);
  }

  async function snapshotFor(client, weekStart) {
    return call(client, "static_weekly_v3_read_manager_snapshot", [weekStart]);
  }

  async function registeredSourceFor(client, sourceId) {
    return call(client, "static_weekly_v3_read_authority_source", [requireSourceId(sourceId)]);
  }

  async function compileOrFail(input) {
    const result = await compiler(input);
    if (result?.status !== "FEASIBLE" || result?.publicationAuthority !== "ACCEPTABLE" || result?.verifier?.ok !== true) {
      throw fail("static_weekly_control_plane_compiler_rejected", "Canonical source did not produce a publishable verified schedule.");
    }
    return result;
  }

  async function materializeCurrentProjection(client, { actor, publicationId, weekStart, expectedRevision, idempotencyKey }) {
    const source = await sourceFor(client, requirePublicationId(publicationId), weekStart);
    const result = await compileOrFail(compilerInputFromPublishedSource(source, weekStart));
    const projection = createStaticWeeklyProjectionRpcInput({
      result,
      publicationId: requirePublicationId(publicationId),
      expectedRevision: requireRevision(expectedRevision),
      actor: { ...actor, idempotencyKey: requireIdempotencyKey(idempotencyKey) },
    });
    const materialized = await call(client, "static_weekly_v3_materialize_projection", [projection.publicationId, projection.serviceDate, projection.exceptionSetDigest, projection.compilerVersion, projection.objective, projection.metrics, projection.replayDigest, projection.envelope, projection.expectedRevision, actor.managerId, projection.idempotencyKey]);
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

  return {
    schema: STATIC_WEEKLY_CONTROL_PLANE_SCHEMA,
    async health() {
      const authority = await transaction(async (client) => {
        const base = await call(client, "static_weekly_v3_authority_health", []);
        const dayChanges = await call(client, "static_weekly_v4_day_changes_health", []);
        return {
          ...base,
          day_changes: dayChanges,
          ready: base?.ready === true && dayChanges?.ready === true,
        };
      });
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
    },
    async getManagerSnapshot({ manager, weekStart }) {
      requireManager(manager);
      return transaction((client) => snapshotFor(client, requireMonday(weekStart, "week start")));
    },
    async createReplacementDraft({ manager, sourcePublicationId, effectiveStart, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager); const date = requireDate(effectiveStart, "effective start");
      return transaction(async (client) => {
        const source = await sourceFor(client, sourcePublicationId, date);
        const result = await compileOrFail(replacementDraftInput(source, date));
        const draft = createStaticWeeklyDraftRpcInput({ result, expectedRevision: requireRevision(expectedRevision), actor: { ...actor, idempotencyKey: requireIdempotencyKey(idempotencyKey) } });
        return call(client, "static_weekly_v3_create_draft", [draft.effectiveStart, draft.objectiveVersion, draft.objective, draft.inputProvenance, draft.document, draft.expectedRevision, actor.managerId, draft.idempotencyKey, requireSourceId(source.source_id)]);
      });
    },
    async createInitialDraft({ manager, sourceId, effectiveStart, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager); const date = requireDate(effectiveStart, "effective start");
      return transaction(async (client) => {
        const source = await registeredSourceFor(client, sourceId);
        const result = await compileOrFail(replacementDraftInput(source, date));
        const draft = createStaticWeeklyDraftRpcInput({ result, expectedRevision: requireRevision(expectedRevision), actor: { ...actor, idempotencyKey: requireIdempotencyKey(idempotencyKey) } });
        return call(client, "static_weekly_v3_create_draft", [draft.effectiveStart, draft.objectiveVersion, draft.objective, draft.inputProvenance, draft.document, draft.expectedRevision, actor.managerId, draft.idempotencyKey, requireSourceId(source.source_id)]);
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
    async applyContractorCapacity({ manager, serviceDate, baseVersionId, publicationId, slotId, shift, reason, expectedRevision, idempotencyKey, projectionWeekStart }) {
      const actor = requireManager(manager); const weekStart = projectionWeekForDate(projectionWeekStart, serviceDate); const date = requireDateInWeek(serviceDate, weekStart, "service date"); const key = requireIdempotencyKey(idempotencyKey); const effectivePublicationId = requirePublicationId(publicationId);
      return transaction(async (client) => {
        const source = await sourceFor(client, effectivePublicationId, date);
        const availability = contractorAvailabilityFromSource(source, slotId, date, shift);
        return mutateAndMaterializeCurrentProjection(client, {
          actor,
          publicationId: effectivePublicationId,
          weekStart,
          idempotencyKey: key,
          mutate: () => call(client, "static_weekly_v3_apply_exception", ["cover_all", date, null, null, text(baseVersionId), effectivePublicationId, text(reason), { availability }, requireRevision(expectedRevision), actor.managerId, key, null]),
        });
      });
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
        // PostgreSQL reauthorizes the current manager, acquires the global
        // authority transaction lock, and recognizes an already accepted
        // complete child/projection receipt chain before any mutable authority
        // is reread. The lock remains held for a fresh batch through commit.
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
    async materializeProjection({ manager, publicationId, serviceDate, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager); const weekStart = requireMonday(serviceDate, "projection start"); const effectivePublicationId = requirePublicationId(publicationId); const revision = requireRevision(expectedRevision); const key = requireIdempotencyKey(idempotencyKey);
      return transaction(async (client) => {
        const current = await snapshotFor(client, weekStart);
        if (current?.projection_status === "current" && text(current?.current_publication?.publication_id) === effectivePublicationId && text(current?.latest_projection?.week_start) === weekStart) {
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
      if (typeof database.end === "function") await database.end();
    },
  };
}
