import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const migration = await readFile(
  new URL('supabase/migrations/20260922050000_lunch_delivery_failure_manager_alert.sql', root),
  'utf8',
);

assert.match(
  migration,
  /ops_manager_notification_queue_type[\s\S]*lunch_delivery_failure/,
  'manager queue must explicitly admit lunch-delivery failures',
);
assert.match(migration, /ops_manager_enqueue_lunch_delivery_failure/);
assert.match(migration, /job_type is distinct from 'employee_native_push'/);
assert.match(migration, /v_data->>'kind' is distinct from 'employee_lunch_coverage'/);
assert.match(migration, /v_data->>'notification_type' is distinct from 'lunch_coverage'/);
assert.match(migration, /v_job\.status is distinct from 'dead'/);
assert.match(
  migration,
  /manager-lunch-delivery-failure:'\|\|v_job\.job_id::text\|\|':'\|\|pd\.credential_id::text/,
  'manager alert identity must be stable per terminal employee job and manager credential',
);
assert.match(migration, /pd\.enabled=true and pd\.revoked_at is null/);
assert.match(migration, /td\.revoked_at is null and td\.expires_at>p_now/);
assert.match(migration, /manager\.active=true and manager\.revoked_at is null/);
assert.match(migration, /manager\.is_system_principal=false/);
assert.match(migration, /on conflict\(job_key\) do nothing/);
assert.match(
  migration,
  /perform public\.ops_manager_enqueue_lunch_delivery_failure\(v_row\.job_id,now\(\)\);/,
  'terminal completion must enqueue the manager alert in the same database transaction',
);
assert.doesNotMatch(
  migration,
  /jsonb_build_object\([\s\S]{0,1000}'last_error'/,
  'manager alert payload must not expose raw provider errors',
);
assert.doesNotMatch(
  migration,
  /body[\s\S]{0,800}p_error/,
  'manager alert body must not expose the raw terminal error',
);
assert.match(migration, /custodial_release_authority_restore_inventory/);
assert.match(migration, /ops_manager_notification_queue:ops_manager_notification_queue_type/);
assert.match(migration, /finish_operational_notification_job_terminal\(uuid,uuid,text\)/);

console.log('lunch-delivery-failure-contract-tests: PASS');
