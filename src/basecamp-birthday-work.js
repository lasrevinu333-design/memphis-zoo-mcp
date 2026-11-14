// Supplemental, honor-based party work. It never changes a scan route, shift,
// lunch, recurring target, or cleaning completion. The access note is a private
// runtime input and must never enter an event, public projection, or speech.
export const BASECAMP_WORK_SCHEMA = 'custodial.basecamp-birthday-work.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NATIVE_ORIGINS = new Set(['https://localhost', 'http://localhost', 'capacitor://localhost', 'ionic://localhost']);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
  && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const chicagoDate = value => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'})
    .formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max
  && !/[\u0000-\u001f\u007f]/.test(value);

function nativeOwner(req, day, assignment) {
  const device = req?.memphisDevice, credential = req?.memphisDeviceCredential;
  const origin = req?.headers?.origin, edition = req?.headers?.['x-memphis-app-edition'];
  if (!device || !credential || !NATIVE_ORIGINS.has(origin) || edition !== 'custodial'
    || !UUID.test(credential.credential_id || '') || !UUID.test(day?.employee_id || '')
    || device.assigned_employee_id !== day.employee_id || !date(day.service_date)
    || !UUID.test(day.projection_id || '') || !UUID.test(day.publication_id || '')
    || day.projection_status !== 'current' || !day.shift || typeof day.shift.start !== 'string' || typeof day.shift.end !== 'string'
    || !UUID.test(assignment?.canonical_device_pk || '')
    || credential.device_id !== assignment.canonical_device_pk
    || !Number.isSafeInteger(Number(assignment.assignment_epoch)) || Number(assignment.assignment_epoch) < 1
    || Number(device.assignment_epoch) !== Number(assignment.assignment_epoch)) return null;
  const shift = day.shift, shiftStart = shift.start, shiftEnd = shift.end;
  const binding = Object.freeze({
    service_date: day.service_date, employee_id: day.employee_id,
    publication_id: day.publication_id, projection_id: day.projection_id,
    canonical_device_pk: assignment.canonical_device_pk,
    credential_id: credential.credential_id, assignment_epoch: Number(assignment.assignment_epoch),
  });
  const current = () => req.memphisDevice === device && req.memphisDeviceCredential === credential
    && req.headers?.origin === origin && req.headers?.['x-memphis-app-edition'] === edition
    && device.assigned_employee_id === binding.employee_id
    && Number(device.assignment_epoch) === binding.assignment_epoch
    && credential.credential_id === binding.credential_id && credential.device_id === binding.canonical_device_pk
    && assignment.canonical_device_pk === binding.canonical_device_pk
    && Number(assignment.assignment_epoch) === binding.assignment_epoch
    && day.employee_id === binding.employee_id && day.service_date === binding.service_date
    && day.publication_id === binding.publication_id && day.projection_id === binding.projection_id
    && day.projection_status === 'current' && day.shift === shift && shift.start === shiftStart && shift.end === shiftEnd;
  return {binding, current};
}

function workRows(value, binding) {
  if (!value || value.schema !== BASECAMP_WORK_SCHEMA || value.state !== 'current'
    || !['service_date', 'employee_id', 'publication_id', 'projection_id'].every(key => value[key] === binding[key])
    || !Array.isArray(value.items) || value.items.length > 32) throw Error('birthday_work_unverified');
  const seen = new Set();
  return value.items.map(item => {
    if (!item || !UUID.test(item.event_id || '') || seen.has(item.event_id.toLowerCase())
      || !Number.isSafeInteger(item.event_revision) || item.event_revision < 1
      || item.display_name !== 'Safari Basecamp' || item.honor_based !== true || item.nfc_required !== false
      || !instant(item.party_start) || !instant(item.party_end)
      || Date.parse(item.party_start) >= Date.parse(item.party_end)
      || !(item.voice_notice_state === 'planned' && instant(item.voice_notice_at) && chicagoDate(item.voice_notice_at) === binding.service_date
        || item.voice_notice_state === 'withheld' && item.voice_notice_at === null)
      || chicagoDate(item.party_start) !== binding.service_date
      || !text(item.cleaning_instruction, 500)) throw Error('birthday_work_unverified');
    seen.add(item.event_id.toLowerCase());
    // Explicit allowlist: raw email, ticket text, contacts, and caller-supplied
    // notes never become either the assignment or its private access note.
    return {
      event_id: item.event_id, event_revision: item.event_revision, display_name: 'Safari Basecamp',
      party_start: item.party_start, party_end: item.party_end,
      cleaning_instruction: item.cleaning_instruction, voice_notice_at: item.voice_notice_at, voice_notice_state: item.voice_notice_state,
      honor_based: true, nfc_required: false,
    };
  });
}

export async function readBasecampBirthdayWork({req, day, assignment, runReadOnlySql, env = process.env}) {
  const owner = nativeOwner(req, day, assignment);
  // Manager/public/browser responses omit the entire field, not a redacted
  // copy which could later accidentally acquire the runtime note.
  if (!owner) return undefined;
  const {binding, current} = owner;
  const unavailable = () => ({schema: BASECAMP_WORK_SCHEMA, ...binding, state: 'unavailable', items: []});
  try {
    if (!current() || typeof runReadOnlySql !== 'function') return undefined;
    const sql = `select public.custodial_basecamp_birthday_work('${binding.service_date}'::date,` +
      `'${binding.employee_id}'::uuid,'${binding.publication_id}'::uuid,'${binding.projection_id}'::uuid) as work`;
    const rows = await runReadOnlySql(sql);
    if (!current()) return undefined;
    if (!Array.isArray(rows) || rows.length !== 1) throw Error('birthday_work_unverified');
    const items = workRows(rows[0]?.work, binding);
    // Read the private input only after current, exact source/owner admission.
    const accessNote = items.length ? String(env.CUSTODIAL_BASECAMP_ACCESS_NOTE || '').trim() : '';
    const usableNote = text(accessNote, 1000);
    if (!current()) return undefined;
    return {schema: BASECAMP_WORK_SCHEMA, ...binding,
      state: items.length && !usableNote ? 'access_note_unavailable' : 'current',
      items: items.map(item => ({...item, access_note: usableNote ? accessNote : null}))};
  } catch {
    // This optional source cannot strand the ordinary published schedule or
    // replace it with an apparently empty authoritative plan.
    return current() ? unavailable() : undefined;
  }
}
