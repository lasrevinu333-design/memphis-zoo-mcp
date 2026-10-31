// Fixed cohort-only companion operation. The Main API never binds SQL context.
import {randomUUID} from 'node:crypto';
const fail=(code,status=403)=>Object.assign(new Error(code),{code,status});
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
export function validateLeadershipTicketInput(action,input){
 if(action==='ticket_capabilities'){
  if(!exact(input,['ticket_ids'])||!Array.isArray(input.ticket_ids)||input.ticket_ids.length>100
   ||input.ticket_ids.some(id=>!uuid(id))||new Set(input.ticket_ids.map(id=>id.toLowerCase())).size!==input.ticket_ids.length)throw fail('invalid_ticket_request',422);
 }else if(action==='close_outcome'){
  if(!exact(input,['ticket_id','outcome','external_work_order_reference','close_notes'])||!uuid(input.ticket_id)
   ||!['mark_fixed','work_order_sent'].includes(input.outcome)
   ||(input.close_notes!==null&&(typeof input.close_notes!=='string'||input.close_notes.length>1000))
   ||(input.external_work_order_reference!==null&&typeof input.external_work_order_reference!=='string'))throw fail('invalid_ticket_request',422);
  const ref=input.external_work_order_reference?.trim()||'';
  if(input.outcome==='work_order_sent'?(!ref||ref.length>120):!!ref)throw fail('invalid_ticket_request',422);
 }else throw fail('invalid_ticket_action',422);
 return structuredClone(input);
}
export function createCustodialLeadershipTicketOperation({database,service,verifyTransaction,requestId=randomUUID}){
 if(!database?.connect||typeof service?.authenticateManagerSessionToken!=='function'||typeof verifyTransaction!=='function')throw fail('custodial_ticket_unavailable',503);
 let outstanding=0;
 return async({token,csrfToken,action,input})=>{
  const selected=validateLeadershipTicketInput(action,input);
  const verified=await service.authenticateManagerSessionToken({token,csrf:csrfToken,requireCsrf:action==='close_outcome'});
  const manager=verified.managerSession;
  if(manager?.auth_mode!=='custodial_leadership_pin'||manager.actor_kind!=='CUSTODIAL_LEADERSHIP_COHORT'
   ||manager.owner!==false||manager.permissions?.owner!==false||manager.permissions?.custodialManagementAdmin!==true
   ||manager.individual_identity_verified!==false||manager.identity_assurance!=='SELF_ASSERTED_NAME'
   ||!uuid(manager.manager_id)||!uuid(manager.credential_id)||!uuid(manager.device_id))throw fail('custodial_ticket_actor_denied');
  if(outstanding>=4)throw fail('custodial_ticket_busy',503);
  outstanding++;let client,commitStarted=false;
  try{
   client=await database.connect();await client.query('begin');await client.query('set local role static_weekly_control_plane');
   await client.query("set local statement_timeout='5000ms'");await client.query("set local lock_timeout='5000ms'");
   // Verification checks the signed original claims again and binds on this client.
   const originalRequestId=requestId();
   const actor=await verifyTransaction(client,{manager:{...manager,token},leadershipRequestId:originalRequestId});
   if(actor?.policy_version!==manager.permissions.policyVersion||actor.claimed_account_id!==manager.claimed_manager_id
    ||actor.request_id!==originalRequestId||actor.identity_assurance!=='SELF_ASSERTED_NAME'
    ||actor.individual_identity_verified!==false)throw fail('custodial_ticket_actor_denied');
   const r=await client.query('select public.custodial_leadership_ticket_operation_v1($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb) as result',
    [manager.manager_id,manager.credential_id,manager.device_id,action,JSON.stringify(selected)]);
   if(r.rows?.length!==1||!r.rows[0].result||typeof r.rows[0].result!=='object')throw fail('custodial_ticket_readback_unavailable',503);
   commitStarted=true;await client.query('commit');return r.rows[0].result;
  }catch(e){
   if(client)await client.query('rollback').catch(()=>{});
   // A lost COMMIT acknowledgement is unknown; never retry the mutation here.
   if(commitStarted)throw fail('custodial_ticket_outcome_unknown_refresh_before_acting',503);
   throw e;
  }finally{client?.release();outstanding--;}
 };
}
