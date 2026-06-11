#!/usr/bin/env node
import assert from 'node:assert/strict';
import { DEMO_PLAN, LEADERSHIP_DEMO_PLAN, buildRunPlan } from './thursday-notification-presentation.mjs';

const plan = buildRunPlan({ skip: [] });
const ids = plan.map((item) => item.device_id);

assert.deepEqual(ids, ['KIOSK_02', 'KIOSK_04', 'KIOSK_06', 'KIOSK_07', 'KIOSK_09', 'KIOSK_10', 'KIOSK_05']);
assert.equal(ids.at(-1), 'KIOSK_05', 'Daniel must stay included, but his notification must run last in case he is absent and Eric does not have the phone at the meeting');
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

assert.equal(LEADERSHIP_DEMO_PLAN.length, 2, 'Leadership demo overlay must add exactly Jennifer and Clayton');
assert(LEADERSHIP_DEMO_PLAN.every((item) => !/Director|Chief|Officer|Operations/i.test(item.employee_name)), 'Leadership notification identities must be name-only, no titles for TTS');
assert.deepEqual(LEADERSHIP_DEMO_PLAN.map((item) => item.device_id), ['KIOSK_03', 'KIOSK_08']);
assert.equal(LEADERSHIP_DEMO_PLAN.find((item) => item.device_id === 'KIOSK_03')?.employee_name, 'Jennifer Sheffield');
assert.equal(LEADERSHIP_DEMO_PLAN.find((item) => item.device_id === 'KIOSK_08')?.employee_name, 'Clayton Jones');

const leadershipPlan = buildRunPlan({ includeLeadershipDemo: true });
const leadershipIds = leadershipPlan.map((item) => item.device_id);
assert.deepEqual(leadershipIds.slice(0, 2), ['KIOSK_03', 'KIOSK_08'], 'Leadership phones should be first when intentionally included');
assert.equal(leadershipIds.at(-1), 'KIOSK_05', 'Daniel must remain last even when leadership phones are included');
assert.equal(leadershipPlan.length, plan.length + 2, 'Leadership demo adds two phones to the default notification plan');
assert(leadershipPlan.some((item) => item.device_id === 'KIOSK_08' && item.location_name === "West Admin Upstairs Men's Restroom"), 'Clayton demo should include the requested West Admin upstairs mens restroom example');

const skippedLeadershipByName = buildRunPlan({ includeLeadershipDemo: true, skip: ['Clayton Jones'] });
assert(!skippedLeadershipByName.some((item) => item.employee_name === 'Clayton Jones'), 'Leadership phones can be skipped by temporary name');

console.log(JSON.stringify({ ok: true, plan_count: plan.length, leadership_plan_count: leadershipPlan.length, checked: ['target_exclusions', 'notification_mix', 'daniel_optional_skip', 'daniel_runs_last', 'leadership_demo_opt_in', 'leadership_tts_name_only'] }, null, 2));
