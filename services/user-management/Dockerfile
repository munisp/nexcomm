# NEXCOM Exchange - User Management Service Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production --ignore-scripts
COPY --from=builder /app/dist ./dist
EXPOSE 8006
CMD ["node", "dist/index.js"]
