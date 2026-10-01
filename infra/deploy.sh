#!/usr/bin/env bash
# Deploy, update and tear down the AWS demo stack (infra/cloudformation.yaml).
#
#   infra/deploy.sh deploy    create or update the stack, print the HTTPS URL
#   infra/deploy.sh update    pull GIT_REF on the instance and rebuild (keeps data)
#   infra/deploy.sh url       print the HTTPS URL
#   infra/deploy.sh e2e       run the Playwright suite against the URL
#   infra/deploy.sh release   CI: deploy, then update to RELEASE_SHA (full SHA)
#   infra/deploy.sh verify S  wait until /api/health reports commit S, database ok
#   infra/deploy.sh oidc      one-time: GitHub OIDC deploy role (admin credentials)
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
OIDC_STACK="${OIDC_STACK_NAME:-design-sync-github-oidc}"
# How long `verify` polls (overridable for the offline checks).
VERIFY_ATTEMPTS="${VERIFY_ATTEMPTS:-60}"
VERIFY_INTERVAL="${VERIFY_INTERVAL:-10}"
# Relative paths from here on: the Windows aws.exe cannot read /c/... paths.
cd "$(dirname "$0")/.."

die() { echo "error: $*" >&2; exit 1; }
cfn() { aws cloudformation --region "$REGION" "$@"; }

output() {  # output <OutputKey>
  cfn describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

stack_parameter() {  # stack_parameter <ParameterKey>
  cfn describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Parameters[?ParameterKey=='$1'].ParameterValue" --output text
}

# Empty when the stack does not exist.
stack_status() {  # stack_status [stack name]
  cfn describe-stacks --stack-name "${1:-$STACK}" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true
}

app_url() {
  local url
  url=$(output AppUrl 2>/dev/null || true)
  [[ "$url" == https://* ]] || die "stack $STACK in $REGION has no AppUrl; deploy it first (make aws-deploy)"
  echo "$url"
}

latest_ami() {
  aws ssm get-parameter --region "$REGION" \
    --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
    --query Parameter.Value --output text
}

check_ref_pushed() {
  # Fail now on a ref GitHub does not have, or one without the infra files the
  # instance runs, rather than minutes into a create that then rolls back.
  git fetch -q origin "$GIT_REF" >/dev/null 2>&1 \
    || die "GIT_REF '$GIT_REF' is not on GitHub (origin); push it first"
  git cat-file -e "FETCH_HEAD:infra/bootstrap.sh" 2>/dev/null \
    || die "GIT_REF '$GIT_REF' on GitHub has no infra/bootstrap.sh; push or merge the infra files first"
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
    if curl -fsS -o /dev/null "$url/api/health" 2>/dev/null; then return 0; fi
    sleep 10
  done
  die "$url did not answer within 15 minutes"
}

cmd_deploy() {
  check_credentials
  check_ref_pushed
  local prefix_list url status deployed_ref
  local pinned=()
  status=$(stack_status)
  case "$status" in
    "")
      # First deploy: pin the AMI and the ref. Later deploys leave both at
      # their previous values, because a new AMI would replace the instance
      # (deleting the database) and a new ref would only stop/start it.
      pinned=("GitRef=$GIT_REF" "AmiId=$(latest_ami)")
      ;;
    ROLLBACK_COMPLETE)
      die "the first create of $STACK failed and rolled back; run 'make aws-destroy', then deploy again (DISABLE_ROLLBACK=1 keeps a failed instance for debugging)"
      ;;
    *)
      deployed_ref=$(stack_parameter GitRef)
      [ "$deployed_ref" = "$GIT_REF" ] \
        || die "$STACK runs '$deployed_ref'; deploy other code with 'GIT_REF=$GIT_REF make aws-update'"
      ;;
  esac
  prefix_list=$(cloudfront_prefix_list)
  cfn deploy --template-file infra/cloudformation.yaml --stack-name "$STACK" \
    --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset \
    ${DISABLE_ROLLBACK:+--disable-rollback} \
    --parameter-overrides "CloudFrontPrefixListId=$prefix_list" "${pinned[@]}"
  url=$(app_url)
  wait_for_url "$url"
  echo "$url"
}

cmd_update() {
  check_credentials
  check_ref_pushed
  local instance command_id status
  instance=$(output InstanceId)
  # No double quotes inside: this string is embedded in JSON below. The build
  # log goes to a file because SSM keeps only the first 8,000 characters of
  # stderr, and a failed build's error comes last.
  local log=/var/log/design-sync-update.log
  local script="{ cd /opt/design-sync && git fetch origin && git checkout -f \$(git rev-parse --verify -q origin/$GIT_REF || echo $GIT_REF) && export APP_VERSION=\$(git rev-parse HEAD) && docker compose --progress plain up -d --build; } > $log 2>&1 || { tail -n 60 $log >&2; exit 1; }"
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
        wait_for_url "$(app_url)"
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
  local url
  # Resolved first: an empty E2E_BASE_URL would silently test local docker instead.
  url=$(app_url)
  E2E_BASE_URL="$url" npm test --prefix e2e
}

cmd_destroy() {
  check_credentials
  cfn delete-stack --stack-name "$STACK"
  echo "deleting $STACK (CloudFront takes several minutes)..." >&2
  cfn wait stack-delete-complete --stack-name "$STACK"
  echo "deleted"
}

cmd_release() {
  [[ "${RELEASE_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || die "RELEASE_SHA must be the full commit SHA to release"
  # Never move the instance back to an older commit: deploy jobs run one at a
  # time but not in push order, and old runs can be re-run. When main has
  # moved on, the newer push's own run releases its commit.
  local tip
  git fetch -q origin main >/dev/null 2>&1 || die "cannot fetch main from origin"
  tip=$(git rev-parse FETCH_HEAD)
  if [ "$tip" != "$RELEASE_SHA" ]; then
    echo "$RELEASE_SHA is superseded by $tip on main; skipping the release" >&2
    ci_output released=false
    return 0
  fi
  check_credentials
  # deploy applies template changes under the ref the stack was created with
  # (main for a new stack); update then moves the instance to the exact commit.
  local status
  status=$(stack_status)
  if [ -n "$status" ] && [ "$status" != ROLLBACK_COMPLETE ]; then
    GIT_REF=$(stack_parameter GitRef)
  else
    GIT_REF=main
  fi
  cmd_deploy
  GIT_REF=$RELEASE_SHA
  cmd_update
  ci_output released=true
}

# Hand a key=value to later GitHub Actions steps; a no-op outside Actions.
ci_output() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1" >> "$GITHUB_OUTPUT"; fi
}

# True when a /api/health body reports status and database ok and version $2.
# Pattern matching, not a JSON parser: the app renders compact JSON.
health_ok() {
  [[ "$1" == *'"status":"ok"'* && "$1" == *'"database":"ok"'* && "$1" == *"\"version\":\"$2\""* ]]
}

cmd_verify() {
  local want=${1:-} url body=""
  [[ "$want" =~ ^[0-9a-f]{40}$ ]] || die "usage: $0 verify <full commit sha>"
  check_credentials
  url=$(app_url)
  for _ in $(seq 1 "$VERIFY_ATTEMPTS"); do
    body=$(curl -fsS "$url/api/health" 2>/dev/null || true)
    if health_ok "$body" "$want"; then
      echo "healthy: $url runs $want"
      return 0
    fi
    sleep "$VERIFY_INTERVAL"
  done
  die "$url/api/health never reported $want with the database ok; last response: ${body:-<none>}"
}

github_repository() {
  git remote get-url origin | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##'
}

cmd_oidc() {
  check_credentials
  local provider arn
  local params=("GitHubRepository=$(github_repository)")
  if [ -z "$(stack_status "$OIDC_STACK")" ]; then
    # One provider per URL per account: reuse an existing one. Decided at
    # create only; later runs keep the stack's values, so a provider this
    # stack created is never handed over and deleted.
    provider=$(aws iam list-open-id-connect-providers \
      --query "OpenIDConnectProviderList[?ends_with(Arn, '/token.actions.githubusercontent.com')].Arn | [0]" \
      --output text)
    if [[ "$provider" == arn:* ]]; then
      params+=("CreateOidcProvider=false" "ExistingOidcProviderArn=$provider")
    else
      params+=("CreateOidcProvider=true")
    fi
  fi
  cfn deploy --template-file infra/github-oidc.yaml --stack-name "$OIDC_STACK" \
    --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset \
    --parameter-overrides "${params[@]}"
  arn=$(cfn describe-stacks --stack-name "$OIDC_STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue" --output text)
  echo "Set these GitHub repository variables (Settings > Secrets and variables > Actions > Variables):"
  echo "  AWS_ROLE_ARN=$arn"
  echo "  AWS_REGION=$REGION"
}

case "${1:-}" in
  deploy) cmd_deploy ;;
  update) cmd_update ;;
  url) check_credentials; app_url ;;
  release) cmd_release ;;
  verify) cmd_verify "${2:-}" ;;
  oidc) cmd_oidc ;;
  e2e) cmd_e2e ;;
  destroy) cmd_destroy ;;
  *)
    echo "usage: $0 deploy|update|release|verify|url|e2e|oidc|destroy" >&2
    exit 2
    ;;
esac
