# Puter integration patterns

This document is the canonical reference for how Grudge GameForge uses
[Puter](https://puter.com) for auth, cloud storage, AI models, and
publishing. New code that touches Puter should follow these patterns.

## 1. Auth (client)

The editor uses Puter Auth as the **only** real identity source. There
is no local password / cookie / username database — guests get a
local-only display name (kept in `localStorage`) and signed-in users
are identified by `puter.auth.getUser().uuid`.

### Store

`src/store/auth.ts` holds:

```ts
{
  status: "idle" | "anon" | "guest" | "signedIn",
  user: AuthUser | null,
  isPuterSignedIn: boolean,
}
```

`status === "signedIn"` is the publish / cloud / Puter-AI gate. Guest
users get `isPuterSignedIn: false` and Puter-only features render a
"Sign in with Puter" hint.

### Bootstrap

`src/lib/authBootstrap.ts` exposes:

| Fn                       | When to call                                  |
| ------------------------ | ---------------------------------------------- |
| `bootstrapAuth()`        | Once on app mount. Restores any existing session. Never opens a popup. |
| `signInWithPuter()`      | From a user click. Opens Puter's sign-in flow. |
| `continueAsGuest(name?)` | Welcome modal "Continue without signing in".  |
| `renameGuest(name)`      | Guest dropdown rename. No-op for Puter users.  |
| `signOut()`              | Sign-out. Clears local guest record too.       |

The Welcome modal (`src/editor/WelcomeModal.tsx`) appears when
bootstrap finishes with `status === "anon"` and offers both paths.

### Server mirror

`POST /api/auth/puter/sync` (existing) is the **only** way the server
learns about a user. The editor calls it once after a successful Puter
sign-in to ensure the shared `users` table has a row keyed on
`puter_uuid`. The server verifies the token via `verifyPuterToken()`
in `src/lib/puterAuth.ts` — never trust the client's claimed identity.

`POST /api/puter/exchange` is the lightweight variant: it verifies the
token and returns `{uuid, username, email}` **without** touching the
shared identity tables. Use it for non-auth flows (e.g. confirming a
token before stashing it).

## 2. Cloud storage wrapper

Always go through `src/lib/cloud/puterCloud.ts` rather than reaching
into `puter.fs` / `puter.kv` directly. The wrapper handles two things
automatically:

1. **Guest no-op.** Each operation returns
   `{ ok: false, reason: "guest" }` instead of throwing when the user
   isn't signed in. Call sites become `if (r.ok) { … }` instead of
   `try { if (signedIn) … } catch { … }`.
2. **SDK availability.** The Puter SDK loads lazily; the wrapper waits
   for it on first use and surfaces a structured `sdk-unavailable`
   reason if loading fails (corp networks blocking puter.com).

### Path conventions

| Path                                  | Used for                       |
| ------------------------------------- | ------------------------------ |
| `Grudge/projects/<projectId>/scene.json` | Per-project Cloud Save snapshot |
| `Grudge/projects/<projectId>/meta.json`  | Per-project metadata           |
| `Grudge/published/<slug>/scene.json`     | Published scene (public site)  |
| `Grudge/published/<slug>/index.html`     | Public bootstrapper            |

Use `cloud.path("Grudge", "projects", String(projectId), "scene.json")`
to build paths — never hand-concatenate.

### KV index

The cloud-projects list is stored under the `grudge:projects:index`
KV key as `ProjectIndexEntry[]`. KV is a convenience read; the FS
write is the source of truth, so it's safe if KV is unavailable on a
particular SDK build.

## 3. AI providers

`src/lib/ai/providers/` defines a tiny abstraction so the AI Worker can
talk to either:

- **`server-anthropic`** — the existing `POST /api/ai/chat` (Replit AI
  Anthropic proxy). Default for new projects.
- **`puter`** — `POST /api/ai/chat?provider=puter` with the user's
  `X-Puter-Token` header. The server forwards via Puter's REST surface
  using `puterServerClient.puterChat()` and re-emits the same SSE
  events the client already understands.

Adding a new model is a one-line change in `MODELS` (in
`providers/types.ts`):

```ts
{
  id: "puter:my-model",
  label: "My Model (Puter)",
  hint: "Free via Puter",
  provider: "puter",
  modelId: "my-model",
  requiresPuterAuth: true,
}
```

The AIWorkerPanel picker reads from `MODELS`, persists the selection
in `localStorage` under `grudge.ai.model`, and disables Puter entries
for guest users with a "(sign in)" hint.

### SSE event shape

Both providers emit the same five event types so the tool-loop in
`runConversation` doesn't need to branch:

```ts
{ type: "text_delta", text }
{ type: "text_block", text }
{ type: "tool_use",   id, name, input }
{ type: "stop",       stop_reason }
{ type: "error",      error }
```

The shared parser lives in `providers/sse.ts`.

## 4. Publishing

`src/lib/puterPublish.ts` handles "publish to a free `<sub>.puter.site`
URL". Re-publishing the same scene yields the same subdomain so
bookmarked links keep working. The slug is derived from `sceneId`
(or a content hash for unsaved scratch scenes) — never the scene
**name**, so renaming a saved scene leaves the URL alone.

The Toolbar checks `useAuth(s => s.status === "signedIn")` before
allowing publish. Guests see the gold "Sign in with Puter to publish"
tooltip on hover.

## 5. Puter AI tools

Three tools live at `src/ai/tools/puter/index.ts` and all gate on
`cloud.isAvailable()`:

| Tool                       | What it does                                                |
| -------------------------- | ----------------------------------------------------------- |
| `cloud_save_project`       | Snapshots current scene to `Grudge/projects/<projectId>/`.  |
| `publish_to_puter`         | Wraps `publishScene()`, returns `<sub>.puter.site` URL.     |
| `list_my_puter_projects`   | Lists everything saved via `cloud_save_project`.            |

Guest path: each handler returns
`{ ok: false, error: "Sign in with Puter to …" }` so the model can
surface the prompt to the user verbatim instead of retrying. The
system prompt explicitly tells the model not to retry.

## 6. Common pitfalls

- **Never** call `puter.auth.signIn()` from a non-click handler — the
  Puter popup is blocked otherwise.
- **Never** trust `getUser()` returned over the wire — always verify
  the token server-side via `verifyPuterToken()` before writing to
  shared identity tables.
- **Never** set `crossOrigin` on the Puter SDK script tag (Puter's CDN
  doesn't return CORS headers; any value forces a preflight that
  fails).
- **Never** reach into `puter.fs.write` directly with `overwrite:false`
  — use the cloud wrapper which defaults to `overwrite:true` so
  re-saves don't throw.
