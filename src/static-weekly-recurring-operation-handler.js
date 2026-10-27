// The authenticated HTTP route has already acquired its exact restore lease.
// A failed child may release that lease only if the owned group was proved
// absent; an unproved child keeps the existing expired-row recovery blocker.
export async function runRecurringWithRestoreCustody({ run, request, kind, body, manager }) {
  if (typeof run !== "function" || !request?.staticWeeklyManagerOperation
    || !request?.restoreMutationLease?.signal
    || typeof request.restoreMutationLease.retainUnprovenRecurringCustody !== "function"
    || typeof request.restoreMutationLease.settleBeforeSuccess !== "function") throw Object.assign(new Error(
      "The recurring operation lacks its ingress clock or exact restore lease."),
    { code: "static_weekly_recurring_operation_custody_unknown" });
  let launched = false;
  try {
    return await run({ kind, body, manager,
      signal: request.restoreMutationLease.signal,
      deadlineAt: request.staticWeeklyManagerOperation.deadlineAt,
      onLaunch: () => { launched = true; },
      onCustody: () => { launched = true; },
    });
  } catch (error) {
    if (launched && error?.groupAbsent !== true) {
      // Do not downgrade to a response-only cancellation. The exact lease row
      // survives, its heartbeat stops, and a later stale receipt cannot turn
      // this response into success.
      request.restoreMutationLease.retainUnprovenRecurringCustody();
      throw Object.assign(new Error(
        "The recurring operation group was not proved absent. Check exact status and recovery before retrying."),
      { code: "static_weekly_recurring_operation_custody_unknown" });
    }
    throw error;
  }
}
