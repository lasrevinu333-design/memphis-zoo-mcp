// Test-only, one-use IPC wrapper. The parent proves this detached group's
// identity before sending work; the publication fixture's compiler inherits it.
import {readFileSync,writeFileSync} from 'node:fs';
import {recurringOperationSourceManifest} from '../src/static-weekly-recurring-operation-source.js';

const HEX=/^[a-f0-9]{64}$/;
const NONCE=/^[a-f0-9]{48}$/;
let state='new',nonce=null,sourceDigest=null;
const startedAt=performance.now();
function failureFact(error){
 const code=typeof error?.code==='string'&&/^static_weekly_[a-z0-9_]{1,100}$/.test(error.code)
  ?error.code:'static_weekly_owned_checkpoint_failed';
 const errorClass=typeof error?.name==='string'&&/^[A-Za-z]{1,40}$/.test(error.name)?error.name:'Unknown';
 return {status:'FAILED',phase:'checkpoint_publication_or_readback',code,errorClass,
  childElapsedMilliseconds:Math.max(0,Math.round(performance.now()-startedAt))};
}
async function send(message){await new Promise((resolve,reject)=>process.send(message,error=>error?reject(error):resolve()));}
async function close(){if(process.connected)process.disconnect();}
async function receive(message){
 if(state==='new'){
  if(message?.type!=='init'||!NONCE.test(message.nonce||'')||!HEX.test(message.sourceDigest||''))return close();
  if(recurringOperationSourceManifest().digest!==message.sourceDigest)return close();
  nonce=message.nonce;sourceDigest=message.sourceDigest;state='ready';
  await send({type:'ready',nonce,sourceDigest});return;
 }
 if(state!=='ready'||message?.type!=='run'||message.nonce!==nonce||message.sourceDigest!==sourceDigest
   ||Object.keys(message.input||{}).join(',')!=='stage'||message.input.stage!=='current-manager-owned-219'
   ||!Number.isSafeInteger(message.remainingMilliseconds)||message.remainingMilliseconds<1
   ||message.remainingMilliseconds>60000)return close();
 state='running';
 const deadlineAt=performance.now()+message.remainingMilliseconds;
 const timer=setTimeout(()=>{process.exitCode=124;process.kill(process.pid,'SIGTERM');},
  message.remainingMilliseconds);
 try{
  if(recurringOperationSourceManifest().digest!==sourceDigest)throw new Error('source changed');
  await import('./static-weekly-current-roster-publication-tests.mjs');
  if(performance.now()>=deadlineAt)throw Object.assign(new Error('deadline'),{code:'static_weekly_operation_deadline'});
  const checkpoint=JSON.parse(readFileSync(process.env.STATIC_WEEKLY_TEST_OWNED_CHECKPOINT_OUTPUT,'utf8'));
  if(checkpoint.schema!=='custodial.synthetic-current-manager-219-owned-checkpoint.v1'
    ||!HEX.test(checkpoint.digest)||recurringOperationSourceManifest().digest!==sourceDigest)throw new Error('checkpoint unavailable');
  await send({type:'result',nonce,sourceDigest,status:'ok',receipt:{checkpointDigest:checkpoint.digest}});
 }catch(error){
  const fact=failureFact(error);
  try{writeFileSync(process.env.STATIC_WEEKLY_TEST_OWNED_CHECKPOINT_FAILURE_OUTPUT,
   JSON.stringify(fact)+'\n',{flag:'wx',mode:0o600});}catch{}
  await send({type:'result',nonce,sourceDigest,status:'failed',failureCode:fact.code});
 }finally{clearTimeout(timer);state='closed';await close();}
}
if(process.env.STATIC_WEEKLY_TEST_OWNED_CHECKPOINT_CHILD==='1'&&typeof process.send==='function'){
 process.on('message',message=>{void receive(message).catch(()=>{process.exitCode=70;void close();});});
}
