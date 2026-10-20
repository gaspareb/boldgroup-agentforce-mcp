import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentConfig } from "../config/agents.js";
import { endSession, sendMessage } from "../salesforce/agentApiClient.js";
import { getAgentSessionId, setAgentSessionId } from "./sessionStore.js";
import { logger } from "../util/logger.js";

const FALLBACK_SESSION_KEY = "no-mcp-session";

async function askAgent(
  agent: AgentConfig,
  mcpSessionId: string,
  message: string,
  email: string | undefined,
): Promise<string> {
  const sessionId = getAgentSessionId(mcpSessionId, agent.agentId);
  const reply = await sendMessage(agent.agentId, sessionId, message, email);
  setAgentSessionId(mcpSessionId, agent.agentId, reply.sessionId);
  return reply.text;
}

export function registerAgentTool(server: McpServer, agent: AgentConfig): void {
  server.tool(
    agent.toolName,
    agent.description,
    {
      message: z.string().min(1).describe("The message to send to this Agentforce agent"),
      email: z
        .string()
        .email()
        .optional()
        .describe(
          "The customer's email address, if known. Pass this whenever you know who you're " +
            "talking to - it gives the agent the customer identity it needs for anything " +
            "order/account-specific (e.g. looking up or modifying an order). Omit if unknown.",
        ),
    },
    async ({ message, email }, extra) => {
      const mcpSessionId = (extra as { sessionId?: string }).sessionId ?? FALLBACK_SESSION_KEY;

      try {
        const reply = await askAgent(agent, mcpSessionId, message, email);
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
