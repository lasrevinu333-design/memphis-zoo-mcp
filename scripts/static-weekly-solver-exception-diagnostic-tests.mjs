import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Private source-fragment transparency tests, not a solver/optimality fixture.
// No HiGHS import, engine initialization, LP solve or scheduling operation.
const baselineSha='2c7384e60c2ca21a36ceb66dbdd1cbe14a1364946193ea1f6322f2c04b7469cd';
const digest=value=>createHash('sha256').update(value).digest('hex');
const source=fs.readFileSync(new URL('../src/static-weekly-schedule-solver-worker.js',import.meta.url),'utf8');
const addedStart='// Diagnostic custody only:',addedEnd='\nfunction reportError';
const stageDeclaration='  let failureStage = "solver_call";\n',stageAssignment='    failureStage = "result_processing";\n';
const catchBlock='  } catch (cause) {\n    retainSolverExceptionDiagnostic(cause, { lp, timeLimitSeconds, stage: failureStage, collector });\n    throw cause;\n';
function predecessor(text){
 for(const needle of [addedStart,addedEnd,stageDeclaration,stageAssignment,catchBlock])assert.equal(text.split(needle).length,2,'unique owning delta');
 const begin=text.indexOf(addedStart),end=text.indexOf(addedEnd,begin);
 const original=text.slice(0,begin)+text.slice(end+1);
 const reversed=original.replace(stageDeclaration,'').replace(stageAssignment,'').replace(catchBlock,'');
 assert.equal(digest(reversed),baselineSha,'complete predecessor bytes; unexplained drift denied');return reversed;
}
function harness(text,{normalizer,hashImplementation=createHash}={}){
 const prefix=text.slice(text.indexOf('const OPTIONS'),text.indexOf('function reportError')).replace('export function','function');
 const collection=text.slice(text.indexOf('function reportRepresentation'),text.indexOf('function collectTerminalReport'));
 const solve=text.slice(text.indexOf('function solveWithRuntime'),text.indexOf('export async function initializeStaticWeeklySolverEngine'));
 const supplied=normalizer||((result,collector)=>({outputTruncated:collector.truncated,terminalReport:{records:collector.records.map(x=>({...x}))}}));
 return new Function('createHash','normalizeResultEvidence','bindInitializationIdentity',prefix+collection+solve+
  ';return {solve:solveWithRuntime,capture:captureOutput,active:()=>activeCollector,take:typeof takeStaticWeeklySolverExceptionDiagnostic==="function"?takeStaticWeeklySolverExceptionDiagnostic:()=>null};')
  (hashImplementation,supplied,()=>{throw new Error('unexpected initialization binding');});
}
export function runStaticWeeklySolverExceptionDiagnosticTests(){
 let checks=0;const check=fn=>{fn();checks++;},original=predecessor(source),before=harness(original),after=harness(source);
 check(()=>assert.equal(digest(original),baselineSha));
 for(const drift of [source+'\n',source.replace('threads: 1','threads: 2'),source.replace('MAX_COLLECTED_OUTPUT_BYTES = 256','MAX_COLLECTED_OUTPUT_BYTES = 257')])check(()=>assert.throws(()=>predecessor(drift)));
 const lp='Minimize\n objective: + 1 x\nSubject To\n c: + 1 x >= 1\nBounds\n 0 <= x <= 1\nBinary\n x\nEnd\n',options={timeLimitSeconds:0.75,id:7,modelAttestation:{binding:'synthetic-no-authority'}};
 function thrown(h,cause,{input=lp,seconds=0.75,records=[]}={}){
  const runtime={identity:{initializationRecord:{synthetic:true}},solver:{solve(actual,received){
   assert.equal(actual,input);assert.equal(received.time_limit,seconds);
   for(const [channel,text]of records)h.capture(channel,text);throw cause;
  }}};
  let received,didThrow=false;try{h.solve(runtime,{...options,lp:input,timeLimitSeconds:seconds});}catch(error){received=error;didThrow=true;}
  assert.equal(didThrow,true,'must actually throw, including undefined causes');assert.equal(received,cause,'original thrown identity, including frozen/primitive causes');assert.equal(h.active(),null,'finally always clears collector');return h.take(cause);
 }
 const sentinel=Object.freeze(new Error('SECRET employee/token/native stack never retained'));
 const records=[['print','Solving report'],['printErr','ERROR assert_ok(_Highs_run) Aborted() SECRET'],['print','Writing the solution to solution.txt']];
 check(()=>assert.equal(thrown(before,sentinel,{records}),null));
 const diagnostic=thrown(after,sentinel,{records});checks++;
 check(()=>assert.equal(diagnostic.classification,'EXCEPTION_NO_RETURNED_SOLUTION_STATUS'));
 check(()=>assert.equal(diagnostic.stage,'solver_call'));
 check(()=>assert.equal(diagnostic.lp.sha256,digest(lp)));
 check(()=>assert.equal(diagnostic.lp.utf8Bytes,Buffer.byteLength(lp)));
 check(()=>assert.equal(diagnostic.lp.utf16Characters,lp.length));
 check(()=>assert.equal(diagnostic.lp.lines,lp.split('\n').length));
 check(()=>assert.equal(diagnostic.output.printRecords,2));check(()=>assert.equal(diagnostic.output.printErrRecords,1));
 for(const field of ['abortedMarker','solverErrorMarker','terminalStart','terminalEnd'])check(()=>assert.equal(diagnostic.output[field],true));
 check(()=>assert.equal(diagnostic.output.memoryMarker,false,'Aborted is not OOM'));
 check(()=>assert.equal(diagnostic.output.truncated,false));
 check(()=>assert.deepEqual(diagnostic.options,{threads:1,random_seed:0,mip_rel_gap:0,mip_abs_gap:0,mip_feasibility_tolerance:1e-9,presolve:'on',parallel:'off',output_flag:true,time_limit:0.75}));
 check(()=>assert.equal(after.take(sentinel),null,'take once'));
 check(()=>assert.equal(Object.hasOwn(sentinel,'diagnostic'),false,'no error mutation'));
 check(()=>assert.equal(JSON.stringify(diagnostic).includes('SECRET'),false));
 check(()=>assert.equal(JSON.stringify(diagnostic).includes(lp),false));
 check(()=>assert.ok(Buffer.byteLength(JSON.stringify(diagnostic))<2048,'finite sanitized envelope bound'));
 for(const item of [diagnostic,diagnostic.lp,diagnostic.options,diagnostic.output])check(()=>assert.equal(Object.isFrozen(item),true));
 check(()=>assert.throws(()=>{diagnostic.lp.sha256='0'.repeat(64);},TypeError));
 check(()=>assert.equal(diagnostic.lp.sha256,digest(lp)));
 for(const cause of [undefined,null,'primitive secret',17,Symbol('secret'),Object.freeze({}),()=>{}]){
  const value=thrown(after,cause);checks++;
  check(()=>assert.equal(value!==null,cause!==null&&['object','function'].includes(typeof cause)));
 }
 let inspections=0;const hostile=new Proxy({}, {get(){inspections++;throw sentinel;},getOwnPropertyDescriptor(){inspections++;throw sentinel;},ownKeys(){inspections++;throw sentinel;}});
 check(()=>assert.equal(thrown(after,hostile).stage,'solver_call'));check(()=>assert.equal(inspections,0,'error properties/stack/message never read'));
 const unicode='x\n📱\ud800\r\n';check(()=>assert.equal(thrown(after,sentinel,{input:unicode}).lp.sha256,digest(unicode)));
 // Same exception reused by a runtime must overwrite—not leak—the older LP.
 thrown(after,sentinel,{input:lp});checks++;
 const changed=thrown(after,sentinel,{input:'other\n'});checks++;
 check(()=>assert.equal(changed.lp.sha256,digest('other\n')));
 check(()=>assert.equal(changed.output.collectedBytes,0));
 for(const [input,seconds]of [[{},1],[lp,NaN],[lp,Infinity]])check(()=>assert.equal(thrown(after,sentinel,{input,seconds}),null));
 const big='secret'.repeat(50000),bounded=thrown(after,sentinel,{records:[['printErr',big],['print','heap limit allocation failed']]});checks++;
 check(()=>assert.equal(bounded.output.truncated,true));check(()=>assert.equal(bounded.output.memoryMarker,true));
 check(()=>assert.ok(bounded.output.collectedBytes<=256*1024));check(()=>assert.ok(Buffer.byteLength(JSON.stringify(bounded))<2048));
 const hashFailure=harness(source,{hashImplementation:()=>{throw new Error('diagnostic digest unavailable');}});
 check(()=>assert.equal(thrown(hashFailure,sentinel),null,'diagnostic failure never masks original runtime error'));
 const coercion=Object.freeze({toString(){throw sentinel;}});check(()=>assert.equal(thrown(after,sentinel,{records:[['printErr',coercion]]}).output.collectedBytes,0));
 const processing=harness(source,{normalizer(){throw sentinel;}});let caught;
 try{processing.solve({identity:{initializationRecord:{}},solver:{solve(){return {Status:'synthetic-no-authority'};}}},{lp,...options});}catch(error){caught=error;}
 check(()=>assert.equal(caught,sentinel));check(()=>assert.equal(processing.active(),null));
 const processed=processing.take(sentinel);check(()=>assert.equal(processed.stage,'result_processing'));
 check(()=>assert.equal(processed.classification,'EXCEPTION_AFTER_RESULT_RETURN_NO_STATUS_INFERRED'));
 // Successful return/result/options/report bytes remain exactly unchanged.
 const success=h=>h.solve({identity:{initializationRecord:{}},solver:{solve(actual,received){h.capture('print','opaque synthetic success');return {Status:'synthetic-no-authority',Columns:{x:{Primal:1}}};}}},{lp,...options});
 const oldSuccess=success(before),newSuccess=success(after);check(()=>assert.deepEqual(newSuccess,oldSuccess));
 check(()=>assert.equal(after.active(),null));check(()=>assert.equal(after.take(sentinel),null));
 // Production IPC error envelope is untouched; diagnostics require a private
 // observer take, not automatic public API/log propagation.
 check(()=>assert.equal(source.includes('send({ type: "result", id: message.id, error: { code: "solver_unavailable", message: cause.message } });'),true));
 return {status:'SOURCE_ONLY_PRIVATE_EXCEPTION_CUSTODY',checks,solver:false,engine:false,actualFailureReproduced:false,
  sourceSha256:digest(source),predecessorSha256:baselineSha,diagnosticMaxObservedBytes:Buffer.byteLength(JSON.stringify(bounded)),
  noPublicPropagation:true,originalThrowIdentity:true,collectorCleanup:true,rawPayloadRetained:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(runStaticWeeklySolverExceptionDiagnosticTests()));
