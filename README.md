# BoldGroup Agentforce MCP Server

A small MCP (Model Context Protocol) server that bridges Claude — or any MCP client — to
Agentforce agents living in a Salesforce org, so Claude can call them as tools in a conversation.

```
Claude  →  MCP (Streamable HTTP)  →  this server  →  Salesforce Agent API v1  →  Agentforce agent
```

Each agent in `src/config/agents.registry.json` is exposed as one MCP tool (e.g. `ask_simone`).
The server authenticates to Salesforce once via OAuth 2.0 Client Credentials Flow, caches the
token, and maps each MCP client session to its own Agent API session so multi-turn conversations
stay in context.

## Start here

- **[DEPLOYMENT.md](DEPLOYMENT.md)** — step-by-step runbook for setting this up against a new
  org/agent and deploying to Heroku. Every real error we hit building this is called out there as
  a named pitfall, not just the happy path.

## Project layout

```
src/
  index.ts                   # Express app, Streamable HTTP transport, inbound auth, /healthz
  config/
    env.ts                   # env var validation (zod)
    agents.ts                # loads + validates the agent registry
    agents.registry.json     # which agents are exposed, and as what tool names
  auth/inboundAuth.ts         # Bearer-token (or ?key=) auth for inbound MCP clients
  salesforce/
    tokenManager.ts           # OAuth client-credentials token fetch + cache
    agentApiClient.ts         # Agent API v1 client: create/send/end session
    types.ts
  mcp/
    server.ts                 # McpServer, one tool per registry entry
    toolFactory.ts             # agent config -> MCP tool definition + handler
    sessionStore.ts            # MCP session -> Agent API sessionId mapping
  util/logger.ts
scripts/
  smoke-test-agent-api.ts     # standalone CLI to test the Salesforce client without any MCP code
test/
```

## Local development

```bash
npm install
cp .env.example .env    # fill in real values — see DEPLOYMENT.md step 5
npm run dev              # tsx watch, local server on :3000
npm run smoke-test -- <agentId>   # exercise the Salesforce client directly, no MCP involved
npm test                 # vitest
```

## Why Agent API v1, not v2/A2A

Salesforce's newer Agent API v2 speaks the open A2A (Agent2Agent) protocol, which is the more
modern/standard choice — this server was originally built against it. In practice it required an
org-level permission (`AgentApiA2A`) that's pilot/internal-only and has to be explicitly granted,
not something self-serve in Setup. Agent API v1 doesn't have that restriction and is available to
external customers today, so that's what this server actually talks to. If/when the v2 permission
is granted, the Salesforce client layer (`src/salesforce/agentApiClient.ts`) is the only thing that
would need to change — the MCP/tool layer above it doesn't know or care which Agent API version is
underneath.

## Adding another agent

Add an entry to `src/config/agents.registry.json` (`name`, `toolName`, `agentId`, `description`)
and redeploy — or, on Heroku, set the `AGENT_REGISTRY_JSON` Config Var to override the checked-in
file without a redeploy at all (a Config Var change triggers a dyno restart).
