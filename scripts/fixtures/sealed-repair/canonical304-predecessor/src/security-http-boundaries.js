// Public readiness needs the status, not dependency, canary, or release details.
export function healthResponse(req, diagnostics) {
  return req.path === "/health"
    ? { ok: diagnostics.ok === true, process_alive: diagnostics.process_alive === true }
    : diagnostics;
}

export function requireHealthDiagnostics(requireManager) {
  return (req, res, next) => req.path === "/health" ? next() : requireManager(req, res, next);
}

export function setAllowedCorsOrigin(res, req, allowedOrigins) {
  const origin = String(req?.headers?.origin || "").trim();
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else {
    res.removeHeader("Access-Control-Allow-Origin");
    res.removeHeader("Access-Control-Allow-Credentials");
  }
  // Append rather than replacing existing cache-key dimensions.
  res.vary("Origin");
}
