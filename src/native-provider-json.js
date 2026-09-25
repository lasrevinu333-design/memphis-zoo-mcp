// Reserved native-provider transport only. Existing scan/OAuth/legacy parsing is
// unchanged. Every numeric field in these four protocols is an integer; times
// are canonical strings, never floating-point JSON numbers.
const MAX_BYTES=65536,MAX_VALUES=2048,MAX_DEPTH=24;
const invalid=()=>{throw Object.assign(new Error('native_provider_json_invalid'),{status:400,code:'native_provider_json_invalid'});};
export function parseNativeProviderJson(bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_BYTES)invalid();
 let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{invalid();}
 let at=0,values=0;
 const space=()=>{while(/[ \t\n\r]/.test(text[at]??'')&&at<text.length)at++;};
 const string=()=>{
  if(text[at]!=='"')invalid();const begin=at++;
  while(at<text.length){const c=text[at++];if(c==='\\'){at++;continue;}if(c==='"'){
   let value;try{value=JSON.parse(text.slice(begin,at));}catch{invalid();}
   // JSON permits escaped lone surrogates; the native UTF8 protocol does not.
   for(let n=0;n<value.length;n++){const unit=value.charCodeAt(n);if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(++n);if(!(next>=0xdc00&&next<=0xdfff))invalid();}else if(unit>=0xdc00&&unit<=0xdfff)invalid();}
   return value;
  }}invalid();
 };
 const value=depth=>{
  if(depth>MAX_DEPTH||++values>MAX_VALUES)invalid();space();const c=text[at];
  if(c==='"'){string();return;}
  if(c==='{'){
   at++;space();const keys=new Set();if(text[at]==='}'){at++;return;}
   while(true){space();const key=string();if(keys.has(key))invalid();keys.add(key);space();if(text[at++]!==':')invalid();value(depth+1);space();const end=text[at++];if(end==='}')return;if(end!==',')invalid();}
  }
  if(c==='['){at++;space();if(text[at]===']'){at++;return;}while(true){value(depth+1);space();const end=text[at++];if(end===']')return;if(end!==',')invalid();}}
  for(const literal of ['true','false','null'])if(text.startsWith(literal,at)){at+=literal.length;return;}
  const number=/^-?(?:0|[1-9][0-9]*)/.exec(text.slice(at));
  if(!number||!Number.isSafeInteger(Number(number[0]))||number[0]==='-0')invalid();at+=number[0].length;
 };
 value(0);space();if(at!==text.length)invalid();
 let parsed;try{parsed=JSON.parse(text);}catch{invalid();}
 if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')invalid();return parsed;
}
export const nativeProviderJsonLimits=Object.freeze({MAX_BYTES,MAX_VALUES,MAX_DEPTH});
