// Owning CI child lifecycle only. Never extends product solver resources.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
const groupAbsent=pid=>{
 if(!Number.isSafeInteger(pid)||pid<=0)return true;
 try{process.kill(-pid,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw e;}
};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function runBoundedNodeProof({args,cwd=process.cwd(),maxBuffer=1024*1024,
 absoluteMilliseconds=60000,cleanupReserveMilliseconds=5000,termGraceMilliseconds=1000,
 signal=null,onReceipt=receipt=>console.log(JSON.stringify({suite:'bounded-node-proof-lifecycle',...receipt}))}){
 const origin=performance.now(),startedAt=new Date().toISOString();
 assert.ok(Number.isSafeInteger(absoluteMilliseconds)&&absoluteMilliseconds>0&&absoluteMilliseconds<=60000);
 assert.ok(Number.isSafeInteger(cleanupReserveMilliseconds)&&cleanupReserveMilliseconds>0&&cleanupReserveMilliseconds<absoluteMilliseconds);
 assert.ok(Number.isSafeInteger(termGraceMilliseconds)&&termGraceMilliseconds>0&&termGraceMilliseconds<cleanupReserveMilliseconds);
 assert.ok(Array.isArray(args)&&args.every(a=>typeof a==='string'));
 assert.ok(Number.isSafeInteger(maxBuffer)&&maxBuffer>0);
 const deadline=origin+absoluteMilliseconds,workDeadline=deadline-cleanupReserveMilliseconds;
 const output=[],errors=[],signals=[];let outputBytes=0,errorBytes=0,child=null,terminal=null,spawnError=null,reason=null;
 let workTimer=null,killTimer=null,forceEndTimer=null,aborted=false;
 const elapsed=()=>performance.now()-origin;
 function kill(sig,why){
  if(!child?.pid)return;
  let sent=false,error=null;
  try{if(!groupAbsent(child.pid)){process.kill(-child.pid,sig);sent=true;}}catch(e){error=e.code||e.name;}
  signals.push({signal:sig,reason:why,sent,error,elapsedMs:elapsed()});
 }
 function stop(why){
  if(reason)return;
  reason=why;kill('SIGTERM',why);
  killTimer=setTimeout(()=>kill('SIGKILL','cleanup_reserve'),Math.max(0,Math.min(termGraceMilliseconds,deadline-performance.now()-1)));
 }
 const abort=()=>{aborted=true;stop('aborted');};
 let resolveEnd;const ended=new Promise(resolve=>resolveEnd=resolve);
 try{
  if(signal?.aborted){aborted=true;reason='aborted_before_spawn';}
  else{
   child=spawn(process.execPath,args,{cwd,env:{PATH:process.env.PATH,LANG:'C.UTF-8'},detached:true,stdio:['ignore','pipe','pipe']});
   // Register terminal listeners before any path can send a signal.
   child.once('error',e=>{spawnError={code:e.code||null,name:e.name};});
   child.once('exit',(code,sig)=>{terminal={code,signal:sig};});
   // Preserve the final receipt bytes: exit can precede stdout/stderr draining.
   child.once('close',()=>resolveEnd());
   child.stdout.on('data',chunk=>{
    outputBytes+=chunk.length;if(outputBytes<=maxBuffer)output.push(chunk);else stop('stdout_limit');
   });
   child.stderr.on('data',chunk=>{
    errorBytes+=chunk.length;if(errorBytes<=maxBuffer)errors.push(chunk);else stop('stderr_limit');
   });
   signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted)abort();
   workTimer=setTimeout(()=>stop('absolute_work_cutoff'),Math.max(0,workDeadline-performance.now()));
   forceEndTimer=setTimeout(()=>{kill('SIGKILL','absolute_deadline');resolveEnd();},Math.max(0,deadline-performance.now()-5));
   await ended;
  }
 }finally{
  clearTimeout(workTimer);clearTimeout(killTimer);clearTimeout(forceEndTimer);signal?.removeEventListener('abort',abort);
  if(child?.pid&&!groupAbsent(child.pid)){
   if(!reason)reason='owned_group_survived_terminal';
   kill('SIGKILL','post_terminal_owned_group');
   while(!groupAbsent(child.pid)&&performance.now()<deadline-2)await sleep(Math.min(10,Math.max(1,deadline-performance.now()-2)));
  }
  child?.stdout?.destroy();child?.stderr?.destroy();
 }
 const receipt={startedAt,endedAt:new Date().toISOString(),pid:child?.pid??null,elapsedMs:elapsed(),
  absoluteMilliseconds,cleanupReserveMilliseconds,terminal,spawnError,reason,aborted,
  outputBytes,errorBytes,signals,groupAbsent:groupAbsent(child?.pid)};
 receipt.passed=reason===null&&!spawnError&&terminal?.code===0&&terminal?.signal===null
  &&receipt.groupAbsent&&receipt.elapsedMs<=absoluteMilliseconds;
 onReceipt(receipt);
 if(!receipt.passed){const error=new Error('bounded_node_proof_failed:'+String(reason||spawnError?.code||terminal?.signal||terminal?.code||'unsettled'));
  error.code='bounded_node_proof_failed';error.receipt=receipt;throw error;}
 return{stdout:Buffer.concat(output).toString('utf8'),stderr:Buffer.concat(errors).toString('utf8'),receipt};
}
