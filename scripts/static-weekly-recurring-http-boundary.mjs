// Diagnostics for the disposable authenticated HTTP-to-SQL fixture only.
// Never return SQL values, arguments, credential data or error text.
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
