import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createMemphisResponder } from '../src/memphis-ai.js';
import { getGeminiEnvOrder } from '../src/utils/gemini-config.js';

const saved = new Map(getGeminiEnvOrder().map(name => [name, process.env[name]]));
let captured = '', checks = 0;
try {
  for (const name of saved.keys()) process.env[name] = '';
  const responder = createMemphisResponder({
    runReadOnlySql: async sql => {
      if (sql.includes('sch_service_date')) return [{service_date:'2026-10-02'}];
      if (sql.includes('from public.events_app_events')) captured = sql;
      return [];
    }, runRpc: async () => null,
  });
  await responder.generateReply({userMessage:'What events are coming up?'});
  assert.ok(captured); checks++;
  assert.match(captured,/e\.status[^\n]*= 'SCHEDULED'/,'Upcoming answer cannot include cancelled/superseded events'); checks++;
  assert.match(captured,/e\.needs_review[^\n]*= false/); checks++;
  assert.match(captured,/e\.event_scope <> 'UNKNOWN'/); checks++;
  assert.match(captured,/coalesce\(e\.end_date, e\.event_date\) >=/,'Retain overnight events that began yesterday'); checks++;
  assert.match(captured,/at time zone 'America\/Chicago'/); checks++;
  assert.doesNotMatch(captured,/\be\.notes\b|\be\.source_text\b|\be\.source_location_text\b/,'Do not fetch manager-only raw notes/source into employee assistant'); checks++;
  assert.match(captured,/e\.custodial_public_notes/); checks++;
  const container = process.env.CUSTODIAL_SYNTHETIC_MEMPHIS_DB;
  if (container) {
    assert.match(container,/^mz_schema_rebuild_[a-zA-Z0-9_]+$/);
    const docker = (args,input) => execFileSync('docker',args,{input,encoding:'utf8',timeout:30000,maxBuffer:5_000_000});
    const inspected = JSON.parse(docker(['inspect',container]))[0];
    assert.equal(inspected.HostConfig.NetworkMode,'none');
    assert.equal(Object.keys(inspected.HostConfig.PortBindings??{}).length,0);
    assert.equal(inspected.Config.Image,'supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed');
    const sql = `begin;
      insert into public.events_app_events(event_name,location_group_id,event_scope,primary_venue_id,venue_ids,
        display_location,event_date,end_date,start_time,end_time,status,needs_review,notes,custodial_public_notes)
      select 'MZ_SYNTH_MEMPHIS_'||f.label,v.location_group_id,case when f.review then 'UNKNOWN' else 'ZOO_WIDE' end,
        case when f.review then null else v.id end,case when f.review then array[]::uuid[] else array[v.id] end,
        case when f.review then 'Unresolved synthetic venue' else v.display_name end,
        (now() at time zone 'America/Chicago')::date+f.start_day,
        (now() at time zone 'America/Chicago')::date+f.end_day,'09:00','10:00',f.status,f.review,
        'PRIVATE_MANAGER_SOURCE_DO_NOT_FETCH','Approved public preparation note'
      from (values ('scheduled',0,0,'SCHEDULED',false),('cancelled',0,0,'CANCELLED',false),
        ('superseded',0,0,'SCHEDULED',false),('needs_review',0,0,'NEEDS_REVIEW',true),
        ('review_flag',0,0,'SCHEDULED',true),('overnight',-1,0,'SCHEDULED',false),
        ('old',-2,-1,'SCHEDULED',false),('far_future',15,15,'SCHEDULED',false)) f(label,start_day,end_day,status,review)
      cross join lateral(select * from public.event_venues where venue_code='ZOO_FOOTPRINT' and active limit 1)v;
      do $fixture$ declare e public.events_app_events; manager uuid; replacement jsonb; begin
        select * into strict e from public.events_app_events where event_name='MZ_SYNTH_MEMPHIS_superseded';
        select manager_id into strict manager from public.ops_manager_managers where active and not is_system_principal
          and roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[] order by manager_id limit 1;
        replacement:=(to_jsonb(e)-'id'-'revision'-'created_at'-'updated_at')||jsonb_build_object(
          'event_name','MZ_SYNTH_REPLACEMENT','operation_id',gen_random_uuid(),'actor_manager_id',manager,
          'start_instant_utc',(e.event_date+e.start_time) at time zone 'America/Chicago',
          'end_instant_utc',(e.end_date+e.end_time) at time zone 'America/Chicago');
        perform public.app_replace_event_authoritative(e.id,e.revision,replacement,manager);
      end $fixture$;
      set local role custodial_application_reader;
      select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (${captured})q where event_name like 'MZ_SYNTH_MEMPHIS_%';
      reset role; rollback;`;
    const rows = JSON.parse(docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],sql).trim());
    assert.deepEqual(rows.map(row=>row.event_name).sort(),['MZ_SYNTH_MEMPHIS_overnight','MZ_SYNTH_MEMPHIS_scheduled']); checks++;
    assert.ok(rows.every(row=>row.notes==='Approved public preparation note')); checks++;
    assert.doesNotMatch(JSON.stringify(rows),/PRIVATE_MANAGER_SOURCE_DO_NOT_FETCH/); checks++;
  }
  console.log(JSON.stringify({status:'PASS_MEMPHIS_EVENT_READ_LOCAL',checks,actualResponder:true,actualRestrictedSql:Boolean(container),
    production:false,notProven:['Place overlay adoption','deployed authenticated employee call','independent review']}));
} finally {
  for(const [name,value] of saved){if(value===undefined) delete process.env[name];else process.env[name]=value;}
}
