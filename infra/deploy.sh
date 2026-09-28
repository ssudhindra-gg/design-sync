#!/usr/bin/env bash
# Deploy, update and tear down the AWS demo stack (infra/cloudformation.yaml).
#
#   infra/deploy.sh deploy    create or update the stack, print the HTTPS URL
#   infra/deploy.sh update    pull GIT_REF on the instance and rebuild (keeps data)
#   infra/deploy.sh url       print the HTTPS URL
#   infra/deploy.sh e2e       run the Playwright suite against the URL
#   infra/deploy.sh destroy   delete the stack and everything in it
#
# Settings: AWS_REGION (us-east-1), STACK_NAME (design-sync), GIT_REF (main).
# The instance clones the repository from GitHub, so it runs what is pushed
# there, not what is in this working tree.
set -euo pipefail

# Git Bash would otherwise rewrite /opt/... inside arguments into Windows paths.
export MSYS_NO_PATHCONV=1

REGION="${AWS_REGION:-us-east-1}"
STACK="${STACK_NAME:-design-sync}"
GIT_REF="${GIT_REF:-main}"
# Relative paths from here on: the Windows aws.exe cannot read /c/... paths.
cd "$(dirname "$0")/.."

die() { echo "error: $*" >&2; exit 1; }
cfn() { aws cloudformation --region "$REGION" "$@"; }

output() {  # output <OutputKey>
  cfn describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

check_ref_pushed() {
  # Fail now on a ref GitHub does not have, rather than 25 minutes into boot.
  if ! git ls-remote --exit-code origin "$GIT_REF" >/dev/null 2>&1 \
    && ! git fetch -q origin "$GIT_REF" >/dev/null 2>&1; then
    die "GIT_REF '$GIT_REF' is not on GitHub (origin); push it first"
  fi
  if [ "$GIT_REF" = "$(git rev-parse --abbrev-ref HEAD)" ] \
    && [ -n "$(git log --oneline "origin/$GIT_REF..HEAD" 2>/dev/null)" ]; then
    echo "warning: local $GIT_REF has commits not pushed to origin; they will not be deployed" >&2
  fi
}

check_credentials() {
  aws sts get-caller-identity >/dev/null 2>&1 \
    || die "no AWS credentials; run 'aws configure' (or 'aws sso login') first"
}

cloudfront_prefix_list() {
  local id
  id=$(aws ec2 describe-managed-prefix-lists --region "$REGION" \
    --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
    --query 'PrefixLists[0].PrefixListId' --output text)
  [[ "$id" == pl-* ]] || die "CloudFront origin-facing prefix list not found in $REGION"
  echo "$id"
}

wait_for_url() {
  local url=$1
  echo "waiting for $url (CloudFront can take 5-10 minutes on first deploy)..." >&2
  for _ in $(seq 1 90); do
    if curl -fsS -o /dev/null "$url/openapi.json" 2>/dev/null; then return 0; fi
    sleep 10
  done
  die "$url did not answer within 15 minutes"
}

cmd_deploy() {
  check_ref_pushed
  check_credentials
  local prefix_list url
  prefix_list=$(cloudfront_prefix_list)
  cfn deploy --template-file infra/cloudformation.yaml --stack-name "$STACK" \
    --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset \
    --parameter-overrides "GitRef=$GIT_REF" "CloudFrontPrefixListId=$prefix_list"
  url=$(output AppUrl)
  wait_for_url "$url"
  echo "$url"
}

cmd_update() {
  check_ref_pushed
  check_credentials
  local instance command_id status
  instance=$(output InstanceId)
  # No double quotes inside: this string is embedded in JSON below.
  local script="cd /opt/design-sync && git fetch origin && git checkout -f \$(git rev-parse --verify -q origin/$GIT_REF || echo $GIT_REF) && docker compose --progress plain up -d --build"
  command_id=$(aws ssm send-command --region "$REGION" --instance-ids "$instance" \
    --document-name AWS-RunShellScript --comment "design-sync update to $GIT_REF" \
    --parameters "{\"commands\":[\"$script\"],\"executionTimeout\":[\"1800\"]}" \
    --query Command.CommandId --output text)
  echo "updating $instance to $GIT_REF (SSM command $command_id)..." >&2
  for _ in $(seq 1 180); do
    sleep 10
    status=$(aws ssm get-command-invocation --region "$REGION" --command-id "$command_id" \
      --instance-id "$instance" --query Status --output text 2>/dev/null || echo Pending)
    case "$status" in
      Success)
        wait_for_url "$(output AppUrl)"
        echo "updated"
        return 0
        ;;
      Failed | Cancelled | TimedOut)
        aws ssm get-command-invocation --region "$REGION" --command-id "$command_id" \
          --instance-id "$instance" --query StandardErrorContent --output text >&2
        die "update $status"
        ;;
    esac
  done
  die "update still running after 30 minutes; check SSM command $command_id"
}

cmd_e2e() {
  check_credentials
  E2E_BASE_URL="$(output AppUrl)" npm test --prefix e2e
}

cmd_destroy() {
  check_credentials
  cfn delete-stack --stack-name "$STACK"
  echo "deleting $STACK (CloudFront takes several minutes)..." >&2
  cfn wait stack-delete-complete --stack-name "$STACK"
  echo "deleted"
}

case "${1:-}" in
  deploy) cmd_deploy ;;
  update) cmd_update ;;
  url) check_credentials; output AppUrl ;;
  e2e) cmd_e2e ;;
  destroy) cmd_destroy ;;
  *)
    echo "usage: $0 deploy|update|url|e2e|destroy" >&2
    exit 2
    ;;
esac
