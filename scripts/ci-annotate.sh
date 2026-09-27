#!/usr/bin/env bash
# Usage: scripts/ci-annotate.sh "<title>" <command...>
# Runs the command, streams its output, and on failure emits the last 80 lines as a single
# GitHub Actions error annotation. Annotations are visible through the public API, unlike
# job logs, which require a signed-in user.
set -uo pipefail

title="$1"
shift
log="$(mktemp)"

"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}

if [ "$status" -ne 0 ]; then
  # Escape per the workflow-command spec: % → %25, CR → %0D, LF → %0A
  # Keep the useful part: drop docker pull noise, then take the tail.
  msg="$(grep -vE 'Pulling|Download complete|Verifying Checksum|Pull complete|Waiting$|Already exists' "$log" \
         | tail -n 120 | sed -e 's/%/%25/g' -e 's/\r/%0D/g' | awk '{printf "%s%%0A", $0}')"
  echo "::error title=${title} failed::${msg}"
fi

exit "$status"
