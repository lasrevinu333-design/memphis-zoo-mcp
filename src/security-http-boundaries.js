// Match the same case/trailing-slash variants admitted by Express's GET route.
export function isReleaseMonitorRequest(req){
  return /^\/admin-api\/release-monitor\/(?:dependencies|authority|dashboard-canary)\/?$/i.test(String(req?.path||''));
}
// Public readiness needs the status, not dependency, canary, or release details.
export function healthResponse(req, diagnostics) {
  if(isReleaseMonitorRequest(req))return {
    ok:diagnostics.ok===true,process_alive:diagnostics.process_alive===true,
    backend_commit_sha:diagnostics.backend_commit_sha,read_authority_ready:diagnostics.read_authority_ready,
    database_reachable:diagnostics.database_reachable,required_schema_present:diagnostics.required_schema_present,
    worker:{backlog:diagnostics.worker?.backlog,dead_letters:diagnostics.worker?.dead_letters,
      expired_leases:diagnostics.worker?.expired_leases,exhausted_leases:diagnostics.worker?.exhausted_leases},
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
  const transport=data?.scan_rpc_transport;
  const reasons=['release_canary_not_required','canary_control_not_initialized','phone_transport_probe_missing',
    'fresh_paused_phone_probe','resume_bound_phone_probe'];
  return {ok:data?.ok===true,authority:data?.authority,canonical_objects_expected:data?.canonical_objects_expected,
    missing_objects:data?.missing_objects,mismatched_objects:data?.mismatched_objects,checks:data?.checks,
    scan_rpc_transport:{ready:transport?.ready===true,reason:reasons.includes(transport?.reason)?transport.reason:null}};
}
