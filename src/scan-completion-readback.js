import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {normalizeCanonicalScanEvidence} from './scan-evidence.js';

export const SCAN_COMPLETION_READBACK_PATH = '/scan-api/original-completion';
export const SCAN_COMPLETION_READBACK_SCHEMA = 'custodial.original-completion-readback.v1';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, SHA=/^[0-9a-f]{64}$/;
const keys=new Set(['p_device_id','p_client_session_id','p_client_completion_id','p_location_code',
  'p_client_started_at','p_client_ended_at','p_response_json','p_scan_evidence','p_correlation_id',
  'p_native_finish_scan_entry_id','p_native_completion_attestation_version','p_native_completion_attestation',
  'p_native_completion_transport_attestation_version','p_native_completion_transport_attestation',
  'p_context_id','p_occurrence_id','p_submission_proof','p_snapshot_id','p_snapshot_employee_id',
  'p_snapshot_assignment_epoch','p_snapshot_credential_id']);
const hash=v=>createHash('sha256').update(v).digest('hex');
const literal=v=>v==null?'null':`'${String(v).replaceAll("'","''")}'`;
const object=v=>v && Object.getPrototypeOf(v)===Object.prototype;
const uuid=v=>typeof v==='string' && UUID.test(v);
const fail=(code,status=403)=>{throw Object.assign(new Error(code),{code,status});};
const iso=v=>typeof v==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;

function principal(auth,request,bodyHash){
  const d=auth?.device,c=auth?.credential,a=request.memphisNativeRequestAttestation;
  if(auth?.ok!==true || auth.credentialed!==true || d?.device_active!==true || d?.employee_active!==true
    || !UUID.test(d.canonical_device_pk||'') || !UUID.test(d.assigned_employee_id||'')
    || !Number.isSafeInteger(Number(d.assignment_epoch)) || Number(d.assignment_epoch)<1
    || !UUID.test(c?.credential_id||'') || c.device_id!==d.canonical_device_pk || !c.confirmed_at
    || c.revoked_at || !Number.isFinite(Date.parse(c.expires_at))
    || a?.version!=='custodial-native-request.v1' || a.method!=='POST' || a.path!==SCAN_COMPLETION_READBACK_PATH
    || a.device_id!==d.canonical_device_id || a.credential_id!==c.credential_id || a.body_sha256!==bodyHash
    || !UUID.test(a.request_id||'') || !SHA.test(a.signature||'')) fail('scan_completion_current_native_auth_required');
  // This is current transport identity, NOT a claim about the original actor.
  return {device:d.canonical_device_pk,identifier:d.canonical_device_id,employee:d.assigned_employee_id,
    epoch:Number(d.assignment_epoch),credential:c.credential_id,nativeRequest:a.request_id,signature:a.signature};
}

function fixedQuery(p,current){
  const payload=structuredClone(p);
  payload.p_scan_evidence=normalizeCanonicalScanEvidence(p.p_scan_evidence);
  return `select * from custodial_release_identity.read_original_scan_completion_v1(
    ${literal(current.device)}::uuid,${literal(current.identifier)},${literal(current.employee)}::uuid,
    ${current.epoch}::bigint,${literal(current.credential)}::uuid,${literal(JSON.stringify(payload))}::jsonb)`;
}

/** Mounted by the normal original-completion route. revalidateCurrentRequest must execute the existing
 * normal device authentication AND native request attestation on this same
 * retained request, setting its existing memphisNativeRequestAttestation and
 * returning the actual authenticateDeviceCredentialRequest result. No caller
 * JSON or callback name constitutes authentication. Main owns that mounting.
 * No lineage helper is invoked: the normal reader has no execute grant for it.
 * Successor credentials therefore remain unknown rather than borrowing origin.
 */
export async function readOriginalScanCompletion({runReadOnlySql,request,completionPayload,revalidateCurrentRequest}){
  if(typeof runReadOnlySql!=='function' || typeof revalidateCurrentRequest!=='function') fail('scan_completion_readback_not_mounted',503);
  if(request?.method!=='POST' || request.originalUrl!==SCAN_COMPLETION_READBACK_PATH
    || !Buffer.isBuffer(request.scanAuthorityRawBody) || request.scanAuthorityRawBody.length>1024*1024)
    fail('scan_completion_request_invalid',400);
  const raw=Buffer.from(request.scanAuthorityRawBody),headers=structuredClone(request.headers),url=request.url;
  let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{fail('scan_completion_request_invalid',400);}
  if(!object(body) || Object.keys(body).length!==1 || !object(body.completion_payload)
    || !isDeepStrictEqual(body,request.body) || !isDeepStrictEqual(body.completion_payload,completionPayload)
    || Object.keys(completionPayload).some(k=>!keys.has(k))) fail('scan_completion_request_invalid',400);
  const p=structuredClone(body.completion_payload),bodyHash=hash(raw);
  for(const key of ['p_context_id','p_occurrence_id','p_snapshot_employee_id','p_snapshot_credential_id']){
    if(p[key]!=null && !uuid(p[key])) fail('scan_completion_original_binding_invalid',422);
  }
  if((p.p_snapshot_id!=null && (typeof p.p_snapshot_id!=='string' || !SHA.test(p.p_snapshot_id)))
    || (p.p_snapshot_assignment_epoch!=null && (!Number.isSafeInteger(p.p_snapshot_assignment_epoch) || p.p_snapshot_assignment_epoch<1))
    || (p.p_correlation_id!=null && typeof p.p_correlation_id!=='string')) fail('scan_completion_original_binding_invalid',422);
  function unchanged(){
    if(request.method!=='POST' || request.originalUrl!==SCAN_COMPLETION_READBACK_PATH || request.url!==url
      || !Buffer.isBuffer(request.scanAuthorityRawBody) || !raw.equals(request.scanAuthorityRawBody)
      || !isDeepStrictEqual(headers,request.headers) || !isDeepStrictEqual(body,request.body)
      || !isDeepStrictEqual(p,completionPayload)) fail('scan_completion_request_changed');
  }
  const auth=await revalidateCurrentRequest(request);unchanged();const current=principal(auth,request,bodyHash);
  const control=p.p_response_json?.__custodial_offline_reconciliation_v1;
  // Missing historical origin/native evidence is UNKNOWN, never a resend grant.
  if(!object(control) || !uuid(control.context_id) || typeof control.submission_proof!=='string' || !SHA.test(control.submission_proof)
    || !uuid(p.p_client_session_id) || !uuid(p.p_client_completion_id)
    || !uuid(p.p_native_finish_scan_entry_id) || p.p_native_completion_attestation_version!=='custodial-native-completion.v2'
    || typeof p.p_native_completion_attestation!=='string' || !SHA.test(p.p_native_completion_attestation.toLowerCase().trim())
    || !iso(p.p_client_started_at) || !iso(p.p_client_ended_at) || !Array.isArray(p.p_scan_evidence)) return {found:false};
  if(p.p_device_id!==current.identifier || typeof p.p_location_code!=='string' || !p.p_location_code
    || (p.p_context_id!=null && p.p_context_id!==control.context_id)
    || (p.p_submission_proof!=null && p.p_submission_proof!==control.submission_proof)) fail('scan_completion_original_binding_invalid',422);
  let rows;try{rows=await runReadOnlySql(fixedQuery(p,current));}catch{fail('scan_completion_readback_unavailable',503);}
  unchanged();
  const after=await revalidateCurrentRequest(request);unchanged();
  if(!isDeepStrictEqual(current,principal(after,request,bodyHash))) fail('scan_completion_principal_changed');
  if(!Array.isArray(rows) || rows.length>1) fail('scan_completion_readback_response_invalid',503);
  if(!rows.length) return {found:false};
  const r=rows[0],o=r?.original,result=r?.result;
  // Hash PostgreSQL's exact original serialization in the application, not
  // extensions.digest under a role that deliberately lacks schema USAGE.
  // This private vector never reaches the client or creates a new authority.
  const fingerprints=r?.event_fingerprints;
  if(!Array.isArray(fingerprints) || fingerprints.length!==p.p_scan_evidence.length
    || fingerprints.length<1 || fingerprints.length>100
    || fingerprints.some(row=>!object(row) || !isDeepStrictEqual(Object.keys(row).sort(),['fingerprint','source'])
      || typeof row.source!=='string' || Buffer.byteLength(row.source)>16384
      || !SHA.test(row.fingerprint||'') || hash(row.source)!==row.fingerprint))
    fail('scan_completion_readback_response_invalid',503);
  const originalKeys=['reconciliation_id','context_id','occurrence_id','original_employee_id','original_credential_id',
    'device_id','location_id','client_session_id','client_completion_id','assignment_epoch','payload_fingerprint','submitted_at'];
  if(!object(o) || !object(result) || !isDeepStrictEqual(Object.keys(o).sort(),originalKeys.sort())
    || !uuid(o.reconciliation_id) || o.context_id!==control.context_id
    || o.device_id!==current.device || o.original_employee_id!==current.employee || o.original_credential_id!==current.credential
    || Number(o.assignment_epoch)!==current.epoch || !SHA.test(o.payload_fingerprint||'')
    || !uuid(o.occurrence_id) || !uuid(o.location_id) || typeof o.submitted_at!=='string' || !Number.isFinite(Date.parse(o.submitted_at))
    || o.client_session_id!==p.p_client_session_id || o.client_completion_id!==p.p_client_completion_id
    || result.status!=='closed' || result.client_session_id!==o.client_session_id || result.client_completion_id!==o.client_completion_id
    || result.original_employee_id!==o.original_employee_id || result.occurrence_id!==o.occurrence_id
    || !UUID.test(result.completion_response_id||'') || typeof result.session_uuid!=='string'
    || Date.parse(result.started_at)!==Date.parse(p.p_client_started_at) || Date.parse(result.ended_at)!==Date.parse(p.p_client_ended_at))
    fail('scan_completion_readback_response_invalid',503);
  return {schema:SCAN_COMPLETION_READBACK_SCHEMA,found:true,result:structuredClone(result),readback:structuredClone(o)};
}
