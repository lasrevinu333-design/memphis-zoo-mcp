import {z} from 'zod';
import {resolveSupabaseClient} from './supabase/client.js';
import {withApplicationMutationLease} from './restore-mutation-gate.js';
const uuid=z.string().uuid();
export const sourcePreviewSchema=z.object({legacy_kind:z.enum(['physical_location','location_group']),legacy_id:uuid.nullable(),
 action:z.enum(['add','enroll','rename','aliases','deactivate','reactivate','reclassify','memberships','merge','reverse']),
 payload:z.record(z.string(),z.unknown()),effective_at:z.string().datetime({offset:true}).nullable(),reason:z.string().trim().min(1).max(500)}).strict();
const confirmSchema=z.object({request_id:uuid,preview_id:uuid}).strict();
async function mutate(req,name,args,client){
 const supabase=resolveSupabaseClient(client);
 return withApplicationMutationLease({supabase,serviceName:'custodial-place-operational-metadata',operation:async({assertActive})=>{
  assertActive();const {data,error}=await supabase.rpc(name,{p_manager:uuid.parse(req?.memphisAuth?.manager_id),...args});if(error)throw error;
  assertActive();if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Source response is unconfirmed.');return data;
 }});
}
export async function preparePlaceSource(req,input,{client}={}){
 const p=sourcePreviewSchema.parse(input);if(Buffer.byteLength(JSON.stringify(p.payload),'utf8')>32768)throw Object.assign(new Error('Bounded source payload exceeded.'),{code:'22023'});
 return mutate(req,'custodial_place_source_preview',{p_kind:p.legacy_kind,p_id:p.legacy_id,p_action:p.action,p_payload:p.payload,p_effective_at:p.effective_at,p_reason:p.reason},client);
}
export async function confirmPlaceSource(req,input,{client}={}){const p=confirmSchema.parse(input);return mutate(req,'custodial_place_source_confirm',{p_request:p.request_id,p_preview:p.preview_id},client);}
export async function readPlaceSource(req,input={}, {client}={}){
 uuid.parse(req?.memphisAuth?.manager_id);const p=z.object({as_of:z.string().datetime({offset:true}).optional()}).strict().parse(input);
 const {data,error}=await resolveSupabaseClient(client).rpc('custodial_place_source_overlay',p.as_of?{p_at:p.as_of}:{});
 if(error)throw error;if(!Array.isArray(data?.records)||data.operational_cutover!==false)throw new Error('Metadata authority unavailable.');return data;
}
