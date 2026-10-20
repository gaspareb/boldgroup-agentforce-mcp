import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.MCP_SERVER_API_KEY = "test-key";
process.env.SF_LOGIN_URL = "https://example.my.salesforce.com";
process.env.SF_CLIENT_ID = "client-id";
process.env.SF_CLIENT_SECRET = "client-secret";
process.env.AGENT_API_BASE_URL = "https://api.salesforce.com";

function fakeJwt(tnk: string): string {
  const header = Buffer.from(JSON.stringify({ tnk, typ: "JWT" })).toString("base64url");
  return `${header}.payload.signature`;
}

vi.mock("../src/salesforce/tokenManager.js", () => ({
  getValidToken: vi.fn(async () => ({
    accessToken: fakeJwt("core/prod/00Dtest00000000000"),
    instanceUrl: "https://x",
  })),
  invalidateToken: vi.fn(),
}));

const { getValidToken, invalidateToken } = await import("../src/salesforce/tokenManager.js");
const { sendMessage, endSession } = await import("../src/salesforce/agentApiClient.js");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("agentApiClient.sendMessage", () => {
  it("creates a session and sends the first message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { sessionId: "sess-1" }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ message: "Hi there" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const reply = await sendMessage("agent-123", undefined, "hello");

    expect(reply).toEqual({ text: "Hi there", sessionId: "sess-1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const createCall = fetchMock.mock.calls[0];
    expect(createCall[0]).toContain("/agents/agent-123/sessions");
    expect(createCall[1].headers["x-sfdc-tenant-id"]).toBe("core/prod/00Dtest00000000000");

    const sendCall = fetchMock.mock.calls[1];
    expect(sendCall[0]).toContain("/sessions/sess-1/messages");
    const sendBody = JSON.parse(sendCall[1].body);
    expect(sendBody.message.sequenceId).toBe(1);
  });

  it("increments sequenceId across messages in the same session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ message: "first" }] }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ message: "second" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await sendMessage("agent-123", "sess-existing", "one");
    await sendMessage("agent-123", "sess-existing", "two");

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBody.message.sequenceId).toBe(1);
    expect(secondBody.message.sequenceId).toBe(2);
  });

  it("retries once on 401 after invalidating the token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: "expired" }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ message: "ok" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const reply = await sendMessage("agent-123", "sess-1", "hello");

    expect(reply.text).toBe("ok");
    expect(invalidateToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("starts a fresh session when the existing one has expired", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, { error: "not found" }))
      .mockResolvedValueOnce(jsonResponse(200, { sessionId: "sess-new" }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ message: "fresh start" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const reply = await sendMessage("agent-123", "sess-stale", "hello");

    expect(reply).toEqual({ text: "fresh start", sessionId: "sess-new" });
  });

  it("surfaces AgentSessionExpiredError type on a 410", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(410, { error: "gone" }))
      .mockResolvedValueOnce(jsonResponse(200, { sessionId: "sess-new-2" }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ message: "ok" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendMessage("agent-123", "sess-gone", "hello")).resolves.toEqual({
      text: "ok",
      sessionId: "sess-new-2",
    });
  });

  it("does not throw when ending a session fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { error: "boom" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(endSession("sess-1")).resolves.toBeUndefined();
    const call = fetchMock.mock.calls[0];
    expect(call[1].headers["x-session-end-reason"]).toBe("UserRequest");
  });

  it("uses the cached token for requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { sessionId: "sess-1" }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ message: "ok" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await sendMessage("agent-123", undefined, "hello");

    expect(getValidToken).toHaveBeenCalled();
  });
});
