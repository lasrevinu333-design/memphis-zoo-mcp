import {randomUUID} from 'node:crypto';

// Runs inside the owning no-network/no-default-grants database fixture. All
// times/profile identifiers are deliberately synthetic, never qualification.
export function nativeIntervalDatabaseCases({sql,q,j,check,reject,credential,credentialHash,body,at,event,batch,query,payload,observation}){
 const unknown=observation(null,100,1),result=e=>JSON.parse(sql('begin;'+query(batch([e]))+'rollback;')).data.results[0];
 for(const [name,earliest,latest] of [
  ['reservation straddle','2026-10-02T15:00:00.123455Z','2026-10-02T15:00:00.123457Z'],
  ['expiry straddle',payload.valid_until.replace(/123456Z$/,'123455Z'),payload.valid_until],
  ['exact expiry',payload.valid_until,payload.valid_until]]){
  const e=event('received',{original_observation:unknown,admission_bounds:observation(earliest,150,1,latest)});
  check(name+' does not admit',result(e).code,'native_provider_observation_invalid');
 }
 const lower=event('received',{original_observation:unknown,admission_bounds:observation(payload.reservation_at)});
 check('reservation equality admits only with latest strictly before expiry',result(lower).admitted_state,'ACCEPTED');
 for(const [name,o] of [
  ['partial null',{...unknown,latest_at:at}],['unknown profile',{...unknown,clock_profile_id:'claimed'}],
  ['inverted',observation('2026-10-02T15:00:02.123457Z',150,1,'2026-10-02T15:00:02.123456Z')],
  ['missing profile',{...observation(at),clock_profile_id:null}],['unbounded profile',{...observation(at),clock_profile_id:'a'.repeat(129)}],
  ['noninteger counter',{...observation(at),elapsed_realtime_ms:1.5}],['point schema',{authenticated_at:at,elapsed_realtime_ms:1,boot_count:1}]])
  reject('interval exact wire '+name,query(batch([event('received',{original_observation:o})])));
 reject('old point batch is not a fallback',query({schema:'custodial.native-provider-events.v1',events:[event('received')]}));
 const input={schema:'custodial.native-provider-inventory-request.v1',scan_id:randomUUID(),device_id:body.device_id,credential_id:credential,
  employee_id:body.employee_id,assignment_epoch:body.assignment_epoch,principal_digest:body.principal_digest,generation_ids:[body.generation_id],
  limit:32,cursor:null,ceiling:null,server_now:null};
 const firstNonce=randomUUID(),secondNonce=randomUUID(),sample1='2026-10-02T15:00:01.123456Z',sample2='2026-10-02T15:00:02.123456Z';
 const call=(request,nonce,clock=sample1,time=at)=>'select public.custodial_native_provider_inventory_clock_at('+[q(credential),q(credentialHash),q(nonce),q('b'.repeat(64)),j(request),q(time),q(clock)].join(',')+');';
 const first=JSON.parse(sql(call(input,firstNonce)));
 check('fresh inventory clock echoes original HTTP nonce',first.clock.native_request_id,firstNonce);
 check('fresh inventory clock differs from frozen scan time',first.clock.server_now===sample1&&first.data.server_now===at,true);
 check('inventory maximum horizon is fifteen minutes policy only',first.clock.valid_until,'2026-10-02T15:15:01.123456Z');
 const next={...input,cursor:first.data.cursor,ceiling:first.data.ceiling,server_now:first.data.server_now};
 const second=JSON.parse(sql(call(next,secondNonce,sample2)));
 check('next page freezes scan time while response clock advances',second.data.server_now===first.data.server_now&&second.clock.server_now===sample2&&second.clock.native_request_id===secondNonce,true);
 const replay=JSON.parse(sql(call(input,randomUUID(),sample2)));
 check('response-loss retry keeps exact original scan and first rows',JSON.stringify(replay.data)===JSON.stringify(first.data),true);
 const badCursor={...next,cursor:{reservation_at:at,job_id:randomUUID()}};
 const restart=JSON.parse(sql(call(badCursor,randomUUID(),sample2)));
 check('cursor rejection contains no clock authority',restart.ok===false&&!Object.hasOwn(restart,'clock'),true);
 reject('response sample cannot precede inventory authority check',call(input,randomUUID(),'2026-10-02T14:59:59.999999Z'),/native inventory clock unavailable/);
 reject('revoked credential cannot obtain fresh sample','begin;update public.device_auth_credentials set revoked_at='+q(at)+' where credential_id='+q(credential)+';'+call(input,randomUUID())+'rollback;',/current inventory credential required/);
 reject('expired credential cannot obtain fresh sample','begin;update public.device_auth_credentials set expires_at='+q(sample1)+' where credential_id='+q(credential)+';'+call(input,randomUUID())+'rollback;',/native inventory clock unavailable/);
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']){
  reject(role+' denied inventory clock test seam','set role '+role+';'+call(input,randomUUID()),/permission denied/);
  reject(role+' denied interval helper','set role '+role+';select public.custodial_native_provider_interval_observation('+j(unknown)+',false);',/permission denied/);
  reject(role+' denied chronology helper','set role '+role+';select public.custodial_native_provider_observation_order('+j(unknown)+','+j(unknown)+');',/permission denied/);
  if(role!=='service_role')reject(role+' denied fresh inventory wrapper','set role '+role+';select public.custodial_native_provider_inventory_clock('+[q(credential),q(credentialHash),q(randomUUID()),q('b'.repeat(64)),j(input)].join(',')+');',/permission denied/);
 }
 return {input,first,firstNonce,next,second,secondNonce,replay,restart};
}
