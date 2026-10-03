// Diagnostics for the disposable authenticated HTTP-to-SQL fixture only.
// Never return SQL values, arguments, credential data or error text.
import {types} from 'node:util';

// Test-only finite clock facts. Node's monotonic clock is anchored at its
// timeOrigin, so independently bounded fixture processes can align phases
// without recording SQL arguments, request bodies, or credentials.
const CLOCK_PHASES=new Set(['published_child_spawn','published_child_terminal',
 'confirm_origin','confirm_response_finished','confirm_response_closed',
 'confirm_request_terminal','confirm_transport_failure','confirm_fixture_finally',
 'confirm_process_exit']);
const CLOCK_OUTCOMES=new Set(['STARTED','RETURNED','THREW','FINISHED','UNFINISHED',
 'ERROR','ENTERED','PROCESS_EXIT']);
export function createRecurringClockRecorder({now=()=>performance.timeOrigin+performance.now(),
 emit=()=>{},deadlineMilliseconds=null}={}) {
 let origin=null;
 return Object.freeze({mark(phase,outcome) {
  if(!CLOCK_PHASES.has(phase)||!CLOCK_OUTCOMES.has(outcome))return null;
  let epoch;
  try{epoch=Math.round(now());}catch{return null;}
  if(!Number.isSafeInteger(epoch)||epoch<0)return null;
  if(origin===null)origin=epoch;
  const fact={phase,outcome,epochMilliseconds:epoch,originEpochMilliseconds:origin,
   elapsedMilliseconds:epoch-origin,
   ...(Number.isSafeInteger(deadlineMilliseconds)&&deadlineMilliseconds>0
    ?{deadlineEpochMilliseconds:origin+deadlineMilliseconds}:{})};
  if(!Number.isSafeInteger(fact.deadlineEpochMilliseconds??0))return null;
  try{emit(fact);}catch{}
  return fact;
 }});
}

export function runRecurringClockedChild(work,clock) {
 if(typeof work!=='function')throw new TypeError('bounded child work required');
 const mark=(phase,outcome)=>{try{clock?.mark?.(phase,outcome);}catch{}};
 mark('published_child_spawn','STARTED');
 let outcome='RETURNED';
 try{return work();}
 catch(error){outcome='THREW';throw error;}
 finally{mark('published_child_terminal',outcome);}
}
export function recurringHttpSqlBoundary(sql) {
 if(sql==='begin'||sql==='commit'||sql==='rollback')return sql;
 if(sql==='set local role static_weekly_control_plane')return 'set_local_role';
 if(sql==='select public.custodial_begin_application_mutation()')return 'restore_generation_fence';
 if(/^select pg_catalog\.pg_advisory_xact_lock\(/.test(sql))return 'authority_lock';
 const rpc=/^select public\.(static_weekly_[a-z0-9_]+)\(/.exec(sql);
 return rpc?.[1]??null;
}

const ERROR_NAMES=new Set(['TypeError','Error','AbortError','TimeoutError','SocketError','HeadersTimeoutError','BodyTimeoutError']);
const ERROR_CODES=new Set(['UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET',
 'ECONNRESET','ETIMEDOUT','ECONNABORTED','EPIPE','ABORT_ERR']);

// A transport failure may include a URL or secret in its message/stack. Only
// these finite diagnostic tokens may leave the disposable test process.
export function recurringHttpTransportFailure(error) {
 const token=(value,allowed)=>typeof value==='string'&&allowed.has(value)?value:'OTHER';
 const read=(value,key)=>{try{return value?.[key];}catch{return undefined;}};
 const cause=read(error,'cause');
 return {name:token(read(error,'name'),ERROR_NAMES),code:token(read(error,'code'),ERROR_CODES),
  causeName:token(read(cause,'name'),ERROR_NAMES),causeCode:token(read(cause,'code'),ERROR_CODES)};
}

export function captureRecurringHttpTransportFailure(error,{phase,elapsedMilliseconds,emit,persist}) {
 let fact;
 try{fact={phase,elapsedMilliseconds,...recurringHttpTransportFailure(error)};}catch{return null;}
 try{emit?.(fact);}catch{}
 try{persist?.(fact);}catch{}
 return fact;
}

export function rethrowOriginalTransportError(error,capture) {
 try{capture(error);}catch{}
 throw error;
}

const UNKNOWN_DATA=Symbol('unknown diagnostic data');
const MISSING_DATA=Symbol('missing diagnostic data');
function ownPlainData(value,key) {
 if(value===null||typeof value!=='object')return UNKNOWN_DATA;
 try {
  // A proxy's descriptor/prototype traps can mutate scheduling inputs. Node's
  // native proxy check does not invoke those traps, so leave it unclassified.
  if(types.isProxy(value))return UNKNOWN_DATA;
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)return UNKNOWN_DATA;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor)return MISSING_DATA;
  return Object.hasOwn(descriptor,'value')?descriptor.value:UNKNOWN_DATA;
 } catch{return UNKNOWN_DATA;}
}

// Disposable fixture observation only. Preserve the exact default preparer,
// its input/options identities, call count and returned object/error. The
// diagnostic sink is never part of scheduler authority or success.
export function recurringHttpCompilerProbe(prepare,trace) {
 if(typeof prepare!=='function')throw new TypeError('compiler preparer required');
 const emit=phase=>{try{trace?.(phase);}catch{}};
 return async function observedPrepare(input,args,options) {
  let kind='other';
  const observedKind=ownPlainData(args,'kind');
  if(observedKind==='draft'||observedKind==='projection')kind=observedKind;
  emit(`compiler_prepare_start:${kind}`);
  try {
   const result=arguments.length===2?await prepare(input,args):await prepare(input,args,options);
   let lunch='lunch_not_applicable';
   if(kind==='projection') {
    const document=ownPlainData(result,'lunchDocument');
    if(document===MISSING_DATA||document===null||document===undefined)lunch='lunch_absent';
    else {
     const identity=ownPlainData(document,'document_identity');
     lunch=typeof identity==='string'&&identity.length>0?'lunch_present':'lunch_unknown';
    }
   }
   emit(`compiler_prepare_complete:${kind}:${lunch}`);
   return result;
  } catch(error) {
   emit(`compiler_prepare_rejected:${kind}`);
   throw error;
  }
 };
}
