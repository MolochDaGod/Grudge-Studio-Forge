# -- Stage 1: Build --
FROM node:24-slim AS build

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Copy workspace config + lockfile for cached installs
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

# Copy all lib packages (api-server depends on db, api-zod, api-spec,
# scene-schema, scene-templates at build time)
COPY lib/ lib/
COPY artifacts/api-server/ artifacts/api-server/

RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production
RUN pnpm --filter @workspace/api-server run build

# -- Stage 2: Runtime --
FROM node:24-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The esbuild bundle is self-contained, but externalized packages
# (@aws-sdk/*, @google-cloud/*, etc.) need their node_modules.
COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/node_modules node_modules

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/api/healthz').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/index.mjs"]
