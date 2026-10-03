import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
const sha=s=>createHash('sha256').update(s).digest('hex');
const path='scripts/fixtures/native-provider-credential-observation-proposal.sql';
const signature='public.custodial_native_provider_credential_observation(uuid,text,text,uuid,text,text,jsonb)';
const pins={
 'src/device-identity.js':'240170fedc316004e22dfa9501f658d1582cb184bcaa936530d40361b8a66288',
 'src/native-provider-api.js':'d330398f959ca4c5682ca6195152b9d0d82d72704fc853af8fe5c3361e93b1e6',
 'src/native-provider-event-decisions.js':'b79128fbcecddff73116b3720e6954f2b876fce5567c54c84a4b1c9ccbd18efe',
 'src/native-provider-events.js':'928debaeaf0af1c76c1bf3ff62d42c5f6665c6682eadd96da1ef494c86e33047',
 'src/native-provider-json.js':'8599daf5faec77242649dd6a863731e32ba4193872efe546029777c87f785294',
 'src/request-json-parser.js':'c7d44c3795c3642246fb7db8090958842bbb3de8ce9406b05a5849cf30993689',
 'supabase/migrations/20260924201258_native_provider_durable_authority.sql':'fe4f617f2531cfc941624660138bbba2c3dff983e87cb04dafe04ff58dee7538',
 'supabase/migrations/20261004000000_native_provider_event_decision_lookup.sql':'ab4e6eb848bd214f8616fb52f094829786df9a9a81d2eb8d00d247b1f28e52fd',
};
export function assertCredentialObservationSqlProposal(sql){
 const code=sql.replace(/--[^\n]*/g,'');
 assert(sql.startsWith('-- PROPOSAL ONLY: OUTSIDE MIGRATIONS, NOT EXECUTED, NOT MOUNTED.'));
 assert.equal((code.match(/create function /g)||[]).length,1);
 assert(!/\b(insert|update|delete|truncate|alter|set_config|execute|create table|create policy)\b/i.test(code.slice(0,code.indexOf('revoke all'))));
 assert(code.includes('security definer set search_path=pg_catalog,public'));
 assert(!/\bp_(?:at|time|expiry|now)\b|\w+_at\(/.test(code));
 const order=["pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0))",'for share of d0','where credential_id=p_credential for share',
  'from public.employees where id=d.assigned_employee_id for share','order by registration_id for share','order by generation_id for share','if binding_ok is true then','at_time:=clock_timestamp()'];
 let prior=-1;for(const x of order){const i=code.indexOf(x);assert(i>prior,x);prior=i;}
 for(const x of ['c.token_hash=p_credential_hash','c.confirmed_at is not null',"c.metadata_json->>'credential_secret_key_id'=p_credential_secret_key_id",
  "requester->>'device_id'=d.device_id","requester->>'employee_id'=d.assigned_employee_id::text","requester->>'assignment_epoch'=d.assignment_epoch::text",
  "g.principal_digest=requester->>'principal_digest'","g.token_digest=requester->>'token_digest'",'r.token_hash=g.token_digest',
  'public.static_weekly_digest_text(r.fcm_token)=g.token_digest','successor.generation_id<>g.generation_id',
  'isfinite(c.expires_at)','c.revoked_at<=at_time',"if c.revoked_at is not null then decision:='REVOKED_AS_OF'",
  "elsif c.expires_at<=at_time then decision:='EXPIRED_AS_OF'","elsif current_ok is true then decision:='CURRENT_AS_OF'",
  "decision text:='UNRESOLVED'",'observed text:=null;expiry text:=null;revocation text:=null',
  'g.dispatch_retired_at is null and g.revoked_at is null',"'request_body_sha256',p_raw_body_sha256",'public.custodial_native_location_utc(c.expires_at)'])assert(code.includes(x),x);
 assert(code.includes(`revoke all on function ${signature}\n from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,\n custodial_application_reader,static_weekly_runtime_20260823;`));
 assert.equal((code.match(/grant execute/g)||[]).length,1);
 assert(code.includes(`grant execute on function ${signature} to service_role;`));
 assert(!/grant.*(?:table|schema|sequence)|to\s+(?:anon|authenticated|public)\s*;/i.test(code));
 for(const x of [`-- function ${signature}`,`-- grant ${signature}`,
  '661cd2a5aecc83d0244920466b161b6fc52d22143074a037148660abed351471',
  '4f2cac31af750c5bc10a50445583b27ae2c6e67b0f66fe72c078b53c533d00db','NOT EXECUTABLE RECOVERY SPECIFICATION'])assert(sql.includes(x),x);
 return true;
}
export function runCredentialObservationSqlContractTests(){
 let checks=0;for(const[p,h]of Object.entries(pins)){assert.equal(sha(read(p)),h,p);checks++;}
 const auth=read('src/auth/device-credential-auth.js');
 const removed=auth.replace(/\/\/ BEGIN native credential observation imports[^]*?\/\/ END native credential observation imports\.\n/,'')
  .replace(/\/\/ BEGIN native credential observation proof\.[^]*?\/\/ END native credential observation proof\.\n\n/,'');
 assert.equal(sha(removed),'a94b58013f872b9ee439f9d960bee3d9230a370bd73967980ef5a8b8a7a3de86','ordinary auth byte-exact after only additive blocks');checks++;
 const existing=read('src/native-provider-event-decisions.js'),current=read('src/native-provider-credential-observation.js');
 const grammar=(source,end)=>source.slice(source.indexOf(' const r=body.requester;'),source.indexOf(end,source.indexOf(' const r=body.requester;')));
 assert.equal(grammar(current,' return Object.freeze'),grammar(existing,' const batch='),'exact existing F6 requester grammar, no synthetic event');checks++;
 assert.equal(current.match(/const requesterKeys=([^;]+);/)[1],existing.match(/const requesterKeys=([^;]+);/)[1]);checks++;
 assert.notEqual(sha(removed.replace('DEFAULT_CREDENTIAL_TTL_DAYS = 3650;','DEFAULT_CREDENTIAL_TTL_DAYS = 3651;')),
  'a94b58013f872b9ee439f9d960bee3d9230a370bd73967980ef5a8b8a7a3de86','outside-insertion ordinary auth drift denied');checks++;
 const sql=read(path);assertCredentialObservationSqlProposal(sql);checks++;
 for(const[from,to]of [
  ['c.token_hash=p_credential_hash','true'],['r.token_hash=g.token_digest','true'],['c.revoked_at<=at_time','true'],
  ['isfinite(c.expires_at)','true'],['successor.generation_id<>g.generation_id','false'],
  ['at_time:=clock_timestamp()','at_time:=now()'],['order by registration_id for share','order by registration_id'],
  ['to service_role;','to authenticated;'],['NOT EXECUTABLE RECOVERY SPECIFICATION','RECOVERY ACCEPTED'],
  [`-- grant ${signature}`,'-- extra missing member'],['set search_path=pg_catalog,public','set search_path=public'],
 ]){assert.notEqual(sql.replace(from,to),sql);assert.throws(()=>assertCredentialObservationSqlProposal(sql.replace(from,to)));checks++;}
 assert.throws(()=>assertCredentialObservationSqlProposal(sql.replace('begin\n','begin\n update public.devices set active=true;\n')));checks++;
 console.log(`Credential observation SQL SOURCE ONLY PASS ${checks}; no SQL executed; recovery materialization remains blocked`);return checks;
}
if(process.argv[1]===fileURLToPath(import.meta.url))runCredentialObservationSqlContractTests();
