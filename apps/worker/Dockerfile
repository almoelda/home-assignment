# Multi-stage build. Build context is the REPO ROOT (see docker-compose.yml).
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/application/package.json packages/application/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/db packages/db
COPY packages/domain packages/domain
COPY packages/application packages/application
COPY apps/worker apps/worker
RUN pnpm --filter @marketplace/db run build
RUN pnpm --filter @marketplace/domain run build
RUN pnpm --filter @marketplace/application run build
RUN pnpm --filter @marketplace/worker run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/db/package.json ./packages/db/package.json
COPY --from=build /repo/packages/db/dist ./packages/db/dist
COPY --from=build /repo/packages/db/node_modules ./packages/db/node_modules
COPY --from=build /repo/packages/domain/package.json ./packages/domain/package.json
COPY --from=build /repo/packages/domain/dist ./packages/domain/dist
COPY --from=build /repo/packages/application/package.json ./packages/application/package.json
COPY --from=build /repo/packages/application/dist ./packages/application/dist
COPY --from=build /repo/packages/application/node_modules ./packages/application/node_modules
COPY --from=build /repo/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /repo/apps/worker/dist ./apps/worker/dist
COPY --from=build /repo/apps/worker/node_modules ./apps/worker/node_modules

RUN addgroup -S app && adduser -S app -G app
USER app

CMD ["node", "apps/worker/dist/main.js"]
