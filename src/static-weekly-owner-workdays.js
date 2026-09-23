import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync(new URL('../config/custodial-owner-workdays.json', import.meta.url), 'utf8'));
if (policy.schema !== 'custodial.owner-recurring-workdays.v1') throw new Error('owner workday policy schema mismatch');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = (message) => Object.assign(new Error(message), {code: 'static_weekly_owner_workdays_mismatch'});

// Validate recurring source facts; never rewrite accepted history or infer an
// absence from a display string. Dated exceptions remain the existing compiler's job.
export function assertOwnerRecurringWorkdays(input, serviceDate = input?.serviceDate) {
  const slots = Array.isArray(input?.slots) ? input.slots : [];
  const versions = input?.version ? [input.version] : input?.versions;
  for (const rule of policy.rules) {
    const matched = slots.flatMap(slot => (slot.incumbencies || [])
      .filter(person => person.personId === rule.employeeId)
      .map(person => ({slot, person})));
    if (!matched.length) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate || '')) throw fail('Dated source required for owner workday validation.');
    if (serviceDate < rule.appliesFrom) continue;
    const active = matched.filter(({person}) => person.effectiveStart <= serviceDate
      && (!person.effectiveEnd || serviceDate < person.effectiveEnd));
    if (!active.length) continue; // Do not revive an ended historical incumbent.
    if (active.length !== 1 || active[0].slot.id !== rule.slotId) throw fail(`${rule.displayName}: current stable identity is inconsistent.`);
    if (!Array.isArray(versions) || versions.length !== 1) throw fail('Exactly one recurring version is required.');
    const rows = (versions[0].slotAvailability || []).filter(row => row.slotId === rule.slotId);
    const days = rows.filter(row => row.status === 'working').map(row => row.dayOfWeek).sort((a,b) => a-b);
    if (new Set(rows.map(row => row.dayOfWeek)).size !== rows.length
      || !equal(days, rule.workDays)) throw fail(`${rule.displayName} must work Monday, Tuesday, Wednesday, Friday and Saturday; Sunday and Thursday are off. Correct and verify the recurring source before publication.`);
  }
  return true;
}
