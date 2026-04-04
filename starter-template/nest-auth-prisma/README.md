# Nest Auth + Prisma Template

Minimal NestJS scaffold for:

- JWT auth
- HttpOnly cookie set/clear endpoints
- Prisma baseline schema and service

## Run

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run start:dev
```

## Endpoints

- `POST /api/v1/auth/admin/login`
- `POST /api/v1/auth/admin/set-cookie`
- `POST /api/v1/auth/admin/clear-cookie`

