export function sqlStateHttpStatus(sqlState) {
  const state = String(sqlState || "").trim();
  if (["42501", "28000"].includes(state)) return 403;
  if (state === "P0002") return 404;
  if (["22023", "22003", "22007", "22008", "22P02"].includes(state)) return 422;
  if (["23505", "23514", "23P01", "0A000", "40901"].includes(state)) return 409;
  if (["40001", "40P01", "55P03"].includes(state)) return 503;
  return 500;
}

export function rpcFailure(error, functionName) {
  const failure = new Error(error?.message || `RPC failed: ${functionName}`);
  failure.code = String(error?.code || error?.sqlstate || "").trim() || undefined;
  failure.sqlstate = failure.code;
  failure.status = sqlStateHttpStatus(failure.code);
  failure.retryable = ["40001", "40P01", "55P03"].includes(failure.code);
  return failure;
}

export function authorityHttpFailure(error, fallback) {
  const status = Number(error?.status) || sqlStateHttpStatus(error?.code || error?.sqlstate);
  return {
    status,
    body: {
      ok: false,
      error: String(error?.message || fallback),
      code: error?.code || error?.sqlstate || "internal_error",
      retryable: error?.retryable === true,
    },
  };
}

// Canonical authority commands intentionally return durable terminal outcomes
// for malformed or fenced evidence instead of throwing and rolling back their
// reconciliation record.  Transport must classify those returned outcomes as
// failures just as faithfully as SQLSTATE failures.
export function authorityHttpOutcome(data) {
  const result = data && typeof data === "object" ? data : {};
  const status = String(result.status || "").trim().toLowerCase();
  const reason = String(result.reason || "").trim();
  const replayed = result.replayed === true;
  if (status === "closed" || result.committable === true) {
    return {
      status: 200,
      body: {
        ok: true,
        outcome: replayed ? "replayed" : "accepted",
        retryable: false,
        data: result,
      },
    };
  }
  if (status === "quarantined" || result.terminal === true || result.automatic_replay_fenced === true) {
    const changedContent = reason === "payload_fingerprint_conflict";
    // Content changes and fenced/replayed commands are conflicts.  Malformed
    // evidence is invalid input: it was retained for manager recovery, but it
    // must not be disguised as a successful or conflict-free request.
    const conflict = changedContent || /conflict|overlap|mismatch|loss|fenced/i.test(reason);
    return {
      status: conflict ? 409 : 422,
      body: {
        ok: false,
        outcome: changedContent ? "changed_content" : (result.automatic_replay_fenced === true ? "fenced" : "quarantined"),
        code: reason || "offline_authority_quarantined",
        retryable: false,
        error: "The offline authority command was quarantined for manager recovery.",
        data: result,
      },
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      outcome: "unknown_authority_outcome",
      code: "offline_authority_unknown_outcome",
      retryable: false,
      error: "The offline authority command returned an unrecognized outcome.",
      data: result,
    },
  };
}

export function malformedScanAuthorityOutcome({ deviceQuarantined }) {
  return deviceQuarantined ? {
    status: 422,
    body: {
      ok: false,
      outcome: "quarantined",
      error: "Malformed or oversized scan JSON was durably quarantined for manager recovery.",
      code: "malformed_scan_quarantined",
      retryable: false,
    },
  } : {
    status: 422,
    body: {
      ok: false,
      outcome: "rejected",
      error: "Malformed or oversized scan JSON was rejected before a durable device quarantine could be created.",
      code: "malformed_scan_rejected",
      retryable: false,
    },
  };
}
