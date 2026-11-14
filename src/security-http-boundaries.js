// Public readiness needs the status, not dependency, canary, or release details.
export function healthResponse(req, diagnostics) {
  if(req.path === '/admin-api/release-monitor/dependencies')return {
    ok:diagnostics.ok===true,process_alive:diagnostics.process_alive===true,
    backend_commit_sha:diagnostics.backend_commit_sha,read_authority_ready:diagnostics.read_authority_ready,
    database_reachable:diagnostics.database_reachable,required_schema_present:diagnostics.required_schema_present,
    worker:{backlog:diagnostics.worker?.backlog,dead_letters:diagnostics.worker?.dead_letters,expired_leases:diagnostics.worker?.expired_leases},
    release_canary:{configured:diagnostics.release_canary?.configured,control_initialized:diagnostics.release_canary?.control_initialized,paused:diagnostics.release_canary?.paused},
  };
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

// Machine observer projection; never contains a credential, device identifier or work record.
export function releaseMonitorAuthority(data){
  return {ok:data?.ok===true,authority:data?.authority,canonical_objects_expected:data?.canonical_objects_expected,
    missing_objects:data?.missing_objects,mismatched_objects:data?.mismatched_objects,checks:data?.checks};
}
