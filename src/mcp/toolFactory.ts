import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentConfig } from "../config/agents.js";
import { endSession, sendMessage } from "../salesforce/agentApiClient.js";
import { getAgentSessionId, setAgentSessionId } from "./sessionStore.js";
import { logger } from "../util/logger.js";

const FALLBACK_SESSION_KEY = "no-mcp-session";

async function askAgent(agent: AgentConfig, mcpSessionId: string, message: string): Promise<string> {
  const sessionId = getAgentSessionId(mcpSessionId, agent.agentId);
  const reply = await sendMessage(agent.agentId, sessionId, message);
  setAgentSessionId(mcpSessionId, agent.agentId, reply.sessionId);
  return reply.text;
}

export function registerAgentTool(server: McpServer, agent: AgentConfig): void {
  server.tool(
    agent.toolName,
    agent.description,
    { message: z.string().min(1).describe("The message to send to this Agentforce agent") },
    async ({ message }, extra) => {
      const mcpSessionId = (extra as { sessionId?: string }).sessionId ?? FALLBACK_SESSION_KEY;

      try {
        const reply = await askAgent(agent, mcpSessionId, message);
        return { content: [{ type: "text" as const, text: reply }] };
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        logger.error("Agent tool call failed", { agent: agent.name, error: errMessage });
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to get a response from ${agent.name}: ${errMessage}` }],
        };
      }
    },
  );
}

export async function endAllSessionsForMcpSession(
  agents: AgentConfig[],
  mcpSessionId: string,
): Promise<void> {
  await Promise.all(
    agents.map(async (agent) => {
      const sessionId = getAgentSessionId(mcpSessionId, agent.agentId);
      if (sessionId) await endSession(sessionId);
    }),
  );
}
