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
  if (req.method !== "POST" || !boundedRecurringPaths.has(routePath)) return null;
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
