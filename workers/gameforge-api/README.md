# grudge-gameforge-api

Production route: `forge.grudge-studio.com/api/*`

Source of truth for health aliases is the built Hono bundle (see nested historical
`artifacts/api-server` worker). To redeploy after health/source changes:

```bash
# From monorepo api-server worker build, or:
node scripts/patch-api-health.mjs   # if patching an existing dist-worker/index.js
# copy dist-worker/index.js → workers/gameforge-api/index.js
cd workers/gameforge-api && wrangler deploy
```

Secrets (keep with wrangler secret put): DATABASE_URL, AUTH_SECRET, ANTHROPIC_API_KEY, …

**Do not commit index.js** (1.5MB generated bundle).
