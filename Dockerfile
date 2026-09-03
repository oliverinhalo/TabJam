# =============================================================================
# TabJam production image
#
# Stage 1 installs dependencies once, builds all three workspaces, then reduces
# the dependency tree to what the server actually needs at runtime. Stage 2 just
# copies the result — it never runs an install of its own, which keeps the two
# stages from running npm concurrently and roughly halves the build time.
# =============================================================================

# --- Stage 1: build ---------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Manifests first, so this layer is cached until a dependency actually changes.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --no-audit --no-fund

# Then the sources.
COPY shared ./shared
COPY backend ./backend
COPY frontend ./frontend

# shared -> backend -> frontend, in that order.
RUN npm run build

# Drop devDependencies now that everything is compiled. What remains is the
# tree the runtime stage copies verbatim.
RUN npm prune --omit=dev --no-audit --no-fund

# --- Stage 2: runtime -------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/public \
    LIBRARY_DIR=/app/data/library

WORKDIR /app

# npm workspaces link @tabjam/* as symlinks into node_modules, so each workspace
# directory has to exist for those links to resolve — hence the package.json
# files alongside the compiled output.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/package.json ./frontend/package.json

# The built frontend is served as static files by the same server.
COPY --from=build /app/frontend/dist ./public

RUN mkdir -p /app/data/library && chown -R node:node /app/data
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/dist/index.js"]
