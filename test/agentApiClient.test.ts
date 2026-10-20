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

vi.mock("../src/salesforce/contactLookup.js", () => ({
  findContactIdByEmail: vi.fn(async () => undefined),
}));

const { getValidToken, invalidateToken } = await import("../src/salesforce/tokenManager.js");
const { findContactIdByEmail } = await import("../src/salesforce/contactLookup.js");
const { sendMessage, endSession } = await import("../src/salesforce/agentApiClient.js");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.restoreAllMocks();
  findContactIdByEmail.mockReset().mockResolvedValue(undefined);
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

  it("passes a resolved ContactId as a session variable when email is given", async () => {
    findContactIdByEmail.mockResolvedValue("003xyz");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { sessionId: "sess-email-1" }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ message: "Hi Robert" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const reply = await sendMessage("agent-123", undefined, "what's on order 110?", "rjanzen@example.com");

    expect(reply).toEqual({ text: "Hi Robert", sessionId: "sess-email-1" });
    expect(findContactIdByEmail).toHaveBeenCalledWith("rjanzen@example.com");
    const createBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(createBody.variables).toEqual([{ name: "ContactId", type: "Text", value: "003xyz" }]);
  });

  it("omits the variables field when the email doesn't resolve to a contact", async () => {
    findContactIdByEmail.mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { sessionId: "sess-email-2" }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ message: "ok" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await sendMessage("agent-123", undefined, "hello", "nobody@example.com");

    const createBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(createBody.variables).toBeUndefined();
  });

  it("reuses the session on a later call with the same email", async () => {
    findContactIdByEmail.mockResolvedValue("003xyz");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { sessionId: "sess-email-3" }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ message: "first" }] }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ message: "second" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await sendMessage("agent-123", undefined, "one", "rjanzen@example.com");
    const second = await sendMessage("agent-123", first.sessionId, "two", "rjanzen@example.com");

    expect(second.sessionId).toBe("sess-email-3");
    expect(fetchMock).toHaveBeenCalledTimes(3); // one create, two sends - no second create
  });

  it("starts a fresh session when an email is introduced mid-conversation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { sessionId: "sess-email-4" }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ message: "anonymous reply" }] }))
      .mockResolvedValueOnce(jsonResponse(200, { sessionId: "sess-email-5" }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ message: "identified reply" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const anonymous = await sendMessage("agent-123", undefined, "hi");
    expect(anonymous.sessionId).toBe("sess-email-4");

    findContactIdByEmail.mockResolvedValue("003xyz");
    const identified = await sendMessage("agent-123", anonymous.sessionId, "it's me", "rjanzen@example.com");

    expect(identified.sessionId).toBe("sess-email-5");
    const secondCreateBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(secondCreateBody.variables).toEqual([{ name: "ContactId", type: "Text", value: "003xyz" }]);
  });
});
