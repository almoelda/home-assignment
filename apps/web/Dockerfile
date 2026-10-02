# Multi-stage build. Build context is the REPO ROOT (see docker-compose.yml).
# VITE_API_BASE_URL is a build-time arg: Vite inlines env vars at build time, and the
# browser calls the API directly (CORS is enabled on the API), so no reverse proxy is
# needed for this slice's scale.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/domain/package.json packages/domain/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY apps/web apps/web
RUN pnpm --filter @marketplace/domain run build
RUN pnpm --filter @marketplace/web run build

# Unprivileged nginx image: runs as the non-root `nginx` user out of the box (listens on
# 8080, writable pid/cache paths already set up) — IMPLEMENTATION_PLAN.md §14 says "non-root
# containers"; plain nginx:alpine's master process runs as root.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
