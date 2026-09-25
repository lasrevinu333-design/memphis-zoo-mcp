#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COVERALL_STARTS_AT_ABSENCE_NUMBER,partitionCustodialAbsences} from '../src/custodial-coverage-policy.js';
// OC24-01 supersedes the earlier third-absence formula. Historical SQL remains
// unchanged; the forward migration retires its RPC rather than rewriting history.
assert.equal(COVERALL_STARTS_AT_ABSENCE_NUMBER,null);
for(let n=0;n<=9;n++){
 const ids=Array.from({length:n},(_,i)=>'employee-'+i);
 assert.deepEqual(partitionCustodialAbsences([...ids,...ids]),{triggered:false,absentCount:n,
  orderedAbsentEmployeeIds:ids,internallyRedistributedEmployeeIds:ids,coverAllEmployeeIds:[]});
}
const api=readFileSync(new URL('../src/schedule-api.js',import.meta.url),'utf8');
const region=api.slice(api.indexOf('  async function buildCoverAllPlan('),api.indexOf('  async function importPtoRows('));
assert.match(region,/partitionCustodialAbsences/);
assert.match(region,/coverall_manual_addition_required/);
assert.doesNotMatch(region,/app_apply_coverall_assignment_policy_v2|await runRpc|await runCommand/);
const manual=api.slice(api.indexOf('router.post("/coverall/slots"'),api.indexOf('router.post("/coverall/links"'));
assert.match(manual,/requireSchedulePin/);
assert.match(manual,/publishCoverAllSlotsForDate/);
assert.match(api,/if \(requestedCoverAllSlots\.length\) \{\s*coverallManual = await publishCoverAllSlotsForDate/);
const migration=readFileSync(new URL('../supabase/migrations/20260924161004_owner_oc24_cleaning_and_inspection_boundaries.sql',import.meta.url),'utf8');
assert.match(migration,/CoverAll must be added manually through an accepted dated schedule/);
assert.match(migration,/revoke all on function public\.app_apply_coverall_assignment_policy_v2\(jsonb\) from public,anon,authenticated,service_role/);
console.log('OC24_MANUAL_COVERALL_POLICY_PASS');
