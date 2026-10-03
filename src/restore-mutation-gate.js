import { randomUUID } from "node:crypto";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function unavailable(res, code, error, state = null) {
  if (res.headersSent || res.writableEnded) return;
  res.status(503).json({
    ok: false,
    code,
    error,
    work_saved: true,
    retryable: false,
    ...(state ? { restore: state } : {}),
  });
}

async function beginMutationLease({ supabase, serviceName, requestId }) {
  const { data, error } = await supabase.rpc("custodial_begin_application_mutation_lease", {
    p_request_id: requestId,
    p_service_name: serviceName,
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || data.mutations_paused !== false || !Number.isSafeInteger(Number(data.authority_generation))) {
    throw new Error("The restore mutation lease response is invalid.");
  }
  return data;
}

async function beginMutationLeaseWithinRequest({ supabase, serviceName, requestId, signal, logger }) {
  if (!signal) return beginMutationLease({ supabase, serviceName, requestId });
  if (signal.aborted) throw signal.reason || new Error("Manager request expired before mutation admission.");
  const pending = beginMutationLease({ supabase, serviceName, requestId });
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason || new Error("Manager request expired before mutation admission."));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    await Promise.race([pending, aborted]);
    if (signal.aborted) throw signal.reason || new Error("Manager request expired before mutation admission.");
  } catch (error) {
    if (signal.aborted) {
      // The RPC can commit its lease after the client has stopped waiting.
      // Release only this exact request ID if its begin later proves success.
      void pending.then(() => releaseMutationLease({ supabase, requestId }).catch(() =>
        logger.error("Late mutation lease release failed; recovery must reconcile the retained lease.", { request_id: requestId, service_name: serviceName })), () => {});
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function heartbeatMutationLease({ supabase, requestId }) {
  const { data, error } = await supabase.rpc("custodial_heartbeat_application_mutation_lease", { p_request_id: requestId });
  if (error) throw error;
  if (data !== true) throw new Error("The restore mutation lease is no longer active.");
}

async function releaseMutationLease({ supabase, requestId }) {
  const { error } = await supabase.rpc("custodial_release_application_mutation_lease", { p_request_id: requestId });
  if (error) throw error;
}

function leaseLostError(cause) {
  const error = new Error("The disaster-recovery mutation lease was lost before the operation completed.", { cause });
  error.name = "MutationLeaseLostError";
  error.code = "mutation_lease_lost";
  return error;
}

function maintainMutationLease({ supabase, requestId, serviceName, heartbeatMilliseconds, logger }) {
  let released = false;
  let lostError = null;
  const controller = new AbortController();
  let rejectLoss;
  const lost = new Promise((resolve, reject) => { rejectLoss = reject; });
  // The rejection is consumed by callers through Promise.race. This handler
  // prevents an unhandled rejection when an HTTP handler never awaits it.
  lost.catch(() => {});
  function lose(cause) {
    if (released || lostError) return;
    lostError = leaseLostError(cause);
    clearInterval(timer);
    controller.abort(lostError);
    rejectLoss(lostError);
    logger.error("Lost application mutation lease; the operation was aborted and restore remains blocked.", {
      request_id: requestId,
      service_name: serviceName,
    });
  }
  const timer = setInterval(() => {
    heartbeatMutationLease({ supabase, requestId }).catch(lose);
  }, heartbeatMilliseconds);
  timer.unref?.();
  async function release() {
    if (released) return;
    released = true;
    clearInterval(timer);
    await releaseMutationLease({ supabase, requestId });
  }
  function abort(cause = new Error("The client disconnected before the mutation completed.")) {
    if (!controller.signal.aborted) controller.abort(cause);
  }
  function assertActive() {
    if (lostError) throw lostError;
    if (controller.signal.aborted) throw controller.signal.reason || new Error("The mutation operation was aborted.");
  }
  return { release, lost, abort, signal: controller.signal, assertActive };
}

export async function withApplicationMutationLease({
  supabase,
  serviceName,
  operation,
  requestId = randomUUID,
  heartbeatMilliseconds = 30_000,
  logger = console,
} = {}) {
  if (!supabase || typeof operation !== "function" || !String(serviceName || "").trim()) {
    throw new TypeError("A Supabase client, service name, and mutation operation are required.");
  }
  const leaseId = requestId();
  await beginMutationLease({ supabase, serviceName, requestId: leaseId });
  const lease = maintainMutationLease({ supabase, requestId: leaseId, serviceName, heartbeatMilliseconds, logger });
  const operationPromise = Promise.resolve().then(() => operation({
    requestId: leaseId,
    signal: lease.signal,
    assertActive: lease.assertActive,
  }));
  try {
    try {
      return await Promise.race([operationPromise, lease.lost]);
    } catch (error) {
      if (error?.code === "mutation_lease_lost") {
        // Do not return control or release the lease while uncooperative work
        // could still be changing external state. Expired rows are a restore
        // blocker and require explicit reconciliation.
        await operationPromise.catch(() => {});
      }
      throw error;
    }
  } finally {
    await lease.release().catch(() => logger.error("Failed to release application mutation lease.", { request_id: leaseId, service_name: serviceName }));
  }
}

export function makeRestoreMutationGate({
  supabase,
  required = true,
  serviceName = "memphis-zoo-backend",
  requestId = randomUUID,
  heartbeatMilliseconds = 30_000,
  disconnectTerminationMilliseconds = 120_000,
  terminateUnsettledProcess = () => process.exit(70),
  logger = console,
} = {}) {
  if (!Number.isFinite(disconnectTerminationMilliseconds) || disconnectTerminationMilliseconds < 1
      || typeof terminateUnsettledProcess !== "function") {
    throw new TypeError("A positive disconnect termination timeout and process terminator are required.");
  }
  return async function restoreMutationGate(req, res, next) {
    if (!MUTATING_METHODS.has(String(req.method || "").toUpperCase())) {
      next();
      return;
    }
    if (!required) {
      next();
      return;
    }
    if (!supabase) {
      unavailable(res, "restore_gate_unavailable", "Saved work is protected. This service cannot confirm that changes are currently allowed.");
      return;
    }

    try {
      const leaseId = requestId();
      const requestSignal = req.staticWeeklyManagerOperation?.signal || null;
      try {
        await beginMutationLeaseWithinRequest({ supabase, serviceName, requestId: leaseId,
          signal: requestSignal, logger });
      } catch (error) {
        if (requestSignal?.aborted) {
          unavailable(res, "static_weekly_recurring_operation_deadline_exceeded",
            "Manager operation expired before mutation admission. Check its exact status before retrying.");
          return;
        }
        if (/mutations are paused|recovery is in progress/i.test(String(error?.message || error?.details || ""))) {
          unavailable(res, "disaster_restore_in_progress", "Saved work is protected. The system is recovering and is not accepting changes yet.");
          return;
        }
        throw error;
      }
      const lease = maintainMutationLease({ supabase, requestId: leaseId, serviceName, heartbeatMilliseconds, logger });
      const abortFromRequest = () => lease.abort(requestSignal?.reason);
      requestSignal?.addEventListener("abort", abortFromRequest, { once: true });
      if (requestSignal?.aborted) abortFromRequest();
      let disconnectTerminationTimer = null;
      let settled = false;
      const settleMutation = () => {
        if (settled) return Promise.resolve();
        settled = true;
        requestSignal?.removeEventListener("abort", abortFromRequest);
        if (disconnectTerminationTimer) clearTimeout(disconnectTerminationTimer);
        lease.abort(new Error("The mutation response settled; no trailing external work remains authorized."));
        return lease.release().catch(() => logger.error("Failed to release application mutation lease.", { request_id: leaseId, service_name: serviceName }));
      };
      req.restoreMutationLease = Object.freeze({
        requestId: leaseId,
        signal: lease.signal,
        assertActive: lease.assertActive,
      });
      // A disconnected Node response does not subsequently emit `finish`, even
      // when the route's awaited work later settles. Wrap end as the route
      // settlement boundary so that cooperative work releases its lease after a
      // disconnect. A route that never settles cannot safely release its lease:
      // terminate the owning process after a bounded grace period, retain the
      // lease until expiry, and require exact signed process-termination cleanup.
      if (typeof res.end === "function") {
        const originalEnd = res.end;
        res.end = function restoreMutationLeaseEnd(...args) {
          try {
            return originalEnd.apply(this, args);
          } finally {
            void settleMutation();
          }
        };
      }
      const releaseOnFinishedResponse = settleMutation;
      const abortOnDisconnectedResponse = () => {
        if (res.writableFinished || settled) return;
        lease.abort();
        if (!disconnectTerminationTimer) {
          disconnectTerminationTimer = setTimeout(() => {
            logger.error("Disconnected mutation did not settle; terminating its owning process without releasing the lease.", {
              request_id: leaseId,
              service_name: serviceName,
            });
            terminateUnsettledProcess({ requestId: leaseId, serviceName, exitCode: 70 });
          }, disconnectTerminationMilliseconds);
          disconnectTerminationTimer.unref?.();
        }
      };
      res.once?.("finish", releaseOnFinishedResponse);
      res.once?.("close", abortOnDisconnectedResponse);
      if (requestSignal?.aborted) {
        await settleMutation();
        unavailable(res, "static_weekly_recurring_operation_deadline_exceeded",
          "Manager operation expired before authority work began. Check its exact status before retrying.");
        return;
      }
      next();
    } catch {
      unavailable(res, "restore_gate_unavailable", "Saved work is protected. This service cannot confirm that changes are currently allowed.");
    }
  };
}
