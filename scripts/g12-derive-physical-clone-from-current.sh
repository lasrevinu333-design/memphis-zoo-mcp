set -euo pipefail
umask 077
test "$REHEARSAL_SCOPE" = full_candidate
test "$OFFICIAL_LOCAL_STORAGE_PROVIDER" = false
test "$BACKUP_RUN_ID" = 40454607125
G12_PRODUCT_COMMIT='4803109c968d874519f9dec2278089971bf3530b'
G12_PRODUCT_TREE='2138a5cc4052c1fd4b98d5a9ef69fe7916879f3c'
test "$(git rev-parse HEAD)" = "$G12_PRODUCT_COMMIT"
test "$(git rev-parse HEAD^{tree})" = "$G12_PRODUCT_TREE"
test -z "$(git status --porcelain)"
# NEW task-only keys, never repository production signing secrets.
REHEARSAL_CUSTODIAL_BACKEND_PROOF_SECRET="$(openssl rand -hex 32)"
REHEARSAL_CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET="$(openssl rand -hex 32)"
REHEARSAL_DEVICE_CREDENTIAL_SECRET="$(openssl rand -hex 32)"
REHEARSAL_OPS_MANAGER_SESSION_SECRET="$(openssl rand -hex 32)"
for secret in "$REHEARSAL_CUSTODIAL_BACKEND_PROOF_SECRET" "$REHEARSAL_CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET" "$REHEARSAL_DEVICE_CREDENTIAL_SECRET" "$REHEARSAL_OPS_MANAGER_SESSION_SECRET"; do printf '::add-mask::%s
' "$secret"; done
test -n "$BACKUP_ENCRYPTION_PASSPHRASE"
test -n "$RESTORE_ARCHIVE_VERIFY_KEY"
test -n "$RESTORE_ARCHIVE_VERIFY_KEY_ID"
case "$REHEARSAL_SCOPE" in full_candidate|backup_only|target_capture|reviewed_target_capture) ;; *) exit 1 ;; esac
[[ "$BACKUP_RUN_ID" =~ ^[1-9][0-9]*$ ]]
test -n "$REHEARSAL_CUSTODIAL_BACKEND_PROOF_SECRET"
test -n "$REHEARSAL_CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET"
test -n "$REHEARSAL_DEVICE_CREDENTIAL_SECRET"
test -n "$REHEARSAL_OPS_MANAGER_SESSION_SECRET"
image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed'
postgrest_image='ghcr.io/supabase/postgrest@sha256:d2009b5c9deffc210c8a5592698472fede14fd9f6ca89823c8474ca54d58c012'
container="mz_schema_rebuild_${GITHUB_RUN_ID}"
postgrest_container="${container}_postgrest"
database="mz_schema_rebuild_${GITHUB_RUN_ID}"
backup_dir="${RUNNER_TEMP}/production-backup"
receipt="${RUNNER_TEMP}/production-backup-migration-rehearsal.jsonl"
postgres_log="${RUNNER_TEMP}/production-backup-migration-rehearsal-postgres.log"
cleanup() {
  status=$?
  if test -n "${backend_pid:-}"; then kill "$backend_pid" >/dev/null 2>&1 || true; fi
  if test -n "${static_pid:-}"; then kill "$static_pid" >/dev/null 2>&1 || true; fi
  if test -n "${proxy_pid:-}"; then kill "$proxy_pid" >/dev/null 2>&1 || true; fi
  if test "$status" -ne 0 && docker inspect "$container" >/dev/null 2>&1; then
    {
      docker inspect --format 'state={{.State.Status}} oom_killed={{.State.OOMKilled}} exit_code={{.State.ExitCode}} restart_count={{.RestartCount}} health={{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container"
      docker logs --timestamps --tail 2000 "$container"
    } > "$postgres_log" 2>&1 || true
  fi
  docker rm -f "$postgrest_container" >/dev/null 2>&1 || true
  docker rm -f "$container" >/dev/null 2>&1 || true
  return "$status"
}
trap cleanup EXIT
printf '{"started":true,"backup_run_id":"%s","rehearsal_target_commit":"%s"}\n' "$BACKUP_RUN_ID" "$G12_PRODUCT_COMMIT" > "$receipt"
mkdir -p "$backup_dir"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 \
  -in "${RUNNER_TEMP}/encrypted-backup/memphis-zoo-backup.tar.gz.enc" \
  -out "${RUNNER_TEMP}/memphis-zoo-backup.tar.gz" \
  -pass env:BACKUP_ENCRYPTION_PASSPHRASE
tar -C "$backup_dir" -xzf "${RUNNER_TEMP}/memphis-zoo-backup.tar.gz"
RESTORE_SOURCE_DIR="$backup_dir" npm run --silent restore:verify | tee -a "$receipt"
read -r archive_format source_commit source_tree project_ref migration_head source_migration_count source_migration_ledger_sha256 archive_digest \
  < <(node scripts/production-backup-rehearsal-scope.mjs metadata)
source_catalog_fingerprint="$(jq -r '.observed_production.catalog_privilege_fingerprint' release/production-migration-state.json)"
test "$archive_format" = 'memphis-zoo-disaster-recovery.v4'
if test "$REHEARSAL_SCOPE" != full_candidate; then
  node scripts/production-backup-rehearsal-scope.mjs source-binding
else
  test "$source_commit" = "$G12_PRODUCT_COMMIT"
  test "$(git rev-parse HEAD^{tree})" = "$source_tree"
fi
printf '{"stage":"archive_source_bound","format":"%s","source_commit":"%s","source_tree":"%s","migration_head":"%s"}\n' \
  "$archive_format" "$source_commit" "$source_tree" "$migration_head" >> "$receipt"
docker pull "$image"
if test "$REHEARSAL_SCOPE" = full_candidate; then docker pull "$postgrest_image"; fi
pg_tmpfs=1g
if test "$OFFICIAL_LOCAL_STORAGE_PROVIDER" = true; then test "$REHEARSAL_SCOPE" = backup_only; pg_tmpfs=2g; fi
docker run -d --name "$container" --tmpfs "/var/lib/postgresql/data:rw,size=$pg_tmpfs" \
  -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=postgres -e PGPASSWORD=postgres \
  "$image" postgres -D /etc/postgresql \
  -c listen_addresses='*' \
  -c shared_preload_libraries=pg_cron,pg_net,pg_stat_statements \
  -c cron.database_name="$database" -c cron.launch_active_jobs=off
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
docker exec "$container" createdb -U supabase_admin -O postgres -T template0 "$database"
port="$(docker port "$container" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
test -n "$port"
local_db_url="postgresql://supabase_admin:postgres@127.0.0.1:${port}/${database}"
# Restore the already authenticated inventory/application-schema.sql unchanged.
RESTORE_SOURCE_DIR="$backup_dir" SUPABASE_DB_URL="$local_db_url" \
  node scripts/restore-isolated-event-owner-schema.mjs | tee -a "$receipt"
RESTORE_SOURCE_DIR="$backup_dir" SUPABASE_DB_URL="$local_db_url" \
  npm run --silent restore:prepare-isolated | tee -a "$receipt"
restore_command=(npm run --silent restore:verify)
if test "$OFFICIAL_LOCAL_STORAGE_PROVIDER" = true; then
  test "$REHEARSAL_SCOPE" = backup_only
  restore_command=(node scripts/run-official-local-storage-rehearsal.mjs)
fi
intent_key="$(openssl rand -hex 32)"
intent_key_id="isolated-rehearsal-${GITHUB_RUN_ID}"
intent_file="${RUNNER_TEMP}/isolated-restore-intent.json"
RESTORE_SOURCE_DIR="$backup_dir" SUPABASE_DB_URL="$local_db_url" \
  SUPABASE_PROJECT_REF="$project_ref" RESTORE_NAMED_ACTOR='GitHub isolated restore rehearsal' \
  RESTORE_INTENT_SIGNING_KEY="$intent_key" RESTORE_INTENT_SIGNING_KEY_ID="$intent_key_id" \
  npm run --silent restore:intent > "$intent_file"
RESTORE_APPLY=true RESTORE_DATABASE_ONLY=true RESTORE_SOURCE_DIR="$backup_dir" \
  SUPABASE_DB_URL="$local_db_url" SUPABASE_PROJECT_REF="$project_ref" RESTORE_CONFIRM_PROJECT_REF="$project_ref" \
  RESTORE_ARCHIVE_VERIFY_KEY="$RESTORE_ARCHIVE_VERIFY_KEY" RESTORE_ARCHIVE_VERIFY_KEY_ID="$RESTORE_ARCHIVE_VERIFY_KEY_ID" \
  RESTORE_INTENT_VERIFY_KEY="$intent_key" RESTORE_INTENT_VERIFY_KEY_ID="$intent_key_id" \
  RESTORE_INTENT_JSON="$(<"$intent_file")" \
  "${restore_command[@]}" | tee "${RUNNER_TEMP}/backup-only-owned-restore-result.json" -a "$receipt"
if test "$REHEARSAL_SCOPE" = backup_only; then
  if test "$OFFICIAL_LOCAL_STORAGE_PROVIDER" != true; then node scripts/production-backup-rehearsal-scope.mjs restore-result | tee -a "$receipt"; fi
  exit 0
fi
# Diagnostic target_capture stops on its NEW copy before any resolve/unpause.
# The historical paused restore and its discrepancies are never reused.
if test "$REHEARSAL_SCOPE" = target_capture; then
  RESTORE_SOURCE_DIR="$backup_dir" SUPABASE_DB_URL="$local_db_url" \
    RESTORE_REHEARSAL_EXPECTED_ARCHIVE_DIGEST="$archive_digest" \
    node scripts/export-isolated-pre-reconcile-metadata.mjs | tee -a "$receipt"
  exit 78 # Defensive: helper normally returns78 after durable metadata export.
fi
if test "$REHEARSAL_SCOPE" = reviewed_target_capture; then
  RESTORE_SOURCE_DIR="$backup_dir" SUPABASE_DB_URL="$local_db_url" RESTORE_REHEARSAL_EXPECTED_ARCHIVE_DIGEST="$archive_digest" \
    node scripts/export-isolated-pre-reconcile-metadata.mjs --reviewed-target-capture | tee -a "$receipt"
  rj="${RUNNER_TEMP}/target-capture-reviewed-resolutions.json"
  ri="${RUNNER_TEMP}/target-capture-signed-reconciliation.json"
  export SUPABASE_DB_URL="$local_db_url" SUPABASE_PROJECT_REF="$project_ref"
  export RESTORE_RECONCILIATION_NAMED_ACTOR='Root reviewed isolated target capture'
  export RESTORE_RECONCILIATION_SIGNING_KEY="$intent_key" RESTORE_RECONCILIATION_SIGNING_KEY_ID="$intent_key_id"
  RESTORE_RECONCILIATION_RESOLUTIONS_JSON="$(<"$rj")" npm run --silent restore:reconciliation:create > "$ri"
  RESTORE_RECONCILIATION_CONFIRM_PROJECT_REF="$project_ref" RESTORE_RECONCILIATION_VERIFY_KEY="$intent_key" RESTORE_RECONCILIATION_VERIFY_KEY_ID="$intent_key_id" RESTORE_RECONCILIATION_JSON="$(<"$ri")" \
    npm run --silent restore:reconciliation:apply | tee -a "$receipt"
  RESTORE_SOURCE_DIR="$backup_dir" node scripts/verify-isolated-source-lease-state.mjs | tee -a "$receipt"
  node scripts/run-release-migration-target-capture.mjs "$backup_dir" "$container" "$port" | tee -a "$receipt"
  exit 0
fi
RESTORE_REHEARSAL_ACCEPT_EMPTY_TARGET=true RESTORE_REHEARSAL_EXPECTED_ARCHIVE_DIGEST="$archive_digest" \
  SUPABASE_DB_URL="$local_db_url" npm run --silent restore:reconcile-isolated | tee -a "$receipt"
RESTORE_SOURCE_DIR="$backup_dir" SUPABASE_DB_URL="$local_db_url" \
  node scripts/verify-isolated-source-lease-state.mjs | tee -a "$receipt"
if test "$REHEARSAL_SCOPE" = target_capture; then
  node scripts/run-release-migration-target-capture.mjs "$backup_dir" "$container" "$port" | tee -a "$receipt"
  exit 0
fi
SCHEMA_FINGERPRINT_DOCKER_CONTAINER="$container" SCHEMA_FINGERPRINT_DATABASE="$database" \
  npm run --silent release:observed-production-schema:preflight | tee -a "$receipt"
# Real Actions GITHUB_SHA/control identity is never overwritten.
RELEASE_MIGRATION_APPLY=true RELEASE_MIGRATION_REHEARSAL=true RELEASE_MIGRATION_TARGET_CAPTURE=false \
  RELEASE_MIGRATION_CANDIDATE_COMMIT="$G12_PRODUCT_COMMIT" RELEASE_MIGRATION_CANDIDATE_TREE="$G12_PRODUCT_TREE" \
  RELEASE_MIGRATION_CONFIRM_PROJECT_REF="$project_ref" SUPABASE_PROJECT_REF="$project_ref" \
  RELEASE_MIGRATION_NAMED_ACTOR="GitHub production backup migration rehearsal ${GITHUB_RUN_ID}" \
  RELEASE_MIGRATION_SOURCE_LEDGER_SHA256="$source_migration_ledger_sha256" \
  SCHEMA_FINGERPRINT_DOCKER_CONTAINER="$container" RESTORE_SOURCE_DIR="$backup_dir" \
  SUPABASE_DB_URL="postgresql://postgres:postgres@127.0.0.1:${port}/${database}" \
  node scripts/apply-release-migration-plan.mjs | tee -a "$receipt"
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
target_fingerprint="$(jq -er '.target.canonical_source_schema_fingerprint | select(test("^[0-9a-f]{64}$"))' release/production-migration-state.json)"
echo ' target-ledger-head'
test "$(docker exec "$container" psql -v ON_ERROR_STOP=1 -At -U supabase_admin -d "$database" \
  -c 'select max(version)::text from supabase_migrations.schema_migrations;' | tail -n 1)" = "$target_migration_head"
echo ' target-ledger-count'
test "$(docker exec "$container" psql -v ON_ERROR_STOP=1 -At -U supabase_admin -d "$database" \
  -c 'select count(*)::text from supabase_migrations.schema_migrations;' | tail -n 1)" = "$target_migration_count"
echo ' source-target-distinct'
test "$target_migration_head" != "$migration_head"
echo ' backend-authority-health'
test "$(docker exec "$container" psql -v ON_ERROR_STOP=1 -At -U supabase_admin -d "$database" \
  -c "select public.custodial_backend_authority_health('$REHEARSAL_CUSTODIAL_BACKEND_PROOF_SECRET')->>'ok';" | tail -n 1)" = 'true'
echo ' active-scheduler-key-count'
test "$(docker exec "$container" psql -v ON_ERROR_STOP=1 -At -U supabase_admin -d "$database" \
  -c "select count(*) from public.static_weekly_authority_attestation_keys where key_state='active' and activates_at<=now() and (verify_not_after is null or verify_not_after>now());" | tail -n 1)" = '1'
echo ' terminal-direct-dml-denied'
if docker exec "$container" psql -v ON_ERROR_STOP=1 -At -U supabase_admin -d "$database" \
  -c 'set role service_role; truncate public.sessions;' >/dev/null 2>&1; then
  echo 'service_role unexpectedly retained direct terminal DML' >&2
  exit 1
fi
authenticator_password="$(openssl rand -hex 24)"
reader_password="$(openssl rand -hex 24)"
scheduler_password="$(openssl rand -hex 24)"
jwt_secret="$(openssl rand -hex 32)"
for secret in "$authenticator_password" "$reader_password" "$scheduler_password" "$jwt_secret"; do printf '::add-mask::%s\n' "$secret"; done
docker exec "$container" psql -v ON_ERROR_STOP=1 -U supabase_admin -d "$database" \
  -c "alter role authenticator with login password '$authenticator_password'; grant service_role to authenticator;"
docker exec "$container" psql -v ON_ERROR_STOP=1 -U supabase_admin -d "$database" \
  -c "do \$role\$ begin create role custodial_readonly_runtime_20991231 login password '$reader_password' inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls; exception when duplicate_object then alter role custodial_readonly_runtime_20991231 with login password '$reader_password' inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls; end \$role\$; alter role custodial_readonly_runtime_20991231 set default_transaction_read_only=on; alter role custodial_readonly_runtime_20991231 set statement_timeout='15s'; alter role custodial_readonly_runtime_20991231 set idle_in_transaction_session_timeout='15s'; grant custodial_application_reader to custodial_readonly_runtime_20991231; grant custodial_readonly_runtime_20991231 to supabase_admin with admin option;"
docker exec "$container" psql -v ON_ERROR_STOP=1 -U supabase_admin -d "$database" \
  -c "alter role static_weekly_runtime_20260823 with login password '$scheduler_password';"
service_role_jwt="$(REHEARSAL_JWT_SECRET="$jwt_secret" node scripts/create-rehearsal-service-role-jwt.mjs)"
printf '::add-mask::%s\n' "$service_role_jwt"
postgrest_log="${RUNNER_TEMP}/production-backup-rehearsal-postgrest.log"
proxy_log="${RUNNER_TEMP}/production-backup-rehearsal-supabase-rest-proxy.log"
docker run -d --name "$postgrest_container" --network host \
  -e "PGRST_DB_URI=postgresql://authenticator:${authenticator_password}@127.0.0.1:${port}/${database}" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e "PGRST_JWT_SECRET=$jwt_secret" -e PGRST_SERVER_PORT=31869 \
  "$postgrest_image"
REHEARSAL_POSTGREST_URL='http://127.0.0.1:31869' \
  REHEARSAL_SUPABASE_REST_PROXY_PORT=31870 \
  node scripts/supabase-rest-rehearsal-proxy.mjs >"$proxy_log" 2>&1 &
proxy_pid=$!
postgrest_ready=false
for attempt in $(seq 1 120); do
  if curl --fail --silent --show-error 'http://127.0.0.1:31870/healthz' >/dev/null \
    && curl --fail --silent --show-error \
      -H "apikey: $service_role_jwt" -H "Authorization: Bearer $service_role_jwt" \
      'http://127.0.0.1:31870/rest/v1/release_deployment_manifest?select=release_id&limit=1' >/dev/null; then
    postgrest_ready=true
    break
  fi
  sleep 1
done
if test "$postgrest_ready" != true; then
  docker logs "$postgrest_container" >"$postgrest_log" 2>&1 || true
  exit 1
fi
FEEDBACK_PROBE_DATABASE_URL="$local_db_url" \
  FEEDBACK_PROBE_READER_DATABASE_URL="postgresql://custodial_readonly_runtime_20991231:${reader_password}@127.0.0.1:${port}/${database}" \
  npm run --silent test:feedback-reader-database | tee -a "$receipt"
printf '{"stage":"feedback_reader_database_authority_proven","probe":"test:feedback-reader-database","ok":true}\n' >> "$receipt"
backend_log="${RUNNER_TEMP}/production-backup-rehearsal-backend.log"
backend_dependencies_file="${RUNNER_TEMP}/production-backup-rehearsal-backend-dependencies.json"
static_log="${RUNNER_TEMP}/production-backup-rehearsal-static-weekly.log"
env -u REHEARSAL_OPS_MANAGER_SESSION_SECRET \
  NODE_ENV=production PORT=31871 SUPABASE_URL='http://127.0.0.1:31870' \
  SUPABASE_SERVICE_ROLE_KEY="$service_role_jwt" \
  OPS_MANAGER_SESSION_SECRET="$REHEARSAL_OPS_MANAGER_SESSION_SECRET" \
  CUSTODIAL_BACKEND_PROOF_SECRET="$REHEARSAL_CUSTODIAL_BACKEND_PROOF_SECRET" \
  CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET="$REHEARSAL_CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET" \
  DEVICE_CREDENTIAL_SECRET="$REHEARSAL_DEVICE_CREDENTIAL_SECRET" \
  CUSTODIAL_READONLY_DATABASE_URL="postgresql://custodial_readonly_runtime_20991231:${reader_password}@127.0.0.1:${port}/${database}" \
  GITHUB_OWNER='lasrevinu333-design' GITHUB_REPO='memphis-zoo-mcp' GITHUB_BRANCH='main' \
  GITHUB_TOKEN="$REHEARSAL_GITHUB_TOKEN" \
  EVENT_MAINTENANCE_SWEEP_MS=0 FEEDBACK_REMINDER_SWEEP_MS=0 OPERATIONAL_NOTIFICATION_SWEEP_MS=0 \
  CUSTODIAL_RESTORE_GATE_REQUIRED=true npm start >"$backend_log" 2>&1 &
backend_pid=$!
env -u REHEARSAL_OPS_MANAGER_SESSION_SECRET \
  NODE_ENV=production PORT=31872 SUPABASE_URL='http://127.0.0.1:31870' \
  SUPABASE_SERVICE_ROLE_KEY="$service_role_jwt" \
  OPS_MANAGER_SESSION_SECRET="$REHEARSAL_OPS_MANAGER_SESSION_SECRET" \
  STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL="postgresql://static_weekly_runtime_20260823:${scheduler_password}@127.0.0.1:${port}/${database}" \
  STATIC_WEEKLY_CONTROL_PLANE_ALLOW_INSECURE_LOOPBACK_REHEARSAL=true \
  npm run --silent start:static-weekly-control-plane >"$static_log" 2>&1 &
static_pid=$!
bash scripts/wait-rehearsal-json-endpoint.sh 'http://127.0.0.1:31871/healthz' \
  '.ok == true and .process_alive == true and .probe_scope == "process_liveness"'
bash scripts/verify-isolated-rehearsal-backend-dependencies.sh \
  'http://127.0.0.1:31871/health/dependencies' "$backend_dependencies_file" "$(tr -d '\r\n' < supabase/canonical/schema-fingerprint.txt)"
bash scripts/wait-rehearsal-json-endpoint.sh 'http://127.0.0.1:31872/healthz' \
  '.ok == true and .data.process_ready == true'
bash scripts/wait-rehearsal-json-endpoint.sh 'http://127.0.0.1:31872/ready' \
  '.ok == true and .data.ready == true'
recovery_operation="$(node -e "console.log(require('node:crypto').randomUUID())")"
recovery_payload="$(jq -nc --arg operation_id "$recovery_operation" --arg commit "$source_commit" '{operation_id:$operation_id,category:"other",priority:"normal",message:("Recovered application write probe for "+$commit),hub_context:"public"}')"
first_write_file="${RUNNER_TEMP}/production-backup-rehearsal-feedback-first.json"
second_write_file="${RUNNER_TEMP}/production-backup-rehearsal-feedback-replay.json"
first_status="$(curl --silent --show-error -o "$first_write_file" -w '%{http_code}' \
  -H 'content-type: application/json' --data "$recovery_payload" \
  'http://127.0.0.1:31871/feedback-api/submit')"
second_status="$(curl --silent --show-error -o "$second_write_file" -w '%{http_code}' \
  -H 'content-type: application/json' --data "$recovery_payload" \
  'http://127.0.0.1:31871/feedback-api/submit')"
first_write="$(<"$first_write_file")"
second_write="$(<"$second_write_file")"
test "$first_status" = '201'
test "$second_status" = '200'
test "$(jq -r '.ok' <<<"$first_write")" = true
test "$(jq -r '.data.item.newly_inserted' <<<"$first_write")" = true
test "$(jq -r '.ok' <<<"$second_write")" = true
test "$(jq -r '.data.item.newly_inserted' <<<"$second_write")" = false
test "$(jq -r '.data.item.id' <<<"$first_write")" = "$(jq -r '.data.item.id' <<<"$second_write")"
test "$(docker exec "$container" psql -At -U supabase_admin -d "$database" \
  -c "select count(*)::text from public.system_feedback_items where operation_id='$recovery_operation'::uuid")" = '1'
active_mutation_leases="$(docker exec "$container" psql -At -U supabase_admin -d "$database" \
  -c 'select count(*)::text from custodial_dr.application_mutation_leases where expires_at>clock_timestamp()')"
expired_mutation_leases="$(docker exec "$container" psql -At -U supabase_admin -d "$database" \
  -c 'select count(*)::text from custodial_dr.application_mutation_leases where expires_at<=clock_timestamp()')"
test "$active_mutation_leases" = '0'
test "$expired_mutation_leases" = '0'
docker logs "$postgrest_container" >"$postgrest_log" 2>&1 || true
printf '{"stage":"exact_application_pair_recovered","backend_liveness":true,"backend_dependencies_http_status":503,"backend_dependency_invariants_ready":true,"backend_device_credentials_intentionally_revoked":true,"backend_device_credential_reason":"no_active_device_credentials","static_liveness":true,"static_readiness":true,"postgrest_ready":true,"feedback_first_http_status":201,"feedback_replay_http_status":200,"canonical_feedback_write_rows":1,"canonical_http_replay_returned_existing":true,"active_mutation_leases":0,"expired_mutation_leases":%s}\n' "$expired_mutation_leases" >> "$receipt"
completed_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
printf '{"ok":true,"backup_run_id":"%s","archive_digest":"%s","source_commit":"%s","source_tree":"%s","source_migration_head":"%s","source_migration_count":%s,"source_migration_ledger_sha256":"%s","source_catalog_fingerprint":"%s","target_migration_head":"%s","target_migration_count":%s,"target_catalog_fingerprint":"%s","active_mutation_leases":0,"expired_mutation_leases":0,"authority_health":true,"direct_dml_denied":true,"live_production_reads":0,"completed_at":"%s"}\n' \
  "$BACKUP_RUN_ID" "$archive_digest" "$source_commit" "$source_tree" "$migration_head" "$source_migration_count" "$source_migration_ledger_sha256" "$source_catalog_fingerprint" "$target_migration_head" "$target_migration_count" "$target_fingerprint" "$completed_at" >> "$receipt"

# Consistent pg_basebackup hook BEFORE cleanup removes the original tmpfs/CID.
G12_LOCAL_BACKEND_PROOF_SECRET="$REHEARSAL_CUSTODIAL_BACKEND_PROOF_SECRET" \
G12_LOCAL_NATIVE_ROUTE_PROOF_SECRET="$REHEARSAL_CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET" \
G12_LOCAL_DEVICE_CREDENTIAL_SECRET="$REHEARSAL_DEVICE_CREDENTIAL_SECRET" \
G12_LOCAL_OPS_MANAGER_SESSION_SECRET="$REHEARSAL_OPS_MANAGER_SESSION_SECRET" \
G12_LOCAL_AUTHENTICATOR_PASSWORD="$authenticator_password" \
G12_LOCAL_READER_PASSWORD="$reader_password" G12_LOCAL_SCHEDULER_PASSWORD="$scheduler_password" \
G12_LOCAL_JWT_SECRET="$jwt_secret" G12_LOCAL_SERVICE_ROLE_JWT="$service_role_jwt" \
  node ../scripts/g12-export-consistent-physical-clone.mjs ../G12_PHYSICAL_EXPORT_PLAN.NOT_ADMITTED.json
