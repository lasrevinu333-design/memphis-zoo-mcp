import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {nativeOriginalInventoryRequestWire as W,decodeNativeOriginalInventoryRequest as decode,
  captureAuthenticatedNativeOriginalInventoryRequest as capture,inspectAuthenticatedNativeOriginalInventoryRequest as inspect,
  closeAuthenticatedNativeOriginalInventoryRequest as close} from '../src/native-original-inventory-request.js';
import {deviceCredentialInternals as credentials} from '../src/auth/device-credential-auth.js';
import {recoveryTargetFields,recoveryDeniedEffects} from '../src/same-original-recovery-wire.js';

// Only NEW intake behavior, actual production imports and synthetic credentials/
// read-port rows. No native private issuer, manager, SQL, network or ACK is faked
// as product authority. The opaque disk SHA is fixture DATA, not file custody.
const sha=v=>createHash('sha256').update(v).digest('hex'),hmac=(s,v)=>createHmac('sha256',s).update(v).digest('hex');
const id=n=>`${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const NOW='2026-10-16T09:00:00.000Z',SECRET='SYNTHETIC_NATIVE_INVENTORY_TOKEN_ONLY_'.repeat(2);
function fixture(){
  const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'SYNTHETIC_INVENTORY_INTAKE_ENV_ONLY'};
  const keyId=credentials.deviceCredentialSecretKeyId(env),credential=id(3),intentId=id(7),target={};
  for(const key of recoveryTargetFields)target[key]='a'.repeat(64);
  Object.assign(target,{operation_id:id(1),separation_id:id(2),separation_authority_revision:'2',canonical_device_pk:id(4),
    canonical_device_id:'KIOSK_02',employee_id:id(5),credential_id:credential,assignment_epoch:'7',
    original_generation_id:id(6),original_credential_secret_key_id:keyId,engine_revision:'9'});
  const intent={schema:'custodial.native-original-inventory-ack-intent.v1',purpose:'PREPARE_EXACT_ORIGINAL_INVENTORY_ACK',
    intent_id:intentId,original_target:target,native_held_stamp:'DURABLE_HELD:8',browser_frame_sha256:'b'.repeat(64),
    browser_part_set_sha256:'c'.repeat(64),created_at:'2026-10-16T08:59:50.000Z',...recoveryDeniedEffects};
  let body;const req={method:'POST',url:W.path,originalUrl:W.path,path:W.path,aborted:false};
  function prepare(changedIntent=intent,bodyChange={}){
    const original=JSON.stringify(changedIntent);
    body={schema:W.schema,purpose:W.purpose,original_intent_utf8:original,original_intent_disk_sha256:'d'.repeat(64),
      original_intent_document_sha256:sha(original),original_preparation_native_request_id:id(8),
      original_preparation_request_body_sha256:'e'.repeat(64),original_preparation_http_attestation:'f'.repeat(64)};
    body.purpose_binding_sha256=sha([W.purposeVersion,body.original_intent_disk_sha256,body.original_intent_document_sha256,
      body.original_preparation_native_request_id,body.original_preparation_request_body_sha256,body.original_preparation_http_attestation].join('\n'));
    body.purpose_attestation=hmac(SECRET,[W.purposeVersion,credential,body.purpose_binding_sha256].join('\n'));
    Object.assign(body,bodyChange);req.scanAuthorityRawBody=Buffer.from(JSON.stringify(body));
    req.headers={authorization:`Device ${credential}.${SECRET}`,origin:'https://localhost','x-device-id':'KIOSK_02',
      'x-memphis-app-edition':'custodial','x-memphis-native-attestation-version':'custodial-native-request.v1',
      'x-memphis-native-request-id':intentId,'x-memphis-native-request-timestamp':NOW,
      'x-memphis-native-request-attestation':hmac(SECRET,['custodial-native-request.v1',credential,'KIOSK_02','POST',W.path,
        sha(req.scanAuthorityRawBody),intentId,NOW,'custodial'].join('\n'))};
  }
  prepare();
  const device={canonical_device_pk:id(4),canonical_device_id:'KIOSK_02',device_id:'KIOSK_02',device_active:true,
    assigned_employee_id:id(5),assignment_epoch:7,employee_active:false,employee_code:'EMP01'};
  const row={credential_id:credential,device_id:id(4),revoked_at:null,confirmed_at:'2026-10-01T00:00:00.000Z',
    expires_at:'2026-10-17T09:00:00.000Z',token_hash:credentials.tokenHash(SECRET,env),metadata_json:{credential_secret_key_id:keyId}};
  const context={schema:'custodial.separation-context.v1',separation_id:id(2),authority_revision:2,employee_id:id(5),
    device_id:id(4),canonical_device_id:'KIOSK_02',credential_id:credential,assignment_epoch:7,
    cutoff_at:'2026-10-16T08:00:00.000000Z',state:'PENDING_RECONCILIATION',native_inventory_state:'UNKNOWN',
    server_known_open_sessions:[],new_work_allowed:false,phone_released:false,purpose:'SEPARATION_STATUS_ONLY'};
  const generation={generation_id:id(6),device_id:id(4),device_identifier:'KIOSK_02',credential_id:credential,
    employee_id:id(5),assignment_epoch:7,principal_digest:target.principal_digest,activated_at:'2026-10-01T00:00:00.000000Z'};
  const events=[];let hook=null,credentialReads=0;
  const store={async findCredential(value){assert.equal(value,credential);events.push('credential');credentialReads++;
    if(hook)await hook('credential',credentialReads);return structuredClone(row);}};
  const deps={env,store,now:new Date(NOW),async runReadOnlySql(sql){
    events.push(sql.includes('read_separation_generation')?'generation':sql.includes('read_separation_context')?'context':'device');
    if(hook)await hook('sql',events.length);
    if(sql.includes('custodial_v13_read_separation_context'))return [{context:structuredClone(context)}];
    if(sql.includes('custodial_v14_read_separation_generation'))return [{original_generation:structuredClone(generation)}];
    assert.ok(sql.includes('from public.devices')&&sql.includes('device_aliases'));return [structuredClone(device)];
  }};
  return {req,deps,intent,target,prepare,events,context,generation,row,setHook(value){hook=value;}};
}
const denied=async action=>assert.rejects(action,error=>String(error.code).startsWith('native_original_inventory_'));
const cases={
  async confirmation_counterexamples(){
    const accepted=[];
    for(const [name,value]of [['future','2026-10-17T00:00:00.000Z'],['invalid','not-a-confirmation-instant'],
      ['postgres_infinity','infinity'],['numeric_infinity',Infinity]]){
      const f=fixture(),raw=f.req.scanAuthorityRawBody,bytes=Buffer.from(raw),slot=Object.getOwnPropertyDescriptor(f.req,'scanAuthorityRawBody');
      f.row.confirmed_at=value;let cap=null,handed=false,code=null;
      try{cap=await capture(f.req,f.deps);handed=typeof inspect(cap).rpc_parameters.p_original_request_utf8==='string';}
      catch(error){code=error.code;assert.equal(code,'native_original_inventory_request_invalid');}
      finally{if(cap)close(cap);}
      assert.equal(f.req.scanAuthorityRawBody,raw);assert.deepEqual(raw,bytes);
      assert.deepEqual(Object.getOwnPropertyDescriptor(f.req,'scanAuthorityRawBody'),slot);assert.equal(f.row.confirmed_at,value);
      console.log(JSON.stringify({member:'confirmation_counterexamples',case:name,authenticated_handoff_observed:handed,
        refusal_code:code,read_port_events:f.events}));
      if(handed)accepted.push(name);else assert.deepEqual(f.events,['device','credential'],'Current confirmation must refuse before context/generation reads');
    }
    assert.deepEqual(accepted,[],'Noncurrent confirmation reached actual capture/inspect handoff');
  },
  async confirmation_current(){
    const f=fixture();f.row.confirmed_at=NOW;
    const raw=f.req.scanAuthorityRawBody,bytes=Buffer.from(raw),headers=f.req.headers,slot=Object.getOwnPropertyDescriptor(f.req,'scanAuthorityRawBody');
    let cap;
    try{
      cap=await capture(f.req,f.deps);const observed=inspect(cap);
      assert.equal(cap.current_transaction_admission,false);assert.equal(observed.transaction_authority,false);
      for(const key of Object.keys(recoveryDeniedEffects))assert.equal(cap[key],false);
      assert.equal(observed.rpc_parameters.p_original_request_utf8,bytes.toString('utf8'));
      assert.equal(f.row.confirmed_at,NOW);assert.equal(f.req.headers,headers);assert.equal(f.req.scanAuthorityRawBody,raw);
      assert.deepEqual(Object.getOwnPropertyDescriptor(f.req,'scanAuthorityRawBody'),slot);assert.deepEqual(raw,bytes);
      assert.deepEqual(f.events,['device','credential','context','generation','device','credential']);
    }finally{if(cap)close(cap);}
    assert.throws(()=>inspect(cap),'Closing this actual capture must still retire its handoff');
  },
  async confirmation_awaited_withdrawal(){
    for(const [name,value]of [['future','2026-10-17T00:00:00.000Z'],['invalid','not-a-confirmation-instant'],
      ['postgres_infinity','infinity'],['numeric_infinity',Infinity],
      ['same_instant_different_original_text','2026-10-01T00:00:00Z']]){
      const f=fixture(),original=f.row.confirmed_at,raw=f.req.scanAuthorityRawBody,bytes=Buffer.from(raw);
      let changed=false;
      f.setHook(async kind=>{if(kind==='sql'&&f.events.at(-1)==='context'){
        await Promise.resolve();f.row.confirmed_at=value;changed=true;f.setHook(null);
      }});
      try{
        await assert.rejects(()=>capture(f.req,f.deps),error=>error.code==='native_original_inventory_request_invalid');
        assert.equal(changed,true);assert.equal(f.events.filter(x=>x==='credential').length,2);
        assert.deepEqual(f.events,['device','credential','context','generation','device','credential']);
        assert.equal(f.req.scanAuthorityRawBody,raw);assert.deepEqual(raw,bytes);assert.equal(f.row.confirmed_at,value);
        console.log(JSON.stringify({member:'confirmation_awaited_withdrawal',case:name,authenticated_handoff_observed:false,credential_reads:2}));
      }finally{f.row.confirmed_at=original;f.setHook(null);}
      // No captured handle was issued; restoring fixture rows does not turn
      // that rejected invocation into a retained authenticated handoff.
      assert.deepEqual(raw,bytes);
    }
  },
  async descriptor(){
    const f=fixture(),cap=await capture(f.req,f.deps),raw=f.req.scanAuthorityRawBody;
    assert.equal(inspect(cap).transaction_authority,false);
    let getterCalls=0;
    Object.defineProperty(f.req,'scanAuthorityRawBody',{configurable:true,get(){getterCalls++;return raw;}});
    assert.throws(()=>inspect(cap),'Replacing the owned data slot with a getter must retire the original');
    assert.equal(getterCalls,0);
    Object.defineProperty(f.req,'scanAuthorityRawBody',{configurable:true,enumerable:true,writable:true,value:raw});
    assert.throws(()=>inspect(cap),'Restoring exact bytes/data slot cannot revive the old capture');
    const before=fixture();let firstGetterCalls=0;
    Object.defineProperty(before.req,'scanAuthorityRawBody',{configurable:true,get(){firstGetterCalls++;return raw;}});
    await denied(()=>capture(before.req,before.deps));assert.equal(firstGetterCalls,0);assert.equal(before.events.length,0);
  },
  async terminal(){
    for(const change of ['headers','raw-reference','raw-bytes','env']){
      const f=fixture(),cap=await capture(f.req,f.deps),headers=f.req.headers,raw=f.req.scanAuthorityRawBody,
        bytes=Buffer.from(raw),secret=f.deps.env.DEVICE_CREDENTIAL_SECRET;
      if(change==='headers')f.req.headers={...headers};
      if(change==='raw-reference')f.req.scanAuthorityRawBody=Buffer.from(raw);
      if(change==='raw-bytes')raw[0]=32;
      if(change==='env')f.deps.env.DEVICE_CREDENTIAL_SECRET='WITHDRAWN_SOURCE_FIXTURE_ONLY';
      assert.throws(()=>inspect(cap),change);
      f.req.headers=headers;f.req.scanAuthorityRawBody=raw;bytes.copy(raw);f.deps.env.DEVICE_CREDENTIAL_SECRET=secret;
      assert.throws(()=>inspect(cap),'An observed refusal cannot revive after restoration: '+change);
      assert.deepEqual(raw,bytes);close(cap);
    }
  },
  async original(){
    const f=fixture(),bytes=Buffer.from(f.req.scanAuthorityRawBody);
    const cap=await capture(f.req,f.deps);
    assert.equal(cap.current_transaction_admission,false);
    for(const key of Object.keys(recoveryDeniedEffects))assert.equal(cap[key],false);
    const owned=inspect(cap);assert.equal(owned.transaction_authority,false);
    assert.equal(owned.rpc_parameters.p_original_request_utf8,bytes.toString('utf8'));
    assert.equal(owned.rpc_parameters.p_native_request,id(7));assert.deepEqual(f.req.scanAuthorityRawBody,bytes);
    assert.throws(()=>inspect(JSON.parse(JSON.stringify(cap))));close(cap);assert.throws(()=>inspect(cap));
    assert.deepEqual(f.events,['device','credential','context','generation','device','credential']);
  },
  async wire(){
    const f=fixture(),decoded=decode(f.req.scanAuthorityRawBody);
    assert.equal(decoded.intent.intent_id,id(7));assert.ok(Object.isFrozen(decoded.intent.original_target));
    for(const [key,value]of [['work_accepted',true],['key_removal',true],['native_held_stamp','DURABLE_HELD:0'],
      ['native_held_stamp','DURABLE_HELD:9223372036854775808'],['created_at','0000-01-01T00:00:00.000Z']]){
      f.prepare({...f.intent,[key]:value});assert.throws(()=>decode(f.req.scanAuthorityRawBody),key);
    }
    f.prepare();const raw=f.req.scanAuthorityRawBody.toString('utf8');
    assert.throws(()=>decode(Buffer.from(raw.slice(0,-1)+',"purpose":"'+W.purpose+'"}')));
    assert.throws(()=>decode(Buffer.from(raw.replace('REQUEST_EXACT_ORIGINAL_INVENTORY_ACK','AUTHORIZE_SAME_ORIGINAL_RECOVERY_PREPARATION'))));
    assert.throws(()=>decode(Buffer.from('{"schema":"'+W.schema+'","original_intent_utf8":"\\ud800"}')));
    let traps=0;assert.throws(()=>decode(new Proxy(Buffer.from(raw),{get(){traps++;throw Error('trap');}})));assert.equal(traps,0);
    const shared=Buffer.from(new SharedArrayBuffer(8));assert.throws(()=>decode(shared));
    const movable=Buffer.from(new ArrayBuffer(8));structuredClone(movable.buffer,{transfer:[movable.buffer]});assert.throws(()=>decode(movable));
  },
  async withdrawal(){
    for(const change of ['headers','bytes','body','abort','env','method']){
      const f=fixture();f.setHook(async kind=>{if(kind!=='sql')return;f.setHook(null);
        if(change==='headers')f.req.headers={...f.req.headers};
        if(change==='bytes')f.req.scanAuthorityRawBody[0]=32;
        if(change==='body')f.req.body={};if(change==='abort')f.req.aborted=true;
        if(change==='env')f.deps.env.DEVICE_CREDENTIAL_SECRET='WITHDRAWN_SYNTHETIC_ONLY';
        if(change==='method')f.deps.store.findCredential=async()=>f.row;
      });await denied(()=>capture(f.req,f.deps));assert.equal(f.events.filter(x=>x==='credential').length,0,change);
    }
    {
      const f=fixture();f.setHook(async(kind,n)=>{if(kind==='credential'&&n===2)f.row.revoked_at=NOW;});
      await denied(()=>capture(f.req,f.deps));assert.equal(f.events.filter(x=>x==='credential').length,2);
    }
    {
      const f=fixture();f.prepare(f.intent,{purpose_attestation:'0'.repeat(64)});
      await denied(()=>capture(f.req,f.deps));assert.ok(!f.events.includes('context'));
    }
    {
      const f=fixture();f.generation.principal_digest='0'.repeat(64);await denied(()=>capture(f.req,f.deps));
    }
  },
};
export {fixture as inventoryRequestFixture};
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const name=process.argv[2];assert.ok(Object.hasOwn(cases,name),'Select only one NEW original, wire, withdrawal or terminal member');
  await cases[name]();console.log('PASS_NEW_INVENTORY_REQUEST_SOURCE_FIXTURE '+name);
  console.log('NO_NATIVE_ISSUER_SQL_ROUTE_CURRENT_TRANSACTION_MANAGER_OR_ACK_PROOF');
}
