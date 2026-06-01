FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare yarn@4.9.2 --activate

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
COPY apps/frontend-blog/package.json ./apps/frontend-blog/package.json
COPY apps/admin-blog/package.json ./apps/admin-blog/package.json
COPY apps/admin-next/package.json ./apps/admin-next/package.json
COPY apps/liveness-web/package.json ./apps/liveness-web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY packages/typescript-config/package.json ./packages/typescript-config/package.json
COPY packages/config/package.json ./packages/config/package.json


RUN yarn install

COPY . .
RUN yarn workspace @lucky/frontend-blog build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/apps/frontend-blog/.next/standalone ./
COPY --from=builder /app/apps/frontend-blog/.next/static ./apps/frontend-blog/.next/static
COPY --from=builder /app/apps/frontend-blog/public ./apps/frontend-blog/public

# curl for health checks and debugging
RUN apk add --no-cache curl

EXPOSE 3000

CMD ["node", "apps/frontend-blog/server.js"]
