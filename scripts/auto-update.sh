#!/usr/bin/env sh
#
# Update TabJam if the tracked branch has moved.
#
# Fetches, and only rebuilds when the remote is actually ahead — so running it
# every few minutes costs one lightweight fetch and nothing else. Safe to run
# concurrently with a practice: docker compose only replaces the container once
# the new image has finished building.
#
# Run it from cron on the host, e.g. every 15 minutes:
#   */15 * * * * /path/to/TabJam/scripts/auto-update.sh >> /var/log/tabjam-update.log 2>&1
#
set -eu

cd "$(dirname "$0")/.."

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git fetch --quiet origin "$BRANCH"

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "[$(date -Is)] $BRANCH: $(git rev-parse --short HEAD) -> $(git rev-parse --short "origin/$BRANCH")"

# Refuse to clobber local edits rather than losing them to a rebuild.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "  local changes present; not updating"
  exit 1
fi

git merge --ff-only "origin/$BRANCH"
docker compose up -d --build
echo "  updated"
