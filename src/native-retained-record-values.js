import {createHash,timingSafeEqual} from 'node:crypto';
import {originalRetainedRecordDigestAuthority} from './native-retained-wire-intake.js';

// UNMOUNTED preparation only. Supplied raw values stay opaque (including
// corrupt/unknown records); this never decrypts, captures a phone, writes an
// archive, authenticates new work, returns an ACK or authorizes key removal.
const SCHEMA='custodial.retained-native-record-values.v1';
const verifiedValueMatches=new WeakSet();
const MAX_BYTES=40*1024*1024,MAX_UNITS=8388608;
const fail=()=>{throw Object.assign(new Error('native_retained_record_values_invalid'),{code:'native_retained_record_values_invalid',status:400});};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const utf16Hex=(value,max,empty=true)=>{if(typeof value!=='string'||value.length>max*4
 ||value.length%4!==0||!(empty?/^(?:[0-9a-f]{4})*$/:/^(?:[0-9a-f]{4})+$/).test(value))fail();return value;};
function updateUtf16(digest,hex){const length=hex.length/4,prefix=Buffer.alloc(4);prefix.writeUInt32BE(length);digest.update(prefix);digest.update(Buffer.from(hex,'hex'));}
const asciiHex=text=>Buffer.from(text,'utf16le').swap16().toString('hex');
function valueDigest(type,value,budget){
 const digest=createHash('sha256');
 if(type==='string'){utf16Hex(value,524288);budget.units+=value.length/4;updateUtf16(digest,value);}
 else if(type==='int32'||type==='int64'){
  if(typeof value!=='string'||!/^-(?:[1-9][0-9]*)$|^(?:0|[1-9][0-9]*)$/.test(value)||value.length>20)fail();
  const number=BigInt(value),bits=type==='int32'?32n:64n,limit=1n<<(bits-1n);
  if(number < -limit || number >= limit)fail();updateUtf16(digest,asciiHex(value));
 }else if(type==='boolean'){if(typeof value!=='boolean')fail();digest.update(Buffer.from([value?1:0]));}
 else if(type==='float32'){
  // Fixed-width RAW bits retain NaN payloads and signed zero. Native hashes
  // Integer.toUnsignedString(Float.floatToRawIntBits(value),16), unpadded.
  if(typeof value!=='string'||!/^[0-9a-f]{8}$/.test(value))fail();
  updateUtf16(digest,asciiHex(value.replace(/^0+(?=.)/,'')));
 }else if(type==='string-set'){
  if(!Array.isArray(value)||value.length>4096)fail();let previous=null;
  for(const item of value){utf16Hex(item,524288);if(previous!==null&&item<=previous)fail();previous=item;
   budget.units+=item.length/4;updateUtf16(digest,item);}
 }else fail();
 if(budget.units>MAX_UNITS)fail();return digest.digest('hex');
}
export function verifyOriginalNativeRecordValues(capture,suppliedBytes){
 // Check the original module brand before parsing any caller values.
 const authority=originalRetainedRecordDigestAuthority(capture);
 if(!Buffer.isBuffer(suppliedBytes)||!suppliedBytes.length||suppliedBytes.length>MAX_BYTES)fail();
 const bytes=Buffer.from(suppliedBytes);let payload;
 try{for(const byte of bytes)if(byte<32||byte>126)fail();payload=JSON.parse(bytes.toString('ascii'));}catch{fail();}
 if(!payload||Array.isArray(payload)||Object.getPrototypeOf(payload)!==Object.prototype
  ||JSON.stringify(Object.keys(payload))!==JSON.stringify(['schema','records'])||payload.schema!==SCHEMA
  ||!Array.isArray(payload.records)||payload.records.length>4096||payload.records.length!==authority.record_count)fail();
 const budget={units:0};let previous='';
 for(let i=0;i<payload.records.length;i++){
  const row=payload.records[i],expected=authority.records[i];
  if(!Array.isArray(row)||row.length!==3)fail();const[key,type,value]=row;
  utf16Hex(key,1024,false);if(key<=previous||key!==expected[0]||type!==expected[1])fail();previous=key;budget.units+=key.length/4;
  const actual=valueDigest(type,value,budget);
  if(!timingSafeEqual(Buffer.from(actual,'ascii'),Buffer.from(expected[2],'ascii')))fail();
 }
 // Exact canonical ASCII grammar rejects duplicate/escaped duplicate fields,
 // alternate spelling, trailing bytes, lossy numbers and serializer ambiguity.
 if(!Buffer.from(JSON.stringify(payload),'ascii').equals(bytes))fail();
 const result=freeze({...authority,schema:'custodial.original-native-record-values-match.v1',verification:'ALL_ORIGINAL_RAW_VALUES_MATCHED_RETENTION_PREPARATION_ONLY',
  payload_schema:SCHEMA,value_bytes_sha256:hash(bytes),value_bytes:bytes.length,
  records:payload.records,record_values_matched:true,record_values_retained:false,
  native_semantic_inventory_state:'UNKNOWN',browser_inventory_state:'UNKNOWN',inventory_acknowledged:false,
  automatic_acceptance:false,work_accepted:false,new_work_allowed:false,phone_released:false});
 verifiedValueMatches.add(result);return result;
}
export const isVerifiedOriginalNativeRecordValueMatch=value=>verifiedValueMatches.has(value);
export const retainedNativeRecordValueLimits=Object.freeze({bytes:MAX_BYTES,characters:MAX_UNITS,records:4096,field_string_units:524288});
