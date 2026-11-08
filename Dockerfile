# Operator-only deployment: builds run trusted code inside this service, not per-user sandboxes.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium python3 python3-venv python3-dev build-essential tini gosu ca-certificates fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY integrations/fetch/requirements.lock /tmp/fetch-requirements.lock
RUN python3 -m venv /opt/sift-fetch \
    && /opt/sift-fetch/bin/pip install --no-cache-dir -r /tmp/fetch-requirements.lock \
    && mkdir -p /app/.frameshift/fetch \
    && ln -s /opt/sift-fetch /app/.frameshift/fetch/venv
COPY . .
RUN npm run build && chmod +x scripts/docker-entrypoint.sh \
    && mkdir -p /data && chown -R node:node /app /data
ENV NODE_ENV=production EARL_HOSTED=1 FRAMESHIFT_DATA_DIR=/data \
    CHROME_EXECUTABLE_PATH=/usr/bin/chromium PYTHONDONTWRITEBYTECODE=1
EXPOSE 4310
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "scripts/start.mjs"]
