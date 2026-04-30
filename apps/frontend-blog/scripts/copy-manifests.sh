#!/bin/bash
# =============================================================================
# copy-manifests.sh — Copy Next.js server manifest files to ASSETS directory
#
# WHY THIS EXISTS:
# OpenNext correctly splits build output into:
#   - .open-next/assets/        → served by Cloudflare ASSETS (static files)
#   - .open-next/server-functions/ → used by Worker at runtime
#
# However, some files in .next/server/ are ALSO requested by the browser at
# runtime (e.g. *_client-reference-manifest.js, app-build-manifest.json).
# OpenNext does NOT automatically copy these to ASSETS, causing 404 errors.
#
# This script bridges that gap by copying all such files to ASSETS,
# preserving their directory structure under _next/server/.
#
# It uses wildcard patterns so it works for ALL current and future routes
# without needing manual updates.
# =============================================================================

set -euo pipefail

SRC_BASE=".open-next/server-functions/default/apps/frontend-blog/.next"
DST_BASE=".open-next/assets/_next"

echo "📦 Copying server manifest files to ASSETS..."

# 1. Root-level manifest JSON files (app-build-manifest.json, build-manifest.json, etc.)
if [ -d "$SRC_BASE" ]; then
  for f in "$SRC_BASE"/*manifest*.json; do
    if [ -f "$f" ]; then
      cp -f "$f" "$DST_BASE/" 2>/dev/null && echo "  ✅ $(basename "$f")"
    fi
  done
fi

# 2. *_client-reference-manifest.js files under server/app/
#    These are per-route files that the browser requests to hydrate client components.
if [ -d "$SRC_BASE/server/app" ]; then
  find "$SRC_BASE/server/app" -name '*client-reference-manifest*' -exec sh -c '
    src="$1"
    relpath=$(echo "$src" | sed "s|.*/\.next/server/app/||")
    dirpart=$(dirname "$relpath")
    mkdir -p ".open-next/assets/_next/server/app/$dirpart"
    cp "$src" ".open-next/assets/_next/server/app/$relpath"
    echo "  ✅ _next/server/app/$relpath"
  ' _ {} \;
fi

# 3. Any other manifest files under server/ (future-proof catch-all)
if [ -d "$SRC_BASE/server" ]; then
  find "$SRC_BASE/server" -name '*manifest*' ! -name '*client-reference-manifest*' -exec sh -c '
    src="$1"
    relpath=$(echo "$src" | sed "s|.*/\.next/server/||")
    dirpart=$(dirname "$relpath")
    mkdir -p ".open-next/assets/_next/server/$dirpart"
    cp "$src" ".open-next/assets/_next/server/$relpath"
    echo "  ✅ _next/server/$relpath"
  ' _ {} \;
fi

echo "✅ All manifest files copied to ASSETS"
