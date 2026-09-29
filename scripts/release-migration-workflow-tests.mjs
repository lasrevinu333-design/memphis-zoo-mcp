import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertReleaseWorkflowSource } from "./release-migration-workflow-preflight.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const workflow = readFileSync(join(root, ".github/workflows/build52-production-migration-apply.yml"), "utf8");
const statePath = join(root, "release/production-migration-state.json");
const state = JSON.parse(readFileSync(statePath, "utf8"));
const candidate = "a".repeat(40);
const tree = "b".repeat(40);
const cases = [];
function check(name, action) { action(); cases.push(name); }
function predicate(section) {
  const start = section.indexOf("'($release_state[0]) as $state") + 1;
  assert.ok(start > 0, "Workflow predicate must derive its target from immutable release state");
  const end = section.indexOf("' \\\n", start);
  assert.ok(end > start);
  return section.slice(start, end);
}
const mutator = workflow.indexOf("npm run --silent release:migrations:apply");
const independent = workflow.indexOf("- name: Independently verify the actual production target");
assert.ok(mutator > 0 && independent > mutator);
const applySection = workflow.slice(mutator, independent);
const observedSection = workflow.slice(independent);
const applyPredicate = predicate(applySection);
const observedPredicate = predicate(observedSection);
function jqAccepts(expression, value) {
  const result = spawnSync("jq", ["-e", "--arg", "commit", candidate, "--arg", "tree", tree,
    "--slurpfile", "release_state", statePath, expression], { input: JSON.stringify(value), encoding: "utf8", timeout: 5000 });
  assert.ifError(result.error);
  assert.ok(result.status === 0 || result.status === 1, `jq failed instead of evaluating the predicate: ${result.stderr}`);
  return result.status === 0;
}
const applied = state.pending_migrations.map(({order, source_migration_version, file, sha256}) => ({order, version:source_migration_version, file, sha256}));
const goodApply = { ok:true, candidate_commit:candidate, candidate_tree:tree, project_ref:state.project_ref,
  before_ledger_count:state.observed_production.production_ledger_count, before_ledger_head:state.observed_production.ledger_head,
  source_catalog_fingerprint:state.observed_production.catalog_privilege_fingerprint,
  after_ledger_count:state.target.production_ledger_count, after_ledger_head:state.target.source_migration_version,
  target_catalog_fingerprint:state.target.canonical_source_schema_fingerprint, applied };
const goodObserved = {format:"memphis-zoo-build52-production-post-apply.v1", ok:true, source:"direct-production-query",
  ledger_count:state.target.production_ledger_count, ledger_head:state.target.source_migration_version,
  counts:{functions:state.target.expected_catalog_counts.functions,routine_grants:state.target.expected_catalog_counts.routine_grants},
  schema_fingerprint:state.target.canonical_source_schema_fingerprint};
check("source preflight accepts the exact checked-out target", () => assert.equal(assertReleaseWorkflowSource(root).pendingCount, 46));
check("preflight runs before authorization and mutation", () => {
  const first = workflow.indexOf("node scripts/release-migration-workflow-preflight.mjs");
  assert.ok(first > 0 && first < workflow.indexOf("- uses: actions/download-artifact"));
  const last = workflow.lastIndexOf("node scripts/release-migration-workflow-preflight.mjs");
  assert.ok(last > first && last < workflow.indexOf("RELEASE_MIGRATION_APPLY=true"));
  assert.ok(workflow.indexOf("node scripts/release-migration-workflow-tests.mjs") < mutator);
});
check("both workflow jq invocations load the checked-out release state", () => {
  for (const section of [applySection, observedSection]) assert.match(section, /--slurpfile release_state release\/production-migration-state\.json/);
});
check("correct 46-migration apply receipt passes actual workflow jq", () => assert.equal(jqAccepts(applyPredicate,goodApply),true));
check("correct target-query receipt passes actual workflow jq", () => assert.equal(jqAccepts(observedPredicate,goodObserved),true));
check("obsolete 23-migration apply receipt is rejected", () => {
  const old={...goodApply,after_ledger_count:253,after_ledger_head:"20260925190000",applied:applied.slice(0,23),target_catalog_fingerprint:"34f13666aac64ba95409d4f074581a791541e6a1a09f1d560598583c05882a45"};
  assert.equal(jqAccepts(applyPredicate,old),false);
});
check("obsolete production-query receipt is rejected", () => assert.equal(jqAccepts(observedPredicate,{...goodObserved,
  ledger_count:253,ledger_head:"20260925190000",counts:{functions:567,routine_grants:383},
  schema_fingerprint:"34f13666aac64ba95409d4f074581a791541e6a1a09f1d560598583c05882a45"}),false));
check("previous 45-migration receipt cannot omit recovery closure", () => {
  const previous={...goodApply,after_ledger_count:275,after_ledger_head:"20260927075352",
    applied:applied.slice(0,45),target_catalog_fingerprint:"5e72aa024a2ff409a3c1d25df4623e2da649cbe255f943a40d059d178ca08164"};
  assert.equal(jqAccepts(applyPredicate,previous),false);
});
check("previous 175-source catalog observation cannot pass new target", () => assert.equal(jqAccepts(observedPredicate,{...goodObserved,
  ledger_count:275,ledger_head:"20260927075352",counts:{functions:606,routine_grants:397},
  schema_fingerprint:"5e72aa024a2ff409a3c1d25df4623e2da649cbe255f943a40d059d178ca08164"}),false));

const applyMutations = [
 ["false success",v=>{v.ok=false;}], ["wrong commit",v=>{v.candidate_commit="c".repeat(40);}],
 ["wrong tree",v=>{v.candidate_tree="c".repeat(40);}], ["wrong project",v=>{v.project_ref="wrong-project";}],
 ["wrong source count",v=>{v.before_ledger_count+=1;}], ["wrong source head",v=>{v.before_ledger_head="0".repeat(14);}],
 ["wrong source catalog",v=>{v.source_catalog_fingerprint="0".repeat(64);}],
 ["wrong target count",v=>{v.after_ledger_count-=1;}], ["wrong target head",v=>{v.after_ledger_head="0".repeat(14);}],
 ["wrong target catalog",v=>{v.target_catalog_fingerprint="0".repeat(64);}],
 ["missing migration",v=>{v.applied.pop();}], ["reordered migrations",v=>{v.applied.reverse();}],
 ["altered migration digest",v=>{v.applied[0].sha256="0".repeat(64);}],
 ["altered migration version",v=>{v.applied[0].version="0".repeat(14);}],
 ["altered migration order",v=>{v.applied[0].order=2;}],
];
for(const [name,mutate] of applyMutations) check(`apply receipt rejects ${name}`,()=>{
 const bad=structuredClone(goodApply);mutate(bad);assert.equal(jqAccepts(applyPredicate,bad),false);
});
const observedMutations=[
 ["wrong format",v=>{v.format="unexpected";}], ["false success",v=>{v.ok=false;}],
 ["unobserved source",v=>{v.source="source-file";}], ["wrong count",v=>{v.ledger_count+=1;}],
 ["wrong head",v=>{v.ledger_head="0".repeat(14);}], ["wrong functions",v=>{v.counts.functions+=1;}],
 ["wrong grants",v=>{v.counts.routine_grants+=1;}], ["wrong fingerprint",v=>{v.schema_fingerprint="0".repeat(64);}],
];
for(const [name,mutate] of observedMutations) check(`production-query receipt rejects ${name}`,()=>{
 const bad=structuredClone(goodObserved);mutate(bad);assert.equal(jqAccepts(observedPredicate,bad),false);
});
const fixture=mkdtempSync(join(tmpdir(),"custodial-workflow-preflight-"));
try {
 for(const path of ["release/production-migration-state.json","release/frontend-release-manifest.json",
  "supabase/canonical/schema-fingerprint.txt","supabase/canonical/schema-fingerprint-input.json","supabase/migrations"])
  cpSync(join(root,path),join(fixture,path),{recursive:true});
 const fixtureState=join(fixture,"release/production-migration-state.json");
 for(const [name,mutate] of [
  ["omitted pending migration",v=>v.pending_migrations.pop()],
  ["stale target count",v=>{v.target.production_ledger_count=253;}],
  ["bad source count",v=>{v.observed_production.production_ledger_count="230";}],
  ["wrong migration digest",v=>{v.pending_migrations[0].sha256="0".repeat(64);}],
  ["wrong migration version",v=>{v.pending_migrations[0].source_migration_version="0".repeat(14);}],
  ["wrong phase",v=>{v.pending_migrations[0].phase="wrong_phase";}],
  ["wrong fingerprint",v=>{v.target.canonical_source_schema_fingerprint="0".repeat(64);}],
  ["incomplete target counts",v=>{delete v.target.expected_catalog_counts.functions;}],
 ]) check(`pre-mutation source check rejects ${name}`,()=>{
  const bad=structuredClone(state);mutate(bad);writeFileSync(fixtureState,JSON.stringify(bad));
  assert.throws(()=>assertReleaseWorkflowSource(fixture));
 });
} finally { rmSync(fixture,{recursive:true,force:true}); }
console.log(JSON.stringify({ok:true,release_workflow_regressions:cases.length,database_contacted:false,cases}));
