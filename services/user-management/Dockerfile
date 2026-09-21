# NEXCOM Exchange - User Management Service Dockerfile
# NOTE: this service intentionally uses `npm install` instead of `npm ci`.
# No package-lock.json is committed for this service, so `npm ci` would fail
# the image build. `npm install --omit=dev` resolves from package.json semver
# ranges. If a lockfile is ever added, switch back to `npm ci` for
# reproducible builds.
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist
EXPOSE 8006
CMD ["node", "dist/index.js"]
