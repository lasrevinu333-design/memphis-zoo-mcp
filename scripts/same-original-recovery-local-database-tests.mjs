import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {recoveryTargetFields,recoveryDeniedEffects,recoveryPreparationPurpose,recoveryDocumentSha256} from '../src/same-original-recovery-wire.js';

// Newly affected callable/READ ONLY floor only. A missing original is never
// made into an approved fixture; positive native/manager joins remain separate.
export async function qualifyCurrentNativeManagerPreparationReadFloor({admin,backendRoot}){
 const prepared=await prepareSameOriginalNativeRegistrationFixture({admin,backendRoot});
 assert.equal(prepared.context_source,'ACTUAL_FIXED_SQL_INTENDED_READER_BEFORE_NATIVE_ORIGINALS');
 const signature='public.custodial_same_original_current_manager_preparation_v1(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,uuid,timestamptz,text,text,text)';
 const privateSignature='custodial_recovery.read_current_native_manager_preparation(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,uuid,timestamptz,text,text,text)';
 const catalog=(await admin.query('select p.provolatile,p.prosecdef,p.proconfig from pg_proc p where p.oid=$1::regprocedure',[signature])).rows[0];
 assert.equal(catalog.provolatile,'s');assert.equal(catalog.prosecdef,true);assert.ok(catalog.proconfig.includes('search_path=""'));
 assert.equal((await admin.query("select has_function_privilege('service_role',$1,'execute') allowed",[signature])).rows[0].allowed,true);
 for(const actor of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'])
  assert.equal((await admin.query('select has_function_privilege($1,$2,\'execute\') allowed',[actor,privateSignature])).rows[0].allowed,false);
 for(const actor of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'])
  assert.equal((await admin.query('select has_function_privilege($1,$2,\'execute\') allowed',[actor,signature])).rows[0].allowed,false);
 const before=(await admin.query('select (select count(*) from public.custodial_same_original_recovery_challenges)::text challenges,(select count(*) from public.custodial_same_original_recovery_approvals)::text approvals')).rows[0];
 assert.deepEqual(before,{challenges:'0',approvals:'0'});
 const raw='{}',hash=createHash('sha256').update(raw).digest('hex'),id='95000000-0000-4000-8000-000000000099';
 const {pathToFileURL}=await import('node:url');
 const {deviceCredentialInternals:fixtureCredentials}=await import(pathToFileURL(backendRoot+'/src/auth/device-credential-auth.js'));
 const fixtureEnv={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'SYNTHETIC_ONLY_HTTP_PIECE_LOCAL_SOURCE_KEY'};
 const values=[id,prepared.context.device_id,prepared.context.credential_id,
  fixtureCredentials.tokenHash('SYNTHETIC_LONG_DEVICE_SECRET_SOURCE_OWNER_KIOSK_08',fixtureEnv),
  fixtureCredentials.deviceCredentialSecretKeyId(fixtureEnv),id,0,id,'a'.repeat(64),'b'.repeat(64),id,
  new Date().toISOString(),hash,'c'.repeat(64),raw];
 const sql='select public.custodial_same_original_current_manager_preparation_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid,$7::integer,$8::uuid,$9::text,$10::text,$11::uuid,$12::timestamptz,$13::text,$14::text,$15::text) data';
 await admin.query('begin read only');
 try{await admin.query('set local role service_role');const rows=(await admin.query(sql,values)).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].data,null,'missing original cannot create a manager preparation observation');await admin.query('commit');}
 catch(error){await admin.query('rollback');throw error;}
 const after=(await admin.query('select (select count(*) from public.custodial_same_original_recovery_challenges)::text challenges,(select count(*) from public.custodial_same_original_recovery_approvals)::text approvals')).rows[0];
 assert.deepEqual(after,before);
 return {checks:['new fixed callable private/public ACL floor','actual intended READ ONLY missing-original returns null with no approval'],actual_SQL:true,
  positive_manager_native:false,scope:'NEW275_READER_ACL_AND_NO_ORIGINAL_FLOOR_ONLY',approvals_created:0};
}

// Existing isolated schema/fixture setup, before ANY new native original.
// The context is read through its intended reader, never fabricated from the
// native target or seeded as a completed/custodied frame.
export async function prepareSameOriginalNativeRegistrationFixture({admin,backendRoot,inventoryJoin=false}) {
  assert.equal(typeof inventoryJoin,'boolean');
  const {pathToFileURL}=await import('node:url'),path=await import('node:path');
  const {deviceCredentialInternals:credentials}=await import(pathToFileURL(backendRoot+'/src/auth/device-credential-auth.js'));
  const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'SYNTHETIC_ONLY_HTTP_PIECE_LOCAL_SOURCE_KEY'};
  const secret='SYNTHETIC_LONG_DEVICE_SECRET_SOURCE_OWNER_KIOSK_08';
  const tokenHash=credentials.tokenHash(secret,env),keyId=credentials.deviceCredentialSecretKeyId(env);
  const seedPath=path.resolve(backendRoot,'../../retained-wire-seed-v1.sql');
  let seed=readFileSync(seedPath,'utf8');
  assert.equal(createHash('sha256').update(seed).digest('hex'),'6a47fb85f22a445d54d418b08df23bace02bd02f4da4b5cb060d494d398a76c0');
  const begin=seed.indexOf('INSERT INTO public.employee_native_push_generations('),end=seed.indexOf('INSERT INTO public.weekly_roster_slots(',begin);
  assert.ok(begin>0&&end>begin);seed=seed.slice(0,begin)+seed.slice(end);
  const ids={employee:'95000000-0000-4000-8000-000000000002',credential:'95000000-0000-4000-8000-000000000004',device:'95000000-0000-4000-8000-000000000001'};
  seed=seed.replaceAll('11111111-1111-4111-8111-111111111111',ids.employee).replaceAll('22222222-2222-4222-8222-222222222222',ids.credential).replaceAll('44444444-4444-4444-8444-444444444444',ids.device)
    .replaceAll("'KIOSK_08','Synthetic250 Original Device',true,employee,4","'KIOSK_08','Synthetic250 Original Device',true,employee,7")
    .replaceAll("employee,4,'android'","employee,7,'android'").replaceAll('SYNTHETIC_TOKEN_HASH',tokenHash).replaceAll('SYNTHETIC_METADATA_JSON',JSON.stringify(credentials.deviceCredentialSecretMetadata(env)));
  if(inventoryJoin){
    // NEW inventory/status flow observes the actual CURRENT server clock.
    // Select a finite lifetime in this fresh fixture's INITIAL INSERT only;
    // never renew/update an existing credential or alter historical modes.
    const lifetime="statement_timestamp()+interval '1 second'";
    assert.equal(seed.split(lifetime).length,2);
    seed=seed.replace(lifetime,"statement_timestamp()+interval '1 hour'");
  }
  await admin.query(seed);seed=null;
  await admin.query('begin read only');let context;
  try{await admin.query('set local role custodial_application_reader');context=(await admin.query('select public.custodial_v13_read_separation_context($1::uuid,$2::uuid) context',[ids.device,ids.credential])).rows[0]?.context;await admin.query('commit');}
  catch(error){await admin.query('rollback');throw error;}
  assert.ok(context);assert.equal(context.device_id,ids.device);assert.equal(context.credential_id,ids.credential);
  assert.equal(context.employee_id,ids.employee);assert.equal(context.assignment_epoch,7);
  assert.equal(context.state,'PENDING_RECONCILIATION');assert.equal(context.new_work_allowed,false);assert.equal(context.phone_released,false);
  return {context,context_source:'ACTUAL_FIXED_SQL_INTENDED_READER_BEFORE_NATIVE_ORIGINALS',seed_source_sha256:'6a47fb85f22a445d54d418b08df23bace02bd02f4da4b5cb060d494d398a76c0'};
}

// Staged SOURCE FIXTURE only. Native must create each original BEFORE its SQL
// acceptance, then capture the returned response BEFORE Main calls separation.
// Byte echoes below are matching checks, NOT proof of native response capture.
export async function prepareSameOriginalNativeAcceptedCompletionFixture({admin,backendRoot,ordinaryTwoVisit=false}) {
  assert.equal(typeof ordinaryTwoVisit,'boolean');
  const {pathToFileURL}=await import('node:url'),path=await import('node:path');
  const {randomBytes}=await import('node:crypto');
  const authModule=await import(pathToFileURL(backendRoot+'/src/auth/device-credential-auth.js'));
  const {normalizeCanonicalScanEvidence}=await import(pathToFileURL(backendRoot+'/src/scan-evidence.js'));
  const {scanRpcHttpOutcome}=await import(pathToFileURL(backendRoot+'/src/offline-authority-http.js'));
  const {deviceCredentialInternals:credentials,authenticateDeviceCredentialRequest,
    verifyNativeDeviceRequestAttestation,prepareVerifiedNativeOfflineWorkArguments}=authModule;
  const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'SYNTHETIC_ONLY_HTTP_PIECE_LOCAL_SOURCE_KEY'};
  const secret='SYNTHETIC_LONG_DEVICE_SECRET_SOURCE_OWNER_KIOSK_08';
  const ids={employee:'95000000-0000-4000-8000-000000000002',credential:'95000000-0000-4000-8000-000000000004',device:'95000000-0000-4000-8000-000000000001'};
  const seedSha='6a47fb85f22a445d54d418b08df23bace02bd02f4da4b5cb060d494d398a76c0';
  let seed=readFileSync(path.resolve(backendRoot,'../../retained-wire-seed-v1.sql'),'utf8');
  assert.equal(createHash('sha256').update(seed).digest('hex'),seedSha);
  const pushBegin=seed.indexOf('INSERT INTO public.employee_native_push_generations(');
  const pushEnd=seed.indexOf('INSERT INTO public.weekly_roster_slots(',pushBegin);
  assert.ok(pushBegin>0&&pushEnd>pushBegin);seed=seed.slice(0,pushBegin)+seed.slice(pushEnd);
  seed=seed.replaceAll('11111111-1111-4111-8111-111111111111',ids.employee)
    .replaceAll('22222222-2222-4222-8222-222222222222',ids.credential)
    .replaceAll('44444444-4444-4444-8444-444444444444',ids.device)
    .replaceAll("'KIOSK_08','Synthetic250 Original Device',true,employee,4","'KIOSK_08','Synthetic250 Original Device',true,employee,7")
    .replaceAll("employee,4,'android'","employee,7,'android'")
    .replaceAll('SYNTHETIC_TOKEN_HASH',credentials.tokenHash(secret,env))
    .replaceAll('SYNTHETIC_METADATA_JSON',JSON.stringify(credentials.deviceCredentialSecretMetadata(env)));
  // New accepted fixture initial INSERT only, explicitly released by Main.
  // Never UPDATE/refresh an existing or expired credential.
  const oldLifetime="statement_timestamp()+interval '1 second'";
  assert.equal(seed.split(oldLifetime).length,2);
  seed=seed.replace(oldLifetime,"statement_timestamp()+interval '1 hour'");
  // Accepted setup only: a matching devices row is NOT assignment history.
  // Start this fresh row unassigned at epoch6; the normal manager assignment
  // writer + existing trigger must establish the ORIGINAL epoch7/history.
  const preassigned="'KIOSK_08','Synthetic250 Original Device',true,employee,7";
  assert.equal(seed.split(preassigned).length,2);
  seed=seed.replace(preassigned,"'KIOSK_08','Synthetic250 Original Device',true,null,6");
  const cut=seed.indexOf('-- Same owner-to-owner definer boundary used by source');
  assert.ok(cut>0);assert.match(seed.slice(0,cut),/\nBEGIN;\n/);assert.match(seed.slice(cut),/\nCOMMIT;\s*$/);
  const prefix=seed.slice(0,cut),separation=seed.slice(cut);seed=null;
  const assignmentCut=prefix.indexOf('INSERT INTO public.employee_push_registrations(');
  assert.ok(assignmentCut>prefix.indexOf('INSERT INTO public.device_auth_credentials('));
  assert.equal(prefix.split('INSERT INTO public.employee_push_registrations(').length,2);
  const locationId=randomUUID(),locationCode='SYNTHETIC_ACCEPTED_ORIGINAL';
  const executionSecret=randomBytes(32).toString('hex'),routeSecret=randomBytes(32).toString('hex');
  let state='PREPARING',activeLoanCheck=()=>{},snapshot,start,completion,originalArguments,commitResponse;
  let ordinaryVisit=1;const capturedOrdinaryOriginals=[];
  const sha=value=>createHash('sha256').update(value).digest('hex');
  const clone=value=>structuredClone(value);
  // Main must loan one dedicated SQL session, not a pool rotating clients:
  // the unchanged seed's temporary IDs bridge the committed stage boundary.
  const sqlSession=(await admin.query('select pg_backend_pid() pid')).rows[0]?.pid;
  assert.ok(Number.isInteger(sqlSession));
  async function sameSession(){assert.equal((await admin.query('select pg_backend_pid() pid')).rows[0]?.pid,sqlSession);activeLoanCheck();}
  async function tx(actor,sql,values=[],readOnly=true) {
    assert.ok(['service_role','custodial_application_reader'].includes(actor));
    await sameSession();
    await admin.query(readOnly?'begin read only':'begin');
    try{activeLoanCheck();await admin.query('set local role '+actor);activeLoanCheck();
      const rows=(await admin.query(sql,values)).rows;activeLoanCheck();await admin.query('commit');activeLoanCheck();return rows;}
    catch(error){try{await admin.query('rollback');}catch(cleanup){error.rollbackFailure=cleanup;}throw error;}
  }
  // Each normal auth store method is backed by actual SQL, not an auth result.
  const touches=new Set();
  const store={
    async getPolicy(){const rows=await tx('service_role','select mode,updated_by,updated_at from public.device_auth_policy where singleton=true');
      // Match the normal store's maybeSingle/normalizePolicyMode contract.
      // Missing policy DATA is not a fabricated enforce row; required enrolled
      // credential auth and the explicit credentialed:true assertion stay on.
      assert.ok(rows.length<=1);const data=rows[0];
      return {mode:credentials.normalizePolicyMode(data?.mode),updated_by:data?.updated_by||null,updated_at:data?.updated_at||null};},
    async findCredential(id){
      // Match the shipping Supabase JSON wire: timestamps are lossless string
      // primitives, not independently allocated pg Date objects. Normal auth
      // retains its strict before/after original confirmed_at identity guard.
      return (await tx('service_role','select row_to_json(c) data from public.device_auth_credentials c where credential_id=$1',[id]))[0]?.data||null;
    },
    touchCredential(id,patch){
      const allowed=['last_used_at','last_user_agent_hash','last_ip_hash','metadata_json'];
      const fields=Object.keys(patch);assert.ok(fields.length&&fields.every(k=>allowed.includes(k)));
      const work=tx('service_role','update public.device_auth_credentials set '+fields.map((k,i)=>k+'=$'+(i+2)+(k==='metadata_json'?'::jsonb':'')).join(',')+
        ' where credential_id=$1 and revoked_at is null returning credential_id',[id,...fields.map(k=>k==='metadata_json'?JSON.stringify(patch[k]):patch[k])],false);
      touches.add(work);return work.finally(()=>touches.delete(work));
    },
  };
  // No caller SQL, actor or writer callback; fixed path and privately pinned token.
  const startKeys=['p_device_id','p_location_code','p_client_session_id','p_client_started_at','p_snapshot_id','p_snapshot_employee_id',
    'p_snapshot_assignment_epoch','p_snapshot_credential_id','p_native_scan_entry_id','p_native_start_attestation_version','p_native_start_attestation'];
  const completionKeys=['p_device_id','p_client_session_id','p_client_completion_id','p_location_code','p_client_started_at','p_client_ended_at',
    'p_response_json','p_scan_evidence','p_correlation_id','p_native_finish_scan_entry_id','p_native_completion_attestation_version','p_native_completion_attestation'];
  const headerKeys=['X-Memphis-Native-Attestation-Version','X-Memphis-Native-Request-Id','X-Memphis-Native-Request-Timestamp','X-Memphis-Native-Request-Attestation'];
  function plainData(value,keys){
    assert.ok(value&&Object.getPrototypeOf(value)===Object.prototype);
    const d=Object.getOwnPropertyDescriptors(value);assert.deepEqual(Reflect.ownKeys(d).sort(),keys.slice().sort());
    for(const k of keys)assert.ok(Object.hasOwn(d[k],'value'));return d;
  }
  function takeLoan(loan,fn,keys){
    const d=plainData(loan,['exactRequestBytes','exactArgumentBytes','nativeHeaders']);
    const raw=d.exactRequestBytes.value,argsRaw=d.exactArgumentBytes.value,headers=d.nativeHeaders.value;
    assert.ok(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=1048576);
    assert.ok(Buffer.isBuffer(argsRaw)&&argsRaw.length>0&&argsRaw.length<=1048576);
    const hd=plainData(headers,headerKeys);for(const k of headerKeys)assert.equal(typeof hd[k].value,'string');
    const owned=Buffer.from(raw),argumentsOwned=Buffer.from(argsRaw),headerOwned=Object.fromEntries(headerKeys.map(k=>[k,hd[k].value]));
    try{
    const decoder=new TextDecoder('utf-8',{fatal:true});
    const body=JSON.parse(decoder.decode(owned)),args=JSON.parse(decoder.decode(argumentsOwned));
    plainData(body,['fn','args']);plainData(args,keys);assert.equal(body.fn,fn);assert.deepEqual(body.args,args);
    assert.equal(args.p_device_id,'KIOSK_08');assert.equal(args.p_location_code,locationCode);
    const unchanged=()=>{assert.ok(raw.equals(owned)&&argsRaw.equals(argumentsOwned),'original native loan changed');
      const live=plainData(loan,['exactRequestBytes','exactArgumentBytes','nativeHeaders']);
      assert.equal(live.exactRequestBytes.value,raw);assert.equal(live.exactArgumentBytes.value,argsRaw);assert.equal(live.nativeHeaders.value,headers);
      plainData(headers,headerKeys);for(const k of headerKeys)assert.equal(headers[k],headerOwned[k]);};
    const req={method:'POST',originalUrl:'/scan-api/rpc',url:'/scan-api/rpc',body,scanAuthorityRawBody:owned,
      headers:Object.fromEntries(Object.entries({...headerOwned,Authorization:'Device '+ids.credential+'.'+secret,
        'X-Device-Id':'KIOSK_08','X-Memphis-App-Edition':'custodial',Origin:'https://localhost','Content-Type':'application/json'}).map(([k,v])=>[k.toLowerCase(),v]))};
    req.header=name=>req.headers[name.toLowerCase()];
    return {raw:owned,argsRaw:argumentsOwned,args,req,unchanged};
    }catch(error){owned.fill(0);argumentsOwned.fill(0);throw error;}
  }
  async function authenticate(loan,kind){
    loan.unchanged();
    const result=await authenticateDeviceCredentialRequest(loan.req,{env,store,requireEnrolledCredential:true,
      runReadOnlySql:async sql=>tx('custodial_application_reader',sql)});
    await Promise.all([...touches]);loan.unchanged();assert.equal(result.ok,true,result.code);assert.equal(result.credentialed,true);
    const device=result.device;assert.equal(device.device_active,true);assert.equal(device.employee_active,true);
    assert.equal(device.canonical_device_pk,ids.device);assert.equal(device.canonical_device_id,'KIOSK_08');
    assert.equal(device.assigned_employee_id,ids.employee);assert.equal(Number(device.assignment_epoch),7);
    assert.equal(result.credential.credential_id,ids.credential);assert.ok(result.credential.confirmed_at);assert.ok(!result.credential.revoked_at);
    loan.req.memphisDevice=device;loan.req.memphisDeviceCredential=result.credential;
    loan.req.memphisNativeRequestAttestation=verifyNativeDeviceRequestAttestation(loan.req); // Real current Date, no override.
    const verified=prepareVerifiedNativeOfflineWorkArguments(loan.req,loan.args,kind);
    assert.deepEqual(verified,loan.args,'fresh native signature/values must already be canonical; never rewrite originals');
  }
  function response(fn,result){const outcome=scanRpcHttpOutcome(fn,result);assert.equal(outcome.status,200);
    assert.equal(outcome.body.ok,true);return Buffer.from(JSON.stringify(outcome.body),'utf8');}
  try{
    // Commit fresh setup BEFORE returning to Native. Temporary fixture_ids uses
    // PostgreSQL's existing PRESERVE ROWS behavior; no service-role leak/wait.
    await sameSession();await admin.query(prefix.slice(0,assignmentCut));
    const originalCredential=(await admin.query('select row_to_json(c) data from public.device_auth_credentials c where credential_id=$1::uuid',[ids.credential])).rows;
    assert.equal(originalCredential.length,1);
    const managers=(await admin.query('select manager from pg_temp.fixture_ids')).rows;assert.equal(managers.length,1);
    await admin.query('set local role service_role');let assignment,assignmentFailure;
    try{const rows=(await admin.query('select public.custodial_assign_employee_device($1,$2::uuid,$3::uuid,$4,false,true,null::uuid) data',[
      'KIOSK_08',ids.employee,managers[0].manager,'synthetic accepted original prerequisite before snapshot'])).rows;
      assert.equal(rows.length,1);assignment=rows[0].data;
    }catch(error){assignmentFailure=error;throw error;}
    finally{try{await admin.query('reset role');}catch(cleanup){if(assignmentFailure)assignmentFailure.roleResetFailure=cleanup;else throw cleanup;}}
    assert.equal(assignment.changed,true);assert.equal(assignment.device.device_pk,ids.device);
    assert.equal(assignment.device.device_id,'KIOSK_08');assert.equal(assignment.device.assigned_employee_id,ids.employee);
    const assigned=(await admin.query(`select d.assignment_epoch::text assignment_epoch,h.assignment_change_id,h.new_employee_id
      from public.devices d join public.custodial_employee_device_assignment_history h on h.device_id=d.id
      where d.id=$1::uuid and d.assigned_employee_id=$2::uuid and h.new_employee_id=$2::uuid
        and h.previous_employee_id is null and h.source='operations_app'
        and h.changed_by_manager_id=(select manager from pg_temp.fixture_ids)`,[ids.device,ids.employee])).rows;
    assert.equal(assigned.length,1);assert.equal(assigned[0].assignment_epoch,'7');
    assert.match(assigned[0].assignment_change_id,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    assert.deepEqual((await admin.query('select row_to_json(c) data from public.device_auth_credentials c where credential_id=$1::uuid',[ids.credential])).rows,originalCredential);
    // Original seed registrations are inserted only AFTER real assignment, so
    // they never falsely describe an unassigned epoch6 device as epoch7.
    await admin.query(prefix.slice(assignmentCut));
    await admin.query('select public.custodial_configure_backend_execution_key($1,$2)',[sha(executionSecret),'synthetic-staged-original']);
    await admin.query('select public.custodial_configure_native_route_proof_key($1,$2)',[sha(routeSecret),'synthetic-staged-original']);
    await admin.query("insert into public.locations(id,location_code,location_name,location_type,form_type,active) values($1,$2,'Synthetic Original Restroom','restroom','restroom',true)",[locationId,locationCode]);
    await admin.query('commit');
  }catch(error){try{await admin.query('rollback');}catch(cleanup){error.rollbackFailure=cleanup;}state='HELD';throw error;}
  try{
    const rows=await tx('service_role','select public.tool_get_offline_scan_authority_snapshot($1,$2,$3) data',['KIOSK_08',ids.credential,executionSecret],false);
    assert.equal(rows.length,1);snapshot=rows[0].data;assert.equal(snapshot.employee_id,ids.employee);
    assert.equal(snapshot.credential_id,ids.credential);assert.equal(snapshot.assignment_epoch,7);state='AWAIT_NATIVE_START';
  }catch(error){state='HELD';throw error;}
  return Object.freeze({
    prepared:Object.freeze({scope:'SYNTHETIC_ACTIVE_FIXTURE_BEFORE_NATIVE_START_NOT_AUTHORITY',snapshot:clone(snapshot),
      device_id:ids.device,device_identifier:'KIOSK_08',employee_id:ids.employee,credential_id:ids.credential,assignment_epoch:7,
      location_id:locationId,location_code:locationCode,separation_cutoff_created:false,context:null,
      seed_source_sha256:seedSha,initial_credential_lifetime:'1 hour'}),
    async startOriginal(loan){
      assert.equal(state,'AWAIT_NATIVE_START');state='START_UNKNOWN';let native;
      try{
        native=takeLoan(loan,'tool_start_offline_occurrence',startKeys);
        activeLoanCheck=()=>{assert.equal(state,'START_UNKNOWN');native.unchanged();};
        const p=native.args;
        if(ordinaryTwoVisit&&ordinaryVisit===2){
          const first=capturedOrdinaryOriginals[0];assert.ok(first);
          assert.notEqual(p.p_client_session_id,first.start.args.p_client_session_id,'a captured original is not a new visit');
          assert.notEqual(p.p_native_scan_entry_id,first.start.args.p_native_scan_entry_id,'new ordinary visit needs a new native scan');
          assert.notEqual(p.p_native_scan_entry_id,first.arguments.p_native_finish_scan_entry_id,'prior finish cannot become next start');
        }
        assert.equal(p.p_snapshot_id,snapshot.snapshot_id);assert.equal(p.p_snapshot_employee_id,ids.employee);
        assert.equal(p.p_snapshot_credential_id,ids.credential);assert.equal(p.p_snapshot_assignment_epoch,7);
        await authenticate(native,'start');
        const rows=await tx('service_role','select public.tool_start_offline_occurrence($1,$2,$3,$4,$5,$6,$7::integer,$8,$9,$10,$11,$12,$13,$14) data',[
          p.p_device_id,p.p_location_code,p.p_client_session_id,p.p_client_started_at,p.p_snapshot_id,p.p_snapshot_employee_id,p.p_snapshot_assignment_epoch,
          p.p_snapshot_credential_id,ids.credential,p.p_native_scan_entry_id,p.p_native_start_attestation_version,p.p_native_start_attestation,routeSecret,executionSecret],false);
        assert.equal(rows.length,1);const data=rows[0].data;assert.equal(data.native_start_attested,true);assert.equal(data.client_session_id,p.p_client_session_id);
        const bytes=response('tool_start_offline_occurrence',data);
        start={args:clone(p),result:clone(data),response:Buffer.from(bytes)};state='AWAIT_NATIVE_COMPLETION';
        return {actual_start_result:clone(data),exactResponseBytes:bytes,original_start_arguments_utf8:native.argsRaw.toString('utf8')};
      }finally{activeLoanCheck=()=>{};native?.raw.fill(0);native?.argsRaw.fill(0);}
    },
    async commitOriginal(loan){
      assert.equal(state,'AWAIT_NATIVE_COMPLETION');state='COMPLETION_UNKNOWN';let native;
      try{
        native=takeLoan(loan,'tool_commit_cleaning_workflow',completionKeys);
        activeLoanCheck=()=>{assert.equal(state,'COMPLETION_UNKNOWN');native.unchanged();};const p=native.args;
        assert.equal(p.p_client_session_id,start.args.p_client_session_id);assert.equal(p.p_client_started_at,start.args.p_client_started_at);
        if(ordinaryTwoVisit&&ordinaryVisit===2){
          const first=capturedOrdinaryOriginals[0];
          assert.equal(p.p_response_json.work_result,'checked_no_cleaning_needed');
          assert.notEqual(p.p_client_completion_id,first.arguments.p_client_completion_id);
          assert.notEqual(p.p_native_finish_scan_entry_id,first.arguments.p_native_finish_scan_entry_id);
          assert.notEqual(p.p_native_finish_scan_entry_id,first.start.args.p_native_scan_entry_id);
          assert.ok(Date.parse(p.p_client_ended_at)>Date.parse(first.arguments.p_client_ended_at),'check must actually follow accepted cleaning');
        }
        const control=p.p_response_json?.__custodial_offline_reconciliation_v1;
        plainData(control,['context_id','submission_proof']);assert.equal(control.context_id,start.result.context_id);
        assert.equal(control.submission_proof,start.result.submission_proof);
        assert.deepEqual(normalizeCanonicalScanEvidence(p.p_scan_evidence),p.p_scan_evidence);
        await authenticate(native,'completion');
        originalArguments=Buffer.from(native.argsRaw);
        // Same normal route mapping: preserve signed p_* input, extract its
        // existing reconciliation control for SQL, inject ONLY server secrets.
        const answers={...p.p_response_json};delete answers.__custodial_offline_reconciliation_v1;
        const rows=await tx('service_role','select public.tool_commit_cleaning_workflow_authoritative($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17) data',[
          p.p_client_session_id,p.p_client_completion_id,p.p_device_id,p.p_location_code,p.p_client_started_at,p.p_client_ended_at,
          JSON.stringify(answers),JSON.stringify(p.p_scan_evidence),p.p_correlation_id,control.context_id,control.submission_proof,ids.credential,
          p.p_native_finish_scan_entry_id,p.p_native_completion_attestation_version,p.p_native_completion_attestation,routeSecret,executionSecret],false);
        assert.equal(rows.length,1);const result=rows[0].data;assert.equal(result.status,'closed');
        assert.equal(result.client_session_id,p.p_client_session_id);assert.equal(result.client_completion_id,p.p_client_completion_id);
        // Reauthenticate same native request before/after intended fixed READ.
        await authenticate(native,'completion');
        const readback=await tx('custodial_application_reader','select * from custodial_release_identity.read_original_scan_completion_v1($1::uuid,$2,$3::uuid,$4::bigint,$5::uuid,$6::jsonb)',[
          ids.device,'KIOSK_08',ids.employee,7,ids.credential,originalArguments.toString('utf8')]);
        await authenticate(native,'completion');assert.equal(readback.length,1);
        assert.equal(readback[0].original.context_id,control.context_id);assert.equal(readback[0].original.client_completion_id,p.p_client_completion_id);
        commitResponse=response('tool_commit_cleaning_workflow',result);completion={result:clone(result),readback:clone(readback[0])};
        state='AWAIT_MAIN_NATIVE_RESPONSE_CAPTURE';
        return {actual_commit_result:clone(result),actual_fixed_readback:clone(readback[0]),exactResponseBytes:Buffer.from(commitResponse),
          original_completion_arguments_utf8:originalArguments.toString('utf8'),original_completion_arguments_sha256:sha(originalArguments),
          native_response_capture_proven:false,scope:'SOURCE_FIXTURE_ONLY_MAIN_MUST_CAPTURE_RESPONSE_BEFORE_SEPARATION'};
      }finally{activeLoanCheck=()=>{};native?.raw.fill(0);native?.argsRaw.fill(0);}
    },
    // Main must independently verify actual Native response capture before this
    // call. Exact byte echo enforces matching ONLY; it cannot authenticate capture.
    async separateOriginal({exactCapturedResponseBytes}){
      assert.equal(state,'AWAIT_MAIN_NATIVE_RESPONSE_CAPTURE');state='SEPARATION_UNKNOWN';
      assert.ok(Buffer.isBuffer(exactCapturedResponseBytes)&&exactCapturedResponseBytes.equals(commitResponse));
      activeLoanCheck=()=>{assert.equal(state,'SEPARATION_UNKNOWN');assert.ok(exactCapturedResponseBytes.equals(commitResponse));};
      try{await sameSession();await admin.query('begin');activeLoanCheck();await admin.query(separation);activeLoanCheck();} // original tail includes COMMIT.
      catch(error){try{await admin.query('rollback');}catch(cleanup){error.rollbackFailure=cleanup;}throw error;}
      const rows=await tx('custodial_application_reader','select public.custodial_v13_read_separation_context($1::uuid,$2::uuid) context',[ids.device,ids.credential]);
      assert.equal(rows.length,1);const context=rows[0].context;assert.equal(context.device_id,ids.device);
      assert.equal(context.credential_id,ids.credential);assert.equal(context.employee_id,ids.employee);assert.equal(context.assignment_epoch,7);
      assert.equal(context.state,'PENDING_RECONCILIATION');assert.equal(context.new_work_allowed,false);assert.equal(context.phone_released,false);
      state='SEPARATED';
      return {context,context_source:'ACTUAL_FIXED_SQL_INTENDED_READER_AFTER_NATIVE_RESPONSE_CAPTURE_MAIN_PRECONDITION',
        original_start_result:clone(start.result),actual_commit_result:clone(completion.result),actual_fixed_readback:clone(completion.readback),
        original_completion_arguments_utf8:originalArguments.toString('utf8'),original_completion_arguments_sha256:sha(originalArguments),
        native_source_authenticated:false,inventory_acknowledged:false,replay_allowed:false,finalizer_allowed:false,key_removal:false,phone_released:false};
    },
    async readOriginalSeparationContext(loan){
      assert.equal(state,'SEPARATED');
      const d=plainData(loan,['method','path','exactRequestBytes','nativeHeaders']);
      assert.equal(d.method.value,'GET');assert.equal(d.path.value,'/device-auth/separation-context');
      const raw=d.exactRequestBytes.value,headers=d.nativeHeaders.value;
      assert.ok(Buffer.isBuffer(raw)&&raw.length===0);plainData(headers,headerKeys);
      const pinnedHeaders=Object.fromEntries(headerKeys.map(k=>{assert.equal(typeof headers[k],'string');return[k,headers[k]];}));
      const unchanged=()=>{assert.equal(state,'SEPARATED');assert.equal(raw.length,0);
        plainData(loan,['method','path','exactRequestBytes','nativeHeaders']);
        assert.equal(loan.method,'GET');assert.equal(loan.path,'/device-auth/separation-context');
        assert.equal(loan.exactRequestBytes,raw);assert.equal(loan.nativeHeaders,headers);
        for(const key of headerKeys)assert.equal(headers[key],pinnedHeaders[key]);};
      activeLoanCheck=unchanged;
      try{
        // Invoke the actual installed shipping route, its normal separation
        // authentication and SQL-backed stores. No credential leaves closure;
        // no caller-auth object or successful envelope is fabricated here.
        let handler;
        authModule.installDeviceCredentialRoutes({use(){},post(){},get(path,...handlers){
          if(path==='/device-auth/separation-context'){assert.equal(handlers.length,1);handler=handlers[0];}
        }},{env,store,runReadOnlySql:sql=>tx('custodial_application_reader',sql)});
        assert.equal(typeof handler,'function');
        const req={method:'GET',originalUrl:'/device-auth/separation-context',url:'/device-auth/separation-context',
          scanAuthorityRawBody:Buffer.alloc(0),headers:Object.fromEntries(Object.entries({...pinnedHeaders,
            Authorization:'Device '+ids.credential+'.'+secret,'X-Device-Id':'KIOSK_08',Origin:'https://localhost',
            'X-Memphis-App-Edition':'custodial'}).map(([k,v])=>[k.toLowerCase(),v]))};
        let status=200,responseBytes=null;const responseHeaders={};
        const res={setHeader(k,v){responseHeaders[k.toLowerCase()]=v;},status(code){status=code;return this;},
          json(body){assert.equal(responseBytes,null);responseBytes=Buffer.from(JSON.stringify(body));return this;}};
        await handler(req,res);unchanged();assert.ok(Buffer.isBuffer(responseBytes));
        assert.equal(responseHeaders['cache-control'],'no-store');
        return {http_status:status,exactResponseBytes:responseBytes,cache_control:'no-store',
          source:'ACTUAL_SHIPPING_SEPARATION_CONTEXT_ROUTE_NORMAL_AUTH_AND_FIXED_SQL'};
      }finally{activeLoanCheck=()=>{};}
    },
    ...(ordinaryTwoVisit?{
      // Explicit NEW ordinary visit only after successful first native capture.
      // Byte equality correlates DATA, not an authenticated capture capability;
      // the owning runner separately validates actual native journal receipt.
      async advanceToSecondNativeVisit({exactCapturedResponseBytes}){
        assert.equal(ordinaryVisit,1);assert.equal(state,'AWAIT_MAIN_NATIVE_RESPONSE_CAPTURE');
        assert.ok(Buffer.isBuffer(exactCapturedResponseBytes)&&exactCapturedResponseBytes.equals(commitResponse));
        assert.equal(completion.result.status,'closed');assert.equal(start.result.native_start_attested,true);
        const argumentsCopy=JSON.parse(originalArguments.toString('utf8'));
        assert.equal(argumentsCopy.p_response_json.work_result,'full','nonempty priorcleaning must originate in normal FULL writer');
        // Consume this first owner before await; failure is terminal, not retry.
        state='NEXT_VISIT_UNKNOWN';
        activeLoanCheck=()=>{assert.equal(state,'NEXT_VISIT_UNKNOWN');assert.ok(exactCapturedResponseBytes.equals(commitResponse));};
        try{
          const rows=await tx('custodial_application_reader','select * from custodial_release_identity.read_original_scan_completion_v1($1::uuid,$2,$3::uuid,$4::bigint,$5::uuid,$6::jsonb)',[
            ids.device,'KIOSK_08',ids.employee,7,ids.credential,originalArguments.toString('utf8')]);
          assert.equal(rows.length,1);assert.deepEqual(rows[0],completion.readback);
          capturedOrdinaryOriginals.push({start,completion,originalArguments,commitResponse,arguments:argumentsCopy});
          start=null;completion=null;originalArguments=null;commitResponse=null;
          ordinaryVisit=2;state='AWAIT_NATIVE_START';
          return {scope:'SECOND_DISTINCT_ORDINARY_VISIT_NOT_REPLAY',visit:2};
        }finally{activeLoanCheck=()=>{};}
      }
    }:{}),
    close(){state='CLOSED';originalArguments?.fill(0);commitResponse?.fill(0);start?.response.fill(0);
      for(const prior of capturedOrdinaryOriginals){prior.originalArguments.fill(0);prior.commitResponse.fill(0);prior.start.response.fill(0);}}

  });
}

// One NEW native-original -> actual SQL registration -> native response join.
// Only the existing protected qualifier may supply the owning original byte
// loans after its class/source/fixture verification. Test inputs are NOT auth
// capabilities. No receipt, target or completed frame is seeded from JSON.
export async function createSameOriginalNativeRegistrationTestGateway({admin,backendRoot,readOriginalInput,expectedStatusReads=0,expectedManagerPreparationReads=0,expectedOriginalCompletionReads=0,expectedPreparationCycles=1,completeOriginalFrame=false}) {
  assert.deepEqual(Object.keys(arguments[0]).sort(),['admin','backendRoot','readOriginalInput',
    ...(Object.hasOwn(arguments[0],'expectedStatusReads')?['expectedStatusReads']:[]),
    ...(Object.hasOwn(arguments[0],'expectedManagerPreparationReads')?['expectedManagerPreparationReads']:[]),
    ...(Object.hasOwn(arguments[0],'expectedOriginalCompletionReads')?['expectedOriginalCompletionReads']:[]),
    ...(Object.hasOwn(arguments[0],'expectedPreparationCycles')?['expectedPreparationCycles']:[]),
    ...(Object.hasOwn(arguments[0],'completeOriginalFrame')?['completeOriginalFrame']:[])].sort());
  assert.equal(typeof completeOriginalFrame,'boolean');
  if(completeOriginalFrame){assert.equal(expectedStatusReads,0);assert.equal(expectedManagerPreparationReads,0);assert.equal(expectedOriginalCompletionReads,0);assert.equal(expectedPreparationCycles,1);}
  assert.equal(typeof readOriginalInput,'function');
  // Private fixture expectation only: never an authentication or retry flag.
  assert.ok(expectedStatusReads===0||expectedStatusReads===1);
  if(Object.hasOwn(arguments[0],'expectedStatusReads'))assert.equal(arguments[0].expectedStatusReads,expectedStatusReads);
  assert.ok(expectedPreparationCycles===1||expectedPreparationCycles===2);
  if(expectedPreparationCycles===1)assert.ok(expectedManagerPreparationReads===0||expectedManagerPreparationReads===1||expectedManagerPreparationReads===2);
  else{
    // One original registration/approval, two distinct read-only preparation
    // cycles around the native hold. Never a second writer or approval.
    assert.equal(expectedStatusReads,0);assert.equal(expectedManagerPreparationReads,4);assert.equal(expectedOriginalCompletionReads,2);
  }
  assert.ok(expectedStatusReads===0||expectedManagerPreparationReads===0);
  assert.ok(Number.isSafeInteger(expectedOriginalCompletionReads)&&expectedOriginalCompletionReads>=0&&expectedOriginalCompletionReads<=4096);
  const completionJoin=expectedOriginalCompletionReads>0;
  const originalWriteStageSupported=completeOriginalFrame||(completionJoin
    &&expectedManagerPreparationReads===expectedPreparationCycles*2
    &&expectedOriginalCompletionReads===expectedPreparationCycles);
  if(completionJoin)assert.ok(expectedManagerPreparationReads>=1,'completion mode requires the existing signed-manager preparation join first');
  if(expectedManagerPreparationReads===2)assert.ok(completionJoin,'second manager read belongs only to the saved-browser completion join');
  const {pathToFileURL}=await import('node:url'),http=await import('node:http');
  const {default:express}=await import(pathToFileURL(backendRoot+'/node_modules/express/index.js'));
  const exchange=await import(pathToFileURL(backendRoot+'/src/native-private-custody-exchange.js'));
  const completionWire=completionJoin?(await import(pathToFileURL(backendRoot+'/src/same-original-completion-read-wire.js'))).sameOriginalCompletionReadWire:null;
  const recordLimits=(completionJoin||completeOriginalFrame)?(await import(pathToFileURL(backendRoot+'/src/native-private-custody-record.js'))).privateCustodyRecordSyntaxLimits:null;
  const routes=await import(pathToFileURL(backendRoot+'/src/native-private-custody-http-route.js'));
  const {installSameOriginalRecoveryNativeChallengeComposition}=await import(pathToFileURL(backendRoot+'/src/same-original-recovery-native-challenge-composition.js'));
  const {deviceCredentialInternals:credentials}=await import(pathToFileURL(backendRoot+'/src/auth/device-credential-auth.js'));
  const env=Object.freeze({NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'SYNTHETIC_ONLY_HTTP_PIECE_LOCAL_SOURCE_KEY'});
  const secret='SYNTHETIC_LONG_DEVICE_SECRET_SOURCE_OWNER_KIOSK_08';
  const keyId=credentials.deviceCredentialSecretKeyId(env),tokenHash=credentials.tokenHash(secret,env);
  assert.equal(keyId,'86dbf23b4ae9a54d3d032f7b4b2cceb98395add7dc811476257b6bba1ce27778');
  let server,initialized,originals,sourceFacts,ids,registeredParameters,registeredReceipt,firstFailure;
  let originalPrerequisitesTaken=false;
  const connections=new Set(),writeCalls=[],registrationCalls=[],originalPins=[];
  const statusCalls=[];let statusReceipt,registeredOriginalPin,statusHttpStatus=null;
  const preparationCalls=[],preparationReceipts=[],preparationHttpStatuses=[];let preparationReceipt,preparationHttpStatus=null,managerFixture,managerPreparation;
  const completionCalls=[],completionHttpStatuses=[],completionPending=new Set();let originalPieceCount=3;
  // Failure-only public route evidence. Never retain a response body, request
  // identity, SQL data or arbitrary error text. Unknown codes remain null.
  const currentQueryCodes=new Set([
    'native_private_custody_request_invalid','native_private_custody_exact_path_required',
    'native_private_custody_request_aborted','native_private_custody_method_not_allowed',
    'native_private_custody_content_type_invalid','native_private_custody_request_too_large',
    'native_private_custody_body_receive_timeout','native_private_custody_current_query_capture_invalid',
    'native_private_custody_current_query_wire_invalid','native_private_custody_archived_query_proof_invalid',
    'native_private_custody_auth_pending','native_private_custody_complete_frame_pending',
    'native_private_custody_complete_frame_mismatch','native_private_custody_returned_piece_pending',
    'native_private_custody_returned_piece_mismatch',
  ]);
  const boundedCount=n=>Math.min(n,1_000_000);
  const stages={current_query_requests:0,current_query_responses:0,current_query_refusals:0,target_requests:0,challenge_requests:0,status_requests:0,
    ...(completionJoin?{original_completion_requests:0,original_completion_responses:0}:{}),};
  let currentQueryStatus=null,currentQueryCode=null;
  const diagnostic=()=>Object.freeze({
    // Failure-only static code/call-site evidence from the EXISTING gateway.
    // Never expose message text, payloads, SQL values or credentials. A setup
    // refusal must not disappear behind the later generic native 503 result.
    prerequisite_failure:firstFailure?Object.freeze({
      name:/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(firstFailure.name||'')?firstFailure.name:null,
      code:typeof firstFailure.code==='string'&&/^(?:[A-Z0-9]{5}|ERR_ASSERTION|(?:native_private_custody_|native_request_attestation_|device_auth_)[a-z0-9_]{1,100})$/.test(firstFailure.code)?firstFailure.code:null,
      sites:String(firstFailure.stack||'').split('\n').slice(1,7).filter(line=>/^\s+at /.test(line))
    }):null,
    current_query:Object.freeze({http_status:currentQueryStatus,public_error_code:currentQueryCode}),
    ...(completionJoin?{original_completion:Object.freeze({http_statuses:Object.freeze([...completionHttpStatuses]),
      first_failure_code:typeof firstFailure?.code==='string'&&/^(?:[A-Z0-9]{5}|ERR_ASSERTION)$/.test(firstFailure.code)?firstFailure.code:null})}:{}),
    stage_counts:Object.freeze({...stages,original_write_calls:boundedCount(writeCalls.length),registration_calls:boundedCount(registrationCalls.length),status_calls:boundedCount(statusCalls.length),
      ...(completionJoin?{original_completion_calls:boundedCount(completionCalls.length)}:{})}),
  });
  async function role(actor,sql,values=[],readOnly=false) {
    assert.ok(['service_role','custodial_application_reader'].includes(actor));
    await admin.query(readOnly?'begin read only':'begin');
    try{await admin.query('set local role '+actor);const result=await admin.query(sql,values);await admin.query('commit');return result.rows;}
    catch(error){await admin.query('rollback');throw error;}
  }
  const read=sql=>role('custodial_application_reader',sql,[],true);
  const store={findCredential:async id=>(await role('service_role','select * from public.device_auth_credentials where credential_id=$1',[id],true))[0]};
  const headers=owned=>Object.fromEntries(Object.entries({...owned,Authorization:'Device '+ids.credential_id+'.'+secret,
    Origin:'https://localhost','X-Device-Id':'KIOSK_08','X-Memphis-App-Edition':'custodial','Content-Type':'application/json'}).map(([k,v])=>[k.toLowerCase(),v]));
  const writeFields=['p_operation','p_device','p_credential','p_credential_hash','p_credential_key_id','p_generation','p_native_request','p_attestation_digest','p_request_base64','p_binding','p_owner_proof'];
  const originalRpc={async rpc(name,params){
    assert.equal(name,'custodial_private_custody_v1_retain_chunk');assert.deepEqual(Object.keys(params).sort(),writeFields.slice().sort());writeCalls.push(name);
    const rows=await role('service_role','select public.custodial_private_custody_v1_retain_chunk($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid,$7::uuid,$8::text,$9::text,$10::jsonb,$11::jsonb) data',writeFields.map(k=>params[k]));
    return {data:rows[0].data,error:null};
  }};
  const registrationFields=['p_operation','p_device','p_credential','p_credential_hash','p_credential_key_id','p_generation','p_chunk_index','p_original_write_request','p_original_write_body_sha256','p_original_write_attestation_digest','p_native_request','p_native_request_timestamp','p_native_request_body_sha256','p_native_attestation_digest','p_original_utf8'];
  const completionFields=['p_operation','p_device','p_credential','p_credential_hash','p_credential_key_id','p_generation','p_chunk_index','p_native_request','p_request_sha256','p_attestation_digest','p_original_completion_utf8'];
  const registrationRpc={async rpc(name,params){
    if(name==='custodial_same_original_completion_read_v1'){
     try{
      assert.ok(completionJoin);assert.ok(completionCalls.length<expectedOriginalCompletionReads);
      assert.equal(preparationCalls.length,expectedPreparationCycles===2?completionCalls.length*2+1:1);assert.equal(preparationHttpStatus,200);assert.ok(managerFixture);
      assert.equal(registrationCalls.length,1);assert.ok(registeredParameters);
      assert.deepEqual(Object.keys(params).sort(),completionFields.slice().sort());assert.ok(Object.isFrozen(params));
      for(const key of completionFields.slice(0,7))assert.equal(params[key],registeredParameters[key],'completion must use the SAME original target');
      assert.equal(params.p_native_request,registeredParameters.p_original_write_request);
      assert.equal(params.p_request_sha256,registeredParameters.p_original_write_body_sha256);
      assert.equal(params.p_attestation_digest,registeredParameters.p_original_write_attestation_digest);
      const raw=params.p_original_completion_utf8;assert.equal(typeof raw,'string');
      assert.ok(Buffer.byteLength(raw,'utf8')>=1&&Buffer.byteLength(raw,'utf8')<=completionWire.maxOriginalCompletionArgumentBytes);
      const values=Object.freeze(completionFields.map(key=>params[key]));
      const rawSha=createHash('sha256').update(raw,'utf8').digest('hex');
      const call={params,values,rawSha,disposition:null};completionCalls.push(call); // Before await; no retry or fallback.
      const reading=role('custodial_application_reader','select public.custodial_same_original_completion_read_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid,$7::integer,$8::uuid,$9::text,$10::text,$11::text) data',values,true);
      completionPending.add(reading);let rows;
      try{rows=await reading;}
      catch(error){firstFailure??=error;throw error;} // Retain the original owning SQL refusal, never retry/fallback.
      finally{completionPending.delete(reading);}
      assert.deepEqual(completionFields.map(key=>params[key]),values);assert.equal(params.p_original_completion_utf8,raw);
      assert.equal(createHash('sha256').update(raw,'utf8').digest('hex'),rawSha);assert.equal(rows.length,1);
      assert.equal(typeof rows[0].data,'string');assert.ok(Buffer.byteLength(rows[0].data,'utf8')<=65536);
      const observed=JSON.parse(rows[0].data);
      assert.equal(observed.schema,'custodial.same-original-completion-SQL-read.v1');
      assert.equal(observed.state,'CURRENT_EXACT_ORIGINAL_COMPLETION_DISPOSITION_NOT_ACK');
      assert.equal(observed.operation_id,params.p_operation);assert.equal(observed.original_generation_id,params.p_generation);
      assert.equal(observed.argument_values_sha256,rawSha);assert.equal(observed.transaction_authority,false);
      assert.deepEqual(observed.limits,recoveryDeniedEffects);
      assert.ok(['ACCEPTED_EXACT_ORIGINAL','UNRESOLVED_RETAINED'].includes(observed.disposition));
      call.disposition=observed.disposition;
      return {data:rows[0].data,error:null}; // Exact original SQL TEXT; actual store validates before route publication.
     }catch(error){firstFailure??=error;throw error;}
    }
    if(name==='custodial_same_original_current_manager_preparation_v1'){
      assert.ok(preparationCalls.length<expectedManagerPreparationReads);
      if(preparationCalls.length%2===1){
        assert.equal(expectedManagerPreparationReads,expectedPreparationCycles*2);
        const expectedCompleted=expectedPreparationCycles===2?(preparationCalls.length+1)/2:expectedOriginalCompletionReads;
        assert.equal(completionCalls.length,expectedCompleted);
        assert.equal(completionHttpStatuses.length,expectedCompleted);
        for(const status of completionHttpStatuses)assert.equal(status,200);
      }
      assert.equal(registrationCalls.length,1);assert.ok(managerFixture);
      assert.deepEqual(Object.keys(params).sort(),registrationFields.slice().sort());assert.ok(Object.isFrozen(params));
      assert.deepEqual(params,registeredParameters,'preparation must carry all15 ORIGINAL parameter values');
      preparationCalls.push(name); // Consume before await; never resend an unknown read.
      const rows=await role('service_role','select public.custodial_same_original_current_manager_preparation_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid,$7::integer,$8::uuid,$9::text,$10::text,$11::uuid,$12::timestamptz,$13::text,$14::text,$15::text) data',registrationFields.map(k=>params[k]),true);
      assert.deepEqual(params,registeredParameters);assert.equal(typeof rows[0].data,'string');
      preparationReceipt=rows[0].data;
      preparationReceipts.push(preparationReceipt);
      const observed=JSON.parse(preparationReceipt);assert.equal(observed.original_registration_utf8,registeredReceipt);
      assert.equal(observed.transaction_authority,false);assert.deepEqual(observed.limits,recoveryDeniedEffects);
      return {data:preparationReceipt,error:null};
    }
    if(name==='custodial_same_original_preparation_registration_status_v1'){
      assert.equal(expectedStatusReads,1);assert.equal(statusCalls.length,0);
      assert.equal(registrationCalls.length,1);assert.ok(registeredParameters);assert.equal(typeof registeredReceipt,'string');
      assert.deepEqual(Object.keys(params).sort(),registrationFields.slice().sort());assert.ok(Object.isFrozen(params));
      assert.deepEqual(params,registeredParameters,'status must use all15 ORIGINAL parameter values');
      assert.equal(createHash('sha256').update(params.p_original_utf8).digest('hex'),params.p_native_request_body_sha256);
      statusCalls.push(name); // Before await; no second status attempt or writer fallback.
      const rows=await role('service_role','select public.custodial_same_original_preparation_registration_status_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid,$7::integer,$8::uuid,$9::text,$10::text,$11::uuid,$12::timestamptz,$13::text,$14::text,$15::text) data',registrationFields.map(k=>params[k]),true);
      assert.deepEqual(params,registeredParameters);assert.equal(registrationCalls.length,1);
      assert.equal(typeof rows[0].data,'string');assert.equal(rows[0].data,registeredReceipt,'status must return BYTE-EQUAL persisted ORIGINAL receipt');
      statusReceipt=rows[0].data;return {data:statusReceipt,error:null};
    }
    assert.equal(name,'custodial_same_original_preparation_register_v1');assert.equal(registrationCalls.length,0);
    assert.deepEqual(Object.keys(params).sort(),registrationFields.slice().sort());assert.ok(Object.isFrozen(params));
    assert.equal(createHash('sha256').update(params.p_original_utf8).digest('hex'),params.p_native_request_body_sha256);
    registeredParameters=params;registrationCalls.push(name);
    registeredOriginalPin=createHash('sha256').update(JSON.stringify(params)).digest('hex');
    const rows=await role('service_role','select public.custodial_same_original_preparation_register_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid,$7::integer,$8::uuid,$9::text,$10::text,$11::uuid,$12::timestamptz,$13::text,$14::text,$15::text) data',registrationFields.map(k=>params[k]));
    assert.equal(typeof rows[0].data,'string');registeredReceipt=rows[0].data;
    return {data:registeredReceipt,error:null};
  }};
  async function initializeOriginals() {
    // The owning qualifier verifies class/source/files first. This callback
    // returns native-prepared originals, never server receipts or authority.
    const input=await readOriginalInput();({originals,sourceFacts}=input);ids=sourceFacts.separationContext;
    assert.ok(Array.isArray(originals));
    if(!completionJoin&&!completeOriginalFrame)assert.equal(originals.length,3);
    else{
      // Same production frame bound, not a caller count/freshness assertion.
      const maxFrame=recordLimits.record_bytes+8192+4+4+'custodial.native-private-eight-custody-transport-frame.v1'.length*2+4+4+32;
      assert.ok(originals.length>=1&&originals.length<=Math.ceil(maxFrame/recordLimits.chunk_bytes));
      assert.ok(Buffer.isBuffer(originals[0].raw));assert.ok(originals[0].raw.length>=1&&originals[0].raw.length<=393216);
      const first=JSON.parse(originals[0].raw);
      assert.match(first.chunk_count,/^[1-9][0-9]*$/);assert.match(first.frame_bytes,/^[1-9][0-9]*$/);
      originalPieceCount=Number(first.chunk_count);const total=Number(first.frame_bytes);
      assert.ok(Number.isSafeInteger(originalPieceCount)&&Number.isSafeInteger(total)&&total>=1&&total<=maxFrame);
      assert.equal(originalPieceCount,Math.ceil(total/recordLimits.chunk_bytes));assert.equal(originals.length,originalPieceCount);
      // Validate the COMPLETE declared source before the first prerequisite writer.
      // This is DATA closure only; normal private captures below still own auth.
      for(let i=0;i<originalPieceCount;i++){
        const loan=originals[i];assert.ok(Buffer.isBuffer(loan.raw));assert.ok(loan.raw.length>=1&&loan.raw.length<=393216);
        const body=JSON.parse(loan.raw);assert.equal(body.schema,'custodial.original-native-private-custody-write.v1');
        assert.equal(body.chunk_index,String(i));assert.equal(body.chunk_count,first.chunk_count);assert.equal(body.frame_bytes,first.frame_bytes);
        for(const key of ['operation_id','original_generation_id','principal_digest','frame_sha256','record_sha256','plan_sha256'])assert.equal(body[key],first[key]);
      }
    }
    assert.equal(sourceFacts.source_recipe.key_id,keyId);
    assert.equal(sourceFacts.source_recipe.sha256,'167626f8f68c6fb5c3a4f5e3b1c52c02c704199479749b8bc05508a7c817d618');
    const first=JSON.parse(originals[0].raw),generation=sourceFacts.originalGeneration;
    for(const value of [ids.device_id,ids.credential_id,ids.employee_id,generation.generation_id])assert.match(value,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    assert.equal(first.original_generation_id,generation.generation_id);assert.equal(first.principal_digest,generation.principal_digest);
    assert.equal(generation.device_id,ids.device_id);assert.equal(generation.credential_id,ids.credential_id);
    assert.equal(generation.employee_id,ids.employee_id);assert.equal(generation.assignment_epoch,ids.assignment_epoch);
    const currentContext=(await role('custodial_application_reader','select public.custodial_v13_read_separation_context($1::uuid,$2::uuid) context',[ids.device_id,ids.credential_id],true))[0]?.context;
    assert.deepEqual(currentContext,sourceFacts.separationContext,'SQL context must precede and equal native originals');
    const row=await store.findCredential(ids.credential_id);
    assert.equal(row.device_id,ids.device_id);assert.equal(row.token_hash,tokenHash);assert.equal(row.metadata_json.credential_secret_key_id,keyId);
    assert.equal(row.revoked_at,null);assert.ok(row.confirmed_at);
    await admin.query(`insert into public.employee_native_push_generations(generation_id,operation_id,registration_id,device_id,device_identifier,credential_id,employee_id,assignment_epoch,principal_digest,token_digest,native_app,request_fingerprint,first_native_request_id,first_attestation_digest,activated_at,dispatch_retired_at)
      values($1,'99000000-0000-4000-8000-000000000200','99000000-0000-4000-8000-000000000005',$2,'KIOSK_08',$3,$4,7,$5,repeat('b',64),'{"package_name":"org.memphiszoo.custodial","version_name":"synthetic-native-source-SQL-only","version_code":56,"build_id":"native-source-sql.custodial.000000000000"}',repeat('c',64),'99000000-0000-4000-8000-000000000300',repeat('d',64),$6,$7)`,
      [generation.generation_id,ids.device_id,ids.credential_id,ids.employee_id,generation.principal_digest,generation.activated_at,ids.cutoff_at]);
    for(let index=0;index<originalPieceCount;index++){
      const loan=originals[index];assert.ok(Buffer.isBuffer(loan.raw));assert.ok(loan.raw.length>=1&&loan.raw.length<=393216);
      assert.deepEqual(Object.keys(loan.headers).sort(),['X-Memphis-Native-Attestation-Version','X-Memphis-Native-Request-Id','X-Memphis-Native-Request-Timestamp','X-Memphis-Native-Request-Attestation'].sort());
      for(const value of Object.values(loan.headers))assert.equal(typeof value,'string');
      const body=JSON.parse(loan.raw);assert.equal(body.chunk_index,String(index));assert.equal(body.chunk_count,String(originalPieceCount));
      assert.equal(body.operation_id,first.operation_id);assert.equal(body.original_generation_id,first.original_generation_id);assert.equal(body.frame_sha256,first.frame_sha256);
      originalPins.push(createHash('sha256').update(loan.raw).digest('hex'));
      const req={method:'POST',originalUrl:exchange.privateCustodyExchangePath,headers:headers(loan.headers),scanAuthorityRawBody:Buffer.from(loan.raw),body};
      let capture;try{capture=await exchange.captureAuthenticatedPrivateCustodyExchange(req,{env,store,runReadOnlySql:read});
        const written=await exchange.recordAuthenticatedPrivateCustodyExchange(capture,{db:originalRpc,runReadOnlySql:read});assert.equal(written.commit_readback_confirmed,true);
      }finally{exchange.closeAuthenticatedPrivateCustodyExchangeCapture(capture);req.scanAuthorityRawBody.fill(0);}
    }
    assert.equal(writeCalls.length,originalPieceCount);
    const rows=(await admin.query('select (select count(*)::int from public.custodial_native_private_custody_operations) operations,(select count(*)::int from public.custodial_native_private_custody_chunks) chunks,(select count(*)::int from public.custodial_same_original_recovery_challenges) challenges,(select count(*)::int from public.custodial_same_original_recovery_approvals) approvals')).rows[0];
    assert.deepEqual(rows,{operations:1,chunks:originalPieceCount,challenges:0,approvals:0});
  }
  const app=express();
  // One shared setup promise settles actual prerequisite writers BEFORE the
  // first native current-read; no parser, clock or auth implementation swap.
  assert.equal(exchange.sameOriginalRecoveryNativeStatusPath,'/device-auth/same-original-recovery/challenge-status');
  const expectedPaths=[exchange.privateCustodyCurrentQueryPath,exchange.sameOriginalRecoveryTargetPath,exchange.sameOriginalRecoveryNativeChallengePath,exchange.sameOriginalRecoveryNativeStatusPath];
  if(expectedManagerPreparationReads>0)expectedPaths.push(exchange.sameOriginalRecoveryNativePreparationPath);
  if(completionJoin){assert.equal(completionWire.path,'/device-auth/private-custody-original-completion-read');expectedPaths.push(completionWire.path);}
  app.use((req,res,next)=>{
    if(!expectedPaths.includes(req.path))return res.status(404).end();
    const stage=completionJoin&&req.path===completionWire.path?'original_completion_requests':req.path===exchange.privateCustodyCurrentQueryPath?'current_query_requests':
      req.path===exchange.sameOriginalRecoveryTargetPath?'target_requests':
        req.path===exchange.sameOriginalRecoveryNativeChallengePath?'challenge_requests':'status_requests';
    stages[stage]=boundedCount(stages[stage]+1);
    initialized??=initializeOriginals().catch(error=>{firstFailure??=error;throw error;});
    initialized.then(async()=>{
      if(completionJoin&&req.path===completionWire.path){
        assert.ok(stages.original_completion_requests<=expectedOriginalCompletionReads);
        assert.equal(preparationCalls.length,expectedPreparationCycles===2?(stages.original_completion_requests-1)*2+1:1);assert.equal(preparationHttpStatus,200);assert.ok(managerPreparation);
        await managerPreparation; // Existing signed-manager page/SQL path, never seeded approval DATA.
      }
      if(req.path===exchange.sameOriginalRecoveryNativePreparationPath){
        assert.ok(expectedManagerPreparationReads>0);assert.equal(registrationCalls.length,1);
        assert.equal(stages.status_requests,preparationCalls.length+1,'only the next bounded preparation read is admitted');
        assert.ok(stages.status_requests<=expectedManagerPreparationReads);
        // Existing actual signed Source manager route, not a manufactured approval
        // or privileged SQL insertion. It settles before the native read starts.
        managerPreparation??=(async()=>{
          if(!process.argv.includes('--joined-manager-sql-new'))process.argv.push('--joined-manager-sql-new');
          const {createSameOriginalRecoveryManagerSqlFixture}=await import(pathToFileURL(backendRoot+'/scripts/same-original-recovery-manager-composition-tests.mjs'));
          const challengeId=JSON.parse(registeredReceipt).challenge_id;
          managerFixture=await createSameOriginalRecoveryManagerSqlFixture({admin,backendRoot,challengeId});
          const {sameOriginalRecoveryPageHttpSqlJoin}=await import(pathToFileURL(backendRoot+'/../frontend/scripts/same-original-recovery-page-tests.mjs'));
          const page=await sameOriginalRecoveryPageHttpSqlJoin({request:managerFixture.request,currentOwner:managerFixture.currentOwner,challengeId});
          const sql=await managerFixture.finish();
          assert.equal(page.confirmation_count,1);assert.equal(page.original_rows_retained,true);
          return Object.freeze({...sql,page});
        })();
        await managerPreparation;
      }
      next();
    }).catch(error=>{firstFailure??=error;res.status(503).json({ok:false,outcome:'UNKNOWN',retry_safe:false,limits:recoveryDeniedEffects});});
  });
  // Install only after prerequisite settlement: these are the actual current
  // query route's responses, not an initialization error mislabelled as one.
  app.use((req,res,next)=>{
    if(req.path===exchange.sameOriginalRecoveryNativeStatusPath||req.path===exchange.sameOriginalRecoveryNativePreparationPath
      ||completionJoin&&req.path===completionWire.path){
      const settle=()=>{
        if(res.writableFinished&&res.headersSent){
          if(completionJoin&&req.path===completionWire.path){completionHttpStatuses.push(res.statusCode);stages.original_completion_responses=boundedCount(stages.original_completion_responses+1);}
          else if(req.path===exchange.sameOriginalRecoveryNativePreparationPath){preparationHttpStatus=res.statusCode;preparationHttpStatuses.push(res.statusCode);}
          else statusHttpStatus=res.statusCode;
        }
        res.off('finish',settle);res.off('close',settle);
      };
      res.once('finish',settle);res.once('close',settle);return next();
    }
    if(req.path!==exchange.privateCustodyCurrentQueryPath)return next();
    const originalJson=res.json;let publicCode=null,settled=false;
    const observeJson=function(body){
      if(res.statusCode>=400){
        const descriptor=body&&typeof body==='object'?Object.getOwnPropertyDescriptor(body,'error'):null;
        if(descriptor&&Object.hasOwn(descriptor,'value')&&currentQueryCodes.has(descriptor.value))publicCode=descriptor.value;
      }
      return originalJson.call(this,body);
    };
    const settle=()=>{
      if(settled)return;settled=true;
      const status=res.headersSent&&Number.isInteger(res.statusCode)&&res.statusCode>=100&&res.statusCode<=599?res.statusCode:null;
      stages.current_query_responses=boundedCount(stages.current_query_responses+1);
      if(status!==null&&status>=400){
        if(stages.current_query_refusals===0){currentQueryStatus=status;currentQueryCode=publicCode;}
        stages.current_query_refusals=boundedCount(stages.current_query_refusals+1);
      }else if(stages.current_query_refusals===0)currentQueryStatus=status;
      res.off('finish',settle);res.off('close',settle);
      if(res.json===observeJson)res.json=originalJson;
    };
    res.json=observeJson;res.once('finish',settle);res.once('close',settle);next();
  });
  routes.installNativePrivateCustodyCurrentQueryRoute(app,{env,store,runReadOnlySql:read});
  const target=routes.installSameOriginalRecoveryTargetRoute(app,{env,store,runReadOnlySql:read});
  assert.ok(expectedPaths.includes(target.path),'actual fixed target path must match admitted gateway');
  const challenge=installSameOriginalRecoveryNativeChallengeComposition(app,{env,store,runReadOnlySql:read,db:registrationRpc});
  server=http.createServer(app);server.on('connection',connection=>{connections.add(connection);connection.on('close',()=>connections.delete(connection));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
  async function finishChecked() {
    if(firstFailure)throw firstFailure;await initialized;
    assert.equal(writeCalls.length,originalPieceCount);assert.equal(registrationCalls.length,1);assert.ok(registeredParameters);assert.equal(typeof registeredReceipt,'string');
    assert.equal(statusCalls.length,expectedStatusReads);assert.equal(stages.status_requests,expectedStatusReads+expectedManagerPreparationReads);
    assert.equal(preparationCalls.length,expectedManagerPreparationReads);
    if(completionJoin){
      assert.equal(completionCalls.length,expectedOriginalCompletionReads);assert.equal(stages.original_completion_requests,expectedOriginalCompletionReads);
      assert.equal(stages.original_completion_responses,expectedOriginalCompletionReads);assert.equal(completionHttpStatuses.length,expectedOriginalCompletionReads);
      for(const status of completionHttpStatuses)assert.equal(status,200,'actual original-completion route must finish HTTP200');
      for(const call of completionCalls){
        assert.deepEqual(completionFields.map(key=>call.params[key]),call.values);
        assert.equal(createHash('sha256').update(call.params.p_original_completion_utf8,'utf8').digest('hex'),call.rawSha);
        assert.ok(['ACCEPTED_EXACT_ORIGINAL','UNRESOLVED_RETAINED'].includes(call.disposition));
      }
    }
    if(expectedManagerPreparationReads>0){
      assert.equal(preparationHttpStatus,200);assert.ok(preparationReceipt);await managerPreparation;
      assert.equal(preparationHttpStatuses.length,expectedManagerPreparationReads);
      for(const status of preparationHttpStatuses)assert.equal(status,200);
      assert.equal(preparationReceipts.length,expectedManagerPreparationReads);
      // Owner-only fixture diagnostic, not application authority or a read fallback.
      const approval=(await admin.query('select receipt_utf8 from public.custodial_same_original_recovery_approvals where challenge_id=$1::uuid',[JSON.parse(registeredReceipt).challenge_id])).rows;
      assert.equal(approval.length,1);
      for(const receipt of preparationReceipts)assert.equal(JSON.parse(receipt).original_approval_receipt_utf8,approval[0].receipt_utf8,'each preparation preserves BYTE-EQUAL original manager receipt');
    }
    if(expectedStatusReads===1)assert.equal(statusHttpStatus,200,'current native status route must finish HTTP200');
    assert.equal(createHash('sha256').update(JSON.stringify(registeredParameters)).digest('hex'),registeredOriginalPin,'ORIGINAL body/time/attestation parameters must remain unchanged');
    const receipt=JSON.parse(registeredReceipt);assert.equal(receipt.retry_safe,false);assert.deepEqual(receipt.limits,recoveryDeniedEffects);
    const original=completionJoin?JSON.parse(preparationReceipt).original_registration_utf8:expectedStatusReads===1?statusReceipt:(await role('service_role','select public.custodial_same_original_preparation_registration_status_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid,$7::integer,$8::uuid,$9::text,$10::text,$11::uuid,$12::timestamptz,$13::text,$14::text,$15::text) original',registrationFields.map(k=>registeredParameters[k]),true))[0].original;
    assert.equal(original,registeredReceipt,'fixed status must preserve exact persisted original receipt text');
    const after=(await admin.query('select (select count(*)::int from public.custodial_native_private_custody_operations) operations,(select count(*)::int from public.custodial_native_private_custody_chunks) chunks,(select count(*)::int from public.custodial_same_original_recovery_challenges) challenges,(select count(*)::int from public.custodial_same_original_recovery_approvals) approvals')).rows[0];
    assert.deepEqual(after,{operations:1,chunks:originalPieceCount,challenges:1,approvals:expectedManagerPreparationReads>0?1:0});
    originals.forEach((x,i)=>assert.equal(createHash('sha256').update(x.raw).digest('hex'),originalPins[i]));
    assert.equal(createHash('sha256').update(JSON.stringify(registeredParameters)).digest('hex'),registeredOriginalPin);
    return {checks:[(completionJoin||completeOriginalFrame)?'all same-original bounded native retention prerequisites':'three real original retention prerequisites','actual SQL-backed native current-frame and target route','one SQL registration through native HTTP','fixed original SQL status receipt text',
      ...(completionJoin?['fixed exact11 TEXT completion read through intended READ ONLY role after signed-manager preparation']:[])],after,receipt,
      native_request_body_sha256:registeredParameters.p_native_request_body_sha256,native_request_id:registeredParameters.p_native_request,native_timestamp:registeredParameters.p_native_request_timestamp,
      ...(expectedStatusReads===1?{native_status_reads:statusCalls.length}:{}),
      ...(expectedManagerPreparationReads>0?{native_manager_preparation_reads:preparationCalls.length,manager_preparation:JSON.parse(preparationReceipt),manager_SQL:await managerPreparation}:{}),
      ...(completionJoin?{native_original_completion_reads:completionCalls.length,original_piece_count:originalPieceCount,
        original_completion_dispositions:completionCalls.map(call=>call.disposition)}:{}),
      scope:completionJoin?'NEW_NATIVE_SAME_ORIGINAL_COMPLETION_READ_ACTUAL_SQL_AFTER_SOURCE_MANAGER_PREPARATION_NOT_ANDROID_TLS_OR_REAL_MANAGER':expectedManagerPreparationReads===1?'NEW_NATIVE_SAVED_ORIGINAL_CURRENT_SIGNED_SOURCE_MANAGER_PREPARATION_ACTUAL_SQL_NOT_ANDROID_TLS_OR_REAL_MANAGER':'NEW_NATIVE_LOOPBACK_HTTP_ACTUAL_SQL_REGISTRATION_ORIGINAL_STATUS_NOT_ANDROID_TLS_OR_MANAGER',actual_SQL:true,actual_loopback_HTTP:true,real_manager:false,Android:false,ACK:false,finalizer:false,key_removal:false};
  }
  async function finish() {
    try{return await finishChecked();}
    catch(error){
      // Preserve the original assertion/prerequisite error and stack. Main's
      // qualifier may serialize ONLY this closed metadata property separately.
      Object.defineProperty(error,'native_gateway_diagnostic',{value:diagnostic(),enumerable:true,configurable:true});
      throw error;
    }
  }
  async function close(){for(const connection of connections)connection.destroy();if(initialized)await initialized.catch(()=>{});if(managerPreparation)await managerPreparation.catch(()=>{});if(completionJoin)await Promise.allSettled([...completionPending]);await managerFixture?.close();if(server?.listening)await new Promise(resolve=>server.close(resolve));}
  async function settleOriginalPrerequisites(){
    // The cumulative and its selected pre-hold lease-pair fixture consume the
    // SAME one-shot original-write stage. Expected read counts stay exact.
    // Admit the SAME prepared live WRITE packets while still fresh, before
    // unrelated native QUERY checks. Normal auth/RPC/bytes are not replaced.
    assert.equal(originalWriteStageSupported,true);assert.equal(originalPrerequisitesTaken,false);
    assert.equal(initialized,undefined);assert.equal(stages.current_query_requests,0);
    assert.equal(writeCalls.length,0);assert.equal(registrationCalls.length,0);
    originalPrerequisitesTaken=true;
    initialized=initializeOriginals().catch(error=>{firstFailure??=error;throw error;});
    await initialized;if(firstFailure)throw firstFailure;
    assert.equal(writeCalls.length,originalPieceCount);assert.equal(registrationCalls.length,0);
    assert.equal(stages.current_query_requests,0);return originalPieceCount;
  }
  return Object.freeze({origin:'http://127.0.0.1:'+server.address().port,challengePath:challenge.path,statusPath:exchange.sameOriginalRecoveryNativeStatusPath,
    ...(expectedManagerPreparationReads>0?{managerPreparationPath:exchange.sameOriginalRecoveryNativePreparationPath}:{}),
    ...(completionJoin?{originalCompletionPath:completionWire.path}:{}),
    ...(originalWriteStageSupported?{settleOriginalPrerequisites}:{}),finish,close,diagnostic});
}

// NEW274 only; 273 is reconstructed as schema, never its old seven test groups.
export async function qualifySameOriginalRegistrationStatusDatabase({admin,backendRoot}) {
  await admin.query(readFileSync(backendRoot+'/supabase/migrations/20261014031928_same_original_native_registration_status.sql','utf8'));
  const checks=[],name='custodial_same_original_preparation_registration_status_v1';
  const rows=(await admin.query(`select p.provolatile stable,p.prosecdef definer,p.proconfig,
    has_function_privilege('service_role',p.oid,'EXECUTE') service,
    has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
    has_function_privilege('custodial_application_reader',p.oid,'EXECUTE') reader,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public
    from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=$1`,[name])).rows;
  assert.equal(rows.length,1);const row=rows[0];assert.equal(row.stable,'s');assert.equal(row.definer,true);
  assert.deepEqual(row.proconfig,['search_path=""']);assert.equal(row.service,true);
  for(const k of ['anon','authenticated','reader','public'])assert.equal(row[k],false);
  checks.push('NEW274 fixed STABLE original-status wrapper compiles with empty search path and service-only execution');
  const id='97000000-0000-4000-8000-000000000001',sha='a'.repeat(64),raw='{}';
  const args=[id,id,id,sha,sha,id,0,id,sha,sha,id,new Date(),createHash('sha256').update(raw).digest('hex'),sha,raw];
  const sql='select public.'+name+'($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid,$7::integer,$8::uuid,$9::text,$10::text,$11::uuid,$12::timestamptz,$13::text,$14::text,$15::text) original';
  async function refused(role,values,code){await admin.query('begin');try{await admin.query('set local role '+role);await assert.rejects(()=>admin.query(sql,values),{code});}finally{await admin.query('rollback');}}
  await refused('custodial_application_reader',args,'42501');checks.push('NEW274 actual ordinary reader cannot inspect private native registration status');
  const changed=args.slice();changed[12]='b'.repeat(64);await refused('service_role',changed,'22023');checks.push('NEW274 intended status caller cannot substitute another original UTF8 body digest');
  await refused('service_role',args,'42501');checks.push('NEW274 actual current original credential reader refuses nonexistent credential before historical status lookup');
  const retained=(await admin.query('select (select count(*) from public.custodial_same_original_recovery_challenges) challenges,(select count(*) from public.custodial_same_original_recovery_approvals) approvals')).rows[0];
  assert.equal(Number(retained.challenges),0);assert.equal(Number(retained.approvals),0);
  checks.push('NEW274 denied status reads create ZERO challenge/approval rows and never call registration writer');
  return {checks,acl:rows,rows:retained,scope:'NEW274_ACTUAL_LOCAL_SQL_STATUS_NO_AUTHORITY_FLOOR',
    positive_original_status:false,actual_native_capture:false,real_manager:false,HTTP:false,ACK:false,removal:false,
    limits:'No historical original registration receipt exists in this negative-only fixture; positive loss/readback and original expiry preservation still require actual registered source.'};
}

// NEW272/273 only. All271 predecessors are schema setup, not old test replay.
// No synthetic input below can satisfy a native capture/positive registration.
export async function qualifySameOriginalRegistrationDatabase({admin,backendRoot}) {
  for (const name of ['20261014010337_same_original_recovery_target_read.sql','20261014024357_same_original_native_challenge_registration.sql'])
    await admin.query(readFileSync(backendRoot+'/supabase/migrations/'+name,'utf8'));
  const checks=[];
  const acl=(await admin.query(`select p.proname,has_function_privilege('service_role',p.oid,'EXECUTE') service,
    has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
    has_function_privilege('custodial_application_reader',p.oid,'EXECUTE') reader,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public
    from pg_proc p where p.pronamespace='public'::regnamespace
    and p.proname in('custodial_same_original_preparation_target_v1','custodial_same_original_preparation_register_v1') order by p.proname`)).rows;
  assert.equal(acl.length,2);for(const row of acl){assert.equal(row.service,true);assert.equal(row.reader,row.proname.endsWith('target_v1'));assert.equal(row.anon,false);assert.equal(row.authenticated,false);assert.equal(row.public,false);}
  checks.push('NEW272/273 actual SQL compiles; exact target-read and private registration wrapper ACLs');
  const id='96000000-0000-4000-8000-000000000001',sha='a'.repeat(64);
  const target=Object.fromEntries(recoveryTargetFields.map(key=>[key,
    ['operation_id','separation_id','canonical_device_pk','employee_id','credential_id','original_generation_id'].includes(key)?id:
    ['assignment_epoch','separation_authority_revision'].includes(key)?'7':key==='engine_revision'?'0':key==='canonical_device_id'?'KIOSK_08':sha]));
  const raw=JSON.stringify({schema:'custodial.same-original-recovery-native-challenge.v1',purpose:recoveryPreparationPurpose,
    current_original_query_envelope_base64:'e30=',native_challenge_intent_id:id,native_challenge_intent_record_sha256:sha,
    original_target:target,original_target_sha256:recoveryDocumentSha256('target',target)});
  const args=[id,id,id,sha,sha,id,0,id,sha,sha,id,new Date(),createHash('sha256').update(raw).digest('hex'),sha,raw];
  const sql='select public.custodial_same_original_preparation_register_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid,$7::integer,$8::uuid,$9::text,$10::text,$11::uuid,$12::timestamptz,$13::text,$14::text,$15::text) receipt';
  async function refused(role,values,code){await admin.query('begin');try{await admin.query('set local role '+role);await assert.rejects(()=>admin.query(sql,values),{code});}finally{await admin.query('rollback');}}
  await refused('custodial_application_reader',args,'42501');checks.push('NEW actual reader cannot invoke registration writer');
  const invalid=args.slice();invalid[6]=1;await refused('service_role',invalid,'22023');checks.push('NEW fixed chunk-zero input enforced through intended service caller');
  const changed=args.slice();changed[12]='b'.repeat(64);await refused('service_role',changed,'22023');checks.push('NEW exact original UTF8 digest mismatch refused');
  await refused('service_role',args,'P0002');checks.push('NEW intended service caller cannot create challenge from nonexistent current credential');
  await assert.rejects(()=>admin.query(`insert into public.custodial_same_original_recovery_challenges
    (challenge_id,operation_id,target_sha256,original_target,challenge_sha256,preview_sha256,preview_utf8,native_challenge_request_sha256,registered_at,expires_at)
    values($1,$1,$2,$3::jsonb,$2,$2,'{}',$2,clock_timestamp(),clock_timestamp()+interval '1 minute')`,[id,sha,JSON.stringify(target)]),{code:'42501'});
  checks.push('NEW ALWAYS insert guard rejects legacy-shaped challenge without original native registration provenance');
  const rows=(await admin.query('select (select count(*) from public.custodial_same_original_recovery_challenges) challenges,(select count(*) from public.custodial_same_original_recovery_approvals) approvals')).rows[0];
  assert.equal(Number(rows.challenges),0);assert.equal(Number(rows.approvals),0);checks.push('NEW denied calls preserve ZERO challenge and approval rows');
  return {checks,acl,rows,scope:'NEW272_273_ACTUAL_LOCAL_SQL_INPUT_AND_NO_AUTHORITY_FLOOR',positive_registration:false,
    positive_target_read:false,actual_native_capture:false,real_manager:false,HTTP:false,ACK:false,removal:false,
    limits:'Negative-only new transaction floor. Positive retained original target, native new-purpose capture, original registration/status/manager workflow and G08 remain unqualified.'};
}

// Called only by the existing protected cached-image qualifier. No controller,
// Docker/client/permission fallback, native challenge or real manager is added.
export async function qualifySameOriginalPreparationDatabase({admin,backendRoot}) {
  const migration=backendRoot+'/supabase/migrations/20261014000624_same_original_recovery_preparation.sql';
  const source=readFileSync(migration),sourceSha=createHash('sha256').update(source).digest('hex');
  await admin.query(source.toString('utf8'));
  const checks=[];
  const rpcNames=['custodial_same_original_preparation_issue_v1','custodial_same_original_preparation_status_v1','custodial_same_original_preparation_preview_v1'];
  const acl=(await admin.query(`select p.proname,has_function_privilege('service_role',p.oid,'EXECUTE') intended,
    has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
    has_function_privilege('custodial_application_reader',p.oid,'EXECUTE') reader,
    has_function_privilege('static_weekly_control_plane',p.oid,'EXECUTE') control_plane,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public
    from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=any($1::text[]) order by p.proname`,[rpcNames])).rows;
  assert.equal(acl.length,3);for(const row of acl){assert.equal(row.intended,true);for(const key of ['anon','authenticated','reader','control_plane','public'])assert.equal(row[key],false);}
  checks.push('NEW exact three intended service-only RPC ACLs; public/client/reader/control-plane EXECUTE denied');
  const tables=(await admin.query(`select relname,relrowsecurity rls,relforcerowsecurity forced,
    has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') service,
    has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon,
    has_table_privilege('custodial_application_reader',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') reader,
    (select count(*) from pg_trigger t where t.tgrelid=c.oid and t.tgenabled='A' and not t.tgisinternal) always_guards
    from pg_class c where c.oid in('public.custodial_same_original_recovery_challenges'::regclass,'public.custodial_same_original_recovery_approvals'::regclass)`)).rows;
  assert.equal(tables.length,2);for(const row of tables){assert.equal(row.rls,true);assert.equal(row.forced,true);assert.equal(row.service,false);assert.equal(row.anon,false);assert.equal(row.reader,false);assert.equal(Number(row.always_guards),2);}
  checks.push('NEW private FORCE-RLS ledgers have no runtime direct CRUD and retain two ALWAYS immutability guards each (catalogue proof only)');
  const id='95000000-0000-4000-8000-000000000001',sha='a'.repeat(64);
  const target=Object.fromEntries(recoveryTargetFields.map(key=>[key,
    ['operation_id','separation_id','canonical_device_pk','employee_id','credential_id','original_generation_id'].includes(key)?id:
    ['assignment_epoch','separation_authority_revision'].includes(key)?'7':key==='engine_revision'?'0':key==='canonical_device_id'?'KIOSK_08':sha]));
  const preview={schema:'custodial.same-original-recovery-review.v1',state:'ORIGINAL_BINDING_REVIEW_ONLY',purpose:recoveryPreparationPurpose,
    challenge_id:id,challenge_sha256:sha,preview_sha256:sha,original_target:target,expires_at:'2026-10-14T00:05:00.000000Z',limits:recoveryDeniedEffects};
  preview.preview_sha256=recoveryDocumentSha256('preview',preview);
  const request={schema:'custodial.same-original-recovery-approval-request.v1',request_id:id,challenge_id:id,expected_challenge_sha256:sha,
    expected_preview_sha256:preview.preview_sha256,expected_manager_id:id,expected_manager_credential_id:id,expected_manager_device_id:'manager-fixture',
    decision:recoveryPreparationPurpose,manager_confirmation:'CONFIRM_THIS_SAME_ORIGINAL_ONLY'};
  for(const [kind,value] of [['target',target],['request',request],['preview',preview]]) {
    const actual=(await admin.query('select custodial_recovery.document_digest($1,$2::jsonb) digest',[kind,JSON.stringify(value)])).rows[0].digest;
    assert.equal(actual,recoveryDocumentSha256(kind,value));
  }
  checks.push('NEW actual SQL purpose-local target/request/preview encoding has exact Node wire digest parity');
  const manager=(await admin.query("select * from public.ops_manager_managers where system_key='eric_custodial_manager' and active and revoked_at is null and not is_system_principal")).rows;
  assert.equal(manager.length,1);assert.ok(manager[0].roles.includes('SECURITY_ADMIN'));
  const managerId=manager[0].manager_id,credential=randomUUID(),security=randomUUID(),device='synthetic-g08-local-'+randomUUID();
  await admin.query(`insert into public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,created_at,expires_at)
    values($1,$2,'SYNTHETIC G08 LOCAL FIXTURE',$3,'full_access',$4,clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 day')`,[credential,device,sha,managerId]);
  await admin.query(`insert into public.ops_manager_device_security_config(singleton,password_hash,password_version) values(true,$1,1)
    on conflict(singleton) do nothing`,['SYNTHETIC local unrecoverable password hash '+sha]);
  const version=(await admin.query('select password_version from public.ops_manager_device_security_config where singleton')).rows[0].password_version;
  await admin.query(`insert into public.ops_manager_device_security_sessions(session_id,manager_id,credential_id,token_hash,csrf_hash,password_version,created_at,expires_at)
    values($1,$2,$3,$4,$5,$6,clock_timestamp()-interval '1 second',clock_timestamp()+interval '10 minutes')`,[security,managerId,credential,'b'.repeat(64),'c'.repeat(64),version]);
  const expires=(await admin.query("select clock_timestamp()+interval '2 minutes' value")).rows[0].value;
  const args=[managerId,credential,device,expires,security,version,'b'.repeat(64),'c'.repeat(64)];
  const invocation='select custodial_recovery.assert_current_manager($1::uuid,$2::uuid,$3::text,$4::timestamptz,$5::uuid,$6::integer,$7::text,$8::text) expiry';
  const authorized=(await admin.query(invocation,args)).rows[0].expiry;
  assert.ok(authorized.getTime()<=expires.getTime());assert.ok(authorized.getTime()>Date.now());
  checks.push('NEW actual manager/credential/password-session SQL row checks return minimum original signed-session ceiling; synthetic session pins, NOT signed human authentication');
  for(const [name,index,value] of [['expired signed session',3,new Date(0)],['changed password version',5,Number(version)+1],['foreign CSRF pin',7,'d'.repeat(64)]]) {
    const changed=args.slice();changed[index]=value;await assert.rejects(()=>admin.query(invocation,changed),{code:'42501'});checks.push('NEW SQL refuses '+name);
  }
  await admin.query('begin');
  try {
    await admin.query("update public.ops_manager_trusted_devices set revoked_at=clock_timestamp() where credential_id=$1",[credential]);
    await assert.rejects(()=>admin.query(invocation,args),{code:'42501'});
  } finally {await admin.query('rollback');}
  checks.push('NEW SQL current trusted credential revocation refuses without modifying original fixture credential');
  await admin.query('begin');
  try {
    await admin.query('set local role custodial_application_reader');
    await assert.rejects(()=>admin.query('select public.custodial_same_original_preparation_preview_v1($1,$2,$3,$4,$5,$6,$7,$8,$9)',[...args,id]),{code:'42501'});
  } finally {await admin.query('rollback');}
  checks.push('NEW actual intended-reader invocation denied at normal RPC permission boundary, no fallback');
  const absent={...request,expected_manager_id:managerId,expected_manager_credential_id:credential,expected_manager_device_id:device};
  await admin.query('begin');
  try {
    await admin.query('set local role service_role');
    const result=await admin.query('select public.custodial_same_original_preparation_status_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) original',[...args,JSON.stringify(absent)]);
    assert.equal(result.rows[0].original,null);
  } finally {await admin.query('rollback');}
  const rows=(await admin.query('select (select count(*) from public.custodial_same_original_recovery_challenges) challenges,(select count(*) from public.custodial_same_original_recovery_approvals) approvals')).rows[0];
  assert.equal(Number(rows.challenges),0);assert.equal(Number(rows.approvals),0);
  checks.push('NEW actual service-role original-status miss is null and creates ZERO challenge/approval rows');
  return {sourceSha,checks,acl,tables,rows,scope:'ACTUAL_ISOLATED_SQL_NEW_PRIVATE_LEDGER_ACL_ENCODING_AND_CURRENT_MANAGER_FLOOR',
    positive_preparation_issue:false,native_challenge_registered:false,real_manager:false,HTTP:false,ACK:false,removal:false,
    limits:'Challenge producer/credential provenance and positive issue/lost-response/revocation native claim remain unqualified. No original native/manager approval or whole G08/A2 credit.'};
}
