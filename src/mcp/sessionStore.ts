// Maps an MCP transport session + agent to the underlying A2A contextId, so repeated tool calls
// within one Claude conversation reuse the same Agentforce conversation instead of starting a
// new one per call. In-memory only - lost on dyno restart, which is an accepted known limitation
// for v1 (worst case: the next call just starts a fresh contextId).
const store = new Map<string, string>();

function key(mcpSessionId: string, agentId: string): string {
  return `${mcpSessionId}:${agentId}`;
}

export function getAgentSessionId(mcpSessionId: string, agentId: string): string | undefined {
  return store.get(key(mcpSessionId, agentId));
}

export function setAgentSessionId(mcpSessionId: string, agentId: string, contextId: string): void {
  store.set(key(mcpSessionId, agentId), contextId);
}

export function clearAllForMcpSession(mcpSessionId: string): void {
  for (const k of store.keys()) {
    if (k.startsWith(`${mcpSessionId}:`)) store.delete(k);
  }
}
