import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const preparation = readFileSync(new URL('../supabase/migrations/20261004150151_native_alert_two_stage_preparation.sql', import.meta.url), 'utf8');
const finalization = readFileSync(new URL('../supabase/migrations/20261004150425_native_alert_finalization.sql', import.meta.url), 'utf8');
let checks = 0;
function check(source, pattern) { assert.match(source, pattern); checks++; }
function rejectMutation(source, pattern, mutation) {
  const changed = source.replace(pattern, mutation);
  assert.notEqual(changed, source);
  assert.doesNotMatch(changed, pattern);
  checks++;
}
for (const source of [preparation, finalization]) {
  check(source, /begin;[\s\S]*set local search_path=pg_catalog,public;[\s\S]*commit;/);
  check(source, /enable row level security;[\s\S]*force row level security;/);
  check(source, /revoke all on table [\s\S]*from public,anon,authenticated,service_role/);
  check(source, /revoke all on function [\s\S]*from public,anon,authenticated,service_role/);
}
check(preparation, /create table public\.employee_native_alert_preparations/);
check(preparation, /before update or delete[\s\S]*custodial_native_location_append_only/);
check(preparation, /claim:=public\.mz_claim_employee_event_push_delivery\(/);
check(preparation, /projection:=public\.mz_employee_event_push_current_projection\(/);
check(preparation, /claim:=public\.mz_prepare_employee_native_push_delivery\(/);
check(preparation, /jsonb_typeof\(claim->'message_projection'\) is distinct from 'object'/);
check(preparation, /select \* into prep from public\.employee_native_alert_preparations where job_id=p_job for update;/);
check(preparation, /'dispatch_authorized',false,'prepared_id',prep\.preparation_id/);
check(preparation, /grant execute on function public\.custodial_native_alert_target\(uuid,uuid\),[\s\S]*public\.custodial_native_alert_prepare\(uuid,uuid,jsonb\) to service_role;/);
check(finalization, /create table public\.employee_native_alert_finalizations/);
check(finalization, /select \* into legacy from public\.employee_native_push_delivery_receipts where job_id=p_job for update;/);
check(finalization, /legacy\.delivery_state<>'prepared'/);
check(finalization, /select \* into t from public\.msg_threads where id=target_thread_id for update;/);
check(finalization, /r\.acknowledged_at is not null/);
check(finalization, /msg_message_deletions/);
check(finalization, /msg_thread_visibility/);
check(finalization, /projection:=public\.mz_employee_event_push_current_projection\(/);
check(finalization, /public\.custodial_native_alert_message_current\(p_job,prep\.source_projection,at_time\)/);
check(finalization, /projection is distinct from prep\.source_projection/);
check(finalization, /prior\.job_id is not null then[\s\S]*'delivery_outcome_unknown',true/);
check(finalization, /'reservation_at',public\.custodial_native_location_utc\(at_time\)/);
check(finalization, /'valid_until',public\.custodial_native_location_utc\(until_time\)/);
check(finalization, /public\.static_weekly_digest_text\(public\.custodial_native_location_canonical\(data\)\)/);
check(finalization, /if octet_length\(public\.custodial_native_location_canonical\(data\)\)>3500/);
check(finalization, /grant execute on function public\.custodial_native_alert_finalize\(uuid,uuid,uuid,jsonb,jsonb\),[\s\S]*public\.custodial_native_alert_record_outcome\(uuid,uuid,jsonb\) to service_role;/);
check(finalization, /create table public\.employee_native_alert_outcomes/);
check(finalization, /trg_employee_native_alert_outcomes_immutable/);
check(finalization, /employee_native_alert_outcomes force row level security/);
check(finalization, /native_alert_original_finalization_no_resend/);
check(finalization, /native alert outcome conflict/);
for (const [source,pattern] of [
  [preparation,/claim:=public\.mz_claim_employee_event_push_delivery\(/],
  [preparation,/claim:=public\.mz_prepare_employee_native_push_delivery\(/],
  [finalization,/legacy\.delivery_state<>'prepared'/],
  [finalization,/public\.custodial_native_alert_message_current\(p_job,prep\.source_projection,at_time\)/],
  [finalization,/projection is distinct from prep\.source_projection/],
  [finalization,/'delivery_outcome_unknown',true/],
  [finalization,/'valid_until',public\.custodial_native_location_utc\(until_time\)/],
]) rejectMutation(source,pattern,'removed_source_guard(');
assert.doesNotMatch(finalization,/p_candidate->>'(?:reservation_at|valid_until|content_sha256)'/);checks++;
assert.doesNotMatch(preparation,/grant execute on function [\s\S]*to anon|grant execute on function [\s\S]*to authenticated/);checks++;
console.log(JSON.stringify({ok:true,checks,scope:'source-contract-only; no SQL execution'}));
