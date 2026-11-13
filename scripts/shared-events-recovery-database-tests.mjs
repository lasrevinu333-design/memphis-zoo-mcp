#!/usr/bin/env node
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const container=String(process.env.BUILD52_RECOVERY_TEST_DOCKER_CONTAINER||'');
const database=String(process.env.BUILD52_RECOVERY_TEST_DATABASE||'postgres');
assert.match(container,/^mz_schema_rebuild_[a-zA-Z0-9_]+$/);
assert.match(database,/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/);
const secret=`events-recovery-fixture-${randomUUID()}`,manager='00000000-0000-4000-8000-000000000001';
const quote=v=>`'${String(v).replaceAll("'","''")}'`;
const args=['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-At','-U','supabase_admin','-d',database];
function execute(sql){return spawnSync('docker',args,{input:sql,encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});}
function sql(text){const r=execute(text);assert.equal(r.status,0,r.stderr);return r.stdout.trim().split('\n').at(-1)||'';}
const checks=[];
const check=(name,fn)=>{fn();checks.push(name);};
const migrationNames=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(n=>n.endsWith('_custodial_shared_events_recovery_binding.sql'));
assert.equal(migrationNames.length,1);
const migration=readFileSync(new URL(`../supabase/migrations/${migrationNames[0]}`,import.meta.url),'utf8');
const writer='public.custodial_outlook_event_sync_v1(text,jsonb)';
function digestInventory(){return sql(`select encode(extensions.digest(convert_to(coalesce(jsonb_agg(to_jsonb(i) order by object_kind,object_identity),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex') from public.custodial_release_authority_restore_inventory i;`);}
function health(){return JSON.parse(sql(`select public.custodial_backend_authority_health(${quote(secret)})::text;`));}
function control(action){return JSON.parse(sql(`select public.custodial_control_release_canary(${quote(manager)}::uuid,${quote(randomUUID())}::uuid,'KIOSK_08',${quote(action)},'Shared Events disposable recovery regression','{"ok":false}'::jsonb,${quote(secret)})::text;`));}
function canonical(){return JSON.parse(execFileSync(process.execPath,['scripts/refresh-schema-fingerprint.mjs','--check'],{cwd:root,env:{...process.env,SCHEMA_FINGERPRINT_MCP_URL:'',SCHEMA_FINGERPRINT_DOCKER_CONTAINER:container,SCHEMA_FINGERPRINT_DATABASE:database},encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024})).schema_fingerprint;}
sql(`select public.custodial_configure_backend_execution_key(encode(extensions.digest(${quote(secret)},'sha256'),'hex'),'shared-events-recovery-fixture');`);
function eventDefinitions(){return sql(`select jsonb_build_object('table',public.custodial_release_authority_current_relation_definition('public.events_app_events'),'columns',public.custodial_release_authority_current_column_set_definition('public.events_app_events'),'writer',pg_get_functiondef('public.custodial_outlook_event_sync_v1(text,jsonb)'::regprocedure))::text;`);}
const before=digestInventory(),fp=canonical(),definitionsBefore=eventDefinitions();
check('current schema and recovery definitions agree',()=>assert.equal(health().ok,true));
check('migration replay preserves every inventory byte',()=>{sql(migration);assert.equal(digestInventory(),before);});
check('unexpected predecessor fails without retained changes',()=>{
 const altered=`BEGIN; ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 UPDATE public.custodial_release_authority_restore_inventory SET definition_sql='select 42;',definition_sha256=encode(extensions.digest('select 42;','sha256'),'hex') WHERE object_kind='relation' AND object_identity='public.events_app_events';
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;`;
 const body=migration.replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,'');
 const r=execute(altered+body+'ROLLBACK;');assert.notEqual(r.status,0);assert.match(r.stderr,/Unexpected predecessor recovery binding/);assert.equal(digestInventory(),before);
});
check('ordinary inventory mutation remains prohibited',()=>{
 const r=execute("UPDATE public.custodial_release_authority_restore_inventory SET definition_sql='select 42;' WHERE object_kind='relation' AND object_identity='public.events_app_events';");
 assert.notEqual(r.status,0);assert.match(r.stderr,/inventory is immutable/);assert.equal(digestInventory(),before);
});
check('eight affected objects have complete ordered bindings',()=>{
 const rows=JSON.parse(sql(`select json_agg(json_build_object('kind',object_kind,'identity',object_identity,'order',restore_order))::text from public.custodial_release_authority_restore_inventory where (object_identity='public.events_app_events' and object_kind in ('relation','column_set')) or (object_kind='column' and object_identity in ('public.events_app_events:custodial_public_notes','public.events_app_events:custodial_note_codes','public.events_app_events:start_instant_utc','public.events_app_events:end_instant_utc')) or (object_identity=${quote(writer)}::regprocedure::text and object_kind in ('function','grant'));`));
 assert.equal(rows.length,8);assert.ok(Math.max(...rows.filter(x=>x.kind==='column').map(x=>x.order))<rows.find(x=>x.kind==='column_set').order);
 assert.ok(rows.find(x=>x.kind==='function').order<rows.find(x=>x.kind==='grant').order);
});
// Corruption stays in one rollback-only transaction. This preserves the physical
// attribute layout for the release suites that use this database afterward.
const recoverySql=`BEGIN;
SELECT public.custodial_control_release_canary(${quote(manager)}::uuid,${quote(randomUUID())}::uuid,'KIOSK_08','pause_canary','Shared Events isolated regression','{"ok":false}'::jsonb,${quote(secret)});
ALTER TABLE public.events_app_events DROP COLUMN start_instant_utc;
DO $missing$ BEGIN IF (public.custodial_backend_authority_health(${quote(secret)})->>'ok')::boolean THEN RAISE EXCEPTION 'Missing new column was not detected'; END IF; END $missing$;
ALTER TABLE public.events_app_events ALTER COLUMN custodial_note_codes DROP NOT NULL;
DROP FUNCTION ${writer};
DO $restore$ DECLARE result jsonb; BEGIN
 IF (public.custodial_backend_authority_health(${quote(secret)})->>'ok')::boolean THEN RAISE EXCEPTION 'Events corruption was not detected'; END IF;
 result:=public.custodial_control_release_canary(${quote(manager)}::uuid,${quote(randomUUID())}::uuid,'KIOSK_08','restore_authority','Shared Events exact logical restoration','{"ok":false}'::jsonb,${quote(secret)});
 IF (result->>'canary_paused')::boolean IS DISTINCT FROM true OR (public.custodial_backend_authority_health(${quote(secret)})->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Recovery controller did not restore authority'; END IF;
 IF jsonb_build_object('table',public.custodial_release_authority_current_relation_definition('public.events_app_events'),'columns',public.custodial_release_authority_current_column_set_definition('public.events_app_events'),'writer',pg_get_functiondef('${writer}'::regprocedure))::text IS DISTINCT FROM ${quote(definitionsBefore)} THEN RAISE EXCEPTION 'Recovered Events definitions differ'; END IF;
 IF NOT has_function_privilege('service_role','${writer}'::regprocedure,'EXECUTE') OR has_function_privilege('anon','${writer}'::regprocedure,'EXECUTE') OR has_function_privilege('authenticated','${writer}'::regprocedure,'EXECUTE') THEN RAISE EXCEPTION 'Recovered writer grants differ'; END IF;
END $restore$;
SELECT 'SHARED_EVENTS_CORRUPTION_RESTORED';
ROLLBACK;`;
const result=execute(recoverySql);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/SHARED_EVENTS_CORRUPTION_RESTORED/);
checks.push('missing new column is detected','changed column and missing writer are detected','normal recovery controller restores exact logical Events definitions','restored writer remains service-only');
check('rollback isolates destructive probes from other suites',()=>{assert.equal(canonical(),fp);assert.equal(digestInventory(),before);});
console.log(JSON.stringify({result:'SHARED_EVENTS_RECOVERY_DATABASE_PASS',cases:checks.length,checks,schema_fingerprint:fp,migration_sha256:createHash('sha256').update(migration).digest('hex'),scope:'Disposable PostgreSQL with unchanged recovery controller: exact logical Events definitions, writer grants, immutable inventory and replay. A dropped/recreated column has a different PostgreSQL physical ordinal; this test does not certify ordinal preservation. The unchanged full release suite checks the clean schema separately. No production records or credentials.'},null,2));
