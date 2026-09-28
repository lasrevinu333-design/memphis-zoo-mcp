import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const container=process.env.SHIFT_END_TEST_CONTAINER;
assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',timeout:10000}))[0];
assert.equal(info.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(info.HostConfig.PortBindings??{}).length,0);
const sql=input=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],
 {input,encoding:'utf8',timeout:15000}).trim();
const identities=['public.custodial_create_employee(text,text,text,uuid)',
 'public.custodial_v12_inactivate_preserving_work(uuid,uuid,uuid,text,bigint,uuid,date)'];
let checks=0;
for(const identity of identities){
 const row=JSON.parse(sql(`select jsonb_build_object('publicExecute',exists(select 1 from pg_proc p,
 lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='${identity}'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),
 'roles',(select jsonb_object_agg(r,has_function_privilege(r,'${identity}','EXECUTE')) from unnest(array['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader']) r),
 'recovery',(select jsonb_agg(definition_sql=public.custodial_release_authority_current_grant_definition(object_identity))
 from public.custodial_release_authority_restore_inventory where object_kind='grant' and to_regprocedure(object_identity)='${identity}'::regprocedure));`));
 assert.equal(row.publicExecute,false,identity+' PUBLIC');checks++;
 for(const [role,allowed] of Object.entries(row.roles)){assert.equal(allowed,false,identity+' '+role+' direct EXECUTE');checks++;}
 assert.ok(Array.isArray(row.recovery)&&row.recovery.length>0&&row.recovery.every(Boolean),identity+' exact recovery ACL');checks++;
}
for(const [role,name,args] of [['service_role','custodial_create_employee',"'Synthetic no-direct-hire',null,null,null::uuid"],
 ['static_weekly_control_plane','custodial_v12_inactivate_preserving_work','null::uuid,null::uuid,null::uuid,null::text,null::bigint,null::uuid,null::date']]){
 assert.throws(()=>sql(`begin;set local role ${role};select public.${name}(${args});rollback;`),
  error=>String(error.stderr).includes('permission denied for function '+name),'real direct caller denial '+name);checks++;
}
console.log(JSON.stringify({status:'PASS',checks,production:false,ownerToOwnerTurnoverProof:'covered separately by exact legacy-only fixture'}));
