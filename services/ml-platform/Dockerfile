# NEXCOM ML platform — CPU serving image (port 8015).
# Serves versioned PyTorch models (fraud/credit/price/graph) with A/B + drift
# monitoring. CPU-only: torch is installed from the CPU wheel index.
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    ML_PLATFORM_PORT=8015

WORKDIR /app

# Core deps + CPU-only torch wheel (no CUDA; keeps the image small).
COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt \
        --extra-index-url https://download.pytorch.org/whl/cpu

COPY mlplatform ./mlplatform
COPY configs ./configs
COPY tests ./tests
COPY README.md ./README.md

# Mount points (docker-compose.ml.yml): lakehouse + model registry volumes.
ENV LAKEHOUSE_PATH=/data/lakehouse \
    REGISTRY_PATH=/data/model_registry
RUN mkdir -p /data/lakehouse /data/model_registry

EXPOSE 8015
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8015/health').status==200 else 1)"

# 1 worker: model cache is a process-wide singleton.
CMD ["python", "-m", "mlplatform.serving.app"]
