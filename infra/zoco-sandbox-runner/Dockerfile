FROM python:3.11-slim

RUN useradd --system --uid 10001 --create-home runner \
    && pip install --no-cache-dir fastapi==0.115.6 uvicorn[standard]==0.32.1 docker==7.1.0

WORKDIR /app
COPY app.py /app/app.py

USER 10001:10001
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3)" || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
