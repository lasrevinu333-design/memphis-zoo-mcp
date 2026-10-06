import "dotenv/config";
import { pathToFileURL } from "node:url";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { assertOpsManagerSessionSecret, createSupabaseTrustedDeviceStore, makeOpsAccessMiddleware } from "./auth/shared-access-auth.js";
import { createStaticWeeklyControlPlane, createStaticWeeklyControlPlaneDatabase } from "./static-weekly-control-plane.js";
import { beginBoundedManagerRequest } from "./static-weekly-manager-operation.js";
import {approvedInitialRequest,APPROVED_INITIAL_REQUEST_ERROR} from "./static-weekly-approved-initial-request.js";
import {isMapDashboardSession} from "./auth/map-manager-identity.js";
import { createRecurringOperationRunner } from "./static-weekly-recurring-operation-runner.js";
import { runRecurringWithRestoreCustody } from "./static-weekly-recurring-operation-handler.js";
import { assertConfiguredReleaseIdentity } from "./release-manifest.js";
import { makeRestoreMutationGate } from "./restore-mutation-gate.js";
import { renderCoverAllPdfPair } from "./static-weekly-coverall-print.js";
import { createDatedTransitionManagerRouter } from "./static-weekly-dated-transition-manager-router.js";
import { createConfiguredOctoberDatedController } from "./static-weekly-dated-transition-postgres.js";
import {OPENING_COVERAGE_ERROR,sanitizeOpeningCoverageDiagnostic} from './static-weekly-opening-coverage-report.js';

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
  datedTransitionController = undefined,
  supabase = null,
  trustedDeviceStore = null,
  createDatabase = createStaticWeeklyControlPlaneDatabase,
  createControlPlane = createStaticWeeklyControlPlane,
  createSupabaseClient = createClient,
  managerOperationClock = null,
  recurringOperationRunner = createRecurringOperationRunner(),
  recurringOperationAdmission = null,
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
    allowInsecureLoopbackRehearsal: /^(1|true|yes)$/i.test(text(env?.STATIC_WEEKLY_CONTROL_PLANE_ALLOW_INSECURE_LOOPBACK_REHEARSAL)),
  });
  const authorityControlPlane = controlPlane || createControlPlane({ database: authorityDatabase });
  const boundedController=datedTransitionController===undefined&&typeof authorityDatabase?.connect==='function'
    ?createConfiguredOctoberDatedController(authorityDatabase):datedTransitionController;
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    setCors(req, res, env);
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });
  app.use((req,res,next)=>{beginBoundedManagerRequest(req,res,managerOperationClock||undefined);next();});
  app.use(express.json({ limit: "128kb" }));
  app.use((error,req,res,next)=>{
    // The first-origin timer may have already sent a typed 503 while an
    // incomplete body was still in express.json. Closing that one request
    // intentionally makes raw-body report request.aborted after the response.
    if (res.writableEnded && req.staticWeeklyManagerOperation?.signal.aborted
      && error?.type === 'request.aborted') return;
    next(error);
  });
  app.use(makeRestoreMutationGate({ supabase: trustedSupabase, required: true, serviceName: "memphis-zoo-static-weekly-control-plane" }));

  const requireManagerWrite = makeOpsAccessMiddleware({
    env,
    requireWrite: true,
    trustedDeviceStore: trustedStore,
    supabase: trustedSupabase,
    requireTrustedDeviceStore: true,
    requireCurrentManagerAssociation: true,
    operationSignalForRequest: req => req.staticWeeklyManagerOperation?.signal || null,
  });

  const requireManagerRead = makeOpsAccessMiddleware({
    env,requireWrite:false,trustedDeviceStore:trustedStore,supabase:trustedSupabase,
    requireTrustedDeviceStore:true,requireCurrentManagerAssociation:true,
    operationSignalForRequest:req=>req.staticWeeklyManagerOperation?.signal||null,
  });
  function namedReadManager(req,res,next) {
    const session=req.memphisAuth;
    const trustedDevice=session?.trusted_device&&session.auth_mode==="trusted_device";
    // The preceding read middleware has already verified the signed Map token
    // and its current protected registry mapping; it never grants write access.
    if((!trustedDevice&&!isMapDashboardSession(session))||!session.manager_id||!session.manager_display_name) {
      res.status(403).json({ok:false,error:"A current trusted named manager is required to read the schedule."});return;
    }
    next();
  }

  function namedManager(req, res, next) {
    const session = req.memphisAuth;
    if (!session?.trusted_device || !session.manager_id || !session.manager_display_name || session.read_only || session.auth_mode !== "trusted_device") {
      res.status(403).json({ ok: false, error: "A trusted write-enabled named manager session is required." });
      return;
    }
    next();
  }

  function manager(req) { return req.memphisAuth; }
  const runOwnedRecurring = (req, kind, body) => {
    const admission = recurringOperationAdmission || authorityControlPlane.runExternalRecurringOperation?.bind(authorityControlPlane);
    if (typeof admission !== "function") throw fail("static_weekly_control_plane_busy",
      "The shared recurring authority admission is unavailable; no child work was started.");
    return admission({ signal: req.restoreMutationLease.signal,
      deadlineAt: req.staticWeeklyManagerOperation.deadlineAt,
      // Static owner policy replaces optimizer reconstruction at this changed
      // recurring boundary. Catalog/source facts come only from the named
      // manager database connection, never supplied preview rows. A missing
      // approved pattern is an explicit refusal, not a full-solver fallback.
      action: () => {
        if(body.full_nine_source_id!=null)throw fail('static_template_legacy_source_selector_not_supported');
        const input={manager:manager(req),serviceDate:body.effective_start,
          expectedRevision:body.expected_revision,templateId:body.template_id??null,
          signal:req.restoreMutationLease.signal,deadlineAt:req.staticWeeklyManagerOperation.deadlineAt};
        if(kind==='preview')return authorityControlPlane.previewApprovedStaticPattern(input);
        return authorityControlPlane.confirmApprovedStaticPattern({...input,
          previewDigest:body.preview_digest,idempotencyKey:body.confirmation_key});
      },
    });
  };
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
      try {
        const data = await operation(req);
        // Only the explicitly bounded manager POSTs carry this context. Their
        // transaction has settled here; the exact restore lease must also be
        // confirmed released before any success bytes leave the server.
        if (req.staticWeeklyManagerOperation) {
          if (typeof req.restoreMutationLease?.settleBeforeSuccess !== 'function') {
            throw fail('static_weekly_recurring_mutation_lease_release_unknown',
              'The manager operation cannot confirm its exact restore lease release. Check the exact status before retrying.');
          }
          await req.restoreMutationLease.settleBeforeSuccess();
        }
        res.status(200).json({ ok: true, data });
      }
      catch (error) {
        let responseError = error;
        if (req.staticWeeklyManagerOperation
          && error?.code !== "static_weekly_recurring_operation_custody_unknown"
          && error?.code !== "static_weekly_recurring_mutation_lease_release_unknown") {
          // Even a failed private operation must not answer while a proved
          // group still has an unsettled exact lease-release attempt. The
          // original ingress signal bounds this wait; uncertainty remains 503.
          try { await req.restoreMutationLease.settleBeforeSuccess(); }
          catch (releaseError) { responseError = releaseError; }
        }
        const unavailable = new Set([
          "static_weekly_control_plane_database_unavailable",
          "static_weekly_control_plane_closing",
          "static_weekly_control_plane_busy",
          "static_weekly_control_plane_queue_timeout",
          "static_weekly_recurring_operation_deadline_exceeded",
          "static_weekly_recurring_operation_aborted",
          "static_weekly_recurring_confirmation_outcome_unknown",
          "static_weekly_recurring_mutation_lease_release_unknown",
          "static_weekly_recurring_operation_custody_unknown",
          "static_weekly_operation_source_invalid",
          "static_weekly_operation_deadline",
          "static_weekly_operation_outcome_unknown",
          "static_weekly_operation_failed",
          "static_weekly_operation_aborted",
          "static_weekly_operation_child_exited",
          "static_weekly_operation_reap_unproven",
          "static_weekly_compiler_request_aborted",
        ]).has(responseError?.code);
        const invalid = ["static_weekly_control_plane_compiler_rejected", "static_weekly_recurring_confirmation_request_invalid", "static_weekly_recurring_delivery_request_invalid",APPROVED_INITIAL_REQUEST_ERROR,OPENING_COVERAGE_ERROR].includes(responseError?.code);
        const diagnostic=responseError?.code===OPENING_COVERAGE_ERROR?sanitizeOpeningCoverageDiagnostic(responseError.openingCoverageDiagnostic):null;
        res.status(invalid ? 422 : unavailable ? 503 : 409).json({ ok: false, error: diagnostic
          ?'Opening planned coverage has inconsistent essential source facts. Nothing was admitted or published.'
          :responseError?.message || "Static weekly control-plane request failed.", code: responseError?.code || "static_weekly_control_plane_failed",
          ...(diagnostic?{openingCoverageDiagnostic:diagnostic}:{}) });
      }
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

  function liveness(_req, res) {
    // Render uses this path to decide whether to terminate the process. It must
    // prove only that the HTTP process can answer; database, solver, and
    // publication authority belong to /health and /ready. Awaiting the full
    // authority check here can make a healthy, atomic long-running compile
    // look dead and force Render to kill it before the transaction commits.
    res.status(200).json({
      ok: true,
      data: {
        process_ready: true,
        probe_scope: "process_liveness",
        database_reachable: null,
        authority_ready: null,
      },
      release_identity: releaseIdentityPayload(),
    });
  }

  app.get("/healthz", liveness);
  app.get(["/health", "/ready"], readiness);
  app.use("/static-weekly/dated-transition",createDatedTransitionManagerRouter({
    controller:boundedController,requireManagerWrite,namedManager,manager,
  }));
  app.get("/static-weekly/manager-snapshot", requireManagerRead, namedReadManager, respond((req) => authorityControlPlane.getManagerSnapshot({ manager: manager(req), weekStart: req.query?.week_start })));
  // Distinct fixed-pattern baseline: never fall back to the historical draft
  // optimizer. The same first-ingress deadline and restore-lease settlement
  // cover authentication, source reads, publication and response delivery.
  for (const [action,method] of [["preview","previewApprovedInitialBaseline"],["confirm","publishApprovedInitialBaseline"]]) {
    app.post(`/static-weekly/approved-initial/${action}`,requireManagerWrite,namedManager,respond(req=>{
      const input=approvedInitialRequest(req.body,{confirm:action==="confirm"});
      const operation=req.staticWeeklyManagerOperation;
      if(!operation||!req.restoreMutationLease?.signal||typeof authorityControlPlane[method]!=="function")
        throw fail("static_weekly_control_plane_database_unavailable","Approved initial schedule service is unavailable.");
      return authorityControlPlane[method]({...input,manager:manager(req),signal:req.restoreMutationLease.signal,deadlineAt:operation.deadlineAt});
    }));
  }
  app.post("/static-weekly/recurring-adaptation/preview", requireManagerWrite, namedManager, respond((req) => {
    const body=req.body,allowed=new Set(['effective_start','expected_revision','full_nine_source_id','template_id']);
    if(!body||typeof body!=='object'||Array.isArray(body)||!Object.hasOwn(body,'effective_start')
      ||!Object.hasOwn(body,'expected_revision')||Object.keys(body).some(key=>!allowed.has(key)))
      throw fail('static_weekly_recurring_confirmation_request_invalid','Preview accepts only source/revision selectors, never supplied schedule, report, compiler or manager facts.');
    return runOwnedRecurring(req, "preview", body);
  }));
  app.post("/static-weekly/recurring-adaptation/confirm", requireManagerWrite, namedManager, respond((req) => {
    const body=req.body;
    const required=["confirmation_key","effective_start","expected_revision","preview_digest"];
    const allowed=new Set([...required,"full_nine_source_id","template_id"]);
    if (!body || typeof body!=="object" || Array.isArray(body)
      || required.some(key=>!Object.hasOwn(body,key)) || Object.keys(body).some(key=>!allowed.has(key))) {
      throw fail("static_weekly_recurring_confirmation_request_invalid", "Confirmation accepts only the exact preview identity and revision; schedule facts and manager identity come from authenticated authority.");
    }
    return runOwnedRecurring(req, "confirm", body);
  }));
  app.get("/static-weekly/recurring-adaptation/confirmations/:confirmationKey", requireManagerWrite, namedManager, respond((req) =>
    authorityControlPlane.getRecurringConfirmationStatus({manager:manager(req),confirmationKey:req.params.confirmationKey})));
  app.get("/static-weekly/recurring-adaptation/delivery", requireManagerWrite, namedManager, respond((req) => {
    if (Object.keys(req.query || {}).some(key => key !== "service_date") || typeof req.query?.service_date !== "string") {
      throw fail("static_weekly_recurring_delivery_request_invalid");
    }
    return authorityControlPlane.getCurrentRecurringDelivery({manager:manager(req),serviceDate:req.query.service_date});
  }));
  app.post("/static-weekly/staffing-commands", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.beginStaffingCommand({
    manager: manager(req),
    commandKind: req.body?.command_kind,
    employeeId: req.body?.employee_id,
    startDate: req.body?.start_date,
    endDate: req.body?.end_date,
    absenceKind: req.body?.absence_kind,
    targetAbsenceId: req.body?.target_absence_id,
    clientPrepareKey: req.body?.client_prepare_key,
    expectedRevision: req.body?.expected_revision,
  })));
  app.post("/static-weekly/staffing-commands/:operationId/prepare", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.prepareStaffingCommand({
    manager: manager(req), operationId: req.params.operationId,
  })));
  app.get("/static-weekly/staffing-commands/pending", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.listPendingStaffingCommands({
    manager: manager(req),
    limit: req.query?.limit == null ? 50 : Number(req.query.limit),
    afterCreatedAt: req.query?.after_created_at || null,
    afterOperationId: req.query?.after_operation_id || null,
  })));
  app.get("/static-weekly/staffing-commands/:operationId", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.getStaffingCommand({
    manager: manager(req), operationId: req.params.operationId,
  })));
  app.get("/static-weekly/staffing-commands/:operationId/delivery", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.getStaffingDeliveryStatus({
    manager: manager(req), operationId: req.params.operationId,
  })));
  app.post("/static-weekly/staffing-commands/:operationId/confirm", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.acceptStaffingCommand({
    manager: manager(req), operationId: req.params.operationId,
    previewDigest: req.body?.preview_digest, confirmationKey: req.body?.confirmation_key,
  })));
  app.post("/static-weekly/staffing-commands/:operationId/cancel", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.cancelStaffingPreparation({
    manager: manager(req), operationId: req.params.operationId,
  })));
  app.get("/static-weekly/coverall-print", requireManagerWrite, namedManager, respond(async(req) => {
    const revision=text(req.query?.expected_revision);
    if(!/^(0|[1-9][0-9]*)$/.test(revision))throw fail("coverall_print_expected_revision_required");
    return acceptedCoverAllOutput({manager:manager(req),weekStart:req.query?.week_start,serviceDate:req.query?.service_date,expectedRevision:Number(revision),projectionId:req.query?.projection_id});
  }));
  function exactCoverAllBody(body,withSelections=false){
    const keys=['week_start','service_date','expected_revision','projection_id',...(withSelections?['event_selections']:[])];
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==keys.length
      ||keys.some(key=>!Object.hasOwn(body,key)))throw fail('coverall_print_request_invalid');
    return {weekStart:body.week_start,serviceDate:body.service_date,expectedRevision:body.expected_revision,
      projectionId:body.projection_id,...(withSelections?{eventSelections:body.event_selections}:{})};
  }
  async function acceptedCoverAllOutput(input){
    const document=await authorityControlPlane.getCoverAllPrintDocument(input);
    const output=await renderCoverAllPdfPair(document);
    // Re-read named-manager authority, accepted schedule/lunch and each selected
    // Event after asynchronous rendering. Return no copy/PDF bytes when changed.
    await authorityControlPlane.revalidateCoverAllPrintDocument({...input,document});
    return output;
  }
  app.post('/static-weekly/coverall-event-previews',requireManagerWrite,namedManager,respond(req=>
    authorityControlPlane.previewCoverAllEventNotes({...exactCoverAllBody(req.body),manager:manager(req)})));
  app.post('/static-weekly/coverall-print',requireManagerWrite,namedManager,respond(req=>
    acceptedCoverAllOutput({...exactCoverAllBody(req.body,true),manager:manager(req)})));
  app.post("/static-weekly/drafts/initial", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.createInitialDraft({ manager: manager(req), sourceId: req.body?.source_id, effectiveStart: req.body?.effective_start, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));
  app.post("/static-weekly/drafts/:versionId/refresh", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.refreshInitialDraft({ manager: manager(req), draftVersionId: req.params.versionId, sourceId: req.body?.source_id, effectiveStart: req.body?.effective_start, expectedDraftRevision: req.body?.expected_draft_revision, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));
  app.post("/static-weekly/drafts/replacement", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.createReplacementDraft({ manager: manager(req), sourcePublicationId: req.body?.source_publication_id, effectiveStart: req.body?.effective_start, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));
  function exactPlaceBody(body, keys) {
    if (!body || typeof body!=="object" || Array.isArray(body) || Object.keys(body).length!==keys.length
      || keys.some(key=>!Object.hasOwn(body,key))) throw fail("place_publication_request_invalid",
      "Place adoption accepts only selected original identities and exact preview/operation inputs; no client schedule or manager identity.");
    return body;
  }
  app.post("/static-weekly/places/preview", requireManagerWrite, namedManager, respond(req => {
    const b=exactPlaceBody(req.body,["source_publication_id","effective_start","expected_revision","selection","reason"]);
    return authorityControlPlane.previewPlaceRepublish({manager:manager(req),sourcePublicationId:b.source_publication_id,
      effectiveStart:b.effective_start,expectedRevision:b.expected_revision,selection:b.selection,reason:b.reason});
  }));
  function exactCapacityBody(body,keys) {
    if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).length!==keys.length
      ||keys.some(key=>!Object.hasOwn(body,key)))throw fail("capacity_source_request_invalid",
      "Capacity admission accepts only exact mapping/preview identity; no client source, person or manager identity.");
    return body;
  }
  app.post("/static-weekly/coverall/source-basis",requireManagerWrite,namedManager,respond(req=>{
    const b=exactCapacityBody(req.body,["source_publication_id","effective_start","expected_revision"]);
    return authorityControlPlane.getCapacitySourceBasis({manager:manager(req),sourcePublicationId:b.source_publication_id,
      effectiveStart:b.effective_start,expectedRevision:b.expected_revision});
  }));
  app.post("/static-weekly/coverall/source-preview",requireManagerWrite,namedManager,respond(req=>{
    const b=exactCapacityBody(req.body,["source_publication_id","effective_start","expected_revision","selection","reason"]);
    return authorityControlPlane.previewCapacitySource({manager:manager(req),sourcePublicationId:b.source_publication_id,
      effectiveStart:b.effective_start,expectedRevision:b.expected_revision,selection:b.selection,reason:b.reason});
  }));
  app.post("/static-weekly/coverall/source-confirm",requireManagerWrite,namedManager,respond(req=>{
    const b=exactCapacityBody(req.body,["operation_id","preview_id"]);
    return authorityControlPlane.confirmCapacitySource({manager:manager(req),operationId:b.operation_id,previewId:b.preview_id});
  }));
  app.get("/static-weekly/coverall/source-operations/:operationId",requireManagerWrite,namedManager,respond(req=>
    authorityControlPlane.getCapacitySourceStatus({manager:manager(req),operationId:req.params.operationId})));
  app.post("/static-weekly/places/confirm", requireManagerWrite, namedManager, respond(req => {
    const b=exactPlaceBody(req.body,["operation_id","preview_id"]);
    return authorityControlPlane.confirmPlaceRepublish({manager:manager(req),operationId:b.operation_id,previewId:b.preview_id});
  }));
  app.get("/static-weekly/places/operations/:operationId", requireManagerWrite, namedManager, respond(req =>
    authorityControlPlane.getPlaceRepublishStatus({manager:manager(req),operationId:req.params.operationId})));
  app.post("/static-weekly/drafts/:versionId/publish", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.publishDraft({ manager: manager(req), draftVersionId: req.params.versionId, expectedDraftRevision: req.body?.expected_draft_revision, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, projectionWeekStart: req.body?.week_start, publicationKind: req.body?.publication_kind || "publish", rollbackOfVersionId: req.body?.rollback_of_version_id || null })));
  app.post("/static-weekly/exceptions", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.applyException({ manager: manager(req), exceptionType: req.body?.exception_type, serviceDate: req.body?.service_date, startsAt: req.body?.starts_at || null, endsAt: req.body?.ends_at || null, baseVersionId: req.body?.base_version_id, publicationId: req.body?.publication_id, reason: req.body?.reason, payload: req.body?.payload, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, projectionWeekStart: req.body?.week_start, reversesExceptionId: req.body?.reverses_exception_id || null })));
app.post("/static-weekly/contractor-capacity", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.applyContractorCapacity({ manager: manager(req), serviceDate: req.body?.service_date, baseVersionId: req.body?.base_version_id, publicationId: req.body?.publication_id, slotId: req.body?.slot_id, shift: req.body?.shift, lunch: req.body?.lunch, breakChoice: req.body?.break_choice, reason: req.body?.reason, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, projectionWeekStart: req.body?.week_start })));
  app.post("/static-weekly/day-changes/batch", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.applyDayChanges({ manager: manager(req), serviceDate: req.body?.service_date, baseVersionId: req.body?.base_version_id, publicationId: req.body?.publication_id, versionId: req.body?.version_id || req.body?.base_version_id, operations: req.body?.operations, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, projectionWeekStart: req.body?.week_start })));
  app.post("/static-weekly/employees/departed", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.markEmployeeDeparted({ manager: manager(req), slotId: req.body?.slot_id, reason: req.body?.reason, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, projectionWeekStart: req.body?.week_start })));
  app.post("/static-weekly/employees/replacements", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.replaceEmployee({ manager: manager(req), slotId: req.body?.slot_id, newEmployeeName: req.body?.new_employee_name, reason: req.body?.reason, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, projectionWeekStart: req.body?.week_start })));
  app.post("/static-weekly/employees/restores", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.restoreExistingEmployee({ manager: manager(req), sourceId: req.body?.source_id, slotId: req.body?.slot_id, employeeId: req.body?.employee_id, effectiveStart: req.body?.effective_start, reason: req.body?.reason, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));
  app.post("/static-weekly/roster/:slotId/vacate", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.vacateRosterSlot({ manager: manager(req), sourceId: req.body?.source_id, slotId: req.params.slotId, employeeId: req.body?.employee_id, effectiveStart: req.body?.effective_start, reason: req.body?.reason, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));
  app.get("/static-weekly/roster/:slotId/separation", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.readSeparation({ manager: manager(req), slotId: req.params.slotId })));
  app.post("/static-weekly/roster/vacant-slots", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.createVacantRosterSlot({ manager: manager(req), slotId: req.body?.slot_id, slotLabel: req.body?.slot_label, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));
  app.post("/static-weekly/roster/vacant-slots/:slotId/fill", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.fillVacantRosterSlot({ manager: manager(req), sourceId: req.body?.source_id, slotId: req.params.slotId, newEmployeeName: req.body?.new_employee_name, effectiveStart: req.body?.effective_start, reason: req.body?.reason, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));
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
