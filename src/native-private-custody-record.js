import {createHash,timingSafeEqual} from 'node:crypto';

// UNMOUNTED opaque-record SYNTAX only. No Supabase/RPC/auth lookup, decryption,
// raw preference decoder, credential/key, writer, HTTP route or retention ACK.
// Checksums/digest closure are NOT original-key/HMAC/current actor authority.
// A malicious sender can recompute them; a later normal authenticated owner
// must separately bind exact original record + current actor/generation.
const RECORD='custodial.native-private-eight-capsule-local-record.v1';
const CAPSULE='custodial.native-retained-eight-private-capsule.v1';
const VALUES='custodial.native-retained-eight-namespace-values.v1';
const AAD='org.memphiszoo.custodial.native-retained-eight-capsule.v1';
const KEY='org.memphiszoo.custodial.native-vault.v2';
const CHUNK=24576,VALUE=40*1024*1024,COUNT=Math.ceil(VALUE/CHUNK),MAX=VALUE+COUNT*256+8192;
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const FAMILIES=new Set(['SHARED_VAULT_V2','SEPARATE_PROVIDER_V1','LEGACY_VAULT_V1','LEGACY_ALIAS_BOUND_SECURE_STORAGE']);
const syntaxOnly=new WeakSet(),hash=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Object.assign(new Error('native_private_custody_record_syntax_invalid'),{code:'native_private_custody_record_syntax_invalid',status:400});};
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
class Reader {
 constructor(bytes){this.b=bytes;this.at=0;}
 take(n){if(!Number.isSafeInteger(n)||n<0||n>this.b.length-this.at)fail();const p=this.b.subarray(this.at,this.at+n);this.at+=n;return p;}
 int(){return this.take(4).readInt32BE(0);}
 long(){const v=this.take(8).readBigInt64BE(0);if(v<0n||v>BigInt(Number.MAX_SAFE_INTEGER))fail();return Number(v);}
 text(max){const n=this.int();if(n<1||n>max)fail();const p=this.take(n*2);let text='';
  for(let i=0;i<p.length;i+=2){const c=p.readUInt16BE(i);if(c<32||c>126)fail();text+=String.fromCharCode(c);}return text;}
 done(){if(this.at!==this.b.length)fail();}
}
const int=n=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b;};
const text=s=>{const b=Buffer.alloc(4+s.length*2);b.writeInt32BE(s.length);for(let i=0;i<s.length;i++)b.writeUInt16BE(s.charCodeAt(i),4+i*2);return b;};
function binding(bytes){
 const r=new Reader(bytes);if(r.text(128)!==AAD||r.text(128)!==CAPSULE||r.text(128)!==VALUES||r.text(128)!==KEY)fail();
 const names=['source_capture_sha256','values_sha256','semantic_join_sha256','layout_sha256','principal_digest','original_generation_id','original_frozen_work_sha256'],p={};
 for(const k of names){p[k]=r.text(64);if(!(k==='original_generation_id'?UUID:SHA).test(p[k]))fail();}
 p.engine_revision=r.long();p.byte_count=r.int();p.record_count=r.int();p.chunk_count=r.int();
 if(p.byte_count<1||p.byte_count>VALUE||p.record_count<0||p.record_count>32768||p.chunk_count!==Math.ceil(p.byte_count/CHUNK))fail();
 const families=[],seen=new Set();let rows=0;
 for(let i=0;i<4;i++){const name=r.text(64),count=r.long();if(!FAMILIES.has(name)||seen.has(name)||count>32768)fail();seen.add(name);rows+=count;
  families.push({key_family:name,source_declared_raw_rows_to_preserve:count,possible_undeclared_references:'UNKNOWN',zero_rows_is_not_key_removal_authority:true,
   current_server_reconciliation:false,finalizer_allowed:false,key_removal:false});}
 if(rows!==p.record_count||seen.size!==4)fail();r.done();return {...p,key_family_references:families};
}
export function inspectPrivateCustodyRecordSyntax(input){
 let owned;
 try {
  if(!Buffer.isBuffer(input)||Object.getPrototypeOf(input)!==Buffer.prototype||input.buffer instanceof SharedArrayBuffer||input.length<64||input.length>MAX)fail();
  owned=Buffer.from(input);const end=owned.length-32,payload=owned.subarray(0,end),checksum=createHash('sha256').update(payload).digest();
  if(!timingSafeEqual(checksum,owned.subarray(end)))fail();
  const r=new Reader(payload);if(r.int()!==0x4d5a4331||r.text(128)!==RECORD||r.text(128)!==CAPSULE)fail();
  const size=r.int();if(size<1||size>4096)fail();const rawBinding=r.take(size),p=binding(rawBinding),savedDigest=r.text(64),count=r.int();
  if(!SHA.test(savedDigest)||count<1||count>COUNT||count!==p.chunk_count)fail();
  const digest=createHash('sha256').update(rawBinding),chunks=[],ivs=new Set();let offset=0;
  for(let i=0;i<count;i++){
   const index=r.int(),start=r.int(),length=r.int(),sha=r.text(64),expected=Math.min(CHUNK,p.byte_count-offset);
   if(index!==i||start!==offset||length<1||length!==expected||!SHA.test(sha)||r.int()!==12)fail();
   const iv=r.take(12),ivIdentity=iv.toString('hex');if(ivs.has(ivIdentity))fail();ivs.add(ivIdentity);
   const encryptedBytes=r.int();if(encryptedBytes!==length+16)fail();const encrypted=r.take(encryptedBytes);
   const aad=Buffer.concat([int(size),rawBinding,int(index),int(start),int(length),text(sha)]);
   digest.update(aad).update(iv).update(encrypted);aad.fill(0);
   chunks.push({chunk_index:index,byte_offset:start,cleartext_bytes:length,chunk_sha256:sha,encrypted_bytes:encryptedBytes,iv_sha256:hash(iv),encrypted_sha256:hash(encrypted)});offset+=length;
  }
  if(offset!==p.byte_count)fail();r.done();if(digest.digest('hex')!==savedDigest)fail();
  const result=freeze({schema:'custodial.private-native-custody-record-syntax.v1',state:'UNAUTHENTICATED_OPAQUE_RECORD_SYNTAX_ONLY',
   record_schema:RECORD,capsule_schema:CAPSULE,values_schema:VALUES,aad_domain:AAD,existing_device_key_alias:KEY,
   record_bytes:owned.length,record_sha256:hash(owned),capsule_sha256:savedDigest,aad_binding_sha256:hash(rawBinding),...p,chunks,
   container_checksum_and_capsule_digest_match:true,checksum_is_authentication:false,original_key_or_GCM_authentication_verified:false,
   original_values_bytes_recovered:false,original_actor_current:false,current_generation_verified:false,current_normal_auth_verified:false,
   durable_retention:false,current_server_readback:false,complete_namespace_inventory:false,all_writer_durable_freeze_or_ABA_guard:false,
   native_semantic_inventory_state:'UNKNOWN',browser_inventory_state:'UNKNOWN',inventory_acknowledged:false,work_accepted:false,new_work_allowed:false,
   resend_allowed:false,finalizer_allowed:false,key_removal:false,phone_released:false});
  syntaxOnly.add(result);return result;
 }catch{fail();}finally{if(owned)owned.fill(0);}
}
export const isSyntaxOnlyPrivateCustodyRecord=value=>syntaxOnly.has(value);
export const privateCustodyRecordSyntaxLimits=Object.freeze({chunk_bytes:CHUNK,value_bytes:VALUE,chunk_count:COUNT,record_bytes:MAX,binding_bytes:4096});
