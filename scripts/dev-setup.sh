#!/usr/bin/env bash
# NEXCOM dev toolchain setup — verified on a 2CPU/4GB Debian 12 sandbox.
# Installs Go 1.25.x (go.mod files require `go 1.25.0`) and stable Rust.
set -euo pipefail

# ─── Go ─────────────────────────────────────────────────────────────────────
# NOTE: 1.22 is NOT sufficient — all service go.mod files declare `go 1.25.0`.
GO_VER="${GO_VER:-1.25.1}"
curl -sLO "https://dl.google.com/go/go${GO_VER}.linux-amd64.tar.gz"
if [ -w /usr/local ]; then
  tar -C /usr/local -xzf "go${GO_VER}.linux-amd64.tar.gz"
  GO_BIN=/usr/local/go/bin
else
  mkdir -p ~/goroot
  tar -C ~/goroot -xzf "go${GO_VER}.linux-amd64.tar.gz"
  GO_BIN=~/goroot/go/bin
fi
export PATH="$GO_BIN:$PATH"
go version

# Module proxy: proxy.golang.org stalls from some networks — goproxy.cn mirror
# is the verified-working fallback (set globally or per-shell).
export GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
export GOSUMDB="${GOSUMDB:-sum.golang.google.cn}"

# ─── Rust ───────────────────────────────────────────────────────────────────
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --profile minimal --default-toolchain stable
# shellcheck source=/dev/null
. "$HOME/.cargo/env"
rustc --version

# ─── Native build deps for cargo ────────────────────────────────────────────
# cmake is required by some transitive deps (e.g. rdkafka/aws-lc-sys build
# scripts). Without root access, `pip install cmake` provides the binary.
command -v cmake >/dev/null || pip install cmake
export PATH="$HOME/.local/bin:$PATH"

# ─── Build commands (verified) ──────────────────────────────────────────────
# Go:   per module dir: go mod download && go build ./...
#       gateway-service, services/middleware-hub, services/mojaloop-adapter,
#       journey-orchestrator, services/channel-gateway, services/trading-engine,
#       services/market-data
# Rust: per crate dir:  cargo check -j 2
#       settlement-engine, services/ussd-engine, matching-engine,
#       services/crypto-guard, nexcom-tools/schema-diff
#       (credit-scoring + blockchain have PRE-EXISTING upstream errors —
#        see COMPILE-FIX/MANIFEST.md)
