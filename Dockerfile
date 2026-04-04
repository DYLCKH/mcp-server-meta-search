# --- Stage 1: Build ---
FROM node:20-slim AS builder

WORKDIR /app

# Enable corepack so pnpm is available
RUN corepack enable && npm install -g pnpm

# Copy workspace root manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Copy all package and app source
COPY packages/ packages/
COPY apps/ apps/

# Install dependencies (frozen lockfile for reproducibility)
RUN pnpm install --frozen-lockfile

# Build all packages and apps
RUN pnpm -r build

# Prune devDependencies from each workspace package
RUN pnpm -r prune --prod

# --- Stage 2: Runtime ---
FROM node:20-slim

WORKDIR /app

# Copy built artifacts from builder stage
COPY --from=builder /app/packages/shared/dist    ./packages/shared/dist
COPY --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules

COPY --from=builder /app/packages/config/dist     ./packages/config/dist
COPY --from=builder /app/packages/config/node_modules ./packages/config/node_modules

COPY --from=builder /app/packages/runtime/dist    ./packages/runtime/dist
COPY --from=builder /app/packages/runtime/node_modules ./packages/runtime/node_modules

COPY --from=builder /app/apps/server/dist         ./apps/server/dist
COPY --from=builder /app/apps/server/node_modules ./apps/server/node_modules

COPY --from=builder /app/apps/web/public          ./apps/web/public

# Root node_modules (hoisted deps)
COPY --from=builder /app/node_modules              ./node_modules

# Workspace manifests needed for module resolution
COPY --from=builder /app/package.json              ./
COPY --from=builder /app/packages/shared/package.json  ./packages/shared/
COPY --from=builder /app/packages/config/package.json   ./packages/config/
COPY --from=builder /app/packages/runtime/package.json  ./packages/runtime/
COPY --from=builder /app/apps/server/package.json       ./apps/server/

ENV NODE_ENV=production

EXPOSE 3000

# Config and database are expected at /app by default;
# override with CONFIG_PATH / LOGS_DB_PATH env vars.
VOLUME ["/app/config.jsonc", "/app/logs"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=5s \
  CMD node -e "const http = require('http'); http.get('http://localhost:3000/healthz', r => { r.statusCode === 200 ? process.exit(0) : process.exit(1); }).on('error', () => process.exit(1));"

CMD ["node", "apps/server/dist/index.js"]
