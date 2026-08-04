FROM node:20-bookworm-slim

WORKDIR /app

# Prisma requires OpenSSL to select the correct native query engine.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000

COPY package.json package-lock.json ./

# Prisma's CLI is retained because the container applies migrations on startup.
RUN npm ci --include=dev

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src ./src

RUN npx --no-install prisma generate \
    && chown -R node:node /app

USER node

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 8000}/health`).then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["sh", "-c", "npm run db:deploy && exec npm start"]
