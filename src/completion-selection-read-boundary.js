// Read-boundary grammar matches custodial_oc24_service_trim/assert_completion_selection.
// Historical "selective" keeps its original spelling and individual-service semantics.
// This predicate never normalizes, trims, mutates or reconstructs a stored receipt.
export function hasCanonicalCompletionSelection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || !Array.isArray(value.services_performed)) return false;
  const services = value.services_performed;
  if (value.work_result === "checked_no_cleaning_needed") return services.length === 0;
  const individual = service => typeof service === "string"
    && service.trim().length > 0 && service.trim().toLowerCase() !== "full cleaning services";
  if (value.work_result === "full") return services.length === 1
    && typeof services[0] === "string"
    && services[0].trim().toLowerCase() === "full cleaning services";
  if (value.work_result === "details" || value.work_result === "selective")
    return services.length > 0 && services.every(individual);
  return false;
}

export function isAvailableOriginalCompletionEvidence(data) {
  if (data?.completion_recorded !== true) return true;
  const original = data.original_response;
  if (!original || typeof original !== "object" || Array.isArray(original)) return false;
  if (!Object.hasOwn(original, "work_result")) {
    // Preserve the SQL reader's explicit unclassified historical record; it is
    // not promoted to a current/native canonical completion.
    return data.classification === "historical_or_unverified_completion"
      && data.native_exact_receipt_admitted === false && data.work_result == null;
  }
  return data.work_result === original.work_result && hasCanonicalCompletionSelection(original);
}
