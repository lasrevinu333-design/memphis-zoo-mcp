import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const container=String(process.env.MANAGER_RECOVERY_TEST_CONTAINER||''),database=String(process.env.MANAGER_RECOVERY_TEST_DATABASE||'postgres');
assert.match(container,/^mz_schema_rebuild_[a-zA-Z0-9_]+$/);assert.match(database,/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/);
const secret='synthetic-manager-recovery-'+randomUUID(),manager='00000000-0000-4000-8000-000000000001';
const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
function execute(sql){return spawnSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',database],{input:sql,encoding:'utf8',timeout:45000,maxBuffer:16*1024*1024});}
function sql(text){const r=execute(text);assert.equal(r.status,0,r.stderr);return r.stdout.trim().split('\n').at(-1);}
const checks=[];const health=()=>JSON.parse(sql(`select public.custodial_backend_authority_health(${quote(secret)})::text;`));
const digest=()=>sql("select public.static_weekly_digest_text(coalesce(jsonb_agg(to_jsonb(i) order by object_kind,object_identity),'[]')::text) from public.custodial_release_authority_restore_inventory i;");
sql(`select public.custodial_configure_backend_execution_key(encode(extensions.digest(${quote(secret)},'sha256'),'hex'),'isolated-manager-recovery');`);
const originalHealth=health();assert.equal(originalHealth.ok,true,JSON.stringify(originalHealth));checks.push('complete clean source recovery health passes before challenge');
const identities=[
'custodial_action_actor_v1(uuid,uuid,text,text,text)','custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)',
'custodial_authorize_route_regeneration_v1(uuid,uuid,text,text,date,uuid)','custodial_close_scan_ticket_outcome_v1(uuid,uuid,text,text,uuid,text,text,text,text)',
'custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text)','custodial_owner_coverage_v1(uuid,uuid,text,text,jsonb,text)',
'custodial_read_approved_schedule_choices_v1(uuid,uuid,text,text)','custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[])'];
const list='array['+identities.map(quote).join(',')+']::text[]';
const before=digest();
assert.equal(Number(sql(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and object_identity=any(${list});`)),16);checks.push('all eight function/grant pairs are explicitly captured');
assert.equal(Number(sql(`select count(*) from public.custodial_release_canary_authority_surface() where object_kind in ('function','grant') and object_identity=any(${list});`)),16);checks.push('all eight pairs participate in the unchanged canary health model');
const data=sql(`select jsonb_agg(jsonb_build_object('identity',x,'definition',pg_get_functiondef(('public.'||x)::regprocedure),'grant',public.custodial_release_authority_current_grant_definition(x)) order by x) from unnest(${list})x;`);
const result=execute(`BEGIN;
SELECT public.custodial_control_release_canary(${quote(manager)}::uuid,${quote(randomUUID())}::uuid,'KIOSK_08','pause_canary','Isolated manager recovery challenge','{"ok":false}'::jsonb,${quote(secret)});
DROP FUNCTION public.custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[]);
DO $missing$ BEGIN IF (public.custodial_backend_authority_health(${quote(secret)})->>'ok')::boolean THEN RAISE EXCEPTION 'Missing manager read boundary was not detected';END IF;END $missing$;
GRANT EXECUTE ON FUNCTION public.custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text) TO service_role;
DO $changed$ BEGIN IF (public.custodial_backend_authority_health(${quote(secret)})->>'ok')::boolean THEN RAISE EXCEPTION 'Manager privilege corruption was not detected';END IF;END $changed$;
SELECT public.custodial_control_release_canary(${quote(manager)}::uuid,${quote(randomUUID())}::uuid,'KIOSK_08','restore_authority','Restore exact source-bound manager permissions','{"ok":false}'::jsonb,${quote(secret)});
DO $restored$ DECLARE observed text;BEGIN
 IF (public.custodial_backend_authority_health(${quote(secret)})->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Manager recovery did not restore overall health';END IF;
 SELECT jsonb_agg(jsonb_build_object('identity',x,'definition',pg_get_functiondef(('public.'||x)::regprocedure),'grant',public.custodial_release_authority_current_grant_definition(x)) order by x)::text INTO observed FROM unnest(${list})x;
 IF observed IS DISTINCT FROM ${quote(data)} THEN RAISE EXCEPTION 'Restored manager definitions or grants differ';END IF;
 IF has_function_privilege('authenticated','public.custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','EXECUTE')
  OR has_function_privilege('service_role','public.custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','EXECUTE')
  OR has_function_privilege('service_role','public.custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Recovery broadened private manager SQL authority';END IF;
END $restored$;
SELECT 'MANAGER_RECOVERY_EXACT';ROLLBACK;`);
assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/MANAGER_RECOVERY_EXACT/);checks.push('missing manager function detected','extra browser EXECUTE detected','retired closer cannot be re-enabled','normal recovery controller restores exact eight definitions and grants','restored private scheduler boundary rejects service and browser roles');
assert.equal(digest(),before);assert.equal(health().ok,true);checks.push('rollback leaves recovery inventory byte-identical and healthy');
const rejected=execute("update public.custodial_release_authority_restore_inventory set definition_sql='select 7;' where object_kind='function' and object_identity='custodial_action_actor_v1(uuid,uuid,text,text,text)';");assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/immutable/);assert.equal(digest(),before);checks.push('ordinary recovery inventory edits remain rejected');
console.log(JSON.stringify({result:'MANAGER_PERMISSION_RECOVERY_PASS',cases:checks.length,checks,scope:'Full isolated source, actual existing canary recovery controller, rollback-only missing-function/extra-grant challenges; no production credentials or data.'},null,2));
