import {createCustodialLeadershipControlPlane} from "./auth/custodial-leadership-runtime.js";
import {isCustodialLeadershipManagementSession} from "./auth/manager-permissions.js";
import {createHash,randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {renderCanonicalCoverAllLink} from './static-weekly-coverall-access.js';
import "dotenv/config";
import { pathToFileURL } from "node:url";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { assertOpsManagerSessionSecret, createSupabaseTrustedDeviceStore, makeOpsAccessMiddleware } from "./auth/shared-access-auth.js";
import { createStaticWeeklyControlPlane, createStaticWeeklyControlPlaneDatabase } from "./static-weekly-control-plane.js";
import { beginBoundedManagerRequest } from "./static-weekly-manager-operation.js";
import {approvedInitialRequest,approvedInitialSelectionRequest,approvedManualActivationRequest,APPROVED_INITIAL_REQUEST_ERROR} from "./static-weekly-approved-initial-request.js";
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
    "https://memphis-zoo-infrastructure-map.lasrevinu333.chatgpt.site",
    "https://localhost",
    "capacitor://localhost",
    ...text(env?.STATIC_WEEKLY_CONTROL_PLANE_ALLOWED_ORIGINS || env?.ALLOWED_CORS_ORIGINS).split(",").map((value) => value.trim()).filter(Boolean),
  ]);
}

function setCors(req, res, env) {
  const origin = text(req.headers?.origin);
  if (origin && allowedOrigins(env).has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Id, X-CSRF-Token, X-Device-Security-CSRF");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
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
  leadershipRuntime = null,
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
  const cohortRuntime=leadershipRuntime||createCustodialLeadershipControlPlane({env,database:authorityDatabase});
  const authorityControlPlane = controlPlane || createControlPlane({ database: authorityDatabase,leadershipRequestActorVerifier:cohortRuntime.verifyTransaction });
  const datedRequestContext=new AsyncLocalStorage();
  const bindDatedRequest=async client=>{const context=datedRequestContext.getStore();if(isCustodialLeadershipManagementSession(context?.manager)){if(typeof cohortRuntime.verifyTransaction!=='function')throw fail('custodial_transaction_actor_denied');await cohortRuntime.verifyTransaction(client,context);}};
  const boundedController=datedTransitionController===undefined&&typeof authorityDatabase?.connect==='function'
    ?createConfiguredOctoberDatedController(authorityDatabase,{bindRequest:bindDatedRequest}):datedTransitionController;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy",1);
  app.use((req, res, next) => {
    setCors(req, res, env);
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });
  if(cohortRuntime.enabled)app.use(cohortRuntime.router);
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
    env,leadershipVerifier:cohortRuntime.verify,
    requireWrite: true,
    trustedDeviceStore: trustedStore,
    supabase: trustedSupabase,
    requireTrustedDeviceStore: true,
    requireCurrentManagerAssociation: true,
    operationSignalForRequest: req => req.staticWeeklyManagerOperation?.signal || null,
  });

  const requireManagerRead = makeOpsAccessMiddleware({
    env,leadershipVerifier:cohortRuntime.verify,requireWrite:false,trustedDeviceStore:trustedStore,supabase:trustedSupabase,
    requireTrustedDeviceStore:true,requireCurrentManagerAssociation:true,
    operationSignalForRequest:req=>req.staticWeeklyManagerOperation?.signal||null,
  });
  const schedulerPermission = (requiredPermission) => makeOpsAccessMiddleware({
    env, leadershipVerifier:cohortRuntime.verify, trustedDeviceStore: trustedStore, supabase: trustedSupabase,
    requireTrustedDeviceStore:true, requireCurrentManagerAssociation:true, requiredPermission,
    operationSignalForRequest:req=>req.staticWeeklyManagerOperation?.signal||null,
  });
  const requireManagerAbsence = schedulerPermission("manage_absences");
  const requireManagerCoverAll = schedulerPermission("manage_coverall");
  const requireManagerRegenerate = schedulerPermission("regenerate_routes");
  function namedSchedulerManager(req,res,next) {
    const session=req.memphisAuth;
    if (!isCustodialLeadershipManagementSession(session)&&(!session?.trusted_device || session.auth_mode!=="trusted_device" || !session.manager_id || !session.credential_id)) {
      res.status(403).json({ok:false,error:"A current named manager credential is required."});return;
    }
    next();
  }
  function namedReadManager(req,res,next) {
    const session=req.memphisAuth;
    const trustedDevice=session?.trusted_device&&session.auth_mode==="trusted_device";
    // The preceding read middleware has already verified the signed Map token
    // and its current protected registry mapping; it never grants write access.
    if((!trustedDevice&&!isMapDashboardSession(session)&&!isCustodialLeadershipManagementSession(session))||!session.manager_id||!session.manager_display_name) {
      res.status(403).json({ok:false,error:"A current trusted named manager is required to read the schedule."});return;
    }
    next();
  }

  function namedManager(req, res, next) {
    const session = req.memphisAuth;
    if (!isCustodialLeadershipManagementSession(session)&&(!session?.trusted_device || !session.manager_id || !session.manager_display_name || session.read_only || session.auth_mode !== "trusted_device")) {
      res.status(403).json({ ok: false, error: "A trusted write-enabled named manager session is required." });
      return;
    }
    next();
  }

  function manager(req) { return req.memphisAuth; }
  const runOwnedRecurring = (req, kind, body) => {
    // Fixed approved patterns already acquire the control plane's single
    // transaction queue. Holding an external-child slot around that same
    // transaction can exhaust all three slots with three simultaneous callers.
    // Do not acquire a second slot or invoke the retired optimizer path.
    if(body.full_nine_source_id!=null)throw fail('static_template_legacy_source_selector_not_supported');
    const method=kind==='preview'?'previewApprovedStaticPattern':'confirmApprovedStaticPattern';
    if(typeof authorityControlPlane[method]!=="function")throw fail('static_weekly_control_plane_busy',
      'The approved pattern authority is unavailable; no work was started.');
    const input={manager:manager(req),serviceDate:body.effective_start,
      expectedRevision:body.expected_revision,templateId:body.template_id??null,
      signal:req.restoreMutationLease.signal,deadlineAt:req.staticWeeklyManagerOperation.deadlineAt};
    return authorityControlPlane[method](kind==='preview'?input:{...input,
      previewDigest:body.preview_digest,idempotencyKey:body.confirmation_key});
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
      let data, operationCompleted=false;
      try {
        const route=String(req.path||"").replace(/\/$/,"").toLowerCase();
        const permission=route==="/static-weekly/contractor-capacity"
          ||/^\/static-weekly\/staffing-commands\/[^/]+\/coverall-(?:options|prepare)$/.test(route)?"manage_coverall":
          /^\/static-weekly\/staffing-commands(?:\/|$)/.test(route)?"manage_absences":
          ["/static-weekly/exceptions","/static-weekly/day-changes/batch"].includes(route)?"manage_absences":
          ["/static-weekly/projections","/static-weekly/rebuild-current-projection"].includes(route)?"regenerate_routes":"write";
        if(req.staticWeeklyManagerOperation && typeof authorityControlPlane.runManagerOperation==="function") {
          data=await authorityControlPlane.runManagerOperation({manager:manager(req),permission,
            signal:req.staticWeeklyManagerOperation.readOnly?req.staticWeeklyManagerOperation.signal:req.restoreMutationLease.signal,
            deadlineAt:req.staticWeeklyManagerOperation.deadlineAt},()=>operation(req));
        }else{data=await operation(req);}
        operationCompleted=true;
        // Mutation POSTs must settle their exact restore lease before success.
        // The selection-only GET retains the control plane's SQL restore fence,
        // current actor verification and ingress deadline without a write lease.
        if (req.staticWeeklyManagerOperation&&!req.staticWeeklyManagerOperation.readOnly) {
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
        if (req.staticWeeklyManagerOperation&&!req.staticWeeklyManagerOperation.readOnly
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
        const invalid = ["static_weekly_control_plane_compiler_rejected", "static_weekly_recurring_confirmation_request_invalid", "static_weekly_recurring_delivery_request_invalid",'static_weekly_manual_activation_request_invalid',APPROVED_INITIAL_REQUEST_ERROR,OPENING_COVERAGE_ERROR].includes(responseError?.code);
        const diagnostic=responseError?.code===OPENING_COVERAGE_ERROR?sanitizeOpeningCoverageDiagnostic(responseError.openingCoverageDiagnostic):null;
        res.status(responseError?.code === "42501" ? 403 : invalid ? 422 : unavailable ? 503 : 409).json({ ok: false, error: diagnostic
          ?'Opening planned coverage has inconsistent essential source facts. Nothing was admitted or published.'
          :responseError?.message || "Static weekly control-plane request failed.", code: responseError?.code || "static_weekly_control_plane_failed",
          ...(operationCompleted?{operation_outcome:"accepted",accepted_result:data}:
            unavailable?{operation_outcome:"unknown"}:{operation_outcome:"rejected"}),
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
    runWithManager:(principal,work)=>datedRequestContext.run({manager:principal,leadershipRequestId:randomUUID()},work),
  }));
  app.get("/static-weekly/approved-choices",requireManagerWrite,namedManager,respond(req=>authorityControlPlane.getApprovedScheduleChoices({manager:manager(req)})));
  app.get('/static-weekly/approved-initial/selection',requireManagerWrite,namedManager,respond(req=>{
    const input=approvedInitialSelectionRequest(req.query);
    if(req.staticWeeklyManagerOperation?.readOnly!==true||typeof authorityControlPlane.getApprovedInitialSelection!=='function')
      throw fail('static_weekly_control_plane_database_unavailable','Approved selection metadata is unavailable.');
    return authorityControlPlane.getApprovedInitialSelection({manager:manager(req),weekStart:input.weekStart,
      signal:req.staticWeeklyManagerOperation.signal,deadlineAt:req.staticWeeklyManagerOperation.deadlineAt});
  }));
  app.get("/static-weekly/manager-snapshot", requireManagerRead, namedReadManager, respond((req) => authorityControlPlane.getManagerSnapshot({ manager: manager(req), weekStart: req.query?.week_start })));
  app.get('/static-weekly/manual-activation/roster',requireManagerWrite,namedManager,respond(req=>
    authorityControlPlane.getApprovedManualActivationRoster({manager:manager(req)})));
  for(const [action,method]of [['preview','previewApprovedManualActivation'],['confirm','activateApprovedManualSchedule']]){
    app.post(`/static-weekly/manual-activation/${action}`,requireManagerWrite,namedManager,respond(req=>{
      const input=approvedManualActivationRequest(req.body,{confirm:action==='confirm'}),operation=req.staticWeeklyManagerOperation;
      if(!operation||!req.restoreMutationLease?.signal||typeof authorityControlPlane[method]!=='function')
        throw fail('static_weekly_control_plane_database_unavailable','Approved schedule activation is unavailable.');
      return authorityControlPlane[method]({...input,manager:manager(req),signal:req.restoreMutationLease.signal,deadlineAt:operation.deadlineAt});
    }));
  }
  app.get('/static-weekly/manual-activation/outcome',requireManagerWrite,namedManager,respond(req=>{
    const query=req.query||{},keys=Object.keys(query).sort(),version2=Object.hasOwn(query,'operation_id');
    if(keys.join(',')!==(version2?'idempotency_key,operation_id':'idempotency_key')||typeof query.idempotency_key!=='string'
      ||(version2&&(typeof query.operation_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(query.operation_id))))
      throw fail('static_weekly_manual_activation_request_invalid');
    return authorityControlPlane.getApprovedManualActivationOutcome({manager:manager(req),idempotencyKey:query.idempotency_key,
      ...(version2?{operationId:query.operation_id}:{})});
  }));
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
    {
      if(Object.keys(req.query||{}).length||Object.keys(req.body||{}).length||Array.isArray(req.body))
        throw fail('static_weekly_recurring_confirmation_request_invalid','Status accepts only the original path identity.');
      return authorityControlPlane.getApprovedStaticConfirmationStatus({manager:manager(req),confirmationKey:req.params.confirmationKey});
    }));
  app.get("/static-weekly/approved-initial/confirmations/:idempotencyKey", requireManagerWrite, namedManager, respond((req) =>
    {
      if(Object.keys(req.query||{}).length||Object.keys(req.body||{}).length||Array.isArray(req.body))
        throw fail('static_weekly_recurring_confirmation_request_invalid','Status accepts only the original path identity.');
      return authorityControlPlane.getApprovedInitialConfirmationStatus({manager:manager(req),confirmationKey:req.params.idempotencyKey});
    }));
  app.get("/static-weekly/recurring-adaptation/delivery", requireManagerWrite, namedManager, respond((req) => {
    if (Object.keys(req.query || {}).some(key => key !== "service_date") || typeof req.query?.service_date !== "string") {
      throw fail("static_weekly_recurring_delivery_request_invalid");
    }
    return authorityControlPlane.getCurrentRecurringDelivery({manager:manager(req),serviceDate:req.query.service_date});
  }));
  app.post("/static-weekly/staffing-commands", requireManagerAbsence, namedSchedulerManager, respond((req) => authorityControlPlane.beginStaffingCommand({
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
  app.post("/static-weekly/staffing-commands/:operationId/prepare", requireManagerAbsence, namedSchedulerManager, respond((req) => authorityControlPlane.prepareStaffingCommand({
    manager: manager(req), operationId: req.params.operationId,
  })));
  app.get("/static-weekly/staffing-commands/:operationId/coverall-options", requireManagerCoverAll, namedSchedulerManager, respond((req) => authorityControlPlane.getApprovedManualCoverAllOptions({
    manager: manager(req), operationId: req.params.operationId,
  })));
  app.post("/static-weekly/staffing-commands/:operationId/coverall-prepare", requireManagerCoverAll, namedSchedulerManager, respond((req) => authorityControlPlane.prepareApprovedManualCoverAllStaffing({
    manager: manager(req), operationId: req.params.operationId, request: req.body,
  })));
  app.get("/static-weekly/staffing-commands/pending", requireManagerAbsence, namedSchedulerManager, respond((req) => authorityControlPlane.listPendingStaffingCommands({
    manager: manager(req),
    limit: req.query?.limit == null ? 50 : Number(req.query.limit),
    afterCreatedAt: req.query?.after_created_at || null,
    afterOperationId: req.query?.after_operation_id || null,
  })));
  app.get("/static-weekly/staffing-commands/:operationId", requireManagerAbsence, namedSchedulerManager, respond((req) => authorityControlPlane.getStaffingCommand({
    manager: manager(req), operationId: req.params.operationId,
  })));
  app.get("/static-weekly/staffing-commands/:operationId/delivery", requireManagerAbsence, namedSchedulerManager, respond((req) => authorityControlPlane.getStaffingDeliveryStatus({
    manager: manager(req), operationId: req.params.operationId,
  })));
  app.post("/static-weekly/staffing-commands/:operationId/confirm", requireManagerAbsence, namedSchedulerManager, respond((req) => authorityControlPlane.acceptStaffingCommand({
    manager: manager(req), operationId: req.params.operationId,
    previewDigest: req.body?.preview_digest, confirmationKey: req.body?.confirmation_key,
  })));
  app.post("/static-weekly/staffing-commands/:operationId/cancel", requireManagerAbsence, namedSchedulerManager, respond((req) => authorityControlPlane.cancelStaffingPreparation({
    manager: manager(req), operationId: req.params.operationId,
  })));
  app.post('/static-weekly/coverall-links',requireManagerCoverAll,namedSchedulerManager,respond(req=>{
    const keys=['week_start','service_date','expected_revision','projection_id','capacity_id','ttl_hours','request_id'],b=req.body;
    if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).length!==keys.length||keys.some(k=>!Object.hasOwn(b,k)))
      throw fail('coverall_link_request_invalid');
    return authorityControlPlane.issueCoverAllAssignmentLink({manager:manager(req),weekStart:b.week_start,serviceDate:b.service_date,
      expectedRevision:b.expected_revision,projectionId:b.projection_id,capacityId:b.capacity_id,ttlHours:b.ttl_hours,requestId:b.request_id});
  }));
  app.post('/static-weekly/coverall-links/revoke',requireManagerCoverAll,namedSchedulerManager,respond(req=>{
    if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length!==1||!Object.hasOwn(req.body,'link_id'))
      throw fail('coverall_link_request_invalid');
    return authorityControlPlane.revokeCoverAllAssignmentLink({manager:manager(req),linkId:req.body.link_id});
  }));
  app.get('/static-weekly/coverall-links/assignment',async(req,res)=>{
    res.setHeader('Cache-Control','no-store, private, max-age=0');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    try{
      if(Object.keys(req.query).some(k=>k!=='lang')||(req.query.lang!==undefined&&typeof req.query.lang!=='string')
        ||!['en','es','both'].includes(req.query.lang||'both'))throw fail('coverall_link_invalid');
      const accessToken=req.headers['x-coverall-access-token'];
      if(accessToken===undefined){
        // Fragment never reaches HTTP/access logs. Keep the capability in RAM;
        // no cookies/storage, external scripts, URL query or error interpolation.
        const script=`(async()=>{try{const f=new URLSearchParams(location.hash.slice(1));const token=f.get('access_token');history.replaceState(null,'',location.pathname+location.search);if([...f.keys()].length!==1||!/^[A-Za-z0-9_-]{43}$/.test(token||''))throw Error();const r=await fetch(location.pathname+location.search,{headers:{'X-CoverAll-Access-Token':token},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',redirect:'error'});if(!r.ok)throw Error();const html=await r.text();document.open();document.write(html);document.close();}catch{document.body.textContent='This private handout link is unavailable or no longer current. Ask the issuing manager for a current handout.';}})();`;
        const digest=createHash('sha256').update(script).digest('base64');
        res.setHeader('Content-Security-Policy',`default-src 'none'; connect-src 'self'; script-src 'sha256-${digest}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
        return res.type('html').status(200).send('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private CoverAll handout</title></head><body><p>Opening private handout…</p><script>'+script+'</script></body></html>');
      }
      if(typeof accessToken!=='string')throw fail('coverall_link_invalid');
      const input={accessToken};
      const document=await authorityControlPlane.readCoverAllAssignmentLink(input);
      const html=renderCanonicalCoverAllLink(document,req.query.lang||'both');
      const current=await authorityControlPlane.readCoverAllAssignmentLink(input);
      if(current.documentDigest!==document.documentDigest)throw fail('coverall_link_authority_changed');
      res.type('html').status(200).send(html);
    }catch{res.status(403).type('html').send('<!doctype html><html><body><h1>CoverAll schedule unavailable</h1><p>This private handout link is unavailable, expired or no longer current. Ask the issuing manager for a current handout.</p></body></html>');}
  });
  app.get("/static-weekly/coverall-print", requireManagerCoverAll, namedSchedulerManager, respond(async(req) => {
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
  app.post("/static-weekly/exceptions", requireManagerAbsence, namedSchedulerManager, respond((req) => authorityControlPlane.applyException({ manager: manager(req), signal:req.restoreMutationLease.signal, deadlineAt:req.staticWeeklyManagerOperation.deadlineAt, exceptionType: req.body?.exception_type, serviceDate: req.body?.service_date, startsAt: req.body?.starts_at || null, endsAt: req.body?.ends_at || null, baseVersionId: req.body?.base_version_id, publicationId: req.body?.publication_id, reason: req.body?.reason, payload: req.body?.payload, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, projectionWeekStart: req.body?.week_start, reversesExceptionId: req.body?.reverses_exception_id || null })));
app.post("/static-weekly/contractor-capacity", requireManagerCoverAll, namedSchedulerManager, respond((req) => authorityControlPlane.applyContractorCapacity({ manager: manager(req), signal:req.restoreMutationLease.signal, deadlineAt:req.staticWeeklyManagerOperation.deadlineAt, serviceDate: req.body?.service_date, baseVersionId: req.body?.base_version_id, publicationId: req.body?.publication_id, slotId: req.body?.slot_id, shift: req.body?.shift, lunch: req.body?.lunch, breakChoice: req.body?.break_choice, reason: req.body?.reason, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, projectionWeekStart: req.body?.week_start })));
  app.post("/static-weekly/day-changes/batch", requireManagerAbsence, namedSchedulerManager, respond((req) => authorityControlPlane.applyDayChanges({ manager: manager(req), signal:req.restoreMutationLease.signal, deadlineAt:req.staticWeeklyManagerOperation.deadlineAt, serviceDate: req.body?.service_date, baseVersionId: req.body?.base_version_id, publicationId: req.body?.publication_id, versionId: req.body?.version_id || req.body?.base_version_id, operations: req.body?.operations, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, projectionWeekStart: req.body?.week_start })));
  app.post("/static-weekly/employees/departed", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.markEmployeeDeparted({ manager: manager(req), slotId: req.body?.slot_id, reason: req.body?.reason, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, projectionWeekStart: req.body?.week_start })));
  app.post("/static-weekly/employees/replacements", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.replaceEmployee({ manager: manager(req), slotId: req.body?.slot_id, newEmployeeName: req.body?.new_employee_name, reason: req.body?.reason, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key, projectionWeekStart: req.body?.week_start })));
  app.post("/static-weekly/employees/restores", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.restoreExistingEmployee({ manager: manager(req), sourceId: req.body?.source_id, slotId: req.body?.slot_id, employeeId: req.body?.employee_id, effectiveStart: req.body?.effective_start, reason: req.body?.reason, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));
  const vacancyInput = (req, confirming) => {
    const fields = ["source_id", "employee_id", "effective_start", "reason", "expected_revision", "idempotency_key",
      ...(confirming ? ["preview_digest"] : [])];
    if (!req.body || Object.getPrototypeOf(req.body) !== Object.prototype
      || Object.keys(req.body).length !== fields.length
      || Object.keys(req.body).some(key => !fields.includes(key))) {
      throw fail("static_weekly_vacancy_request_invalid", "Use the exact original vacancy request and reviewed preview.");
    }
    return { manager: manager(req), sourceId: req.body.source_id, slotId: req.params.slotId,
      employeeId: req.body.employee_id, effectiveStart: req.body.effective_start, reason: req.body.reason,
      expectedRevision: req.body.expected_revision, idempotencyKey: req.body.idempotency_key,
      previewDigest: confirming ? req.body.preview_digest : null,
      signal: req.restoreMutationLease.signal, deadlineAt: req.staticWeeklyManagerOperation.deadlineAt };
  };
  app.post("/static-weekly/roster/:slotId/vacate/preview", requireManagerWrite, namedManager,
    respond(req => authorityControlPlane.previewVacancyRosterSlot(vacancyInput(req, false))));
  app.post("/static-weekly/roster/:slotId/vacate", requireManagerWrite, namedManager,
    respond(req => authorityControlPlane.vacateRosterSlot(vacancyInput(req, true))));
  app.get("/static-weekly/roster/:slotId/separation", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.readSeparation({ manager: manager(req), slotId: req.params.slotId })));
  app.get("/static-weekly/staffing/source-details", requireManagerWrite, namedManager, respond(req => {
    const q=req.query,keys=["source_id","effective_start","expected_revision"];
    if(Object.keys(q).length!==keys.length||keys.some(k=>typeof q[k]!=="string")
      ||!/^(0|[1-9][0-9]*)$/.test(q.expected_revision)||!Number.isSafeInteger(Number(q.expected_revision)))
      throw fail("static_weekly_staffing_source_request_invalid","Exact source, date and revision are required.");
    return authorityControlPlane.getRosterSourceDetails({manager:manager(req),sourceId:q.source_id,
      effectiveStart:q.effective_start,expectedRevision:Number(q.expected_revision)});
  }));
  app.get("/static-weekly/staffing/operations/:idempotencyKey", requireManagerWrite, namedManager, respond(req =>
    authorityControlPlane.readOriginalStaffingOutcome({manager:manager(req),operation:req.query.operation,
      idempotencyKey:req.params.idempotencyKey})));
  app.post("/static-weekly/roster/vacant-slots", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.createVacantRosterSlot({ manager: manager(req), slotId: req.body?.slot_id, slotLabel: req.body?.slot_label, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));
  app.post("/static-weekly/roster/vacant-slots/:slotId/fill", requireManagerWrite, namedManager, respond((req) => authorityControlPlane.fillVacantRosterSlot({ manager: manager(req), sourceId: req.body?.source_id, slotId: req.params.slotId, newEmployeeName: req.body?.new_employee_name, effectiveStart: req.body?.effective_start, reason: req.body?.reason, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));
  app.post("/static-weekly/projections", requireManagerRegenerate, namedSchedulerManager, respond((req) => authorityControlPlane.materializeProjection({ manager: manager(req), signal:req.restoreMutationLease.signal, deadlineAt:req.staticWeeklyManagerOperation.deadlineAt, publicationId: req.body?.publication_id, serviceDate: req.body?.service_date, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));
  app.post("/static-weekly/rebuild-current-projection", requireManagerRegenerate, namedSchedulerManager, respond((req) => authorityControlPlane.rebuildCurrentProjection({ manager: manager(req), signal:req.restoreMutationLease.signal, deadlineAt:req.staticWeeklyManagerOperation.deadlineAt, weekStart: req.body?.week_start, expectedRevision: req.body?.expected_revision, idempotencyKey: req.body?.idempotency_key })));

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
