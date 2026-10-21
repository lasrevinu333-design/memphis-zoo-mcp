import {createHash,timingSafeEqual} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {verifyNativeProtectedSnapshotEvidence,nativeProtectedSnapshotEvidenceLimits} from './native-protected-snapshot-evidence.js';

// UNMOUNTED retention-only binding, NOT credential or database authentication.
// The owning private intake must authenticate the original purpose-only request,
// obtain the immutable separation context and this exact eight-field projection
// from the ORIGINAL employee_native_push_generations row. Caller-supplied JSON,
// today's generation, or a digest copied from this wire is NOT trusted provenance.
// No SQL/HTTP/storage/ACK/finalizer effects. Missing original proof stays pending.
const KEYS=['generation_id','device_id','device_identifier','credential_id','employee_id','assignment_epoch','principal_digest','activated_at'];
const HEX=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const fail=()=>{throw Object.assign(new Error('native_snapshot_original_generation_invalid'),{status:400,code:'native_snapshot_original_generation_invalid'});};
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&isDeepStrictEqual(Object.keys(value).sort(),[...keys].sort());
function micros(text){
 const m=typeof text==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(text);if(!m)fail();
 const [y,month,day,h,min,s,us]=m.slice(1).map(Number),leap=y%4===0&&(y%100!==0||y%400===0),lengths=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||month<1||month>12||day<1||day>lengths[month-1]||h>23||min>59||s>59)fail();
 const prior=y-1,days=365*prior+Math.floor(prior/4)-Math.floor(prior/100)+Math.floor(prior/400)+lengths.slice(0,month-1).reduce((a,b)=>a+b,0)+day-1;
 return (BigInt(days)*86400n+BigInt(h*3600+min*60+s))*1000000n+BigInt(us);
}
function principalDigest(validatedPrincipal){
 // NativeProviderPrincipal canonical v1: schema marker then TreeSet-ordered
 // [key,value] rows for ALL exact V1/V2 fields. Not ordinary JSON object SHA.
 return createHash('sha256').update(JSON.stringify(['custodial.native-provider-principal.v1',
  ...Object.keys(validatedPrincipal).sort().map(key=>[key,validatedPrincipal[key]])]),'utf8').digest('hex');
}
export function verifyNativeProtectedSnapshotOriginalGeneration(wireBytes,{separationContext,originalGeneration,credentialToken}={}){
 if(!Buffer.isBuffer(wireBytes)||wireBytes.length>nativeProtectedSnapshotEvidenceLimits.wireBytes)fail();
 let context,generation,bytes,wire,principal;try{
  context=structuredClone(separationContext);generation=structuredClone(originalGeneration);bytes=Buffer.from(wireBytes);
  wire=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));
  if(typeof wire?.manifest_body!=='string'||Buffer.byteLength(wire.manifest_body,'utf8')>nativeProtectedSnapshotEvidenceLimits.bodyBytes)fail();
  principal=JSON.parse(wire.manifest_body)?.original_principal;
 }catch{fail();}
 if(!exact(generation,KEYS)||!KEYS.filter(key=>key!=='assignment_epoch').every(key=>typeof generation[key]==='string')
  ||!UUID.test(generation.generation_id)||!UUID.test(generation.device_id)
  ||!UUID.test(generation.credential_id)||!UUID.test(generation.employee_id)
  ||!HEX.test(generation.principal_digest)||!Number.isSafeInteger(generation.assignment_epoch)||generation.assignment_epoch<1
  ||generation.device_id!==context?.device_id||generation.device_identifier!==context?.canonical_device_id
  ||generation.credential_id!==context?.credential_id||generation.employee_id!==context?.employee_id
  ||generation.assignment_epoch!==context?.assignment_epoch||micros(generation.activated_at)>=micros(context?.cutoff_at))fail();
 let raw;try{
  // The existing strict duplicate-free parser validates the full original body,
  // context/principal/credential HMAC/raw digest BEFORE digest authority is used.
  raw=verifyNativeProtectedSnapshotEvidence(bytes,{separationContext:context,nativePrincipal:principal,credentialToken});
 }catch{fail();}
 const digest=principalDigest(principal);
 if(!timingSafeEqual(Buffer.from(digest,'ascii'),Buffer.from(generation.principal_digest,'ascii')))fail();
 return Object.freeze({...raw,schema:'custodial.native-protected-generation-raw-binding.v1',
  verification:'MATCHED_PRE_CUTOFF_GENERATION_RAW_BINDING_RETENTION_ONLY',
  generation_id:generation.generation_id,principal_digest:digest,generation_activated_at:generation.activated_at});
}
