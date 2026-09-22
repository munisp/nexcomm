# NEXCOM Exchange — Portal (server/ + client/) production image
# Multi-stage: pnpm install → vite client build + esbuild server bundle → slim runtime.
# Matches package.json scripts: `build` = vite build + esbuild server/_core/index.ts → dist/,
# `start` = node dist/index.js (PORT defaults to 3000).

# ─── Stage 1: install full dependency set (cached on lockfile) ───────────────
FROM node:22-alpine AS deps
WORKDIR /app
# pnpm via corepack; version pinned by packageManager field / action-setup parity
RUN corepack enable && corepack prepare pnpm@9 --activate
# pnpm-workspace.yaml + patches/ are required: pnpm-lock.yaml references
# patchedDependencies (patches/wouter@3.7.1.patch) and workspace overrides.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

# ─── Stage 2: build client (vite → dist/public) and server (esbuild → dist/index.js) ───
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# vite.config.ts requires these at build time; placeholders are fine for image builds
ENV VITE_APP_ID=build-placeholder \
    VITE_OAUTH_PORTAL_URL=https://localhost \
    VITE_FRONTEND_FORGE_API_KEY=build-placeholder \
    VITE_FRONTEND_FORGE_API_URL=https://localhost
RUN pnpm run build

# ─── Stage 3: production runtime (prod deps only + bundled dist/) ────────────
FROM node:22-alpine AS runner
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
# server bundle is built with --packages=external, so prod node_modules are required
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
# run as non-root
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/health || exit 1
CMD ["node", "dist/index.js"]
