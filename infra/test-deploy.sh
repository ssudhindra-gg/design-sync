#!/usr/bin/env bash
# Offline checks for infra/deploy.sh and the template. Never talks to AWS in a
# way that could create anything: credentials are hidden from every call.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

failures=0
check() {  # check <name> <expected exit> <expected output regex> -- <command...>
  local name=$1 want_status=$2 want_output=$3
  shift 4
  local output status
  output=$("$@" 2>&1)
  status=$?
  if [ "$status" -eq "$want_status" ] && grep -Eq "$want_output" <<<"$output"; then
    echo "ok   $name"
  else
    echo "FAIL $name (exit $status, wanted $want_status matching /$want_output/):"
    # shellcheck disable=SC2001  # indents every line of a multi-line string
    sed 's/^/     /' <<<"$output"
    failures=$((failures + 1))
  fi
}

# Hide every credential source so no check can ever deploy for real.
# shellcheck disable=SC2329  # invoked through check's "$@"
no_aws() {
  env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_PROFILE \
    AWS_SHARED_CREDENTIALS_FILE=/nonexistent AWS_CONFIG_FILE=/nonexistent \
    AWS_EC2_METADATA_DISABLED=true "$@"
}

# Stand-ins for aws, curl and npm (and optionally git) that record every call
# and never touch AWS. FAKE_STACK_STATUS unset means "no such stack" until a
# deploy call creates it.
FAKE=$(mktemp -d)
trap 'rm -rf "$FAKE"' EXIT
mkdir -p "$FAKE/bin" "$FAKE/git"
export FAKE_LOG="$FAKE/calls.log" REAL_GIT
REAL_GIT=$(command -v git)
cat > "$FAKE/bin/aws" <<'EOF'
#!/usr/bin/env bash
echo "aws $*" >> "$FAKE_LOG"
case "$*" in
  *"sts get-caller-identity"*) exit 0 ;;
  *describe-stacks*)
    if [ -z "${FAKE_STACK_STATUS:-}" ] && [ ! -f "$FAKE_LOG.deployed" ]; then
      echo "An error occurred (ValidationError): Stack does not exist" >&2
      exit 254
    fi
    case "$*" in
      *StackStatus*) echo "${FAKE_STACK_STATUS:-CREATE_COMPLETE}" ;;
      *GitRef*) echo "${FAKE_GITREF:-main}" ;;
      *AppUrl*) echo "https://fake.cloudfront.net" ;;
      *InstanceId*) echo "i-fake" ;;
      *RoleArn*) echo "arn:aws:iam::123456789012:role/design-sync-github-deploy" ;;
    esac
    ;;
  *describe-managed-prefix-lists*) echo pl-fake ;;
  *"ssm get-parameter"*) echo ami-fake ;;
  *" deploy "*) touch "$FAKE_LOG.deployed" ;;
  *"ssm send-command"*)
    while [ $# -gt 0 ]; do [ "$1" = --parameters ] && params=$2; shift; done
    python -c 'import json, sys; json.loads(sys.argv[1])' "$params" \
      || { echo "fake aws: --parameters is not valid JSON" >&2; exit 1; }
    echo cmd-fake
    ;;
  *get-command-invocation*)
    case "$*" in
      *StandardErrorContent*) echo "remote build error" ;;
      *Status*) echo "${FAKE_UPDATE_STATUS:-Success}" ;;
    esac
    ;;
  *"iam list-open-id-connect-providers"*) echo "${FAKE_OIDC_PROVIDER:-None}" ;;
  *) echo "fake aws: unexpected call: $*" >&2; exit 99 ;;
esac
EOF
# curl that serves FAKE_HEALTH_BODY, except when told to discard it with -o.
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\ncase " $* " in *" -o "*) ;; *) printf "%%s" "${FAKE_HEALTH_BODY:-}" ;; esac\n' > "$FAKE/bin/curl"
# Single quotes on purpose: these $ expand when the fakes run, not here.
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\necho "npm $*" >> "$FAKE_LOG"\n' > "$FAKE/bin/npm"
# git that pretends every ref is on GitHub with infra/bootstrap.sh in it, and
# that main's tip is FAKE_MAIN_TIP (default: the commit being released).
cat > "$FAKE/git/git" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  fetch | cat-file) exit 0 ;;
  rev-parse)
    if [ "${2:-}" = FETCH_HEAD ]; then
      echo "${FAKE_MAIN_TIP:-${RELEASE_SHA:-}}"
      exit 0
    fi
    ;;
esac
exec "$REAL_GIT" "$@"
EOF
chmod +x "$FAKE"/bin/* "$FAKE/git/git"

# Run deploy.sh against the fakes, then print the recorded calls so a check's
# regex can match what was (or was not) sent to AWS.
# shellcheck disable=SC2329  # invoked through check's "$@"
fake_aws() {
  : > "$FAKE_LOG"
  rm -f "$FAKE_LOG.deployed"
  no_aws env PATH="$FAKE/bin:$PATH" "$@"
  local status=$?
  cat "$FAKE_LOG"
  return "$status"
}
# shellcheck disable=SC2329  # invoked through check's "$@"
fake_aws_and_git() {
  fake_aws env PATH="$FAKE/git:$FAKE/bin:$PATH" "$@"
}

check "unknown command prints usage" 2 "usage:" -- \
  no_aws bash infra/deploy.sh bogus
check "missing credentials fail before any AWS change" 1 "aws configure" -- \
  no_aws bash infra/deploy.sh deploy
check "GIT_REF missing on GitHub fails fast" 1 "not on GitHub" -- \
  fake_aws env GIT_REF=no-such-branch-zz9 bash infra/deploy.sh deploy
check "GIT_REF without the infra files fails fast" 1 "no infra/bootstrap.sh" -- \
  fake_aws env GIT_REF=a6fcbbe197371a409a6848934b7ebcffefee0d55 bash infra/deploy.sh deploy
check "first deploy pins the AMI and the git ref" 0 "deploy .*GitRef=main.*AmiId=ami-fake" -- \
  fake_aws_and_git bash infra/deploy.sh deploy
check "redeploy keeps the AMI and the git ref" 0 "deploy .*--parameter-overrides CloudFrontPrefixListId=pl-fake$" -- \
  fake_aws_and_git env FAKE_STACK_STATUS=UPDATE_COMPLETE bash infra/deploy.sh deploy
check "redeploy with another GIT_REF is refused" 1 "make aws-update" -- \
  fake_aws_and_git env FAKE_STACK_STATUS=CREATE_COMPLETE GIT_REF=feature bash infra/deploy.sh deploy
check "deploy after a failed create says to destroy first" 1 "make aws-destroy" -- \
  fake_aws_and_git env FAKE_STACK_STATUS=ROLLBACK_COMPLETE bash infra/deploy.sh deploy
check "e2e without a deployed stack fails instead of testing locally" 1 "no AppUrl" -- \
  fake_aws bash infra/deploy.sh e2e
check "failed update exits non-zero with the remote error" 1 "remote build error" -- \
  fake_aws_and_git env FAKE_STACK_STATUS=CREATE_COMPLETE FAKE_UPDATE_STATUS=Failed bash infra/deploy.sh update
check "update logs the build and prints its tail on failure" 1 "tail -n 60 /var/log/design-sync-update.log" -- \
  fake_aws_and_git env FAKE_STACK_STATUS=CREATE_COMPLETE FAKE_UPDATE_STATUS=Failed bash infra/deploy.sh update
check "update reports the deployed commit as APP_VERSION" 0 'export APP_VERSION=\$\(git rev-parse HEAD\)' -- \
  fake_aws_and_git env FAKE_STACK_STATUS=CREATE_COMPLETE bash infra/deploy.sh update
# shellcheck disable=SC2016  # $f expands inside the bash -c script
check "every readiness check uses the health endpoint" 0 "all use /api/health" -- \
  bash -c 'for f in infra/deploy.sh infra/bootstrap.sh Dockerfile e2e/stack.ts backend/tests/compose/conftest.py; do grep -qF /api/health "$f" || { echo "missing in $f"; exit 1; }; done; echo "all use /api/health"'
SHA=0123456789abcdef0123456789abcdef01234567
check "release needs the full commit SHA" 1 "RELEASE_SHA" -- \
  fake_aws_and_git bash infra/deploy.sh release
check "release creates a new stack from main" 0 "deploy .*GitRef=main" -- \
  fake_aws_and_git env RELEASE_SHA=$SHA bash infra/deploy.sh release
check "release updates the instance to the SHA" 0 "update to $SHA" -- \
  fake_aws_and_git env RELEASE_SHA=$SHA bash infra/deploy.sh release
check "release keeps an existing stack's pinned ref" 0 "deploy .*--parameter-overrides CloudFrontPrefixListId=pl-fake$" -- \
  fake_aws_and_git env FAKE_STACK_STATUS=CREATE_COMPLETE FAKE_GITREF=v1 RELEASE_SHA=$SHA bash infra/deploy.sh release
check "verify passes when the released SHA answers" 0 "healthy" -- \
  fake_aws env FAKE_STACK_STATUS=CREATE_COMPLETE VERIFY_ATTEMPTS=2 VERIFY_INTERVAL=0 \
    FAKE_HEALTH_BODY="{\"status\":\"ok\",\"database\":\"ok\",\"version\":\"$SHA\"}" bash infra/deploy.sh verify $SHA
check "verify fails while another version answers" 1 "never reported" -- \
  fake_aws env FAKE_STACK_STATUS=CREATE_COMPLETE VERIFY_ATTEMPTS=2 VERIFY_INTERVAL=0 \
    FAKE_HEALTH_BODY='{"status":"ok","database":"ok","version":"old"}' bash infra/deploy.sh verify $SHA
check "verify fails while the database is down" 1 "never reported" -- \
  fake_aws env FAKE_STACK_STATUS=CREATE_COMPLETE VERIFY_ATTEMPTS=2 VERIFY_INTERVAL=0 \
    FAKE_HEALTH_BODY="{\"status\":\"error\",\"database\":\"unavailable\",\"version\":\"$SHA\"}" bash infra/deploy.sh verify $SHA
check "oidc on a new account creates the GitHub provider" 0 "deploy .*github-oidc.*CreateOidcProvider=true" -- \
  fake_aws bash infra/deploy.sh oidc
check "oidc reuses an existing GitHub provider" 0 "ExistingOidcProviderArn=arn:aws:iam::1:oidc-provider/token" -- \
  fake_aws env FAKE_OIDC_PROVIDER=arn:aws:iam::1:oidc-provider/token.actions.githubusercontent.com bash infra/deploy.sh oidc
check "oidc rerun keeps the provider settings" 0 "deploy .*--parameter-overrides GitHubRepository=[^ ]+$" -- \
  fake_aws env FAKE_STACK_STATUS=CREATE_COMPLETE bash infra/deploy.sh oidc
check "oidc prints the role ARN to configure" 0 "AWS_ROLE_ARN=arn:aws:iam::123456789012:role/design-sync-github-deploy" -- \
  fake_aws bash infra/deploy.sh oidc
check "deploy role cannot edit itself or attach arbitrary policies" 0 "InstanceRole-\*" -- \
  bash -c '! grep -qE "role/design-sync-\*" infra/github-oidc.yaml && grep -q "iam:PolicyARN" infra/github-oidc.yaml && grep -o "role/design-sync-InstanceRole-\*" infra/github-oidc.yaml'
OTHER_SHA=fedcba9876543210fedcba9876543210fedcba98
# Release as CI does, then print what CI reads back from $GITHUB_OUTPUT.
# shellcheck disable=SC2329  # invoked through check's "$@"
release_for_ci() {
  local out="$FAKE/github_output"
  : > "$out"
  fake_aws_and_git env GITHUB_OUTPUT="$out" RELEASE_SHA="$SHA" "$@" bash infra/deploy.sh release
  local status=$?
  cat "$out"
  return "$status"
}
# shellcheck disable=SC2329  # invoked through check's "$@"
superseded_release_changes_nothing() {
  local output
  output=$(release_for_ci FAKE_MAIN_TIP="$OTHER_SHA" 2>&1) || { echo "$output"; return 1; }
  if grep -qE " deploy |send-command" <<<"$output"; then echo "$output"; return 1; fi
  echo "no AWS changes"
}
check "release tells CI it released" 0 "^released=true$" -- \
  release_for_ci
check "release of a commit main has moved past tells CI it skipped" 0 "^released=false$" -- \
  release_for_ci FAKE_MAIN_TIP=$OTHER_SHA
check "release of a commit main has moved past changes nothing" 0 "no AWS changes" -- \
  superseded_release_changes_nothing
check "CI verifies only what it released" 0 "^2$" -- \
  grep -c "steps.release.outputs.released == 'true'" .github/workflows/ci.yml
check "deploy credentials outlast the deploy" 0 "role-duration-seconds: 7200" -- \
  bash -c 'grep -q "MaxSessionDuration: 7200" infra/github-oidc.yaml && grep -o "role-duration-seconds: 7200" .github/workflows/ci.yml'
check "bootstrap failure is signalled to CloudFormation" 0 "trap 'signal 1' ERR" -- \
  grep -F "trap 'signal 1' ERR" infra/cloudformation.yaml

exit "$failures"
