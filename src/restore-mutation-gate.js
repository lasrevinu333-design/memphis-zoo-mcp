const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function unavailable(res, code, error, state = null) {
  res.status(503).json({
    ok: false,
    code,
    error,
    work_saved: true,
    retryable: false,
    ...(state ? { restore: state } : {}),
  });
}

export function makeRestoreMutationGate({ supabase, required = true, cacheMs = 1000, now = () => Date.now() } = {}) {
  let cached = null;
  let cachedAt = 0;

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
      const currentTime = now();
      // Never cache an open gate: the restore operator must be able to pause
      // the next mutation without a stale-open race. A paused result may be
      // cached briefly because delayed resumption is safe and fail closed.
      if (!cached || cached.mutations_paused !== true || currentTime - cachedAt >= cacheMs) {
        const { data, error } = await supabase.rpc("custodial_restore_runtime_state");
        if (error) throw error;
        if (!data || typeof data !== "object" || typeof data.mutations_paused !== "boolean") {
          throw new Error("The restore authority response is invalid.");
        }
        cached = data;
        cachedAt = currentTime;
      }
      if (cached.mutations_paused) {
        unavailable(
          res,
          "disaster_restore_in_progress",
          "Saved work is protected. The system is recovering and is not accepting changes yet.",
          {
            authority_generation: cached.authority_generation,
            state: cached.state,
            restore_id: cached.restore_id,
          },
        );
        return;
      }
      next();
    } catch {
      cached = null;
      cachedAt = 0;
      unavailable(res, "restore_gate_unavailable", "Saved work is protected. This service cannot confirm that changes are currently allowed.");
    }
  };
}
