FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    ONNXTR_CACHE_DIR=/app/.models_cache

WORKDIR /app

# Runtime dependencies for headless OCR/image processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies (includes onnxtr[cpu-headless] for CPU-only OCR)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Preload OnnxTR models into image layer to avoid cold-start downloads.
COPY preload.py ./
RUN mkdir -p "${ONNXTR_CACHE_DIR}" && python preload.py

# Copy application code
COPY src/ ./

# Run as non-root user
RUN useradd --create-home --shell /bin/bash worker && chown -R worker:worker /app
USER worker

ENTRYPOINT ["python", "main.py"]
