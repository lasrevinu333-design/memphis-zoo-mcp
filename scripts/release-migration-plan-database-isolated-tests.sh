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
"$node_source" -e 'const [a,b,c]=process.versions.node.split(".").map(Number); if(a!==22 || b<23 || (b===23 && c<1)) process.exit(1)'
node_sha256="$(sha256sum "$node_source")"
node_sha256="${node_sha256%% *}"
lib64_source="$(readlink -f /lib64)"
lib_source="$(readlink -f /lib/x86_64-linux-gnu)"
test -d "$lib64_source" && test -d "$lib_source"
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

docker inspect "$container_id" | node scripts/release-migration-fixture-inspect.mjs \
  "$container_id" "$container" "$owner_token" "$image_id" "$project_root" \
  "$node_source" "$node_sha256" "$node_version" "$lib64_source" "$lib_source" "$owner_secret_file"

ready=0
for attempt in $(seq 1 240); do
  if docker exec "$container_id" psql -X -q -At -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d "$container" -c 'select 1' 2>/dev/null | grep -qx 1; then ready=$((ready + 1)); else ready=0; fi
  if test "$ready" -ge 4; then break; fi
  sleep 0.5
done
test "$ready" -ge 4
sleep 10
test "$(docker exec "$container_id" /usr/local/bin/node --version)" = "v$node_version"

docker exec -w /workspace \
  -e "RELEASE_MIGRATION_TEST_DATABASE_URL=postgresql://supabase_admin:postgres@127.0.0.1:5432/$container" \
  -e RELEASE_MIGRATION_TEST_USE_OWNED_CONTAINER_DB=1 \
  -e "RELEASE_MIGRATION_TEST_OWNER_TOKEN=$owner_token" \
  -e "RELEASE_MIGRATION_TEST_CONTAINER_ID=$container_id" \
  "$container_id" /usr/local/bin/node scripts/release-migration-plan-database-tests.mjs

cleanup
printf '{"ok":true,"isolated_release_migration_plan_database":true}\n'
