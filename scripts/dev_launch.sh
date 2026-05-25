#!/bin/bash
# Launch Chrome for Testing with JC extension loaded via pipe CDP bridge.
# Chrome 137+ removed --load-extension from branded builds.
# This uses --remote-debugging-pipe + Extensions.loadUnpacked CDP command.
#
# Usage: bash scripts/dev_launch.sh [url]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
URL="${1:-https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402}"

echo "Launching Chrome with JC extension..."
echo "URL: $URL"
echo ""

node "$SCRIPT_DIR/launch_with_ext.mjs" "$URL"
