import { randomUUID } from "node:crypto";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { port } from "./config/env.js";
import { agents } from "./config/agents.js";
import { buildMcpServer } from "./mcp/server.js";
import { endAllSessionsForMcpSession } from "./mcp/toolFactory.js";
import { clearAllForMcpSession } from "./mcp/sessionStore.js";
import { requireApiKey } from "./auth/inboundAuth.js";
import { logger } from "./util/logger.js";

const app = express();
app.use(express.json());

const transports = new Map<string, StreamableHTTPServerTransport>();

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok", agents: agents.map((a) => a.toolName) });
});

app.post("/mcp", requireApiKey, async (req, res) => {
  const sessionIdHeader = req.header("mcp-session-id");
  let transport: StreamableHTTPServerTransport | undefined = sessionIdHeader
    ? transports.get(sessionIdHeader)
    : undefined;

  if (!transport) {
    if (sessionIdHeader || !isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: no valid session and not an initialize request" },
        id: null,
      });
      return;
    }

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        transports.set(sessionId, transport as StreamableHTTPServerTransport);
        logger.info("MCP session initialized", { sessionId });
      },
    });

    transport.onclose = () => {
      const sessionId = transport?.sessionId;
      if (!sessionId) return;
      transports.delete(sessionId);
      void endAllSessionsForMcpSession(agents, sessionId);
      clearAllForMcpSession(sessionId);
      logger.info("MCP session closed", { sessionId });
    };

    const server = buildMcpServer();
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

async function handleSessionRequest(req: express.Request, res: express.Response): Promise<void> {
  const sessionId = req.header("mcp-session-id");
  const transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    res.status(400).send("Invalid or missing MCP session ID");
    return;
  }

  await transport.handleRequest(req, res);
}

app.get("/mcp", requireApiKey, handleSessionRequest);
app.delete("/mcp", requireApiKey, handleSessionRequest);

const httpServer = app.listen(port, () => {
  logger.info("MCP server listening", { port, agents: agents.map((a) => a.toolName) });
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down");
  for (const transport of transports.values()) {
    transport.close();
  }
  httpServer.close(() => process.exit(0));
});
