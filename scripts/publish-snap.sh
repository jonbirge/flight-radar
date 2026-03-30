#!/usr/bin/env bash
set -euo pipefail

# Build the snap and upload it to the Snap Store.
# Usage: ./scripts/publish-snap.sh [channel]
#   channel defaults to "stable"

CHANNEL="${1:-stable}"

echo "==> Building snap..."
snapcraft

SNAP_FILE=$(ls -t *.snap 2>/dev/null | head -1)
if [[ -z "$SNAP_FILE" ]]; then
  echo "Error: no .snap file found after build" >&2
  exit 1
fi

echo "==> Uploading $SNAP_FILE to $CHANNEL channel..."
snapcraft upload --release="$CHANNEL" "$SNAP_FILE"

echo "==> Done. Published $SNAP_FILE to $CHANNEL."
