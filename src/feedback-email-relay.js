import { createHash } from 'node:crypto';
import { z } from 'zod';
import { resolveSupabaseClient } from './supabase/client.js';
import {FeedbackAttachmentAdmissionError,verifyFeedbackAttachmentForRelay} from './feedback-attachment-admission.js';

export const FEEDBACK_RELAY_CONTRACT = 'custodial-feedback-relay.v2';
const contract = z.literal(FEEDBACK_RELAY_CONTRACT);
const uuid = z.string().uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const base = { contract_version: contract, request_id: uuid };
const fence = { intent_id: uuid, claim_token: uuid, claim_generation: z.number().int().positive().max(999999999) };
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
  receipt: z.object({ ...base, intent_id: uuid, attempt_id: uuid, envelope_sha256: hash, observation }).strict(),
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

export async function callFeedbackRelay(verb, args, extra, { client } = {}) {
  if (!Object.hasOwn(feedbackRelaySchemas, verb)) throw new Error('Unknown relay operation.');
  const checked = feedbackRelaySchemas[verb].parse(args);
  if (verb === 'control' && ((checked.action === 'resume_preflight_verified') !== Boolean(checked.preflight))) {
    throw new Error('Only resume requires the exact fresh preflight observation.');
  }
  const principal = feedbackRelayPrincipal(extra);
  if (Buffer.byteLength(JSON.stringify(checked), 'utf8') > 32768) throw new Error('Relay request is too large.');
  const service=resolveSupabaseClient(client);
  if(verb==='begin'){
    const fence={intent_id:checked.intent_id,claim_token:checked.claim_token,
      claim_generation:checked.claim_generation,envelope_sha256:checked.envelope_sha256,
      adapter_schema_sha256:FEEDBACK_RELAY_SCHEMA_SHA256};
    const internal=async(action,fields={})=>{
      const {data,error}=await service.rpc('custodial_feedback_relay_attachment_internal',{
        p_principal:principal,p_action:action,p_args:{...fence,...fields},
      });
      if(error)throw error;
      if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Invalid private attachment admission response.');
      return data;
    };
    const prepared=await internal('prepare');
    if(prepared.status==='needs_attention')return {ok:false,may_send:false,needs_attention:true};
    if(prepared.status==='ready'){
      if(!uuid.safeParse(prepared.ticket).success)throw new Error('Invalid private attachment ticket.');
      let observed;
      try{
        observed=await verifyFeedbackAttachmentForRelay(prepared,{client:service,
          privateBucket:String(process.env.FEEDBACK_IMAGE_BUCKET||'system-feedback-private').trim()});
      }catch(error){
        const disposition=error instanceof FeedbackAttachmentAdmissionError?error.disposition:'configuration_unavailable';
        const rejected=await internal('reject',{ticket:prepared.ticket,disposition});
        if(rejected.status!=='needs_attention'&&rejected.status!=='paused')throw new Error('Invalid private attachment disposition.');
        return {ok:false,may_send:false,needs_attention:rejected.status==='needs_attention',
          paused:rejected.status==='paused'};
      }
      const verified=await internal('complete',{ticket:prepared.ticket,observed});
      if(verified.status!=='verified')throw new Error('Private attachment admission was not verified.');
    }else if(!['no_attachment','already_attempted'].includes(prepared.status)){
      throw new Error('Unknown private attachment admission state.');
    }
  }
  const { data, error } = await service.rpc(`custodial_feedback_relay_${verb}`, {
    p_principal: principal, p_args: { ...checked, adapter_schema_sha256: FEEDBACK_RELAY_SCHEMA_SHA256 },
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid private relay response.');
  return data;
}
