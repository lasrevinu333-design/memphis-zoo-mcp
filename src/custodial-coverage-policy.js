// OC24-01: there is no automatic absence threshold. Retain the export as an
// explicit null for older readers; it must never be used to assign capacity.
export const COVERALL_STARTS_AT_ABSENCE_NUMBER = null;

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

// Absences identify uncovered work, not permission to call or assign CoverAll.
// Actual contractor capacity comes only from the manager's dated addition.
export function partitionCustodialAbsences(orderedAbsentEmployeeIds = []) {
  const ordered = orderedUniqueIds(orderedAbsentEmployeeIds);
  const internallyRedistributedEmployeeIds = [...ordered];
  const coverAllEmployeeIds = [];
  return {
    triggered: false,
    absentCount: ordered.length,
    orderedAbsentEmployeeIds: ordered,
    internallyRedistributedEmployeeIds,
    coverAllEmployeeIds,
  };
}
