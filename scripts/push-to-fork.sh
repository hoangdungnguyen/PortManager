#!/bin/bash
# scripts/push-to-fork.sh
#
# Pushes the local repo to your GitHub fork.
# Reads a Personal Access Token from $GH_TOKEN (or prompts for one).
#
# Prerequisite:
#   1. In your browser, open https://github.com/saisai-web/port-manager
#      and click "Fork" (top-right) → choose hdnguyen → Create fork.
#      (This repo will be PUBLIC since the upstream is public — that's
#       fine for now; visibility cannot be changed on a fork.)
#   2. Create a Personal Access Token with `public_repo` scope at
#      https://github.com/settings/tokens (or `repo` if you want
#      flexibility). Save the token securely — you'll paste it once.
#
# Usage:
#   GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
#     bash scripts/push-to-fork.sh
#   (or just `bash scripts/push-to-fork.sh` and paste at the prompt)

set -e

REPO="port-manager"
FORK_URL="https://github.com/hdnguyen/${REPO}.git"
UPSTREAM_URL="https://github.com/saisai-web/${REPO}.git"

# 1. Check clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: working tree is not clean. Commit or stash first."
  git status
  exit 1
fi

# 2. Show current state
echo "Local branch:  $(git branch --show-current)"
echo "Latest commit: $(git log -1 --oneline)"
echo ""
echo "Current remotes:"
git remote -v
echo ""

# 3. Confirm the new remote URL
echo "About to change remote 'origin' to: $FORK_URL"
read -p "Continue? [y/N] " answer
if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then
  echo "Aborted."
  exit 0
fi

# 4. Get the token
if [ -z "$GH_TOKEN" ]; then
  echo ""
  echo "Enter a fresh Personal Access Token (scope: public_repo or repo):"
  echo "(Or set GH_TOKEN in your environment and re-run.)"
  read -s -p "Token: " GH_TOKEN
  echo ""
fi

if [ -z "$GH_TOKEN" ]; then
  echo "ERROR: no token provided."
  exit 1
fi

# 5. Update remote
git remote set-url origin "$FORK_URL"
echo "Updated remote 'origin' to: $FORK_URL"

# 6. Keep upstream as a reference for syncing later
if ! git remote get-url upstream >/dev/null 2>&1; then
  git remote add upstream "$UPSTREAM_URL"
  echo "Added 'upstream' remote at: $UPSTREAM_URL"
else
  git remote set-url upstream "$UPSTREAM_URL"
  echo "Updated 'upstream' remote to: $UPSTREAM_URL"
fi

# 7. Push using a transient credential URL (token is not stored)
AUTH_URL="https://x-access-token:${GH_TOKEN}@github.com/hdnguyen/${REPO}.git"
echo ""
echo "Pushing main branch to $FORK_URL ..."
git push "$AUTH_URL" main

# Clear the token from the local variable (defense in depth)
unset GH_TOKEN
echo ""
echo "Done. Verify at: $FORK_URL"
echo ""
echo "Next step: revoke the token you just used at"
echo "  https://github.com/settings/tokens"
echo "  (delete it once you've confirmed the push landed)."
