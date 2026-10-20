import { describe, expect, it, vi } from "vitest";

process.env.MCP_SERVER_API_KEY = "test-key";
process.env.SF_LOGIN_URL = "https://example.my.salesforce.com";
process.env.SF_CLIENT_ID = "client-id";
process.env.SF_CLIENT_SECRET = "client-secret";
process.env.AGENT_API_BASE_URL = "https://api.salesforce.com";

const { requireApiKey } = await import("../src/auth/inboundAuth.js");

function mockReqRes(opts: { authHeader?: string; queryKey?: string }) {
  const req = {
    header: (name: string) => (name.toLowerCase() === "authorization" ? opts.authHeader : undefined),
    query: opts.queryKey !== undefined ? { key: opts.queryKey } : {},
  };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const next = vi.fn();
  return { req, res, next };
}

describe("requireApiKey", () => {
  it("accepts a valid Bearer header", () => {
    const { req, res, next } = mockReqRes({ authHeader: "Bearer test-key" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requireApiKey(req as any, res as any, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("accepts a valid key via query param when no header is present", () => {
    const { req, res, next } = mockReqRes({ queryKey: "test-key" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requireApiKey(req as any, res as any, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("prefers the header over the query param when both are present", () => {
    const { req, res, next } = mockReqRes({ authHeader: "Bearer test-key", queryKey: "wrong" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requireApiKey(req as any, res as any, next);
    expect(next).toHaveBeenCalled();
  });

  it("rejects a wrong query key", () => {
    const { req, res, next } = mockReqRes({ queryKey: "wrong-key" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requireApiKey(req as any, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects when neither header nor query param is present", () => {
    const { req, res, next } = mockReqRes({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requireApiKey(req as any, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
