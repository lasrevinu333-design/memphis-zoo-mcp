import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./verified-visit-dashboard-journey-bridge.mjs',import.meta.url),'utf8');
const start=source.indexOf(' async function readerTransaction('),end=source.indexOf(' const startArgs=',start);
assert.ok(start>0&&end>start);
function fixture(){
 let active=false,actor='supabase_admin';const calls=[];
 const admin={async query(sql){
  calls.push(sql);await new Promise(resolve=>setImmediate(resolve));
  if(sql==='select pg_backend_pid() pid')return{rows:[{pid:7}]};
  if(sql==='begin read only'){assert.equal(active,false,'overlapping BEGIN on original dedicated SQLsession');active=true;return{rows:[]};}
  if(sql==='set local role custodial_application_reader'){assert.equal(active,true);actor='custodial_application_reader';return{rows:[]};}
  if(sql.startsWith('select current_user'))return{rows:[{who:actor,ro:active?'on':'off'}]};
  if(sql==='commit'||sql==='rollback'){active=false;actor='supabase_admin';return{rows:[]};}
  assert.equal(active,true);assert.equal(actor,'custodial_application_reader');
  if(sql==='synthetic denied read')throw Error('SYNTHETIC_READER_DENIAL');
  return{rows:[{source:sql}]};
 }};
 const context=vm.createContext({admin,assert,backendPid:7,READER:'custodial_application_reader'});
 vm.runInContext('let reads=0,readerTail=Promise.resolve();\n'+source.slice(start,end)+'\nglobalThis.queued=reader;globalThis.unserialized=readerTransaction;',context);
 return{context,calls};
}
const unsafe=fixture();
const negative=await Promise.allSettled(['one','two','three'].map(sql=>unsafe.context.unserialized(sql)));
assert.ok(negative.some(x=>x.status==='rejected'&&/overlapping BEGIN/.test(x.reason.message)),
 'causal control must reproduce the original same-session Promise.all overlap');
const safe=fixture();
const rows=await Promise.all(['one','two','three','four','five'].map(sql=>safe.context.queued(sql)));
assert.equal(rows.length,5);assert.equal(safe.calls.filter(x=>x==='begin read only').length,5);
assert.equal(safe.calls.filter(x=>x==='commit').length,5);
await assert.rejects(safe.context.queued('synthetic denied read'),/SYNTHETIC_READER_DENIAL/);
await safe.context.queued('independent next read');
assert.equal(safe.calls.filter(x=>x==='synthetic denied read').length,1,'no retry of failed operation');
assert.equal(safe.calls.filter(x=>x==='rollback').length,1);
console.log(JSON.stringify({status:'PASS_SOURCE_SESSION_ORDERING',actual_shipping_adapter_closure:true,
 original_overlap_control_rejected:true,five_summary_reads_serialized:true,denied_read_rolled_back_once:true,
 SQL_or_native_authentication_executed:false}));
