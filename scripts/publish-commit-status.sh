#!/usr/bin/env bash
set -euo pipefail

state="${1:?state is required}"
context="${2:?context is required}"
description="${3:?description is required}"

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"

status_token="${GH_STATUS_TOKEN:-${GITHUB_TOKEN:-}}"
: "${status_token:?GH_STATUS_TOKEN or GITHUB_TOKEN is required}"

case "$state" in
  error|failure|pending|success) ;;
  *)
    echo "Unsupported commit status state: $state"
    exit 1
    ;;
esac

jq -n \
  --arg state "$state" \
  --arg context "$context" \
  --arg description "$description" \
  '{state: $state, context: $context, description: $description}' \
  > /tmp/novelight-commit-status.json

curl --fail-with-body --silent --show-error \
  --request POST \
  --url "https://api.github.com/repos/${GITHUB_REPOSITORY}/statuses/${GITHUB_SHA}" \
  --header "Authorization: Bearer ${status_token}" \
  --header 'Accept: application/vnd.github+json' \
  --header 'X-GitHub-Api-Version: 2022-11-28' \
  --data-binary @/tmp/novelight-commit-status.json \
  >/dev/null
