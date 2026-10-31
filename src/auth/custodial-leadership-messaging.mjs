import { randomUUID } from 'node:crypto';
import { isCustodialLeadershipManagementSession } from './manager-permissions.js';
const fail = (code,status=403) => Object.assign(new Error(code),{code,status});
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const exact = (value,keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
export function validateLeadershipMessagingInput(action,input) {
  if (action === 'identity') {
    if (!exact(input,[])) throw fail('invalid_messaging_request',422);
  } else if (action === 'send') {
    if (!exact(input,['thread_id','body','message_type','metadata_json','client_message_id'])
      || !uuid(input.thread_id) || typeof input.body !== 'string' || !input.body.trim()
      || Array.from(input.body.trim()).length > 2000 || input.message_type !== 'text'
      || typeof input.client_message_id !== 'string' || !input.client_message_id.trim()
      || input.client_message_id !== input.client_message_id.trim() || input.client_message_id.length > 200
      || !input.metadata_json || typeof input.metadata_json !== 'object' || Array.isArray(input.metadata_json)
      || Buffer.byteLength(JSON.stringify(input.metadata_json)) > 8192) throw fail('invalid_messaging_request',422);
  } else throw fail('invalid_messaging_action',422);
  return structuredClone(input);
}
export function createCustodialLeadershipMessagingOperation({database,service,verifyTransaction,requestId=randomUUID}) {
  if (!database?.connect || typeof service?.authenticateManagerSessionToken !== 'function'
    || typeof verifyTransaction !== 'function') throw fail('custodial_messaging_unavailable',503);
  let outstanding=0;
  return async ({token,csrfToken,action,input}) => {
    const selected=validateLeadershipMessagingInput(action,input);
    const verified=await service.authenticateManagerSessionToken({token,csrf:csrfToken,requireCsrf:action==='send'});
    const manager=verified.managerSession;
    if (!isCustodialLeadershipManagementSession(manager)
      || manager.individual_identity_verified !== false || manager.identity_assurance !== 'SELF_ASSERTED_NAME'
      || !uuid(manager.manager_id) || !uuid(manager.credential_id) || !uuid(manager.device_id)
      || !uuid(manager.claimed_manager_id)) throw fail('custodial_messaging_actor_denied');
    if (outstanding>=4) throw fail('custodial_messaging_busy',503);
    outstanding++;let client,commitStarted=false;
    try {
      client=await database.connect();await client.query('begin');await client.query('set local role static_weekly_control_plane');
      await client.query("set local statement_timeout='5000ms'");await client.query("set local lock_timeout='5000ms'");
      const originalRequestId=requestId();
      const actor=await verifyTransaction(client,{manager:{...manager,token},leadershipRequestId:originalRequestId});
      if (actor?.policy_version!==manager.permissions.policyVersion || actor.claimed_account_id!==manager.claimed_manager_id
        || actor.request_id!==originalRequestId || actor.identity_assurance!=='SELF_ASSERTED_NAME'
        || actor.individual_identity_verified!==false || actor.owner!==false) throw fail('custodial_messaging_actor_denied');
      const result=await client.query('select public.custodial_leadership_messaging_operation_v1($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb) as result',
        [manager.manager_id,manager.credential_id,manager.device_id,action,JSON.stringify(selected)]);
      if (result.rows?.length!==1 || !result.rows[0].result || typeof result.rows[0].result!=='object') throw fail('custodial_messaging_readback_unavailable',503);
      commitStarted=true;await client.query('commit');return result.rows[0].result;
    } catch (error) {
      if (client) await client.query('rollback').catch(()=>{});
      if (commitStarted) throw fail('custodial_messaging_outcome_unknown',503);
      throw error;
    } finally { client?.release();outstanding--; }
  };
}
export function createCustodialLeadershipMessagingHandler({operation,assertOrigin}) {
  return async (req,res) => {
    try {
      const body=req.body;
      if (!exact(body,['action','input','origin','csrfToken']) || typeof body.origin!=='string' || typeof body.csrfToken!=='string') throw fail('invalid_messaging_request',422);
      validateLeadershipMessagingInput(body.action,body.input);
      if (body.action==='send' || body.origin) assertOrigin(body.origin);
      if (!operation) throw fail('custodial_messaging_unavailable',503);
      const token=String(req.get?.('Authorization') || req.headers?.authorization || '').replace(/^Bearer\s+/i,'');
      const data=await operation({token,csrfToken:body.csrfToken,action:body.action,input:body.input});
      res.set('Cache-Control','no-store').json({ok:true,data});
    } catch (error) {
      const rawStatus=error.status || {'42501':403,'23505':409,'22023':422,'22P02':422,'P0002':404}[error.code] || 503;
      const status=rawStatus===401?403:rawStatus;
      const code=status===503?'custodial_messaging_outcome_unknown':status===409?'custodial_messaging_payload_conflict':status===422?'invalid_messaging_request':'custodial_messaging_context_denied';
      res.set('Cache-Control','no-store').status(status).json({ok:false,error:code,code});
    }
  };
}
export function createCustodialLeadershipMessagingBridge({env=process.env,fetchImpl=fetch}={}) {
  return async ({session,action,input,origin='',csrfToken=''}) => {
    if (env.CUSTODIAL_LEADERSHIP_PIN_ENABLED!=='true' || !isCustodialLeadershipManagementSession(session)) throw fail('custodial_messaging_context_denied');
    const selected=validateLeadershipMessagingInput(action,input);
    let target;
    try { target=new URL(String(env.STATIC_WEEKLY_CONTROL_PLANE_PUBLIC_URL || '')); } catch { throw fail('custodial_messaging_unavailable',503); }
    if (target.username || target.password || target.pathname!=='/' || target.search || target.hash
      || (target.protocol!=='https:' && !(env.CUSTODIAL_LEADERSHIP_ALLOW_LOOPBACK_TEST==='true' && target.protocol==='http:' && ['127.0.0.1','localhost'].includes(target.hostname)))) throw fail('custodial_messaging_unavailable',503);
    let response,body;
    try {
      response=await fetchImpl(target.origin+'/custodial-leadership-internal/messaging',{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.token},body:JSON.stringify({action,input:selected,origin,csrfToken})});
      const reader=response.body.getReader(),chunks=[];let bytes=0;
      try { for (;;) {const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>65536)throw Error('bounded response exceeded');chunks.push(Buffer.from(part.value));} }
      finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
      body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw fail('custodial_messaging_outcome_unknown',503); }
    if (!response.ok || body?.ok!==true || !body.data || typeof body.data!=='object') {
      throw fail('custodial_messaging_context_denied',[403,404,409,422,503].includes(response.status)?response.status:503);
    }
    return body.data;
  };
}
