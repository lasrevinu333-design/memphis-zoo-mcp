import assert from 'node:assert/strict';

export function releaseMonitorEndpointPlan({backendUrl, frontendReleaseUrl, frontendDeploymentUrl, identityUrl,
  healthUrl, authorityHealthUrl, schedulerReadyUrl, schemaToken}) {
  const cleanUrl = (value, allowQuery=false) => {
    const url = new URL(value);
    assert.equal(url.protocol, 'https:', 'Monitor requires HTTPS.');
    assert.equal(url.username + url.password + (allowQuery?'':url.search) + url.hash, '', 'Monitor URL cannot contain credentials, queries or fragments.');
    return url;
  };
  const backend = cleanUrl(backendUrl);
  const fixed = (value, path) => {
    const url = cleanUrl(value || new URL(path, backend));
    assert.equal(url.origin, backend.origin, 'Monitor credentials cannot leave the canonical backend origin.');
    assert.equal(url.pathname, path, 'Monitor requires the protected release-observer diagnostic route.');
    return url.href;
  };
  const scheduler = cleanUrl(schedulerReadyUrl);
  assert.ok(['/ready','/health'].includes(scheduler.pathname), 'Monitor requires the scheduler readiness route.');
  const headers = { authorization: `Bearer ${schemaToken}` };
  return [
    { id:'frontend_release', url:cleanUrl(frontendReleaseUrl,true).href },
    { id:'frontend_deployment', url:cleanUrl(frontendDeploymentUrl,true).href },
    { id:'backend_release', url:backend.href },
    { id:'schema_identity', url:fixed(identityUrl, '/admin-api/release-schema-identity'), headers },
    { id:'backend_dependencies', url:fixed(healthUrl, '/admin-api/release-monitor/dependencies'), headers },
    { id:'authority_health', url:fixed(authorityHealthUrl, '/admin-api/release-monitor/authority'), headers },
    { id:'scheduler_readiness', url:scheduler.href },
    { id:'dashboard_canary', url:fixed(null, '/admin-api/release-monitor/dashboard-canary'), headers },
  ];
}

export async function observeReleaseEndpoints(plan, fetchImpl = fetch) {
  return Promise.all(plan.map(async ({id,url,headers}) => {
    const started = performance.now(), observed = {id,started_at:new Date().toISOString(),http:null};
    let json;
    try {
      const response = await fetchImpl(url, { cache:'no-store', redirect:'error', headers:{accept:'application/json', ...headers},
        signal:AbortSignal.timeout(30000) });
      observed.http = response.status;
      const age = response.headers?.get('age');
      if (typeof age === 'string' && /^\d{1,9}$/.test(age)) observed.cache_age_seconds = Number(age);
      if (!response.ok) observed.state = 'http_failure';
      else {
        try {
          json = await response.json();
          if (!json || typeof json !== 'object' || Array.isArray(json)) observed.state = 'invalid_json';
          else {
            observed.state = 'received';
            if (typeof json.ok === 'boolean') observed.ok = json.ok;
            if (id === 'scheduler_readiness' && typeof json.data?.ready === 'boolean') observed.ready = json.data.ready;
          }
        } catch (error) {
          observed.state = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'invalid_json';
        }
      }
    } catch (error) {
      observed.state = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'transport_failure';
    }
    observed.observed_at = new Date().toISOString();
    const elapsedMs=performance.now()-started;
    observed.elapsed_ms=Math.round(elapsedMs);
    return { json, observed, elapsedMs };
  }));
}

export function assertSchedulerObservation(scheduler, schedulerAttestation, applicationAttestation) {
  for (const key of ['release_id','frontend_commit_sha','schema_fingerprint']) {
    assert.equal(schedulerAttestation[key], applicationAttestation[key], `scheduler ${key} differs from the signed application identity`);
  }
  assert.equal(scheduler.ok, true, 'static weekly scheduler readiness is not green');
  assert.equal(scheduler.data?.ready, true, 'static weekly scheduler authority is not ready');
  assert.equal(scheduler.data?.solver?.available, true, 'static weekly HiGHS solver is unavailable');
  for (const field of ['release_id','backend_commit_sha','backend_tree_sha','frontend_commit_sha','schema_fingerprint']) {
    assert.equal(scheduler.release_identity?.[field], schedulerAttestation[field], `static weekly scheduler ${field} is not the signed exact scheduler identity`);
  }
}
