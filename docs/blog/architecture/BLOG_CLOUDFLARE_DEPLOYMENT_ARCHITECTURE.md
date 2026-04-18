# Blog Cloudflare Deployment Architecture

## 🎯 Overview

### Current Problem

- **Loading Experience Issues**: Page transitions and API requests show loading states, affecting user experience
- **Performance Bottlenecks**: SSR to CSR switching delays, no edge caching
- **Global Access Latency**: Users worldwide experience slow page loads

### Target Architecture

- **Edge ISR + Smart Caching**: Incremental Static Regeneration at the edge
- **Global CDN**: Cloudflare's 300+ edge nodes
- **Automated Deployment**: GitLab CI/CD to Cloudflare Pages

### Expected Results

- **LCP < 1 second**: Largest Contentful Paint under 1 second
- **Cache Hit Rate > 80%**: Most requests served from edge cache
- **Server Load Reduction > 80%**: Minimal backend API calls
- **Global Performance**: Consistent fast loading worldwide

## 🏗️ Architecture Design

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    GitLab CI/CD Pipeline                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Build     │───▶│   Test      │───▶│   Deploy    │     │
│  │  Next.js    │    │  Lighthouse │    │  Cloudflare │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
└─────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────┐
│                 Cloudflare Global Network                    │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Edge ISR  │    │   Cache     │    │   Workers   │     │
│  │  (60s TTL)  │    │  (API/30s)  │    │  (Routing)  │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
└─────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend API (VPS)                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   NestJS    │    │   Prisma    │    │   Redis     │     │
│  │   API       │    │   Database  │    │   Cache     │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### Component Relationships

1. **Frontend Blog**: Next.js application deployed to Cloudflare Pages
2. **Edge Cache**: Cloudflare Workers for ISR and API caching
3. **Backend API**: NestJS application on VPS (api.joyminis.com)
4. **CDN**: Cloudflare Images for media optimization
5. **Monitoring**: Cloudflare Analytics + Telegram notifications

### Data Flow Design

```
User Request → Cloudflare Edge → Check Cache → Serve Cached Content
      ↓                              ↓
      └── Cache Miss ────────────────┘
                              ↓
                    Execute ISR or Fetch API
                              ↓
                    Update Cache + Return Response
```

## ⚙️ Technical Implementation

### 1. Cloudflare Configuration

#### wrangler.toml

```toml
name = "lucky-blog-prod"
main = ".open-next/worker.js"
compatibility_date = "2026-03-20"
compatibility_flags = ["nodejs_compat"]
minify = true

[[routes]]
pattern = "blog.joyminis.com/*"
zone_name = "joyminis.com"

[[routes]]
pattern = "blog-dev.joyminis.com/*"
zone_name = "joyminis.com"

[assets]
binding = "ASSETS"
directory = ".open-next/assets"

[vars]
AUTH_COOKIE_DOMAIN = ".joyminis.com"
NEXT_PUBLIC_BLOG_ENV = "production"
NEXT_PUBLIC_ENABLE_ISR = "true"
ISR_REVALIDATE_SECONDS = "60"
```

### 2. ISR Strategy

#### Page-level Caching Rules

```typescript
// Article pages: 60 seconds revalidation
export const revalidate = 60;

// Category/Tag pages: 300 seconds revalidation
export const revalidate = 300;

// Static pages: No revalidation (fully static)
export const revalidate = false;
```

#### API Response Caching

```typescript
// Cloudflare Worker caching rules
const cacheRules = {
  "GET /api/articles/*": {
    edgeTTL: 30, // 30 seconds
    browserTTL: 0,
    cacheKey: "${url}?${query}",
  },
  "GET /api/categories": {
    edgeTTL: 300, // 5 minutes
    browserTTL: 0,
  },
};
```

### 3. Performance Optimizations

#### Image Optimization

```typescript
// Cloudflare Images integration
const imageConfig = {
  format: "webp",
  quality: 80,
  width: 1200,
  lazyLoading: true,
  placeholder: "blur",
};
```

#### Font Optimization

```html
<!-- Preload critical fonts -->
<link
  rel="preload"
  href="/fonts/inter-var.woff2"
  as="font"
  type="font/woff2"
  crossorigin
/>
```

#### Critical CSS Inlining

```typescript
// Extract and inline critical CSS
import { extractCritical } from "@emotion/server";
```

### 4. Environment Variables

#### GitLab CI Variables

```bash
# Required CI Variables
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
NEXT_PUBLIC_API_BASE_URL
NEXT_PUBLIC_IMG_BASE_URL
TELEGRAM_TOKEN
TELEGRAM_CHAT_ID
```

#### Build-time Injection

```bash
# GitLab CI build command
NODE_ENV=production \
NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
NEXT_PUBLIC_IMG_BASE_URL=$NEXT_PUBLIC_IMG_BASE_URL \
NEXT_PUBLIC_APP_ENV=$([ "$CI_COMMIT_BRANCH" = "main" ] && echo "production" || echo "preview") \
yarn exec opennextjs-cloudflare build
```

## 🚀 Deployment Process

### GitLab CI/CD Pipeline

#### .gitlab/deploy-blog.yml

```yaml
deploy-blog:
  stage: deploy
  image: node:20-bookworm
  tags:
    - saas-linux-large-amd64

  rules:
    - if: $CI_COMMIT_BRANCH == "main" || $CI_COMMIT_BRANCH == "test"
      changes:
        - apps/frontend-blog/**/*
        - packages/shared/**/*
        - packages/ui/**/*

  script:
    - git config core.autocrlf input
    - git config core.filemode false
    - corepack enable
    - corepack prepare yarn@4.9.2 --activate
    - yarn install --immutable

    - node packages/shared/scripts/build.js
    - node packages/ui/scripts/build.js

    - DEPLOYED_AT=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
    - GIT_SHA=$CI_COMMIT_SHA

    - cd apps/frontend-blog
    - NODE_ENV=production \
      NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
      NEXT_PUBLIC_IMG_BASE_URL=$NEXT_PUBLIC_IMG_BASE_URL \
      NEXT_PUBLIC_APP_ENV=$([ "$CI_COMMIT_BRANCH" = "main" ] && echo "production" || echo "preview") \
      NEXT_PUBLIC_DEPLOYED_AT=$DEPLOYED_AT \
      NEXT_PUBLIC_GIT_SHA=$GIT_SHA \
      yarn exec opennextjs-cloudflare build

    # Verify Cloudflare credentials
    - |
      set -euo pipefail
      if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
        echo "❌ CLOUDFLARE_API_TOKEN is not set"
        exit 1
      fi

      HTTP_STATUS=$(curl -s -o /tmp/cf-verify.json -w "%{http_code}" \
        -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        "https://api.cloudflare.com/client/v4/user/tokens/verify")
      SUCCESS=$(python3 -c "import json; d=json.load(open('/tmp/cf-verify.json')); print(d.get('success', False))" 2>/dev/null || echo "false")
      if [ "$HTTP_STATUS" != "200" ] || [ "$SUCCESS" != "True" ]; then
        echo "❌ CLOUDFLARE_API_TOKEN is invalid or expired"
        exit 1
      fi
      echo "✅ Cloudflare API token is valid."

    # Deploy to Cloudflare
    - CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID yarn exec opennextjs-cloudflare deploy -c wrangler.toml

  after_script:
    # Telegram notification
    - |
      if [ "$CI_JOB_STATUS" = "success" ]; then
        STATUS_EMOJI="✅ Success"
      else
        STATUS_EMOJI="❌ Failed"
      fi

      if [ "$CI_COMMIT_BRANCH" = "main" ]; then
        BLOG_URL="https://blog.joyminis.com"
        BLOG_DOMAIN_LABEL="blog.joyminis.com"
      else
        BLOG_URL="https://blog-dev.joyminis.com"
        BLOG_DOMAIN_LABEL="blog-dev.joyminis.com"
      fi

      MESSAGE="☁️ *Blog Cloudflare Deployment Report*
      📌 *Status*: $STATUS_EMOJI
      🏷️ *Environment*: $([ "$CI_COMMIT_BRANCH" = "main" ] && echo "Production" || echo "Preview") (Cloudflare Pages)
      🔗 *Blog URL*: [$BLOG_DOMAIN_LABEL]($BLOG_URL)
      📝 *Commit*: \`$CI_COMMIT_SHORT_SHA\`"

      curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_TOKEN/sendMessage" \
        -d "chat_id=$TELEGRAM_CHAT_ID" \
        -d "text=$MESSAGE" \
        -d "parse_mode=Markdown" > /dev/null

  interruptible: false
  resource_group: deploy-blog
```

### Deployment Stages

#### Stage 1: Initial Setup

1. **Domain Configuration**: Update DNS for blog.joyminis.com
2. **CI Variables**: Configure GitLab CI secrets
3. **First Deployment**: Manual deployment to verify setup

#### Stage 2: Automated Deployment

1. **Branch-based Deployment**: main → production, test → preview
2. **Cache Warming**: Pre-warm cache after deployment
3. **Health Checks**: Verify deployment success

#### Stage 3: Monitoring & Optimization

1. **Performance Monitoring**: Cloudflare Analytics
2. **Error Tracking**: Sentry integration
3. **Cache Optimization**: Adjust TTL based on usage patterns

## 📊 Performance Metrics

### Optimization Targets

| Metric             | Current (SSR+CSR) | Target (Edge ISR) | Improvement   |
| ------------------ | ----------------- | ----------------- | ------------- |
| **LCP**            | 2.5-3.5s          | 0.8-1.2s          | 60-70%        |
| **FCP**            | 1.5-2.0s          | 0.5-0.8s          | 60-70%        |
| **TTI**            | 3.0-4.0s          | 1.0-1.5s          | 60-70%        |
| **Cache Hit Rate** | < 20%             | > 80%             | 4x            |
| **Server Load**    | High              | Very Low          | 80% reduction |

### Monitoring Dashboard

#### Cloudflare Analytics

- **Cache Hit Ratio**: Percentage of requests served from cache
- **Bandwidth Saved**: Data transfer reduction
- **Origin Requests**: Backend API call frequency
- **Edge Response Time**: Time to first byte from edge

#### Custom Metrics

```typescript
// Performance monitoring
const metrics = {
  isr_hits: 0,
  cache_hits: 0,
  api_calls: 0,
  edge_response_time: [],
};
```

### Alerting Rules

#### Performance Alerts

- **LCP > 2s**: Investigate slow pages
- **Cache Hit Rate < 60%**: Review caching strategy
- **API Error Rate > 5%**: Check backend health
- **Deployment Failure**: Immediate notification

#### Business Alerts

- **Traffic Spike > 200%**: Potential viral content
- **Bounce Rate > 70%**: User experience issues
- **Conversion Rate Drop**: Check checkout flow

## 🔧 Maintenance & Operations

### Routine Maintenance

#### Daily Checks

1. **Cache Performance**: Review hit rates and adjust TTL
2. **Error Rates**: Monitor API and edge errors
3. **Traffic Patterns**: Identify peak usage times

#### Weekly Tasks

1. **Performance Review**: Analyze Core Web Vitals
2. **Cache Cleanup**: Remove stale cache entries
3. **Security Updates**: Apply patches and updates

#### Monthly Tasks

1. **Architecture Review**: Assess scaling needs
2. **Cost Optimization**: Review Cloudflare usage
3. **Backup Verification**: Ensure data recovery readiness

### Troubleshooting Guide

#### Common Issues

**Issue 1: Cache Not Updating**

```bash
# Force cache purge
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

**Issue 2: ISR Not Working**

```typescript
// Check revalidate configuration
export const revalidate = 60; // Ensure this is set
```

**Issue 3: API Errors**

```bash
# Check backend health
curl -I https://api.joyminis.com/health
```

### Rollback Procedures

#### Automated Rollback

```yaml
# GitLab CI rollback job
rollback-blog:
  script:
    - cd apps/frontend-blog
    - git checkout $PREVIOUS_COMMIT_SHA
    -  # Redeploy previous version
```

#### Manual Rollback

1. **Identify Bad Deployment**: Check deployment logs
2. **Revert Code**: Git revert or checkout previous commit
3. **Redeploy**: Trigger deployment pipeline
4. **Verify**: Check site functionality

## 📚 Related Documentation

### Architecture Documents

- [Overall Architecture](../ARCHITECTURE_CN.md) - Complete system architecture
- [Frontend Blog Architecture](./FRONTEND_BLOG_ARCHITECTURE.md) - Blog-specific frontend design
- [Backend Architecture](./BLOG_SYSTEM_BACKEND_ARCHITECTURE_CN.md) - Blog backend system design

### Technical Guides

- [Next.js Hydration Architecture](../nextjs/HYDRATION_ARCHITECTURE_FIX_SUMMARY.md) - SSR/CSR hydration patterns
- [Authentication Architecture](../nextjs/AUTH_ARCHITECTURE_ZERO_FLICKER.md) - Auth system design
- [Language Switching](../nextjs/LANGUAGE_SWITCH_FLICKER_FIX_SUMMARY.md) - i18n implementation

### Deployment Guides

- [Admin Cloudflare Deployment](../../.gitlab/deploy-admin.yml) - Reference deployment configuration
- [Cloudflare Setup Guide](../../apps/frontend-blog/README.md) - Project-specific setup

## 🚨 Security Considerations

### Edge Security

1. **DDoS Protection**: Cloudflare automatic mitigation
2. **WAF Rules**: Web Application Firewall configuration
3. **Rate Limiting**: API request throttling
4. **Bot Management**: Automated bot detection

### Data Security

1. **HTTPS Enforcement**: Always use SSL/TLS
2. **CSP Headers**: Content Security Policy
3. **HSTS**: HTTP Strict Transport Security
4. **Cookie Security**: Secure, HttpOnly flags

### Access Control

1. **API Authentication**: JWT token validation
2. **Admin Access**: IP whitelisting for admin areas
3. **Monitoring Access**: Restricted to authorized personnel

## 🔄 Version History

### v1.0.0 (2026-04-18)

- **Initial Architecture**: Edge ISR + Cloudflare deployment
- **Performance Targets**: LCP < 1s, Cache Hit > 80%
- **Deployment Pipeline**: GitLab CI to Cloudflare Pages

### Future Enhancements

- **v1.1.0**: Advanced caching strategies
- **v1.2.0**: Real-time content updates
- **v1.3.0**: Advanced monitoring and alerting
- **v2.0.0**: Multi-region deployment

---

**Last Updated**: 2026-04-18  
**Maintainer**: Infrastructure Team  
**Status**: ✅ Production Ready  
**Next Review**: 2026-05-18
