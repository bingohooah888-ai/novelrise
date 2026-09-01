#!/usr/bin/env bash
set -euo pipefail

input_file="${1:--}"

sed 's/│/|/g' "$input_file" \
  | awk -F '[|]' '
    function trim(value) {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      return value
    }

    function clean_cell(value) {
      value=trim(value)
      if (length(value) >= 2 && substr(value, 1, 1) == "`" && substr(value, length(value), 1) == "`") {
        value=substr(value, 2, length(value) - 2)
        value=trim(value)
      }
      return value
    }

    function fail_row() {
      print "Staging migration sync blocked: malformed remote migration-history row." > "/dev/stderr"
      exit 1
    }

    {
      if (trim($0) == "") next
      if (NF < 2) fail_row()

      local_col=clean_cell($1)
      remote_col=clean_cell($2)

      if (local_col == "Local" && remote_col == "Remote") next
      if (local_col ~ /^-+$/ && remote_col ~ /^-+$/) next

      if (local_col == "" && remote_col == "") fail_row()
      if (local_col != "" && !(local_col ~ /^[0-9]+$/ && length(local_col) == 14)) fail_row()
      if (remote_col == "") next
      if (!(remote_col ~ /^[0-9]+$/ && length(remote_col) == 14)) fail_row()

      print remote_col
    }
  ' \
  | sort -u
