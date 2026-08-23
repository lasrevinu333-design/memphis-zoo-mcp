import "dotenv/config";
import { pathToFileURL } from "node:url";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { assertOpsManagerSessionSecret, createSupabaseTrustedDeviceStore, makeOpsAccessMiddleware } from "./auth/shared-access-auth.js";
import { createStaticWeeklyControlPlane, createStaticWeeklyControlPlaneDatabase } from "./static-weekly-control-plane.js";
import { assertConfiguredReleaseIdentity } from "./release-manifest.js";

const text = (value) => typeof value === "string" ? value.trim() : "";
const fail = (code, message = code) => Object.assign(new Error(message), { code });

function requireTrustedDeviceConfiguration(env) {
  const url = text(env?.SUPABASE_URL);
  const key = text(env?.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw fail("static_weekly_control_plane_trusted_device_configuration_required", "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for trusted-device scheduler authentication.");
  assertOpsManagerSessionSecret(env);
  return { url, key };
}

function allowedOrigins(env) {
  return new Set([
    "https://lasrevinu333-design.github.io",
    "https://localhost",
    "capacitor://localhost",
    ...text(env?.STATIC_WEEKLY_CONTROL_PLANE_ALLOWED_ORIGINS || env?.ALLOWED_CORS_ORIGINS).split(",").map((value) => value.trim()).filter(Boolean),
  ]);
}

function setCors(req, res, env) {
  const origin = text(req.headers?.origin);
  if (origin && allowedOrigins(env).has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Id");
  res.setHeader("Vary", "Origin");
}

export function createStaticWeeklyControlPlaneRuntime({
  env = process.env,
  database = null,
  controlPlane = null,
  supabase = null,
  trustedDeviceStore = null,
  createDatabase = createStaticWeeklyControlPlaneDatabase,
  createControlPlane = createStaticWeeklyControlPlane,
  createSupabaseClient = createClient,
} = {}) {
  const releaseIdentity = assertConfiguredReleaseIdentity();
  const { url, key } = requireTrustedDeviceConfiguration(env);
  const trustedSupabase = supabase || createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const trustedStore = trustedDeviceStore || createSupabaseTrustedDeviceStore(trustedSupabase);
  if (!trustedStore || typeof trustedStore.find !== "function") {
    throw fail("static_weekly_control_plane_trusted_device_store_required", "The scheduler control plane requires a trusted-device revocation and association store.");
  }
  const authorityDatabase = database || createDatabase({
    connectionString: env?.STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL,
    caPem: env?.STATIC_WEEKLY_CONTROL_PLANE_DATABASE_CA_PEM,
  });
  const authorityControlPlane = controlPlane || createControlPlane({ database: authorityDatabase });
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    setCors(req, res, env);
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });
  app.use(express.json({ limit: "128kb" }));

  const requireManagerWrite = makeOpsAccessMiddleware({
    env,
    requireWrite: true,
    trustedDeviceStore: trustedStore,
    supabase: trustedSupabase,
    requireTrustedDeviceStore: true,
    requireCurrentManagerAssociation: true,
  });

  function namedManager(req, res, next) {
    const session = req.memphisAuth;
    if (!session?.trusted_device || !session.manager_id || !session.manager_display_name || session.read_only || session.auth_mode !== "trusted_device") {
      res.status(403).json({ ok: false, error: "A trusted write-enabled named manager session is required." });
      return;
    }
    next();
  }

  function manager(req) { return req.memphisAuth; }
  function releaseIdentityPayload() {
    return releaseIdentity ? {
      release_id: releaseIdentity.release_id,
      backend_commit_sha: releaseIdentity.backend_commit_sha,
      backend_tree_sha: releaseIdentity.backend_tree_sha,
      frontend_commit_sha: releaseIdentity.frontend_commit_sha,
      schema_fingerprint: releaseIdentity.schema_fingerprint,
    } : null;
  }
  function respond(operation) {
    return async (req, res) => {
      try { res.status(200).json({ ok: true, data: await operation(req) }); }
      catch (error) { res.status(error?.code === "static_weekly_control_plane_compiler_rejected" ? 422 : 409).json({ ok: false, error: error?.message || "Static weekly control-plane request failed.", code: error?.code || "static_weekly_control_plane_failed" }); }
    };
  }

  async function readiness(_req, res) {
    try {
      const data = await authorityControlPlane.health();
      const ready = data?.ready === true;
      res.status(ready ? 200 : 503).json({
        ok: ready,
        data,
        release_identity: releaseIdentityPayload(),
        ...(ready ? {} : { error: "The static weekly scheduler authority is not ready.", code: "static_weekly_control_plane_not_ready" }),
      });
    } catch (_error) {
      res.status(503).json({
        ok: false,
        data: { ready: false },
        error: "The static weekly scheduler authority is unavailable.",
        code: "static_weekly_control_plane_unavailable",
      });
    }
  }

  async function liveness(_req, res) {
    try {
      const data = await authorityControlPlane.health();
      res.status(200).json({
        ok: true,
        data: {
          process_ready: true,
          database_reachable: true,
          authority_ready: data?.ready === true,
        },
        release_identity: releaseIdentityPayload(),
      });
    } catch (_error) {
      res.status(503).json({
        ok: false,
        data: { process_ready: true, database_reachable: false, authority_ready: false },
        error: "The static weekly scheduler database is unavailable.",
        code: "static_weekly_control_plane_liveness_unavailable",
      });
    }
  }

  app.get("/healthz", liveness);
  app.get(["/health", "/ready"], readiness);
  app.get("/static-weekly/manager-snapshot", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.getManagerSnapshot({ manager: manager(req), weekStart: req.query?.week_start })));
  app.post("/static-weekly/drafts/initial", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.createInitialDraft({ manager: manager(req), sourceId: req.body?.source_id, effectiveStart: req.body?.effective_start, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));
  app.post("/static-weekly/drafts/replacement", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.createReplacementDraft({ manager: manager(req), sourcePublicationId: req.body?.source_publication_id, effectiveStart: req.body?.effective_start, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));
  app.post("/static-weekly/drafts/:versionId/publish", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.publishDraft({ manager: manager(req), draftVersionId: req.params.versionId, expectedDraftRevision: req.body?.expected_draft_revision, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, projectionWeekStart: req.body?.week_start, publicationKind: req.body?.publication_kind || "publish", rollbackOfVersionId: req.body?.rollback_of_version_id || null })));
  app.post("/static-weekly/exceptions", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.applyException({ manager: manager(req), exceptionType: req.body?.exception_type, serviceDate: req.body?.service_date, startsAt: req.body?.starts_at || null, endsAt: req.body?.ends_at || null, baseVersionId: req.body?.base_version_id, publicationId: req.body?.publication_id, reason: req.body?.reason, payload: req.body?.payload, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, projectionWeekStart: req.body?.week_start, reversesExceptionId: req.body?.reverses_exception_id || null })));
  app.post("/static-weekly/contractor-capacity", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.applyContractorCapacity({ manager: manager(req), serviceDate: req.body?.service_date, baseVersionId: req.body?.base_version_id, publicationId: req.body?.publication_id, slotId: req.body?.slot_id, shift: req.body?.shift, reason: req.body?.reason, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, projectionWeekStart: req.body?.week_start })));
  app.post("/static-weekly/day-changes/batch", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.applyDayChanges({ manager: manager(req), serviceDate: req.body?.service_date, baseVersionId: req.body?.base_version_id, publicationId: req.body?.publication_id, versionId: req.body?.version_id || req.body?.base_version_id, operations: req.body?.operations, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, projectionWeekStart: req.body?.week_start })));
  app.post("/static-weekly/employees/departed", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.markEmployeeDeparted({ manager: manager(req), slotId: req.body?.slot_id, reason: req.body?.reason, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, projectionWeekStart: req.body?.week_start })));
  app.post("/static-weekly/employees/replacements", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.replaceEmployee({ manager: manager(req), slotId: req.body?.slot_id, newEmployeeName: req.body?.new_employee_name, reason: req.body?.reason, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, projectionWeekStart: req.body?.week_start })));
  app.post("/static-weekly/projections", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.materializeProjection({ manager: manager(req), publicationId: req.body?.publication_id, serviceDate: req.body?.service_date, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));
  app.post("/static-weekly/rebuild-current-projection", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.rebuildCurrentProjection({ manager: manager(req), weekStart: req.body?.week_start, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));

  return { app, controlPlane: authorityControlPlane, database: authorityDatabase, trustedDeviceStore: trustedStore, releaseIdentity };
}

export function startStaticWeeklyControlPlaneRuntime(options = {}) {
  const env = options.env || process.env;
  const port = Number(env.STATIC_WEEKLY_CONTROL_PLANE_PORT || env.PORT || 3100);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw fail("static_weekly_control_plane_port_invalid", "The scheduler control-plane port must be an integer from 0 through 65535.");
  const runtime = createStaticWeeklyControlPlaneRuntime({ ...options, env });

  const processTarget = options.processTarget || process;
  const logger = options.logger || console;
  const server = runtime.app.listen(port, () => logger.log(`Static weekly control plane listening on ${server.address()?.port || port}`));
  let shutdownPromise = null;

  const removeSignalHandlers = () => {
    processTarget.removeListener("SIGINT", onSignal);
    processTarget.removeListener("SIGTERM", onSignal);
  };
  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    // Stop admission immediately, then close the control plane concurrently
    // with HTTP draining. Closing the compiler rejects an active compile so
    // its transaction can roll back inside Render's 30-second shutdown window.
    const serverDrain = !server.listening ? Promise.resolve() : new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    const controlPlaneClose = Promise.resolve().then(() => runtime.controlPlane.close());
    shutdownPromise = Promise.allSettled([serverDrain, controlPlaneClose]).then((results) => {
      const failed = results.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
    }).finally(removeSignalHandlers);
    return shutdownPromise;
  };
  const onSignal = () => {
    shutdown().catch((error) => {
      processTarget.exitCode = 1;
      logger.error("Static weekly control-plane shutdown failed.", error);
    });
  };

  processTarget.once("SIGINT", onSignal);
  processTarget.once("SIGTERM", onSignal);
  return { ...runtime, server, shutdown };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startStaticWeeklyControlPlaneRuntime();
