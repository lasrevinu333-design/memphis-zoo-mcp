import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareNativeScheduleDataSender} from '../src/native-schedule-dispatch.js';
import {canonicalNativeLocation} from '../src/native-location-reservation.js';

// Execute the actual owning factory and OAuth/cache body, but supply only
// synthetic account/assertion/transport inputs. Never import a runtime route,
// read account files, use real keys, start a timer or contact any provider.
const source=readFileSync(new URL('../src/manager-notifications.js',import.meta.url),'utf8');
const start=source.indexOf('export function createPushRuntime({ db, env }) {');
const end=source.indexOf('\nexport function installManagerNotificationRoutes',start);
assert.ok(start>=0&&end>start);
const runtimeSource=source.slice(start,end).replace(/^export /,'');
const hash=v=>createHash('sha256').update(v).digest('hex');
const uuid=n=>`ad000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const pushScope='synthetic-fcm-scope',audience='https://synthetic.invalid/oauth';
function runtime({account={project_id:'synthetic-zoo'},fetchImpl,senderConstructor=prepareNativeScheduleDataSender}={}) {
  return runInNewContext(runtimeSource+'\ncreatePushRuntime({db:null,env:{}});',{
    parseServiceAccount:()=>account,crypto:{randomUUID:()=>uuid(1)},process:{pid:1},
    PUSH_SCOPE:pushScope,TOKEN_AUDIENCE:audience,URLSearchParams,
    createGoogleAssertion:()=> 'synthetic-assertion-not-a-key',int:()=>3600,
    fetch:fetchImpl,prepareNativeScheduleDataSender:senderConstructor,
    prepareNativeLocationDataSender:()=>()=>{},prepareNativeLunchDataSender:()=>()=>{},
    prepareNativeMessageDataSender:()=>()=>{},prepareNativeEventDataSender:()=>()=>{},
  });
}
function senderInput() {
  const f=JSON.parse(readFileSync(new URL('./fixtures/native-schedule-wire.json',import.meta.url)));
  const token='synthetic-schedule-factory-target-token',payload={...f.payload,token_digest:hash(token)};
  payload.content_sha256=hash(canonicalNativeLocation(payload,{excludeHash:true}));
  const expected={...f.expected,token_digest:hash(token)};
  const binding={receipt_job_id:payload.receipt_job_id,lease_token:uuid(2),registration_id:expected.registration_id,
    generation_id:payload.generation_id,reservation_at:payload.reservation_at,content_sha256:payload.content_sha256,
    token_digest:payload.token_digest,principal_digest:payload.principal_digest,
    receipt_credential_id:payload.receipt_credential_id,receipt_assignment_epoch:payload.receipt_assignment_epoch,
    receipt_employee_id:payload.receipt_employee_id,receipt_device_id:payload.receipt_device_id,
    source_reservation_id:payload.source_reservation_id};
  const attempt={attempt_id:uuid(3),outcome_operation_id:uuid(4),attempt_reserved_at:'2026-10-08T14:47:00.999999Z',
    binding,payload,wire:canonicalNativeLocation(payload),ttl_seconds:779};
  return {token,expected,sourceCandidate:f.sourceCandidate,permit:{schema:'custodial.native-schedule-dispatch.v1',
    dispatch_authorized:true,delivery_admitted:false,replayed:false,reason:null,attempt}};
}
export async function runNativeScheduleSenderFactoryTests() {
  let checks=0;const eq=(n,a,b)=>{assert.deepEqual(a,b,n);checks++;};
  const reject=async(n,fn,match)=>{await assert.rejects(fn,match,n);checks++;};
  eq('exact strict schedule import present',source.includes("import { prepareNativeScheduleDataSender } from './native-schedule-dispatch.js';"),true);
  const order=[],requests=[];let releaseOAuth;
  const response=new Promise(resolve=>{releaseOAuth=resolve;});
  const fetchImpl=async(url,options)=>{order.push('oauth');requests.push({url,options});return response;};
  const constructors=[];
  const owned=runtime({fetchImpl,senderConstructor:args=>{order.push('constructor');constructors.push(args);return ()=>{};}});
  eq('configured decision unchanged',owned.configured,true);
  eq('factory is reachable on actual runtime',typeof owned.prepareNativeScheduleSender,'function');
  eq('runtime construction has no OAuth/provider/DB side effect',order,[]);
  const pending=owned.prepareNativeScheduleSender();
  eq('OAuth precedes constructor',order,['oauth']);
  eq('no constructor while OAuth unresolved',constructors.length,0);
  releaseOAuth({ok:true,json:async()=>({access_token:'synthetic-oauth',expires_in:3600})});
  const sender=await pending;
  eq('private callable returned',typeof sender,'function');
  eq('actual preparation order',order,['oauth','constructor']);
  eq('only original scoped OAuth URL called',requests.map(x=>x.url),[audience]);
  eq('OAuth is POST',requests[0].options.method,'POST');
  eq('synthetic assertion only',requests[0].options.body.get('assertion'),'synthetic-assertion-not-a-key');
  eq('project matches configured account',constructors[0].projectId,'synthetic-zoo');
  eq('token comes from owning OAuth',constructors[0].accessToken,'synthetic-oauth');
  eq('explicit fetch is same owning transport',constructors[0].fetchImpl,fetchImpl);
  await owned.prepareNativeScheduleSender();
  eq('existing OAuth cache reused',requests.length,1);
  eq('each preparation constructs a separate private capability',constructors.length,2);
  eq('all existing private factory properties preserved',
    ['Location','Lunch','Message','Event'].map(k=>typeof owned['prepareNative'+k+'Sender']),['function','function','function','function']);

  for(const mode of ['transport','refused','missing-token']) {
    let constructed=0,calls=0;
    const failing=runtime({fetchImpl:async()=>{calls++;if(mode==='transport')throw Error('synthetic OAuth failure');
      return {ok:mode!=='refused',status:503,json:async()=>({})};},senderConstructor:()=>{constructed++;return()=>{};}});
    await reject('OAuth '+mode+' refuses capability',()=>failing.prepareNativeScheduleSender());
    eq('failure cannot construct sender '+mode,constructed,0);
    eq('failure has no automatic OAuth replay '+mode,calls,1);
  }
  let unavailableNetwork=0;
  const unavailable=runtime({account:null,fetchImpl:async()=>{unavailableNetwork++;assert.fail('unconfigured cannot use network');}});
  eq('unconfigured runtime remains false',unavailable.configured,false);
  await reject('unconfigured factory fails before network',()=>unavailable.prepareNativeScheduleSender(),/not configured/);
  eq('unconfigured no network',unavailableNetwork,0);
  for(const patch of [{project:'INVALID_PROJECT',token:'synthetic-oauth'},{project:'synthetic-zoo',token:'bad\r\ntoken'}]) {
    let calls=0;const bad=runtime({account:{project_id:patch.project},fetchImpl:async()=>{
      calls++;return {ok:true,json:async()=>({access_token:patch.token,expires_in:3600})};}});
    await reject('strict sender constructor refuses invalid configured input',()=>bad.prepareNativeScheduleSender(),e=>e.code==='native_schedule_dispatch_contract_invalid');
    eq('invalid configuration cannot call FCM',calls,1);
  }
  const network=[];
  const actual=runtime({fetchImpl:async(url,options)=>{
    network.push({url,options});
    if(url===audience)return {ok:true,json:async()=>({access_token:'synthetic-oauth',expires_in:3600})};
    return new Response(JSON.stringify({name:'projects/synthetic-zoo/messages/factory'}),{status:200});
  }});
  const actualSender=await actual.prepareNativeScheduleSender();
  eq('constructing strict sender has only OAuth call',network.length,1);
  const input=senderInput(),outcome=await actualSender(input);
  eq('synthetic strict transport accepts exact receipt',outcome,{outcome:'provider_accepted',provider_message_id:'projects/synthetic-zoo/messages/factory',error_code:null});
  eq('one OAuth and one synthetic FCM call',network.length,2);
  eq('strict destination retained',network[1].url,'https://fcm.googleapis.com/v1/projects/synthetic-zoo/messages:send');
  eq('data only; no OS notification envelope',JSON.parse(network[1].options.body),{message:{token:input.token,
    data:input.permit.attempt.payload,android:{priority:'high',ttl:'779s',restricted_package_name:'org.memphiszoo.custodial'}}});
  eq('strict no-redirect transport retained',network[1].options.redirect,'error');
  await reject('factory capability remains one use',()=>actualSender(input),e=>e.code==='native_schedule_sender_already_consumed');
  eq('no duplicate synthetic FCM request',network.length,2);
  const worker=readFileSync(new URL('../src/employee-notifications.js',import.meta.url),'utf8');
  eq('qualification hold remains before all legacy delivery',
    worker.indexOf('holdUnqualifiedNativeScheduleJob(job);')<worker.indexOf('if (originalMessage) return deliverNativeMessageJob'),true);
  eq('schedule transport not activated in worker',worker.includes('deliverNativeScheduleJob'),false);
  eq('no new refresh loop in owning factory',runtimeSource.includes('setInterval('),false);
  return {status:'PASS',checks,actual_runtime_factory:true,actual_strict_sender:true,synthetic_OAuth_and_fetch:true,
    SQL_executed:false,real_key_access:false,provider_dispatch:false,native_qualified:false,phone:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  console.log(JSON.stringify(await runNativeScheduleSenderFactoryTests()));
