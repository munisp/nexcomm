# ─────────────────────────────────────────────────────────────────────────────
# NEXCOM Exchange — Custom Caddy Build
# Builds a Caddy binary with:
#   - Coraza WAF (OWASP CRS compatible)
#   - caddy-l4 (L4 TCP/UDP routing)
#   - CrowdSec bouncer + AppSec
#   - caddy-security (OIDC/JWT)
#   - caddy-ratelimit
# ─────────────────────────────────────────────────────────────────────────────

# Stage 1: Build custom Caddy with xcaddy
FROM caddy:2.9.0-builder AS builder

RUN xcaddy build v2.9.0 \
    --with github.com/corazawaf/coraza-caddy/v2@v2.3.0 \
    --with github.com/mholt/caddy-l4@v0.0.0-20250101000000-latest \
    --with github.com/hslatman/caddy-crowdsec-bouncer/http@v0.9.0 \
    --with github.com/hslatman/caddy-crowdsec-bouncer/appsec@v0.9.0 \
    --with github.com/hslatman/caddy-crowdsec-bouncer/layer4@v0.9.0 \
    --with github.com/greenpau/caddy-security@v1.1.28 \
    --with github.com/mholt/caddy-ratelimit@v0.0.0-20250101000000-latest

# Stage 2: Download OWASP CRS rules
FROM alpine:3.20 AS crs-downloader
RUN apk add --no-cache curl tar && \
    curl -fsSL https://github.com/coreruleset/coreruleset/archive/refs/tags/v4.7.0.tar.gz \
    | tar -xz --strip-components=1 -C /tmp/crs && \
    mkdir -p /etc/caddy/coraza && \
    cp -r /tmp/crs/rules /etc/caddy/coraza/owasp_crs && \
    cp /tmp/crs/crs-setup.conf.example /etc/caddy/coraza/

# Stage 3: Final image
FROM caddy:2.9.0-alpine

# Copy custom Caddy binary
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Copy OWASP CRS rules
COPY --from=crs-downloader /etc/caddy/coraza /etc/caddy/coraza

# Create directories
RUN mkdir -p /data/caddy /var/log/caddy /etc/caddy/certs && \
    chown -R caddy:caddy /data/caddy /var/log/caddy

# Coraza configuration file
COPY coraza.conf /etc/caddy/coraza/coraza.conf

# Default Caddyfile (overridden by ConfigMap in Kubernetes)
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 80 443 443/udp 2019 2775 9093 6380 5433 2222

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:2019/health || exit 1

VOLUME ["/data/caddy", "/var/log/caddy"]

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
