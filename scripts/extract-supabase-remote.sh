#!/usr/bin/env bash
set -euo pipefail

input_file="${1:-/dev/stdin}"

sed 's/│/|/g' "$input_file" \
  | awk -F '[|]' '
    {
      remote_col=$2
      gsub(/[^0-9]/, "", remote_col)
      if (length(remote_col) == 14) print remote_col
    }
  ' \
  | sort -u
