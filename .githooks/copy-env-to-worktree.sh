#!/bin/sh
# Automatically copies all .env.local files from the main worktree into a newly created linked
# worktree, preserving their relative paths.
# Runs via the post-checkout hook (triggered by `git worktree add`).

# Only on branch checkouts (arg 3 = 1), not file checkouts
[ "$3" = "1" ] || exit 0

# Only in a linked worktree — .git is a file in linked worktrees, a directory in the main one
[ -f ".git" ] || exit 0

# Find main worktree path (first entry in `git worktree list`)
MAIN_WORKTREE=$(git worktree list --porcelain | awk '/^worktree /{print substr($0, 10); exit}')

# Find and copy all .env.local files, preserving directory structure
find "$MAIN_WORKTREE" -name ".env.local" -not -path "*/.git/*" | while read -r src; do
  rel="${src#$MAIN_WORKTREE/}"
  dest="$rel"

  # Skip if already exists
  [ -f "$dest" ] && continue

  dest_dir=$(dirname "$dest")
  [ -d "$dest_dir" ] || mkdir -p "$dest_dir"

  cp "$src" "$dest"
  echo "canopy: copied $rel"
done
