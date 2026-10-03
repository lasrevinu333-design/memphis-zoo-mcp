import assert from 'node:assert/strict';
import {recurringHttpSqlBoundary,recurringHttpTransportFailure} from './static-weekly-recurring-http-boundary.mjs';

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
const cause=Object.assign(new Error('private https://secret.invalid?token=hidden'),{name:'HeadersTimeoutError',code:'UND_ERR_HEADERS_TIMEOUT'});
const failure=Object.assign(new TypeError('private bearer hidden',{cause}),{code:'ETIMEDOUT'});
assert.deepEqual(recurringHttpTransportFailure(failure),{name:'TypeError',code:'ETIMEDOUT',
 causeName:'HeadersTimeoutError',causeCode:'UND_ERR_HEADERS_TIMEOUT'});
assert.deepEqual(recurringHttpTransportFailure({name:'private bearer hidden',code:'TOKEN_HIDDEN',
 cause:{name:'private url',code:'PRIVATE_TOKEN'}}),{name:'OTHER',code:'OTHER',causeName:'OTHER',causeCode:'OTHER'});
assert.deepEqual(recurringHttpTransportFailure(null),{name:'OTHER',code:'OTHER',causeName:'OTHER',causeCode:'OTHER'});
assert.doesNotMatch(JSON.stringify(recurringHttpTransportFailure(failure)),/secret|hidden|https/);
console.log('PASS recurring HTTP bounded boundary and transport classifiers',cases.length+4);
