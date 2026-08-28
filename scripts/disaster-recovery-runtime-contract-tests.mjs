#!/usr/bin/env node

import assert from "node:assert/strict";
import { loadRecoveryRuntimeContract, validateRecoveryRuntimeConfiguration } from "./disaster-recovery-runtime-contract.mjs";

const commit = "a".repeat(40);
const projectRef = "abcdefghijklmnopqrst";
const contract = loadRecoveryRuntimeContract(new URL("../release/disaster-recovery-runtime-contract.json", import.meta.url));
const releaseIdentity = { release_id: "release-1", backend_commit: commit, frontend_commit: "b".repeat(40), migration_head: "20260827151000" };
const environment = (name) => Object.fromEntries(Object.entries(contract.services[name].required_non_secret_environment).map(([key, value]) => [
  key,
  value === "$SUPABASE_PROJECT_URL" ? `https://${projectRef}.supabase.co` : value,
]));
const service = (name) => ({
  service_id: `srv-${name}`,
  deployment_id: `dep-${name}`,
  deployment_commit: commit,
  public_url: `https://${name}.example.test`,
  build_command: contract.services[name].build_command,
  start_command: contract.services[name].start_command,
  liveness_path: contract.services[name].liveness_path,
  readiness_path: contract.services[name].readiness_path,
  non_secret_environment: environment(name),
  required_secret_presence: Object.fromEntries(contract.services[name].required_secret_presence.map((key) => [key, true])),
});
const configuration = {
  format: "memphis-zoo.disaster-recovery-runtime-configuration.v1",
  project_ref: projectRef,
  release_id: releaseIdentity.release_id,
  backend_commit: commit,
  frontend_commit: releaseIdentity.frontend_commit,
  migration_head: releaseIdentity.migration_head,
  services: { backend: service("backend"), static_weekly_control_plane: service("static_weekly_control_plane") },
  dependencies: {
    supabase_project_ref: projectRef,
    backend_render_service_id: "srv-backend",
    static_weekly_render_service_id: "srv-static_weekly_control_plane",
    frontend_origin: "https://frontend.example.test",
    attendance_origin: "https://attendance.example.test",
  },
};
assert.deepEqual(validateRecoveryRuntimeConfiguration({ contract, configuration, releaseIdentity, projectRef }), configuration);
assert.deepEqual(validateRecoveryRuntimeConfiguration({ contract, configuration, releaseIdentity, projectRef }), configuration,
  "reviewed backup tooling is independently attributable and need not already be the deployed release");
assert.throws(() => validateRecoveryRuntimeConfiguration({ contract, configuration: { ...configuration, api_secret: "do-not-archive" }, releaseIdentity, projectRef }), /must contain exactly/);
assert.throws(() => validateRecoveryRuntimeConfiguration({
  contract,
  configuration: {
    ...configuration,
    services: {
      ...configuration.services,
      backend: {
        ...configuration.services.backend,
        required_secret_presence: {
          ...configuration.services.backend.required_secret_presence,
          EXTRA_DATABASE_PASSWORD: "plaintext-archive-leak",
        },
      },
    },
  },
  releaseIdentity,
  projectRef,
}), /must contain exactly/);
assert.throws(() => validateRecoveryRuntimeConfiguration({
  contract,
  configuration: {
    ...configuration,
    services: {
      ...configuration.services,
      static_weekly_control_plane: {
        ...configuration.services.static_weekly_control_plane,
        non_secret_environment: {
          ...configuration.services.static_weekly_control_plane.non_secret_environment,
          SUPABASE_URL: undefined,
        },
      },
    },
  },
  releaseIdentity,
  projectRef,
}), /SUPABASE_URL is missing or differs/);
assert.throws(() => validateRecoveryRuntimeConfiguration({ contract, configuration: { ...configuration, services: { ...configuration.services, backend: { ...configuration.services.backend, deployment_commit: "c".repeat(40) } } }, releaseIdentity, projectRef }), /exact live release commit/);
console.log("DISASTER_RECOVERY_RUNTIME_CONTRACT_TESTS_PASS");
