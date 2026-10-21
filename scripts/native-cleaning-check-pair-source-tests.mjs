import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./same-original-recovery-local-database-tests.mjs',import.meta.url),'utf8');
const begin=source.indexOf('      async advanceToSecondNativeVisit('),end=source.indexOf('\n    }:{}),',begin);
assert.ok(begin>0&&end>begin);const method=source.slice(begin,end);
let checks=0;const test=async fn=>{await fn();checks++;};
function fixture({state='AWAIT_MAIN_NATIVE_RESPONSE_CAPTURE',result='full',readFailure=false,wrongRead=false}={}){
 const args={p_client_session_id:'first-source-session',p_client_completion_id:'first-source-completion',p_native_finish_scan_entry_id:'first-finish',p_response_json:{work_result:result}};
 const saved={original:{client_completion_id:args.p_client_completion_id},result:{status:'closed'}};
 const calls=[],context={assert,Buffer,JSON,ordinaryVisit:1,state,activeLoanCheck:()=>{},capturedOrdinaryOriginals:[],
  completion:{result:{status:'closed'},readback:saved},start:{args:{p_client_session_id:args.p_client_session_id,p_native_scan_entry_id:'first-start'},result:{native_start_attested:true},response:Buffer.from('actual-owned-start-DATA')},
  originalArguments:Buffer.from(JSON.stringify(args)),commitResponse:Buffer.from('actual-owned-completion-DATA'),ids:{device:'source-device',employee:'source-employee',credential:'source-credential'},
  async tx(actor,sql,values){calls.push({actor,sql,values});context.activeLoanCheck();if(readFailure)throw Error('SOURCE_FIXED_READER_FAILURE');return[wrongRead?{...saved,result:{status:'foreign'}}:saved];}};
 vm.createContext(context);context.invoke=vm.runInContext('({'+method+'}).advanceToSecondNativeVisit',context);return{context,calls,invoke:bytes=>context.invoke({exactCapturedResponseBytes:bytes??Buffer.from('actual-owned-completion-DATA')})};
}
await test(async()=>{const f=fixture();const result=await f.invoke();assert.equal(result.visit,2);assert.equal(f.context.state,'AWAIT_NATIVE_START');assert.equal(f.context.ordinaryVisit,2);assert.equal(f.context.capturedOrdinaryOriginals.length,1);assert.equal(f.calls.length,1);assert.equal(f.calls[0].actor,'custodial_application_reader');assert.match(f.calls[0].sql,/read_original_scan_completion_v1/);assert.ok(!/insert|update|delete/i.test(f.calls[0].sql));assert.equal(f.context.capturedOrdinaryOriginals[0].originalArguments.length>0,true);await assert.rejects(f.invoke());assert.equal(f.calls.length,1);});
await test(async()=>{const f=fixture();await assert.rejects(f.invoke(Buffer.from('wrong-received-body')));assert.equal(f.calls.length,0);assert.equal(f.context.capturedOrdinaryOriginals.length,0);});
await test(async()=>{const f=fixture({state:'COMPLETION_UNKNOWN'});await assert.rejects(f.invoke());assert.equal(f.calls.length,0);assert.equal(f.context.state,'COMPLETION_UNKNOWN');});
await test(async()=>{const f=fixture({result:'checked_no_cleaning_needed'});await assert.rejects(f.invoke());assert.equal(f.calls.length,0);assert.equal(f.context.capturedOrdinaryOriginals.length,0);});
for(const option of ['readFailure','wrongRead'])await test(async()=>{const f=fixture({[option]:true});await assert.rejects(f.invoke());assert.equal(f.context.state,'NEXT_VISIT_UNKNOWN');assert.equal(f.context.ordinaryVisit,1);assert.equal(f.context.capturedOrdinaryOriginals.length,0);await assert.rejects(f.invoke());assert.equal(f.calls.length,1);assert.ok(f.context.originalArguments.length>0&&f.context.commitResponse.length>0,'unknown owner originals not cleared');});
// Current normal fixture guards are retained before the opt-in second-visit
// clauses. Their actual authentication/SQL qualification remains root-owned.
assert.match(source,/assert\.equal\(state,'AWAIT_NATIVE_START'\);state='START_UNKNOWN'/);
assert.match(source,/assert\.equal\(state,'AWAIT_NATIVE_COMPLETION'\);state='COMPLETION_UNKNOWN'/);
assert.match(source,/assert\.notEqual\(p\.p_client_session_id,first\.start\.args\.p_client_session_id/);
assert.match(source,/assert\.notEqual\(p\.p_client_completion_id,first\.arguments\.p_client_completion_id/);
assert.match(source,/assert\.notEqual\(p\.p_native_finish_scan_entry_id,first\.arguments\.p_native_finish_scan_entry_id/);
console.log(JSON.stringify({status:'PASS_SOURCE_RECORDING_ONLY',checks,SQL:false,native_process:false,accepted_rows_seeded:0,private_ACK:false}));
