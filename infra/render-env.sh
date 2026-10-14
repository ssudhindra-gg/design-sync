#!/usr/bin/env bash

# Add or update one direct Render service environment variable without
# replacing the service's other variables. Values are supplied through the
# process environment so secrets never appear in the repository.

set -euo pipefail

usage() {
  echo "usage: $0 set SERVICE_ID KEY VALUE" >&2
  exit 2
}

[ "${1:-}" = set ] && [ "$#" -eq 4 ] || usage

service_id="$2"
key="$3"
value="$4"
: "${RENDER_API_KEY:?missing RENDER_API_KEY}"

payload="$(jq -n --arg value "$value" '{value: $value}')"
curl --fail --silent --show-error --request PUT \
  --url "https://api.render.com/v1/services/$service_id/env-vars/$key" \
  --header "Authorization: Bearer $RENDER_API_KEY" \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --data "$payload" \
  >/dev/null
