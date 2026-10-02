// Mounted only behind the existing named-manager read middleware. The SQL RPC
// repeats named-manager and backend-secret checks; this module never broadens
// employee, anonymous, or direct-table access.
const sessionIdentity = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;

export function makeCompletionEvidenceReader({ runRpc, managerId, backendSecret }) {
  if (typeof runRpc !== "function" || typeof managerId !== "function" || typeof backendSecret !== "function") {
    throw new Error("Completion evidence reader requires the existing manager authority adapters.");
  }
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const sessionUuid = String(req.params?.sessionUuid || "");
    if (!sessionIdentity.test(sessionUuid)) {
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
      if (data?.session_uuid !== sessionUuid || typeof data?.completion_recorded !== "boolean") {
        throw new Error("Exact completion evidence read was not confirmed.");
      }
      return res.status(200).json({ ok: true, contract_version: "completion-evidence.v1", data });
    } catch (error) {
      const status = error?.code === "P0002" ? 404 : error?.code === "42501" ? 403 : 503;
      return res.status(status).json({
        ok: false,
        error: status === 404 ? "Cleaning session not found."
          : status === 403 ? "Named manager authority is required."
            : "Exact completion evidence is unavailable. No record was changed.",
      });
    }
  };
}
