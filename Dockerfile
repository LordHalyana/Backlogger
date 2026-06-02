# ── Stage 1: Install all dependencies (dev + prod) ────────────────────────────
# Use Alpine for both build stages so better-sqlite3's native module is
# compiled for musl libc and can be reused in the lean runtime image.
FROM node:20-alpine AS deps

WORKDIR /app

# Native build toolchain required by better-sqlite3
RUN apk add --no-cache python3 make g++

# Copy workspace manifests first — Docker caches this layer as long as the
# lockfile and package.json files don't change.
COPY package.json package-lock.json ./
COPY packages/shared/package.json  ./packages/shared/
COPY packages/api/package.json     ./packages/api/
COPY packages/web/package.json     ./packages/web/

RUN npm ci


# ── Stage 2: Build all workspaces ─────────────────────────────────────────────
FROM deps AS builder

# Copy only source — node_modules inherited from deps stage via FROM deps
COPY tsconfig.base.json ./
COPY packages/shared    ./packages/shared
COPY packages/api       ./packages/api
COPY packages/web       ./packages/web

# tsc -b (api, shared, web) then vite build (web)
RUN npm run build


# ── Stage 3: Production-only node_modules ─────────────────────────────────────
# Separate stage so dev deps (TypeScript, Vitest, Playwright …) are never
# copied into the runtime image.
FROM node:20-alpine AS prod-deps

WORKDIR /app

# Native toolchain needed to (re-)compile better-sqlite3 for Alpine
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY packages/shared/package.json  ./packages/shared/
COPY packages/api/package.json     ./packages/api/
COPY packages/web/package.json     ./packages/web/

RUN npm ci --omit=dev


# ── Stage 4: Lean runtime image ───────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# ── node_modules (production only, already compiled for Alpine) ────────────────
COPY --from=prod-deps /app/node_modules ./node_modules

# Workspace package.json files are required for the npm workspace symlinks in
# node_modules/@backlogger/* to resolve correctly at runtime.
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/api/package.json    ./packages/api/package.json
COPY --from=builder /app/packages/web/package.json    ./packages/web/package.json
COPY --from=builder /app/package.json                 ./

# ── Compiled outputs ──────────────────────────────────────────────────────────
# Shared library (Node-runnable JS; exports ./dist/index.js in production)
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# API server
COPY --from=builder /app/packages/api/dist      ./packages/api/dist
COPY --from=builder /app/packages/api/templates ./packages/api/templates

# Web frontend (Vite-built static files served by the API via express.static)
COPY --from=builder /app/packages/web/dist ./packages/web/dist

# SQL migration files (applied at startup by openDatabase)
COPY migrations ./migrations

# ── Data volume ───────────────────────────────────────────────────────────────
# The database and user templates live here. Mount external project folders
# under this directory so Backlogger auto-discovers them:
#
#   docker run -v /host/my-project:/app/data/projects/my-project backlogger
#
VOLUME /app/data

# ── Environment defaults ──────────────────────────────────────────────────────
ENV NODE_ENV=production
ENV BACKLOGGER_DATA_DIR=/app/data
ENV BACKLOGGER_PORT=3002
ENV BACKLOGGER_HOST=0.0.0.0
# Lock down CORS in production; use '*' only for trusted LAN deployments.
# ENV BACKLOGGER_ALLOWED_ORIGINS=http://yourhost:3000

EXPOSE 3002

CMD ["node", "packages/api/dist/server.js"]
