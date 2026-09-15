#!/usr/bin/env bash

set -euo pipefail
umask 077

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$project_root"

for command_name in docker node npm sed; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required release migration database-test command is unavailable: $command_name" >&2
    exit 1
  }
done

execution_id="$(node -e "process.stdout.write(require('node:crypto').randomUUID().replaceAll('-','').slice(0,12))")"
container="mz_release_plan_${execution_id}"
database="mz_schema_rebuild_release_plan_${execution_id}"
image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed'
if docker inspect "$container" >/dev/null 2>&1; then
  echo "Refusing to reuse an existing release migration test container." >&2
  exit 1
fi

container_owned=false
cleanup() {
  status=$?
  if test "$container_owned" = true; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
  return "$status"
}
trap cleanup EXIT INT TERM

docker run -d --name "$container" --tmpfs /var/lib/postgresql/data:rw,size=2g \
  -p '127.0.0.1::5432' -e POSTGRES_PASSWORD=postgres "$image" \
  -c listen_addresses='*' -c shared_preload_libraries=pg_cron,pg_net,pg_stat_statements \
  -c "cron.database_name=${database}" -c cron.launch_active_jobs=off >/dev/null
container_owned=true

ready=false
for attempt in $(seq 1 600); do
  if docker exec "$container" psql -At -U supabase_admin -d postgres -c 'select 1' 2>/dev/null | grep -qx 1; then
    ready=true
    break
  fi
  sleep 1
done
test "$ready" = true

healthy=false
for attempt in $(seq 1 120); do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container")"
  if test -z "$health" || test "$health" = healthy; then
    healthy=true
    break
  fi
  sleep 1
done
test "$healthy" = true
sleep 10

mapped_port="$(docker port "$container" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
[[ "$mapped_port" =~ ^[1-9][0-9]{0,4}$ ]]
RELEASE_MIGRATION_TEST_DATABASE_NAME="$database" \
  RELEASE_MIGRATION_TEST_DATABASE_URL="postgresql://supabase_admin:postgres@127.0.0.1:${mapped_port}/postgres" \
  npm run --silent test:release-migration-plan-db

printf '{"ok":true,"isolated_release_migration_plan_database":true}\n'
