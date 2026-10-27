// Disposable PostgreSQL tests of the actual owner/delegate migration.
// No production connection, password, user, ticket, or schedule is used.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const name = 'mz_owner_actions_' + randomUUID().replaceAll('-', '').slice(0, 12);
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
const close = (ticket, id=viewer, credential=viewerCredential, access='read_only') => `public.custodial_close_scan_ticket_v1('${id}','${credential}','fixture-browser','${access}','${ticket}','fixture notes','fixture-backend-proof')`;
const coverage = change => `public.custodial_owner_coverage_v1('${owner}','${ownerCredential}','fixture-browser','full_access',${change == null ? 'NULL' : `'${JSON.stringify(change)}'::jsonb`},'fixture-backend-proof')`;
const operation = type => `SELECT public.custodial_authorize_absence_operations_v1('${viewer}','${viewerCredential}','fixture-browser','read_only','2026-10-05','${publication}','[{"operation":"exception","exceptionType":"${type}","payload":{"slotId":"fixture"}}]'::jsonb);`;
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
    CREATE TABLE public.ops_manager_managers(manager_id uuid PRIMARY KEY,display_name text NOT NULL,system_key text,roles text[] NOT NULL,active boolean NOT NULL,revoked_at timestamptz,is_system_principal boolean NOT NULL,metadata_json jsonb NOT NULL DEFAULT '{}');
    CREATE TABLE public.ops_manager_trusted_devices(credential_id uuid PRIMARY KEY,manager_id uuid REFERENCES ops_manager_managers,device_id text NOT NULL,max_access_level text NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL);
    CREATE TABLE public.ops_manager_auth_events(id uuid DEFAULT gen_random_uuid(),credential_id uuid,device_id text,event_type text,success boolean,detail_json jsonb);
    CREATE TABLE public.sessions(id uuid PRIMARY KEY,location_id uuid,device_id uuid,employee_id uuid);
    CREATE TABLE public.completion_responses(id uuid PRIMARY KEY,session_id uuid,location_id uuid,device_id uuid,submitted_by_employee_id uuid);
    CREATE TABLE public.maintenance_tickets(id uuid PRIMARY KEY,completion_response_id uuid,session_id uuid,location_id uuid,device_id uuid,reported_by_employee_id uuid,issue_source text,status text,closed_at timestamptz,closed_by text,closed_via text,close_notes text);
    CREATE TABLE public.weekly_schedule_exception_commands(exception_id uuid PRIMARY KEY,exception_type text,service_date date,publication_id uuid);
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
  sql(migration);
  accepted('owner general writes',`SELECT (${actor('write',owner,ownerCredential,'full_access')}->>'owner');`,'true');
  accepted('delegate reads',`SELECT (${actor('read')}->>'owner');`,'false');
  rejected('delegate general writes denied',`SELECT ${actor('write')};`);
  rejected('owner limited credential not elevated',`SELECT ${actor('write',owner,ownerCredential,'read_only')};`);
  rejected('public action API denied',`SELECT ${actor('read')};`,'anon');
  rejected('authenticated browser direct action denied',`SELECT ${actor('write',owner,ownerCredential,'full_access')};`,'authenticated');
  rejected('delegate absent owner not away',`SELECT ${actor('manage_absences')};`);
  rejected('unrelated ticket denied',`SELECT ${close(otherTicket)};`);
  accepted('unrelated ticket unchanged',`SELECT (${close(scanTicket)}->>'status');`,'closed');
  accepted('repeat close preserves original closer',`SELECT (${close(scanTicket)}->>'replayed');`,'true');
  accepted('owner can close unrelated ticket',`SELECT (${close(otherTicket,owner,ownerCredential,'full_access')}->>'status');`,'closed');
  sql(`UPDATE public.maintenance_tickets SET status='open',device_id=NULL WHERE id='${scanTicket}';`);
  rejected('missing device provenance denied',`SELECT ${close(scanTicket)};`);
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
  rejected('delegation ends immediately',`SELECT ${actor('manage_absences')};`);
  accepted('owner control remains full when available',`SELECT (${actor('write',owner,ownerCredential,'full_access')}->>'owner');`,'true');
  console.log(JSON.stringify({result:'OWNER_ACTIONS_POSTGRES_PASS',cases:results.length,results,scope:'Unmodified new migration in a disposable PostgreSQL database; synthetic rows and fixtures for unchanged backend-secret and legacy-close dependencies; no production data or scheduler compilation.'},null,2));
} finally { try { docker(['rm','-f',name]); } catch {} }
