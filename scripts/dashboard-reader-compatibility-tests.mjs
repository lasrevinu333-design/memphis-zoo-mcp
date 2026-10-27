import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {readMigrationReplayPlan} from './migration-replay-order.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assertDashboardReleaseCompatibility } from '../src/dashboard-release-compatibility.js';
const url = path => new URL(`../${path}`, import.meta.url);
const read = path => readFileSync(url(path), 'utf8');
const manifest = JSON.parse(read('release/dashboard-reader-restoration-manifest.json'));
const migrations = readdirSync(url('release/dashboard-reader/forward-source/'));
const canonicalMigrations = readdirSync(url('supabase/migrations/'));
const oldRepair = read(`release/dashboard-reader/forward-source/${migrations.find(x => x.endsWith('_dashboard_application_reader_dependencies.sql'))}`);
const restore = read(`release/dashboard-reader/forward-source/${migrations.find(x => x.endsWith('_dashboard_verified_check_restoration.sql'))}`);
const viewRestore = read(`release/dashboard-reader/forward-source/${migrations.find(x => x.endsWith('_dashboard_verified_check_view_contract.sql'))}`);
const extractView = source => source.match(/create or replace view public\.v_location_dashboard_status as[\s\S]*?from truth;/i)[0];
const canonicalView = extractView(read('supabase/migrations/20260922090000_verified_visit_reminder_state.sql'));
assert.equal(extractView(viewRestore), canonicalView, 'view restoration must preserve canonical verified-visit and timer truth');
assert.equal(createHash('sha256').update(canonicalView).digest('hex'), manifest.canonical_view.declaration_sha256);
assert.ok(viewRestore.includes(manifest.observed_view_predecessor.definition_md5));
assert.match(viewRestore, /current_view\.relacl::text is distinct from before\.acl_text/);
assert.doesNotMatch(canonicalView, /place_operational_location_name/);
const liveCatalogFixture = JSON.parse(read('scripts/fixtures/dashboard-reader-live-catalog-20261021.json'));
function outputColumns(sql) {
  const finalSelect = sql.match(/^ ?select location_id\s*,([\s\S]*?)\n\s*from truth/im)[0]
    .replace(/^\s*select/i, '').replace(/\s*from truth\s*$/i, '');
  const expressions = []; let depth = 0; let quoted = false; let start = 0;
  for (let i = 0; i < finalSelect.length; i += 1) {
    const character = finalSelect[i];
    if (character === "'") {
      if (quoted && finalSelect[i + 1] === "'") { i += 1; continue; }
      quoted = !quoted;
    } else if (!quoted) {
      if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;
      else if (character === ',' && depth === 0) { expressions.push(finalSelect.slice(start, i)); start = i + 1; }
    }
  }
  expressions.push(finalSelect.slice(start));
  return expressions.map(expression => expression.match(/([a-z_][a-z_0-9]*)\s*$/i)[1].toLowerCase());
}
assert.deepEqual(outputColumns(liveCatalogFixture.view.definition_sql), liveCatalogFixture.full_predecessor_output_columns);
assert.deepEqual(outputColumns(canonicalView), [...liveCatalogFixture.full_predecessor_output_columns, 'latest_checked_at'],
  'CREATE OR REPLACE must preserve all 38 captured predecessor columns in order and append only the canonical checked timestamp');

const independentRestore = read(`release/dashboard-reader/forward-source/${migrations.find(x => x.endsWith('_dashboard_verified_check_private_reader.sql'))}`);
const independentQuery = read('release/dashboard-reader/verified-check-query-preimage.sql');
const independentBody = independentRestore.match(/AS \$function\$([\s\S]*?)\$function\$;/)[1];
assert.equal(independentBody.trim().replace(/;$/, ''), independentQuery.trim(), 'independent private reader must retain the exact pre-existing check projection/predicate/order');
assert.equal(createHash('sha256').update(independentQuery).digest('hex'), manifest.independent_verified_check_reader.source_query_sha256);
const freshCanonical = read(manifest.canonical_fresh_source.migration);
assert.equal(freshCanonical.match(/AS \$function\$([\s\S]*?)\$function\$;/)[1], independentBody,
  'fresh canonical and observed-live sibling must retain identical fixed query body bytes');
assert.match(freshCanonical,/current_user<>'supabase_admin' or session_user<>current_user/);
assert.match(freshCanonical,/nspowner='supabase_admin'::regrole/);
assert.match(freshCanonical,/p\.proowner='supabase_admin'::regrole/);
assert.match(freshCanonical,/array\['custodial_application_reader:EXECUTE:false','supabase_admin:EXECUTE:false'\]/);
assert.doesNotMatch(freshCanonical,/custodial\.deployment_project_ref|OWNER TO postgres|grant execute[^;]*to service_role/i);
assert.equal(createHash('sha256').update(freshCanonical).digest('hex'),manifest.canonical_fresh_source.sha256);
for(const item of manifest.observed_live_forward_sources){
 assert.equal(createHash('sha256').update(read(item.path)).digest('hex'),item.sha256,'live forward SQL bytes must stay immutable');
 assert.ok(!canonicalMigrations.includes(item.path.split('/').at(-1)),'old-predecessor repairs must stay outside canonical discovery');
}
const replay=readMigrationReplayPlan(fileURLToPath(url('.')));
assert.equal(replay.files.length,289);assert.equal(replay.files.at(-1),manifest.canonical_fresh_source.migration.split('/').at(-1));
const priorPlan=JSON.parse(read('supabase/canonical/migration-replay-order.json'));
assert.equal(priorPlan.production_execution_authorized,false);priorPlan.phases.at(-1).files.pop();
assert.equal(createHash('sha256').update(JSON.stringify(priorPlan,null,2)+'\n').digest('hex'),
 'ee5f7f3723028610d296e6cdceec5751644bfe8a2c3e8286d81046a5d1983fe6','entire prior288 manifest/order must remain unchanged');
const currentIndex = read('src/index.js');
const summary = currentIndex.slice(currentIndex.indexOf('async function runPublicDashboardSummary()'), currentIndex.indexOf('async function runCanaryChecks()'));
assert.match(summary, /from custodial_release_identity\.read_current_verified_dashboard_checks_v1\(\)/);
assert.doesNotMatch(summary, /from public\.custodial_offline_reconciliation_records|join public\.sessions|join public\.completion_responses/,
  'summary must not silently filter the private record join through ordinary reader RLS');
const privateRestore = read(`release/dashboard-reader/forward-source/${migrations.find(x => x.endsWith('_dashboard_original_completion_reader_restoration.sql'))}`);
const privateCanonical = read('supabase/migrations/20261012142853_original_completion_protected_reader.sql').match(/CREATE FUNCTION custodial_release_identity\.read_current_original_dashboard_completions_v1\(\)[\s\S]*?\$function\$;/)[0];
const privateRestored = privateRestore.match(/CREATE OR REPLACE FUNCTION custodial_release_identity\.read_current_original_dashboard_completions_v1\(\)[\s\S]*?\$function\$;/)[0];
assert.equal(privateRestored.replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION'), privateCanonical);
assert.equal(createHash('sha256').update(privateCanonical).digest('hex'), manifest.protected_dashboard_reader.declaration_sha256);
assert.doesNotMatch(privateRestore, /CREATE(?: OR REPLACE)? FUNCTION custodial_release_identity\.read_original_scan_completion_v1/i);
assert.match(privateRestore, /not relrowsecurity or not relforcerowsecurity/i);
const extract = (source, name) => source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`, 'i'))[0];
const canonical = extract(read(`supabase/migrations/${manifest.canonical_function.source_migration}`), 'mz_latest_verified_check');
assert.equal(extract(restore, 'mz_latest_verified_check'), canonical, 'restore must preserve the canonical native/occurrence/evidence predicate byte for byte');
assert.equal(createHash('sha256').update(canonical).digest('hex'), manifest.canonical_function.source_declaration_sha256);
const aliases = { receipt: 'custodial_offline_reconciliation_records', context: 'custodial_offline_actor_contexts', session: 'sessions', response: 'completion_responses', evidence: 'custodial_offline_scan_event_evidence' };
for (const [alias, table] of Object.entries(aliases)) {
  const columns = [...new Set([...canonical.matchAll(new RegExp(`\\b${alias}\\.([a-z_0-9]+)`, 'g'))].map(x => x[1]))].sort();
  assert.deepEqual(manifest.direct_relation_columns[table], columns, `all ${table} dependencies must be named; missing schema must not be invented`);
  assert.match(restore, new RegExp(`public\\.${table}`));
}
assert.ok(manifest.direct_relation_columns.custodial_offline_actor_contexts.includes('native_completion_attestation_sha256'));
for (const sql of [oldRepair, restore, viewRestore, privateRestore, independentRestore, freshCanonical]) {
  if(sql!==freshCanonical)assert.match(sql, /rqquvtjdmugpigbndmne/);
  assert.doesNotMatch(sql, /dwzdqekusvivjbxsapdu|create role|alter role|grant .* on all|disable row level security/i);
  assert.match(sql, /definition_sha256=public\.static_weekly_digest_text\(definition\)/);
  assert.match(sql, /enable trigger trg_custodial_release_authority_restore_inventory_immutable/);
}
assert.doesNotMatch(oldRepair, /mz_latest_verified_check|security definer/i, 'old Dashboard repair must remain independent');
const backendCommitSha = 'a'.repeat(40);
const health = { read_authority_ready: true, backend_commit_sha: backendCommitSha };
const canary = { backend_commit_sha: backendCommitSha, release_id: 'exact-release', version: '1', ok: true, failure_count: 0, failures: [], checks: {
  dashboard_summary: { ok: true, restrooms_count: 1, exhibits_count: 1 },
  open_session_consistency: { ok: true }, ticket_count_consistency: { ok: true },
} };
const check = (c = canary, h = health) => assertDashboardReleaseCompatibility({ canary: c, health: h, releaseId: 'exact-release', appVersion: '1', backendCommitSha });
assert.equal(check(), true);
for (const mutate of [c => { c.release_id = 'old'; }, c => { c.version = 'old'; }, c => { c.backend_commit_sha = 'b'.repeat(40); }, c => { c.ok = false; },
  c => { c.failure_count = 1; c.failures = ['permission denied for function operational_day_start']; },
  c => { delete c.checks.dashboard_summary; }, c => { c.checks.dashboard_summary.ok = false; },
  c => { c.checks.dashboard_summary.restrooms_count = 0; }, c => { c.checks.dashboard_summary.exhibits_count = null; },
  c => { c.checks.open_session_consistency.ok = false; }, c => { delete c.checks.ticket_count_consistency; }]) {
  const altered = structuredClone(canary); mutate(altered); assert.throws(() => check(altered));
}
assert.throws(() => check(canary, { read_authority_ready: false }));
assert.throws(() => check(canary, {}));
assert.throws(() => check(canary, { ...health, backend_commit_sha: 'b'.repeat(40) }));
console.log(JSON.stringify({ status: 'PASS', source_slice_exact: true, full_predecessor_view_columns: 38, direct_columns_complete: true, release_rejection_cases: 14, canonical289_declared_and_prior288_preserved: true, live_database_executed: false }));
