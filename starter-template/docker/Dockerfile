FROM node:20-bullseye-slim AS builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare yarn@4.9.2 --activate

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn

# Copy workspace manifests first to maximize Docker cache.
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN yarn workspaces focus @{{PROJECT_SCOPE}}/api

COPY apps/api ./apps/api
COPY packages ./packages
COPY turbo.json tsconfig.json ./

RUN yarn workspace @{{PROJECT_SCOPE}}/api prisma generate
RUN node_modules/.bin/tsc -p packages/shared/tsconfig.json
RUN yarn workspace @{{PROJECT_SCOPE}}/api build
RUN node_modules/.bin/tsc -p apps/api/tsconfig.cli.json

FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache openssl wget

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY apps/api/docker/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]

