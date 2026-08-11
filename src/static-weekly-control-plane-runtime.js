import "dotenv/config";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseTrustedDeviceStore, makeOpsAccessMiddleware } from "./auth/shared-access-auth.js";
import { createStaticWeeklyControlPlane, createStaticWeeklyControlPlaneDatabase } from "./static-weekly-control-plane.js";

const port = Number(process.env.STATIC_WEEKLY_CONTROL_PLANE_PORT || process.env.PORT || 3100);
const database = createStaticWeeklyControlPlaneDatabase();
const controlPlane = createStaticWeeklyControlPlane({ database });
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "128kb" }));

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const trustedStore = createSupabaseTrustedDeviceStore(supabase);
const requireManagerWrite = makeOpsAccessMiddleware({ requireWrite: true, trustedDeviceStore: trustedStore, supabase });

function namedManager(req, res, next) {
  const session = req.memphisAuth;
  if (!session?.trusted_device || !session.manager_id || !session.manager_display_name || session.read_only || session.auth_mode !== "trusted_device") {
    res.status(403).json({ ok: false, error: "A trusted write-enabled named manager session is required." });
    return;
  }
  next();
}

function manager(req) { return req.memphisAuth; }
function respond(operation) {
  return async (req, res) => {
    try { res.status(200).json({ ok: true, data: await operation(req) }); }
    catch (error) { res.status(error?.code === "static_weekly_control_plane_compiler_rejected" ? 422 : 409).json({ ok: false, error: error?.message || "Static weekly control-plane request failed.", code: error?.code || "static_weekly_control_plane_failed" }); }
  };
}

app.get("/health", respond(async () => controlPlane.health()));
app.post("/static-weekly/drafts/initial", requireManagerWrite, namedManager, respond((req) => controlPlane.createInitialDraft({ manager: manager(req), sourceId: req.body?.source_id, effectiveStart: req.body?.effective_start, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));
app.post("/static-weekly/drafts/replacement", requireManagerWrite, namedManager, respond((req) => controlPlane.createReplacementDraft({ manager: manager(req), sourcePublicationId: req.body?.source_publication_id, effectiveStart: req.body?.effective_start, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));
app.post("/static-weekly/drafts/:versionId/publish", requireManagerWrite, namedManager, respond((req) => controlPlane.publishDraft({ manager: manager(req), draftVersionId: req.params.versionId, expectedDraftRevision: req.body?.expected_draft_revision, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, publicationKind: req.body?.publication_kind || "publish", rollbackOfVersionId: req.body?.rollback_of_version_id || null })));
app.post("/static-weekly/exceptions", requireManagerWrite, namedManager, respond((req) => controlPlane.applyException({ manager: manager(req), exceptionType: req.body?.exception_type, serviceDate: req.body?.service_date, startsAt: req.body?.starts_at || null, endsAt: req.body?.ends_at || null, baseVersionId: req.body?.base_version_id, publicationId: req.body?.publication_id, reason: req.body?.reason, payload: req.body?.payload, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, reversesExceptionId: req.body?.reverses_exception_id || null })));
app.post("/static-weekly/incumbencies", requireManagerWrite, namedManager, respond((req) => controlPlane.replaceIncumbency({ manager: manager(req), slotId: req.body?.slot_id, personId: req.body?.person_id, personName: req.body?.person_name, effectiveStart: req.body?.effective_start, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));
app.post("/static-weekly/projections", requireManagerWrite, namedManager, respond((req) => controlPlane.materializeProjection({ manager: manager(req), publicationId: req.body?.publication_id, serviceDate: req.body?.service_date, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));

const server = app.listen(port, () => console.log(`Static weekly control plane listening on ${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => controlPlane.close().finally(() => process.exit(0))));
