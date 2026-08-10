export function sqlStateHttpStatus(sqlState) {
  const state = String(sqlState || "").trim();
  if (["42501", "28000"].includes(state)) return 403;
  if (state === "P0002") return 404;
  if (["22023", "22003", "22007", "22008", "22P02"].includes(state)) return 422;
  if (["23505", "23514", "23P01", "0A000"].includes(state)) return 409;
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
