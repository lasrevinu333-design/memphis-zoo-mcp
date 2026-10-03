import assert from 'node:assert/strict';
import {recurringHttpSqlBoundary,recurringHttpTransportFailure,captureRecurringHttpTransportFailure,
 rethrowOriginalTransportError,recurringHttpCompilerProbe} from './static-weekly-recurring-http-boundary.mjs';

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
const hostile=new Error('private token and URL');
Object.defineProperties(hostile,{name:{get(){throw Error('private name getter');}},code:{get(){throw Error('private code getter');}},
 cause:{get(){throw Error('private cause getter');}}});
assert.deepEqual(recurringHttpTransportFailure(hostile),{name:'OTHER',code:'OTHER',causeName:'OTHER',causeCode:'OTHER'});
let emitted=0,persisted=0;
const fact=captureRecurringHttpTransportFailure(hostile,{phase:'headers',elapsedMilliseconds:302513,
 emit(){emitted++;throw Error('emitter unavailable');},persist(){persisted++;throw Error('sidecar unavailable');}});
assert.deepEqual(fact,{phase:'headers',elapsedMilliseconds:302513,name:'OTHER',code:'OTHER',causeName:'OTHER',causeCode:'OTHER'});
assert.deepEqual([emitted,persisted],[1,1]);
assert.throws(()=>rethrowOriginalTransportError(hostile,()=>{throw Error('diagnostic failed');}),error=>error===hostile);
assert.throws(()=>rethrowOriginalTransportError(hostile,()=>captureRecurringHttpTransportFailure(hostile,{
 phase:'body',elapsedMilliseconds:1,emit(){throw Error('emitter failed');},persist(){throw Error('sidecar failed');}})),error=>error===hostile);
assert.doesNotMatch(JSON.stringify(fact),/private|token|URL/);
const events=[],input={secret:'must-not-print'},args={kind:'projection',operationId:'synthetic'},
 options={deadlineMilliseconds:315000},result={lunchDocument:{document_identity:'synthetic-private'}};
let count=0;
const observed=recurringHttpCompilerProbe(async function(...received){
 count++;assert.equal(received.length,3);assert.equal(received[0],input);
 assert.equal(received[1],args);assert.equal(received[2],options);return result;
},phase=>events.push(phase));
assert.equal(await observed(input,args,options),result);
assert.equal(count,1);
assert.deepEqual(events,['compiler_prepare_start:projection','compiler_prepare_complete:projection:lunch_present']);
assert.doesNotMatch(JSON.stringify(events),/secret|synthetic-private|operationId/);
const draftArgs={kind:'draft'};let draftArity=null;
const draft=recurringHttpCompilerProbe(async function(...received){draftArity=received.length;return {ok:true};},()=>{throw Error('diagnostic sink failed');});
assert.deepEqual(await draft(input,draftArgs),{ok:true});assert.equal(draftArity,2);
const original=new Error('private compiler error'),rejected=[];
const broken=recurringHttpCompilerProbe(async()=>{throw original;},phase=>rejected.push(phase));
await assert.rejects(()=>broken(input,args,options),error=>error===original);
assert.deepEqual(rejected,['compiler_prepare_start:projection','compiler_prepare_rejected:projection']);
const hostileResult={get lunchDocument(){throw Error('diagnostic getter failed');}};
assert.equal(await recurringHttpCompilerProbe(async()=>hostileResult,()=>{throw Error('trace failed');})(input,args,options),hostileResult);
const hostileArgs={get kind(){throw Error('private kind getter');}};
assert.equal(await recurringHttpCompilerProbe(async(_,received)=>{assert.equal(received,hostileArgs);return result;},()=>{})(input,hostileArgs),result);
assert.throws(()=>recurringHttpCompilerProbe(null,()=>{}),/compiler preparer required/);
console.log('PASS recurring HTTP bounded SQL, transport and compiler-preparation observation',cases.length+18);
