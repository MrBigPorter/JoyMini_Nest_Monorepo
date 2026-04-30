#!/bin/bash
# ============================================================
# JoyMini Blog - Local Cloudflare Deploy Script
# ============================================================
# Reads CLOUDFLARE_API_TOKEN from .env.local (gitignored, safe)
#
# Usage:
#   bash scripts/deploy-local.sh           # Build + deploy production
#   bash scripts/deploy-local.sh --env staging  # Build + deploy staging
#   bash scripts/deploy-local.sh --build-only   # Build only, no deploy
# ============================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ENVIRONMENT="${ENVIRONMENT:-production}"
BUILD_ONLY=false

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --env) ENVIRONMENT="$2"; shift 2 ;;
    --build-only) BUILD_ONLY=true; shift ;;
    --help)
      echo "Usage: bash scripts/deploy-local.sh [options]"
      echo ""
      echo "Options:"
      echo "  --env <env>       Target: production (default) or staging"
      echo "  --build-only      Build + patch only, skip deploy"
      echo "  --help            Show this help"
      echo ""
      echo "Env vars (loaded from .env.local automatically):"
      echo "  CLOUDFLARE_API_TOKEN   Cloudflare API token (required for deploy)"
      exit 0
      ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

# Load CLOUDFLARE_API_TOKEN from .env.local (gitignored, safe)
# NOTE: Do NOT source .env.local — Next.js auto-loads it and it would override .env.production
if [[ -f ".env.local" ]]; then
  TOKEN_LINE=$(grep -E '^CLOUDFLARE_API_TOKEN=' .env.local | head -1)
  if [[ -n "$TOKEN_LINE" ]]; then
    export "CLOUDFLARE_API_TOKEN=${TOKEN_LINE#CLOUDFLARE_API_TOKEN=}"
    echo -e "${BLUE}[.env.local] CLOUDFLARE_API_TOKEN loaded${NC}"
  fi
fi

echo -e "${BLUE}┌─────────────────────────────────────┐${NC}"
echo -e "${BLUE}│ JoyMini Blog - Local Deploy          │${NC}"
echo -e "${BLUE}│ Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}└─────────────────────────────────────┘${NC}"

# ── Step 1: Clean ──
echo -e "\n${YELLOW}[1/4] Cleaning previous build...${NC}"
rm -rf ".open-next" ".next"
echo -e "${GREEN}  Done${NC}"

# ── Step 2: OpenNext Cloudflare Build ──
echo -e "\n${YELLOW}[2/4] Running OpenNext Cloudflare build...${NC}"
yarn exec opennextjs-cloudflare build
echo -e "${GREEN}  Build complete${NC}"

# ── Step 3: Patch queue handler ──
echo -e "\n${YELLOW}[3/4] Patching queue() handler into worker.js...${NC}"
node scripts/patch-worker-queue.mjs
echo -e "${GREEN}  Patch complete${NC}"

# ── Step 4: Deploy ──
if [[ "$BUILD_ONLY" == "true" ]]; then
  echo -e "\n${BLUE}[4/4] --build-only: skipping deploy${NC}"
  echo -e "\n${GREEN}✅ Build completed!${NC}"
  echo -e "   Worker: .open-next/worker.js"
  exit 0
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo -e "\n${RED}❌ CLOUDFLARE_API_TOKEN not set${NC}"
  echo -e "   Add to .env.local:"
  echo -e "     echo 'CLOUDFLARE_API_TOKEN=your_token' >> .env.local"
  exit 1
fi

echo -e "\n${YELLOW}[4/4] Deploying to Cloudflare (${ENVIRONMENT})...${NC}"
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
  CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}" \
  yarn exec opennextjs-cloudflare deploy -c wrangler.jsonc --env="${ENVIRONMENT}"
echo -e "${GREEN}  Deploy complete${NC}"

echo -e "\n${GREEN}✅ Deployment to ${ENVIRONMENT} completed!${NC}"
