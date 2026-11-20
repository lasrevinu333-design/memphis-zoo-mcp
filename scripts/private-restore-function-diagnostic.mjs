// Observation only, for the existing owned disposable current-postgres copy.
// No row/query text, raw identity, target authority, or admission decision.
import {isProxy} from 'node:util/types';
const format='custodial.private-restore-function-cost.v1';
const own=(value,key)=>{
 if(!value||typeof value!=='object'||isProxy(value))return undefined;
 const descriptor=Object.getOwnPropertyDescriptor(value,key);
 return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
};
const record=(value,keys)=>{
 if(!value||typeof value!=='object'||isProxy(value)||Array.isArray(value)
  ||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
 const actual=Reflect.ownKeys(value);
 return actual.length===keys.length&&actual.every(k=>typeof k==='string'&&keys.includes(k)
  &&Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value'));
};
export function privateFunctionStatsArguments(ownerProfile){
 if(record(ownerProfile,['id','actor'])&&own(ownerProfile,'id')==='immutable-private-current-postgres'
  &&own(ownerProfile,'actor')==='postgres')return ['-c','track_functions=all'];
 return [];
}
// Fixed SELECT on statistics/catalog metadata only. Never exports the function
// definition, schema/name, SQL text, parameters, message DATA or current query.
export const PRIVATE_FUNCTION_STATS_SQL=`SELECT jsonb_build_object(
 'schema','${format}','track_functions',current_setting('track_functions'),
 'jit',current_setting('jit'),'functions',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'function_sha256',f.function_sha256,'calls',f.calls::text,
  'total_ms',round(f.total_time::numeric,3)::text,'self_ms',round(f.self_time::numeric,3)::text)
  ORDER BY f.total_time DESC,f.function_sha256) FROM (
   SELECT encode(extensions.digest(convert_to(format('%I.%I(%s)',n.nspname,p.proname,
     pg_get_function_identity_arguments(p.oid)),'UTF8'),'sha256'),'hex') AS function_sha256,
    s.calls,s.total_time,s.self_time
   FROM pg_stat_user_functions s JOIN pg_proc p ON p.oid=s.funcid
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN('custodial_dr','public','auth','storage','custodial_release_identity',
     'custodial_employment','custodial_coverall','custodial_leadership_private')
   ORDER BY s.total_time DESC,function_sha256 LIMIT 32
  ) f),'[]'::jsonb)) AS diagnostic;`;
export function projectPrivateFunctionStats(value){
 try{
  if(!record(value,['schema','track_functions','jit','functions'])||own(value,'schema')!==format
   ||!['all','pl','none'].includes(own(value,'track_functions'))||!['on','off'].includes(own(value,'jit')))return null;
  const rows=own(value,'functions');
  if(!Array.isArray(rows)||isProxy(rows)||rows.length>32
   ||Reflect.ownKeys(rows).length!==rows.length+1)return null;
  const result=[],seen=new Set();
  for(let i=0;i<rows.length;i++){
   const row=own(rows,String(i));
   if(!record(row,['function_sha256','calls','total_ms','self_ms']))return null;
   const digest=own(row,'function_sha256'),calls=own(row,'calls'),total=own(row,'total_ms'),self=own(row,'self_ms');
   if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)||seen.has(digest)
    ||typeof calls!=='string'||!/^(0|[1-9][0-9]{0,14})$/.test(calls)
    ||[total,self].some(v=>typeof v!=='string'||!/^(0|[1-9][0-9]{0,11})\.[0-9]{3}$/.test(v))
    ||Number(self)>Number(total))return null;
   seen.add(digest);result.push({function_sha256:digest,calls,total_ms:total,self_ms:self});
  }
  return {schema:format,track_functions:own(value,'track_functions'),jit:own(value,'jit'),
   functions:result,metadata_only:true,private_payload_exported:false};
 }catch{return null;}
}
export function readPrivateFunctionStats(stdout){
 if(typeof stdout!=='string'||Buffer.byteLength(stdout)>16384)return null;
 try{return projectPrivateFunctionStats(JSON.parse(stdout));}catch{return null;}
}
