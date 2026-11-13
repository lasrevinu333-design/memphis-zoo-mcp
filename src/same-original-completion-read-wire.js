import {types} from 'node:util';
import {decodeCurrentOriginalPrivateQueryRead} from './native-private-custody-current-query-wire.js';

// UNTRUSTED representation only. Opaque completion arguments are not parsed,
// repaired or authenticated here. Main must bind the actual retained original,
// current native owner and closed completion semantics after authentication.
const PATH='/device-auth/private-custody-original-completion-read';
const SCHEMA='custodial.same-original-completion-read.v1';
const MAX=8388608,CURRENT_MAX=526336,ARGUMENT_MAX=4194304;
const FIELDS=['schema','current_original_query_envelope_base64','original_completion_arguments_base64'];
const typed=Object.getPrototypeOf(Uint8Array.prototype);
const getBuffer=Object.getOwnPropertyDescriptor(typed,'buffer').get;
const getLength=Object.getOwnPropertyDescriptor(typed,'byteLength').get;
const getOffset=Object.getOwnPropertyDescriptor(typed,'byteOffset').get;
const arrayLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
const resizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get;
const set=typed.set;

export const sameOriginalCompletionReadWire=Object.freeze({
  path:PATH,schema:SCHEMA,maxRequestBytes:MAX,
  maxOriginalQueryEnvelopeBytes:CURRENT_MAX,maxOriginalCompletionArgumentBytes:ARGUMENT_MAX,
});

function invalid(){
  throw Object.assign(new TypeError('same original completion read wire invalid'),
    {code:'same_original_completion_read_wire_invalid',status:400});
}
function ownInput(raw){
  // Never invoke proxy traps or shadowed view accessors. The actual backing
  // slots, not caller properties, select the exact bytes copied.
  if(types.isProxy(raw)||!Buffer.isBuffer(raw)||Object.getPrototypeOf(raw)!==Buffer.prototype)invalid();
  for(const key of ['buffer','byteLength','byteOffset','length','parent','offset']){
    const descriptor=Object.getOwnPropertyDescriptor(raw,key);
    if(descriptor&&!Object.hasOwn(descriptor,'value'))invalid();
  }
  let backing,length,offset,capacity;
  try{
    backing=Reflect.apply(getBuffer,raw,[]);length=Reflect.apply(getLength,raw,[]);
    offset=Reflect.apply(getOffset,raw,[]);capacity=Reflect.apply(arrayLength,backing,[]);
    if(Object.getPrototypeOf(backing)!==ArrayBuffer.prototype
      ||resizable&&Reflect.apply(resizable,backing,[]))invalid();
  }catch{invalid();}
  if(!Number.isSafeInteger(length)||length<1||length>MAX||!Number.isSafeInteger(offset)
    ||offset<0||offset+length>capacity)invalid();
  const owned=Buffer.alloc(length);
  try{Reflect.apply(set,owned,[new Uint8Array(backing,offset,length)]);return owned;}
  catch{owned.fill(0);invalid();}
}
function utf8(bytes){
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{invalid();}
  if(text.startsWith('\uFEFF'))invalid();return text;
}
// Purpose-specific flat three-string protocol. It cannot admit arrays, nested
// objects, literals, duplicate/escaped duplicate keys or unknown fields. This
// does not change either existing provider/native query parser's limits.
function parse(text){
  let at=0;
  const ws=()=>{while(at<text.length&&/[ \t\r\n]/.test(text[at]))at++;};
  function string(){
    if(text[at++]!=='"')invalid();const start=at-1;
    while(at<text.length){
      const code=text.charCodeAt(at++);
      if(code===34){try{return JSON.parse(text.slice(start,at));}catch{invalid();}}
      if(code<32)invalid();
      if(code===92){
        if(at>=text.length)invalid();const escape=text[at++];
        if(escape==='u'){if(!/^[a-fA-F0-9]{4}$/.test(text.slice(at,at+4)))invalid();at+=4;}
        else if(!'"\\/bfnrt'.includes(escape))invalid();
      }
    }invalid();
  }
  ws();if(text[at++]!=='{')invalid();const body=Object.create(null),seen=new Set();ws();
  if(text[at]==='}')invalid();
  for(let i=0;i<FIELDS.length;i++){
    ws();const key=string();
    if(!FIELDS.includes(key)||seen.has(key))invalid();seen.add(key);ws();
    if(text[at++]!==':')invalid();ws();body[key]=string();ws();
    if(i<FIELDS.length-1){if(text[at++]!==',')invalid();}
    else if(text[at++]!=='}')invalid();
  }
  ws();if(at!==text.length||seen.size!==FIELDS.length)invalid();return body;
}
function base64(value,maximum){
  if(typeof value!=='string'||!value.length||value.length>4*Math.ceil(maximum/3)
    ||value.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))invalid();
  const bytes=Buffer.from(value,'base64');
  if(!bytes.length||bytes.length>maximum||bytes.toString('base64')!==value){bytes.fill(0);invalid();}
  return bytes;
}
export function decodeSameOriginalCompletionRead(raw){
  let owned,current,argumentsBytes;
  try{
    owned=ownInput(raw);const body=parse(utf8(owned));
    if(body.schema!==SCHEMA)invalid();
    current=base64(body.current_original_query_envelope_base64,CURRENT_MAX);
    decodeCurrentOriginalPrivateQueryRead(current); // Original exact bytes, never JSON reserialization.
    argumentsBytes=base64(body.original_completion_arguments_base64,ARGUMENT_MAX);
    return Object.freeze({
      schema:body.schema,
      current_original_query_envelope_base64:body.current_original_query_envelope_base64,
      original_completion_arguments_base64:body.original_completion_arguments_base64,
    });
  }catch{invalid();}
  finally{owned?.fill(0);current?.fill(0);argumentsBytes?.fill(0);}
}

