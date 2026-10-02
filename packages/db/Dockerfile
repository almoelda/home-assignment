# One-shot migrate+seed image. Build context is the REPO ROOT (see docker-compose.yml).
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY packages/db packages/db
RUN pnpm --filter @marketplace/domain run build
RUN pnpm --filter @marketplace/db run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/domain/package.json ./packages/domain/package.json
COPY --from=build /repo/packages/domain/dist ./packages/domain/dist
COPY --from=build /repo/packages/db/package.json ./packages/db/package.json
COPY --from=build /repo/packages/db/dist ./packages/db/dist
COPY --from=build /repo/packages/db/node_modules ./packages/db/node_modules
COPY --from=build /repo/packages/db/drizzle ./packages/db/drizzle

RUN addgroup -S app && adduser -S app -G app
USER app

WORKDIR /repo/packages/db
CMD ["sh", "-c", "node dist/migrate.js && node dist/seed.js"]
