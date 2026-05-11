# Swagger Docs Standalone Export Plan

## 1. Current State

### Swagger Configuration (`apps/api/src/main.ts:110-119`)

```typescript
if (!isProd) {
  const swaggerCfg = new DocumentBuilder()
    .setTitle('JoyMini API — NestJS Backend Platform')
    .setDescription('REST API for web/mobile')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, swaggerCfg);
  SwaggerModule.setup('docs', app, doc);
}
```

- **Only enabled in development** (`!isProd`)
- Route: `/docs`
- **No auth on Swagger UI page itself**
- `.addBearerAuth()` only documents API-level auth (shows "Authorize" button in Swagger UI)
- `@nestjs/swagger@^11.2.1` already installed
- `swagger-ui-express@^5.0.1` already installed
- `yaml@^2.8.1` already installed (dev dep)

### Tag Pattern Analysis

| Prefix | Examples | Auth Guard |
|--------|----------|------------|
| `admin XXX` | `admin Banner Management`, `admin Auth Management` | `AdminJwtAuthGuard` / `JwtAuthGuard` + `PermissionsGuard` |
| Client (plain) | `auth`, `Banners`, `Frontend Blog`, `treasure` | `JwtAuthGuard` (some), Public (some) |
| `Frontend Blog` | Blog public endpoints | Mostly public, some `JwtAuthGuard` |

### API Module Breakdown

- **Admin** (~20 modules): auth, banner, treasure, coupon, KYC, finance, order, user, chat, notification, system-config, etc.
- **Client** (~20 modules): auth, banners, category, coupon, flash-sale, group, KYC, orders, treasure, wallet, etc.
- **Blog**: articles, categories, tags, comments (mostly public)
- **Common**: chat, group, media, region, upload, payment, etc.

---

## 2. Security Risk Assessment

### Risk Level: HIGH if full Swagger is made public

| Exposed | What's Leaked | Severity |
|---------|---------------|----------|
| Admin endpoints | Full CRUD structure: treasure, banner, coupon, KYC, orders, users, finance, system-config | 🔴 Critical |
| Admin auth path | `POST /api/v1/auth/admin/login` - attackers can target login | 🔴 High |
| KYC DTOs | ID card schemas (`idFrontImage`, `idBackImage`, `idNumber`, user personal info) | 🔴 High |
| Finance DTOs | Transaction amounts, withdrawal/recharge schemas, wallet operations | 🟠 Medium |
| Chat DTOs | Message structures, group management schemas | 🟠 Medium |
| Internal paths | All route paths, query params, response structures | 🟠 Medium |
| Auth DTOs | Login/register/OAuth schemas - these are already public by design | 🟢 Low |

### Key Concern: Even without auth guards protecting the API, exposing the **spec** alone gives attackers a complete blueprint of the system's internal structure.

---

## 3. Recommended Approach: Build-Time Export Script

Create a script that runs at build time (no server required) to:

1. **Headlessly bootstrap** the NestJS app (no `app.listen()`)
2. **Generate the full OpenAPI spec** via `SwaggerModule.createDocument()`
3. **Filter out sensitive admin routes** by removing tags matching `admin *`
4. **Export as static files**:
   - `swagger-spec.json` - the filtered OpenAPI 3.0 JSON spec
   - `index.html` - standalone Swagger UI page (loads the JSON from same directory)
5. **No live API needed** - purely static files, can host on GitHub Pages, Upwork file attachment, or any static host

### What Gets Included (Public-Facing APIs Only)

| Module | Endpoints Included | Notes |
|--------|--------------------|-------|
| Auth (Client) | login, register, OAuth, refresh, profile | Public + JWT-protected |
| Banners | `GET /api/v1/banners` | Public (cached) |
| Flash Sale | `GET /api/v1/flash-sale/*` | Public |
| Treasure | `GET /api/v1/treasure/*` | Public |
| Sections | `GET /api/v1/sections/*` | Public |
| Categories | `GET /api/v1/category/*` | Public |
| Ads | `GET /api/v1/ads` | Public |
| Health | `GET /api/v1/health` | Public |
| Blog (Frontend) | articles, categories, tags, comments, search | Mostly public |
| Groups | Group listing | Public |
| Payment Channels | Channel listing | Public |
| Regions | Provinces, cities, barangays | JWT-protected |
| System Config | Public system config | Public |
| OTP | Send/verify OTP | Throttled public |

### What Gets Excluded (Admin/Internal)

| Module | Reason |
|--------|--------|
| All `admin/*` endpoints | Admin-only CRUD ops |
| `common/chat/*` | Internal chat system |
| `common/contact/*` | Internal contacts |
| `common/media/*` | Admin media operations |
| `common/upload/*` | Upload endpoints |
| `blog/admin/*` | Admin blog management |

---

## 4. Implementation Plan

### Step 1: Create the Export Script

**File**: `apps/api/scripts/cli/export-swagger.ts`

This script will:
- Import `NestFactory` and `AppModule`
- Create a headless NestJS app
- Build Swagger config (same as `main.ts`)
- Generate the OpenAPI spec
- Filter out tags matching `/^admin /i`
- Write filtered spec to `dist/public/swagger-spec.json`
- Create `dist/public/index.html` (self-contained Swagger UI page)

```typescript
// Pseudocode for the filtering logic
const filteredPaths: Record<string, any> = {};
for (const [path, pathItem] of Object.entries(doc.paths)) {
  // Check if ANY method on this path belongs to an admin tag
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'options'];
  const isAdmin = methods.some(method => {
    const operation = pathItem[method];
    return operation?.tags?.some((tag: string) => tag.startsWith('admin'));
  });
  if (!isAdmin) {
    filteredPaths[path] = pathItem;
  }
}
doc.paths = filteredPaths;

// Also remove admin tags from the tags array
doc.tags = doc.tags?.filter(tag => !tag.name.startsWith('admin'));
```

### Step 2: Create Build Command in `package.json`

Add to `apps/api/package.json`:
```json
"scripts": {
  "export:swagger": "tsx scripts/cli/export-swagger.ts"
}
```

### Step 3: Run the Export

```bash
cd apps/api && yarn export:swagger
```

Output files in `apps/api/dist/public/`:
- `swagger-spec.json` - Filtered OpenAPI spec
- `index.html` - Swagger UI

### Step 4: Host on Upwork

Since Upwork profile supports:
- **File attachments** - upload the `index.html` + `swagger-spec.json` as a ZIP
- **GitHub repos** - commit to a public repo and link it
- **External links** - host on GitHub Pages, Vercel, or Netlify as a static site

The static HTML page uses Swagger UI CDN to render the spec with NO backend server required.

---

## 5. Alternative Approach (If Static Export Isn't Suitable)

If the user prefers a live docs endpoint on their production server:

### Option B: Conditional Production Swagger with Tag Filtering

Modify `main.ts` to:
- Add `ENABLE_DOCS` env var control (instead of `!isProd`)
- Filter paths to exclude admin routes at the document level
- Add rate-limiting to the `/docs` endpoint

**Risk**: Still requires the server to be running and accessible. If the load balancer/firewall accidentally exposes the API, the Swagger endpoint could be reached.

### Option C: Separate "Docs" Deployment

- Create a minimal Node.js server (Express) that serves the static Swagger files
- Deploy as a completely separate app (no database, no business logic)
- Zero security risk since there's no backend to attack

---

## 6. Recommendation

**Recommended: Option A (Build-Time Export Script)** because:

| Factor | Score |
|--------|-------|
| 🔒 No live API exposure | ✅ |
| 📦 Self-contained static files | ✅ |
| 🔧 Easy to update (re-run script) | ✅ |
| 🌐 Host anywhere (Upwork, GitHub Pages) | ✅ |
| 🎯 Only public endpoints visible | ✅ |
| ⚡ No server resources needed | ✅ |

### Security Checklist

- [x] All admin/* routes excluded from spec
- [x] All common/chat/* routes excluded
- [x] All common/contact/* routes excluded
- [x] All common/media/* routes excluded
- [x] All common/upload/* routes excluded
- [x] Blog admin routes excluded
- [x] No database connections in the export script
- [x] No real API server needed to view docs
- [x] Static files contain only API shapes, no real data
- [x] Bearer auth button still shown so users know which endpoints need auth
