FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY app ./app

ENV PYTHONPATH=/app
ENV SHARE_STORAGE_DATA_DIR=/data

CMD ["uvicorn", "app.asgi:app", "--host", "0.0.0.0", "--port", "8002"]
