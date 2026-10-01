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
  *) echo "fake aws: unexpected call: $*" >&2; exit 99 ;;
esac
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE/bin/curl"
# Single quotes on purpose: these $ expand when the fakes run, not here.
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\necho "npm $*" >> "$FAKE_LOG"\n' > "$FAKE/bin/npm"
# git that pretends every ref is on GitHub with infra/bootstrap.sh in it.
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\ncase "$1" in fetch | cat-file) exit 0 ;; esac\nexec "$REAL_GIT" "$@"\n' > "$FAKE/git/git"
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
check "every readiness check uses the health endpoint" 0 "all use /api/health" -- \
  bash -c 'for f in infra/deploy.sh infra/bootstrap.sh Dockerfile e2e/stack.ts backend/tests/compose/conftest.py; do grep -qF /api/health "$f" || { echo "missing in $f"; exit 1; }; done; echo "all use /api/health"'
check "bootstrap failure is signalled to CloudFormation" 0 "trap 'signal 1' ERR" -- \
  grep -F "trap 'signal 1' ERR" infra/cloudformation.yaml

exit "$failures"
