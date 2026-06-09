#!/usr/bin/env node
import assert from 'node:assert/strict';
import { DEMO_PLAN, buildRunPlan } from './thursday-notification-presentation.mjs';

const plan = buildRunPlan({ skip: [] });
const ids = plan.map((item) => item.device_id);

assert.deepEqual(ids, ['KIOSK_02', 'KIOSK_04', 'KIOSK_05', 'KIOSK_06', 'KIOSK_07', 'KIOSK_09', 'KIOSK_10']);
assert(!ids.includes('KIOSK_01'), 'Ops Manager phone must not receive presentation notifications');
assert(!ids.includes('KIOSK_03'), 'Michael must not receive presentation notifications');
assert(!ids.includes('KIOSK_08'), 'Karen must not receive presentation notifications');
assert(plan.some((item) => item.kind === 'direct_message'), 'Plan must include a normal direct message notification');
assert(plan.some((item) => item.kind === 'event_reminder'), 'Plan must include an event reminder notification');
assert(plan.some((item) => item.kind === 'location_status' && item.status_code === 'due_soon' && item.form_type === 'restroom'), 'Plan must include a restroom due-soon location notification');
assert(plan.some((item) => item.kind === 'location_status' && item.status_code === 'overdue' && item.form_type === 'restroom'), 'Plan must include a restroom overdue location notification');
assert(plan.some((item) => item.kind === 'location_status' && item.status_code === 'due_soon' && item.form_type === 'exhibit'), 'Plan must include an exhibit due-soon location notification');
assert(plan.some((item) => item.kind === 'location_status' && item.status_code === 'overdue' && item.form_type === 'exhibit'), 'Plan must include an exhibit overdue location notification');
assert.equal(DEMO_PLAN.find((item) => item.device_id === 'KIOSK_05')?.employee_name, 'Daniel Morgan', 'Daniel stays included unless explicitly skipped');

const skippedDaniel = buildRunPlan({ skip: ['KIOSK_05'] });
assert(!skippedDaniel.some((item) => item.device_id === 'KIOSK_05'), 'Daniel can be skipped if Thursday PTO/attendance changes');

console.log(JSON.stringify({ ok: true, plan_count: plan.length, checked: ['target_exclusions', 'notification_mix', 'daniel_optional_skip'] }, null, 2));
