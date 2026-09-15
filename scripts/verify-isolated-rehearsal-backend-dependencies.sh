#!/usr/bin/env bash
set -euo pipefail

if test "$#" -ne 3; then
  echo 'usage: verify-isolated-rehearsal-backend-dependencies.sh <loopback-url> <response-file> <target-fingerprint>' >&2
  exit 2
fi

endpoint="$1"
response_file="$2"
target_fingerprint="$3"
max_attempts="${REHEARSAL_DEPENDENCY_MAX_ATTEMPTS:-120}"
retry_delay_seconds="${REHEARSAL_DEPENDENCY_RETRY_DELAY_SECONDS:-1}"

[[ "$endpoint" =~ ^http://127\.0\.0\.1:[0-9]+/health/dependencies$ ]]
[[ "$target_fingerprint" =~ ^[0-9a-f]{64}$ ]]
[[ "$max_attempts" =~ ^[1-9][0-9]*$ ]]
test "$max_attempts" -le 120
[[ "$retry_delay_seconds" =~ ^(0|1)$ ]]

for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
  status=''
  if status="$(curl --silent --show-error --connect-timeout 2 --max-time 5 \
      --output "$response_file" --write-out '%{http_code}' "$endpoint")" \
    && test "$status" = '503' \
    && jq -e --arg target_fingerprint "$target_fingerprint" '
      .ok == false
      and .process_alive == true
      and .database_reachable == true
      and .read_authority_ready == true
      and .required_schema_present == true
      and .release_canary.configured == false
      and .release_canary.device_identifier == null
      and .release_canary.control_initialized == false
      and .release_canary.paused == null
      and .device_credential_secret.contract_version == "device-credential-secret-readiness.v1"
      and .device_credential_secret.ready == false
      and .device_credential_secret.active_credentials == 0
      and .device_credential_secret.confirmed_credentials == 0
      and .device_credential_secret.unconfirmed_credentials == 0
      and .device_credential_secret.matching_credentials == 0
      and .device_credential_secret.unmarked_credentials == 0
      and .device_credential_secret.mismatched_credentials == 0
      and .device_credential_secret.reason == "no_active_device_credentials"
      and .worker.durable_database_leases == true
      and .schema_fingerprint == $target_fingerprint
    ' "$response_file" >/dev/null; then
    exit 0
  fi
  sleep "$retry_delay_seconds"
done

echo "isolated backend never reached the exact intentional credential-revocation dependency state (last HTTP status: ${status:-none})" >&2
if test -s "$response_file"; then
  jq -c '{ok,process_alive,database_reachable,read_authority_ready,required_schema_present,release_canary,device_credential_secret,worker,schema_fingerprint}' \
    "$response_file" >&2 || true
fi
exit 1
