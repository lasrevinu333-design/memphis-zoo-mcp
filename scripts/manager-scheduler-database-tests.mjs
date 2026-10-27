// Disposable PostgreSQL tests of the actual owner/delegate migration.
// No production connection, password, user, ticket, or schedule is used.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const name = 'mz_manager_scheduler_' + randomUUID().replaceAll('-', '').slice(0, 12);
const image = 'supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 20000, stdio: ['pipe','pipe','pipe'] });
const sql = statement => execFileSync('docker', ['exec','-i',name,'psql','-h','127.0.0.1','-X','-v','ON_ERROR_STOP=1','-At','-U','supabase_admin','-d','owner_actions_test'], { input: statement, encoding: 'utf8', timeout: 10000 });
const migration = readFileSync(new URL('../supabase/migrations/20261006031304_custodial_owner_delegated_actions.sql', import.meta.url), 'utf8');
const owner = '91000000-0000-4000-8000-000000000001';
const viewer = '91000000-0000-4000-8000-000000000002';
const ownerCredential = '92000000-0000-4000-8000-000000000001';
const viewerCredential = '92000000-0000-4000-8000-000000000002';
const scanTicket = '93000000-0000-4000-8000-000000000001';
const otherTicket = '93000000-0000-4000-8000-000000000002';
const session = '94000000-0000-4000-8000-000000000001';
const response = '95000000-0000-4000-8000-000000000001';
const place = '96000000-0000-4000-8000-000000000001';
const device = '97000000-0000-4000-8000-000000000001';
const employee = '98000000-0000-4000-8000-000000000001';
const publication = '99000000-0000-4000-8000-000000000001';
const results = [];
const STAFF='81000000-0000-4000-8000-000000000001',COVER='82000000-0000-4000-8000-000000000001';
const outcomeSource=readFileSync(new URL('../supabase/migrations/20261002090000_manager_issue_outcomes.sql',import.meta.url),'utf8');
const exactOutcomeWriter=outcomeSource.slice(outcomeSource.indexOf('create function public.custodial_set_maintenance_ticket_outcome('),outcomeSource.indexOf('-- The historical close command'));
const latest=readFileSync(new URL('../supabase/migrations/20261006172928_custodial_manager_scheduler_permissions.sql',import.meta.url),'utf8');
const j=x=>"'"+JSON.stringify(x).replaceAll("'","''")+"'::jsonb";
const authorize=(ops,pub=publication,date='2026-10-05')=>`select public.custodial_authorize_absence_operations_v1('${viewer}','${viewerCredential}','fixture-browser','read_only','${date}','${pub}',${j(ops)});`;
const absence={operation:'exception',exceptionType:'daily_absence',reason:'Fixture call-out',payload:{slotId:STAFF}};
const cover={operation:'cover_all',slotId:COVER,shift:{start:'07:00',end:'16:00'},reason:'Fixture manual coverage'};
const lunch={operation:'exception',exceptionType:'lunch',startsAt:'11:00',endsAt:'12:00',reason:'Fixture CoverAll lunch',payload:{slotId:COVER}};
function accepted(label, statement, expected) {
  const result = sql(`SET ROLE service_role; ${statement}`).trim().split('\n').at(-1);
  assert.equal(result, expected, label); results.push({label,pass:true});
}
function rejected(label, statement, role = 'service_role') {
  let failed = false;
  try { sql(`SET ROLE ${role}; ${statement}`); } catch { failed = true; }
  assert.equal(failed, true, label); results.push({label,pass:true});
}
const actor = (action, id=viewer, credential=viewerCredential, access='read_only') => `public.custodial_action_actor_v1('${id}','${credential}','fixture-browser','${access}','${action}')`;
const close = (ticket, id=viewer, credential=viewerCredential, access='read_only') => `public.custodial_close_scan_ticket_outcome_v1('${id}','${credential}','fixture-browser','${access}','${ticket}','mark_fixed',null,'fixture notes','fixture-backend-proof')`;
const coverage = change => `public.custodial_owner_coverage_v1('${owner}','${ownerCredential}','fixture-browser','full_access',${change == null ? 'NULL' : `'${JSON.stringify(change)}'::jsonb`},'fixture-backend-proof')`;
const operation = type => `SELECT public.custodial_authorize_absence_operations_v1('${viewer}','${viewerCredential}','fixture-browser','read_only','2026-10-05','${publication}','[{"operation":"exception","exceptionType":"${type}","payload":{"slotId":"${STAFF}"}}]'::jsonb);`;
try {
  docker(['run','-d','--name',name,'--tmpfs','/var/lib/postgresql/data:rw,size=512m','-e','POSTGRES_PASSWORD=fixture-only-password',image,'-c','cron.launch_active_jobs=off']);
  const deadline=Date.now()+20000;
  while(true) {
    try { docker(['exec',name,'psql','-h','127.0.0.1','-X','-At','-U','supabase_admin','-d','postgres','-c','SELECT 1']); break; }
    catch (e) { if(Date.now()>deadline)throw e; await new Promise(r=>setTimeout(r,300)); }
  }
  docker(['exec',name,'createdb','-h','127.0.0.1','-U','supabase_admin','owner_actions_test']);
  sql(`
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='static_weekly_control_plane') THEN CREATE ROLE static_weekly_control_plane; END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='custodial_application_reader') THEN CREATE ROLE custodial_application_reader; END IF; END $$;
    CREATE TABLE public.ops_manager_managers(manager_id uuid PRIMARY KEY,display_name text NOT NULL,system_key text,roles text[] NOT NULL,active boolean NOT NULL,revoked_at timestamptz,is_system_principal boolean NOT NULL,metadata_json jsonb NOT NULL DEFAULT '{}');
    CREATE TABLE public.ops_manager_trusted_devices(credential_id uuid PRIMARY KEY,manager_id uuid REFERENCES ops_manager_managers,device_id text NOT NULL,max_access_level text NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL);
    CREATE TABLE public.ops_manager_auth_events(id uuid DEFAULT gen_random_uuid(),credential_id uuid,device_id text,event_type text,success boolean,detail_json jsonb);
    CREATE TABLE public.sessions(id uuid PRIMARY KEY,location_id uuid,device_id uuid,employee_id uuid);
    CREATE TABLE public.completion_responses(id uuid PRIMARY KEY,session_id uuid,location_id uuid,device_id uuid,submitted_by_employee_id uuid);
    CREATE TABLE public.maintenance_tickets(id uuid PRIMARY KEY,completion_response_id uuid,session_id uuid,location_id uuid,device_id uuid,reported_by_employee_id uuid,issue_source text,status text,closed_at timestamptz,closed_by text,closed_via text,close_notes text);
    CREATE TABLE public.weekly_schedule_exception_commands(exception_id uuid PRIMARY KEY,exception_type text,service_date date,publication_id uuid,payload_json jsonb);
    -- Boundary fixtures for unchanged existing dependencies; new functions above run unmodified.
    CREATE FUNCTION public.custodial_require_backend_execution_secret(text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF $1 IS DISTINCT FROM 'fixture-backend-proof' THEN RAISE EXCEPTION 'invalid fixture proof'; END IF; END $$;
    CREATE FUNCTION public.custodial_close_maintenance_ticket_authoritative(uuid,text,text,text) RETURNS jsonb LANGUAGE plpgsql AS $$
    BEGIN PERFORM public.custodial_require_backend_execution_secret($4);
      UPDATE public.maintenance_tickets SET status='closed',closed_by=$2,close_notes=$3,closed_at=clock_timestamp(),closed_via='admin_api' WHERE id=$1 AND status='open';
      IF NOT FOUND THEN RAISE EXCEPTION 'not open'; END IF;
      RETURN (SELECT jsonb_build_object('ticket_id',id,'status',status,'closed_by',closed_by,'closed_at',closed_at) FROM public.maintenance_tickets WHERE id=$1);
    END $$;
    INSERT INTO public.ops_manager_managers VALUES
      ('${owner}','Fixture owner','eric_custodial_manager',ARRAY['CUSTODIAL_MANAGER'],true,NULL,false,'{}'),
      ('${viewer}','Fixture delegate','other_manager',ARRAY['OPS_MANAGER'],true,NULL,false,'{}');
    INSERT INTO public.ops_manager_trusted_devices VALUES
      ('${ownerCredential}','${owner}','fixture-browser','full_access',NULL,now()-interval '1 minute',now()+interval '1 hour'),
      ('${viewerCredential}','${viewer}','fixture-browser','read_only',NULL,now()-interval '1 minute',now()+interval '1 hour');
    INSERT INTO public.sessions VALUES('${session}','${place}','${device}','${employee}');
    INSERT INTO public.completion_responses VALUES('${response}','${session}','${place}','${device}','${employee}');
    INSERT INTO public.maintenance_tickets(id,completion_response_id,session_id,location_id,device_id,reported_by_employee_id,issue_source,status) VALUES
      ('${scanTicket}','${response}','${session}','${place}','${device}','${employee}','completion_form','open'),
      ('${otherTicket}',NULL,NULL,'${place}',NULL,NULL,'other','open');
  `);
  sql('alter default privileges in schema public grant execute on functions to service_role;');
  sql(migration);
  sql(`create function public.static_weekly_v3_read_publication_source(uuid,date) returns jsonb language sql as $$select '${JSON.stringify({compiler_input:{slots:[{id:STAFF,contractorCapacity:false},{id:COVER,contractorCapacity:true}]}})}'::jsonb$$;
  create function public.static_weekly_v3_read_manager_snapshot(date) returns jsonb language sql as $$select '${JSON.stringify({current_publication:{publication_id:publication}})}'::jsonb$$;`);
  sql("create table static_weekly_approved_initial_baselines(source_id uuid,template_id text,effective_start date);create table static_weekly_approved_template_catalog(template_id text,staffing_count integer);create table static_weekly_approved_template_retirements(template_id text);");
  sql("alter table maintenance_tickets add column resolution_outcome text,add column external_work_order_reference text,add column resolution_actor_manager_id uuid;create table maintenance_ticket_outcome_history(ticket_id uuid,outcome text,actor_manager_id uuid,actor_name_snapshot text,external_work_order_reference text,notes text,previous_status text,created_at timestamptz);");
  sql(exactOutcomeWriter);
  sql(latest);
  const capabilities=(ids=[scanTicket,otherTicket],id=viewer,credential=viewerCredential,access='read_only')=>`public.custodial_ticket_capabilities_v1('${id}','${credential}','fixture-browser','${access}',array[${ids.map(v=>"'"+v+"'").join(',')}]::uuid[])`;
  const delegateCaps=JSON.parse(sql('set role service_role;select '+capabilities()+';').trim().split('\n').at(-1));
  assert.equal(delegateCaps.schema,'custodial.ticket-capabilities.v1');assert.equal(delegateCaps.manager_id,viewer);assert.equal(delegateCaps.credential_id,viewerCredential);
  assert.equal(delegateCaps.tickets.find(r=>r.ticket_id===scanTicket).can_close,true);assert.equal(delegateCaps.tickets.find(r=>r.ticket_id===scanTicket).scan_session_verified,true);
  assert.equal(delegateCaps.tickets.find(r=>r.ticket_id===otherTicket).can_close,false);assert.equal(delegateCaps.tickets.find(r=>r.ticket_id===otherTicket).scan_session_verified,false);results.push({label:'delegate display eligibility matches verified scan-only closure',pass:true});
  const ownerCaps=JSON.parse(sql('set role service_role;select '+capabilities([scanTicket,otherTicket],owner,ownerCredential,'full_access')+';').trim().split('\n').at(-1));assert.equal(ownerCaps.tickets.every(r=>r.can_close),true);results.push({label:'owner display eligibility retains both ticket origins',pass:true});
  rejected('browser cannot call ticket eligibility RPC','select '+capabilities()+';','authenticated');
  rejected('anonymous cannot call ticket eligibility RPC','select '+capabilities()+';','anon');
  rejected('scheduler role cannot invoke ticket endpoint SQL','select '+capabilities()+';','static_weekly_control_plane');
  rejected('duplicate ticket identities denied','select '+capabilities([scanTicket,scanTicket])+';');
  rejected('more than 100 ticket identities denied','select '+capabilities(Array(101).fill(scanTicket))+';');
  accepted('owner general writes',`SELECT (${actor('write',owner,ownerCredential,'full_access')}->>'owner');`,'true');
  accepted('delegate reads',`SELECT (${actor('read')}->>'owner');`,'false');
  rejected('delegate general writes denied',`SELECT ${actor('write')};`);
  rejected('owner limited credential not elevated',`SELECT ${actor('write',owner,ownerCredential,'read_only')};`);
  rejected('public action API denied',`SELECT ${actor('read')};`,'anon');
  rejected('authenticated browser direct action denied',`SELECT ${actor('write',owner,ownerCredential,'full_access')};`,'authenticated');
  accepted('delegate absence does not require owner away',`SELECT (${actor('manage_absences')}->>'owner_unavailability_required');`,'false');
  rejected('unrelated ticket denied',`SELECT ${close(otherTicket)};`);
  accepted('unrelated ticket unchanged',`SELECT (${close(scanTicket)}->>'status');`,'closed');
  assert.equal(sql(`select status from maintenance_tickets where id='${otherTicket}'`).trim(),'open');results.push({label:'denied unrelated ticket remains open',pass:true});
  accepted('repeat close preserves original closer',`SELECT (${close(scanTicket)}->>'replayed');`,'true');
  accepted('owner can close unrelated ticket',`SELECT (${close(otherTicket,owner,ownerCredential,'full_access')}->>'status');`,'closed');
  sql(`UPDATE public.maintenance_tickets SET status='open',device_id=NULL WHERE id='${scanTicket}';`);
  rejected('missing device provenance denied',`SELECT ${close(scanTicket)};`);
  accepted('missing provenance never offers closure',`select ${capabilities([scanTicket])}#>>'{tickets,0,can_close}';`,'false');
  sql(`UPDATE public.maintenance_tickets SET device_id='${device}' WHERE id='${scanTicket}'; UPDATE public.ops_manager_trusted_devices SET revoked_at=now() WHERE credential_id='${viewerCredential}';`);
  rejected('revoked credential denied',`SELECT ${actor('read')};`);
  sql(`UPDATE public.ops_manager_trusted_devices SET revoked_at=NULL,manager_id='${owner}' WHERE credential_id='${viewerCredential}';`);
  rejected('reassigned credential denied',`SELECT ${actor('read')};`);
  sql(`UPDATE public.ops_manager_trusted_devices SET manager_id='${viewer}' WHERE credential_id='${viewerCredential}'; UPDATE public.ops_manager_managers SET system_key=NULL WHERE manager_id='${viewer}';`);
  rejected('null registry key never owner',`SELECT ${actor('write',viewer,viewerCredential,'full_access')};`);
  sql(`UPDATE public.ops_manager_managers SET system_key='other_manager' WHERE manager_id='${viewer}';`);
  const away={enabled:true,ends_at:new Date(Date.now()+3600000).toISOString(),reason:'fixture coverage',expected_revision:0};
  accepted('owner enables bounded absence delegation',`SELECT (${coverage(away)}->>'enabled');`,'true');
  rejected('stale coverage revision rejected',`SELECT ${coverage(away)};`);
  accepted('delegate absence while owner away',`SELECT (${actor('manage_absences')}->>'owner');`,'false');
  for(const type of ['daily_absence','pto','partial_absence']) { sql(`SET ROLE static_weekly_control_plane; ${operation(type)}`);results.push({label:type+' allowed through scheduler database role',pass:true}); }
  for(const type of ['cover_all','shift_override','manager_correction']) rejected(type+' denied for delegate',operation(type),'static_weekly_control_plane');
  rejected('delegate cannot change coverage window',`SELECT public.custodial_owner_coverage_v1('${viewer}','${viewerCredential}','fixture-browser','read_only','${JSON.stringify(away)}','fixture-backend-proof');`);
  accepted('owner resumes control without losing own access',`SELECT (${coverage({enabled:false,expected_revision:1})}->>'enabled');`,'false');
  accepted('disabling obsolete away toggle does not revoke dated scheduler access',`SELECT (${actor('manage_absences')}->>'owner_unavailability_required');`,'false');
  accepted('owner control remains full when available',`SELECT (${actor('write',owner,ownerCredential,'full_access')}->>'owner');`,'true');
  for(const action of ['manage_coverall','regenerate_routes','close_scan_tickets'])accepted(action+' allowed with read-only credential',`select (${actor(action)}->>'owner');`,'false');
  for(const [label,ops] of [['absence',[absence]],['CoverAll',[cover]],['combined absence/CoverAll/lunch',[absence,cover,lunch]],['explicit no-break CoverAll',[{...cover,breakChoice:'NONE'}]]]){sql(`set role static_weekly_control_plane;${authorize(ops)}`);results.push({label:label+' admitted from canonical source',pass:true});}
  const badCases=[['unknown operation',[{operation:'hire',slotId:STAFF}]],['employee as CoverAll',[{...cover,slotId:STAFF}]],['CoverAll as employee absence',[{...absence,payload:{slotId:COVER}}]],['forged assignments',[{...cover,assignments:[]}]],['unknown contractor',[{...cover,slotId:publication}]],['invalid shift',[{...cover,shift:{start:'16:00',end:'07:00'}}]],['arbitrary employee lunch',[{...lunch,payload:{slotId:STAFF}}]],['unpaired contractor lunch',[lunch]],['lunch plus no break',[{...cover,breakChoice:'NONE'},lunch]],['contractor lunch outside shift',[cover,{...lunch,startsAt:'06:00',endsAt:'07:00'}]],['contractor lunch not one hour',[cover,{...lunch,endsAt:'11:30'}]],['conflicting type',[{...absence,exception_type:'manager_correction'}]],['permanent override',[{...absence,exceptionType:'shift_override'}]],['forged absence payload',[{...absence,payload:{slotId:STAFF,personId:owner}}]]];
  for(const[label,ops]of badCases)rejected(label+' rejected',authorize(ops),'static_weekly_control_plane');
  const reverseIds=['a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000004'];
  sql(`insert into weekly_schedule_exception_commands values('${reverseIds[0]}','daily_absence','2026-10-05','${publication}',${j({slotId:STAFF})}),('${reverseIds[1]}','cover_all','2026-10-05','${publication}',${j({availability:{slotId:COVER}})}),('${reverseIds[2]}','lunch','2026-10-05','${publication}',${j({slotId:STAFF})}),('${reverseIds[3]}','lunch','2026-10-05','${publication}',${j({slotId:COVER})});`);
  const rev=id=>[{operation:'exception',exceptionType:'reverse',payload:{reversesExceptionId:id},reversesExceptionId:id}];
  for(const i of [0,1,3]){sql(`set role static_weekly_control_plane;${authorize(rev(reverseIds[i]))}`);results.push({label:'allowed dated reversal '+i,pass:true});}
  rejected('employee lunch reversal denied',authorize(rev(reverseIds[2])),'static_weekly_control_plane');
  rejected('other day reversal denied',authorize(rev(reverseIds[0]),publication,'2026-10-06'),'static_weekly_control_plane');
  rejected('other publication reversal denied',authorize(rev(reverseIds[0]),owner),'static_weekly_control_plane');
  const rebuild=(pub=publication,date='2026-10-05')=>`select public.custodial_authorize_route_regeneration_v1('${viewer}','${viewerCredential}','fixture-browser','read_only','${date}','${pub}')->>'owner';`;
  assert.equal(sql('set role static_weekly_control_plane;'+rebuild()).trim().split('\n').at(-1),'false');results.push({label:'current source regeneration allowed',pass:true});
  rejected('noncurrent publication regeneration denied',rebuild(owner),'static_weekly_control_plane');
  rejected('invalid week regeneration denied',rebuild(publication,'2026-10-06'),'static_weekly_control_plane');
  rejected('implicit service grants cannot widen internal absence authorization',authorize([absence]),'service_role');
  rejected('legacy undifferentiated close is retired',`select public.custodial_close_scan_ticket_v1('${viewer}','${viewerCredential}','fixture-browser','read_only','${scanTicket}',null,'fixture-backend-proof');`);
  accepted('one immutable outcome retained after identical replay',`select (${close(otherTicket,owner,ownerCredential,'full_access')}->>'replayed');`,'true');
  assert.equal(sql(`select count(*) from maintenance_ticket_outcome_history where ticket_id='${otherTicket}'`).trim(),'1');results.push({label:'typed outcome history is not duplicated on replay',pass:true});
  rejected('submitted work order requires real reference',`select public.custodial_close_scan_ticket_outcome_v1('${viewer}','${viewerCredential}','fixture-browser','read_only','${scanTicket}','work_order_sent',null,null,'fixture-backend-proof');`);
  rejected('fixed cannot claim an external work order',`select public.custodial_close_scan_ticket_outcome_v1('${viewer}','${viewerCredential}','fixture-browser','read_only','${scanTicket}','mark_fixed','invented',null,'fixture-backend-proof');`);
  rejected('different outcome cannot replace closed history',`select public.custodial_close_scan_ticket_outcome_v1('${owner}','${ownerCredential}','fixture-browser','full_access','${otherTicket}','work_order_sent','fixture-order-2',null,'fixture-backend-proof');`);
  console.log(JSON.stringify({result:'MANAGER_SCHEDULER_POSTGRES_PASS',cases:results.length,results,scope:'Unmodified new migration in a disposable PostgreSQL database; synthetic rows and fixtures for unchanged backend-secret and legacy-close dependencies; no production data or scheduler compilation.'},null,2));
} finally { try { docker(['rm','-f',name]); } catch {} }
