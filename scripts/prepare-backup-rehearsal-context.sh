encrypted="${RUNNER_TEMP}/encrypted-backup/memphis-zoo-backup.tar.gz.enc"
# Confirm the selected run's current successful attempt, immutable
# uploaded artifact ID, and the producer's verified ciphertext.
backup_run="$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$BACKUP_RUN_ID")"
backup_attempt="$(jq -er --arg id "$BACKUP_RUN_ID" --arg repo "$GITHUB_REPOSITORY" '
  select((.id | tostring) == $id and .repository.full_name == $repo and
    .status == "completed" and .conclusion == "success" and
    .path == ".github/workflows/production-disaster-recovery-backup.yml") |
  .run_attempt | select(type == "number" and . >= 1)' <<<"$backup_run")"
art_name="memphis-zoo-disaster-recovery-$BACKUP_RUN_ID"
backup_artifact_id="$(gh api --paginate "repos/$GITHUB_REPOSITORY/actions/runs/$BACKUP_RUN_ID/artifacts?per_page=100" |
  jq -ser --arg name "$art_name" '
    [.[] | .artifacts[] | select(.name == $name and .expired == false)] |
    select(length == 1) | .[0].id | select(type == "number" and . >= 1)')"
readback_dir="$(mktemp -d "${RUNNER_TEMP}/producer-backup-readback.XXXXXXXX")"
gh run download "$BACKUP_RUN_ID" --repo "$GITHUB_REPOSITORY" \
  --name "backup-readback-receipt-$BACKUP_RUN_ID-$backup_attempt" --dir "$readback_dir"
ciphertext_sha256="$(sha256sum -- "$encrypted" | awk '{print $1}')"
ciphertext_bytes="$(stat -c '%s' -- "$encrypted")"
jq -e --arg repo "$GITHUB_REPOSITORY" --arg run "$BACKUP_RUN_ID" \
  --arg attempt "$backup_attempt" --arg artifact "$backup_artifact_id" \
  --arg digest "$ciphertext_sha256" --argjson size "$ciphertext_bytes" '
  .schema == "custodial.backup-readback.v1" and .repository == $repo and
  .run_id == $run and .run_attempt == $attempt and .artifact_id == $artifact and
  .ciphertext_sha256 == $digest and .ciphertext_bytes == $size and
  .uploaded_artifact_readback == "passed" and .signed_archive_validation == "passed" and
  .database_restore_performed == false and .storage_restore_performed == false
' "$readback_dir/backup-readback-receipt.json" > /dev/null
if test "$PRIVATE_CURRENT429_FORWARD_CAPTURE" = true; then
  test "$BACKUP_RUN_ID" = '45645963579'
  [[ "$CURRENT429_EXPECTED_CANDIDATE" =~ ^[a-f0-9]{40}$ ]]
  test "$CURRENT429_EXPECTED_CANDIDATE" = "$GITHUB_SHA"
  test "$REHEARSAL_SCOPE" = backup_only
  test "$OFFICIAL_LOCAL_STORAGE_PROVIDER" = true
  test "$PRIVATE_CURRENT428_FORWARD_CAPTURE" != true
  test "$PRIVATE_CONTEXT_COST_DIAGNOSTIC_ONLY" != true
  test "$(stat -c '%s' "$encrypted")" = '96961760'
  printf '86e4a42617a7da2c9b6b28ef24a8d3cef9e0e64580fba77aa94666effb8cf3db  %s\n' "$encrypted" | sha256sum --check --status
fi
if test "$PRIVATE_REHEARSAL_SECONDARY_VM" = true; then
  test "$PRIVATE_CURRENT429_FORWARD_CAPTURE" = true
  test "$private_route_active" = true
  test "$GITHUB_ACTOR" = lasrevinu333-design
  test "$GITHUB_REF" = refs/heads/codex/custodial-429-rehearsal-preparation
  source scripts/current429-vm-scratch.sh
else
  test -n "$REHEARSAL_CUSTODIAL_BACKEND_PROOF_SECRET"
  test -n "$REHEARSAL_CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET"
  test -n "$REHEARSAL_DEVICE_CREDENTIAL_SECRET"
  test -n "$REHEARSAL_OPS_MANAGER_SESSION_SECRET"
fi
image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed'
postgrest_image='ghcr.io/supabase/postgrest@sha256:d2009b5c9deffc210c8a5592698472fede14fd9f6ca89823c8474ca54d58c012'
container="mz_schema_rebuild_${GITHUB_RUN_ID}"
postgrest_container="${container}_postgrest"
database="mz_schema_rebuild_${GITHUB_RUN_ID}"
receipt_root="$RUNNER_TEMP"
cleanup() {
  status=$?
  if test -n "${plaintext_dir:-}"; then
    if ! rm -rf -- "$plaintext_dir" || test -e "$plaintext_dir"; then
      printf '%s\n' 'Caller-owned plaintext cleanup was not verified.' >&2
      status=1
    fi
  fi
  if test "$PRIVATE_REHEARSAL_SECONDARY_VM" = true; then
    if test "$RUNNER_TEMP" != "$receipt_root"; then
      for name in production-backup-migration-rehearsal.jsonl private-backup-only-rehearsal.json official-local-storage-provider-evidence; do
        if test -e "$RUNNER_TEMP/$name"; then cp -PR -- "$RUNNER_TEMP/$name" "$receipt_root/" || status=1; fi
      done
    fi
    if close_current429_vm_scratch; then
      printf '{"encrypted_scratch_closed":true,"runner_restored":true}\n' > "$receipt_root/current429-vm-cleanup.json"
    else
      printf '%s\n' 'The rehearsal VM scratch cleanup was not verified.' >&2
      status=1
    fi
    trap - EXIT
    exit "$status"
  fi
  if test "${private_route_active:-false}" = true; then
    trap - EXIT
    exit "$status"
  fi
  for owned_pid in "${backend_pid:-}" "${static_pid:-}" "${proxy_pid:-}"; do
    if test -n "$owned_pid"; then kill "$owned_pid" >/dev/null 2>&1 || true; fi
  done
  if test -n "${auth_dir:-}"; then rm -rf -- "$auth_dir"; fi
  if test "$status" -ne 0 && docker inspect "$container" >/dev/null 2>&1; then
    {
      docker inspect --format 'state={{.State.Status}} oom_killed={{.State.OOMKilled}} exit_code={{.State.ExitCode}} restart_count={{.RestartCount}} health={{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container"
      docker logs --timestamps --tail 2000 "$container"
    } > "$postgres_log" 2>&1 || true
  fi
  docker rm -f "$postgrest_container" >/dev/null 2>&1 || true
  docker rm -f "$container" >/dev/null 2>&1 || true
  trap - EXIT
  exit "$status"
}
