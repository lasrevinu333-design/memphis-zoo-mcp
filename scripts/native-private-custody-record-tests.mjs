import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {inspectPrivateCustodyRecordSyntax as inspect,isSyntaxOnlyPrivateCustodyRecord as branded,privateCustodyRecordSyntaxLimits as limits} from '../src/native-private-custody-record.js';

// NEW actual Java-produced encrypted record vs Node codec only. Fixture rows,
// provider/auth/key/clock are synthetic. No DB/network/Android/old tests.
const root=process.argv[2];assert.ok(root&&path.isAbsolute(root));
const original=fs.readFileSync(root+'/custodial-private-eight-custody-v1/capsule.bin'),expected=JSON.parse(fs.readFileSync(root+'/expected-metadata.json'));
assert.equal(expected.synthetic_only,true);
const hash=b=>createHash('sha256').update(b).digest(),int=(b,p,v)=>b.writeInt32BE(v,p),checksum=b=>{hash(b.subarray(0,b.length-32)).copy(b,b.length-32);return b;};
const denied=b=>{const before=Buffer.isBuffer(b)?Buffer.from(b):null;assert.throws(()=>inspect(b),e=>e.code==='native_private_custody_record_syntax_invalid'&&e.status===400);
 if(before)assert.ok(before.equals(b),'caller input must stay byte-identical');};
function locate(b){let at=4;const text=()=>{const lengthAt=at,n=b.readInt32BE(at);at+=4;const start=at;at+=n*2;return {lengthAt,start,n,end:at};};
 const record=text(),schema=text(),bindingSizeAt=at,size=b.readInt32BE(at);at+=4;const bindingStart=at;at+=size;const capsule=text(),countAt=at,count=b.readInt32BE(at);at+=4;
 const chunks=[];for(let i=0;i<count;i++){const begin=at,index=at,offset=at+4,length=at+8;at+=12;const digest=text(),ivLengthAt=at;at+=4;const ivAt=at;at+=12;const encryptedLengthAt=at,n=b.readInt32BE(at);at+=4;const encryptedAt=at;at+=n;
  chunks.push({begin,index,offset,length,digest,ivLengthAt,ivAt,encryptedLengthAt,encryptedAt,encryptedBytes:n,end:at});}
 const outerAt=at;at=bindingStart;const fields=[];for(let i=0;i<11;i++)fields.push(text());const revisionAt=at,bytesAt=at+8,recordsAt=at+12,chunksAt=at+16;at+=20;
 const families=[];for(let i=0;i<4;i++){const name=text(),countAt=at;at+=8;families.push({name,countAt});}
 return {record,schema,bindingSizeAt,bindingStart,bindingSize:size,capsule,countAt,chunks,fields,revisionAt,bytesAt,recordsAt,chunksAt,families,outerAt};
}
const p=locate(original),changed=run=>{const b=Buffer.from(original);run(b);return checksum(b);},rewriteText=(b,p,s)=>{assert.equal(s.length,p.n);for(let i=0;i<s.length;i++)b.writeUInt16BE(s.charCodeAt(i),p.start+i*2);};
function rewriteDigests(b){const q=locate(b),binding=b.subarray(q.bindingStart,q.bindingStart+q.bindingSize),d=createHash('sha256').update(binding);
 for(const c of q.chunks){const aad=Buffer.alloc(4+q.bindingSize+12+4+c.digest.n*2);let at=0;aad.writeInt32BE(q.bindingSize,at);at+=4;binding.copy(aad,at);at+=binding.length;
  b.copy(aad,at,c.index,c.index+12);at+=12;b.copy(aad,at,c.digest.lengthAt,c.digest.end);d.update(aad).update(b.subarray(c.ivAt,c.ivAt+12)).update(b.subarray(c.encryptedAt,c.end));}
 rewriteText(b,q.capsule,d.digest('hex'));return checksum(b);
}
function noAuthority(r){for(const key of ['checksum_is_authentication','original_key_or_GCM_authentication_verified','original_values_bytes_recovered','original_actor_current','current_generation_verified','current_normal_auth_verified',
 'durable_retention','current_server_readback','complete_namespace_inventory','all_writer_durable_freeze_or_ABA_guard','inventory_acknowledged','work_accepted','new_work_allowed','resend_allowed','finalizer_allowed','key_removal','phone_released'])assert.equal(r[key],false,key);
 assert.equal(r.native_semantic_inventory_state,'UNKNOWN');assert.equal(r.browser_inventory_state,'UNKNOWN');}
test('Java exact native multi-chunk record matches Node syntax metadata, geometry and original key-family names',()=>{
 const r=inspect(original),c=expected.capsule,l=expected.layout;assert.equal(r.record_sha256,expected.saved_record.record_sha256);assert.equal(r.record_bytes,expected.saved_record.record_bytes);
 for(const k of ['capsule_sha256','aad_binding_sha256','source_capture_sha256','values_sha256','semantic_join_sha256','layout_sha256','principal_digest','original_generation_id','original_frozen_work_sha256','engine_revision','byte_count','record_count','chunk_count'])assert.equal(r[k],c[k]??l[k],k);
 assert.ok(r.chunk_count>1);assert.equal(r.chunks.length,c.chunks.length);
 for(let i=0;i<r.chunks.length;i++)for(const k of ['chunk_index','byte_offset','cleartext_bytes','chunk_sha256','encrypted_bytes','iv_sha256','encrypted_sha256'])assert.equal(r.chunks[i][k],c.chunks[i][k],k);
 assert.deepEqual(r.key_family_references.map(v=>[v.key_family,v.source_declared_raw_rows_to_preserve]),l.key_family_references.map(v=>[v.key_family,v.source_declared_raw_rows_to_preserve]));
 assert.equal(expected.file_observation.key_family,'SHARED_VAULT_V2');assert.ok(r.key_family_references.some(v=>v.key_family===expected.file_observation.key_family));noAuthority(r);
});
test('Syntax brand/frozen metadata never makes JSON copies authenticated or exposes record/ciphertext/key bytes',()=>{
 const r=inspect(original);assert.ok(branded(r));assert.equal(branded(structuredClone(r)),false);assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.chunks));noAuthority(r);
 const text=JSON.stringify(r);for(const name of ['"ciphertext"','"iv"','"raw_values"','"body_base64"','synthetic-batch-token-one'])assert.equal(text.includes(name),false);
});
test('Valid and invalid parsing leave caller encrypted bytes untouched',()=>{const before=Buffer.from(original);inspect(original);assert.ok(original.equals(before));denied(changed(b=>b[0]^=1));});
test('Wrong magic and fixed schema names refuse even after container checksum rewrite',()=>{
 denied(changed(b=>int(b,0,0x4d5a4332)));denied(changed(b=>b.writeUInt16BE(88,p.record.start)));denied(changed(b=>b.writeUInt16BE(88,p.schema.start)));
});
test('Truncated data and extra trailing material refuse, without choosing a prefix',()=>{for(const n of [0,1,31,63,original.length-1,original.length-32])denied(original.subarray(0,n));
 denied(checksum(Buffer.concat([original.subarray(0,original.length-32),Buffer.from([0]),Buffer.alloc(32)])));});
test('Corrupt checksum or ciphertext without matching full capsule digest refuse',()=>{
 const a=Buffer.from(original);a[a.length-1]^=1;denied(a);denied(changed(b=>b[p.chunks[0].encryptedAt]^=1));
});
test('Negative zero oversized and exhausted binding lengths refuse before reads',()=>{for(const v of [-1,0,4097,2147483647])denied(changed(b=>int(b,p.bindingSizeAt,v)));});
test('Wrong native AAD/capsule/value schema or original key alias refuses',()=>{for(const field of p.fields.slice(0,4))denied(changed(b=>b.writeUInt16BE(88,field.start)));});
test('Malformed digest and generation identity forms refuse without coercion',()=>{
 for(const i of [4,5,6,7,8,10])denied(changed(b=>b.writeUInt16BE(71,p.fields[i].start)));
 denied(changed(b=>b.writeUInt16BE(90,p.fields[9].start)));
});
test('Negative or non-safe exact long revision refuses rather than round or coerce',()=>{
 for(const n of [-1n,9007199254740992n])denied(changed(b=>b.writeBigInt64BE(n,p.revisionAt)));
});
test('Raw byte count record count and fixed chunk count limits refuse',()=>{
 for(const n of [0,-1,limits.value_bytes+1])denied(changed(b=>int(b,p.bytesAt,n)));
 for(const n of [-1,32769])denied(changed(b=>int(b,p.recordsAt,n)));
 denied(changed(b=>int(b,p.chunksAt,1)));
});
test('Outer chunk count cannot omit add or substitute binding plan chunks',()=>{for(const n of [0,1,p.chunks.length+1,limits.chunk_count+1])denied(changed(b=>int(b,p.countAt,n)));});
test('Holes reordered indices or mismatched offsets refuse before checksum authority',()=>{
 denied(changed(b=>int(b,p.chunks[0].index,1)));denied(changed(b=>int(b,p.chunks[1].offset,0)));denied(changed(b=>int(b,p.chunks[0].length,1)));
});
test('Unknown raw digest non-GCM tag geometry and IV length refuse',()=>{
 denied(changed(b=>b.writeUInt16BE(90,p.chunks[0].digest.start)));denied(changed(b=>int(b,p.chunks[0].ivLengthAt,16)));
 denied(changed(b=>int(b,p.chunks[0].encryptedLengthAt,p.chunks[0].encryptedBytes-1)));
});
test('Repeated IV refuses even with recomputed untrusted capsule and container digests',()=>{
 const b=Buffer.from(original);b.copy(b,p.chunks[1].ivAt,p.chunks[0].ivAt,p.chunks[0].ivAt+12);denied(rewriteDigests(b));
});
test('Unknown duplicate missing or inconsistent family rows never grant retirement',()=>{
 denied(changed(b=>b.writeUInt16BE(88,p.families[0].name.start)));denied(changed(b=>b.writeBigInt64BE(32769n,p.families[0].countAt)));
 denied(changed(b=>b.writeBigInt64BE(b.readBigInt64BE(p.families[0].countAt)+1n,p.families[0].countAt)));
});
test('Rewritten checksums may match tampered ciphertext SYNTAX but remain unauthenticated, unrecovered and unaccepted',()=>{
 const b=Buffer.from(original);b[p.chunks[0].encryptedAt]^=1;rewriteDigests(b);const r=inspect(b);assert.notEqual(r.capsule_sha256,expected.capsule.capsule_sha256);noAuthority(r);
 assert.equal(r.container_checksum_and_capsule_digest_match,true);assert.equal(r.original_key_or_GCM_authentication_verified,false);
});
test('Nonbuffer shared-memory and inherited Buffer objects are not caller byte authority',()=>{
 denied(new Uint8Array(original));denied(original.toString('base64'));denied(Buffer.from(new SharedArrayBuffer(128)));
 const inherited=Buffer.from(original);Object.setPrototypeOf(inherited,Object.create(Buffer.prototype));denied(inherited);
});
