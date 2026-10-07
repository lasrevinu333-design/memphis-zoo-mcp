import { AsyncLocalStorage } from 'node:async_hooks';
export const MANAGER_OPERATION_MILLISECONDS = 60_000;
export const CLEANUP_RESERVE_MILLISECONDS = 5_000;
const boundedRecurringPaths = new Set([
  "/static-weekly/exceptions",
  "/static-weekly/contractor-capacity",
  "/static-weekly/day-changes/batch",
  "/static-weekly/rebuild-current-projection",
  "/static-weekly/projections",
  "/static-weekly/recurring-adaptation/preview",
  "/static-weekly/recurring-adaptation/confirm",
  "/static-weekly/approved-initial/preview",
  "/static-weekly/approved-initial/confirm",
]);

export function beginBoundedManagerRequest(req, res, {
  now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  // Express defaults to case-insensitive, non-strict route matching. Its
  // handlers accept mixed case and one optional trailing slash as well.
  const routePath = typeof req.path === "string" ? req.path.replace(/\/$/, "").toLowerCase() : "";
  if (req.method !== "POST" || !(boundedRecurringPaths.has(routePath) || routePath.startsWith("/static-weekly/"))) return null;
  const controller = new AbortController();
  const deadlineAt = now() + MANAGER_OPERATION_MILLISECONDS;
  const abort = () => controller.abort(Object.assign(new Error(
    "The manager operation reached its one-minute bound; check the saved status before retrying."),
    { code: "static_weekly_recurring_operation_deadline_exceeded" }));
  const timer = setTimer(() => {
    abort();
    // Before the mutation gate has acquired a lease there is no SQL work to
    // abandon. A late lease-begin response is reconciled by that gate.
    if (!req.restoreMutationLease && !res.headersSent && !res.writableEnded) {
      // An incomplete JSON body may still be held by the body parser. Send the
      // typed failure first, then close only this request's socket so its
      // parser and listeners cannot later resume into the mutation gate.
      if (!req.complete) res.once?.("finish", () => req.destroy?.());
      res.status(503).json({ok:false,code:"static_weekly_recurring_operation_deadline_exceeded",
        error:"Manager operation expired before admission. Check the saved status before retrying."});
    }
  }, MANAGER_OPERATION_MILLISECONDS - CLEANUP_RESERVE_MILLISECONDS);
  timer.unref?.();
  const cleanup = () => clearTimer(timer);
  res.once?.("finish", cleanup);
  res.once?.("close", () => { if (!res.writableFinished) abort(); cleanup(); });
  const context = Object.freeze({signal:controller.signal,deadlineAt});
  req.staticWeeklyManagerOperation = context;
  return context;
}

// Carry the already verified request identity through asynchronous queueing.
// No body fields, tokens or mutable cross-request singleton enter this scope.
const managerTransactions=new AsyncLocalStorage();
export function currentManagerTransaction(){return managerTransactions.getStore()||null;}
export function runWithManagerTransaction(req,action){
 const bounded=req.staticWeeklyManagerOperation;
 if(!bounded)return action();
 const s=req.memphisAuth,path=String(req.path||'').replace(/\/$/,'').toLowerCase();
 if(s?.role!=='ops_manager'||!s.manager_id||!s.credential_id||!s.device_id||!req.restoreMutationLease?.signal)
  throw Object.assign(new Error('A current manager request identity is required.'),{code:'42501'});
 const permission=path==='/static-weekly/contractor-capacity'?'manage_coverall'
  :['/static-weekly/exceptions','/static-weekly/day-changes/batch'].includes(path)?'manage_absences'
  :['/static-weekly/projections','/static-weekly/rebuild-current-projection'].includes(path)?'regenerate_routes':'write';
 const manager=Object.freeze({manager_id:s.manager_id,credential_id:s.credential_id,device_id:s.device_id,access_level:s.access_level});
 return managerTransactions.run(Object.freeze({manager,permission,signal:req.restoreMutationLease.signal,deadlineAt:bounded.deadlineAt}),action);
}
export function effectiveManagerBounds(signal,deadlineAt){
 const context=currentManagerTransaction();if(!context)return{signal,deadlineAt};
 const boundedSignal=signal&&signal!==context.signal?AbortSignal.any([signal,context.signal]):context.signal;
 const bound=deadlineAt==null?context.deadlineAt:Math.min(deadlineAt,context.deadlineAt);
 return{signal:boundedSignal,deadlineAt:bound};
}
