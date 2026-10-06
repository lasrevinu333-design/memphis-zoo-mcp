// Event civil times are America/Chicago wall-clock facts. Never let Date or
// PostgreSQL silently choose an instant in a DST gap/fold on a manager's behalf.
const ZONE = 'America/Chicago';
const formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
  timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function components(instant) {
  const parts = Object.fromEntries(formatter.formatToParts(instant)
    .filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  return [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second];
}

function localParts(date, time) {
  const day = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const clock = String(time || '').match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!day || !clock) throw new Error('An ISO event date and HH:MM:SS time are required.');
  const values = [...day.slice(1), ...clock.slice(1)].map(Number);
  const [year, month, dayOfMonth, hour, minute, second] = values;
  const checked = new Date(Date.UTC(year, month - 1, dayOfMonth, hour, minute, second));
  if (checked.getUTCFullYear() !== year || checked.getUTCMonth() + 1 !== month
    || checked.getUTCDate() !== dayOfMonth || hour > 23 || minute > 59 || second > 59) {
    throw new Error('Event local date or time is invalid.');
  }
  return values;
}

function offsetLabel(minutes) {
  const sign = minutes < 0 ? '−' : '+';
  const absolute = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

export function chicagoLocalTimeOptions(date, time) {
  const expected = localParts(date, time);
  const [year, month, day, hour, minute, second] = expected;
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsets = new Set();
  for (const hours of [-36, -12, 12, 36]) {
    const probe = naiveUtc + hours * 3_600_000;
    const [y, m, d, h, min, s] = components(new Date(probe));
    offsets.add((Date.UTC(y, m - 1, d, h, min, s) - probe) / 60_000);
  }
  const choices = [...offsets].filter(Number.isInteger).map((offsetMinutes) => {
    const instant = new Date(naiveUtc - offsetMinutes * 60_000);
    return components(instant).every((part, index) => part === expected[index])
      ? { instant_utc: instant.toISOString(), utc_offset_minutes: offsetMinutes } : null;
  }).filter(Boolean).sort((a, b) => a.instant_utc.localeCompare(b.instant_utc));
  return choices.map((choice, index) => ({ ...choice,
    label: `${choices.length > 1 ? `${index === 0 ? 'First' : index === 1 ? 'Second' : `Occurrence ${index + 1}`} occurrence · ` : ''}${offsetLabel(choice.utc_offset_minutes)} · ${choice.instant_utc}`,
  }));
}

export function resolveChicagoEventInterval({ event_date, end_date, start_time, end_time,
  start_instant_utc, end_instant_utc }) {
  const startChoices = chicagoLocalTimeOptions(event_date, start_time);
  const endChoices = chicagoLocalTimeOptions(end_date, end_time);
  if (!startChoices.length || !endChoices.length) {
    const field = !startChoices.length ? 'start' : 'end';
    throw Object.assign(new Error(`The ${field} time does not exist in America/Chicago on this date because the clock jumps forward. Choose another local time.`),
      { code: 'NONEXISTENT_EVENT_TIME', status: 422, details: { field } });
  }
  const missing = {};
  if (startChoices.length > 1 && !start_instant_utc) missing.start = startChoices;
  if (endChoices.length > 1 && !end_instant_utc) missing.end = endChoices;
  if (Object.keys(missing).length) {
    throw Object.assign(new Error('This America/Chicago time occurs twice when clocks fall back. Select the first or second UTC occurrence for each ambiguous time, then preview again.'),
      { code: 'AMBIGUOUS_EVENT_TIME', status: 422, details: { choices: missing } });
  }
  function selectedInstant(value, choices, field) {
    const requested = value ? new Date(value) : null;
    const iso = requested && !Number.isNaN(requested.getTime()) ? requested.toISOString() : null;
    const selected = value ? choices.find((choice) => choice.instant_utc === iso) : choices[0];
    if (!selected) throw Object.assign(new Error(`Selected ${field} instant does not match the current America/Chicago date and time. Preview the time again.`),
      { code: 'INVALID_EVENT_INSTANT', status: 422, details: { field, choices } });
    return selected;
  }
  const start = selectedInstant(start_instant_utc, startChoices, 'start');
  const end = selectedInstant(end_instant_utc, endChoices, 'end');
  if (end.instant_utc <= start.instant_utc) {
    throw Object.assign(new Error('Event end instant must be after its start instant. Check the date and first/second occurrence choices.'),
      { code: 'INVALID_EVENT_INTERVAL', status: 422, details: { start, end } });
  }
  return { start, end, start_choices: startChoices, end_choices: endChoices };
}
