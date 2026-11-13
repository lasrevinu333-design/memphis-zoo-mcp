import assert from 'node:assert/strict';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import http from 'node:http';
import express from 'express';
import {installLocalEnrollmentRetentionRoute,localEnrollmentRetentionWire as W,localEnrollmentRetentionFields as F} from '../src/native-local-enrollment-retention.js';
import {authenticateDeviceCredentialRequest} from '../src/auth/device-credential-auth.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
export async function qualifyLocalEnrollmentRetentionSqlJoin({admin,target,receipt,secret,nativeId,manifest_sha256,manager}){
 const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'SYNTHETIC_ONLY_HTTP_PIECE_LOCAL_SOURCE_KEY'};
 async function role(actor,sql,values=[],readonly=true){await admin.query(readonly?'begin read only':'begin');try{await admin.query('set local role '+actor);const r=await admin.query(sql,values);await admin.query('commit');return r.rows;}catch(e){await admin.query('rollback');throw e;}}
 const approvals=(await admin.query('select * from public.custodial_original_inventory_separation_approvals where approval_id=$1',[receipt.approval_id])).rows;
 assert.equal(approvals.length,1);assert.deepEqual(approvals[0].original_target,target);assert.equal(approvals[0].inventory_native_request_id,nativeId);assert.equal(approvals[0].manifest_sha256,manifest_sha256);
 assert.equal(manager.manager_id,approvals[0].manager_id);
 const originalCredential=(await admin.query('select * from public.device_auth_credentials where credential_id=$1',[target.credential_id])).rows[0];assert.ok(originalCredential);assert.equal(originalCredential.revoked_at,null);
 const before=(await admin.query("select (select count(*)::int from public.sessions) sessions,(select count(*)::int from public.completion_responses) completions,(select count(*)::int from public.custodial_native_private_custody_operations) original_operations,(select count(*)::int from public.custodial_native_private_custody_chunks) original_chunks")).rows[0];
 const employee=randomUUID();await admin.query("insert into public.employees(id,employee_code,display_name,role,active) values($1,'EMP909','Synthetic next employee local-preservation fixture','staff',true)",[employee]);
 const assign=()=>admin.query('select public.custodial_assign_employee_device($1::text,$2::uuid,$3::uuid,$4::text,$5::boolean,$6::boolean,$7::uuid) data',[target.canonical_device_id,employee,manager.manager_id,'Synthetic returned-phone preserved-original assignment',false,true,target.employee_id]);
 await assert.rejects(assign,e=>e.code==='42501');
 assert.equal((await admin.query('select assigned_employee_id from public.devices where id=$1',[target.canonical_device_pk])).rows[0].assigned_employee_id,target.employee_id);
 const body=Object.fromEntries(F.map(k=>[k,hash('SYNTHETIC_LOCAL_CUSTODY_DATA_ONLY:'+k)]));
 Object.assign(body,{schema:W.schema,realm_id:randomUUID(),previous_realm:'legacy',inventory_native_request_id:nativeId,approval_id:receipt.approval_id,operation_id:target.operation_id,credential_id:target.credential_id,manifest_sha256,original_native_values_sha256:target.values_sha256});
 const manifest=(await admin.query('select custodial_recovery.retained_inventory_manifest_utf8($1::uuid) manifest',[nativeId])).rows[0].manifest;const parsed=JSON.parse(manifest);
 body.original_browser_frame_sha256=parsed.browser_value_frame.frame_sha256;body.original_browser_part_set_sha256=parsed.browser_part_set_sha256;
 body.purpose_binding_sha256=hash(F.map(k=>body[k]).join('\n'));body.purpose_attestation=createHmac('sha256',secret).update([W.purpose,target.credential_id,body.purpose_binding_sha256].join('\n')).digest('hex');
 const original=JSON.stringify(body),app=express();let rpcCalls=0,committedReplies=0,lost=true,server;
 const store={async findCredential(id){return(await role('service_role','select * from public.device_auth_credentials where credential_id=$1',[id]))[0];}};
 installLocalEnrollmentRetentionRoute(app,{env,store,runReadOnlySql:sql=>role('custodial_application_reader',sql),db:{async rpc(name,p){
  assert.equal(name,W.rpc);rpcCalls++;const rows=await role('service_role','select public.custodial_record_local_enrollment_retention_v1($1::uuid,$2::text,$3::text,$4::text) data',[p.p_credential,p.p_credential_hash,p.p_credential_key_id,p.p_original_utf8],false);committedReplies++;
  if(lost){lost=false;throw Error('SYNTHETIC_LOST_REPLY_AFTER_ACTUAL_SQL_COMMIT');}return {data:rows[0].data,error:null};
 }}});
 app.use(express.json());server=http.createServer(app);const connections=new Set();server.on('connection',s=>{connections.add(s);s.once('close',()=>connections.delete(s));});
 async function request(text=original){const timestamp=new Date().toISOString(),h={'authorization':'Device '+target.credential_id+'.'+secret,origin:'https://localhost','x-device-id':target.canonical_device_id,'x-memphis-app-edition':'custodial','content-type':'application/json; charset=utf-8','content-length':String(Buffer.byteLength(text)),'x-memphis-native-attestation-version':'custodial-native-request.v1','x-memphis-native-request-id':body.realm_id,'x-memphis-native-request-timestamp':timestamp};
  h['x-memphis-native-request-attestation']=createHmac('sha256',secret).update(['custodial-native-request.v1',target.credential_id,target.canonical_device_id,'POST',W.path,hash(text),body.realm_id,timestamp,'custodial'].join('\n')).digest('hex');
  return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path:W.path,method:'POST',headers:h,agent:false},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.once('error',reject);res.once('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())});}catch(e){reject(e);}});});req.setTimeout(15000,()=>req.destroy(Error('owned retention join HTTP deadline')));req.once('error',reject);req.end(text);});
 }
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const unknown=await request();assert.equal(unknown.status,503,JSON.stringify(unknown.body));assert.equal(unknown.body.outcome,'UNKNOWN');assert.equal(committedReplies,1);
  const saved=(await admin.query('select * from custodial_employment.local_retained_enrollments_v1')).rows;assert.equal(saved.length,1);assert.equal(saved[0].original_utf8,original);assert.equal(saved[0].employee_id,target.employee_id);
  const recovered=await request();assert.equal(recovered.status,200,JSON.stringify(recovered.body));assert.deepEqual(recovered.body.data,saved[0].receipt);assert.equal((await admin.query('select count(*)::int n from custodial_employment.local_retained_enrollments_v1')).rows[0].n,1);
  const changed=await request(original+'\n');assert.equal(changed.status,409,JSON.stringify(changed.body));assert.equal(rpcCalls,2);
  await assert.rejects(()=>role('service_role','select public.custodial_record_local_enrollment_retention_v1($1::uuid,$2::text,$3::text,$4::text)',[target.credential_id,'0'.repeat(64),originalCredential.metadata_json.credential_secret_key_id,original],false),e=>e.code==='42501');
  await assign();const afterDevice=(await admin.query('select assigned_employee_id,assignment_epoch from public.devices where id=$1',[target.canonical_device_pk])).rows[0];assert.equal(afterDevice.assigned_employee_id,employee);assert.equal(String(afterDevice.assignment_epoch),String(Number(target.assignment_epoch)+1));
  const idempotentAfterAssignment=await request();assert.equal(idempotentAfterAssignment.status,200,JSON.stringify(idempotentAfterAssignment.body));assert.deepEqual(idempotentAfterAssignment.body.data,saved[0].receipt);assert.equal(idempotentAfterAssignment.body.data.employee_id,target.employee_id);
  const credential=(await admin.query('select * from public.device_auth_credentials where credential_id=$1',[target.credential_id])).rows[0];assert.equal(credential.revoked_at,null);assert.equal(credential.token_hash,originalCredential.token_hash);assert.deepEqual(credential.metadata_json.retained_original_enrollment,{realm_id:body.realm_id,operation_id:body.operation_id,report_sha256:hash(original),inventory_native_request_id:nativeId});
  const ordinary=await authenticateDeviceCredentialRequest({method:'GET',originalUrl:'/device-auth/status',headers:{authorization:'Device '+target.credential_id+'.'+secret,'x-device-id':target.canonical_device_id}}, {env,store:{...store,async getPolicy(){return {mode:'observe'};}},runReadOnlySql:sql=>role('custodial_application_reader',sql)});assert.equal(ordinary.ok,false);assert.equal(ordinary.code,'device_original_enrollment_retained');
  const after=(await admin.query("select (select count(*)::int from public.sessions) sessions,(select count(*)::int from public.completion_responses) completions,(select count(*)::int from public.custodial_native_private_custody_operations) original_operations,(select count(*)::int from public.custodial_native_private_custody_chunks) original_chunks")).rows[0];assert.deepEqual(after,before);
  await assert.rejects(()=>admin.query('delete from custodial_employment.local_retained_enrollments_v1 where realm_id=$1',[body.realm_id]),e=>e.code==='42501'&&e.message==='same-original preparation records are immutable');
  assert.equal((await admin.query('select original_utf8 from custodial_employment.local_retained_enrollments_v1')).rows[0].original_utf8,original);
  return {pass:true,actual_SQL:true,actual_loopback_HTTP:true,actual_current_manager_auth_loan:true,actual_assignment_SQL_guard:true,retention_rows:1,original_employee_id:target.employee_id,next_employee_id:employee,rpc_calls:rpcCalls,committed_replies:committedReplies,lost_reply_after_real_commit:true,original_server_credential_and_record_retained:true,phone_key_preservation_not_exercised_by_SQL:true,cleaning_rows_unchanged:true,old_credential_ordinary_auth_denied:true,retained_fact_after_reassignment_idempotent:true,local_fact_input:'EXPLICIT_SYNTHETIC_NATIVE_PRESERVATION_FACT_DATA_AFTER_ACTUAL_APPROVAL_NOT_ANDROID_PRIVATE_FINALIZER',Android:false,private_native_ACK:false,finalizer:false,production:false};
 }finally{for(const s of connections)s.destroy();if(server?.listening)await new Promise(resolve=>server.close(resolve));}
}
