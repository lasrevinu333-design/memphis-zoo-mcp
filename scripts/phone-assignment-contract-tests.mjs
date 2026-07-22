import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [routes, migration, leadership] = await Promise.all([
  readFile(new URL('../src/phone-assignment-routes.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260722134000_phone_employee_reassignment.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/leadership-bootstrap.js', import.meta.url), 'utf8'),
]);

assert.match(routes, /leadership-api\/phone-assignments/);
assert.match(routes, /requireCustodial/);
assert.match(routes, /ops_reassign_employee_phone/);
assert.match(routes, /expected_current_employee_id/);
assert.match(routes, /new_employee_name/);
assert.match(routes, /deactivate_previous/);
assert.match(routes, /KIOSK_\(\?:0\[2-9\]\|10\)/);
assert.match(migration, /create table if not exists public\.employee_phone_assignment_events/);
assert.match(migration, /create or replace function public\.ops_reassign_employee_phone/);
assert.match(migration, /msg_device_assignments/);
assert.match(migration, /msg_hidden_threads_by_device/);
assert.match(migration, /msg_ensure_employee_memphis_threads/);
assert.match(migration, /Finish or force-close the active cleaning/);
assert.match(migration, /Deactivated during phone reassignment/);
assert.match(migration, /revoke all on function public\.ops_reassign_employee_phone/);
assert.match(migration, /grant execute on function public\.ops_reassign_employee_phone.*service_role/s);
assert.match(leadership, /installPhoneAssignmentRoutes/);

console.log('PHONE_ASSIGNMENT_CONTRACT_PASS');
