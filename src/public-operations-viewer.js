// Anonymous Operations Center responses expose only these aggregate fields.
// Keep the boundary here even if the database snapshot later gains columns.
const COUNTS = Object.freeze([
  'locations_total', 'locations_current', 'locations_overdue',
  'locations_due_soon', 'locations_in_progress', 'cleanings_completed_today',
]);

export function publicOperationsDashboard(snapshot) {
  const source = Array.isArray(snapshot) ? snapshot[0] : snapshot;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const data = {};
  if (typeof source.status === 'string' && /^[A-Za-z_ -]{1,40}$/.test(source.status)) data.status = source.status;
  if (typeof source.generated_at === 'string' && Number.isFinite(Date.parse(source.generated_at))) data.generated_at = source.generated_at;
  if (typeof source.operational_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.operational_date)) data.operational_date = source.operational_date;
  for (const field of COUNTS) {
    if (Number.isSafeInteger(source[field]) && source[field] >= 0) data[field] = source[field];
  }
  return data;
}
