# --- Build stage: install all deps (incl. native build tools) and compile TypeScript ---
FROM node:20-slim AS builder
WORKDIR /app

# better-sqlite3 ships prebuilt binaries, but keep build tools available as a fallback.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Runtime stage: slim image, prod deps only, non-root ---
FROM node:20-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
# Reuse the already-built node_modules (keeps the native better-sqlite3 binary), then drop
# dev dependencies.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
RUN npm prune --omit=dev \
  && mkdir -p data \
  && chown -R node:node /app

USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
