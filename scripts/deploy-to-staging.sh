#!/bin/bash
# deploy-to-staging.sh — push current branch to staging for testing
# Usage: bash scripts/deploy-to-staging.sh

set -e

CURRENT_BRANCH=$(git branch --show-current)

if [ "$CURRENT_BRANCH" = "master" ]; then
  echo "❌ You're on master — create a feature branch first"
  exit 1
fi

echo "🚀 Pushing $CURRENT_BRANCH to staging..."
git push origin "$CURRENT_BRANCH"

# Merge into staging
git fetch origin staging
git checkout staging
git merge "$CURRENT_BRANCH" --no-ff -m "staging: merge $CURRENT_BRANCH for testing"
git push origin staging

echo ""
echo "✅ Pushed to staging. GitHub Actions will run health checks."
echo "   Watch: https://github.com/PriceWatchHQ/pricewatchhq/actions"
echo "   If checks pass, it auto-merges to master."
echo ""

# Return to original branch
git checkout "$CURRENT_BRANCH"
