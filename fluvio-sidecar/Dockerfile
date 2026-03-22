FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Non-root user for security
RUN useradd -r -s /bin/false fluvio
USER fluvio

EXPOSE 9090

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:9090/health')" || exit 1

CMD ["python3", "main.py"]
