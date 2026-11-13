// Fixed existing Places operations; no caller SQL, manager ID or generic RPC.
import {z} from 'zod';
import {authoritativePlaceCommand} from './place-lifecycle.js';
import {bridgePreviewSchema,bridgeConfirmSchema} from './place-legacy-bridge.js';
import {sourcePreviewSchema} from './place-operational-bridge.js';
const read=z.object({as_of:z.string().datetime({offset:true}).optional()}).strict();
const confirm=bridgeConfirmSchema;
export function validateCohortPlaceInput(value){
 const wire=z.object({action:z.enum(['preview','command','bridge_preview','bridge_confirm','source_preview','source_confirm']),input:z.record(z.string(),z.unknown())}).strict().parse(value);
 let input;
 if(wire.action==='preview')input=read.parse(wire.input);
 else if(wire.action==='command'){
  const a=authoritativePlaceCommand({memphisAuth:{manager_id:'00000000-0000-4000-8000-000000000001'}},wire.input);
  input={request_id:a.p_request,place_id:a.p_place,expected_revision:a.p_expected_revision,action:a.p_action,effective_at:a.p_effective_at,payload:a.p_payload,reason:a.p_reason};
 }else if(wire.action==='bridge_preview'){
  const p=bridgePreviewSchema.parse(wire.input);input={...p,target_place_id:p.target_place_id??null,effective_at:p.effective_at??null};
 }else if(wire.action==='source_preview'){
  input=sourcePreviewSchema.parse(wire.input);
  if(Buffer.byteLength(JSON.stringify(input.payload),'utf8')>32768)throw Object.assign(Error('invalid_place_input'),{code:'22023'});
 }else input=confirm.parse(wire.input);
 return {action:wire.action,input};
}
export const placeOperationMutates=input=>input?.action!=='preview';
