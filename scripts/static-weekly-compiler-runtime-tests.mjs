import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createStaticWeeklyCompilerRuntime } from "../src/static-weekly-schedule-compiler-runtime.js";
if(process.argv.includes('--approved-pending-missing-pattern-native-only')){
 const file=process.argv[process.argv.indexOf('--approved-pending-missing-pattern-native-only')+1];
 assert.ok(file&&!file.startsWith('--'),'The actual retained UNIT dispatch DATA is required.');
 const bytes=readFileSync(file),input=JSON.parse(bytes),original=JSON.stringify(input),runtime=createStaticWeeklyCompilerRuntime({exposeProcessIdentityForTest:true});
 let pid,startTicks;
 try{
  await assert.rejects(runtime.compileAndPrepare(input,{kind:'approved-pending-staffing'},
   {deadlineAtMilliseconds:performance.now()+25000}),error=>error.code==='static_template_missing_approved_pattern'
    &&error.message==='No release-admitted approved pattern matches the current staffing. The original request is preserved; nothing was accepted.');
  assert.equal(JSON.stringify(input),original);assert.deepEqual(readFileSync(file),bytes);
  const ready=runtime.getReadiness();pid=ready.worker?.processId;assert.ok(Number.isSafeInteger(pid));
  const stat=readFileSync('/proc/'+pid+'/stat','utf8');startTicks=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
 }finally{await runtime.shutdown();}
 let childState='ABSENT';try{const stat=readFileSync('/proc/'+pid+'/stat','utf8'),tail=stat.slice(stat.lastIndexOf(')')+2).split(' ');
  assert.equal(tail[19],startTicks,'The owned PID must not be silently replaced.');childState=tail[0];
  assert.ok(['Z','X'].includes(childState),'The runtime shutdown must leave no live owned child.');
 }catch(error){if(error.code!=='ENOENT'&&error.code!=='ESRCH')throw error;}
 console.log(JSON.stringify({selector:'approved-pending-missing-pattern-native-only',checks:1,actualChild:true,
  actualSQL:false,solver:false,originalInputUnchanged:true,ownedChildNotLive:true,childState,childPid:pid,wholeG18:false}));process.exit(0);
}
// New fixed-pending protocol controls only. The VM ports below are explicitly
// inert recordings: no process, solver, SQL, publication or manager authority.
if(process.argv.includes('--approved-pending-queue-protocol-only')||process.argv.includes('--approved-pending-queue-closure-only')||process.argv.includes('--approved-pending-current-error-boundary-only')||process.argv.includes('--approved-pending-profile-initialize-only')||process.argv.includes('--approved-pending-missing-pattern-only')){
 const {runInNewContext}=await import('node:vm'),{EventEmitter}=await import('node:events'),
  {captureApprovedPendingStaffingWorkerInput:captureInput,captureApprovedPendingStaffingWorkerResult:captureResult,
   captureApprovedPendingStaffingUnresolved:captureUnresolved}=await import('../src/static-weekly-staffing-preview.js'),
  {postgresJsonbContentDigest:pg}=await import('../src/static-weekly-schedule-compiler.js'),
  {enumerateStaffingServiceWindow}=await import('../src/static-weekly-staffing-preparation.js'),
  {STATIC_WEEKLY_FUSED_COMPILER_RESOURCE_LIMITS:limits}=await import('../src/static-weekly-schedule-runtime-policy.js');
 const missingOnly=process.argv.includes('--approved-pending-missing-pattern-only'),missingCases=new Set([
  'missing catalog runtime dependency is closed and sanitized, extra fields drain the child',
  'worker missing catalog code requires fixed original and inert own code, never raw DATA',
  'missing catalog error waits for original currentness before leaving the caller']),
  profileOnly=process.argv.includes('--approved-pending-profile-initialize-only'),errorOnly=process.argv.includes('--approved-pending-current-error-boundary-only'),closureOnly=process.argv.includes('--approved-pending-queue-closure-only'),closureCases=new Set([
  'typed unresolved preserved frozen; generic failures redacted; foreign response refused and drained',
  'profile transition and initialize wait for original queue and drain before replacement',
  'queued fixed request retains original absolute deadline, no second IPC after expiry']);
 let checks=0;const check=async(name,fn)=>{if(errorOnly&&name!=='unresolved diagnostics wait for actual caller rechecks and refuse malformed transport')return;
  if(missingOnly&&!missingCases.has(name))return;
  if(profileOnly&&name!=='profile transition and initialize wait for original queue and drain before replacement')return;
  if(closureOnly&&!closureCases.has(name))return;await fn();checks++;console.log('PASS NEW fixed-pending protocol DATA',name);},
  uuid=n=>'81000000-0000-4000-8000-'+String(n).padStart(12,'0'),clone=structuredClone;
 const inputFor=(n=1)=>{
  const semantic={absenceKind:'daily_absence',commandKind:'absence',employeeId:uuid(4),startDate:'2026-10-06',endDate:'2026-10-07',targetAbsenceId:null};
  return {schema:'custodial.approved-static-pending-staffing-worker-input.v1',
   command:{operation_id:uuid(n),prepared_by_manager_id:uuid(2),state:'PREPARING',expected_revision:42,
    semantic_body:semantic,semantic_digest:pg(semantic),current_service_date:'2026-10-05',original_cancellation_target:null},
   actor:{managerId:uuid(2),managerName:'INERT UNIT protocol actor'},managerId:uuid(2),weekStart:'2026-10-05',
   source:{publication_id:uuid(3),authority_revision:42},snapshot:{authority_revision:42,current_publication:{publication_id:uuid(3)}},
   window:enumerateStaffingServiceWindow(semantic.startDate,semantic.endDate),
   bases:['2026-10-06','2026-10-07'].map(date=>({schema:'custodial.approved-static-template-basis.v1',serviceDate:date,kind:'DATED_ABSENCE',
    publicationId:uuid(3),authorityRevision:42,generation:7,templateCatalogDigest:'a'.repeat(64),templateInputsDigest:'b'.repeat(64)}))};
 };
 const resultFor=input=>{
  const c=input.command,authority={schema:'custodial.approved-static-pending-staffing-authority.v1',solverInvoked:false,optimized:false},
   e={compiler_version:'approved-static-pending-staffing-v1',adapter:{schema:'custodial.approved-static-pending-staffing-adapter.v1'},
    authority,assignments:[],replay_digest:'c'.repeat(64),authority_digest:pg(authority),
    semantic_snapshot:{schema:'custodial.approved-static-pending-staffing-projection-snapshot.v1',
     originalCommand:{operationId:c.operation_id,preparerId:input.managerId,semanticBody:c.semantic_body,semanticDigest:c.semantic_digest,
      expectedRevision:42,currentServiceDate:c.current_service_date,originalCancellationTarget:null},
     originalSource:input.source,weekStart:input.weekStart,generation:7,scopeDates:input.bases.map(b=>b.serviceDate),
     templateCatalogDigest:'a'.repeat(64),templateInputsDigest:'b'.repeat(64),partitions:input.bases.map(b=>({serviceDate:b.serviceDate}))}},
   l={schema:'memphis-zoo.static-weekly-lunch-authority-document.v1',week_start:input.weekStart,persistence_authority:'NOT_PERSISTED',
    base_replay_digest:e.replay_digest,base_authority_digest:e.authority_digest};
  e.database_projection_identity=pg(e);l.document_identity=pg(l);
  return {publicationId:input.source.publication_id,serviceDate:input.weekStart,exceptionSetDigest:'d'.repeat(64),
   compilerVersion:e.compiler_version,objective:{},metrics:{},replayDigest:e.replay_digest,envelope:e,expectedRevision:42,
   actorManagerId:input.managerId,actorManagerName:input.actor.managerName,idempotencyKey:`staffing:${c.operation_id}:${input.weekStart}`,lunchDocument:l};
 };
 const unresolvedFor=input=>({schema:'custodial.approved-dated-mapped-shift-end-unresolved.v1',status:'UNRESOLVED',
  operationDate:'2026-10-06',dayOfWeek:2,originalWeekSourceDigest:'a'.repeat(64),currentWeekSourceDigest:'a'.repeat(64),
  approvedTemplateSourceDigest:'b'.repeat(64),ownerConfigDigest:'c'.repeat(64),parentReferences:[],selectedAvailability:[],appliedExceptions:[],
  namedHandoffReferences:[],originalWeekSource:{},unresolved:[{dayOfWeek:2,parentWorkId:'UNIT parent DATA',
   window:{start:'12:00',end:'12:30'},reason:'NO_ELIGIBLE_INTERVAL_OWNER',originalBudget:3,requiredSegments:null}]});
 const runtimeSource=readFileSync(new URL('../src/static-weekly-schedule-compiler-runtime.js',import.meta.url),'utf8'),
  workerSource=readFileSync(new URL('../src/static-weekly-schedule-compiler-worker.js',import.meta.url),'utf8'),
  eraseImports=s=>s.replace(/^import[\s\S]*?;\n/gm,'').replace(/\bexport /g,'').replace(/import\.meta\.url/g,'"file:///inert/worker.js"');
 let pid=900000,forks=[],sent=[],queue=[],respond='ok',hold=false;
 const fakeProcess={env:{},hrtime:process.hrtime,kill(target,signal){const child=forks.find(f=>f.pid===Math.abs(target));
  if(!child||child.dead){const error=new Error('absent');error.code='ESRCH';throw error;}if(signal==='SIGKILL')child.dead=true;}};
 const fork=(_url,_args,options)=>{
  const child=new EventEmitter();child.pid=++pid;child.options=options;child.channel={ref(){},unref(){}};child.ref=()=>{};child.unref=()=>{};
  child.stderr=new EventEmitter();child.send=(message,callback)=>{sent.push(message);callback(null);
   const reply=()=>{let result=message.type==='compile'?{inertOrdinary:true}:resultFor(message.input),error;
    if(respond==='foreign')result.actorManagerId=uuid(99);
    if(respond==='unresolved')error={code:'static_template_dated_coverage_unresolved',message:'Fixed pending coverage unresolved.',unresolved:unresolvedFor(message.input)};
    if(respond==='raw-error')error={code:'staffing_approved_pending_preparation_failed',message:'DO NOT EXPOSE private DATA'};
    if(respond==='missing-pattern'||respond==='missing-extra')error={code:'static_template_missing_approved_pattern',message:'DO NOT EXPOSE private DATA'};
    if(respond==='missing-extra')error.unresolved={unsafe:true};
    child.emit('message',{type:'result',id:message.id,...(error?{error}:{result})});};
   if(hold)queue.push(reply);else queueMicrotask(reply);
  };
  assert.equal(forks.filter(f=>!f.dead).length,0,'one inert owned child group only');
  forks.push(child);queueMicrotask(()=>child.emit('message',{type:'ready',evidence:options.env.MEMPHIS_STATIC_WEEKLY_PREPARATION_PROFILE==='fixed-pending'
   ?{compiler:'fixed approved pending preparation',preparation:'approved-pending-staffing',solverInvoked:false}:{compiler:'INERT ordinary readiness DATA'}}));return child;
 };
 const context={fork,readdirSync:()=>[],readFileSync:()=>'',fileURLToPath:()=>'/inert/worker.js',URL,Buffer,Object,Array,Number,Set,WeakMap,Map,
  process:fakeProcess,performance,setTimeout,clearTimeout,Promise,REQUEST_DEADLINE_MILLISECONDS:60000,
  STATIC_WEEKLY_FUSED_COMPILER_RESOURCE_LIMITS:limits,sanitizeOpeningCoverageDiagnostic:()=>null,
  captureApprovedPendingStaffingWorkerInput:captureInput,captureApprovedPendingStaffingWorkerResult:captureResult,
  captureApprovedPendingStaffingUnresolved:captureUnresolved};
 runInNewContext(eraseImports(runtimeSource)+'\nglobalThis.factory=createStaticWeeklyCompilerRuntime;',context);
 const runtime=context.factory(),submit=(input,extra={})=>runtime.compileAndPrepare(input,{kind:'approved-pending-staffing'},
  {deadlineAtMilliseconds:performance.now()+5000,...extra});
 try{
  await check('missing catalog runtime dependency is closed and sanitized, extra fields drain the child',async()=>{
   respond='missing-pattern';await assert.rejects(submit(inputFor()),e=>e.code==='static_template_missing_approved_pattern'
    &&e.message==='No release-admitted approved pattern matches the current staffing. The original request is preserved; nothing was accepted.'
    &&!Object.hasOwn(e,'unresolved'));
   respond='missing-extra';await assert.rejects(submit(inputFor()),e=>e.code==='staffing_approved_pending_protocol_invalid');
   assert.equal(forks.at(-1).dead,true);respond='ok';
  });
  await check('worker missing catalog code requires fixed original and inert own code, never raw DATA',async()=>{
   const messages=[],handlers={};let thrown=Object.assign(new Error('PRIVATE DATA MUST NOT LEAVE'),{code:'static_template_missing_approved_pattern'}),getterCalls=0;
   const p={env:{MEMPHIS_STATIC_WEEKLY_COMPILER_WORKER:'1',MEMPHIS_STATIC_WEEKLY_PREPARATION_PROFILE:'fixed-pending'},
    send:m=>messages.push(m),on:(name,fn)=>handlers[name]=fn,exit:()=>{throw Error('unexpected exit');}},
    workerContext={process:p,Object,Array,Set,Buffer,performance,structuredClone,createHash:(await import('node:crypto')).createHash,
     nativeTypes:(await import('node:util')).types,readFileSync:()=>'{}',URL,
     installStaticWeeklySha256HexAccelerator(){},STATIC_WEEKLY_FUSED_COMPILER_RESOURCE_LIMITS:limits,
     initializeStaticWeeklySolverEngine(){throw Error('solver forbidden');},compileStaticWeeklySchedule(){throw Error('compiler forbidden');},
     captureApprovedPendingStaffingWorkerInput:captureInput,captureApprovedPendingStaffingWorkerResult:captureResult,captureApprovedPendingStaffingUnresolved:captureUnresolved,
     prepareApprovedPendingStaffingWeekProjection(){throw thrown;},sanitizeOpeningCoverageDiagnostic:()=>null};
   await runInNewContext('(async()=>{'+eraseImports(workerSource)+'})()',workerContext);
   const send=async(id,input=inputFor())=>handlers.message({type:'approved-pending-staffing',id,input,preparation:{kind:'approved-pending-staffing'},remainingMilliseconds:4000});
   await send(1);assert.equal(messages.at(-1).error.code,'static_template_missing_approved_pattern');
   assert.equal(Object.keys(messages.at(-1).error).sort().join(','),'code,message');assert.ok(!messages.at(-1).error.message.includes('PRIVATE'));
   thrown={get code(){getterCalls++;return 'static_template_missing_approved_pattern';}};await send(2);
   assert.equal(getterCalls,0);assert.equal(messages.at(-1).error.code,'staffing_approved_pending_preparation_failed');
   thrown=new Proxy({code:'static_template_missing_approved_pattern'},{get(){throw Error('proxy accessed');}});await send(3);
   assert.equal(messages.at(-1).error.code,'staffing_approved_pending_preparation_failed');
   thrown=Object.assign(Error('PRIVATE'),{code:'static_template_missing_approved_pattern'});await send(4,{});
   assert.equal(messages.at(-1).error.code,'staffing_approved_pending_preparation_failed');
  });
  await check('missing catalog error waits for original currentness before leaving the caller',async()=>{
   const cp=readFileSync(new URL('../src/static-weekly-control-plane.js',import.meta.url),'utf8'),
    region=cp.slice(cp.indexOf('async prepareStaffingCommand('),cp.indexOf('async stageStaffingCommand(')),
    defer=region.indexOf('unresolvedPreparationError=error;'),emit=region.indexOf('if(unresolvedPreparationError)throw unresolvedPreparationError;');
   assert.ok(region.indexOf("'static_template_missing_approved_pattern'")>region.indexOf('await prepareApprovedPendingStaffingWeekIsolated('));
   assert.ok(region.indexOf("'static_template_missing_approved_pattern'")<defer);
   for(const key of ['canonicalJson(currentCommand)!==originalCommand','canonicalJson(currentSnapshot)!==originalSnapshot',
    'canonicalJson(currentSource)!==originalSource','canonicalJson(current)!==canonicalJson(bases[index])'])assert.ok(region.indexOf(key)>defer&&region.indexOf(key)<emit,key);
   assert.ok(emit<region.indexOf('candidates.push('));
  });
  await check('closed original captured before queue; actual serialized enqueue dispatch; no caller mutation',async()=>{
   hold=true;const original=inputFor(),first=submit(original),second=submit(inputFor(5));original.command.operation_id=uuid(99);
   await new Promise(resolve=>setImmediate(resolve));assert.equal(sent.length,1);assert.equal(sent[0].input.command.operation_id,uuid(1));
   assert.equal(forks.length,1);assert.equal(forks[0].options.env.MEMPHIS_STATIC_WEEKLY_PREPARATION_PROFILE,'fixed-pending');
   queue.shift()();const a=await first;await new Promise(resolve=>setImmediate(resolve));assert.equal(sent.length,2);
   queue.shift()();const b=await second;hold=false;
   assert.equal(a.idempotencyKey,`staffing:${uuid(1)}:2026-10-05`);assert.equal(b.idempotencyKey,`staffing:${uuid(5)}:2026-10-05`);
   assert.equal(Object.isFrozen(a.envelope.semantic_snapshot.originalCommand),true);assert.equal(sent[0].remainingMilliseconds<5000,true);
  });
  await check('malformed/private-key/accessor/proxy/sparse/stale original denied before IPC',async()=>{
   const count=sent.length;
   for(const mutate of [v=>v.extra=true,v=>v.actor.managerId=uuid(90),v=>v.window={dates:[],weeks:[]},
    v=>v.snapshot.authority_revision=43,v=>v.bases.length=4,v=>Object.defineProperty(v.command,'hidden',{get(){throw Error('getter ran');},enumerable:true}),
    v=>v.source=new Proxy(v.source,{})]){const v=inputFor();mutate(v);await assert.rejects(submit(v));}
   await assert.rejects(submit(inputFor(),{deadlineAtMilliseconds:performance.now()-1}));assert.equal(sent.length,count);
  });
  await check('typed unresolved preserved frozen; generic failures redacted; foreign response refused and drained',async()=>{
   respond='unresolved';await assert.rejects(submit(inputFor()),e=>e.code==='static_template_dated_coverage_unresolved'
    &&Object.isFrozen(e.unresolved.unresolved[0].window)&&e.unresolved.status==='UNRESOLVED');
   respond='raw-error';await assert.rejects(submit(inputFor()),e=>e.code==='staffing_approved_pending_preparation_failed'&&!e.message.includes('private'));
   respond='foreign';await assert.rejects(submit(inputFor()),e=>e.code==='staffing_approved_pending_protocol_invalid');
   assert.equal(forks.at(-1).dead,true);respond='ok';
  });
  await check('original aborted queue never emits IPC; active cancellation drains exact owned group',async()=>{
   const aborted=new AbortController();aborted.abort();const count=sent.length;await assert.rejects(submit(inputFor(),{signal:aborted.signal}));assert.equal(sent.length,count);
   hold=true;const controller=new AbortController(),pending=submit(inputFor(),{signal:controller.signal});
   const refused=assert.rejects(pending,e=>e.code==='static_weekly_compiler_request_aborted');
   await new Promise(resolve=>setImmediate(resolve));controller.abort();await refused;
   assert.equal(forks.at(-1).dead,true);queue=[];hold=false;
  });
  await check('profile transition and initialize wait for original queue and drain before replacement',async()=>{
   hold=true;const work=submit(inputFor());await new Promise(resolve=>setImmediate(resolve));const old=forks.at(-1),ready=runtime.initialize();
   await new Promise(resolve=>setImmediate(resolve));assert.notEqual(old.dead,true);queue.shift()();await work;hold=false;
   assert.equal((await ready).worker.compiler,'fixed approved pending preparation');assert.notEqual(old.dead,true);
   assert.deepEqual(await runtime.compileAndPrepare({},{kind:'draft'}),{inertOrdinary:true});
   assert.equal(old.dead,true);assert.equal(forks.at(-1).options.env.MEMPHIS_STATIC_WEEKLY_PREPARATION_PROFILE,'compiler');
   const normal=forks.at(-1);await submit(inputFor());assert.equal(normal.dead,true);
   assert.equal(forks.at(-1).options.env.MEMPHIS_STATIC_WEEKLY_PREPARATION_PROFILE,'fixed-pending');
  });
  await check('queued fixed request retains original absolute deadline, no second IPC after expiry',async()=>{
   hold=true;const first=submit(inputFor());await new Promise(resolve=>setImmediate(resolve));const count=sent.length,
    expired=submit(inputFor(6),{deadlineAtMilliseconds:performance.now()+10}),
    rejection=assert.rejects(expired,e=>e.code==='static_weekly_compiler_queue_timeout');
   await new Promise(resolve=>setTimeout(resolve,20));queue.shift()();await first;await rejection;hold=false;assert.equal(sent.length,count);
  });
  await check('worker fixed bootstrap calls no solver/compile; real dispatch calls bound fixed producer only',async()=>{
   const messages=[],handlers={},counts={solver:0,compile:0,fixed:0},p={env:{MEMPHIS_STATIC_WEEKLY_COMPILER_WORKER:'1',MEMPHIS_STATIC_WEEKLY_PREPARATION_PROFILE:'fixed-pending'},
    send:m=>messages.push(m),on:(name,fn)=>handlers[name]=fn,exit:()=>{throw Error('unexpected exit');}},
    workerContext={process:p,Object,Array,Set,Buffer,performance,structuredClone,createHash:(await import('node:crypto')).createHash,
     nativeTypes:(await import('node:util')).types,readFileSync:()=>'{"owners":{}}',URL,
     installStaticWeeklySha256HexAccelerator(){},STATIC_WEEKLY_FUSED_COMPILER_RESOURCE_LIMITS:limits,
     initializeStaticWeeklySolverEngine(){counts.solver++;throw Error('solver forbidden');},compileStaticWeeklySchedule(){counts.compile++;throw Error('compiler forbidden');},
     captureApprovedPendingStaffingWorkerInput:captureInput,captureApprovedPendingStaffingWorkerResult:captureResult,captureApprovedPendingStaffingUnresolved:captureUnresolved,
     prepareApprovedPendingStaffingWeekProjection:args=>{counts.fixed++;return resultFor(args);},sanitizeOpeningCoverageDiagnostic:()=>null};
   await runInNewContext('(async()=>{'+eraseImports(workerSource)+'})()',workerContext);
   assert.equal(messages[0].evidence.solverInvoked,false);
   await handlers.message({type:'approved-pending-staffing',id:1,input:inputFor(),preparation:{kind:'approved-pending-staffing'},remainingMilliseconds:4000});
   assert.deepEqual(counts,{solver:0,compile:0,fixed:1});assert.equal(messages[1].result.compilerVersion,'approved-static-pending-staffing-v1');
   await handlers.message({type:'approved-pending-staffing',id:2,input:inputFor(),preparation:{kind:'approved-pending-staffing'},remainingMilliseconds:0});
   assert.equal(counts.fixed,1);assert.equal(messages[2].error.code,'staffing_approved_pending_preparation_failed');
  });
  await check('caller actual await stays inside keepalive with original deadline and all post-await original reads',async()=>{
   const cp=readFileSync(new URL('../src/static-weekly-control-plane.js',import.meta.url),'utf8'),
    region=cp.slice(cp.indexOf('async prepareStaffingCommand('),cp.indexOf('async stageStaffingCommand(')),
    awaitAt=region.indexOf('await prepareApprovedPendingStaffingWeekIsolated(');
   assert.ok(awaitAt>region.indexOf('prepareInsideTransaction(client'));
   assert.ok(region.indexOf('const weekDeadline=')<region.indexOf('await snapshotFor('));
   assert.ok(region.includes('{deadlineAtMilliseconds:weekDeadline}'));
   for(const key of ['canonicalJson(currentCommand)!==originalCommand','canonicalJson(currentSnapshot)!==originalSnapshot',
    'canonicalJson(currentSource)!==originalSource','canonicalJson(current)!==canonicalJson(bases[index])',
    'const candidateSet = createStaffingCandidateSet','static_weekly_sch022_preview_staffing_witness'])assert.ok(region.indexOf(key)>awaitAt,key);
   assert.match(workerSource,/prepareApprovedPendingStaffingWeekProjection\(\{\.\.\.fixedInput,deadline\}\)/);
  });
  await check('unresolved diagnostics wait for actual caller rechecks and refuse malformed transport',async()=>{
   const original=inputFor(),diagnostic=unresolvedFor(original);
   for(const mutate of [v=>v.unresolved[0].reason='APPROVED',v=>v.extra=true,v=>v.operationDate='2026-10-12',
    v=>v.unresolved[0].requiredSegments=0,v=>Object.defineProperty(v,'status',{get(){throw Error('getter must not run');},enumerable:true})]){
    const changed=clone(diagnostic);mutate(changed);assert.throws(()=>captureUnresolved(changed,original));
   }
   const cp=readFileSync(new URL('../src/static-weekly-control-plane.js',import.meta.url),'utf8'),
    region=cp.slice(cp.indexOf('async prepareStaffingCommand('),cp.indexOf('async stageStaffingCommand(')),
    defer=region.indexOf('unresolvedPreparationError=error;'),emit=region.indexOf('if(unresolvedPreparationError)throw unresolvedPreparationError;');
   assert.ok(defer>region.indexOf('await prepareApprovedPendingStaffingWeekIsolated('));
   for(const key of ['canonicalJson(currentCommand)!==originalCommand','canonicalJson(currentSnapshot)!==originalSnapshot',
    'canonicalJson(currentSource)!==originalSource','canonicalJson(current)!==canonicalJson(bases[index])']){
    assert.ok(region.indexOf(key)>defer&&region.indexOf(key)<emit,key);
   }
   assert.ok(emit<region.indexOf('candidates.push('));
  });
 }finally{await runtime.shutdown();}
 assert.equal(forks.every(f=>f.dead),true);assert.equal(queue.length,0);
 console.log(JSON.stringify({selector:missingOnly?'approved-pending-missing-pattern-only':profileOnly?'approved-pending-profile-initialize-only':errorOnly?'approved-pending-current-error-boundary-only':closureOnly?'approved-pending-queue-closure-only':'approved-pending-queue-protocol-only',checks,actualChild:false,solver:false,sql:false,ownedProcesses:0}));process.exit(0);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return readFileSync(`/proc/${pid}/stat`, "utf8").split(" ")[2] !== "Z";
  } catch {
    return false;
  }
}

async function assertReaped(pid, message) {
  const deadline = performance.now() + 2_000;
  while (processAlive(pid) && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(processAlive(pid), false, message);
}

const fixture = new URL("./fixtures/static-weekly-compiler-runtime-test-worker.mjs", import.meta.url);
const resourceLimits = { maxOldGenerationSizeMb: 32, maxSemiSpaceSizeMb: 8, maxWasmMemoryMb: 32, stackSizeKb: 2 * 1024 };
assert.throws(() => createStaticWeeklyCompilerRuntime({ workerUrl: fixture, resourceLimits: { ...resourceLimits, maxWasmMemoryMb: 0 } }), /maxWasmMemoryMb must be a positive integer/, "invalid resource envelopes fail closed before process creation");
const runtime = createStaticWeeklyCompilerRuntime({ workerUrl: fixture, initializationMilliseconds: 1_000, requestMilliseconds: 1_000, resourceLimits });

await runtime.initialize();
assert.equal(runtime.getReadiness().available, true);
const firstNestedPid = runtime.getReadiness().worker.nestedPid;
assert.equal(processAlive(firstNestedPid), true, "the fixture proves its nested child exists before recovery");

let ticks = 0;
const timer = setInterval(() => { ticks += 1; }, 10);
const isolated = await runtime.compile({ value: "isolated", delay: 250 });
clearInterval(timer);
assert.deepEqual(isolated, { ok: true, value: "isolated" });
assert.equal(ticks >= 10, true, "the HTTP/main event loop remains responsive while the compiler worker is CPU-bound");

const order = [];
await Promise.all([
  runtime.compile({ value: "first", delay: 80 }).then((value) => order.push(value.value)),
  runtime.compile({ value: "second", delay: 0 }).then((value) => order.push(value.value)),
]);
assert.deepEqual(order, ["first", "second"], "overlapping compiler requests remain serialized");

const boundedRuntime = createStaticWeeklyCompilerRuntime({ workerUrl: fixture, initializationMilliseconds: 1_000, requestMilliseconds: 1_000, maxOutstandingRequests: 1, resourceLimits });
await boundedRuntime.initialize();
const boundedNestedPid = boundedRuntime.getReadiness().worker.nestedPid;
const boundedFirst = boundedRuntime.compile({ value: "bounded-first", delay: 80 });
await assert.rejects(boundedRuntime.compile({ value: "queue-overflow" }), (error) => error?.code === "static_weekly_compiler_busy");
assert.deepEqual(await boundedFirst, { ok: true, value: "bounded-first" }, "queue admission rejection does not disturb the admitted request");
await boundedRuntime.shutdown();
await assertReaped(boundedNestedPid, "bounded-admission runtime shutdown must reap its process group");

await assert.rejects(runtime.compile({ behavior: "crash" }), /test worker crash|compiler (?:worker|process) (?:crashed|exited)/i);
await assertReaped(firstNestedPid, "a crashed compiler process group must reap its nested solver child");
const recovered = await runtime.compile({ value: "recovered" });
assert.deepEqual(recovered, { ok: true, value: "recovered" }, "a crashed compiler lineage is replaced exactly once before the next request");
const recoveredNestedPid = runtime.getReadiness().worker.nestedPid;
assert.notEqual(recoveredNestedPid, firstNestedPid);

await assert.rejects(runtime.compile({ behavior: "signal" }), (error) => {
  assert.equal(error?.code, "static_weekly_compiler_worker_exited");
  assert.equal(error?.diagnostic?.signal, "SIGABRT", "the parent preserves the exact child exit signal");
  assert.match(error?.diagnostic?.stderrTail || "", /bounded compiler diagnostic marker/, "the parent retains only the bounded stderr tail for operations evidence");
  return true;
});
const afterSignal = await runtime.compile({ value: "after-signal" });
assert.deepEqual(afterSignal, { ok: true, value: "after-signal" }, "a signaled compiler lineage is replaced exactly once before the next request");

const timeoutRuntime = createStaticWeeklyCompilerRuntime({ workerUrl: fixture, initializationMilliseconds: 1_000, requestMilliseconds: 250, resourceLimits });
await timeoutRuntime.initialize();
const timeoutNestedPid = timeoutRuntime.getReadiness().worker.nestedPid;
await assert.rejects(timeoutRuntime.compile({ behavior: "hang" }), /complete request deadline/i);
await assertReaped(timeoutNestedPid, "a timed-out compiler process group must reap its nested solver child");
assert.deepEqual(await timeoutRuntime.compile({ value: "after-timeout" }), { ok: true, value: "after-timeout" }, "a timed-out worker is discarded before recovery");

const shutdownRuntime = createStaticWeeklyCompilerRuntime({ workerUrl: fixture, initializationMilliseconds: 1_000, requestMilliseconds: 5_000, resourceLimits });
await shutdownRuntime.initialize();
const shutdownNestedPid = shutdownRuntime.getReadiness().worker.nestedPid;
const interrupted = shutdownRuntime.compile({ behavior: "hang" });
const interruptedRejection = assert.rejects(interrupted, (error) => error?.code === "static_weekly_compiler_closed");
await new Promise((resolve) => setTimeout(resolve, 20));
const firstShutdown = shutdownRuntime.shutdown();
assert.equal(shutdownRuntime.shutdown(), firstShutdown, "concurrent shutdown callers share one complete process-group teardown");
await firstShutdown;
await interruptedRejection;
await assertReaped(shutdownNestedPid, "production shutdown interrupts active compiler work and reaps its process group");

await runtime.terminateForTest();
await assertReaped(recoveredNestedPid, "production shutdown must reap the active compiler process group");
const postTimeoutNestedPid = timeoutRuntime.getReadiness().worker.nestedPid;
await timeoutRuntime.terminateForTest();
await assertReaped(postTimeoutNestedPid, "shutdown after timeout recovery must reap the replacement process group");

const productionRuntime = createStaticWeeklyCompilerRuntime();
let productionInput = {
  serviceDate: "2026-08-10",
  timezone: "America/Chicago",
  exceptions: [],
  proximity: [{ from: "A", to: "B", minutes: 1, verified: true, bidirectional: true, provenance: "runtime-production-path" }],
  slots: ["a", "b"].map((id) => ({ id, label: `slot-${id}`, incumbencies: [{ personId: `person-${id}`, displayName: `Worker ${id}`, effectiveStart: "2020-01-01", effectiveEnd: null }] })),
  versions: [{
    id: "runtime-test-week",
    publicationId: "runtime-test-publication",
    status: "published",
    effectiveStart: "2026-08-03",
    effectiveEnd: null,
    objective: { requireVerifiedProximity: true },
    slotAvailability: ["a", "b"].map((slotId, index) => ({ slotId, dayOfWeek: 1, status: "working", shift: { start: "07:00", end: "16:00" }, lunch: index ? {start:"12:00",end:"13:00"} : {start:"11:00",end:"12:00"}, productiveCapacityProvenance: "runtime-shift", maxServiceEffortMinutes: 300, maxServiceEffortProvenance: "runtime-capacity", qualifications: ["general"], qualificationProvenance: "runtime-qualification", restrictions: [], restrictionProvenance: "runtime-restriction", acceptedRouteAnchorLocationId: index ? "B" : "A", acceptedRouteProvenance: "runtime-route" })),
    assignments: [
      { workId: "runtime-one", dayOfWeek: 1, locationId: "A", window: { start: "08:00", end: "09:00" }, ownerSlotId: "a", serviceEffortMinutes: 20, serviceEffortProvenance: "runtime-effort", priority: 1, priorityProvenance: "runtime-priority", requiredQualifications: ["general"], qualificationProvenance: "runtime-work-qualification", restrictions: [], restrictionProvenance: "runtime-work-restriction" },
      { workId: "runtime-two", dayOfWeek: 1, locationId: "B", window: { start: "09:10", end: "10:00" }, ownerSlotId: "b", serviceEffortMinutes: 20, serviceEffortProvenance: "runtime-effort", priority: 1, priorityProvenance: "runtime-priority", requiredQualifications: ["general"], qualificationProvenance: "runtime-work-qualification", restrictions: [], restrictionProvenance: "runtime-work-restriction" },
    ],
  }],
};
// The production adapter now binds typed publication/physical identities.
// Preserve the same two-worker/two-location topology using synthetic UUIDs.
const fixtureIdentities={a:'20000000-0000-4000-8000-000000000061',b:'20000000-0000-4000-8000-000000000062',
 'person-a':'30000000-0000-4000-8000-000000000061','person-b':'30000000-0000-4000-8000-000000000062',
 A:'40000000-0000-4000-8000-000000000061',B:'40000000-0000-4000-8000-000000000062',
 'runtime-test-week':'60000000-0000-4000-8000-000000000061','runtime-test-publication':'70000000-0000-4000-8000-000000000061'};
productionInput=JSON.parse(JSON.stringify(productionInput),(_key,value)=>typeof value==='string'&&Object.hasOwn(fixtureIdentities,value)?fixtureIdentities[value]:value);
let productionTicks = 0;
const productionPulse = setInterval(() => { productionTicks += 1; }, 10);
try {
const productionResult = await productionRuntime.compileAndPrepare(productionInput, {
  kind: "draft",
  expectedRevision: 0,
  actor: {
    managerId: "10000000-0000-4000-8000-000000000001",
    managerName: "Runtime Test Manager",
    idempotencyKey: "runtime-prepared-draft",
  },
});
clearInterval(productionPulse);
assert.equal(productionResult.effectiveStart, "2026-08-10");
assert.equal(productionResult.expectedRevision, 0);
assert.equal(productionResult.actorManagerId, "10000000-0000-4000-8000-000000000001");
assert.equal(productionResult.idempotencyKey, "runtime-prepared-draft");
assert.equal(productionResult.document?.validation?.status, "FEASIBLE", "the real fused compiler/solver, database adapter, and advanced IPC result transport pass together");
assert.equal(productionTicks > 0, true, "the real production compiler and database-adapter process path leaves the HTTP event loop responsive");
assert.equal(productionRuntime.getReadiness().worker.nestedSolverProcess, false, "production uses one fused compiler-plus-HiGHS isolate without a redundant solver process");
assert.equal(productionRuntime.getReadiness().worker.solver.worker.runtime, "in-process within isolated compiler child");
} finally { clearInterval(productionPulse); await productionRuntime.shutdown(); }

console.log("static weekly complete-compiler worker isolation and recovery tests: PASS");
