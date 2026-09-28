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

check "unknown command prints usage" 2 "usage:" -- \
  no_aws bash infra/deploy.sh bogus
check "GIT_REF missing on GitHub fails fast" 1 "not on GitHub" -- \
  no_aws env GIT_REF=no-such-branch-zz9 bash infra/deploy.sh deploy
check "missing credentials fail before any AWS change" 1 "aws configure" -- \
  no_aws bash infra/deploy.sh deploy
check "bootstrap failure is signalled to CloudFormation" 0 "trap 'signal 1' ERR" -- \
  grep -F "trap 'signal 1' ERR" infra/cloudformation.yaml

exit "$failures"
