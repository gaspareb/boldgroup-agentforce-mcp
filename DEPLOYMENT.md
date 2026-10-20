# Deploying the MCP Server to a New Org/Heroku App — Step by Step

A forward-looking runbook for standing this up again: a new Salesforce org, a new Agentforce
agent, a new Heroku app, or all three. Each step notes the pitfall that actually bit us building
this the first time, so you don't rediscover it.

## 0. Prerequisites

- [ ] An Agentforce **Service Agent** (not Employee Agent) already built and activated in the
  target org — Agent API v1 works with Service Agents without extra restriction. If you're not
  sure which type yours is, check Setup → Agents → your agent → Type column.
- [ ] You know the org's real **My Domain** host (`https://<domain>.my.salesforce.com`). Don't
  guess this — see the pitfall in step 5.
- [ ] Node 22.x and the Heroku CLI installed locally (`node --version`, `heroku --version`).
- [ ] A Heroku account, and a **team** to create the app under — Salesforce-internal Heroku
  accounts can't own personal apps; `heroku create` without `--team <name>` fails with
  `Salesforce internal users can't create or own personal apps`. Run `heroku teams` to list yours.

## 1. Create the External Client App (OAuth Client Credentials Flow)

Setup → App Manager → New External Client App.

**App Settings tab:**
- Callback URL: any placeholder (e.g. `https://login.salesforce.com/services/oauth2/success`) —
  Client Credentials Flow never redirects, but the field is required.
- OAuth Scopes — select all of:
  - `Manage user data via APIs (api)`
  - `Perform requests at any time (refresh_token, offline_access)`
  - **`Access the Salesforce API Platform (sfap_api)`** — easy to miss, but this is the scope that
    actually grants entry through the SFAP gateway that Agent API sits behind. Without it, every
    call gets a generic `401 Invalid token` with no indication of which scope is missing.
- Flow Enablement: check **only** "Enable Client Credentials Flow".
- Security: leave everything unchecked **except** check **"Issue JSON Web Token (JWT)-based
  access tokens for named users"**. This one is counterintuitive — plain Connect REST API calls
  work fine without it, but the SFAP gateway behind Agent API rejects the default opaque
  session-style token with `401 Invalid token` / `JWT Token is required`. You need the JWT.

Save.

**Policies tab:**
- Plugin Policies → Permitted Users: set to **"Admin approved users are pre-authorized"**, not the
  default "All users can self-authorize". Client Credentials Flow has no interactive user to click
  "Allow" — leaving this on self-authorize produces `invalid_grant: no client credentials user
  enabled` with no further explanation, and it's **not** about the Run As user being wrong.
- After switching to admin-approved, go to the app's main detail page and add the Run-As user's
  **Profile** to the pre-authorized list (button is usually labeled "Manage Profiles" or similar
  once self-authorize is off).
- OAuth Flows and External Client App Enhancements → check "Enable Client Credentials Flow" here
  too (yes, separately from the App Settings tab checkbox of the same name — both have to be on),
  then set **Run As (Username)** to the integration user from step 2. Select it from the lookup
  picker rather than typing the username as free text — if the user was just created, the picker's
  search index may lag by a minute or two.
- IP Relaxation: set to **"Relax IP restrictions"**. A Heroku dyno doesn't have a static outbound
  IP, so if the Run As user's profile ever gets a Login IP Range, "Enforce IP restrictions" would
  start silently rejecting token requests from Heroku.

Save. If you ever hit `invalid_grant: no client credentials user enabled` again after this is all
set, try toggling "Enable Client Credentials Flow" off → Save → on → re-set Run As → Save — this
forces Salesforce to regenerate the internal association rather than relying on a stale one.

## 2. Create the integration user

Setup → Users → New User.

| Field | Value |
|---|---|
| User License | **Salesforce Integration** — the free, API-only license built for exactly this. Don't leave it on whatever the "New User" page defaults to. |
| Profile | Whatever profile pairs with that license in your org (ours is "Salesforce API Only System Integrations"). |
| Active | Checked |
| All the UI-feature checkboxes (Marketing/Flow/Chat/etc. User) | Unchecked — none apply to an API-only user. |

## 3. Get the Consumer Key/Secret

On the External Client App's detail page → "Manage Consumer Details" (may require a verification
code). Copy the Consumer Key and Consumer Secret — you'll need them for `.env` / Heroku Config
Vars, never commit them.

## 4. Find the Agent's Bot ID

The ID in the Agent Builder URL (`projectId=...`) is **not** the Bot ID the Agent API needs. Get
the real one via SOQL — fastest from your own machine with the Salesforce CLI, since this bypasses
guessing through Setup list views that can show duplicate-looking rows for an agent's version
history:

```bash
sf data query --query "SELECT Id, DeveloperName, MasterLabel FROM BotDefinition" --target-org <your-org-alias>
```

Match on `DeveloperName`, not `MasterLabel` — two unrelated agents (e.g. an old version and a new
one) can share the same display label.

## 5. Local setup and smoke test

```bash
cd mcp-server
npm install
cp .env.example .env
```

Fill in `.env`:
- `SF_LOGIN_URL` — the org's **real** My Domain. **Pitfall:** this is the single thing most likely
  to silently waste your time — a wrong-but-plausible-looking placeholder host here produces the
  exact same `invalid_grant: no client credentials user enabled` error as every actual
  misconfiguration above, with zero indication it's a hostname problem. Verify it in Setup → My
  Domain before assuming anything else is broken.
- `SF_CLIENT_ID` / `SF_CLIENT_SECRET` — from step 3.
- `AGENT_API_BASE_URL` — `https://api.salesforce.com` for a production-tier org (trial orgs count
  as production-tier here). Non-prod environments (`test`/`dev`/`perf`/`stage`.api.salesforce.com)
  are internal-only and unreachable from a Heroku-hosted server without VPN access — if your org
  is a sandbox/orgfarm, this whole approach needs a different network path, not just a different
  hostname.
- `MCP_SERVER_API_KEY` — any random string; this authenticates *inbound* MCP clients to this
  server, unrelated to the Salesforce credentials above.

Sanity-check the raw OAuth exchange before touching any MCP code:

```bash
set -a; source .env; set +a
curl -X POST "$SF_LOGIN_URL/services/oauth2/token" \
  -d grant_type=client_credentials -d client_id="$SF_CLIENT_ID" -d client_secret="$SF_CLIENT_SECRET"
```

A 200 with an `access_token` means steps 1–3 are correct. Decode the token at
[jwt.io](https://jwt.io) (or `python3 -c "import base64,json,sys; ..."` on the payload segment) and
confirm `scp` includes `sfap_api` and `aud` includes `https://api.salesforce.com` — if either is
missing, go back to step 1's scopes.

Then run the real smoke test against your agent:

```bash
npm run smoke-test -- <agentId>
```

This exercises the full `agentApiClient.ts` client (session create → send → follow-up in the same
session → end session) against the live agent, independent of any MCP code.

Edit `src/config/agents.registry.json` with the real agent(s) you want exposed.

## 6. Deploy to Heroku

```bash
heroku create <app-name> --team <your-team>
heroku config:set \
  MCP_SERVER_API_KEY=... SF_LOGIN_URL=... SF_CLIENT_ID=... SF_CLIENT_SECRET=... \
  AGENT_API_BASE_URL=https://api.salesforce.com NODE_ENV=production \
  --app <app-name>
```

This repo keeps `mcp-server/` as a subdirectory of a larger Salesforce DX project, so deploy with
`git subtree push`, not a plain `git push`:

```bash
# from the repo root, NOT from inside mcp-server/
git subtree push --prefix=mcp-server heroku main
```

**Pitfall:** `git subtree push --prefix=X` operates on whatever branch is currently checked out —
if you've been working on another branch (e.g. one you split out for a separate GitHub remote,
see below) and that branch no longer has `mcp-server/` as a subdirectory, you'll get
`fatal: 'mcp-server' does not exist; use 'git subtree add'`. `git checkout main` first.

Verify:

```bash
curl https://<app-name>.herokuapp.com/healthz
heroku logs -n 30 --app <app-name>   # use -n, not --tail, for a one-shot snapshot
```

### If you also want this code in its own GitHub repo

`git subtree push` to a brand-new remote with pre-existing content (e.g. GitHub's own
auto-generated LICENSE/README/.gitignore) will reject as non-fast-forward — the subtree-split
history has no common ancestor with the existing repo. Don't force-push over it; merge instead:

```bash
git remote add github-mcp https://github.com/<you>/<repo>.git
git fetch github-mcp
git subtree split --prefix=mcp-server -b mcp-server-split
git branch gh-merge github-mcp/main
git checkout gh-merge
git merge mcp-server-split --allow-unrelated-histories --no-edit
# resolve any .gitignore conflict by keeping whichever is more thorough, then:
git push github-mcp gh-merge:main
git checkout main   # don't forget this before the next `git subtree push` to Heroku
```

## 7. Test the deployed server end-to-end over the real MCP protocol

A plain `/healthz` 200 only proves the dyno booted — it doesn't prove the Salesforce round-trip
works. Drive the actual protocol:

```bash
API_KEY=$(grep '^MCP_SERVER_API_KEY=' .env | cut -d= -f2)
URL=https://<app-name>.herokuapp.com/mcp

SESSION_ID=$(curl -s -i -X POST "$URL" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke-test","version":"0.0.1"}}}' \
  | grep -i '^mcp-session-id:' | tr -d '\r' | cut -d' ' -f2)

curl -s -X POST "$URL" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -H "mcp-session-id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"<your-tool-name>","arguments":{"message":"hello"}}}'
```

A real text reply from the agent in the response confirms the whole chain: MCP transport → tool
dispatch → OAuth token → Agent API session → the live agent.

## 8. Register the server with an MCP client

**Claude Code:**
```bash
claude mcp add --transport http <name> https://<app-name>.herokuapp.com/mcp \
  --header "Authorization: Bearer $MCP_SERVER_API_KEY"
```

**A Claude app's "Add custom connector" dialog:** some clients' UI only exposes a URL field, with
no way to attach a custom Authorization header — selecting "No sign-in" there sends no auth at
all, which this server will reject. For that case, append the key as a query param instead:
`https://<app-name>.herokuapp.com/mcp?key=<MCP_SERVER_API_KEY>` (the server checks the header
first, falling back to `?key=` — see `src/auth/inboundAuth.ts`). It's the same level of
protection as a header, just carried in the URL. If the app shows a "server requires sign-in"
mismatch warning after you add the query param, re-open the connector and confirm the full URL
(with `?key=...`) actually saved — the detection badge should flip to "No sign-in — Detected"
once it matches.

## Known gotchas, compiled

- `invalid_grant: no client credentials user enabled` → almost always either (a) Permitted Users
  still on self-authorize, (b) the Run As user picker never actually resolved to a real user
  record, or (c) a wrong `SF_LOGIN_URL`. Rarely about the user's permissions.
- `401 Invalid token` at the Agent API layer with everything above correct → missing `sfap_api`
  scope, or (if you're trying Agent API **v2**/A2A specifically) a missing `AgentApiA2A` org
  permission that has to be requested, not self-served — Agent API v2 is pilot/internal-only as of
  this writing, and that gate is unrelated to anything fixable in Setup. Agent API **v1** (what
  this server actually uses) doesn't have that restriction.
- `400 Invalid Headers: ensure the required headers are included` on a v1 call → missing
  `x-sfdc-tenant-id` (format `core/<env>/<orgId>` — this server decodes it from the access token's
  own JWT header rather than hardcoding it, see `decodeTenantId` in `agentApiClient.ts`).
