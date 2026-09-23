import assert from 'node:assert/strict';
import {Client} from 'pg';
import {createReadOnlyPool,runReadOnlySql} from '../../src/supabase/read.js';
import {visitorRuntimeFixture} from './visitor-attendance-runtime-fixture.mjs';

// Only called with an owned network-none synthetic PostgreSQL Unix socket.
// Exercise the actual pg driver AND dedicated-reader adapter/normalizer/routes.
export async function visitorDatabaseBoundaryProof({socketDir,sql}) {
 const clients=[],checks=[];
 sql("create role visitor_test_reader login inherit password 'synthetic-only'; grant custodial_application_reader to visitor_test_reader;");
 const pool=createReadOnlyPool({connectionString:`postgresql://visitor_test_reader:synthetic-only@localhost/postgres?host=${encodeURIComponent(socketDir)}`});
 const connect=async role=>{const c=new Client({host:socketDir,user:'supabase_admin',database:'postgres',password:'postgres',connectionTimeoutMillis:5000,statement_timeout:10000});clients.push(c);await c.connect();if(role)await c.query('set role '+role);return c;};
 try {
  const writer=await connect('service_role'),other=await connect('service_role'),admin=await connect();
  const push=(client,payload)=>client.query("select public.app_apply_operational_command('attendance_state_upsert',$1::jsonb)",[JSON.stringify(payload)]);
  const nowMs=Date.now(),base=Math.floor(nowMs/1000)*1000;
  const observation={attendance:0,last_year:100,planned:200,yesterday:150,yesterday_plan:175,source:'home-browser-auto-push',fetched_at:new Date(base+123).toISOString()};
  const reset=()=>admin.query("update public.current_attendance_state set fetched_at=clock_timestamp()-interval '5 minutes' where id=1");
  const reader=async query=>(await runReadOnlySql({pool,sql:query})).rows;
  const runtime=(read=reader)=>visitorRuntimeFixture({nowMs,read,write:(_,payload)=>push(writer,payload)});
  const test=async(name,fn)=>{await fn();checks.push(name);};
  await test('pg TIMESTAMPTZ returns a Date; actual adapter retains exact Date milliseconds',async()=>{
   await reset();await push(writer,observation);
   const rows=await reader('select * from public.current_attendance_state where id=1');
   assert.ok(rows[0].fetched_at instanceof Date);assert.equal(rows[0].fetched_at.getTime(),base+123);
   const f=runtime(()=>reader('select * from public.current_attendance_state where id=1'));
   assert.equal((await f.collector(observation)).code,200);
  });
  await test('actual cast-to-text reader, normalizer and collector preserve PostgreSQL microseconds',async()=>{
   await reset();const payload={...observation,fetched_at:observation.fetched_at.replace('.123Z','.123456Z')};
   const f=runtime(),response=await f.collector(payload);
   assert.equal(response.code,200);assert.equal(response.body.data.fetched_at,payload.fetched_at);
   assert.match(f.queries[0],/fetched_at::text as fetched_at/);
   assert.equal((await f.publicRead()).body.data.attendance,0);
  });
  await test('different same-second pg Date readback is rejected, not accepted as the submitted observation',async()=>{
   await reset();const submitted={...observation,fetched_at:new Date(base).toISOString()};
   const f=runtime(async()=>{await push(other,observation);return reader('select * from public.current_attendance_state where id=1');});
   assert.equal((await f.collector(submitted)).code,503);
  });
  await test('actual interleaved writer with different microsecond version fails exact collector readback',async()=>{
   await reset();const submitted={...observation,fetched_at:observation.fetched_at.replace('.123Z','.123456Z')};
   const f=runtime(async query=>{await push(other,{...submitted,fetched_at:submitted.fetched_at.replace('456Z','789Z')});return reader(query);});
   assert.equal((await f.collector(submitted)).code,503);
  });
  for(const fetched_at of ['2099-01-01T00:00:00Z','infinity','-infinity',new Date(nowMs+120000).toISOString(),new Date(nowMs-3601000).toISOString()]){
   await test('SQL shared write boundary rejects '+fetched_at,async()=>{await assert.rejects(push(writer,{...observation,fetched_at}),e=>e.code==='22023');});
  }
  for(const bad of ['2099-01-01T00:00:00Z','infinity','-infinity']){
   await test('current collector recovers previously poisoned stored '+bad,async()=>{
    await admin.query('update public.current_attendance_state set attendance=900,fetched_at=$1::timestamptz where id=1',[bad]);
    const result=await runtime().collector(observation);assert.equal(result.code,200);assert.equal(result.body.data.attendance,0);
   });
  }
  await test('real concurrent unequal writers retain newest lower count regardless of arrival order',async()=>{
   await reset();const newer={...observation,attendance:0,fetched_at:new Date(base+1123).toISOString()};
   const results=await Promise.allSettled([push(writer,{...observation,attendance:999}),push(other,newer)]);
   assert.equal(results[1].status,'fulfilled');
   if(results[0].status==='rejected')assert.equal(results[0].reason.code,'23514');
   const saved=(await reader('select attendance,fetched_at::text from public.current_attendance_state where id=1'))[0];
   assert.equal(saved.attendance,0);assert.equal(Date.parse(saved.fetched_at),base+1123);
  });
  await test('real concurrent equal-version exact replays both succeed',async()=>{
   await reset();const values=await Promise.all([push(writer,observation),push(other,observation)]);assert.equal(values.length,2);
  });
  await test('real concurrent equal-version conflicting payload permits only one winner',async()=>{
   await reset();const values=await Promise.allSettled([push(writer,observation),push(other,{...observation,planned:201})]);
   assert.equal(values.filter(v=>v.status==='fulfilled').length,1);assert.equal(values.find(v=>v.status==='rejected').reason.code,'23514');
  });
  for(const role of ['anon','authenticated','custodial_application_reader'])await test(role+' cannot call shared writer',async()=>{
   const denied=await connect(role);await assert.rejects(push(denied,observation),e=>e.code==='42501');
  });
  for(const role of ['anon','authenticated'])await test(role+' cannot read stored visitor data directly',async()=>{
   const denied=await connect(role);await assert.rejects(denied.query('select * from public.current_attendance_state'),e=>e.code==='42501');
  });
  await test('reader cannot update table even through a real driver connection',async()=>{
   const denied=await connect('custodial_application_reader');await assert.rejects(denied.query('update public.current_attendance_state set attendance=1'),e=>e.code==='42501');
  });
  await test('function and grant recovery restore time guard and authorized writer without adding callers',async()=>{
   sql('revoke execute on function public.app_apply_operational_command(text,jsonb) from service_role');
   await assert.rejects(push(writer,observation),e=>e.code==='42501');
   sql("do $$ declare r record; begin for r in select definition_sql from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and object_identity='public.app_apply_operational_command(text,jsonb)' order by restore_order loop execute r.definition_sql; end loop; end $$");
   await assert.rejects(push(writer,{...observation,fetched_at:'2099-01-01T00:00:00Z'}),e=>e.code==='22023');
   await reset();assert.equal((await runtime().collector(observation)).code,200);
   const denied=await connect('authenticated');await assert.rejects(push(denied,observation),e=>e.code==='42501');
  });
  console.log(JSON.stringify({scope:'actual PostgreSQL pg driver, dedicated read authority, persistence/normalizer/routes, concurrent writers, ACL and recovery',passed:checks.length,failed:0,checks,productionWritten:false},null,2));
  return checks.length;
 } finally {
  await Promise.allSettled(clients.map(client=>client.end()));await pool.end();
 }
}
