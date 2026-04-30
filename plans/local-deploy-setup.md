# Local Cloudflare Deploy Setup

## Required Environment Variables

You need to set these in your shell before deploying:

| Variable | Description | Required |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Workers & Pages permissions | Yes |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare Account ID | Optional (wrangler detects it) |

## Files to Create/Modify

### 1. Create: `apps/frontend-blog/scripts/deploy-local.sh`

A convenience script that runs all steps:
1. `rm -rf .open-next .next` — Clean build artifacts
2. `opennextjs-cloudflare build` — Build the worker bundle
3. `node scripts/patch-worker-queue.mjs` — Inject queue() handler
4. `opennextjs-cloudflare deploy -c wrangler.jsonc --env=production` — Deploy

Supports `--build-only` flag and `--env staging` flag.

### 2. Modify: `apps/frontend-blog/package.json`

Add npm scripts:
- `"build:cf": "rm -rf .open-next .next && yarn exec opennextjs-cloudflare build && node scripts/patch-worker-queue.mjs"`
- `"deploy:cf:prod": "CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN yarn exec opennextjs-cloudflare deploy -c wrangler.jsonc --env=production"`
- `"deploy:cf:staging": "CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN yarn exec opennextjs-cloudflare deploy -c wrangler.jsonc --env=staging"`
- `"release:cf:prod": "bash scripts/deploy-local.sh"`
- `"release:cf:staging": "bash scripts/deploy-local.sh --env staging"`

## Usage

```bash
# Quick production deploy (one command)
cd apps/frontend-blog
CLOUDFLARE_API_TOKEN=xxx bash scripts/deploy-local.sh

# Build only (for testing)
bash scripts/deploy-local.sh --build-only

# Or via npm scripts
CLOUDFLARE_API_TOKEN=xxx yarn release:cf:prod
```
