import { readFileSync } from 'node:fs';
import { isIsoServiceDate, snapshotDatedRosterSlot } from './static-weekly-schedule-model.js';

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
    if (!isIsoServiceDate(serviceDate)) throw fail('Dated source required for owner workday validation.');
    const monday = new Date(`${serviceDate}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const dates = Array.from({length: 7}, (_, offset) => {
      const day = new Date(monday); day.setUTCDate(day.getUTCDate() + offset);
      return { date: day.toISOString().slice(0, 10), dayOfWeek: day.getUTCDay() };
    });
    const ownedDays = dates.filter(({date}) => {
      if (date < rule.appliesFrom) return false;
      const active = matched.filter(({person}) => person.effectiveStart <= date
        && (!person.effectiveEnd || date < person.effectiveEnd));
      if (active.length && (active.length !== 1 || active[0].slot.id !== rule.slotId)) {
        throw fail(`${rule.displayName}: current stable identity is inconsistent.`);
      }
      return active.length === 1;
    });
    if (!ownedDays.length) continue; // No ownership anywhere in this week; never revive history.
    if (!Array.isArray(versions) || versions.length !== 1) throw fail('Exactly one recurring version is required.');
    const version = versions[0];
    const rows = (version.slotAvailability || []).filter(row => row.slotId === rule.slotId);
    const slot = slots.find(item => item.id === rule.slotId);
    // The SQL reader hydrates one recurring template into dated ownership. A
    // Wednesday closure legitimately masks Wed-Sun, not the retained Mon-Tue.
    // Resolve the same dated identities as the compiler, including capability
    // and overlap checks, before comparing only this employee's occupied days.
    for (const {date, dayOfWeek} of dates) {
      if (date < rule.appliesFrom) continue;
      let incumbent;
      try {
        incumbent = snapshotDatedRosterSlot(slot, date, {
          vacancyCapable: (version.vacancyCapableSlotIds || []).includes(rule.slotId),
          declaredVacant: (version.vacantSlotIds || []).includes(rule.slotId),
        });
      } catch {
        throw fail(`${rule.displayName}: dated stable identity is inconsistent.`);
      }
      const row = rows.find(item => item.dayOfWeek === dayOfWeek);
      if (row && (incumbent.vacant ? row.status !== 'vacant_unfilled' : row.status === 'vacant_unfilled')) {
        throw fail(`${rule.displayName}: dated availability does not match stable-slot ownership.`);
      }
    }
    const ownedWeekdays = new Set(ownedDays.map(day => day.dayOfWeek));
    const days = rows.filter(row => ownedWeekdays.has(row.dayOfWeek) && row.status === 'working')
      .map(row => row.dayOfWeek).sort((a,b) => a-b);
    const expectedDays = rule.workDays.filter(day => ownedWeekdays.has(day));
    if (rows.some(row => !Number.isInteger(row.dayOfWeek) || row.dayOfWeek < 0 || row.dayOfWeek > 6)
      || new Set(rows.map(row => row.dayOfWeek)).size !== rows.length
      || !equal(days, expectedDays)) throw fail(`${rule.displayName} must work Monday, Tuesday, Wednesday, Friday and Saturday; Sunday and Thursday are off. Correct and verify the recurring source before publication.`);
  }
  return true;
}
