FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for OpenCV and PaddleOCR
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx libglib2.0-0 libsm6 libxext6 libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# DOCAI: model caches live on a volume so restarts don't re-download.
#   PADDLEOCR_HOME — PaddleOCR detection/recognition/classification models
#   DOCLING cache  — docling artifacts (HF cache env is honored too)
ENV PADDLEOCR_HOME=/models/paddleocr \
    HF_HOME=/models/huggingface \
    PORT=3002
VOLUME ["/models"]

EXPOSE 3002

CMD ["python", "main.py"]
