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
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { compileStaticWeeklySchedule } from "./static-weekly-schedule-compiler.js";
import { createStaticWeeklyDraftRpcInput, createStaticWeeklyProjectionRpcInput } from "./static-weekly-schedule-database-adapter.js";

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

function requireRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw fail("static_weekly_control_plane_expected_revision_required");
  return value;
}

function requireIdempotencyKey(value) {
  const key = text(value);
  if (!key || key.length > 200) throw fail("static_weekly_control_plane_idempotency_required");
  return key;
}

function requireSourceId(value) {
  const sourceId = text(value);
  if (!sourceId) throw fail("static_weekly_control_plane_source_required");
  return sourceId;
}

function requireWindow(value, label) {
  const start = text(value?.start);
  const end = text(value?.end);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || start >= end) {
    throw fail("static_weekly_control_plane_invalid_window", `${label} must be one ordered HH:MM window.`);
  }
  return { start, end };
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

export function createStaticWeeklyControlPlane({ database, compiler = compileStaticWeeklySchedule } = {}) {
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

  return {
    schema: STATIC_WEEKLY_CONTROL_PLANE_SCHEMA,
    async health() {
      return transaction((client) => call(client, "static_weekly_v3_authority_health", []));
    },
    async getManagerSnapshot({ manager, weekStart }) {
      requireManager(manager);
      return transaction((client) => call(client, "static_weekly_v3_read_manager_snapshot", [requireDate(weekStart, "week start")]));
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
    async publishDraft({ manager, draftVersionId, expectedDraftRevision, expectedRevision, idempotencyKey, publicationKind = "publish", rollbackOfVersionId = null }) {
      const actor = requireManager(manager);
      return transaction((client) => call(client, "static_weekly_v3_publish_draft", [text(draftVersionId), requireRevision(expectedDraftRevision), requireRevision(expectedRevision), actor.managerId, requireIdempotencyKey(idempotencyKey), text(publicationKind), rollbackOfVersionId || null]));
    },
    async applyException({ manager, exceptionType, serviceDate, startsAt = null, endsAt = null, baseVersionId, publicationId, reason, payload, expectedRevision, idempotencyKey, reversesExceptionId = null }) {
      const actor = requireManager(manager);
      return transaction((client) => call(client, "static_weekly_v3_apply_exception", [text(exceptionType), requireDate(serviceDate, "service date"), startsAt || null, endsAt || null, text(baseVersionId), text(publicationId), text(reason), payload, requireRevision(expectedRevision), actor.managerId, requireIdempotencyKey(idempotencyKey), reversesExceptionId || null]));
    },
    async applyContractorCapacity({ manager, serviceDate, baseVersionId, publicationId, slotId, shift, reason, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager); const date = requireDate(serviceDate, "service date");
      return transaction(async (client) => {
        const source = await sourceFor(client, text(publicationId), date);
        const availability = contractorAvailabilityFromSource(source, slotId, date, shift);
        return call(client, "static_weekly_v3_apply_exception", ["cover_all", date, null, null, text(baseVersionId), text(publicationId), text(reason), { availability }, requireRevision(expectedRevision), actor.managerId, requireIdempotencyKey(idempotencyKey), null]);
      });
    },
    async replaceIncumbency({ manager, slotId, personId, personName, effectiveStart, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager);
      return transaction((client) => call(client, "static_weekly_v3_replace_incumbency", [text(slotId), text(personId), text(personName), requireDate(effectiveStart, "incumbency effective start"), requireRevision(expectedRevision), actor.managerId, requireIdempotencyKey(idempotencyKey)]));
    },
    async markEmployeeDeparted({ manager, slotId, effectiveStart, reason, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager);
      return transaction((client) => call(client, "static_weekly_v4_mark_employee_departed", [text(slotId), requireDate(effectiveStart, "departure effective start"), text(reason), requireRevision(expectedRevision), actor.managerId, requireIdempotencyKey(idempotencyKey)]));
    },
    async replaceEmployee({ manager, slotId, newEmployeeName, effectiveStart, reason, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager);
      return transaction((client) => call(client, "static_weekly_v4_replace_employee", [text(slotId), text(newEmployeeName), requireDate(effectiveStart, "replacement effective start"), text(reason), requireRevision(expectedRevision), actor.managerId, requireIdempotencyKey(idempotencyKey)]));
    },
    async materializeProjection({ manager, publicationId, serviceDate, expectedRevision, idempotencyKey }) {
      const actor = requireManager(manager); const date = requireDate(serviceDate, "projection start");
      return transaction(async (client) => {
        const source = await sourceFor(client, text(publicationId), date);
        const result = await compileOrFail(compilerInputFromPublishedSource(source, date));
        const projection = createStaticWeeklyProjectionRpcInput({ result, publicationId: text(publicationId), expectedRevision: requireRevision(expectedRevision), actor: { ...actor, idempotencyKey: requireIdempotencyKey(idempotencyKey) } });
        return call(client, "static_weekly_v3_materialize_projection", [projection.publicationId, projection.serviceDate, projection.exceptionSetDigest, projection.compilerVersion, projection.objective, projection.metrics, projection.replayDigest, projection.envelope, projection.expectedRevision, actor.managerId, projection.idempotencyKey]);
      });
    },
    async close() {
      if (typeof database.end === "function") await database.end();
    },
  };
}
