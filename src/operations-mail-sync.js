import {createHash} from 'node:crypto';
import {z} from 'zod';
import {SCHOOL_HEADERS} from './operations-mail-contract.js';
import {recordOperationsMail} from './operations-mail-ledger.js';
import {resolveSupabaseClient} from './supabase/client.js';

// A private connected-agent import seam, not a mailbox authenticator, collector
// loop, provider attestation or permission to edit external tickets. The agent
// must read original mail/attachments and establish the complete date scope.
export const OPERATIONS_MAIL_SYNC_CONTRACT='custodial.operations-mail-sync-adapter.v1';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const text=(max)=>z.string().min(1).max(max).regex(/^[^\u0000-\u001f\u007f]+$/);
const source=(sender)=>z.object({mailbox:z.literal('eoperle@memphiszoo.org'),sender:z.literal(sender),
  message_id:text(500),content_sha256:hash,source_at:z.string().datetime()}).strict();
const cell=z.union([z.string().max(1000),z.number().finite(),z.null()]);
const spiceworks=z.object({kind:z.literal('spiceworks'),
  evidence:z.object({original_message_read:z.literal(true),notification_fields_unquoted:z.literal(true)}).strict(),
  observation:z.object({source:source('help@memzoomaint.on.spiceworks.com'),ticket_id:z.string().regex(/^[1-9]\d{0,9}$/),
    change_lines:z.array(text(240)).min(1).max(20),title:text(240).optional()}).strict()}).strict();
const school=z.object({kind:z.literal('school'),
  evidence:z.object({original_message_read:z.literal(true),attachment_read_complete:z.literal(true),complete_date_scope_verified:z.literal(true)}).strict(),
  observation:z.object({source:source('aferguson@memphiszoo.org'),attachment:z.object({id:text(500),sha256:hash}).strict(),
    headers:z.tuple(SCHOOL_HEADERS.map(v=>z.literal(v))),rows:z.array(z.array(cell).max(7)).max(5000),
    complete_for_dates:z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(31),date_system:z.literal('1900').optional()}).strict()}).strict();
export const operationsMailSyncSchema=z.object({contract_version:z.literal(OPERATIONS_MAIL_SYNC_CONTRACT),
  request:z.discriminatedUnion('kind',[spiceworks,school])}).strict();
export const OPERATIONS_MAIL_SYNC_SCHEMA_SHA256=createHash('sha256').update(JSON.stringify(z.toJSONSchema(operationsMailSyncSchema))).digest('hex');
function principal(extra){
  const a=extra?.authInfo,s=a?.extra?.authSource;
  if(!a||(a.expiresAt!==undefined&&(!Number.isSafeInteger(a.expiresAt)||a.expiresAt<=Math.floor(Date.now()/1000))))throw new Error('operations_mail_principal_required');
  if(s==='connector_token'&&a.clientId==='memphis-mcp-connector-token')return;
  if(s!=='self_contained_oauth'||!['mcp:read','mcp:write'].every(v=>a.scopes?.includes(v))
    ||![a.extra?.issuer,a.extra?.subject,a.clientId].every(v=>typeof v==='string'&&v.length>0&&v.length<=2048))throw new Error('operations_mail_principal_required');
}
export async function callOperationsMailSync(args,extra,{client,signal}={}){
  principal(extra);
  const {request}=operationsMailSyncSchema.parse(args);
  if(Buffer.byteLength(JSON.stringify(request.observation))>256*1024)throw new Error('operations_mail_observation_limit');
  const service=resolveSupabaseClient(client);
  let result;
  try{result=await recordOperationsMail({client:service,kind:request.kind,observation:request.observation,signal});}
  catch(error){
    // The original request ID belongs to the restore lease. Preserve it for
    // normal reconciliation; uncertainty must never become saved/current.
    if(!z.string().uuid().safeParse(error?.request_id).success)throw error;
    const reason=/^operations_mail_[a-z_]+$/.test(error.message)?error.message:'operations_mail_mutation_unavailable';
    return {contract_version:OPERATIONS_MAIL_SYNC_CONTRACT,kind:request.kind,state:'UNCONFIRMED',reason,
      request_id:error.request_id,reconciliation_required:true,readback_verified:false,
      collector_activation_verified:false,external_ticket_mutation:false};
  }
  return {contract_version:OPERATIONS_MAIL_SYNC_CONTRACT,kind:request.kind,...result,readback_verified:true,
    source_observation_kind:'authenticated_connected_agent_not_provider_attestation',
    collector_activation_verified:false};
}
