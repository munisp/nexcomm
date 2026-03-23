# ─── Build stage ──────────────────────────────────────────────────────────────
FROM rust:1.78-slim-bookworm AS builder

RUN apt-get update && apt-get install -y \
    pkg-config libssl-dev cmake libsasl2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY Cargo.toml ./
# Cache dependencies
RUN mkdir src && echo "fn main(){}" > src/main.rs && cargo build --release && rm -rf src

COPY src ./src
RUN touch src/main.rs && cargo build --release

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y \
    libssl3 libsasl2-2 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /build/target/release/nexcom-ussd-engine ./

ENV RUST_LOG=nexcom_ussd=info,warn
ENV USSD_PORT=8020

EXPOSE 8020 8021

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8020/ussd/health || exit 1

CMD ["./nexcom-ussd-engine"]
