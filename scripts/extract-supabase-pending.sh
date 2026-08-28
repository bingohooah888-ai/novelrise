#!/usr/bin/env bash
set -euo pipefail

input_file="${1:-/dev/stdin}"

sed 's/│/|/g' "$input_file" \
  | awk -F '[|]' '
    {
      local_col=$1
      remote_col=$2
      gsub(/[^0-9]/, "", local_col)
      gsub(/[^0-9]/, "", remote_col)
      if (length(local_col) == 14 && length(remote_col) == 0) print local_col
    }
  ' \
  | sort -u
