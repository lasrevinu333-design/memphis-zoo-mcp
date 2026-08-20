export async function runCanonicalScanRpc(runRpc, prepared) {
  if (typeof runRpc !== "function") {
    throw Object.assign(new Error("Canonical scan transport is unavailable."), {
      status: 503,
      code: "canonical_scan_transport_unavailable",
    });
  }
  const fn = String(prepared?.fn || "").trim();
  if (!fn || !prepared?.args || typeof prepared.args !== "object" || Array.isArray(prepared.args)) {
    throw Object.assign(new Error("Canonical scan command is incomplete."), {
      status: 503,
      code: "canonical_scan_command_incomplete",
    });
  }
  return runRpc(fn, prepared.args);
}
