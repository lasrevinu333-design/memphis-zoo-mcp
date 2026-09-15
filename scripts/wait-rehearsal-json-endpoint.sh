#!/usr/bin/env bash
set -euo pipefail

if test "$#" -ne 2; then
  echo 'usage: wait-rehearsal-json-endpoint.sh <loopback-url> <jq-predicate>' >&2
  exit 2
fi

endpoint="$1"
predicate="$2"
max_attempts="${REHEARSAL_HEALTH_MAX_ATTEMPTS:-120}"
retry_delay_seconds="${REHEARSAL_HEALTH_RETRY_DELAY_SECONDS:-1}"

[[ "$endpoint" =~ ^http://127\.0\.0\.1:[0-9]+/[A-Za-z0-9/_-]+$ ]]
test -n "$predicate"
[[ "$max_attempts" =~ ^[1-9][0-9]*$ ]]
test "$max_attempts" -le 120
[[ "$retry_delay_seconds" =~ ^(0|1)$ ]]

for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
  if curl --fail --silent --show-error --connect-timeout 2 --max-time 5 "$endpoint" | jq -e "$predicate" >/dev/null; then
    exit 0
  fi
  sleep "$retry_delay_seconds"
done

echo "rehearsal endpoint did not satisfy its exact JSON predicate: $endpoint" >&2
exit 1
