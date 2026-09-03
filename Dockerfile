# --- Stage 1: build ---------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies against the lockfile first so this layer caches well.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci

# Then the sources.
COPY shared ./shared
COPY backend ./backend
COPY frontend ./frontend

# shared -> backend -> frontend, in that order.
RUN npm run build

# --- Stage 2: runtime -------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/public \
    LIBRARY_DIR=/app/data/library

WORKDIR /app

# Production dependencies only.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --omit=dev && npm cache clean --force

# Compiled output: backend JS, shared types, and the built frontend as static files.
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/dist ./public

RUN mkdir -p /app/data/library && chown -R node:node /app/data
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/dist/index.js"]
