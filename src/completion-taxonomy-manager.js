import { isCustodialLeadershipManagementSession } from "./auth/manager-permissions.js";
import { isAvailableOriginalCompletionEvidence } from "./completion-selection-read-boundary.js";
// Mounted behind the existing manager read middleware. Cohort reads use the
// authenticated same-transaction record bridge; named reads retain their RPC.
// PostgreSQL producer btrim removes ASCII U+0020 only. Persisted IDs are
// opaque UTF-8 text; preserve punctuation, whitespace and Unicode verbatim.
const sessionIdentity = value => {
  if (typeof value !== "string" || value.length === 0 || value.length > 400
      || value[0] === " " || value[value.length - 1] === " ") return false;
  let characters = 0;
  for (const scalar of value) {
    const point = scalar.codePointAt(0);
    if (point === 0 || (point >= 0xD800 && point <= 0xDFFF) || ++characters > 200) return false;
  }
  return true;
};

export function makeCompletionEvidenceReader({ runRpc, managerId, backendSecret, leadershipRecordBridge }) {
  if (typeof runRpc !== "function" || typeof managerId !== "function" || typeof backendSecret !== "function") {
    throw new Error("Completion evidence reader requires the existing manager authority adapters.");
  }
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const sessionUuid = Object.hasOwn(req.params || {}, "sessionUuid")
      ? req.params.sessionUuid : req.query?.session_uuid;
    if (!sessionIdentity(sessionUuid)) {
      return res.status(422).json({ ok: false, error: "An exact cleaning session identity is required." });
    }
    try {
      let data;
      if (req.memphisAuth?.auth_mode === "custodial_leadership_pin") {
        if (!isCustodialLeadershipManagementSession(req.memphisAuth)) {
          throw Object.assign(new Error("Manager authority denied."), {status: 403});
        }
        if (typeof leadershipRecordBridge !== "function") throw new Error("Record bridge unavailable.");
        data = await leadershipRecordBridge(req, "completion_evidence", {session_uuid: sessionUuid});
      } else {
        const manager = managerId(req);
        if (!manager) return res.status(403).json({ok: false, error: "A named manager is required."});
        data = await runRpc("custodial_manager_completion_evidence", {
          p_manager_id: manager,
          p_session_uuid: sessionUuid,
          p_backend_execution_secret: backendSecret(),
        });
      }
      if (data?.session_uuid !== sessionUuid || typeof data?.completion_recorded !== "boolean"
          || !isAvailableOriginalCompletionEvidence(data)) {
        throw new Error("Exact completion evidence read was not confirmed.");
      }
      return res.status(200).json({ ok: true, contract_version: "completion-evidence.v1", data });
    } catch (error) {
      const status = error?.code === "P0002" || error?.status === 404 ? 404 : error?.code === "42501" || error?.status === 403 ? 403 : 503;
      return res.status(status).json({
        ok: false,
        error: status === 404 ? "Cleaning session not found."
          : status === 403 ? "Current manager authority is required."
            : "Exact completion evidence is unavailable. No record was changed.",
      });
    }
  };
}
