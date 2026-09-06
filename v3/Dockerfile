# Multi-stage build for containerized deployments (e.g. public cloud instances).
# The systemd/install.sh path (see ../install.sh) remains the primary deployment
# method for self-hosted LAN installs; this image targets Docker-based hosts.

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
COPY server ./server

RUN npm ci
RUN npm run build:core \
 && npm run build:sync \
 && npm run build:web \
 && npm run build:server

RUN mkdir -p server/public && cp -r apps/web/dist/. server/public/

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S nagellacke && adduser -S nagellacke -G nagellacke

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/server ./server

RUN mkdir -p /data && chown -R nagellacke:nagellacke /app /data

USER nagellacke
WORKDIR /app/server
EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "dist/index.js"]
