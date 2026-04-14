# ─── Build stage ─────────────────────────────────────────────────────────────
FROM rust:1.76-slim-bookworm AS builder
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Cache dependencies
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -f target/release/deps/credit_scoring*

# Build the real binary
COPY src ./src
RUN cargo build --release

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/credit-scoring ./credit-scoring

# Default environment
ENV CREDIT_SCORING_PORT=8089
ENV DATABASE_URL=postgres://nexcom:nexcom@postgres:5432/nexcom
ENV REDIS_URL=redis://redis:6379
ENV CORE_BANKING_URL=http://core-banking:8083
ENV MIN_SCORE_AUTO_APPROVE=680
ENV MIN_SCORE_MANUAL_REVIEW=550
ENV MAX_DTI_RATIO=0.45
ENV MAX_LOAN_TO_INCOME_RATIO=3.0
ENV RUST_LOG=info

EXPOSE 8089
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8089/health || exit 1

CMD ["./credit-scoring"]
