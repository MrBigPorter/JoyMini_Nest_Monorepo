# Grafana SSO Integration — Single Sign-On via Auth Proxy

> **Last updated**: 2026-06-06
> **Status**: Production (live at `monitor.joyminis.com`)
> **Related projects**: [HyperPush](https://github.com/MrBigPorter/hyper_push), [infra-platform](https://github.com/MrBigPorter/infra-platform)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [How It Works](#3-how-it-works)
4. [Components](#4-components)
5. [Configuration Reference](#5-configuration-reference)
6. [Token Lifecycle](#6-token-lifecycle)
7. [Security Considerations](#7-security-considerations)
8. [Troubleshooting](#8-troubleshooting)
9. [Lessons Learned](#9-lessons-learned)
10. [Adding New SSO Integrations](#10-adding-new-sso-integrations)

---

## 1. Overview

When a user is logged into HyperPush, clicking the **"Logs Dashboard"** link should take them directly to Grafana at `monitor.joyminis.com` **without any login prompts**. This is achieved through a custom SSO (Single Sign-On) flow using Grafana's Auth Proxy mode, JWT tokens, and Nginx reverse proxy.

### Problem Statement

HyperPush and Grafana are on different domains:
- HyperPush: `hyperpush.org` / `cp.hyperpush.org`
- Grafana: `monitor.joyminis.com`

Browser security prevents cookies from being shared across domains, so a standard SSO approach (shared session cookie) won't work.

### Solution

A **signed token redirect** pattern: the HyperPush backend generates a short-lived JWT, the frontend redirects the user to Grafana with this token, and Nginx validates it before proxying to Grafana.

---

## 2. Architecture

```
┌─────────────────────┐       ┌─────────────────────────────────────────┐
│   HyperPush Frontend │       │        JoyMini Nginx (Reverse Proxy)    │
│   (Cloudflare Pages) │       │                                         │
│                     │       │   monitor.joyminis.com                  │
│  Click "Logs"       │       │    location / {                         │
│       ↓             │       │      auth_request → auth-service        │
│   fetch /api/auth/  │       │      proxy_pass → Grafana :3001         │
│   grafana-token     │       │    }                                    │
│       ↓             │       │    cookie: monitor_token=xxx            │
│   redirect to       │       └────────┬────────────────────────────────┘
│   monitor.joyminis. │                │
│   com/?token=xxx    │                │
└─────────────────────┘                ▼
                              ┌──────────────────┐
                              │  Auth Service     │
                              │  (Node.js)        │
                              │  Port: 3004→3002  │
                              │  Validates JWT    │
                              │  with shared      │
                              │  secret           │
                              └────────┬─────────┘
                                       │ valid? 200 + X-Email header
                                       │
                                       ▼
                              ┌──────────────────┐
                              │  Grafana          │
                              │  Auth Proxy mode  │
                              │  Auto-login via   │
                              │  X-WEBAUTH-USER   │
                              └──────────────────┘
```

---

## 3. How It Works

### Step-by-Step Flow

```
1. User clicks "Logs Dashboard" in HyperPush frontend
2. Frontend calls GET /api/auth/grafana-token (authenticated via HyperPush session)
3. HyperPush backend signs a JWT with GRAFANA_AUTH_SECRET:
   { email: "user@example.com", expiresIn: "24h" }
4. Frontend redirects to: https://monitor.joyminis.com/explore?token=<jwt>
5. Nginx receives the request and triggers auth_request (internal subrequest)
6. /auth/v location extracts token from URL (?token=xxx) or cookie (monitor_token)
7. Token is forwarded to auth-service via X-Token header
8. auth-service verifies JWT signature → returns 200 + X-Email header
9. Nginx sets X-WEBAUTH-USER header with the email
10. Grafana receives X-WEBAUTH-USER → auto-creates/logs in user → returns dashboard
11. Nginx also sets Set-Cookie: monitor_token=<jwt> for subsequent requests
12. Browser stores cookie → all future requests carry the token automatically
```

### Cookie-Based Token Persistence

Since Grafana v13's auth.proxy does **not** create session cookies, the Nginx layer handles session persistence:

1. **First request** (with `?token=xxx`): Nginx validates token, sets `Set-Cookie: monitor_token=<jwt>`
2. **Subsequent requests** (no token in URL): Nginx reads token from `monitor_token` cookie, validates it, sets `X-WEBAUTH-USER`
3. This ensures all API calls, plugin loading, and page navigation work without 401 errors

---

## 4. Components

| Component | Location | Role |
|-----------|----------|------|
| **HyperPush Backend** (`sso.controller.ts`) | `backend/src/auth/sso.controller.ts` | Signs JWT tokens using `GRAFANA_AUTH_SECRET` |
| **Auth Service** (`server.js`) | `infra-platform/auth-service/server.js` | Validates JWT signatures, returns email |
| **Nginx** (`50-monitor.conf`) | `/opt/lucky/nginx/conf.d/50-monitor.conf` | Reverse proxy + auth_request + cookie management |
| **Grafana** | `infra-platform/compose.monitoring.yml` | Auth Proxy mode, auto-creates users |
| **Shared Secret** | `.env` in both projects | `GRAFANA_AUTH_SECRET` — must match |

### HyperPush Backend — Token Signing

**File**: `backend/src/auth/sso.controller.ts`

```typescript
@Get('grafana-token')
@UseGuards(AuthGuard('jwt'))
async getGrafanaToken(@Req() req: { user: { email: string } }) {
  const secret = this.configService.get<string>('GRAFANA_AUTH_SECRET');
  const token = this.jwtService.sign(
    { email: req.user.email },
    { secret, expiresIn: '24h' }
  );
  return { token };
}
```

### Auth Service — Token Validation

**File**: `auth-service/server.js`

```javascript
// Primary: Token via X-Token header (from Nginx auth_request)
app.get('/auth/validate-token', (req, res) => {
  const token = req.query.token || req.headers['x-token'];
  if (!token) return res.sendStatus(200); // No token → skip auth

  try {
    const decoded = jwt.verify(token, SECRET);
    res.set('X-Email', decoded.email);  // Nginx reads this header
    res.json({ email: decoded.email });
  } catch (err) {
    res.sendStatus(401);  // Invalid/expired token
  }
});
```

### Nginx — Auth Request + Cookie Management

**File**: `50-monitor.conf` (simplified)

```nginx
# Conditionally set cookie: only when URL has token
map $arg_token $monitor_token_cookie {
    ""      "";
    default "monitor_token=$arg_token; Path=/; Max-Age=86400; SameSite=Lax";
}

# Auth validation endpoint
location = /auth/v {
    internal;
    set $sso_token "";
    if ($request_uri ~ [?&]token=([^&]+)) {
        set $sso_token $1;                    # Token from URL
    }
    if ($sso_token = "") {
        set $sso_token $cookie_monitor_token; # Fallback to cookie
    }
    if ($sso_token = "") {
        return 200;                           # No token → skip auth
    }
    proxy_set_header X-Token $sso_token;
    proxy_pass http://host.docker.internal:3004/auth/validate-token;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
}

# Grafana reverse proxy
location / {
    auth_request /auth/v;
    auth_request_set $auth_email $upstream_http_x_email;
    proxy_set_header X-WEBAUTH-USER $auth_email;
    add_header Set-Cookie $monitor_token_cookie;  # Set cookie on first visit
    proxy_pass http://host.docker.internal:3001;
}
```

### Grafana — Auth Proxy Configuration

**File**: `compose.monitoring.yml`

```yaml
grafana:
  environment:
    GF_AUTH_PROXY_ENABLED: "true"
    GF_AUTH_PROXY_HEADER_NAME: "X-WEBAUTH-USER"
    GF_AUTH_PROXY_HEADER_PROPERTY: "email"
    GF_AUTH_PROXY_AUTO_SIGN_UP: "true"
    GF_AUTH_PROXY_WHITELIST: "127.0.0.1, ::1, 0.0.0.0/0"
    GF_AUTH_ENABLE_LOGIN_TOKEN: "true"
    GF_USERS_AUTO_ASSIGN_ORG_ROLE: "Editor"
```

---

## 5. Configuration Reference

### Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `GRAFANA_AUTH_SECRET` | `infra-platform/.env` | Auth Service JWT verification key |
| `GRAFANA_AUTH_SECRET` | HyperPush `backend/.env` | JWT signing key (**must match**) |
| `GRAFANA_AUTH_SECRET` | GitHub Actions Secrets | Deployed to HyperPush VPS via CI/CD |
| `GRAFANA_ADMIN_PASSWORD` | `infra-platform/.env` | Grafana admin password |
| `GF_AUTH_PROXY_ENABLED` | `compose.monitoring.yml` | Enable Grafana auth proxy |
| `GF_AUTH_PROXY_HEADER_NAME` | `compose.monitoring.yml` | Header for user identity |
| `GF_AUTH_PROXY_HEADER_PROPERTY` | `compose.monitoring.yml` | Use email as user identifier |
| `GF_AUTH_PROXY_AUTO_SIGN_UP` | `compose.monitoring.yml` | Auto-create users on first login |
| `GF_AUTH_PROXY_WHITELIST` | `compose.monitoring.yml` | Trusted proxy IPs |
| `GF_AUTH_ENABLE_LOGIN_TOKEN` | `compose.monitoring.yml` | Enable session token creation |
| `GF_USERS_AUTO_ASSIGN_ORG_ROLE` | `compose.monitoring.yml` | Default role for new users |

### File Locations

| File | Project | Purpose |
|------|---------|---------|
| `backend/src/auth/sso.controller.ts` | HyperPush | JWT token signing endpoint |
| `auth-service/server.js` | infra-platform | JWT validation service |
| `auth-service/package.json` | infra-platform | Node.js dependencies |
| `compose.monitoring.yml` | infra-platform | Docker Compose (Grafana + Auth Service) |
| `50-monitor.conf` | Nginx (on VPS) | Nginx reverse proxy configuration |
| `.env` | Both projects | Shared secret configuration |

### Ports

| Service | Container Port | Host Port | Protocol |
|---------|---------------|-----------|----------|
| Grafana | 3000 | 3001 | HTTP (internal) |
| Auth Service | 3002 | 3004 | HTTP (internal) |
| Nginx | 80, 443 | 80, 443 | HTTP/HTTPS (public) |

---

## 6. Token Lifecycle

### JWT Token Structure

```json
{
  "email": "user@example.com",
  "iat": 1780739598,
  "exp": 1780825998
}
```

| Field | Value | Description |
|-------|-------|-------------|
| `email` | User's email | Used as Grafana user identifier |
| `iat` | Unix timestamp | Issued-at time |
| `exp` | Unix timestamp | Expiration time (24 hours after `iat`) |

### Cookie (`monitor_token`)

| Attribute | Value | Description |
|-----------|-------|-------------|
| Name | `monitor_token` | Stores the JWT token |
| Path | `/` | Available on all paths |
| Max-Age | `86400` (24 hours) | Matches token expiry |
| SameSite | `Lax` | Allows cross-origin navigation |

### Security Properties

- **Algorithm**: HS256 (HMAC-SHA256)
- **Signing secret**: `GRAFANA_AUTH_SECRET` (64-char hex string)
- **Token scope**: Grafana access only — does not grant access to HyperPush or other services
- **Short-lived**: 24-hour expiry limits exposure window
- **Single-use redirect**: Token is consumed by Nginx on first request, then stored in HTTP-only-adjacent cookie

---

## 7. Security Considerations

| Risk | Mitigation |
|------|------------|
| Token in URL (visible in browser history, server logs) | HTTPS encryption in transit; 24h expiry; token stored in cookie after first use |
| Shared secret compromise | Stored in `.env` files, never committed to git; generate with `openssl rand -hex 32` |
| Replay attack | JWT has `exp` claim; token expires after 24 hours |
| Cross-domain cookie theft | `SameSite=Lax` prevents CSRF; `Secure` flag (via HTTPS); no `HttpOnly` (Nginx needs to read it) |
| Unauthorized proxy access | Grafana auth.proxy whitelist restricts to localhost/Docker network IPs |
| Auth service exposure | Port 3004 bound to host only (not publicly accessible) |
| Clock skew between services | Same VPS ensures synchronized clocks; 24h window provides generous tolerance |

### Secret Rotation

If `GRAFANA_AUTH_SECRET` is compromised:

1. Generate new secret: `openssl rand -hex 32`
2. Update `infra-platform/.env` and restart: `docker compose -f compose.monitoring.yml up -d`
3. Update HyperPush `backend/.env` (or GitHub Actions secret) and redeploy
4. All existing tokens and cookies become immediately invalid

---

## 8. Troubleshooting

### Issue: 401 Unauthorized on page load

**Symptoms**: Browser shows "401 Authorization Required" when clicking the monitoring link.

**Possible causes**:
1. **Token expired** — JWT has 24h TTL. Generate a new link from HyperPush.
2. **Secret mismatch** — `GRAFANA_AUTH_SECRET` differs between HyperPush backend and auth-service.

**Diagnosis**:
```bash
# Decode the token to check expiry
echo "YOUR_TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool

# Check secret consistency
ssh root@vps 'grep GRAFANA_AUTH_SECRET /opt/hyperpush/.env'
ssh root@vps 'docker exec infra-grafana printenv GRAFANA_AUTH_SECRET'
```

### Issue: Plugin loading 401 errors (partial page load)

**Symptoms**: Grafana page loads but plugins fail with 401 in browser console.

**Root cause**: Grafana v13's auth.proxy does not create session cookies. Without a cookie, subsequent requests (plugin loading, API calls) have no authentication.

**Fix**: Ensure Nginx sets `monitor_token` cookie (see `50-monitor.conf` with cookie-based token persistence).

### Issue: Nginx 502 Bad Gateway

**Symptoms**: Auth service is unreachable.

**Diagnosis**:
```bash
# Check auth-service is running
docker ps | grep infra-auth

# Check auth-service health
curl -s http://localhost:3004/health

# Check auth-service logs
docker logs infra-auth --tail=20
```

### Issue: User gets Grafana login page instead of dashboard

**Symptoms**: Redirect works but lands on Grafana login page.

**Diagnosis**:
```bash
# Check Grafana auth.proxy is enabled
curl -s -u admin:PASSWORD http://localhost:3001/api/admin/settings | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('auth.proxy',{}).get('enabled'))"

# Check user exists in Grafana
curl -s -u admin:PASSWORD http://localhost:3001/api/users | \
  python3 -c "import sys,json; [print(u['email'], u['role']) for u in json.load(sys.stdin)]"
```

### Quick Diagnostic Script

```bash
#!/bin/bash
SERVER="root@129.121.97.120"
SECRET="YOUR_GRAFANA_AUTH_SECRET"

# Generate fresh token
TOKEN=$(ssh $SERVER "docker exec infra-auth node -e \
  \"const jwt=require('jsonwebtoken');\
  console.log(jwt.sign({email:'user@example.com'},'$SECRET',{expiresIn:'24h'}));\"")

# Test full chain
echo "=== Auth Service ==="
curl -si -H "X-Token: $TOKEN" http://localhost:3004/auth/validate-token | head -5

echo "=== Grafana Direct ==="
curl -si -H "X-WEBAUTH-USER: user@example.com" http://localhost:3001/api/user | head -5

echo "=== Full Chain (Nginx) ==="
curl -sk -H 'Host: monitor.joyminis.com' \
  "https://localhost/explore?token=$TOKEN" -o /dev/null -w 'HTTP: %{http_code}\n'

echo "=== Auth Service Logs ==="
docker logs infra-auth --tail=5
```

---

## 9. Lessons Learned

### Problem: 30-Second Token TTL Was Too Short

**What happened**: The initial implementation set `expiresIn: '30s'` on the JWT. Users clicking the monitoring link would often see 401 errors because the token expired before the browser could complete the redirect chain (especially with Cloudflare adding latency).

**Fix**: Changed to `expiresIn: '24h'` in `sso.controller.ts`. The token is stored in a cookie after first use, so the 24h TTL provides a reasonable session duration.

### Problem: Grafana v13 Auth Proxy Doesn't Create Session Cookies

**What happened**: Even with a valid token, Grafana returned 401 on subsequent requests (plugin loading, API calls). The Grafana page would partially load but fail to authenticate.

**Root cause**: Grafana v13's auth.proxy operates on a per-request basis — it trusts the `X-WEBAUTH-USER` header on each request but does **not** create a session cookie. When subsequent requests arrive without the header (because the token was only in the initial URL), Grafana rejects them.

**Fix**: Two-part solution:
1. Added `GF_AUTH_ENABLE_LOGIN_TOKEN: "true"` to Grafana config
2. Modified Nginx to store the JWT in a cookie (`monitor_token`) on first request, and read it from the cookie on all subsequent requests

This ensures every request through Nginx carries a valid token for auth-service validation.

### Problem: Nginx `if` Directive Complexity

**What happened**: The Nginx `if` directive is notoriously tricky. Using `proxy_pass` inside `if` blocks can cause unexpected behavior.

**Fix**: Kept `proxy_pass` outside of `if` blocks. Used `if` only for variable assignment (`set $sso_token`), and the actual `proxy_pass` is always executed with a fixed URL (no variables in the proxy_pass URL).

---

## 10. Adding New SSO Integrations

If you need to SSO-integrate another system (e.g., Prometheus, AlertManager):

### If the target supports Auth Proxy

1. **Nginx**: Add a new location block with `auth_request` (similar to `50-monitor.conf`)
2. **Target system**: Enable auth proxy mode with the appropriate header config
3. **Auth service**: No changes needed — the same service validates tokens for all systems
4. **HyperPush frontend**: Add a new navigation button that calls `/api/auth/grafana-token` and redirects

### If the target doesn't support Auth Proxy

Use [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) as a sidecar:

```yaml
oauth2-proxy:
  image: quay.io/oauth2-proxy/oauth2-proxy:latest
  environment:
    OAUTH2_PROXY_PROVIDER: oidc
    OAUTH2_PROXY_CLIENT_ID: xxx
    OAUTH2_PROXY_CLIENT_SECRET: xxx
```

### Supported Systems

| System | Auth Proxy | Status |
|--------|-----------|--------|
| Grafana | ✅ | **Implemented** |
| Prometheus | ❌ | Use basic auth or oauth2-proxy |
| AlertManager | ❌ | Use basic auth or oauth2-proxy |
| Kibana | ❌ | Use Elasticsearch security |