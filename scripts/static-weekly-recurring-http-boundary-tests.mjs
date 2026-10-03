import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recurringHttpSqlBoundary,recurringHttpTransportFailure,captureRecurringHttpTransportFailure,
 rethrowOriginalTransportError,recurringHttpCompilerProbe,createRecurringClockRecorder,
 runRecurringClockedChild} from './static-weekly-recurring-http-boundary.mjs';

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
let resultGetterReads=0;
const accessorResult={get lunchDocument(){resultGetterReads++;throw Error('diagnostic getter failed');}};
const accessorResultEvents=[];
assert.equal(await recurringHttpCompilerProbe(async()=>accessorResult,phase=>accessorResultEvents.push(phase))(input,args,options),accessorResult);
assert.equal(resultGetterReads,0);
assert.deepEqual(accessorResultEvents,['compiler_prepare_start:projection','compiler_prepare_complete:projection:lunch_unknown']);
let documentGetterReads=0;
const accessorDocument={lunchDocument:{get document_identity(){documentGetterReads++;return 'private identity';}}};
assert.equal(await recurringHttpCompilerProbe(async()=>accessorDocument,()=>{})(input,args,options),accessorDocument);
assert.equal(documentGetterReads,0);
let argsGetterReads=0,prepareCalls=0;
const hostileArgs={get kind(){argsGetterReads++;return 'projection';}};
const hostileEvents=[];
assert.equal(await recurringHttpCompilerProbe(async(_,received)=>{
 prepareCalls++;assert.equal(received,hostileArgs);assert.equal(received.kind,'projection');return result;
},phase=>hostileEvents.push(phase))(input,hostileArgs),result);
assert.equal(prepareCalls,1);assert.equal(argsGetterReads,1);
assert.deepEqual(hostileEvents,['compiler_prepare_start:other','compiler_prepare_complete:other:lunch_not_applicable']);
let proxyTraps=0;
const proxiedArgs=new Proxy({kind:'projection'},{
 getPrototypeOf(target){proxyTraps++;return Reflect.getPrototypeOf(target);},
 getOwnPropertyDescriptor(target,key){proxyTraps++;return Reflect.getOwnPropertyDescriptor(target,key);},
 get(target,key,receiver){proxyTraps++;return Reflect.get(target,key,receiver);}
});
const proxyEvents=[];
assert.equal(await recurringHttpCompilerProbe(async(_,received)=>{assert.equal(received,proxiedArgs);return result;},
 phase=>proxyEvents.push(phase))(input,proxiedArgs),result);
assert.equal(proxyTraps,0);
assert.deepEqual(proxyEvents,['compiler_prepare_start:other','compiler_prepare_complete:other:lunch_not_applicable']);
assert.equal(await recurringHttpCompilerProbe(async()=>hostileResult,()=>{throw Error('trace failed');})(input,args,options),hostileResult);
assert.throws(()=>recurringHttpCompilerProbe(null,()=>{}),/compiler preparer required/);
const clockFacts=[],ticks=[1_000_000,1_000_125];
const stageClock=createRecurringClockRecorder({now:()=>ticks.shift(),deadlineMilliseconds:1_200_000,
 emit:fact=>clockFacts.push(fact)});
const exactArgs=['scripts/static-weekly-current-roster-publication-tests.mjs'];
const exactOptions={timeout:1_200_000,env:{STAGE:'synthetic'},stdio:'inherit'};
let childCalls=0;
const childValue={status:'unchanged'};
assert.equal(runRecurringClockedChild(()=>{childCalls++;assert.deepEqual(exactArgs,
 ['scripts/static-weekly-current-roster-publication-tests.mjs']);
 assert.deepEqual(exactOptions,{timeout:1_200_000,env:{STAGE:'synthetic'},stdio:'inherit'});return childValue;},stageClock),childValue);
assert.equal(childCalls,1);
assert.equal(runRecurringClockedChild(()=>childValue,null),childValue,'non-manager child path unchanged');
assert.deepEqual(clockFacts,[
 {phase:'published_child_spawn',outcome:'STARTED',epochMilliseconds:1_000_000,
  originEpochMilliseconds:1_000_000,elapsedMilliseconds:0,deadlineEpochMilliseconds:2_200_000},
 {phase:'published_child_terminal',outcome:'RETURNED',epochMilliseconds:1_000_125,
  originEpochMilliseconds:1_000_000,elapsedMilliseconds:125,deadlineEpochMilliseconds:2_200_000}]);
const thrown=new Error('original child failure'),failedFacts=[];
const failedClock=createRecurringClockRecorder({now:(()=>{let t=5_000;return()=>t++;})(),
 deadlineMilliseconds:1_200_000,emit:fact=>failedFacts.push(fact)});
assert.throws(()=>runRecurringClockedChild(()=>{throw thrown;},failedClock),error=>error===thrown);
assert.deepEqual(failedFacts.map(f=>[f.phase,f.outcome]),
 [['published_child_spawn','STARTED'],['published_child_terminal','THREW']]);
assert.throws(()=>runRecurringClockedChild(()=>{throw thrown;},{mark(){throw Error('clock sink failed');}}),
 error=>error===thrown);
assert.equal(runRecurringClockedChild(()=>childValue,{mark(){throw Error('clock sink failed');}}),childValue);
assert.equal(createRecurringClockRecorder({now(){throw Error('clock unavailable');}}).mark('confirm_origin','STARTED'),null);
assert.equal(createRecurringClockRecorder({now:()=>Infinity}).mark('confirm_origin','STARTED'),null);
const finite=[];const confirmClock=createRecurringClockRecorder({now:(()=>{let t=42_000;return()=>t+=10;})(),
 emit:fact=>{finite.push(fact);throw Error('stdout unavailable');}});
confirmClock.mark('confirm_origin','STARTED');
confirmClock.mark('confirm_response_closed','UNFINISHED');
confirmClock.mark('confirm_request_terminal','THREW');
assert.deepEqual(finite.map(f=>[f.phase,f.outcome,f.elapsedMilliseconds]),
 [['confirm_origin','STARTED',0],['confirm_response_closed','UNFINISHED',10],
  ['confirm_request_terminal','THREW',20]]);
assert.equal(confirmClock.mark('secret_operation_id','STARTED'),null);
assert.equal(confirmClock.mark('confirm_origin','private bearer'),null);
assert.doesNotMatch(JSON.stringify(finite),/private|secret|bearer|synthetic/);
const runnerSource=readFileSync(new URL('./run-isolated-shift-end-tests.mjs',import.meta.url),'utf8');
const httpSource=readFileSync(new URL('./static-weekly-recurring-confirmation-http-integration.mjs',import.meta.url),'utf8');
const compilerRuntimeSource=readFileSync(new URL('../src/static-weekly-schedule-compiler-runtime.js',import.meta.url),'utf8');
const programSource=readFileSync(new URL('../src/static-weekly-schedule-program.js',import.meta.url),'utf8');
const launcherSource=readFileSync(new URL('./static-weekly-recurring-browser-lease-launcher.py',import.meta.url),'utf8');
assert.match(runnerSource,/timeout:currentManagerStage\|\|process\.env\.STATIC_WEEKLY_TEST_RECURRING_FINALIZATION==='1'\|\|process\.env\.STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION==='1'\?1200000:900000/);
assert.match(programSource,/REQUEST_DEADLINE_MILLISECONDS = 300_000/);
assert.match(compilerRuntimeSource,/requestMilliseconds: REQUEST_DEADLINE_MILLISECONDS \+ 15_000/);
assert.match(launcherSource,/bounded_stream\(child, log, started \+ 1800/);
assert.match(runnerSource,/runRecurringClockedChild\(\(\)=>execFileSync\(process\.execPath/);
assert.match(runnerSource,/catch\(error\)\{console\.error\('FAILED_TEST_STAGE',stage,error\.stderr\?\.toString\(\)\|\|error\.stack\);throw error;\}finally\{cleanup\(\);\}/);
for(const phase of ['confirm_origin','confirm_response_closed','confirm_request_terminal','confirm_fixture_finally',
 'confirm_process_exit'])assert.ok(httpSource.includes(`'${phase}'`),phase);
for(const cleanup of ['requestAdapter.close()','server.close(','await plane.close()',
 "assert.equal(checkedOut,0,'all SQL clients released')"])assert.ok(httpSource.includes(cleanup),cleanup);
console.log('PASS recurring HTTP bounded SQL, transport, compiler and clock observation',cases.length+41);
