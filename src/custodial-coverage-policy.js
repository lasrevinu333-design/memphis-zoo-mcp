export const COVERALL_STARTS_AT_ABSENCE_NUMBER = 2;

function orderedUniqueIds(values = []) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const id = String(value || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

// Absence order is operational evidence: the first recorded absence is spread
// across the remaining zoo staff; the second and every later absence are the
// workloads for which CoverAll capacity is requested.
export function partitionCustodialAbsences(orderedAbsentEmployeeIds = []) {
  const ordered = orderedUniqueIds(orderedAbsentEmployeeIds);
  const internallyRedistributedEmployeeIds = ordered.slice(0, COVERALL_STARTS_AT_ABSENCE_NUMBER - 1);
  const coverAllEmployeeIds = ordered.slice(COVERALL_STARTS_AT_ABSENCE_NUMBER - 1);
  return {
    triggered: coverAllEmployeeIds.length > 0,
    absentCount: ordered.length,
    orderedAbsentEmployeeIds: ordered,
    internallyRedistributedEmployeeIds,
    coverAllEmployeeIds,
  };
}
