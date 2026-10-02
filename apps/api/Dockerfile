# Multi-stage build. Build context is the REPO ROOT (see docker-compose.yml), not this
# directory — required so pnpm can see the workspace and the @marketplace/* dependencies.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/application/package.json packages/application/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/db packages/db
COPY packages/domain packages/domain
COPY packages/application packages/application
COPY apps/api apps/api
RUN pnpm --filter @marketplace/db run build
RUN pnpm --filter @marketplace/domain run build
RUN pnpm --filter @marketplace/application run build
RUN pnpm --filter @marketplace/api run build

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
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
