import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NATIVE_SCHEDULE_PAYLOAD_KEYS} from '../src/native-schedule-payload.js';
import {readMigrationReplayPlan} from './migration-replay-order.mjs';

// Mandatory source-boundary coverage, not database/native/provider admission.
export function runNativeScheduleFinalizationSourceTests(root=process.cwd()) {
 const name='20261008095837_native_schedule_server_finalization.sql';
 const sql=readFileSync(resolve(root,'supabase/migrations',name),'utf8');let checks=0;
 const check=(name,value)=>{assert.equal(value,true,name);checks++;};
 const keys=sql.match(/keys IS DISTINCT FROM ARRAY\[([^\]]+)\]/)?.[1].match(/'[^']+'/g)?.map(x=>x.slice(1,-1));
 check('SQL guard has the paired exact32-field contract',JSON.stringify(keys)===JSON.stringify(NATIVE_SCHEDULE_PAYLOAD_KEYS));
 const core=sql.slice(sql.indexOf('CREATE FUNCTION public.custodial_native_schedule_finalize_at('),sql.indexOf('CREATE FUNCTION public.custodial_native_schedule_finalize(uuid'));
 check('SQL content is derived from original accepted source',core.includes("data:=((content->'candidate')-'employee_id')||jsonb_build_object"));
 check('caller cannot supply content or time through public wrapper',sql.includes('public.custodial_native_schedule_finalize(uuid,uuid,uuid,jsonb)')
  &&sql.includes('public.custodial_native_schedule_finalize_at($1,$2,$3,$4,null)')&&!core.includes('p_candidate'));
 const ordered=[
  'PERFORM public.custodial_begin_application_mutation();',
  "PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));",
  'SELECT d0.* INTO d','SELECT * INTO c','PERFORM 1 FROM public.employees',
  'PERFORM 1 FROM public.employee_push_registrations','SELECT * INTO g','SELECT * INTO j','SELECT * INTO s',
  'at_time:=coalesce(p_test_at,clock_timestamp());'];
 for(let i=1;i<ordered.length;i++)check('existing lock/clock order '+i,core.indexOf(ordered[i-1])>=0&&core.indexOf(ordered[i])>core.indexOf(ordered[i-1]));
 check('source read uses final server clock after owning locks',core.indexOf('content:=public.custodial_native_schedule_content_source_at')>core.indexOf(ordered.at(-1)));
 check('closed job is bound to source and recipient',core.includes("j.job_key IS DISTINCT FROM 'employee-schedule-push:'||p_source::text||':'||c.credential_id::text")
  &&core.includes("j.payload_json IS DISTINCT FROM jsonb_build_object")&&core.includes("g.registration_id IS DISTINCT FROM r.registration_id"));
 check('once-per-original source with exact receipt foreign key',sql.includes('source_reservation_id uuid PRIMARY KEY REFERENCES public.employee_native_schedule_source_reservations(reservation_id)')
  &&sql.includes('job_id uuid NOT NULL UNIQUE REFERENCES public.employee_native_push_delivery_receipts(job_id)'));
 check('immutable guard and RPC-only FORCE RLS retained',sql.includes('ENABLE ALWAYS TRIGGER trg_native_schedule_finalization_guard')
  &&sql.includes('FORCE ROW LEVEL SECURITY')&&sql.includes('REVOKE ALL ON TABLE public.employee_native_schedule_finalizations FROM PUBLIC,postgres,anon,authenticated,service_role'));
 check('every finalization keeps provider permission false',!/'dispatch_authorized'\s*,\s*true/i.test(sql)
  &&sql.includes("'SCHEDULE dispatch/outcome not admitted'"));
 check('no producer/route/provider/profile activation',!/INSERT\s+INTO\s+public\.operational_notification_jobs|cron\.schedule|net\.http|fcm_token\s*[:=]|dispatch_authorized'\s*,\s*true/i.test(sql));
 check('wire canonical hash and byte cap preserved',sql.includes("public.custodial_native_location_canonical(p-'content_sha256')")
  &&sql.includes('octet_length(public.custodial_native_location_canonical(p))<=3500'));
 const grants=[...sql.matchAll(/GRANT EXECUTE ON FUNCTION ([\s\S]*?) TO service_role;/g)].map(x=>x[1].replace(/\s+/g,' '));
 check('only exact wrapper/status grants, no timed core grant',grants.length===1&&grants[0]==='public.custodial_native_schedule_finalize(uuid,uuid,uuid,jsonb), public.custodial_native_schedule_finalization_status(uuid,uuid,uuid)');
 assert.equal(checks,20);
 const plan=readMigrationReplayPlan(root);
 assert.ok(plan.files.includes(name));
 assert.equal(plan.files.indexOf(name),plan.files.indexOf('20261008083139_native_schedule_content_source.sql')+1,
  'exact finalization predecessor remains adjacent even after a later forward inventory migration');
 return Object.freeze({status:'PASS',checks,new_sql_executed:false,provider_dispatch:false,native_qualified:false,phone:false});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(runNativeScheduleFinalizationSourceTests()));
