###############################################################################
# Grudge Studio Forge — API Server production image
#
# Multi-stage build:
#   1. deps    — install pnpm workspace deps
#   2. build   — build the api-server bundle
#   3. runtime — slim Node image with only the dist output
#
# Usage:
#   docker build -t grudge-forge-api .
#   docker run --env-file .env -p 8080:8080 grudge-forge-api
###############################################################################

# Node 22 LTS + pnpm 10 (pinned to match package.json packageManager)
FROM node:22-slim AS deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/ ./lib/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY scripts/package.json ./scripts/
RUN pnpm install --frozen-lockfile --prod=false

FROM deps AS build
COPY . .
RUN pnpm run typecheck:libs
RUN pnpm --filter @workspace/api-server run build

FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/artifacts/api-server/package.json ./

ENV NODE_ENV=production
ENV PORT=8080
ENV NODE_OPTIONS=--enable-source-maps
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:8080/api/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/index.mjs"]
