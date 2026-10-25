import { isAvailableOriginalCompletionEvidence } from "./completion-selection-read-boundary.js";
// Mounted only behind the existing named-manager read middleware. The SQL RPC
// repeats named-manager and backend-secret checks; this module never broadens
// employee, anonymous, or direct-table access.
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

export function makeCompletionEvidenceReader({ runRpc, managerId, backendSecret }) {
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
      const manager = managerId(req);
      if (!manager) {
        return res.status(403).json({ ok: false, error: "A named manager is required." });
      }
      const data = await runRpc("custodial_manager_completion_evidence", {
        p_manager_id: manager,
        p_session_uuid: sessionUuid,
        p_backend_execution_secret: backendSecret(),
      });
      if (data?.session_uuid !== sessionUuid || typeof data?.completion_recorded !== "boolean"
          || !isAvailableOriginalCompletionEvidence(data)) {
        throw new Error("Exact completion evidence read was not confirmed.");
      }
      return res.status(200).json({ ok: true, contract_version: "completion-evidence.v1", data });
    } catch (error) {
      const status = error?.code === "P0002" ? 404 : error?.code === "42501" || error?.status === 403 ? 403 : 503;
      return res.status(status).json({
        ok: false,
        error: status === 404 ? "Cleaning session not found."
          : status === 403 ? "Named manager authority is required."
            : "Exact completion evidence is unavailable. No record was changed.",
      });
    }
  };
}
