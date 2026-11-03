import {isDeepStrictEqual} from 'node:util';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const keys='schema status service_date timezone authority requests dispatch_authorized delivery_admitted clock_effect_authority retention_authority'.split(' ');
const refused=new Set(['SOURCE_NOT_CURRENT','SOURCE_ORIGIN_UNSUPPORTED','SOURCE_AMBIGUOUS','SOURCE_LIMIT_EXCEEDED']);
const invalid=()=>{throw Object.assign(new Error('native_schedule_source_discovery_invalid'),{code:'native_schedule_source_discovery_invalid'});};
const exact=(v,k)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).every(x=>typeof x==='string'
 &&Object.getOwnPropertyDescriptor(v,x)?.enumerable===true&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,x),'value'))
 &&isDeepStrictEqual(Reflect.ownKeys(v).sort(),[...k].sort());
const id=x=>typeof x==='string'&&UUID.test(x);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function date(v){
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v.startsWith('0000'))return false;
 const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===v;
}
export function validateNativeScheduleSourceRequests(v){
 if(!exact(v,keys)||v.schema!=='custodial.native-schedule-source-requests.v1'||!date(v.service_date)
  ||v.timezone!=='America/Chicago'||v.dispatch_authorized!==false||v.delivery_admitted!==false
  ||v.clock_effect_authority!==null||v.retention_authority!==null||!Array.isArray(v.requests)
  ||Object.getPrototypeOf(v.requests)!==Array.prototype||v.requests.length>4096
  ||Reflect.ownKeys(v.requests).length!==v.requests.length+1||Reflect.ownKeys(v.requests).some(k=>typeof k!=='string'
   ||(k!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.requests.length
    ||!Object.hasOwn(Object.getOwnPropertyDescriptor(v.requests,k),'value')))))invalid();
 if(refused.has(v.status)){
  if(v.authority!==null||v.requests.length)invalid();
 }else{
  if(v.status!=='SOURCE_CANDIDATES_ONLY'||!exact(v.authority,['projection_id','publication_id','version_id','source_revision'])
   ||!['projection_id','publication_id','version_id'].every(k=>id(v.authority[k]))
   ||typeof v.authority.source_revision!=='string'||!/^[1-9][0-9]{0,15}$/.test(v.authority.source_revision)
   ||!Number.isSafeInteger(Number(v.authority.source_revision)))invalid();
  let previous='';
  const anchors=new Set(),generations=new Set();
  for(const r of v.requests){
   if(!exact(r,['source_key','employee_id','generation_id'])||!Object.values(r).every(id)
    ||r.employee_id<=previous||generations.has(r.generation_id))invalid();
   // A temporary lunch coverer may legitimately share an anchor with its
   // normal owner. Logical episodes are per employee, never per artwork pin.
   previous=r.employee_id;generations.add(r.generation_id);anchors.add(r.source_key);
  }
 }
 return freeze(structuredClone(v));
}
// Read-only service seam. No caller date/time, direct table access, source
// reservation, new timer, provider, token, clock permit or worker activation.
export async function readNativeScheduleSourceRequests({db}){
 if(typeof db?.rpc!=='function')invalid();
 let r;try{r=await db.rpc('custodial_native_schedule_source_requests',{});}catch{
  return freeze({status:'SOURCE_READ_PENDING',dispatch_authorized:false,delivery_admitted:false,requests:[]});
 }
 if(r?.error)return freeze({status:'SOURCE_READ_PENDING',dispatch_authorized:false,delivery_admitted:false,requests:[]});
 return validateNativeScheduleSourceRequests(r?.data);
}
