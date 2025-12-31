#!/bin/bash
# Sync analyzed package data to GitHub for frontend deployment
# Run via cron: 0 * * * * /path/to/sync_to_github.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$PROJECT_DIR/sync.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

cd "$PROJECT_DIR"

log "Starting sync..."

# Run the build script to update frontend data
uv run python scripts/build_frontend_data.py >> "$LOG_FILE" 2>&1

# Check if there are any changes to commit
if git diff --quiet frontend/public/data/; then
    log "No changes to sync"
    exit 0
fi

# Count changes
CHANGED=$(git diff --name-only frontend/public/data/ | wc -l | tr -d ' ')
log "Found $CHANGED changed files"

# Stage and commit
git add frontend/public/data/

# Get stats for commit message
SCORED=$(grep -o '"scored_packages":[0-9]*' frontend/public/data/homebrew_stats.json 2>/dev/null | grep -o '[0-9]*' || echo "?")

git commit -m "Auto-sync: Update frontend data ($SCORED scored packages)

🤖 Generated with [Claude Code](https://claude.com/claude-code)" >> "$LOG_FILE" 2>&1

# Push to GitHub
git push >> "$LOG_FILE" 2>&1

log "Sync complete - pushed $CHANGED files"
