import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "../util/logger.js";
import { getValidToken, invalidateToken } from "./tokenManager.js";
import { AgentApiError, AgentSessionExpiredError } from "./types.js";

const BASE_PATH = "/einstein/ai-agent/v1";

// Every Agent API v1 call needs the core "c2c tenant key" (format core/<env>/<orgId>), which
// Salesforce already stamps into the JWT's header as the `tnk` claim - decode it from there
// rather than re-deriving/hardcoding the org id and environment ourselves.
function decodeTenantId(accessToken: string): string {
  const [headerSegment] = accessToken.split(".");
  const padded = headerSegment + "=".repeat((4 - (headerSegment.length % 4)) % 4);
  const header = JSON.parse(Buffer.from(padded, "base64url").toString("utf-8")) as { tnk?: string };
  if (!header.tnk) {
    throw new AgentApiError("Access token is missing the tnk (tenant key) claim", 500);
  }
  return header.tnk;
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function request(
  path: string,
  init: { method: string; body?: unknown; extraHeaders?: Record<string, string> },
  attempt = 1,
): Promise<unknown> {
  const token = await getValidToken();
  const { signal, cancel } = withTimeout(30_000);

  let response: Response;
  try {
    response = await fetch(`${env.AGENT_API_BASE_URL}${BASE_PATH}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
        "x-sfdc-tenant-id": decodeTenantId(token.accessToken),
        ...init.extraHeaders,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal,
    });
  } finally {
    cancel();
  }

  if ((response.status === 401 || response.status === 403) && attempt === 1) {
    logger.warn("Agent API auth rejected, invalidating cached token and retrying once");
    invalidateToken();
    return request(path, init, attempt + 1);
  }

  if (response.status === 429 && attempt <= 3) {
    const delayMs = 500 * attempt;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return request(path, init, attempt + 1);
  }

  if (response.status === 404 || response.status === 410) {
    const text = await response.text().catch(() => "");
    throw new AgentSessionExpiredError(text || "Agent session not found or expired");
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new AgentApiError(`Agent API request failed: ${text}`, response.status);
  }

  if (response.status === 204) return undefined;
  return response.json();
}

async function createSession(agentId: string): Promise<string> {
  const data = (await request(`/agents/${agentId}/sessions`, {
    method: "POST",
    body: {
      externalSessionKey: randomUUID(),
      instanceConfig: { endpoint: env.SF_LOGIN_URL },
      bypassUser: true,
      streamingCapabilities: { chunkTypes: ["Text"] },
    },
  })) as { sessionId?: string };

  if (!data.sessionId) {
    throw new AgentApiError("Agent API did not return a sessionId", 500);
  }
  return data.sessionId;
}

interface AgentMessage {
  message?: string;
  text?: string;
}

function extractText(messages: AgentMessage[] | undefined): string {
  const first = messages?.[0];
  const text = first?.message ?? first?.text;
  if (!text) {
    throw new AgentApiError("Agent API response did not contain a message", 500);
  }
  return text;
}

// Agent API v1 requires a per-session, incrementing sequenceId on every message.
const nextSequenceId = new Map<string, number>();

async function sendRawMessage(sessionId: string, text: string): Promise<string> {
  const sequenceId = nextSequenceId.get(sessionId) ?? 1;

  const data = (await request(`/sessions/${sessionId}/messages`, {
    method: "POST",
    body: { message: { type: "Text", text, sequenceId } },
  })) as { messages?: AgentMessage[] };

  nextSequenceId.set(sessionId, sequenceId + 1);
  return extractText(data.messages);
}

async function endSession(sessionId: string): Promise<void> {
  nextSequenceId.delete(sessionId);
  try {
    await request(`/sessions/${sessionId}`, {
      method: "DELETE",
      extraHeaders: { "x-session-end-reason": "UserRequest" },
    });
  } catch (err) {
    // Ending a session is best-effort cleanup; don't let it surface as a tool-call failure.
    logger.warn("Failed to end Agent API session", { sessionId, error: (err as Error).message });
  }
}

export interface AgentReply {
  text: string;
  sessionId: string;
}

export async function sendMessage(
  agentId: string,
  sessionId: string | undefined,
  text: string,
): Promise<AgentReply> {
  let activeSessionId = sessionId ?? (await createSession(agentId));

  try {
    const reply = await sendRawMessage(activeSessionId, text);
    return { text: reply, sessionId: activeSessionId };
  } catch (err) {
    if (err instanceof AgentSessionExpiredError) {
      logger.info("Agent session expired, starting a fresh one", { agentId });
      nextSequenceId.delete(activeSessionId);
      activeSessionId = await createSession(agentId);
      const reply = await sendRawMessage(activeSessionId, text);
      return { text: reply, sessionId: activeSessionId };
    }
    throw err;
  }
}

export { endSession };
