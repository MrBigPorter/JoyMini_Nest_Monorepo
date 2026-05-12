# Fix: Cloudflare Pages "Project not found" for Swagger Docs Deployment

## Problem

Workflow [`deploy-swagger-docs.yml`](.github/workflows/deploy-swagger-docs.yml) uses `cloudflare/pages-action@v1` with `projectName: "JoyMinis-Api-Platform"`, but this Pages project does not exist in the Cloudflare account.

## Solution: Auto-Create Project in Workflow

Modify [`deploy-swagger-docs.yml`](.github/workflows/deploy-swagger-docs.yml) to add a pre-deploy step that checks if the Cloudflare Pages project exists, and creates it if not, using the Cloudflare API directly.

## Required Changes

### File: `.github/workflows/deploy-swagger-docs.yml`

**Add a new step 1.5** between the existing step 1 (Checkout) and step 2 (Deploy):

```yaml
      - name: 1.5 Ensure Cloudflare Pages project exists
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          PROJECT_NAME: "JoyMinis-Api-Platform"
        run: |
          set -euo pipefail

          echo "Checking if Pages project '$PROJECT_NAME' exists..."

          HTTP_STATUS=$(curl -s -o /tmp/cf-project-check.json -w "%{http_code}" \
            "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT_NAME" \
            -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")

          if [ "$HTTP_STATUS" = "200" ]; then
            echo "Project '$PROJECT_NAME' already exists."
          elif [ "$HTTP_STATUS" = "404" ]; then
            echo "Project '$PROJECT_NAME' not found. Creating..."
            CREATE_RESP=$(curl -s -X POST \
              "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects" \
              -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
              -H "Content-Type: application/json" \
              -d '{
                "name": "JoyMinis-Api-Platform",
                "production_branch": "main"
              }')
            CREATE_SUCCESS=$(echo "$CREATE_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))")
            if [ "$CREATE_SUCCESS" = "True" ]; then
              echo "Project '$PROJECT_NAME' created successfully."
            else
              echo "::error::Failed to create Pages project."
              echo "$CREATE_RESP"
              exit 1
            fi
          else
            echo "::error::Unexpected API response status: $HTTP_STATUS"
            cat /tmp/cf-project-check.json
            exit 1
          fi
```

The step uses the same `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets already configured for the workflow.

## How It Works

1. **Step 1.5 (NEW):** Calls Cloudflare API `GET /accounts/:id/pages/projects/JoyMinis-Api-Platform`
   - If `200` → project exists, skip to deploy
   - If `404` → project missing, call `POST /accounts/:id/pages/projects` to create it with `production_branch: main`
   - Any other status → fail with error

2. **Step 2 (existing):** `cloudflare/pages-action@v1` runs and deploys the files

## Verification

After the change:
- Commit and push to `main` or `test` branch with changes in `apps/api/**` or `apps/swagger-docs/**`
- Or trigger via GitHub Actions → **Deploy Swagger Docs (Cloudflare Pages)** → Run workflow
- First run will create the project, then deploy
- Subsequent runs will find the project already exists and deploy immediately
