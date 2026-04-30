# Fix Empty Categories/Tags Data on Blog

## Problem Analysis

The categories and tags pages on `blog.joyminis.com` show empty data. The Cloudflare Workers log shows:

```
Failed to revalidate stale page /zh/tags/
FatalError: Dummy queue is not implemented
```

### Root Cause

The frontend-blog is deployed on **Cloudflare Workers** via **OpenNext** (see [`wrangler.jsonc`](apps/frontend-blog/wrangler.jsonc)). 

**ISR (Incremental Static Regeneration)** requires a Cloudflare Queue to send background revalidation messages. The queue `next-revalidation-queue` is configured as a **producer** in [`wrangler.jsonc:71`](apps/frontend-blog/wrangler.jsonc:71):

```json
"queues": {
  "producers": [
    { "binding": "NEXT_QUEUE", "queue": "next-revalidation-queue" }
  ]
}
```

But this queue **does not exist** in the Cloudflare account. When OpenNext tries to revalidate a stale page, it attempts to send a message to this queue, which fails with `FatalError: Dummy queue is not implemented`.

### How This Causes Empty Data

1. The categories page has [`export const revalidate = 600`](apps/frontend-blog/src/app/[locale]/categories/page.tsx:10) (10 min ISR)
2. The tags page has [`export const revalidate = 3600`](apps/frontend-blog/src/app/[locale]/tags/page.tsx:10) (1 hour ISR)
3. First render captures data (possibly empty if the API was cold-starting)
4. When the page cache expires, OpenNext tries background revalidation via the queue
5. Revalidation fails → stale cached page persists
6. Page continues showing old/empty data forever

### Data Flow (for reference)

```
User → blog.joyminis.com/zh/categories/
  → OpenNext Worker (lucky-blog-prod)
    → serverGet('/v1/frontend/blog/categories', { lang: 'zh' })
      → fetch('https://api.joyminis.com/api/v1/frontend/blog/categories?lang=zh')
        → NestJS FrontendBlogController.getFrontendCategories()
          → FrontendBlogService.getFrontendCategories(locale)
            → BlogService.getCategories()
              → Prisma: blog_categories.findMany()
```

## Action Plan

### Step 1: Test the API endpoint directly

Verify the NestJS API is returning data correctly:

```bash
curl -s "https://api.joyminis.com/api/v1/frontend/blog/categories?lang=zh" | jq .
```

This will tell us if the issue is on the API side or the frontend caching side.

### Step 2: Create the missing Cloudflare queue

The `next-revalidation-queue` needs to be created in Cloudflare:

**Option A (Recommended):** Create the queue via wrangler CLI:
```bash
cd apps/frontend-blog
npx wrangler queues create next-revalidation-queue
```

**Option B:** Create it via Cloudflare Dashboard:
- Go to Cloudflare Dashboard → Workers & Pages → Queues
- Click "Create Queue"
- Name: `next-revalidation-queue`

### Step 3: Add queue consumer binding (optional but recommended)

The queue currently only has a **producer** binding. For ISR to work fully, we may need a **consumer** binding too. Update [`wrangler.jsonc`](apps/frontend-blog/wrangler.jsonc) to add:

```json
"queues": {
  "producers": [
    {
      "binding": "NEXT_QUEUE",
      "queue": "next-revalidation-queue"
    }
  ],
  "consumers": [
    {
      "queue": "next-revalidation-queue",
      "max_batch_size": 1,
      "max_batch_timeout": 5
    }
  ]
}
```

### Step 4: Purge the Cloudflare cache

After fixing the queue, purge the edge cache so fresh data loads:

```bash
# Full purge
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything": true}'
```

Or use the purge script if available:
```bash
./deploy/verify-blog-cache.sh
```

### Step 5: Verify the pages render correctly

After purging cache, visit:
- `https://blog.joyminis.com/zh/categories/`
- `https://blog.joyminis.com/zh/tags/`

### Alternative Approach (if queue creation is not possible)

If creating a Cloudflare Queue is not feasible (requires paid plan), switch to **SSR-only mode** without ISR:

1. Remove `export const revalidate` from page files
2. Rely on Cloudflare edge cache (`Cache-Control` headers) instead of ISR
3. Remove the `queues` configuration from [`wrangler.jsonc`](apps/frontend-blog/wrangler.jsonc)

## Files to Modify

| File | Action | Reason |
|------|--------|--------|
| [`apps/frontend-blog/wrangler.jsonc`](apps/frontend-blog/wrangler.jsonc) | Add queue consumer or remove queue config | Fix "Dummy queue" error |
| [`apps/frontend-blog/src/app/[locale]/categories/page.tsx`](apps/frontend-blog/src/app/[locale]/categories/page.tsx) | Possibly remove `revalidate` | If switching to SSR |
| [`apps/frontend-blog/src/app/[locale]/tags/page.tsx`](apps/frontend-blog/src/app/[locale]/tags/page.tsx) | Possibly remove `revalidate` | If switching to SSR |
