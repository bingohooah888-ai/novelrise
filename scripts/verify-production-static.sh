#!/usr/bin/env bash
set -euo pipefail

: "${BASE_URL:?BASE_URL is required}"
mode="${STATIC_CHECK_MODE:-all}"
base_sha="${BASE_SHA:-}"

routes_file=/tmp/novelight-static-routes.txt
: > "$routes_file"

critical_assets=(
  novelight-client.js
  novelight-episode-number-entry-visibility.js
  novelight-episode-workflow-feedback.js
  novelight-series.js
  novelight-characters.js
)

if [ "$mode" = 'changed' ] && [ -n "$base_sha" ] && ! [[ "$base_sha" =~ ^0+$ ]]; then
  git diff --name-only "$base_sha" HEAD -- '*.html' \
    | awk '!/\// && $0 ~ /\.html$/' \
    | sort -u > "$routes_file"
else
  find . -maxdepth 1 -type f -name '*.html' -printf '%f\n' | sort -u > "$routes_file"
fi

# These root assets are directly involved in authentication/session-aware author
# navigation and the episode workflow. Always compare them byte-for-byte with
# Production so a newly merged HTML page cannot race ahead of a stale JS asset.
for asset in "${critical_assets[@]}"; do
  if [ -f "$asset" ]; then
    echo "$asset" >> "$routes_file"
  fi
done
sort -u -o "$routes_file" "$routes_file"

if [ ! -s "$routes_file" ]; then
  echo 'No static routes require repository-to-production comparison.'
  exit 0
fi

check_route() {
  local route="$1"
  local target="/tmp/live-${route//\//-}"

  if [ -f "$route" ]; then
    curl --fail --silent --show-error --location \
      --connect-timeout 10 --max-time 20 \
      "$BASE_URL/$route" > "$target"
    cmp -s "$route" "$target"
    return
  fi

  local code
  code="$(curl --silent --show-error --output "$target" \
    --write-out '%{http_code}' --connect-timeout 10 --max-time 20 \
    "$BASE_URL/$route")"
  [ "$code" = '404' ]
}

required_stable_passes=2
stable_passes=0
converged=false
last_failed_route=''

for attempt in $(seq 1 24); do
  all_routes_match=true
  last_failed_route=''

  while IFS= read -r route; do
    [ -n "$route" ] || continue
    if ! check_route "$route"; then
      all_routes_match=false
      last_failed_route="$route"
      break
    fi
  done < "$routes_file"

  if [ "$all_routes_match" = true ]; then
    stable_passes=$((stable_passes + 1))
    if [ "$stable_passes" -ge "$required_stable_passes" ]; then
      converged=true
      break
    fi
    echo "Production matched all checked routes; confirming stable convergence (${stable_passes}/${required_stable_passes})."
  else
    stable_passes=0
    echo "Production has not converged for $last_failed_route yet (attempt ${attempt}/24)."
  fi

  if [ "$attempt" -lt 24 ]; then
    sleep 10
  fi
done

if [ "$converged" != true ]; then
  echo "Production did not reach stable convergence across all checked routes within the verification window."
  exit 1
fi

html_targets=(/tmp/live-*.html)
if [ -e "${html_targets[0]}" ] && grep -Eqi 'NovelRise|NOVELRISE' "${html_targets[@]}"; then
  echo 'Legacy user-facing NovelRise branding found in checked production HTML.'
  exit 1
fi

echo 'Production static verification passed for:'
cat "$routes_file"
