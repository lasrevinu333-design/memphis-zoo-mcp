import {createHash} from 'node:crypto';

const MAX_BYTES=5*1024*1024;
const TYPES=Object.freeze({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'});
const HEX=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class FeedbackAttachmentAdmissionError extends Error {
  constructor(disposition,message){super(message);this.name='FeedbackAttachmentAdmissionError';this.disposition=disposition;}
}
const corrupt=message=>new FeedbackAttachmentAdmissionError('corrupt',message);
const unavailable=message=>new FeedbackAttachmentAdmissionError('configuration_unavailable',message);
const normalizeType=value=>String(value||'').toLowerCase().replace('image/jpg','image/jpeg');

function validSignature(body,type){
  if(type==='image/png')return body.length>=8&&body.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if(type==='image/jpeg')return body.length>=3&&body[0]===0xff&&body[1]===0xd8&&body[2]===0xff;
  if(type==='image/gif')return body.length>=6&&['GIF87a','GIF89a'].includes(body.subarray(0,6).toString('ascii'));
  if(type==='image/webp')return body.length>=12&&body.subarray(0,4).toString('ascii')==='RIFF'&&body.subarray(8,12).toString('ascii')==='WEBP';
  return false;
}

// This input is returned only by a private service-role RPC to the backend
// adapter. Never return it from an MCP operation or log its path/inline bytes.
export async function verifyFeedbackAttachmentForRelay(prepared,{client,privateBucket}={}){
  const image=prepared?.image;
  const operationId=String(prepared?.operation_id||'');
  if(!UUID.test(operationId)||!image||typeof image!=='object'||Array.isArray(image))throw corrupt('Immutable attachment metadata is invalid.');
  const type=normalizeType(image.type||image.mime_type);
  const size=Number(image.size);
  if(!Object.hasOwn(TYPES,type)||!Number.isSafeInteger(size)||size<1||size>MAX_BYTES)throw corrupt('Protected attachment size or type is invalid.');
  let body;
  const inline=String(image.data_url||image.dataUrl||'');
  if(inline){
    const match=inline.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/);
    if(!match||normalizeType(match[1])!==type)throw corrupt('Immutable inline image encoding is invalid.');
    if(match[2].length>Math.ceil(MAX_BYTES/3)*4)throw corrupt('Immutable inline image exceeds the allowed size.');
    body=Buffer.from(match[2],'base64');
    if(body.toString('base64')!==match[2])throw corrupt('Immutable inline image base64 is invalid.');
  }else{
    const bucket=String(image.storage_bucket||'');
    const objectPath=String(image.storage_path||'');
    if(!bucket||bucket!==privateBucket||!objectPath||objectPath.startsWith('/')||objectPath.includes('..')
      || /[\r\n\\]/.test(objectPath)||!client?.storage?.from)throw unavailable('Private attachment storage is not configured for this source.');
    const canonical=new RegExp(`^feedback/${operationId}/([0-9a-f]{64})\\.${TYPES[type]}$`);
    const pathHash=objectPath.match(canonical)?.[1];
    const declaredHash=image.sha256;
    if(declaredHash!==undefined&&(!HEX.test(String(declaredHash))||(pathHash&&declaredHash!==pathHash)))throw corrupt('Protected attachment digest metadata conflicts.');
    if(!pathHash&&!HEX.test(String(declaredHash||'')))throw corrupt('Legacy attachment has no immutable digest source.');
    let result;
    try{
      // Awaiting download directly materializes the entire object as a Blob in
      // the installed Storage SDK. Use its supported streaming builder so the
      // byte bound is enforced while the private HTTP body is being consumed.
      const download=client.storage.from(bucket).download(objectPath,{}, {signal:AbortSignal.timeout(10000)});
      if(typeof download?.asStream!=='function')throw unavailable('Bounded private storage streaming is unavailable.');
      result=await download.asStream();
    }catch{throw unavailable('Private attachment storage could not be read.');}
    if(result?.error){
      const status=Number(result.error.status||result.error.statusCode||0);
      if(status===404||/not found/i.test(String(result.error.message||'')))throw new FeedbackAttachmentAdmissionError('missing','Protected attachment is missing.');
      throw unavailable('Private attachment storage is unavailable.');
    }
    if(!result?.data||typeof result.data.getReader!=='function')throw unavailable('Private attachment storage returned no readable stream.');
    const chunks=[];
    let received=0;
    const reader=result.data.getReader();
    try{
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        received+=value?.byteLength||0;
        if(received>MAX_BYTES)throw corrupt('Protected attachment stream exceeds the allowed size.');
        chunks.push(Buffer.from(value));
      }
    }catch(error){
      if(error instanceof FeedbackAttachmentAdmissionError)throw error;
      throw unavailable('Private attachment stream could not be read.');
    }finally{try{await reader.cancel();}catch{/* Preserve the owning verification error; HTTP signal still bounds transport. */}finally{reader.releaseLock();}}
    body=Buffer.concat(chunks,received);
    if(pathHash&&createHash('sha256').update(body).digest('hex')!==pathHash)throw corrupt('Canonical protected object digest mismatch.');
  }
  if(body.length!==size||!validSignature(body,type))throw corrupt('Protected attachment content does not match immutable metadata.');
  const sha256=createHash('sha256').update(body).digest('hex');
  if(image.sha256!==undefined&&image.sha256!==sha256)throw corrupt('Protected attachment digest mismatch.');
  return {sha256,size:body.length,type};
}
