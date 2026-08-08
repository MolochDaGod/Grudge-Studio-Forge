# AI attach checklist (step-by-step)

Printable runbook. Full map: [AI_FLEET_ATTACH_SSOT.md](./AI_FLEET_ATTACH_SSOT.md).

## Step 1 — Docs (done)

- [x] `docs/AI_FLEET_ATTACH_SSOT.md`
- [x] `docs/AI_ATTACH_CHECKLIST.md` (this file)
- [x] Legion `docs/FLEET_ATTACH.md`
- [x] README / DEPLOYMENT / CHANGELOG links

## Step 2 — free-ai ↔ Legion attach (done)

- [x] free-ai `provider=grudge-ai` proxy
- [x] Service binding `LEGION` → `grudge-legion-ai`
- [x] Deploy free-ai **1.5.1**
- [x] Status fields: `grudgeAi`, `legionBinding`, `guestLegionKey`

Smoke:

```bash
curl -s https://forge.grudge-studio.com/api/free-ai/status
# expect: version 1.5.1, legionBinding true, grudgeAi true
```

## Step 3 — Secrets (you / ops)

### 3a Legion free mid-path

```bash
cd F:\GitHub\grudge-ai-hub
# need real gsk_ key from https://console.groq.com/keys
echo YOUR_GSK | npx wrangler secret put GROQ_API_KEY --name grudge-legion-ai
echo YOUR_GSK | npx wrangler secret put GROQ_API_KEY --name grudge-ai-hub
curl -s https://ai.grudge-studio.com/health   # "groq":"configured"
```

### 3b Guest Legion on Forge (optional)

```bash
cd F:\GitHub\Grudge-Studio-Forge\workers\forge-free-ai
# Legion API key from D1 api_keys or internal fleet key
echo YOUR_KEY | npx wrangler secret put GRUDGE_AI_KEY
curl -s https://forge.grudge-studio.com/api/free-ai/status   # guestLegionKey true
```

## Step 4 — Forge SPA (done via GHA)

- [x] Deploy Forge SPA GHA on main (Auto / usage modes)

Smoke: open editor → AI Worker → ⚙ Routing → Usage mode **Auto**.

## Step 4b — Legion context 1.6 (docs + understanding)

- [x] `GET /v1/context` pack (info, GRD/agentic, deploy hardening)
- [x] Roles: `info`, `agentic`, `coder`, `grudachain`, `deploy`, `forge`
- [x] Hub docs `AI_CONTEXT_SSOT.md` · `DEPLOY_HARDENING.md`

```bash
curl -s https://ai.grudge-studio.com/v1/context | head
curl -s https://ai.grudge-studio.com/v1/skills
cd F:\GitHub\grudge-ai-hub && npm run smoke
```

## Step 5 — Agent jobs → Legion (later)

- Expand `POST /api/agent/jobs` kinds to call Legion roles
- Return only CDN-legal asset keys from catalog tools

## Step 6 — Optional CF AI growth (later)

- Vectorize knowledge packs on Legion
- Queue consumers for long bake tools
- Streaming Legion responses through free-ai

## Step 7 — Account + Puter data plane (docs + code)

- [x] [ACCOUNT_PUTER_ENGINE_SSOT.md](./ACCOUNT_PUTER_ENGINE_SSOT.md) — bag vs Puter vs R2
- [x] [PUTER_PATTERNS.md](./PUTER_PATTERNS.md) restored (KV/FS/auth)
- [x] `forgeEnv` Railway account API pointers + puter toolkit URL
- [x] `lib/cloud/accountMirror.ts` — Railway → optional Puter mirror
- [ ] Wire Welcome/UserMenu “Sync account cache” button (SPA)
- [ ] SPA deploy so env snapshot + mirror ship

---

## Auth reminder

| Sign-in | Gives |
|---------|--------|
| **Puter** | Project cloud FS/KV · user-pays AI |
| **Grudge ID** | Legion JWT + Railway bag/wallet/heroes |
| Guest | local projects; fleet Groq if free-ai has keys |

**Engine DB** = Railway only. Puter never sole bag/XP.
