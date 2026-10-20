import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { agents } from "../config/agents.js";
import { registerAgentTool } from "./toolFactory.js";

export function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: "boldgroup-agentforce-mcp-server",
    version: "0.1.0",
  });

  for (const agent of agents) {
    registerAgentTool(server, agent);
  }

  return server;
}
