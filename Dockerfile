# syntax=docker/dockerfile:1

# ==============================================================================
# Stage 1: Build Web Dashboard & Serverfull Bundle (Runs natively on host platform)
# ==============================================================================
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS builder
WORKDIR /app

# Copy dependency manifests and configuration first for optimal Docker layer caching
COPY package.json package-lock.json .npmrc* ./
COPY web/package.json web/package-lock.json web/.npmrc ./web/

# Install dependencies deterministically without running lifecycle scripts early
RUN npm ci --ignore-scripts && npm --prefix web ci --ignore-scripts --legacy-peer-deps

# Copy full source tree
COPY . .

# Build Web UI (Vite) and bundle single-file serverfull runtime executable
RUN npm run build:serverfull

# ==============================================================================
# Stage 2: Production Runtime with Bun LTS
# ==============================================================================
FROM oven/bun:1-slim AS runner

LABEL maintainer="Hugo Koo <hokdung@outlook.com>" \
      org.opencontainers.image.title="DNS Worker" \
      org.opencontainers.image.description="Privacy-first DNS & DoH Resolver with modern Web Dashboard, powered by Bun LTS" \
      org.opencontainers.image.url="https://github.com/Obein/DNS-Worker" \
      org.opencontainers.image.source="https://github.com/Obein/DNS-Worker" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"

WORKDIR /app

# Install ca-certificates for DoH upstream TLS verification and curl for healthcheck
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Default Serverfull environment variables
ENV NODE_ENV=production \
    SERVERFULL_HOST=0.0.0.0 \
    SERVERFULL_UDP_PORT=53 \
    SERVERFULL_DOT_PORT=853 \
    SERVERFULL_HTTP_PORT=80 \
    SERVERFULL_HTTPS_PORT=443 \
    SERVERFULL_DB_PATH=/var/lib/dns-worker/dns_worker.sqlite

# Pre-create system persistent directories
RUN mkdir -p /var/lib/dns-worker /etc/dns-worker /etc/ssl/dns-worker

# Copy built application distribution assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/static ./static
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.env.serverfull ./.env.serverfull

# Expose Serverfull network transports:
# - 53/udp:   Classic UDP DNS
# - 853/tcp:  DNS over TLS (DoT)
# - 80/tcp:   HTTP Web Dashboard & DoH (Auto-redirects to HTTPS when TLS is configured)
# - 443/tcp:  HTTPS Web Dashboard & DoH
EXPOSE 53/udp 853/tcp 80/tcp 443/tcp

# Persistent storage and certificate volumes:
# - /var/lib/dns-worker: SQLite database & persistent secrets
# - /etc/dns-worker:     Mount point for custom .env configuration
# - /etc/ssl/dns-worker: Mount point for TLS certificate and private key (fullchain.pem, privkey.pem)
VOLUME ["/var/lib/dns-worker", "/etc/dns-worker", "/etc/ssl/dns-worker"]

# Healthcheck to verify HTTP / HTTPS Web Dashboard responsiveness
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsSLk http://127.0.0.1:${SERVERFULL_HTTP_PORT:-80}/ > /dev/null || exit 1

# Master runtime entry point
ENTRYPOINT ["bun", "dist/serverfull.mjs"]
