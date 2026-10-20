import { beforeEach, describe, expect, it, vi } from "vitest";

const REQUIRED_ENV = {
  MCP_SERVER_API_KEY: "test-key",
  SF_LOGIN_URL: "https://example.my.salesforce.com",
  SF_CLIENT_ID: "client-id",
  SF_CLIENT_SECRET: "client-secret",
  AGENT_API_BASE_URL: "https://api.salesforce.com",
};

function setEnv(overrides: Record<string, string | undefined> = {}): void {
  for (const [key, value] of Object.entries({ ...REQUIRED_ENV, ...overrides })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  delete process.env.AGENT_REGISTRY_JSON;
  vi.resetModules();
});

describe("agent registry loader", () => {
  it("loads the checked-in default registry when no env override is set", async () => {
    setEnv();
    const { agents } = await import("../src/config/agents.js");
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0]).toHaveProperty("toolName");
  });

  it("prefers AGENT_REGISTRY_JSON over the checked-in file", async () => {
    setEnv({
      AGENT_REGISTRY_JSON: JSON.stringify({
        agents: [
          { name: "a", toolName: "ask_a", agentId: "1", description: "Agent A" },
        ],
      }),
    });
    const { agents } = await import("../src/config/agents.js");
    expect(agents).toEqual([{ name: "a", toolName: "ask_a", agentId: "1", description: "Agent A" }]);
  });

  it("rejects malformed JSON", async () => {
    setEnv({ AGENT_REGISTRY_JSON: "{not json" });
    await expect(import("../src/config/agents.js")).rejects.toThrow(/not valid JSON/);
  });

  it("rejects duplicate toolNames", async () => {
    setEnv({
      AGENT_REGISTRY_JSON: JSON.stringify({
        agents: [
          { name: "a", toolName: "ask_dup", agentId: "1", description: "Agent A" },
          { name: "b", toolName: "ask_dup", agentId: "2", description: "Agent B" },
        ],
      }),
    });
    await expect(import("../src/config/agents.js")).rejects.toThrow(/Duplicate toolName/);
  });

  it("rejects an empty agent list", async () => {
    setEnv({ AGENT_REGISTRY_JSON: JSON.stringify({ agents: [] }) });
    await expect(import("../src/config/agents.js")).rejects.toThrow(/empty/);
  });
});
