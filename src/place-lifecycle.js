import { z } from 'zod';
import { resolveSupabaseClient } from './supabase/client.js';
import { withApplicationMutationLease } from './restore-mutation-gate.js';

const uuid=z.string().uuid();
const mode=z.enum(['SCAN_TRACKED','REMINDER_ONLY','NEVER_CLEAN']);
const aliases=z.array(z.string().trim().min(1).max(200)).max(128);
const fields={
 add:z.object({canonical_code:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),display_name:z.string().trim().min(1).max(200),
  aliases:aliases.optional(),cleaning_mode:mode.optional(),event_eligible:z.boolean().optional(),physical_location_id:uuid.optional()}).strict(),
 rename:z.object({display_name:z.string().trim().min(1).max(200)}).strict(),aliases:z.object({aliases}).strict(),
 deactivate:z.object({}).strict(),reactivate:z.object({}).strict(),merge:z.object({target_place_id:uuid}).strict(),
 reclassify:z.object({cleaning_mode:mode.optional(),event_eligible:z.boolean().optional()}).strict(),reverse:z.object({}).strict(),
};
export const placeCommandSchema=z.object({request_id:uuid,place_id:uuid,expected_revision:z.number().int().nonnegative(),
 action:z.enum(['add','rename','aliases','deactivate','reactivate','merge','reclassify','reverse']),
 effective_at:z.string().datetime({offset:true}).nullable().optional(),payload:z.record(z.string(),z.unknown()),reason:z.string().trim().min(1).max(500)}).strict();

export function authoritativePlaceCommand(req,input){
 const command=placeCommandSchema.parse(input);
 const manager=uuid.parse(req?.memphisAuth?.manager_id);
 const payload=fields[command.action].parse(command.payload);
 return {p_request:command.request_id,p_manager:manager,p_place:command.place_id,p_expected_revision:command.expected_revision,
  p_action:command.action,p_effective_at:command.effective_at??null,p_payload:payload,p_reason:command.reason};
}
export async function applyPlaceCommand(req,input,{client}={}){
 const args=authoritativePlaceCommand(req,input),supabase=resolveSupabaseClient(client);
 return withApplicationMutationLease({supabase,serviceName:'custodial-place-lifecycle',operation:async({assertActive})=>{
  assertActive();const {data,error}=await supabase.rpc('custodial_place_command',args);if(error)throw error;
  assertActive();if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Invalid place authority response.');return data;
 }});
}
export async function readPlacePreview(req,input={}, {client}={}){
 const {as_of}=z.object({as_of:z.string().datetime({offset:true}).optional()}).strict().parse(input);
 const args={p_manager:uuid.parse(req?.memphisAuth?.manager_id),...(as_of?{p_at:as_of}:{})};
 const {data,error}=await resolveSupabaseClient(client).rpc('custodial_place_preview',args);
 if(error)throw error;
 if(!data||typeof data!=='object'||!Array.isArray(data.places))throw new Error('Invalid place preview response.');
 return data;
}
// Caller must use the existing named-manager HTTP guards before this helper.
// No route, UI, catalog cutover or physical tag capability is installed here.
