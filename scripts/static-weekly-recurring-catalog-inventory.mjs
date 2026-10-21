import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';

// Read-only changed-input inventory against an already owned disposable DB.
// This is review evidence, not a substitute for concurrency/denied-caller tests.
const container=process.env.SHIFT_END_TEST_CONTAINER;
assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);
const inspection=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',timeout:10000}))[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(inspection.HostConfig.PortBindings??{}).length,0);
const tables=['weekly_roster_slots','weekly_roster_slot_incumbencies',
 'weekly_roster_slot_incumbency_closures','weekly_roster_slot_staffing_states',
 'employees','weekly_schedule_slot_availability','static_weekly_authority_source_documents',
 'weekly_schedule_publications'];
const roles=['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator'];
const sql=`begin read only; set local statement_timeout='10s';
select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_object(
 'identity',p.oid::regprocedure::text,'name',p.proname,'owner',pg_get_userbyid(p.proowner),
 'securityDefiner',p.prosecdef,'source',pg_get_functiondef(p.oid),
 'runtimeExecute',(select jsonb_object_agg(r,has_function_privilege(r,p.oid,'EXECUTE'))
 from unnest(array[${roles.map(r=>`'${r}'`).join(',')}]) r)) order by p.proname,p.oid)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
 where n.nspname='public' and p.prokind='f' and l.lanname in ('sql','plpgsql')),
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
 'triggers',coalesce((select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,
 'definition',pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) order by t.tgname)
 from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),'[]'::jsonb)) order by c.relname)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname=any(array[${tables.map(t=>`'${t}'`).join(',')}]))); rollback;`;
const raw=execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1',
 '-U','supabase_admin','-d','postgres'],{input:sql,encoding:'utf8',timeout:15000,maxBuffer:16*1024*1024}).trim();
const catalog=JSON.parse(raw);
assert.ok(Array.isArray(catalog.functions)&&catalog.functions.length<3000);
assert.equal(catalog.tables.length,tables.length,'all named authority tables must exist');
const writePattern=new RegExp(`\\b(?:insert\\s+into|update|delete\\s+from)\\s+(?:public\\.)?(?:${tables.join('|')})\\b`,'i');
const direct=catalog.functions.filter(f=>writePattern.test(f.source));
const selected=new Set(direct.map(f=>f.name));
for(let n=0;n<catalog.functions.length;n++){
 const before=selected.size;
 for(const f of catalog.functions)if([...selected].some(name=>new RegExp(`\\b${name}\\s*\\(`).test(f.source)))selected.add(f.name);
 if(selected.size===before)break;
}
const functions=catalog.functions.filter(f=>selected.has(f.name)).map(f=>({...f,
 sourceSha256:createHash('sha256').update(f.source).digest('hex'),
 directLexicalWriter:writePattern.test(f.source),
 commonLockOffset:f.source.indexOf("pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority'"),
 firstForUpdateOffset:f.source.search(/\bfor\s+update\b/i)}));
const evidence={classification:'READ_ONLY_ISOLATED_CATALOG_NOT_CONCURRENCY_PROOF',container,
 inspectedTables:tables,functions,tables:catalog.tables,
 limitations:'Lexical direct-write/call inventory does not resolve dynamic SQL, unqualified/quoted aliases or all trigger effects. Review complete sources and prove actual callable/lock behavior before admission.',
 production:false,independentAudit:false};
if(process.env.STATIC_WEEKLY_CATALOG_EVIDENCE)writeFileSync(process.env.STATIC_WEEKLY_CATALOG_EVIDENCE,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'CAPTURED',directWriters:direct.length,transitiveFunctions:functions.length,tables:catalog.tables.length,
 runtimeDirectWriters:functions.filter(f=>f.directLexicalWriter&&roles.some(r=>f.runtimeExecute[r])).map(f=>({name:f.name,runtimeExecute:f.runtimeExecute,commonLockOffset:f.commonLockOffset,firstForUpdateOffset:f.firstForUpdateOffset})),
 production:false,concurrencyProven:false}));
