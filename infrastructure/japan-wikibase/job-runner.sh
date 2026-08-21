#!/usr/bin/env bash
set -euo pipefail

for attempt in $(seq 1 120); do
  test -f /var/lib/jwb/installed && break
  test "${attempt}" -lt 120 || { echo 'Wikibase installation marker did not appear' >&2; exit 1; }
  sleep 2
done

exec php maintenance/run.php runJobs --wait --maxjobs 100
