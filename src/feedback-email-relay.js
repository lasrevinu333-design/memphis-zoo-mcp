import { createHash } from 'node:crypto';
import { z } from 'zod';
import { resolveSupabaseClient } from './supabase/client.js';
import {FeedbackAttachmentAdmissionError,verifyFeedbackAttachmentForRelay} from './feedback-attachment-admission.js';

export const FEEDBACK_RELAY_CONTRACT = 'custodial-feedback-relay.v2';
const contract = z.literal(FEEDBACK_RELAY_CONTRACT);
const uuid = z.string().uuid();
// The v2 SQL command accepts UUID versions 1–5 for request/intent IDs, not
// Zod's broader 1–8/nil/max syntax. Keep the published wire schema exact.
const commandUuid = z.string().regex(
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/,
).meta({ format: 'uuid' });
// Claims are issued by gen_random_uuid() and compared as exact lowercase text.
const claimToken = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
).meta({ format: 'uuid' });
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const base = { contract_version: contract, request_id: commandUuid };
const fence = { intent_id: commandUuid, claim_token: claimToken, claim_generation: z.number().int().positive().max(999999999) };
const observation = z.object({
  kind: z.enum(['connector_accepted', 'outcome_unknown', 'sent_observed', 'inbox_observed', 'multiple_matching_messages', 'reconciliation_not_found']),
  provider_account: z.literal('eoperle@memphiszoo.org'),
  to: z.tuple([z.literal('eoperle@memphiszoo.org')]), cc: z.tuple([]), bcc: z.tuple([]),
  subject: z.string().max(200), operation_id: uuid, feedback_id: uuid, request_fingerprint: hash,
  full_text_matches: z.boolean().optional(), folder: z.enum(['sent', 'inbox']).optional(),
  provider_message_id: z.string().min(1).max(512).optional(),
  internet_message_id: z.string().min(1).max(512).optional(),
  observed_at: z.string().datetime({ offset: true }).optional(), result_sha256: hash.optional(),
  match_count: z.number().int().min(2).max(999999).optional(),
  reconciliation_token: uuid.optional(),
}).strict();

// These are bounded, authenticated connected-agent observations, not Microsoft
// attestations. The server-issued challenge prevents old/cross-principal reads
// or a bare “resume” assertion from opening the gate. No secret is transported.
const preflight = z.object({
  challenge_id: uuid, challenge_nonce: uuid,
  provider_account: z.literal('eoperle@memphiszoo.org'),
  profile_observed_at: z.string().datetime({ offset: true }), profile_result_sha256: hash,
  sent_folder_id: z.string().min(1).max(512), inbox_folder_id: z.string().min(1).max(512),
  sent_read_at: z.string().datetime({ offset: true }), sent_result_sha256: hash,
  inbox_read_at: z.string().datetime({ offset: true }), inbox_result_sha256: hash,
}).strict();

export const feedbackRelaySchemas = Object.freeze({
  status: z.object({ contract_version: contract }).strict(),
  claim: z.object(base).strict(),
  begin: z.object({ ...base, ...fence, envelope_sha256: hash }).strict(),
  receipt: z.object({ ...base, intent_id: commandUuid, attempt_id: uuid, envelope_sha256: hash, observation }).strict(),
  defer: z.object({ ...base, ...fence, reason: z.enum(['missing_profile', 'auth_unavailable',
    'configuration_unavailable', 'attachment_unavailable', 'transient_preflight']) }).strict(),
  control: z.object({ ...base, action: z.enum(['pause', 'prepare_preflight', 'resume_preflight_verified']),
    reason: z.string().min(1).max(300), preflight: preflight.optional() }).strict(),
});

export const FEEDBACK_RELAY_SCHEMA_SHA256 = createHash('sha256').update(JSON.stringify(
  Object.entries(feedbackRelaySchemas).map(([verb, schema]) => ({
    name: `custodial_feedback_relay_${verb}`, inputSchema: z.toJSONSchema(schema),
    scopes: ['mcp:read', 'mcp:write'], contract: FEEDBACK_RELAY_CONTRACT,
  })),
)).digest('hex');

export function feedbackRelayPrincipal(extra) {
  const auth = extra?.authInfo;
  if (!auth) throw new Error('Verified relay authorization is required.');
  const source = auth.extra?.authSource;
  if (auth.expiresAt !== undefined && (!Number.isSafeInteger(auth.expiresAt) || auth.expiresAt <= Math.floor(Date.now()/1000))) {
    throw new Error('Relay authorization has expired.');
  }
  let identity;
  if (source === 'connector_token' && auth.clientId === 'memphis-mcp-connector-token') {
    // Existing server-authenticated token mode, not a token value or argument.
    identity = ['connector_token', 'memphis-mcp-connector-token'];
  } else {
    if (source !== 'self_contained_oauth' || !['mcp:read', 'mcp:write'].every(s => auth.scopes?.includes(s))
      || ![auth.extra?.issuer, auth.extra?.subject, auth.clientId].every(v => typeof v === 'string' && v.length > 0 && v.length <= 2048)) {
      throw new Error('Verified relay principal with read and write scopes is required.');
    }
    identity = [source, auth.extra.issuer, auth.extra.subject, auth.clientId];
  }
  return `relay:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

// Private lifetime of one already-authorized call. Only authorization metadata
// is pinned; never read, copy, or hash the token or other secret material.
function originalRelayInvocation(extra) {
  const auth=extra?.authInfo,context=auth?.extra,scopes=auth?.scopes,signal=extra?.signal;
  const principal=feedbackRelayPrincipal(extra);
  const source=context?.authSource,client=auth.clientId,issuer=context?.issuer,subject=context?.subject,expiry=auth.expiresAt;
  const scopeValues=Array.isArray(scopes)?scopes.slice():null;
  const requireCurrentPrincipal=()=>{
    try{
      if(extra.authInfo!==auth||auth.extra!==context||auth.scopes!==scopes||extra.signal!==signal||signal?.aborted
        ||context?.authSource!==source||auth.clientId!==client||context?.issuer!==issuer||context?.subject!==subject
        ||auth.expiresAt!==expiry
        ||scopeValues&&(scopes.length!==scopeValues.length||scopeValues.some((value,index)=>scopes[index]!==value))
        ||feedbackRelayPrincipal(extra)!==principal)throw new Error('Original relay invocation changed.');
    }catch{
      // An already-dispatched request is not proven absent or rolled back.
      throw new Error('Relay original authorization or cancellation changed; original operation outcome is unconfirmed.');
    }
  };
  requireCurrentPrincipal();
  return {principal,requireCurrentPrincipal};
}

// Only the current SQL begin branch can return send permission. Denials and
// reconciliation data stay unchanged; no adapter-generated IDs or defaults.
function requireOriginalSendPermit(verb,checked,data) {
  if(verb!=='begin'&&!Object.hasOwn(data,'may_send'))return;
  if(typeof data.may_send!=='boolean')throw new Error('Malformed relay send permit; original operation outcome is unconfirmed.');
  if(data.may_send===false)return;
  if(verb!=='begin'||data.ok!==true||Object.keys(data).length!==6
    ||!claimToken.safeParse(data.attempt_id).success
    ||data.attempt_generation!==1||data.provider_generation!==1
    ||!hash.safeParse(data.envelope_sha256).success||data.envelope_sha256!==checked.envelope_sha256)
    throw new Error('Relay send permit does not match the original begin; original operation outcome is unconfirmed.');
}

export async function callFeedbackRelay(verb, args, extra, { client } = {}) {
  if (!Object.hasOwn(feedbackRelaySchemas, verb)) throw new Error('Unknown relay operation.');
  const checked = feedbackRelaySchemas[verb].parse(args);
  if (verb === 'control' && ((checked.action === 'resume_preflight_verified') !== Boolean(checked.preflight))) {
    throw new Error('Only resume requires the exact fresh preflight observation.');
  }
  const {principal,requireCurrentPrincipal}=originalRelayInvocation(extra);
  if (Buffer.byteLength(JSON.stringify(checked), 'utf8') > 32768) throw new Error('Relay request is too large.');
  const service=resolveSupabaseClient(client);
  if(verb==='begin'){
    const fence={intent_id:checked.intent_id,claim_token:checked.claim_token,
      claim_generation:checked.claim_generation,envelope_sha256:checked.envelope_sha256,
      adapter_schema_sha256:FEEDBACK_RELAY_SCHEMA_SHA256};
    const internal=async(action,fields={})=>{
      requireCurrentPrincipal();
      const {data,error}=await service.rpc('custodial_feedback_relay_attachment_internal',{
        p_principal:principal,p_action:action,p_args:{...fence,...fields},
      });
      requireCurrentPrincipal();
      if(error)throw error;
      if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Invalid private attachment admission response.');
      return data;
    };
    const prepared=await internal('prepare');
    requireCurrentPrincipal();
    if(prepared.status==='needs_attention')return {ok:false,may_send:false,needs_attention:true};
    if(prepared.status==='ready'){
      if(!uuid.safeParse(prepared.ticket).success)throw new Error('Invalid private attachment ticket.');
      let observed;
      try{
        requireCurrentPrincipal();
        observed=await verifyFeedbackAttachmentForRelay(prepared,{client:service,
          privateBucket:String(process.env.FEEDBACK_IMAGE_BUCKET||'system-feedback-private').trim()});
      }catch(error){
        requireCurrentPrincipal();
        const disposition=error instanceof FeedbackAttachmentAdmissionError?error.disposition:'configuration_unavailable';
        const rejected=await internal('reject',{ticket:prepared.ticket,disposition});
        requireCurrentPrincipal();
        if(rejected.status!=='needs_attention'&&rejected.status!=='paused')throw new Error('Invalid private attachment disposition.');
        return {ok:false,may_send:false,needs_attention:rejected.status==='needs_attention',
          paused:rejected.status==='paused'};
      }
      requireCurrentPrincipal();
      const verified=await internal('complete',{ticket:prepared.ticket,observed});
      requireCurrentPrincipal();
      if(verified.status!=='verified')throw new Error('Private attachment admission was not verified.');
    }else if(!['no_attachment','already_attempted'].includes(prepared.status)){
      throw new Error('Unknown private attachment admission state.');
    }
  }
  requireCurrentPrincipal();
  const { data, error } = await service.rpc(`custodial_feedback_relay_${verb}`, {
    p_principal: principal, p_args: { ...checked, adapter_schema_sha256: FEEDBACK_RELAY_SCHEMA_SHA256 },
  });
  // A lost/currently denied admission reply never authorizes a provider send.
  // The original request/intent/attempt remains the reconciliation identity.
  requireCurrentPrincipal();
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid private relay response.');
  requireOriginalSendPermit(verb,checked,data);
  requireCurrentPrincipal();
  return data;
}
