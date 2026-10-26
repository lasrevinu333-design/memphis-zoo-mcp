import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { feedbackRelayPrincipal, feedbackRelaySchemas, callFeedbackRelay, FEEDBACK_RELAY_CONTRACT, FEEDBACK_RELAY_SCHEMA_SHA256 } from '../src/feedback-email-relay.js';
import { registerFeedbackRelayTools } from '../src/mcp/feedback-relay-tools.js';
import { configureMcpToolAuth } from '../src/mcp/register.js';
import { MCP_TOOL_MANIFEST, TOOL_SAFETY, getToolManifest } from '../src/mcp/tool-manifest.js';

const authInfo = { clientId:'fixture-client', scopes:['mcp:read','mcp:write'],
  extra:{ authSource:'self_contained_oauth',issuer:'https://fixture.invalid',subject:'fixture-owner' } };
const extra={authInfo};
const args={contract_version:FEEDBACK_RELAY_CONTRACT,request_id:randomUUID()};
const sql=readFileSync(new URL('../supabase/migrations/20261002220000_feedback_relay_preflight_and_reconciliation.sql',import.meta.url),'utf8');
const sqlCommandPatterns=[...sql.matchAll(/p_args->>'(?:request_id|intent_id)' !~\*\s*'([^']+)'/g)].map(match=>match[1]);
assert.equal(sqlCommandPatterns.length,2,'bind both current SQL command UUID checks');
assert.equal(sqlCommandPatterns[0],sqlCommandPatterns[1]);
const publishedCommandPattern=sqlCommandPatterns[0].replaceAll('[0-9a-f]','[0-9a-fA-F]').replace('[89ab]','[89abAB]');
const commandUuidSchemas=[feedbackRelaySchemas.claim.shape.request_id,
  feedbackRelaySchemas.begin.shape.request_id,feedbackRelaySchemas.begin.shape.intent_id,
  feedbackRelaySchemas.receipt.shape.request_id,feedbackRelaySchemas.receipt.shape.intent_id,
  feedbackRelaySchemas.defer.shape.request_id,feedbackRelaySchemas.defer.shape.intent_id,
  feedbackRelaySchemas.control.shape.request_id];
for(const schema of commandUuidSchemas){
  const json=z.toJSONSchema(schema);
  assert.equal(json.pattern,publishedCommandPattern,'published UUID pattern must match SQL v2');
  assert.equal(json.format,'uuid');
}
for(const [value,accepted] of [
  ['01234567-89ab-1def-8abc-0123456789ab',true],
  ['01234567-89ab-4def-8abc-0123456789ab',true],
  ['01234567-89ab-5def-8abc-0123456789ab',true],
  ['01234567-89AB-4DEF-8ABC-0123456789AB',true],
  ['01234567-89ab-6def-8abc-0123456789ab',false],
  ['01234567-89ab-7def-8abc-0123456789ab',false],
  ['01234567-89ab-8def-8abc-0123456789ab',false],
  ['00000000-0000-0000-0000-000000000000',false],
  ['ffffffff-ffff-ffff-ffff-ffffffffffff',false],
  ['01234567-89ab-4def-7abc-0123456789ab',false],
]){
  for(const schema of commandUuidSchemas)assert.equal(schema.safeParse(value).success,accepted,value);
  assert.equal(new RegExp(sqlCommandPatterns[0],'i').test(value),accepted,`SQL regex ${value}`);
}
assert.match(sql,/claim_token=gen_random_uuid\(\)/);
assert.match(sql,/item\.claim_token::text is distinct from p_args->>'claim_token'/);
const claimSchema=feedbackRelaySchemas.begin.shape.claim_token;
assert.equal(z.toJSONSchema(claimSchema).pattern,
  '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
assert.equal(claimSchema.safeParse(randomUUID()).success,true);
assert.equal(claimSchema.safeParse('01234567-89AB-4DEF-8ABC-0123456789AB').success,false);
assert.equal(claimSchema.safeParse('01234567-89ab-7def-8abc-0123456789ab').success,false);
assert.equal(feedbackRelaySchemas.defer.shape.claim_token,claimSchema);
assert.notEqual(FEEDBACK_RELAY_SCHEMA_SHA256,'31bfaed4bab5f1977596f2ed02fe98c97c613820a31a402fd9b79bd9d6eba371',
  'changed wire schema requires a new binding, never the old digest');
const principal=feedbackRelayPrincipal(extra);
assert.match(principal,/^relay:[0-9a-f]{64}$/);
assert.equal(principal,feedbackRelayPrincipal({authInfo:{...authInfo,token:'different-hidden-token'}}));
assert.notEqual(principal,feedbackRelayPrincipal({authInfo:{...authInfo,extra:{...authInfo.extra,subject:'another-owner'}}}));
assert.throws(()=>feedbackRelayPrincipal({}),/authorization/);
assert.throws(()=>feedbackRelayPrincipal({authInfo:{...authInfo,scopes:['mcp:read']}}),/read and write/);
assert.throws(()=>feedbackRelayPrincipal({authInfo:{...authInfo,extra:{...authInfo.extra,subject:''}}}),/principal/);
assert.throws(()=>feedbackRelayPrincipal({authInfo:{...authInfo,expiresAt:1}}),/expired/);
assert.throws(()=>feedbackRelaySchemas.claim.parse({...args,recipient:'other@example.org'}));
assert.throws(()=>feedbackRelaySchemas.begin.parse({...args,intent_id:randomUUID(),claim_token:randomUUID(),claim_generation:'1',envelope_sha256:'a'.repeat(64)}));
let calls=[];
const client={rpc:async(name,input)=>{calls.push({name,input});return {data:{ok:true,paused:true},error:null};}};
assert.deepEqual(await callFeedbackRelay('claim',args,extra,{client}),{ok:true,paused:true});
assert.equal(calls[0].name,'custodial_feedback_relay_claim');
assert.equal(calls[0].input.p_principal,principal);
assert.deepEqual(calls[0].input.p_args,{...args,adapter_schema_sha256:FEEDBACK_RELAY_SCHEMA_SHA256});
await assert.rejects(()=>callFeedbackRelay('control',{...args,action:'resume_preflight_verified',reason:'bare assertion'},extra,{client}),/exact fresh preflight/);
await assert.rejects(()=>callFeedbackRelay('status',{contract_version:'custodial-feedback-relay.v1'},extra,{client}));
await assert.rejects(()=>callFeedbackRelay('claim',{...args,adapter_schema_sha256:'a'.repeat(64)},extra,{client}));
await assert.rejects(()=>callFeedbackRelay('claim',{...args,sql:'select private'},extra,{client}));
assert.equal(calls.length,1);
await assert.rejects(()=>callFeedbackRelay('send',args,extra,{client}),/Unknown/);
const registered=new Map();
const server={registerTool(name,definition,handler){registered.set(name,{definition,handler});}};
configureMcpToolAuth(server,{securitySchemes:[{type:'oauth2',scopes:['mcp:read','mcp:write']}],challenge:'Bearer realm="fixture"'});
registerFeedbackRelayTools(server,{client});
assert.equal(registered.size,6);
for(const [name,{definition,handler}] of registered){
  const metadata=MCP_TOOL_MANIFEST.find(t=>t.name===name);
  assert.equal(metadata.safety,TOOL_SAFETY.SAFE_WRITE);
  const verb=name.slice('custodial_feedback_relay_'.length);
  assert.deepEqual(metadata.inputs,Object.keys(feedbackRelaySchemas[verb].shape));
  assert.deepEqual(metadata.input_schema,z.toJSONSchema(feedbackRelaySchemas[verb]));
  assert.equal(metadata.contract_version,FEEDBACK_RELAY_CONTRACT);
  assert.equal(metadata.adapter_schema_sha256,FEEDBACK_RELAY_SCHEMA_SHA256);
  assert.deepEqual(metadata.required_scopes,['mcp:read','mcp:write']);
  assert.deepEqual(definition.securitySchemes,[{type:'oauth2',scopes:['mcp:read','mcp:write']}]);
  const input=name.endsWith('_status')?{contract_version:FEEDBACK_RELAY_CONTRACT}:args;
  assert.equal((await handler(input,{})).isError,true);
  assert.equal((await handler(input,{authInfo:{...authInfo,scopes:['mcp:read']}})).isError,true);
}
assert.equal(calls.length,1,'denied callers never reach the database');
const ro=new Map();
registerFeedbackRelayTools({registerTool:(name)=>ro.set(name,true)},{includeWrites:false,client});
assert.equal(ro.size,0);
const sdk=await import('../src/mcp/create-mcp-server.js');
const live=sdk.createMcpServer({backendCommitSha:'a'.repeat(40),releaseId:'synthetic-release',
  oauth:{enabled:true,scopes:['mcp:read','mcp:write']}});
assert.equal(Object.keys(live._registeredTools).filter(n=>n.startsWith('custodial_feedback_relay_')).length,6);
const wire=await live.server._requestHandlers.get('tools/list')({method:'tools/list'},{});
const privateTools=wire.tools.filter(t=>t.name.startsWith('custodial_feedback_relay_'));
assert.equal(privateTools.length,6);
for(const tool of privateTools){
  assert.equal(tool.inputSchema.additionalProperties,false,'wire schemas reject unknown fields');
  assert.deepEqual(tool.securitySchemes,[{type:'oauth2',scopes:['mcp:read','mcp:write']}]);
  // SDK emits draft-7; the reviewed digest/catalog uses Zod's default draft.
  // Compare against the owning schema in the exact SDK dialect, not by dropping
  // tuple or other validation fields from the comparison.
  const {$schema:wireDraft,...wireSchema}=tool.inputSchema;
  const {$schema:expectedDraft,...expectedSchema}=z.toJSONSchema(
    feedbackRelaySchemas[tool.name.slice('custodial_feedback_relay_'.length)],{target:'draft-7'});
  assert.deepEqual(wireSchema,expectedSchema);
}
const manifestHandler=live._registeredTools.server_tool_manifest.handler;
assert.equal((await manifestHandler({include_planned:false},{})).isError,true);
const manifestResult=await manifestHandler({include_planned:false},extra);
const manifest=JSON.parse(manifestResult.content[0].text);
assert.equal(manifest.evidence_kind,'source_catalog_not_runtime_admission');
assert.equal(manifest.app.backend_commit_sha,'a'.repeat(40));
assert.equal(manifest.app.release_id,'synthetic-release');
assert.equal(manifest.tools.filter(t=>t.name.startsWith('custodial_feedback_relay_')).length,6);
assert.equal(getToolManifest({includePlanned:false}).tools.find(t=>t.name==='custodial_feedback_relay_control').inputs.includes('preflight'),true);
const unknownSource=sdk.createMcpServer({backendCommitSha:'not-a-commit'});
assert.equal(JSON.parse((await unknownSource._registeredTools.server_tool_manifest.handler(
  {include_planned:false},extra)).content[0].text).app.backend_commit_sha,null);
await unknownSource.close();
assert.equal(Object.keys(sdk.createMcpServer({readOnly:true})._registeredTools).filter(n=>n.startsWith('custodial_feedback_relay_')).length,0);
await live.close();
console.log('FEEDBACK_EMAIL_RELAY_ADAPTER_PASS (principal, strict input, six guarded tools, read-only omission; no transport)');
console.log(JSON.stringify({contract:FEEDBACK_RELAY_CONTRACT,adapter_schema_sha256:FEEDBACK_RELAY_SCHEMA_SHA256,
  sql_command_uuid_versions:'1-5',claim_token:'server-issued lowercase v4'}));
