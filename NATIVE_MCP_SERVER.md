# Native Salesforce-Hosted MCP Server (GB Headless 360)

A second, parallel way to get the same capability as the Heroku server in this repo — Agentforce
agents callable from Claude via MCP — but hosted natively inside Salesforce instead of on an
external Node server. This doc covers what it is, how it compares, and how it was set up, since
none of it is code in this repo (it's all declarative Salesforce config).

## What it is

Salesforce's **Hosted MCP Servers** platform ("Headless 360" is the externally-branded name) lets
you create a **custom MCP server** directly in Setup and expose org assets as MCP tools — SObject
operations, Apex, Flows, Prompt Templates, and (the piece we actually wanted) **Agentforce Agents**
themselves. We built one called `GB Headless 360` (API Name `GBHeadless360`) in the BoldGroup org,
containing 7 tools:

| Tool | Type | Purpose |
|---|---|---|
| `ask_simone` | Agentforce Agent | Order management/customer service (Simone3_0) |
| `ask_beverage_selector` | Agentforce Agent | Beverage selector (GB_FB_Agent) |
| Query Records (SOQL) | Generic SObject | Run arbitrary SOQL |
| Search Across Objects (SOSL) | Generic SObject | Cross-object text search |
| Get Related Records | Generic SObject | Traverse relationships from a known record |
| Get Current User Info | Generic SObject | Identity/context of the authenticated user |
| Create Record | Generic SObject | Create a new record |

## How it compares to the Heroku server

| | Heroku server (this repo's code) | Native custom MCP server |
|---|---|---|
| Hosting | External Node app we wrote and deploy | Entirely inside Salesforce, no external infra |
| Auth model | OAuth 2.0 Client Credentials (one fixed service-account identity for every call) | OAuth 2.0 Authorization Code + PKCE (**per-user** — each caller authenticates as themselves) |
| What's exposed | Only what we code (Agent API v1 wrapped per agent) | Agentforce Agents **and** generic SObject/Apex/Flow/Prompt tools, declaratively |
| Availability | Confirmed GA, works today | Confirmed working in this org as of 2026-10-21, but the internal docs (last updated June 2026) still say "test environments only" — verified empirically, not from docs |
| Cost | Heroku dyno cost only | Billed via **Flex Credits** per Salesforce's official docs — worth confirming this is acceptable before investing further |
| Identity/ContactId | Had to build a workaround (optional `email` param → static lookup registry) because the integration user's license blocks Contact/Account entirely | **Unconfirmed** — since auth is per-user rather than a shared service account, it may resolve identity differently. Needs a real test to know whether the same workaround is needed here (see the "Open questions" section below).

## Setup steps performed (so it's reproducible)

1. **Setup → MCP Servers → New** (Custom type). Gave it a label/API name and a description
   (keep under ~250 characters — the field enforces this).
2. **Tools tab → Add Tool**, twice: tool type **Agentforce Agent**, picked `Simone3_0` and
   `GB_FB_Agent` respectively from the agent picker (only agents that exist in the org show up).
3. **Edited each tool** (Edit button on the tool row) to set:
   - **Tool Name** (the actual function name an MCP client sees) — renamed from the generic
     `Simone3_0_1`/`GB_FB_Agent_1` to `ask_simone`/`ask_beverage_selector`, matching the Heroku
     naming for consistency.
   - **Description** — same lesson as the Heroku side applies here: a generic agent description
     isn't enough. `ask_simone`'s description explicitly says to use it for order modifications
     **even if a generic Query/Create Record tool already found the Account/Order**, and explains
     *why* (Activated Orders reject direct field updates; only the agent's own business flow can
     change them) — without that, Claude kept trying to finish the job with the generic tools and
     hit the same platform error we saw on Heroku.
   - **Annotations** — checked **Destructive** on `ask_simone` (it can actually change data;
     clients should confirm before running it), left everything unchecked on
     `ask_beverage_selector` (read-only/no side effects).
4. **Activated** the server (it's created in Draft and must be explicitly activated).
5. **Created an External Client App** for OAuth (Setup → External Client App Manager → New):
   - Enable OAuth, OAuth Scopes: `mcp_api`, `refresh_token`.
   - Security: check PKCE (usually already forced on), check "Issue JWT-based access tokens for
     named users," leave "Require secret for Web Server/Refresh Token Flow" unchecked.
   - **Permitted Users:** left as default "All users can self-authorize" — unlike the Heroku app's
     Client Credentials Flow, this flow has a real interactive user who sees a consent screen, so
     the whole admin-approval dance we fought through on Heroku doesn't apply here.
   - IP Relaxation: set to "Relax IP restrictions," same precaution as before.
6. **Connected from the Claude app**: Settings → Connectors → Add custom connector → URL =
   `https://api.salesforce.com/platform/mcp/v1/d/bold-auto-group/custom/GBHeadless360` →
   authentication = "Sign in now" with the External Client App's Consumer Key/Secret.

## Gotchas

- **Verify the org before building anything.** The custom MCP server's **Server URL** contains the
  org's tenant slug (e.g. `.../d/bold-auto-group/custom/...`) — check this matches your intended
  org before adding tools. We first built the whole thing in the wrong org (a different demo org)
  without noticing until the Server URL gave it away.
- **Callback URL can only hold one value in practice**, despite Salesforce's Callback URL field
  normally accepting multiple URLs on separate lines — adding a second line here produced a
  validation error. If you need to support more than one MCP client (e.g. both Claude Code and the
  Claude app), you'll need a separate External Client App per client, each with its own single
  callback URL.
- **The Claude app's OAuth redirect URI isn't documented alongside Claude Code's/Cursor's/MCP
  Inspector's** — it only surfaces in the actual `redirect_uri_mismatch` error's query string. For
  reference: `https://claude.ai/api/mcp/auth_callback`.
- **Same tool-selection lessons as Heroku apply, in the same org.** Having the generic SObject
  tools and the Agentforce Agent tools on the *same* server doesn't automatically prevent Claude
  from trying the generic ones for a write that needs the agent — the description still has to say
  so explicitly.

## Open questions

- Does the per-user Authorization Code auth model give `ask_simone` real identity context for free
  (since the caller is an actual logged-in Salesforce user), making the Heroku server's
  email→ContactId workaround unnecessary here? Needs a real test against order 110 to confirm —
  not yet verified.
- Confirm Flex Credits billing is actually acceptable for ongoing use of this org before treating
  this as more than a proof of concept.
