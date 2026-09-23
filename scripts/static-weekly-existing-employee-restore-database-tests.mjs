#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync=promisify(execFile);
const container=`mz_existing_employee_restore_${process.pid}`;
const migrationsDir=path.resolve(process.cwd(),"supabase/migrations");
const managerId="10000000-0000-4000-8000-000000000093";
const slotId="5d2d2a0e-230f-5b03-9867-2e4c2826871f";
const employeeId="4f501293-2973-46ba-bf83-34d440d60407";
const sourceId="50000000-0000-4000-8000-000000000093";
const q=(v)=>`'${String(v).replaceAll("'","''")}'`;
const json=(v)=>`$$${JSON.stringify(v)}$$::jsonb`;
const docker=(args,opts={})=>execFileAsync("docker",args,{maxBuffer:32*1024*1024,...opts});
async function sql(statement){
 if(Buffer.byteLength(statement)>96*1024){
  return new Promise((resolve,reject)=>{const c=spawn("docker",["exec","-i",container,"psql","-q","-v","ON_ERROR_STOP=1","-At","-U","supabase_admin","-d","postgres"]);let out="",err="";c.stdout.on("data",x=>out+=x);c.stderr.on("data",x=>err+=x);c.once("error",reject);c.once("close",code=>code===0?resolve(out.trim()):reject(Object.assign(new Error(`psql exited ${code}`),{stdout:out,stderr:err})));c.stdin.end(statement);});
 }
 const {stdout}=await docker(["exec",container,"psql","-q","-v","ON_ERROR_STOP=1","-At","-U","supabase_admin","-d","postgres","-c",statement]);return stdout.trim();
}
const scalar=async(s)=>(await sql(s)).split("\n").at(-1);
const cp=(args)=>`set role static_weekly_control_plane; select public.static_weekly_v8_restore_existing_employee(${args})::text`;
async function reject(statement,pattern){await assert.rejects(()=>sql(statement),e=>pattern.test(`${e.stdout||""}\n${e.stderr||""}\n${e.message||""}`));}
let removed=false;
try{
 const image=process.env.SCHEMA_REBUILD_DOCKER_IMAGE||"supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed";
 await docker(["image","inspect",image]);
 await docker(["run","--rm","-d","--network","none","--name",container,"--tmpfs","/var/lib/postgresql/data:rw,size=1g","-e","POSTGRES_PASSWORD=postgres",image,"-c","shared_preload_libraries=pg_cron,pg_net,pg_stat_statements"]);
 let ready=false,consecutive=0;for(let i=0;i<120;i+=1){try{await sql("select 1");consecutive+=1;if(consecutive>=5){ready=true;break;}}catch{consecutive=0;}await new Promise(r=>setTimeout(r,500));}assert.equal(ready,true);
 await sql("do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$;");
 for(const file of fs.readdirSync(migrationsDir).filter(n=>n.endsWith('.sql')).sort()) await sql(fs.readFileSync(path.join(migrationsDir,file),'utf8'));
 await sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,metadata_json,is_system_principal) values(${q(managerId)},'Restore Test Manager',array['OPS_MANAGER','CUSTODIAL_MANAGER']::text[],true,'{}'::jsonb,false);\ninsert into public.employees(id,employee_code,display_name,active,role) values(${q(employeeId)},'EMP007','Gregory Staples',false,'staff');\ninsert into public.msg_users(employee_id,display_name,role,is_active) values(${q(employeeId)},'Gregory Staples','employee',false);\ninsert into public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(${q(slotId)},'OPTION3','Gregory Staples schedule position',${q(managerId)},'Restore Test Manager',repeat('a',64));`);
 const effective=await scalar("select (public.sch_service_date(statement_timestamp())+1)::text");
 const source={serviceDate:effective,timezone:"America/Chicago",exceptions:[],proximity:[],slots:[{id:slotId,label:"Gregory Staples schedule position",incumbencies:[{personId:employeeId,displayName:"Gregory Staples",effectiveStart:effective,effectiveEnd:null}]}],version:{id:"60000000-0000-4000-8000-000000000093",publicationId:"70000000-0000-4000-8000-000000000093",status:"published",effectiveStart:effective,effectiveEnd:null,objective:{},vacancyCapableSlotIds:[],vacantSlotIds:[],slotAvailability:[{slotId,dayOfWeek:3,status:"working",shift:{start:"08:00",end:"17:00"},lunch:{start:"13:00",end:"14:00"},productiveCapacityProvenance:"restore-test-shift",maxServiceEffortMinutes:100,maxServiceEffortProvenance:"restore-test-load",qualifications:["general"],qualificationProvenance:"restore-test",restrictions:[],restrictionProvenance:"restore-test",acceptedRouteAnchorLocationId:"40000000-0000-4000-8000-000000000093",acceptedRouteProvenance:"restore-test"}],assignments:[]}};
 await sql(`set role static_weekly_release_operator; select public.static_weekly_v3_register_authority_source(${q(sourceId)},${json(source)},'existing-employee-restore-test')`);
 const beforeEmployees=await scalar("select count(*)::text from public.employees"); const beforeUsers=await scalar("select count(*)::text from public.msg_users");
 const result=JSON.parse(await scalar(cp(`${q(sourceId)},${q(slotId)},${q(employeeId)},${q(effective)},'Owner-approved restoration of existing Gregory identity',0,${q(managerId)},'restore-gregory-existing'`)));
 assert.equal(result.revision,1);assert.equal(result.data.employee_id,employeeId);assert.equal(result.data.source_id,sourceId);assert.equal(result.data.prior_scheduler_incumbency_count,0);assert.equal(result.data.history_preserved,true);assert.equal(result.data.phone_assignment,null);
 assert.equal(await scalar(`select active::text from public.employees where id=${q(employeeId)}`),'true');
 assert.equal(await scalar(`select is_active::text from public.msg_users where employee_id=${q(employeeId)}`),'true');
 assert.equal(await scalar("select count(*)::text from public.employees"),beforeEmployees,"restore creates no employee");
 assert.equal(await scalar("select count(*)::text from public.msg_users"),beforeUsers,"restore creates no Messenger identity");
 assert.equal(await scalar(`select count(*)::text from public.weekly_roster_slot_incumbencies where slot_id=${q(slotId)} and person_id=${q(employeeId)}`),'1',"restore appends the first scheduler incumbency without fabricating a new employee");
 assert.equal(await scalar(`select staffing_state from public.weekly_roster_slot_staffing_states where slot_id=${q(slotId)} order by authority_revision desc limit 1`),'working');
 assert.equal(await scalar(`select count(*)::text from public.devices where assigned_employee_id=${q(employeeId)}`),'0',"restore never invents a phone assignment");
 const replay=JSON.parse(await scalar(cp(`${q(sourceId)},${q(slotId)},${q(employeeId)},${q(effective)},'Owner-approved restoration of existing Gregory identity',0,${q(managerId)},'restore-gregory-existing'`)));assert.deepEqual(replay,result,"exact retry is idempotent");
 assert.equal(await scalar(`select count(*)::text from public.weekly_roster_slot_incumbencies where slot_id=${q(slotId)} and person_id=${q(employeeId)}`),'1');
 await reject(cp(`${q(sourceId)},${q(slotId)},${q(employeeId)},${q(effective)},'different semantics',1,${q(managerId)},'restore-gregory-existing'`),/idempotency key.*different semantic inputs/i);
 await reject(cp(`${q(sourceId)},${q(slotId)},'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',${q(effective)},'wrong employee',1,${q(managerId)},'restore-wrong-employee'`),/existing custodial employee identity|closed historical incumbency/i);
 for(const role of ['public','anon','authenticated','service_role','custodial_application_reader']) assert.equal(await scalar(`select has_function_privilege(${q(role)},'public.static_weekly_v8_restore_existing_employee(uuid,uuid,uuid,date,text,bigint,uuid,text)','execute')::text`),'false',`${role} cannot restore roster history`);
 assert.equal(await scalar("select has_function_privilege('static_weekly_control_plane','public.static_weekly_v8_restore_existing_employee(uuid,uuid,uuid,date,text,bigint,uuid,text)','execute')::text"),'true');
 assert.equal(await scalar("select count(*)::text from public.custodial_release_authority_restore_inventory where object_kind='function' and object_identity='public.static_weekly_v8_restore_existing_employee(uuid,uuid,uuid,date,text,bigint,uuid,text)'"),'1');
 console.log(JSON.stringify({ok:true,restored_existing_employee:employeeId,stable_slot:slotId,history_preserved:true,new_employee_created:false,phone_assigned:false,production_written:false},null,2));
 console.log('STATIC_WEEKLY_EXISTING_EMPLOYEE_RESTORE_TESTS_PASS');
}finally{try{await docker(['rm','-f',container]);removed=true;}catch{}if(!removed)process.exitCode=1;}
