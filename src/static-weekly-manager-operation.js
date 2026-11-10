export const MANAGER_OPERATION_MILLISECONDS = 60_000;
export const CLEANUP_RESERVE_MILLISECONDS = 5_000;
// Initial activation performs two complete native period validations in one
// physical transaction. Only its confirm route owns this larger total budget.
export const INITIAL_MANUAL_ACTIVATION_MILLISECONDS = 120_000;

export function initialManualActivationWorkerDeadline(deadlineAt, now = performance.now()) {
  // The compiler still receives at most its existing one-minute allowance,
  // and never a deadline beyond this original request's cleanup boundary.
  return Math.min(deadlineAt - CLEANUP_RESERVE_MILLISECONDS, now + MANAGER_OPERATION_MILLISECONDS);
}


export function beginBoundedManagerRequest(req, res, {
  now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  // Express defaults to case-insensitive, non-strict route matching. Its
  // handlers accept mixed case and one optional trailing slash as well.
  const routePath = typeof req.path === "string" ? req.path.replace(/\/$/, "").toLowerCase() : "";
  const readOnly=req.method==='GET'&&(routePath==='/static-weekly/approved-initial/selection'
    ||routePath==='/static-weekly/approved-choices'
    ||routePath==='/static-weekly/manager-snapshot'
    ||['/static-weekly/manual-activation/roster','/static-weekly/manual-activation/outcome'].includes(routePath)
    ||/^\/static-weekly\/(?:approved-initial|recurring-adaptation)\/confirmations\/[^/]+$/.test(routePath)
    ||/^\/static-weekly\/staffing-commands(?:\/|$)/.test(routePath));
  if (!readOnly&&(req.method !== "POST" || !routePath.startsWith("/static-weekly/"))) return null;
  const controller = new AbortController();
  const operationMilliseconds = req.method === "POST" && routePath === "/static-weekly/manual-activation/confirm"
    ? INITIAL_MANUAL_ACTIVATION_MILLISECONDS : MANAGER_OPERATION_MILLISECONDS;
  const deadlineAt = now() + operationMilliseconds;
  const abort = () => controller.abort(Object.assign(new Error(
    "The manager operation reached its request deadline; check the saved status before retrying."),
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
  }, operationMilliseconds - CLEANUP_RESERVE_MILLISECONDS);
  timer.unref?.();
  const cleanup = () => clearTimer(timer);
  res.once?.("finish", cleanup);
  res.once?.("close", () => { if (!res.writableFinished) abort(); cleanup(); });
  const context = Object.freeze({signal:controller.signal,deadlineAt,readOnly});
  req.staticWeeklyManagerOperation = context;
  return context;
}
