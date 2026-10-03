import assert from 'node:assert/strict';
import {recurringHttpSqlBoundary} from './static-weekly-recurring-http-boundary.mjs';

const cases=[
 ['begin','begin'],['commit','commit'],['rollback','rollback'],
 ['set local role static_weekly_control_plane','set_local_role'],
 ['select public.custodial_begin_application_mutation()','restore_generation_fence'],
 ['select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))','authority_lock'],
 ['select public.static_weekly_v13_begin_recurring_confirmation($1,$2) as result','static_weekly_v13_begin_recurring_confirmation'],
 ['select public.static_weekly_v23_finalize_recurring_confirmation($1,$2) as result','static_weekly_v23_finalize_recurring_confirmation'],
 ['select 1',null],
 ["select 'private secret' as value",null],
 ["select public.unrelated_secret_rpc('private secret')",null],
 ['select public.static_weekly_v13_begin_recurring_confirmation_suffix($1) as result','static_weekly_v13_begin_recurring_confirmation_suffix'],
];
for(const [sql,wanted] of cases)assert.equal(recurringHttpSqlBoundary(sql),wanted);
console.log('PASS recurring HTTP SQL boundary classifier',cases.length);
