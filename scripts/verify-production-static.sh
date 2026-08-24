#!/usr/bin/env bash
set -euo pipefail

: "${BASE_URL:?BASE_URL is required}"
mode="${STATIC_CHECK_MODE:-all}"
base_sha="${BASE_SHA:-}"

routes_file=/tmp/novelight-static-routes.txt
: > "$routes_file"

if [ "$mode" = 'changed' ] && [ -n "$base_sha" ] && ! [[ "$base_sha" =~ ^0+$ ]]; then
  git diff --name-only "$base_sha" HEAD -- '*.html' 'novelight-client.js' \
    | awk '!/\// && ($0 ~ /\.html$/ || $0 == "novelight-client.js")' \
    | sort -u > "$routes_file"
else
  find . -maxdepth 1 -type f -name '*.html' -printf '%f\n' | sort -u > "$routes_file"
  if [ -f novelight-client.js ]; then
    echo 'novelight-client.js' >> "$routes_file"
  fi
  sort -u -o "$routes_file" "$routes_file"
fi

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

first_route="$(head -n 1 "$routes_file")"
converged=false
for attempt in $(seq 1 24); do
  if check_route "$first_route"; then
    converged=true
    break
  fi
  echo "Production has not converged for $first_route yet (attempt ${attempt}/24)."
  sleep 10
done

if [ "$converged" != true ]; then
  echo "Production did not converge for $first_route within 4 minutes."
  exit 1
fi

while IFS= read -r route; do
  [ -n "$route" ] || continue
  if ! check_route "$route"; then
    echo "Production route differs from repository: $route"
    exit 1
  fi
done < "$routes_file"

html_targets=(/tmp/live-*.html)
if [ -e "${html_targets[0]}" ] && grep -Eqi 'NovelRise|NOVELRISE' "${html_targets[@]}"; then
  echo 'Legacy user-facing NovelRise branding found in checked production HTML.'
  exit 1
fi

echo 'Production static verification passed for:'
cat "$routes_file"
