import assert from 'node:assert/strict';
import { planEventOwnerRestore,executeEventOwnerPlan,splitSchemaStatements } from './isolated-event-owner-schema.mjs';
const fixture=`-- fake CREATE EVENT TRIGGER hidden;\nCREATE FUNCTION public."event function"() RETURNS event_trigger LANGUAGE plpgsql AS $body$ BEGIN PERFORM 'CREATE EVENT TRIGGER hidden;'; /* ALTER EVENT TRIGGER hidden OWNER TO x; */ RETURN; END $body$;\nALTER FUNCTION public."event function"() OWNER TO "owner role";\n--\n-- Name: event trigger; Type: EVENT TRIGGER; Schema: -; Owner: owner role\n--\nCREATE EVENT TRIGGER "event trigger" ON ddl_command_start WHEN TAG IN ('ALTER TABLE','CREATE TABLE') EXECUTE FUNCTION public."event function"();\nALTER EVENT TRIGGER "event trigger" ENABLE ALWAYS;\nALTER EVENT TRIGGER "event trigger" OWNER TO "owner role";\nSELECT 'following section';`;
const plan=planEventOwnerRestore(fixture);
assert.equal(plan.eventCount,1);assert.equal(plan.statementCount,6);assert.equal(plan.commands[2].owner,'owner role');assert.equal(plan.commands[2].statements.length,3);
assert.throws(()=>planEventOwnerRestore(fixture.replace('ALTER EVENT TRIGGER "event trigger" OWNER TO "owner role";','')),/Missing owning/);
assert.throws(()=>planEventOwnerRestore(fixture.replace('Type: EVENT TRIGGER; Schema: -; Owner: owner role','Type: EVENT TRIGGER; Schema: -; Owner: wrong')),/header mismatch/);
assert.throws(()=>planEventOwnerRestore(fixture.replace('ALTER EVENT TRIGGER "event trigger" OWNER','ALTER EVENT TRIGGER "wrong name" OWNER')),/name mismatch/);
assert.throws(()=>planEventOwnerRestore(fixture.replace('ALTER FUNCTION public."event function"() OWNER TO "owner role";','ALTER FUNCTION public."event function"() OWNER TO other;')),/function archive owner mismatch/);
assert.throws(()=>planEventOwnerRestore(fixture.replace('SELECT \'following section\';','ALTER EVENT TRIGGER "event trigger" OWNER TO "owner role";')),/Duplicate event-trigger owner/);
assert.throws(()=>planEventOwnerRestore(fixture.replace('CREATE EVENT TRIGGER "event trigger"','CREATE EVENT TRIGGER "event trigger" EXTRA')),/Expected keyword on/);
assert.throws(()=>planEventOwnerRestore(fixture.replace('ALTER FUNCTION public."event function"() OWNER TO "owner role";', '')),/function archive owner mismatch/);
assert.throws(()=>planEventOwnerRestore(fixture.replace('ALTER FUNCTION public."event function"() OWNER TO "owner role";', 'ALTER FUNCTION public."event function"() OWNER TO "owner role"; ALTER FUNCTION public."event function"() OWNER TO "owner role";')),/Duplicate function owner/);
const escapedIdentifiers=fixture.replaceAll('"event trigger"','"event ""trigger"').replace('Name: event trigger;','Name: event "trigger;')
  .replaceAll('"owner role"','"owner ""role"').replace('Owner: owner role','Owner: owner "role');
assert.equal(planEventOwnerRestore(escapedIdentifiers).commands[2].owner,'owner "role');
assert.equal(planEventOwnerRestore('/* nested /* CREATE EVENT TRIGGER fake; */ ALTER EVENT TRIGGER fake OWNER TO x; */'+fixture).eventCount,1);
assert.throws(()=>splitSchemaStatements('SELECT $$unterminated;'),/Unterminated dollar/);
assert.throws(()=>splitSchemaStatements('\\restrict one\nSELECT 1;\n\\unrestrict two\n'),/Mismatched/);
assert.throws(()=>splitSchemaStatements('\\! unexpected\nSELECT 1;'),/Unsupported/);
assert.equal(splitSchemaStatements('\\restrict abc\nSELECT \'quoted; text\';\n\\unrestrict abc\n').statements.length,1);
const embedded='CREATE FUNCTION public.foo() RETURNS text LANGUAGE sql AS $x$ SELECT \'\\restrict fake\'; SELECT \'CREATE EVENT TRIGGER evil;\'; $x$;';
assert.equal(splitSchemaStatements(embedded).statements[0].text,embedded);
assert.equal(planEventOwnerRestore('SET SESSION AUTHORIZATION postgres; GRANT USAGE ON SCHEMA public TO anon; RESET SESSION AUTHORIZATION;'+fixture).commands[0].kind,'acl');
assert.throws(()=>planEventOwnerRestore('SET SESSION AUTHORIZATION postgres; CREATE SCHEMA unexpected; RESET SESSION AUTHORIZATION;'+fixture),/only GRANT\/REVOKE/);
assert.throws(()=>planEventOwnerRestore(fixture+'SET SESSION AUTHORIZATION postgres; GRANT USAGE ON SCHEMA public TO anon;'),/Unterminated archive ACL/);
for(const failing of [false,true]){
  const calls=[];
  const client={async query(sql){calls.push(sql);if(sql.includes('pg_get_userbyid(p.proowner)'))return {rows:[{owner_name:'owner role'}]};if(sql==='select current_user, session_user')return {rows:[{current_user:'supabase_admin',session_user:'supabase_admin'}]};if(failing&&sql.includes('CREATE EVENT TRIGGER "event trigger"'))throw Error('synthetic create failure');return {rows:[]};}};
  if(failing)await assert.rejects(executeEventOwnerPlan(client,plan),/synthetic create failure/);else assert.equal((await executeEventOwnerPlan(client,plan)).eventBlocks,1);
  const enter=calls.indexOf('SET ROLE "owner role"'),reset=calls.indexOf('RESET ROLE',enter);assert.ok(enter>=0&&reset>enter,'RESET must follow owner entry even on failure');
  const following=calls.findIndex(x=>x.includes("SELECT 'following section'"));if(!failing)assert.ok(following>reset,'Owner context must be reset before following SQL');
}
const wrongRestoredOwner={async query(sql){
  if(sql==='select current_user, session_user')return {rows:[{current_user:'supabase_admin',session_user:'supabase_admin'}]};
  if(sql.includes('pg_get_userbyid(p.proowner)'))return {rows:[{owner_name:'wrong_owner'}]};
  assert.ok(!sql.startsWith('SET ROLE '),'No owner scope may open before recorded/restored owner matching');return {rows:[]};
}};
await assert.rejects(executeEventOwnerPlan(wrongRestoredOwner,plan),/Restored function owner differs/);
const aclCalls=[];
const failingAcl={async query(sql){aclCalls.push(sql);if(sql==='select current_user, session_user')return {rows:[{current_user:'supabase_admin',session_user:'supabase_admin'}]};if(sql.includes('GRANT USAGE ON SCHEMA public'))throw Error('synthetic ACL failure');return {rows:[]};}};
await assert.rejects(executeEventOwnerPlan(failingAcl,planEventOwnerRestore('SET SESSION AUTHORIZATION postgres; GRANT USAGE ON SCHEMA public TO anon; RESET SESSION AUTHORIZATION;'+fixture)),/synthetic ACL failure/);
assert.equal(aclCalls.at(-1),'RESET SESSION AUTHORIZATION','ACL grantor context must reset even on failure');
console.log('EVENT_OWNER_SCHEMA_PLAN_TESTS_PASS');
