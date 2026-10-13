#!/usr/bin/env bash

# Configure Render services to pull private images from AWS ECR.
# The ECR password is intentionally accepted through the environment and never
# printed. Render ECR passwords expire after 12 hours, so CI refreshes the
# workspace credential before every deploy.

set -euo pipefail

usage() {
  echo "usage: $0 update-credential | configure-service SERVICE_ID IMAGE_URL CREDENTIAL_ID AUTODEPLOY_TRIGGER" >&2
  exit 2
}

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "missing required environment variable: $name" >&2
    exit 1
  fi
}

api_url="https://api.render.com/v1"

update_credential() {
  require_env RENDER_API_KEY
  require_env RENDER_OWNER_ID
  require_env RENDER_REGISTRY_CREDENTIAL_NAME
  require_env AWS_ACCOUNT_ID
  require_env ECR_PASSWORD

  local credentials credential_id payload response
  credentials="$(curl --fail --silent --show-error --get \
    --url "$api_url/registrycredentials" \
    --header "Authorization: Bearer $RENDER_API_KEY" \
    --header 'Accept: application/json' \
    --data-urlencode "ownerId=$RENDER_OWNER_ID" \
    --data-urlencode 'limit=100')"

  credential_id="$(jq -r --arg name "$RENDER_REGISTRY_CREDENTIAL_NAME" \
    '[.[] | select(.registry == "AWS_ECR" and .name == $name) | .id] | .[0] // empty' \
    <<< "$credentials")"

  payload="$(jq -n \
    --arg name "$RENDER_REGISTRY_CREDENTIAL_NAME" \
    --arg username "$AWS_ACCOUNT_ID" \
    --arg token "$ECR_PASSWORD" \
    '{registry: "AWS_ECR", name: $name, username: $username, authToken: $token}')"

  if [ -n "$credential_id" ]; then
    response="$(curl --fail --silent --show-error --request PATCH \
      --url "$api_url/registrycredentials/$credential_id" \
      --header "Authorization: Bearer $RENDER_API_KEY" \
      --header 'Accept: application/json' \
      --header 'Content-Type: application/json' \
      --data "$payload")"
  else
    payload="$(jq --arg owner "$RENDER_OWNER_ID" '. + {ownerId: $owner}' <<< "$payload")"
    response="$(curl --fail --silent --show-error --request POST \
      --url "$api_url/registrycredentials" \
      --header "Authorization: Bearer $RENDER_API_KEY" \
      --header 'Accept: application/json' \
      --header 'Content-Type: application/json' \
      --data "$payload")"
    credential_id="$(jq -r '.id // empty' <<< "$response")"
  fi

  if [ -z "$credential_id" ]; then
    echo "Render did not return a registry credential ID" >&2
    exit 1
  fi

  echo "$credential_id"
}

configure_service() {
  [ "$#" -eq 4 ] || usage
  require_env RENDER_API_KEY
  require_env RENDER_OWNER_ID

  local service_id="$1"
  local image_url="$2"
  local credential_id="$3"
  local auto_deploy_trigger="$4"
  local payload

  payload="$(jq -n \
    --arg owner "$RENDER_OWNER_ID" \
    --arg image "$image_url" \
    --arg credential "$credential_id" \
    --arg trigger "$auto_deploy_trigger" \
    '{image: {ownerId: $owner, imagePath: $image, registryCredentialId: $credential}, autoDeployTrigger: $trigger}')"

  curl --fail --silent --show-error --request PATCH \
    --url "$api_url/services/$service_id" \
    --header "Authorization: Bearer $RENDER_API_KEY" \
    --header 'Accept: application/json' \
    --header 'Content-Type: application/json' \
    --data "$payload" \
    >/dev/null
}

[ "$#" -ge 1 ] || usage

case "$1" in
  update-credential)
    [ "$#" -eq 1 ] || usage
    update_credential
    ;;
  configure-service)
    shift
    configure_service "$@"
    ;;
  *)
    usage
    ;;
esac
