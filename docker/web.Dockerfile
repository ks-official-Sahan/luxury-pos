# syntax=docker/dockerfile:1
# Expo web static build served by nginx. EXPO_PUBLIC_API_URL="" = same origin (nginx proxies /api).

FROM node:22-bookworm-slim AS builder
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/pos/package.json apps/pos/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/theme/package.json packages/theme/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --filter "@luxury-pos/pos..."
COPY . .
ARG EXPO_PUBLIC_API_URL=""
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL}
RUN pnpm --filter @luxury-pos/pos build:web

FROM nginx:1.31-alpine AS final
# Only ${API_*} names reach envsubst, so nginx's own $vars and braces are untouched.
ENV NGINX_ENVSUBST_FILTER="^API_"
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infra/nginx/templates/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/apps/pos/dist /usr/share/nginx/html
EXPOSE 80
