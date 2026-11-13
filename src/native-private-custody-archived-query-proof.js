import {createHash,createHmac,timingSafeEqual} from 'node:crypto';

// Archived signature math ONLY. This does not authenticate a current caller,
// enforce freshness, issue a witness, or authorize acceptance/recovery. Main
// must separately verify the live outer request and original QUERY_UNKNOWN
// witness/plan. Never pass a fabricated clock to the ordinary auth verifier.
const VERSION='custodial-native-request.v1',PATH='/device-auth/private-custody';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/,DEVICE=/^KIOSK_(?:0[2-9]|10)$/;
const UTC_MS=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const typedArrayPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const backingStore=Object.getOwnPropertyDescriptor(typedArrayPrototype,'buffer').get;
const byteLength=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteLength').get;
const byteOffset=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteOffset').get;
const fail=()=>{throw Object.assign(new Error('native_private_custody_archived_query_proof_invalid'),{
 code:'native_private_custody_archived_query_proof_invalid',status:403});};
const matches=(pattern,value)=>typeof value==='string'&&pattern.exec(value)?.[0]===value;
const equalDigest=(expected,supplied)=>matches(SHA,supplied)
 &&timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(supplied,'hex'));

export function verifyArchivedOriginalPrivateQueryProof(input){
 let body;
 try{
  const {credentialId,secret,canonicalDeviceId,originalBody,readQueryId,timestamp,
   httpSignature,purposeBindingSha256,purposeAttestation}=input;
  if(!matches(UUID,credentialId)||!matches(UUID,readQueryId)||!matches(DEVICE,canonicalDeviceId)
   ||!matches(/^[A-Za-z0-9_-]{32,}$/,secret)||!matches(SHA,httpSignature)
   ||!matches(SHA,purposeBindingSha256)||!matches(SHA,purposeAttestation)
   ||!matches(UTC_MS,timestamp))fail();
  const historicalMs=Date.parse(timestamp);
  if(!Number.isFinite(historicalMs)||new Date(historicalMs).toISOString()!==timestamp)fail();
  if(!Buffer.isBuffer(originalBody)||Object.getPrototypeOf(originalBody)!==Buffer.prototype)fail();
  const backing=backingStore.call(originalBody),length=byteLength.call(originalBody);
  if(backing instanceof SharedArrayBuffer||!length||length>393216)fail();
  body=Buffer.from(new Uint8Array(backing,byteOffset.call(originalBody),length));
  const bodySha256=createHash('sha256').update(body).digest('hex');
  const http=createHmac('sha256',secret).update([
   VERSION,credentialId,canonicalDeviceId,'POST',PATH,bodySha256,readQueryId,timestamp,'custodial'
  ].join('\n'),'utf8').digest('hex');
  const purpose=createHmac('sha256',secret).update([
   'custodial-native-private-custody-query.v1',credentialId,readQueryId,timestamp,purposeBindingSha256
  ].join('\n'),'utf8').digest('hex');
  if(!equalDigest(http,httpSignature)||!equalDigest(purpose,purposeAttestation))fail();
  return Object.freeze({version:VERSION,credential_id:credentialId,device_id:canonicalDeviceId,
   method:'POST',path:PATH,body_sha256:bodySha256,request_id:readQueryId,timestamp,signature:httpSignature});
 }catch{fail();}finally{body?.fill(0);}
}
