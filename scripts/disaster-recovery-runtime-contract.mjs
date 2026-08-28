import { readFileSync } from "node:fs";
import { stableJson } from "./disaster-recovery-crypto.mjs";

function text(value) { return typeof value === "string" ? value.trim() : ""; }
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(object(value, label)).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new Error(`${label} must contain exactly: ${required.join(", ")}.`);
  }
}

function publicHttpsUrl(value, label) {
  let url;
  try { url = new URL(text(value)); } catch { throw new Error(`${label} must be a public HTTPS URL.`); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be a public HTTPS URL without credentials, query, or fragment.`);
  }
  return url.toString().replace(/\/$/, "");
}

function expectedEnvironmentValue(expected, { projectRef }) {
  if (expected === "$SUPABASE_PROJECT_URL") return `https://${projectRef}.supabase.co`;
  return text(expected);
}

export function loadRecoveryRuntimeContract(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateRecoveryRuntimeConfiguration({ contract, configuration, releaseIdentity, projectRef }) {
  object(contract, "Recovery runtime contract");
  object(configuration, "Recovery runtime configuration");
  if (contract.format !== "memphis-zoo.disaster-recovery-runtime-contract.v1") throw new Error("Recovery runtime contract format is unsupported.");
  if (configuration.format !== "memphis-zoo.disaster-recovery-runtime-configuration.v1") throw new Error("Recovery runtime configuration format is unsupported.");
  exactKeys(configuration, ["format", "project_ref", "release_id", "backend_commit", "frontend_commit", "migration_head", "services", "dependencies"], "Recovery runtime configuration");
  if (text(configuration.project_ref) !== projectRef) throw new Error("Recovery runtime configuration names a different Supabase project.");
  if (text(configuration.release_id) !== text(releaseIdentity.release_id)
      || text(configuration.backend_commit).toLowerCase() !== text(releaseIdentity.backend_commit).toLowerCase()
      || text(configuration.frontend_commit).toLowerCase() !== text(releaseIdentity.frontend_commit).toLowerCase()
      || text(configuration.migration_head) !== text(releaseIdentity.migration_head)) {
    throw new Error("Recovery runtime configuration is not bound to the deployed database release identity.");
  }
  const services = object(configuration.services, "Recovery runtime services");
  const serviceContracts = object(contract.services, "Recovery runtime contract services");
  exactKeys(services, Object.keys(serviceContracts), "Recovery runtime services");
  for (const [serviceName, serviceContract] of Object.entries(serviceContracts)) {
    const service = object(services[serviceName], `Recovery runtime service ${serviceName}`);
    exactKeys(service, ["service_id", "deployment_id", "deployment_commit", "public_url", "build_command", "start_command", "liveness_path", "readiness_path", "non_secret_environment", "required_secret_presence"], `Recovery runtime service ${serviceName}`);
    if (text(service.deployment_commit).toLowerCase() !== text(releaseIdentity.backend_commit).toLowerCase()) {
      throw new Error(`${serviceName} is not deployed from the exact live release commit recorded by production.`);
    }
    if (!/^[a-zA-Z0-9_-]{3,160}$/.test(text(service.service_id)) || !/^[a-zA-Z0-9_-]{3,200}$/.test(text(service.deployment_id))) {
      throw new Error(`${serviceName} is missing its recoverable service, deployment, or public URL identity.`);
    }
    publicHttpsUrl(service.public_url, `${serviceName} public URL`);
    for (const field of ["build_command", "start_command", "liveness_path", "readiness_path"]) {
      if (text(service[field]) !== text(serviceContract[field])) throw new Error(`${serviceName} ${field} differs from the source-controlled recovery contract.`);
    }
    const environment = object(service.non_secret_environment, `${serviceName} non-secret environment`);
    const requiredEnvironment = serviceContract.required_non_secret_environment || {};
    exactKeys(environment, Object.keys(requiredEnvironment), `${serviceName} non-secret environment`);
    for (const [name, expected] of Object.entries(requiredEnvironment)) {
      if (text(environment[name]) !== expectedEnvironmentValue(expected, { projectRef })) throw new Error(`${serviceName} non-secret environment ${name} is missing or differs.`);
    }
    const secretPresence = object(service.required_secret_presence, `${serviceName} secret presence`);
    const requiredSecrets = serviceContract.required_secret_presence || [];
    exactKeys(secretPresence, requiredSecrets, `${serviceName} secret presence`);
    for (const name of requiredSecrets) {
      if (secretPresence[name] !== true) throw new Error(`${serviceName} secret presence ${name} is not confirmed.`);
    }
  }
  const dependencies = object(configuration.dependencies, "Recovery runtime dependencies");
  exactKeys(dependencies, contract.required_dependencies || [], "Recovery runtime dependencies");
  for (const name of contract.required_dependencies || []) {
    if (!text(dependencies[name])) throw new Error(`Recovery runtime dependency ${name} is missing.`);
  }
  if (text(dependencies.supabase_project_ref) !== projectRef) throw new Error("Recovery dependency inventory names a different Supabase project.");
  if (text(dependencies.backend_render_service_id) !== text(services.backend.service_id)
      || text(dependencies.static_weekly_render_service_id) !== text(services.static_weekly_control_plane.service_id)) {
    throw new Error("Recovery dependency inventory does not match the recorded Render services.");
  }
  for (const name of ["frontend_origin", "attendance_origin"]) publicHttpsUrl(dependencies[name], `Recovery runtime dependency ${name}`);
  return JSON.parse(stableJson(configuration));
}
