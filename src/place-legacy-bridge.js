import {z} from 'zod';
import {resolveSupabaseClient} from './supabase/client.js';
import {withApplicationMutationLease} from './restore-mutation-gate.js';
const uuid=z.string().uuid();
export const bridgePreviewSchema=z.object({legacy_kind:z.literal('event_venue'),legacy_id:uuid,
 action:z.enum(['map','deactivate','reactivate','reverse']),target_place_id:uuid.nullable().optional(),
 effective_at:z.string().datetime({offset:true}).nullable().optional(),reason:z.string().trim().min(1).max(500)}).strict();
export const bridgeConfirmSchema=z.object({request_id:uuid,preview_id:uuid}).strict();
async function mutate(req,name,args,client){
 const supabase=resolveSupabaseClient(client);
 return withApplicationMutationLease({supabase,serviceName:'custodial-place-legacy-bridge',operation:async({assertActive})=>{
  assertActive();const {data,error}=await supabase.rpc(name,{p_manager:uuid.parse(req?.memphisAuth?.manager_id),...args});if(error)throw error;
  assertActive();if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Bridge response is unconfirmed.');return data;
 }});
}
export async function preparePlaceBridge(req,input,{client}={}){
 const command=bridgePreviewSchema.parse(input);
 return mutate(req,'custodial_place_bridge_preview',{p_legacy_kind:command.legacy_kind,p_legacy_id:command.legacy_id,
  p_action:command.action,p_target:command.target_place_id??null,p_effective_at:command.effective_at??null,p_reason:command.reason},client);
}
export async function confirmPlaceBridge(req,input,{client}={}){
 const command=bridgeConfirmSchema.parse(input);
 return mutate(req,'custodial_place_bridge_confirm',{p_request:command.request_id,p_preview:command.preview_id},client);
}
export async function readPlaceBridgeOverlay(req,input={}, {client}={}){
 uuid.parse(req?.memphisAuth?.manager_id);
 const query=z.object({as_of:z.string().datetime({offset:true}).optional()}).strict().parse(input);
 const {data,error}=await resolveSupabaseClient(client).rpc('custodial_place_event_venue_overlay',query.as_of?{p_at:query.as_of}:{});
 if(error)throw error;if(!Array.isArray(data?.venues))throw new Error('Venue overlay unavailable.');return data;
}
