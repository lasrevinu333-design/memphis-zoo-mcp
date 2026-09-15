#!/usr/bin/env bash

set -euo pipefail
umask 077

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$project_root"

required_commands=(curl docker git jq node npm openssl sed sha256sum)
for command_name in "${required_commands[@]}"; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required rehearsal command is unavailable: $command_name" >&2
    exit 1
  }
done

provenance_kind="${REHEARSAL_PROVENANCE_KIND:-}"
backup_id="${REHEARSAL_BACKUP_ID:-}"
encrypted_backup="${REHEARSAL_BACKUP_ENCRYPTED_PATH:-}"
work_parent="${REHEARSAL_WORK_DIR:-}"
output_dir="${REHEARSAL_OUTPUT_DIR:-}"
candidate_commit="${REHEARSAL_CANDIDATE_COMMIT:-}"
candidate_tree="${REHEARSAL_CANDIDATE_TREE:-}"
local_execution_id="${REHEARSAL_LOCAL_EXECUTION_ID:-}"
port_base="${REHEARSAL_PORT_BASE:-31869}"

test "$provenance_kind" = 'github-actions' || test "$provenance_kind" = 'task-local'
test -n "$backup_id"
test -n "$encrypted_backup"
test -n "$work_parent"
test -n "$output_dir"
test -n "$candidate_commit"
[[ "$candidate_commit" =~ ^[0-9a-f]{40}$ ]]
[[ "$port_base" =~ ^[1-9][0-9]{3,4}$ ]]
test "$port_base" -le 65531
test -f "$encrypted_backup"
test ! -L "$encrypted_backup"
test -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}"
test -n "${RESTORE_ARCHIVE_VERIFY_KEY:-}"
test -n "${RESTORE_ARCHIVE_VERIFY_KEY_ID:-}"
test -n "${REHEARSAL_CUSTODIAL_BACKEND_PROOF_SECRET:-}"
test -n "${REHEARSAL_CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET:-}"
test -n "${REHEARSAL_DEVICE_CREDENTIAL_SECRET:-}"
test -n "${REHEARSAL_OPS_MANAGER_SESSION_SECRET:-}"
test -n "${REHEARSAL_GITHUB_TOKEN:-}"
test -n "${RELEASE_REHEARSAL_ATTESTATION_SIGNING_KEY:-}"
test -n "${RELEASE_REHEARSAL_ATTESTATION_SIGNING_KEY_ID:-}"

actual_commit="$(git rev-parse HEAD)"
actual_tree="$(git rev-parse 'HEAD^{tree}')"
test "$actual_commit" = "$candidate_commit"
if test -n "$candidate_tree"; then
  [[ "$candidate_tree" =~ ^[0-9a-f]{40}$ ]]
  test "$actual_tree" = "$candidate_tree"
else
  test "$provenance_kind" = 'github-actions'
  candidate_tree="$actual_tree"
fi
test -z "$(git status --porcelain)"

if test "$provenance_kind" = 'github-actions'; then
  test "${GITHUB_ACTIONS:-}" = 'true'
  test "${GITHUB_SHA:-}" = "$candidate_commit"
  test -n "${GITHUB_RUN_ID:-}"
  [[ "${GITHUB_RUN_ID}" =~ ^[1-9][0-9]*$ ]]
  test -z "$local_execution_id"
  execution_label="$GITHUB_RUN_ID"
  actor="GitHub production backup migration rehearsal ${GITHUB_RUN_ID}"
else
  test -z "${GITHUB_ACTIONS:-}"
  test -z "${GITHUB_REPOSITORY:-}"
  test -z "${GITHUB_WORKFLOW_REF:-}"
  test -z "${GITHUB_SHA:-}"
  test -z "${GITHUB_RUN_ID:-}"
  test -z "${GITHUB_RUN_ATTEMPT:-}"
  [[ "$local_execution_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]]
  execution_label="${local_execution_id//-/}"
  actor="Task-local production backup migration rehearsal ${local_execution_id}"
fi

mkdir -p "$work_parent" "$output_dir"
test ! -L "$work_parent"
test ! -L "$output_dir"
receipt="$output_dir/production-backup-migration-rehearsal.jsonl"
attestation="$output_dir/production-backup-migration-rehearsal-attestation.json"
postgres_log="$output_dir/production-backup-migration-rehearsal-postgres.log"
backend_log="$output_dir/production-backup-rehearsal-backend.log"
backend_dependencies_file="$output_dir/production-backup-rehearsal-backend-dependencies.json"
static_log="$output_dir/production-backup-rehearsal-static-weekly.log"
postgrest_log="$output_dir/production-backup-rehearsal-postgrest.log"
proxy_log="$output_dir/production-backup-rehearsal-supabase-rest-proxy.log"
first_write_file="$output_dir/production-backup-rehearsal-feedback-first.json"
second_write_file="$output_dir/production-backup-rehearsal-feedback-replay.json"
for output_path in "$receipt" "$attestation" "$postgres_log" "$backend_log" \
  "$backend_dependencies_file" "$static_log" "$postgrest_log" "$proxy_log" \
  "$first_write_file" "$second_write_file"; do
  if test -e "$output_path" || test -L "$output_path"; then
    echo "Refusing to overwrite rehearsal output: $output_path" >&2
    exit 1
  fi
done

container="mz_schema_rebuild_${execution_label:0:28}"
postgrest_container="${container}_postgrest"
database="$container"
if docker inspect "$container" >/dev/null 2>&1 || docker inspect "$postgrest_container" >/dev/null 2>&1; then
  echo "Refusing to reuse an existing rehearsal container name." >&2
  exit 1
fi
postgres_container_owned=false
postgrest_container_owned=false
postgrest_port=$((port_base + 1))
proxy_port=$((port_base + 2))
backend_port=$((port_base + 3))
static_port=$((port_base + 4))
for port in "$postgrest_port" "$proxy_port" "$backend_port" "$static_port"; do
  if command -v ss >/dev/null 2>&1 && test -n "$(ss -H -ltn "sport = :${port}" 2>/dev/null)"; then
    echo "Rehearsal port is already in use: $port" >&2
    exit 1
  fi
done

private_dir="$(mktemp -d "${work_parent%/}/memphis-build52-rehearsal.XXXXXX")"
chmod 700 "$private_dir"
backup_dir="$private_dir/production-backup"
archive_tar="$private_dir/memphis-zoo-backup.tar.gz"
intent_file="$private_dir/isolated-restore-intent.json"

cleanup() {
  status=$?
  for owned_pid in "${backend_pid:-}" "${static_pid:-}" "${proxy_pid:-}"; do
    if test -n "$owned_pid"; then
      kill "$owned_pid" >/dev/null 2>&1 || true
      wait "$owned_pid" >/dev/null 2>&1 || true
    fi
  done
  if test "$status" -ne 0 && test "$postgres_container_owned" = true \
      && docker inspect "$container" >/dev/null 2>&1; then
    {
      docker inspect --format 'state={{.State.Status}} oom_killed={{.State.OOMKilled}} exit_code={{.State.ExitCode}} restart_count={{.RestartCount}} health={{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container"
      docker logs --timestamps --tail 2000 "$container"
    } > "$postgres_log" 2>&1 || true
  fi
  if test "$postgrest_container_owned" = true; then docker rm -f "$postgrest_container" >/dev/null 2>&1 || true; fi
  if test "$postgres_container_owned" = true; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
  case "$private_dir" in
    "${work_parent%/}"/memphis-build52-rehearsal.*) rm -rf -- "$private_dir" ;;
    *) echo "Refusing to remove unexpected rehearsal directory: $private_dir" >&2 ;;
  esac
  return "$status"
}
trap cleanup EXIT INT TERM

if test "$provenance_kind" = 'github-actions'; then
  printf '{"started":true,"backup_run_id":"%s","rehearsal_target_commit":"%s"}\n' "$backup_id" "$candidate_commit" > "$receipt"
else
  printf '{"started":true,"backup_run_id":"%s","rehearsal_target_commit":"%s","rehearsal_target_tree":"%s","provenance_kind":"task-local","local_execution_id":"%s","archive_local_only":true,"external_uploads":0}\n' \
    "$backup_id" "$candidate_commit" "$candidate_tree" "$local_execution_id" > "$receipt"
fi
chmod 600 "$receipt"

image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed'
postgrest_image='public.ecr.aws/supabase/postgrest@sha256:d2009b5c9deffc210c8a5592698472fede14fd9f6ca89823c8474ca54d58c012'
mkdir -p "$backup_dir"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 \
  -in "$encrypted_backup" -out "$archive_tar" -pass env:BACKUP_ENCRYPTION_PASSPHRASE
tar -C "$backup_dir" -xzf "$archive_tar"
RESTORE_SOURCE_DIR="$backup_dir" npm run --silent restore:verify | tee -a "$receipt"
archive_format="$(jq -r '.format' "$backup_dir/backup-summary.json")"
source_commit="$(jq -r '.source_identity.backup_tool_commit' "$backup_dir/backup-summary.json")"
source_tree="$(jq -r '.source_identity.backup_tool_tree' "$backup_dir/backup-summary.json")"
project_ref="$(jq -r '.project_ref' "$backup_dir/backup-summary.json")"
migration_head="$(jq -r '.source_identity.migration_head' "$backup_dir/backup-summary.json")"
source_migration_count="$(jq -r '.source_identity.migration_ledger_count' "$backup_dir/backup-summary.json")"
source_migration_ledger_sha256="$(jq -r '.source_identity.migration_ledger_sha256' "$backup_dir/backup-summary.json")"
archive_digest="$(sha256sum "$backup_dir/SHA256SUMS" | awk '{print $1}')"
source_catalog_fingerprint="$(jq -r '.observed_production.catalog_privilege_fingerprint' release/production-migration-state.json)"
test "$archive_format" = 'memphis-zoo-disaster-recovery.v4'
test "$source_commit" = "$candidate_commit"
test "$source_tree" = "$candidate_tree"
printf '{"stage":"archive_source_bound","format":"%s","source_commit":"%s","source_tree":"%s","migration_head":"%s"}\n' \
  "$archive_format" "$source_commit" "$source_tree" "$migration_head" >> "$receipt"

docker pull "$image"
docker pull "$postgrest_image"
docker run -d --name "$container" --tmpfs /var/lib/postgresql/data:rw,size=1g \
  -p "127.0.0.1::5432" -e POSTGRES_PASSWORD=postgres "$image" \
  -c listen_addresses='*' -c shared_preload_libraries=pg_cron,pg_net,pg_stat_statements \
  -c cron.database_name="$database" -c cron.launch_active_jobs=off
postgres_container_owned=true
ready='false'
for attempt in $(seq 1 600); do
  if docker exec "$container" psql -At -U supabase_admin -d postgres -c 'select 1' 2>/dev/null | grep -qx 1; then
    ready='true'
    break
  fi
  sleep 1
done
test "$ready" = 'true'
healthy='false'
for attempt in $(seq 1 120); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container")"
  if test -z "$status" || test "$status" = 'healthy'; then
    healthy='true'
    break
  fi
  sleep 1
done
test "$healthy" = 'true'
sleep 10
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
  < supabase/canonical/production-source-role-catalog.sql
printf '{"stage":"source_roles_reconciled"}\n' >> "$receipt"
docker exec "$container" createdb -U supabase_admin -T template0 "$database"
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U supabase_admin -d "$database" \
  < "$backup_dir/inventory/application-schema.sql"
mapped_port="$(docker port "$container" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
test -n "$mapped_port"
local_db_url="postgresql://supabase_admin:postgres@127.0.0.1:${mapped_port}/${database}"
RESTORE_SOURCE_DIR="$backup_dir" SUPABASE_DB_URL="$local_db_url" \
  npm run --silent restore:prepare-isolated | tee -a "$receipt"
intent_key="$(openssl rand -hex 32)"
intent_key_id="isolated-rehearsal-${execution_label:0:48}"
RESTORE_SOURCE_DIR="$backup_dir" SUPABASE_DB_URL="$local_db_url" \
  SUPABASE_PROJECT_REF="$project_ref" RESTORE_NAMED_ACTOR="$actor" \
  RESTORE_INTENT_SIGNING_KEY="$intent_key" RESTORE_INTENT_SIGNING_KEY_ID="$intent_key_id" \
  npm run --silent restore:intent > "$intent_file"
RESTORE_APPLY=true RESTORE_DATABASE_ONLY=true RESTORE_SOURCE_DIR="$backup_dir" \
  SUPABASE_DB_URL="$local_db_url" SUPABASE_PROJECT_REF="$project_ref" RESTORE_CONFIRM_PROJECT_REF="$project_ref" \
  RESTORE_ARCHIVE_VERIFY_KEY="$RESTORE_ARCHIVE_VERIFY_KEY" RESTORE_ARCHIVE_VERIFY_KEY_ID="$RESTORE_ARCHIVE_VERIFY_KEY_ID" \
  RESTORE_INTENT_VERIFY_KEY="$intent_key" RESTORE_INTENT_VERIFY_KEY_ID="$intent_key_id" \
  RESTORE_INTENT_JSON="$(<"$intent_file")" \
  npm run --silent restore:verify | tee -a "$receipt"
RESTORE_REHEARSAL_ACCEPT_EMPTY_TARGET=true RESTORE_REHEARSAL_EXPECTED_ARCHIVE_DIGEST="$archive_digest" \
  SUPABASE_DB_URL="$local_db_url" npm run --silent restore:reconcile-isolated | tee -a "$receipt"
test "$(docker exec "$container" psql -v ON_ERROR_STOP=1 -At -U supabase_admin -d "$database" \
  -c "select to_regclass('custodial_dr.application_mutation_leases') is null;" | tail -n 1)" = 't'
printf '{"stage":"isolated_pre_migration_lease_shim_retired"}\n' >> "$receipt"
SCHEMA_FINGERPRINT_DOCKER_CONTAINER="$container" SCHEMA_FINGERPRINT_DATABASE="$database" \
  npm run --silent release:observed-production-schema:preflight | tee -a "$receipt"
RELEASE_MIGRATION_APPLY=true RELEASE_MIGRATION_CONFIRM_PROJECT_REF="$project_ref" \
  RELEASE_MIGRATION_NAMED_ACTOR="$actor" RELEASE_MIGRATION_REHEARSAL=true \
  RELEASE_MIGRATION_CANDIDATE_COMMIT="$source_commit" RELEASE_MIGRATION_CANDIDATE_TREE="$source_tree" \
  RELEASE_MIGRATION_SOURCE_LEDGER_SHA256="$source_migration_ledger_sha256" \
  SUPABASE_PROJECT_REF="$project_ref" SUPABASE_DB_URL="$local_db_url" \
  npm run --silent release:migrations:apply | tee -a "$receipt"
backend_secret_digest="$(printf '%s' "$REHEARSAL_CUSTODIAL_BACKEND_PROOF_SECRET" | sha256sum | awk '{print $1}')"
native_secret_digest="$(printf '%s' "$REHEARSAL_CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET" | sha256sum | awk '{print $1}')"
docker exec "$container" psql -v ON_ERROR_STOP=1 -At -U supabase_admin -d "$database" \
  -c "select public.custodial_configure_backend_execution_key('$backend_secret_digest','isolated-production-backup-rehearsal'); select public.custodial_configure_native_route_proof_key('$native_secret_digest','isolated-production-backup-rehearsal');"
SCHEMA_FINGERPRINT_DOCKER_CONTAINER="$container" SCHEMA_FINGERPRINT_DATABASE="$database" \
  npm run --silent release:target-schema:preflight | tee -a "$receipt"
SCHEMA_FINGERPRINT_DOCKER_CONTAINER="$container" SCHEMA_FINGERPRINT_DATABASE="$database" \
  npm run --silent test:schema-fingerprint | tee -a "$receipt"
target_migration_head="$(jq -r '.target.source_migration_version' release/production-migration-state.json)"
target_migration_count="$(jq -r '.target.production_ledger_count' release/production-migration-state.json)"
target_fingerprint="$(tr -d '\r\n' < supabase/canonical/schema-fingerprint.txt)"
test "$(docker exec "$container" psql -v ON_ERROR_STOP=1 -At -U supabase_admin -d "$database" \
  -c 'select max(version)::text from supabase_migrations.schema_migrations;' | tail -n 1)" = "$target_migration_head"
test "$(docker exec "$container" psql -v ON_ERROR_STOP=1 -At -U supabase_admin -d "$database" \
  -c 'select count(*)::text from supabase_migrations.schema_migrations;' | tail -n 1)" = "$target_migration_count"
test "$target_migration_head" != "$migration_head"
test "$(docker exec "$container" psql -v ON_ERROR_STOP=1 -At -U supabase_admin -d "$database" \
  -c "select public.custodial_backend_authority_health('$REHEARSAL_CUSTODIAL_BACKEND_PROOF_SECRET')->>'ok';" | tail -n 1)" = 'true'
test "$(docker exec "$container" psql -v ON_ERROR_STOP=1 -At -U supabase_admin -d "$database" \
  -c "select count(*) from public.static_weekly_authority_attestation_keys where key_state='active' and activates_at<=now() and (verify_not_after is null or verify_not_after>now());" | tail -n 1)" = '1'
if docker exec "$container" psql -v ON_ERROR_STOP=1 -At -U supabase_admin -d "$database" \
  -c 'set role service_role; truncate public.sessions;' >/dev/null 2>&1; then
  echo 'service_role unexpectedly retained direct terminal DML' >&2
  exit 1
fi

authenticator_password="$(openssl rand -hex 24)"
reader_password="$(openssl rand -hex 24)"
scheduler_password="$(openssl rand -hex 24)"
jwt_secret="$(openssl rand -hex 32)"
docker exec "$container" psql -v ON_ERROR_STOP=1 -U supabase_admin -d "$database" \
  -c "alter role authenticator with login password '$authenticator_password'; grant service_role to authenticator;"
docker exec "$container" psql -v ON_ERROR_STOP=1 -U supabase_admin -d "$database" \
  -c "do \$role\$ begin create role custodial_readonly_runtime_20991231 login password '$reader_password' inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls; exception when duplicate_object then alter role custodial_readonly_runtime_20991231 with login password '$reader_password' inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls; end \$role\$; alter role custodial_readonly_runtime_20991231 set default_transaction_read_only=on; alter role custodial_readonly_runtime_20991231 set statement_timeout='15s'; alter role custodial_readonly_runtime_20991231 set idle_in_transaction_session_timeout='15s'; grant custodial_application_reader to custodial_readonly_runtime_20991231; grant custodial_readonly_runtime_20991231 to supabase_admin with admin option;"
docker exec "$container" psql -v ON_ERROR_STOP=1 -U supabase_admin -d "$database" \
  -c "alter role static_weekly_runtime_20260823 with login password '$scheduler_password';"
service_role_jwt="$(REHEARSAL_JWT_SECRET="$jwt_secret" node scripts/create-rehearsal-service-role-jwt.mjs)"
docker run -d --name "$postgrest_container" --network host \
  -e "PGRST_DB_URI=postgresql://authenticator:${authenticator_password}@127.0.0.1:${mapped_port}/${database}" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e "PGRST_JWT_SECRET=$jwt_secret" -e "PGRST_SERVER_PORT=$postgrest_port" \
  "$postgrest_image"
postgrest_container_owned=true
REHEARSAL_POSTGREST_URL="http://127.0.0.1:${postgrest_port}" \
  REHEARSAL_SUPABASE_REST_PROXY_PORT="$proxy_port" \
  node scripts/supabase-rest-rehearsal-proxy.mjs > "$proxy_log" 2>&1 &
proxy_pid=$!
postgrest_ready=false
for attempt in $(seq 1 120); do
  if curl --fail --silent --show-error "http://127.0.0.1:${proxy_port}/healthz" >/dev/null \
    && curl --fail --silent --show-error \
      -H "apikey: $service_role_jwt" -H "Authorization: Bearer $service_role_jwt" \
      "http://127.0.0.1:${proxy_port}/rest/v1/release_deployment_manifest?select=release_id&limit=1" >/dev/null; then
    postgrest_ready=true
    break
  fi
  sleep 1
done
if test "$postgrest_ready" != true; then
  docker logs "$postgrest_container" > "$postgrest_log" 2>&1 || true
  exit 1
fi
FEEDBACK_PROBE_DATABASE_URL="$local_db_url" \
  FEEDBACK_PROBE_READER_DATABASE_URL="postgresql://custodial_readonly_runtime_20991231:${reader_password}@127.0.0.1:${mapped_port}/${database}" \
  npm run --silent test:feedback-reader-database | tee -a "$receipt"
printf '{"stage":"feedback_reader_database_authority_proven","writer":"app_apply_operational_command.feedback_create","reader_login":"custodial_readonly_runtime_20991231","reader_projection_columns":21,"sole_reader_policy":true,"reader_mutation_denied":true,"legacy_image_backup_hidden":true,"recovery_inventory_exact":true}\n' >> "$receipt"

env -u REHEARSAL_OPS_MANAGER_SESSION_SECRET \
  NODE_ENV=production PORT="$backend_port" SUPABASE_URL="http://127.0.0.1:${proxy_port}" \
  SUPABASE_SERVICE_ROLE_KEY="$service_role_jwt" OPS_MANAGER_SESSION_SECRET="$REHEARSAL_OPS_MANAGER_SESSION_SECRET" \
  CUSTODIAL_BACKEND_PROOF_SECRET="$REHEARSAL_CUSTODIAL_BACKEND_PROOF_SECRET" \
  CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET="$REHEARSAL_CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET" \
  DEVICE_CREDENTIAL_SECRET="$REHEARSAL_DEVICE_CREDENTIAL_SECRET" \
  CUSTODIAL_READONLY_DATABASE_URL="postgresql://custodial_readonly_runtime_20991231:${reader_password}@127.0.0.1:${mapped_port}/${database}" \
  GITHUB_OWNER='lasrevinu333-design' GITHUB_REPO='memphis-zoo-mcp' GITHUB_BRANCH='main' \
  GITHUB_TOKEN="$REHEARSAL_GITHUB_TOKEN" EVENT_MAINTENANCE_SWEEP_MS=0 FEEDBACK_REMINDER_SWEEP_MS=0 \
  OPERATIONAL_NOTIFICATION_SWEEP_MS=0 CUSTODIAL_RESTORE_GATE_REQUIRED=true npm start > "$backend_log" 2>&1 &
backend_pid=$!
env -u REHEARSAL_OPS_MANAGER_SESSION_SECRET \
  NODE_ENV=production PORT="$static_port" SUPABASE_URL="http://127.0.0.1:${proxy_port}" \
  SUPABASE_SERVICE_ROLE_KEY="$service_role_jwt" OPS_MANAGER_SESSION_SECRET="$REHEARSAL_OPS_MANAGER_SESSION_SECRET" \
  STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL="postgresql://static_weekly_runtime_20260823:${scheduler_password}@127.0.0.1:${mapped_port}/${database}" \
  STATIC_WEEKLY_CONTROL_PLANE_ALLOW_INSECURE_LOOPBACK_REHEARSAL=true \
  npm run --silent start:static-weekly-control-plane > "$static_log" 2>&1 &
static_pid=$!
bash scripts/wait-rehearsal-json-endpoint.sh "http://127.0.0.1:${backend_port}/healthz" \
  '.ok == true and .process_alive == true and .probe_scope == "process_liveness"'
bash scripts/verify-isolated-rehearsal-backend-dependencies.sh \
  "http://127.0.0.1:${backend_port}/health/dependencies" "$backend_dependencies_file" "$target_fingerprint"
bash scripts/wait-rehearsal-json-endpoint.sh "http://127.0.0.1:${static_port}/healthz" \
  '.ok == true and .data.process_ready == true'
bash scripts/wait-rehearsal-json-endpoint.sh "http://127.0.0.1:${static_port}/ready" \
  '.ok == true and .data.ready == true'
recovery_operation="$(node -e "console.log(require('node:crypto').randomUUID())")"
recovery_payload="$(jq -nc --arg operation_id "$recovery_operation" --arg commit "$source_commit" '{operation_id:$operation_id,category:"other",priority:"normal",message:("Recovered application write probe for "+$commit),hub_context:"public"}')"
first_status="$(curl --silent --show-error -o "$first_write_file" -w '%{http_code}' \
  -H 'content-type: application/json' --data "$recovery_payload" \
  "http://127.0.0.1:${backend_port}/feedback-api/submit")"
second_status="$(curl --silent --show-error -o "$second_write_file" -w '%{http_code}' \
  -H 'content-type: application/json' --data "$recovery_payload" \
  "http://127.0.0.1:${backend_port}/feedback-api/submit")"
first_write="$(<"$first_write_file")"
second_write="$(<"$second_write_file")"
test "$first_status" = '201'
test "$second_status" = '200'
test "$(jq -r '.ok' <<< "$first_write")" = true
test "$(jq -r '.data.item.newly_inserted' <<< "$first_write")" = true
test "$(jq -r '.ok' <<< "$second_write")" = true
test "$(jq -r '.data.item.newly_inserted' <<< "$second_write")" = false
test "$(jq -r '.data.item.id' <<< "$first_write")" = "$(jq -r '.data.item.id' <<< "$second_write")"
test "$(docker exec "$container" psql -At -U supabase_admin -d "$database" \
  -c "select count(*)::text from public.system_feedback_items where operation_id='$recovery_operation'::uuid")" = '1'
active_mutation_leases="$(docker exec "$container" psql -At -U supabase_admin -d "$database" \
  -c 'select count(*)::text from custodial_dr.application_mutation_leases where expires_at>clock_timestamp()')"
expired_mutation_leases="$(docker exec "$container" psql -At -U supabase_admin -d "$database" \
  -c 'select count(*)::text from custodial_dr.application_mutation_leases where expires_at<=clock_timestamp()')"
test "$active_mutation_leases" = '0'
test "$expired_mutation_leases" = '0'
docker logs "$postgrest_container" > "$postgrest_log" 2>&1 || true
printf '{"stage":"exact_application_pair_recovered","backend_liveness":true,"backend_dependencies_http_status":503,"backend_dependency_invariants_ready":true,"backend_device_credentials_intentionally_revoked":true,"backend_device_credential_reason":"no_active_device_credentials","static_liveness":true,"static_readiness":true,"postgrest_ready":true,"feedback_first_http_status":201,"feedback_replay_http_status":200,"canonical_feedback_write_rows":1,"canonical_http_replay_returned_existing":true,"active_mutation_leases":0,"expired_mutation_leases":%s}\n' \
  "$expired_mutation_leases" >> "$receipt"
completed_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
if test "$provenance_kind" = 'github-actions'; then
  printf '{"ok":true,"backup_run_id":"%s","archive_digest":"%s","source_commit":"%s","source_tree":"%s","source_migration_head":"%s","source_migration_count":%s,"source_migration_ledger_sha256":"%s","source_catalog_fingerprint":"%s","target_migration_head":"%s","target_migration_count":%s,"target_catalog_fingerprint":"%s","active_mutation_leases":0,"expired_mutation_leases":0,"authority_health":true,"direct_dml_denied":true,"live_production_reads":0,"completed_at":"%s"}\n' \
    "$backup_id" "$archive_digest" "$source_commit" "$source_tree" "$migration_head" "$source_migration_count" "$source_migration_ledger_sha256" "$source_catalog_fingerprint" "$target_migration_head" "$target_migration_count" "$target_fingerprint" "$completed_at" >> "$receipt"
else
  printf '{"ok":true,"backup_run_id":"%s","archive_digest":"%s","source_commit":"%s","source_tree":"%s","source_migration_head":"%s","source_migration_count":%s,"source_migration_ledger_sha256":"%s","source_catalog_fingerprint":"%s","target_migration_head":"%s","target_migration_count":%s,"target_catalog_fingerprint":"%s","active_mutation_leases":0,"expired_mutation_leases":0,"authority_health":true,"direct_dml_denied":true,"live_production_reads":0,"completed_at":"%s","provenance_kind":"task-local","local_execution_id":"%s","archive_local_only":true,"external_uploads":0}\n' \
    "$backup_id" "$archive_digest" "$source_commit" "$source_tree" "$migration_head" "$source_migration_count" "$source_migration_ledger_sha256" "$source_catalog_fingerprint" "$target_migration_head" "$target_migration_count" "$target_fingerprint" "$completed_at" "$local_execution_id" >> "$receipt"
fi

if test "$provenance_kind" = 'github-actions'; then
  env -u RELEASE_REHEARSAL_PROVENANCE_KIND -u RELEASE_REHEARSAL_LOCAL_EXECUTION_ID \
    -u RELEASE_MIGRATION_CANDIDATE_COMMIT -u RELEASE_MIGRATION_CANDIDATE_TREE \
    RELEASE_MIGRATION_REHEARSAL_RECEIPT="$receipt" \
    npm run --silent release:migrations:attest-rehearsal > "$attestation"
else
  env -u GITHUB_ACTIONS -u GITHUB_REPOSITORY -u GITHUB_WORKFLOW_REF -u GITHUB_SHA -u GITHUB_RUN_ID -u GITHUB_RUN_ATTEMPT \
    RELEASE_REHEARSAL_PROVENANCE_KIND='task-local' \
    RELEASE_REHEARSAL_LOCAL_EXECUTION_ID="$local_execution_id" \
    RELEASE_MIGRATION_CANDIDATE_COMMIT="$candidate_commit" \
    RELEASE_MIGRATION_CANDIDATE_TREE="$candidate_tree" \
    RELEASE_MIGRATION_REHEARSAL_RECEIPT="$receipt" \
    npm run --silent release:migrations:attest-rehearsal > "$attestation"
fi
test -s "$attestation"
chmod 600 "$attestation"
printf '%s\n' "$receipt"
printf '%s\n' "$attestation"
