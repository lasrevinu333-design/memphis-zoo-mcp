import { createHash } from "node:crypto";
import { verifyNativeDeviceRequestAttestation } from "./auth/device-credential-auth.js";

export function buildReleaseCanaryTransportProbeCall({
  req,
  deviceIdentifier,
  backendCommitSha,
  releaseId,
  nativeRouteProofSecret,
}) {
  const credentialId = String(req?.memphisDeviceCredential?.credential_id || "").trim();
  if (!credentialId || req?.memphisDeviceAuth?.credentialed !== true || req?.memphisDeviceAuth?.offline_recovery_only === true) {
    throw Object.assign(new Error("A current native canary credential is required for the release transport probe."), {
      status: 403,
      code: "release_canary_probe_credential_required",
    });
  }
  const nativeAttestation = req.memphisNativeRequestAttestation || verifyNativeDeviceRequestAttestation(req);
  const requestSha256 = createHash("sha256").update(req.scanAuthorityRawBody || Buffer.alloc(0)).digest("hex");
  return {
    fn: "custodial_record_release_canary_transport_probe",
    args: {
      p_device_identifier: deviceIdentifier,
      p_credential_id: credentialId,
      p_request_sha256: requestSha256,
      p_backend_commit_sha: backendCommitSha,
      p_release_id: releaseId,
      p_native_origin: String(req.headers?.origin || "").trim(),
      p_app_edition: String(req.headers?.["x-memphis-app-edition"] || "").trim(),
      p_native_request_id: nativeAttestation.request_id,
      p_native_request_timestamp: nativeAttestation.timestamp,
      p_native_request_attestation_sha256: createHash("sha256").update(nativeAttestation.signature, "utf8").digest("hex"),
      p_native_route_proof_secret: nativeRouteProofSecret,
    },
  };
}
