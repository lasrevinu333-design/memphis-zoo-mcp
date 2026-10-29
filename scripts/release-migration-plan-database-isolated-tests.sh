#!/usr/bin/env bash

set -euo pipefail
umask 077

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$project_root"
for command_name in docker node readlink mktemp sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required release migration database-test command is unavailable: $command_name" >&2
    exit 1
  }
done

image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed'
node_source="$(readlink -f "$(command -v node)")"
test -f "$node_source" && test -x "$node_source"
node_version="$("$node_source" -p 'process.versions.node')"
"$node_source" -e 'const [a,b,c]=process.versions.node.split(".").map(Number); if(a!==22 || b<23 || (b===23 && c<4)) process.exit(1)'
node_sha256="$(sha256sum "$node_source")"
node_sha256="${node_sha256%% *}"
lib64_source="$(readlink -f /lib64)"
lib_source="$(readlink -f /lib/x86_64-linux-gnu)"
test -d "$lib64_source" && test -d "$lib_source"
# Current NULL target is a source-only refusal case, not a positive DB plan.
# Select it before image inspection, token/temp creation or Docker allocation.
# A partially missing/malformed target fails closed; fully captured future
# targets retain the existing complete owned-database route below.
set +e
env -i PATH=/usr/bin:/bin LANG=C LC_ALL=C TZ=UTC "$node_source" --max-old-space-size=128 --input-type=module -e '
  import assert from "node:assert/strict";
  import {readFileSync} from "node:fs";
  import {assertCapturedTargetCatalog, assertReleaseWorkflowSource} from "./scripts/release-migration-workflow-preflight.mjs";
  const state = JSON.parse(readFileSync("release/production-migration-state.json", "utf8"));
  const {readMigrationReplayPlan} = await import("./scripts/migration-replay-order.mjs");
  const plan = readMigrationReplayPlan(process.cwd());
  const keys = ["canonical_source_schema_fingerprint", "expected_catalog_counts",
    "production_ledger_count", "public_function_count"];
  assert.ok(state.target && typeof state.target === "object" && !Array.isArray(state.target));
  for (const key of keys) assert.ok(Object.hasOwn(state.target, key), "Missing current target field: " + key);
  const unresolved = keys.map(key => state.target[key] === null);
  if (unresolved.some(Boolean)) {
    assert.ok(unresolved.every(Boolean), "Partially captured target is not source-only or admitted");
    process.exit(0);
  }
  assertCapturedTargetCatalog(state.target);
  assertReleaseWorkflowSource(process.cwd());
  if ([294, 297, 298].includes(plan.files.length)) {
    assert.equal(plan.baseCount, 134);
    const pendingCounts = new Map([[294, 160], [297, 163], [298, 164]]);
    assert.equal(state.pending_migrations.length, pendingCounts.get(plan.files.length));
    assert.ok(state.target.normal_source_capture, "Current captured source requires its adopted capture binding");
    process.exit(4);
  }
  process.exit(3);
'
current_target_route_status=$?
set -e
if test "$current_target_route_status" -eq 0; then
  env -i PATH=/usr/bin:/bin LANG=C LC_ALL=C TZ=UTC "$node_source" --max-old-space-size=128 \
    scripts/release-migration-plan-database-tests.mjs --current-unresolved-target-source-only
  printf '{"source_only_current_unresolved_target":true,"SQL_execution":false,"positive_database_scenarios":"NOT_RUN","production_authorized":false}\n'
  exit 0
elif test "$current_target_route_status" -eq 4; then
  env -i PATH=/usr/bin:/bin LANG=C LC_ALL=C TZ=UTC "$node_source" --max-old-space-size=128 \
    scripts/release-migration-plan-database-tests.mjs --current-captured-target-source-only
  printf '{"source_only_current_captured_target":true,"SQL_execution":false,"historical23_database_scenarios":"NOT_RUN","production_authorized":false}\n'
  exit 0
elif test "$current_target_route_status" -ne 3; then
  echo "Current release target shape is invalid; refusing both qualification routes." >&2
  exit "$current_target_route_status"
fi

owner_token="$(node -e "process.stdout.write(require('node:crypto').randomBytes(16).toString('hex'))")"
container="mz_schema_rebuild_releaseplan_${owner_token}"
image_id="$(docker image inspect --format '{{.Id}}' "$image")"
node scripts/release-migration-fixture-guard-tests.mjs
node scripts/release-migration-fixture-inspect-tests.mjs
docker info --format '{{.ID}}' >/dev/null
is_exact_missing_container() {
  local response="${1,,}" expected_name="$2"
  [[ "$response" == "error: no such object: $expected_name" \
    || "$response" == "error: no such container: $expected_name" \
    || "$response" == "[]"$'\n'"error: no such object: $expected_name" \
    || "$response" == "[]"$'\n'"error: no such container: $expected_name" ]]
}
preinspect_response=''
if preinspect_response="$(docker inspect "$container" 2>&1)"; then
  echo "Refusing to reuse an existing release migration test container." >&2
  exit 1
elif ! is_exact_missing_container "$preinspect_response" "$container"; then
  echo "Cannot prove the release migration test container name is unused." >&2
  exit 1
fi

owner_secret_dir="$(mktemp -d)"
owner_secret_file="$owner_secret_dir/token"
printf 'OWNED_SECRET_DIRECTORY %s\n' "$owner_secret_dir"
record_owned_resources() {
  if test -n "${RELEASE_MIGRATION_TEST_RESOURCE_DIRECTORY:-}"; then
    node -e 'const fs=require("fs"),p=require("path");const [out,secret,name,id]=process.argv.slice(1);const s=fs.lstatSync(out);if(!p.isAbsolute(out)||s.isSymbolicLink()||!s.isDirectory()||s.uid!==process.getuid()||(s.mode&63)!==0)throw Error("private owned evidence directory required");fs.writeFileSync(p.join(out,"OWNED_RESOURCES.json"),JSON.stringify({owner_secret_dir:secret,container_name:name,container_id:id||null})+"\n",{mode:384});' \
      "$RELEASE_MIGRATION_TEST_RESOURCE_DIRECTORY" "$owner_secret_dir" "$container" "${container_id:-}"
  fi
}
record_owned_resources
printf '%s' "$owner_token" > "$owner_secret_file"
chmod 0400 "$owner_secret_file"
container_may_exist=false
cleanup() {
  status=$?
  trap - EXIT
  if test "$container_may_exist" = true; then
    if ! docker rm -f "$container" >/dev/null 2>&1; then
      echo "Docker removal failed for owned release migration container: $container" >&2
      status=1
    fi
    if ! docker info --format '{{.ID}}' >/dev/null 2>&1; then
      echo "Docker unavailable: owned release migration container removal is unverified: $container" >&2
      status=1
    else
      inspect_error=''
      if inspect_error="$(docker inspect "$container" 2>&1)"; then
        echo "Owned release migration test container survived cleanup: $container" >&2
        status=1
      elif ! is_exact_missing_container "$inspect_error" "$container"; then
        echo "Owned release migration container removal could not be verified: $container" >&2
        status=1
      elif ! remaining="$(docker ps -a --no-trunc --filter "name=^/${container}$" --format '{{.ID}}' 2>&1)"; then
        echo "Docker listing failed: owned release migration container removal is unverified: $container" >&2
        status=1
      elif test -n "$remaining"; then
        echo "Owned release migration container remains in Docker listing: $container" >&2
        status=1
      fi
    fi
  fi
  rm -f -- "$owner_secret_file"
  rmdir -- "$owner_secret_dir"
  return "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

container_may_exist=true
container_id="$(docker run --rm -d --no-healthcheck --name "$container" \
  --network none --label "org.memphiszoo.custodial.releaseplan.owner=$owner_token" \
  --label 'org.memphiszoo.custodial.releaseplan.purpose=isolated-test' \
  --tmpfs /var/lib/postgresql/data:rw,size=2g \
  -v "$project_root:/workspace:ro" \
  -v "$node_source:/usr/local/bin/node:ro" \
  -v "$lib64_source:/lib64:ro" -v "$lib_source:/lib/x86_64-linux-gnu:ro" \
  -v "$owner_secret_file:/run/mz-release-fixture-owner-token:ro" \
  -e POSTGRES_PASSWORD=postgres -e PGPASSWORD=postgres -e "POSTGRES_DB=$container" \
  "$image" -c listen_addresses='127.0.0.1' \
  -c shared_preload_libraries=pg_cron,pg_net,pg_stat_statements \
  -c "cron.database_name=$container" -c cron.launch_active_jobs=off)"
[[ "$container_id" =~ ^[a-f0-9]{64}$ ]]
printf 'OWNED_CONTAINER %s %s\n' "$container_id" "$container"
record_owned_resources

docker inspect "$container_id" | node scripts/release-migration-fixture-inspect.mjs \
  "$container_id" "$container" "$owner_token" "$image_id" "$project_root" \
  "$node_source" "$node_sha256" "$node_version" "$lib64_source" "$lib_source" "$owner_secret_file"

ready=0
previous_server_start=''
for attempt in $(seq 1 240); do
  readiness=''
  if readiness="$(docker exec "$container_id" psql -X -q -At -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d "$container" -c "select current_database() || '|' || pg_is_in_recovery()::text || '|' || (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role','supabase_admin'))::text || '|' || pg_postmaster_start_time()::text" 2>/dev/null)" \
    && [[ "$readiness" == "$container|false|4|"* ]]; then
    server_start="${readiness#"$container|false|4|"}"
    if test -n "$server_start" && test "$server_start" = "$previous_server_start"; then ready=$((ready + 1)); else ready=1; fi
    previous_server_start="$server_start"
  else ready=0; previous_server_start=''; fi
  if test "$ready" -ge 4; then break; fi
  sleep 0.5
done
test "$ready" -ge 4
# Temporary init server is socket-only in the pinned entrypoint. Four stable
# authenticated TCP snapshots must name this database, all four bootstrap roles,
# primary mode and the SAME final postmaster start. No proc/executable access or
# new capabilities, and no blind startup wait masquerading as readiness proof.
printf 'FINAL_POSTGRES_READY %s %s\n' "$container_id" "$previous_server_start"
test "$(docker exec "$container_id" /usr/local/bin/node --version)" = "v$node_version"

docker exec -w /workspace \
  -e "RELEASE_MIGRATION_TEST_DATABASE_URL=postgresql://supabase_admin:postgres@127.0.0.1:5432/$container" \
  -e RELEASE_MIGRATION_TEST_USE_OWNED_CONTAINER_DB=1 \
  -e "RELEASE_MIGRATION_TEST_OWNER_TOKEN=$owner_token" \
  -e "RELEASE_MIGRATION_TEST_CONTAINER_ID=$container_id" \
  "$container_id" /usr/local/bin/node scripts/release-migration-plan-database-tests.mjs

cleanup
printf '{"ok":true,"isolated_release_migration_plan_database":true}\n'
