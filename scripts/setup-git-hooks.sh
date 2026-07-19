#!/bin/sh
# Use repo-managed git hooks (.githooks/*).
set -e
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/post-commit scripts/bump-and-build.mjs scripts/setup-git-hooks.sh
echo "Git hooks installed (core.hooksPath=.githooks)"
echo "  pre-commit:  bump patch version → stage package.json + manifest.json"
echo "  post-commit: npm run build → dist/ ready to reload in Chrome"
echo "Skip bump:   SKIP_VERSION_BUMP=1 git commit ..."
echo "Skip build:  SKIP_POST_COMMIT_BUILD=1 git commit ..."
