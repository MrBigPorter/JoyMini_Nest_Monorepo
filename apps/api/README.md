# JoyMIni Api— NestJS Enterprise Backend API

[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs)](apps/api/package.json)
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma)](apps/api/prisma/schema.prisma)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql)](apps/api/package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript)](apps/api/tsconfig.json)
[![Jest](https://img.shields.io/badge/Jest-29-C21325?logo=jest)](apps/api/jest.config.js)
[![Swagger](https://img.shields.io/badge/Swagger-OpenAPI-85EA2D?logo=swagger)](apps/api/src/main.ts)

> A production-grade REST API built with NestJS 11, Prisma 6, and PostgreSQL 16. Part of the [JoyMini Nest Monorepo](../README.md).

---

## ✨ Overview

`JoyMIni Api` is the backend API powering the Lucky Nest platform. It provides RESTful endpoints for user management, authentication (JWT + OAuth 2.0), financial transactions, KYC verification, real-time messaging, e-commerce operations, and content management.

The API follows NestJS modular architecture with dependency injection, guards-based authorization (RBAC), DTO validation, Swagger documentation, and Prisma-based data access with full migration management.

---

## 🛠️ Tech Stack

| Category           | Technologies                                                                     |
| ------------------ | -------------------------------------------------------------------------------- |
| **Framework**      | NestJS 11, Express Platform, TypeScript 5.5                                      |
| **Database**       | PostgreSQL 16, Prisma 6 ORM (70+ migrations)                                     |
| **Auth**           | JWT dual-token (Access + Refresh), Passport, OAuth 2.0 (Google, Facebook, Apple) |
| **Validation**     | class-validator, class-transformer, DTOs, ValidationPipe                         |
| **Real-time**      | Socket.IO, WebSocket Gateway                                                     |
| **Security**       | Helmet, Throttler (rate limiting), CORS, bcrypt                                  |
| **Docs**           | Swagger/OpenAPI auto-generated                                                   |
| **Testing**        | Jest 29, @nestjs/testing, Supertest                                              |
| **Infrastructure** | Docker, Docker Compose, Nginx                                                    |

---

## 🧠 Technical Challenges & Solutions

### 1. Dual-Token JWT Authentication with Refresh Rotation

**Problem:** The platform needs secure authentication that works across web (Next.js), mobile (Capacitor), and third-party OAuth flows. A single JWT token is vulnerable to theft, and refresh tokens must be rotated to prevent replay attacks.

**Solution:** A dual-token system with short-lived access tokens (15 min) and long-lived refresh tokens (7 days). The refresh token is rotated on each use — the old token is invalidated and a new one issued. The [`HttpClient`](../apps/admin-next/src/api/http.ts:313) on the frontend implements a single-fly refresh pattern: concurrent 401 responses share one refresh promise.

```
┌─────────┐     ┌──────────┐     ┌──────────┐
│  Client  │────▶│  Auth    │────▶│  JWT     │
│          │◀────│  Service │◀────│  Strategy│
└─────────┘     └──────────┘     └──────────┘
     │                                │
     │  Access Token (15m)            │  Verify + Extract
     │  Refresh Token (7d, rotated)   │  payload → req.user
     ▼                                ▼
  Protected Routes ←─── AdminJwtAuthGuard + RolesGuard
```

[View auth module](apps/api/src/main.ts) | [View Prisma schema](apps/api/prisma/schema.prisma)

---

### 2. Prisma Transaction Management for Financial Operations

**Problem:** Financial operations (wallet deductions, order creation, refunds) require atomicity — partial failures must roll back all changes. Concurrent requests could cause race conditions on wallet balances.

**Solution:** Prisma's interactive transactions with serializable isolation for critical financial paths. Wallet balance updates use optimistic locking with version checks, and all financial mutations are wrapped in transactions that include balance validation before commit.

```typescript
// Conceptual example of wallet transaction
await prisma.$transaction(async (tx) => {
  const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
  if (wallet.balance < amount)
    throw new BadRequestException('Insufficient balance');
  await tx.wallet.update({
    where: { id: wallet.id },
    data: { balance: { decrement: amount } },
  });
  await tx.walletTransaction.create({
    data: { userId, amount: -amount, type: 'WITHDRAWAL' },
  });
});
```

[View Prisma schema](apps/api/prisma/schema.prisma) — 70+ migrations covering users, wallets, orders, KYC, chat, and more.

---

### 3. WebSocket Gateway for Real-Time IM with Horizontal Scaling

**Problem:** The in-app chat and customer service features need real-time messaging with typing indicators, read receipts, and online presence. The solution must support horizontal scaling across multiple API instances.

**Solution:** A Socket.IO Gateway with Redis adapter for cross-instance event propagation. Messages are persisted to PostgreSQL via Prisma, and unread counts are maintained in Redis for fast access. The gateway integrates with the existing JWT auth for connection authentication.

[View chat schema](apps/api/prisma/schema.prisma) — `ChatMessage`, `ChatConversation`, `FriendRequest` models.

---

### 4. OAuth Deep-Link Flow for Mobile Apps

**Problem:** Mobile apps (iOS/Android via Capacitor) need OAuth login, but the redirect URI must return to the app (not a browser). The OAuth state parameter must survive app switching, and the flow must work with multiple providers (Google, Facebook, Apple).

**Solution:** A custom OAuth flow where the mobile app opens a browser for OAuth, the server redirects to a custom scheme URL (`joymini://oauth/callback`) or the web entry point ([`app.joyminis.com`](https://app.joyminis.com)/oauth/callback), and the app captures the redirect. The state parameter encodes the provider and a PKCE challenge for security.

[View OAuth utilities](../apps/frontend-blog/src/lib/utils/oauth.ts)

---

### 5. Docker Multi-Stage Build with Yarn 4 PnP

**Problem:** Yarn 4 Plug'n'Play (PnP) creates a `.pnp.cjs` loader that must be present in the Docker image. Naive `COPY` of `node_modules` doesn't work. The monorepo structure means shared packages must be built before the API.

**Solution:** A multi-stage Docker build that:

1. Installs all dependencies in a builder stage
2. Builds shared packages (`@lucky/shared`, `@repo/ui`) first
3. Builds the API with NestJS CLI
4. Copies only production artifacts to a slim final stage

[View Dockerfile](apps/api/Dockerfile.dev) | [View Docker Compose](../compose.yml)

---

## 📁 Project Structure

```
apps/api/
├── src/
│   ├── main.ts                 # Entry point (Helmet, Swagger, CORS, ValidationPipe)
│   ├── app.module.ts           # Root module with all imports
│   ├── auth/                   # JWT auth, OAuth, guards
│   ├── users/                  # User CRUD, profiles
│   ├── wallet/                 # Wallet, transactions, balance
│   ├── orders/                 # Order management, refunds
│   ├── products/               # Product catalog, flash sales
│   ├── kyc/                    # KYC verification workflow
│   ├── chat/                   # Real-time messaging gateway
│   ├── blog/                   # Blog articles, categories, comments
│   ├── marketing/              # Coupons, lucky draws, promotions
│   ├── upload/                 # File upload handling
│   └── common/                 # Shared DTOs, decorators, filters
├── prisma/
│   ├── schema.prisma           # Data model (all entities)
│   └── migrations/             # 70+ migration files
├── test/                       # E2E tests
├── Dockerfile.dev              # Development Dockerfile
├── nest-cli.json               # NestJS CLI config
├── tsconfig.json               # TypeScript config
└── jest.config.js              # Jest configuration
```

---

## 🚀 Quick Start

```bash
# From monorepo root

# 1. Start PostgreSQL (Docker)
docker run --name dev-postgres -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_USER=dev -e POSTGRES_DB=app \
  -p 5432:5432 -d postgres:16

# 2. Build shared dependencies
yarn workspace @lucky/shared build

# 3. Setup environment
cp apps/api/.env.development apps/api/.env

# 4. Initialize database
yarn workspace @lucky/api prisma migrate dev

# 5. Start dev server (hot reload, port 3001)
yarn workspace @lucky/api start:dev
```

Open:

- **API**: `http://localhost:3001/api`
- **Swagger Docs**: `http://localhost:3001/docs`

---

## 📦 Key Features

| Module               | Description                                                                   |
| -------------------- | ----------------------------------------------------------------------------- |
| **Authentication**   | JWT dual-token (Access + Refresh), OAuth 2.0 (Google, Facebook, Apple), RBAC  |
| **User Management**  | Registration, profiles, device tracking, login logs                           |
| **Wallet & Finance** | Deposits, withdrawals, transactions, balance management, manual adjustments   |
| **Order Management** | Order lifecycle, refund processing, payment channel integration               |
| **KYC Verification** | Document upload, liveness check integration (AWS Rekognition), audit workflow |
| **Real-time Chat**   | WebSocket gateway, conversation management, typing indicators, friend system  |
| **Blog CMS**         | Articles, categories, tags, comments, AI translation, markdown support        |
| **Marketing**        | Coupons, flash sales, lucky draws, promotions                                 |
| **Admin Panel**      | Admin user management, roles & permissions, operation logs                    |
| **System Config**    | Dynamic configuration, banner/ads management, support channels                |

---

## 🧪 Testing

```bash
# Unit tests
yarn workspace @lucky/api test

# E2E tests
yarn workspace @lucky/api test:e2e

# Test coverage
yarn workspace @lucky/api test:cov
```

---

## 📚 API Documentation

Swagger documentation is auto-generated from NestJS decorators and DTOs:

- **Dev**: `http://localhost:3001/docs`
- **Production**: `https://api.joyminis.com/docs`

The documentation includes request/response schemas, authentication requirements, and interactive testing.

---

## 🔗 Related

- [Monorepo Root](../README.md) — Project overview and architecture
- [@lucky/admin-next](../admin-next/README.md) — Admin dashboard (frontend consumer)
- [@lucky/shared](../packages/shared/README.MD) — Shared types and utilities
- [Prisma Schema](apps/api/prisma/schema.prisma) — Full data model

---

## 📄 License

Part of the JoyMini Nest Monorepo. See the [root license](../README.md) for details.
