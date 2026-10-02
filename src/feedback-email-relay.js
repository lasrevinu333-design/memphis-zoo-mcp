import { createHash } from 'node:crypto';
import { z } from 'zod';
import { resolveSupabaseClient } from './supabase/client.js';

export const FEEDBACK_RELAY_CONTRACT = 'custodial-feedback-relay.v1';
const contract = z.literal(FEEDBACK_RELAY_CONTRACT);
const uuid = z.string().uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const base = { contract_version: contract, request_id: uuid };
const fence = { intent_id: uuid, claim_token: uuid, claim_generation: z.number().int().positive().max(999999999) };
const observation = z.object({
  kind: z.enum(['connector_accepted', 'outcome_unknown', 'sent_observed', 'inbox_observed', 'multiple_matching_messages']),
  provider_account: z.literal('eoperle@memphiszoo.org'),
  to: z.tuple([z.literal('eoperle@memphiszoo.org')]), cc: z.tuple([]), bcc: z.tuple([]),
  subject: z.string().max(200), operation_id: uuid, feedback_id: uuid, request_fingerprint: hash,
  full_text_matches: z.boolean().optional(), folder: z.enum(['sent', 'inbox']).optional(),
  provider_message_id: z.string().min(1).max(512).optional(),
  internet_message_id: z.string().min(1).max(512).optional(),
  observed_at: z.string().datetime({ offset: true }).optional(), result_sha256: hash.optional(),
  match_count: z.number().int().min(2).max(999999).optional(),
}).strict();

export const feedbackRelaySchemas = Object.freeze({
  status: z.object({ contract_version: contract }).strict(),
  claim: z.object(base).strict(),
  begin: z.object({ ...base, ...fence, envelope_sha256: hash }).strict(),
  receipt: z.object({ ...base, intent_id: uuid, attempt_id: uuid, envelope_sha256: hash, observation }).strict(),
  defer: z.object({ ...base, ...fence, reason: z.enum(['missing_profile', 'auth_unavailable',
    'configuration_unavailable', 'attachment_unavailable', 'transient_preflight']) }).strict(),
  control: z.object({ ...base, action: z.enum(['pause', 'resume_preflight_verified']), reason: z.string().min(1).max(300) }).strict(),
});

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
  const principal = feedbackRelayPrincipal(extra);
  if (Buffer.byteLength(JSON.stringify(checked), 'utf8') > 32768) throw new Error('Relay request is too large.');
  const { data, error } = await resolveSupabaseClient(client).rpc(`custodial_feedback_relay_${verb}`, {
    p_principal: principal, p_args: checked,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid private relay response.');
  return data;
}
