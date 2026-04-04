#!/usr/bin/env bash
# Cargo wrapper that codesigns the output binary after building.
# Used by `tauri dev --runner ./scripts/cargo-codesign.sh` to sign dev builds,
# preventing macOS Keychain access prompts.

set -euo pipefail

CERT_NAME="Superagent Dev"

# Run the actual cargo build with all forwarded arguments
cargo "$@"

# Only codesign after a successful build (not check, clippy, etc.)
if [[ "${1:-}" != "build" ]]; then
  exit 0
fi

# Find the signing identity
IDENTITY=$(security find-identity -v -p codesigning | grep "$CERT_NAME" | head -1 | awk -F'"' '{print $2}')
if [[ -z "$IDENTITY" ]]; then
  exit 0  # No cert installed — skip silently
fi

# Determine the output binary path from cargo args
PROFILE="debug"
for arg in "$@"; do
  if [[ "$arg" == "--release" ]]; then
    PROFILE="release"
  fi
done

# Find the target directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="$REPO_ROOT/target/$PROFILE"

# Sign the Superagent binary if it exists
BINARY="$TARGET_DIR/superagent"
if [[ -f "$BINARY" ]]; then
  codesign --force --sign "$IDENTITY" --keychain ~/Library/Keychains/login.keychain-db "$BINARY" 2>/dev/null && \
    echo "✓ Codesigned $BINARY" || true
fi
