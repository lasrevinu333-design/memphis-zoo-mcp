import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const container = String(process.env.RELEASE_SELECTION_TEST_CONTAINER || "").trim();
assert.match(container, /^mz_release_selection_[0-9]+$/, "owned disposable database container required");
const inspect = JSON.parse(execFileSync("docker", ["inspect", container], { encoding: "utf8" }))[0];
assert.equal(inspect.HostConfig.NetworkMode, "none");
assert.equal(Object.keys(inspect.HostConfig.PortBindings || {}).length, 0);

function psql(sql) {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres"], {
    input: sql,
    encoding: "utf8",
    timeout: 30000,
  }).trim();
}

const selectDeployed = `
select release_id
from public.release_deployment_manifest
where status='deployed'
order by deployed_at desc nulls last,created_at desc,release_id
`;
function selectedIds() {
  const output = psql(selectDeployed);
  return output ? output.split("\n") : [];
}
function requireExactlyOne(ids) {
  if (ids.length !== 1) throw new Error(`exactly one deployed release identity required; found ${ids.length}`);
  return ids[0];
}

psql(`
drop table if exists public.release_deployment_manifest;
create table public.release_deployment_manifest(
  release_id text primary key,
  status text not null,
  created_at timestamptz,
  deployed_at timestamptz
);
insert into public.release_deployment_manifest values
  ('candidate-only','candidate','2026-09-20','2026-09-20'),
  ('validated-only','validated','2026-09-20','2026-09-20');
`);
assert.deepEqual(selectedIds(), []);
assert.throws(() => requireExactlyOne(selectedIds()), /exactly one deployed.*found 0/i);

psql(`insert into public.release_deployment_manifest values
  ('deployed-live','deployed','2026-09-21','2026-09-21');`);
assert.deepEqual(selectedIds(), ['deployed-live']);
assert.equal(requireExactlyOne(selectedIds()), 'deployed-live');

psql(`insert into public.release_deployment_manifest values
  ('candidate-newer','candidate','2026-09-22','2026-09-22'),
  ('validated-newer','validated','2026-09-22','2026-09-22');`);
assert.deepEqual(selectedIds(), ['deployed-live'], 'newer candidate/validated rows must never become production identity');

psql(`insert into public.release_deployment_manifest values
  ('deployed-ambiguous','deployed','2026-09-22','2026-09-22');`);
assert.deepEqual(selectedIds(), ['deployed-ambiguous','deployed-live']);
assert.throws(() => requireExactlyOne(selectedIds()), /exactly one deployed.*found 2/i);

console.log(JSON.stringify({ passed: 8, failed: 0, candidate_fallback: false, ambiguous_deployed_fails_closed: true }, null, 2));
