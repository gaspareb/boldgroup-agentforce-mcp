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
  delete process.env.CONTACTS_REGISTRY_JSON;
  vi.resetModules();
});

describe("contacts registry loader", () => {
  it("loads the checked-in default registry when no env override is set", async () => {
    setEnv();
    const { findContactByEmail } = await import("../src/config/contacts.js");
    expect(findContactByEmail("rjanzen@example.com")).toEqual({
      email: "rjanzen@example.com",
      contactId: "003aj00002EEeqOAAT",
      name: "Robert Janzen",
    });
  });

  it("prefers CONTACTS_REGISTRY_JSON over the checked-in file", async () => {
    setEnv({
      CONTACTS_REGISTRY_JSON: JSON.stringify({
        contacts: [{ email: "a@example.com", contactId: "003aaa", name: "A" }],
      }),
    });
    const { findContactByEmail } = await import("../src/config/contacts.js");
    expect(findContactByEmail("a@example.com")).toEqual({ email: "a@example.com", contactId: "003aaa", name: "A" });
    expect(findContactByEmail("rjanzen@example.com")).toBeUndefined();
  });

  it("allows an empty contacts list", async () => {
    setEnv({ CONTACTS_REGISTRY_JSON: JSON.stringify({ contacts: [] }) });
    const { findContactByEmail } = await import("../src/config/contacts.js");
    expect(findContactByEmail("anyone@example.com")).toBeUndefined();
  });

  it("rejects malformed JSON", async () => {
    setEnv({ CONTACTS_REGISTRY_JSON: "{not json" });
    await expect(import("../src/config/contacts.js")).rejects.toThrow(/not valid JSON/);
  });

  it("rejects an entry with an invalid email", async () => {
    setEnv({
      CONTACTS_REGISTRY_JSON: JSON.stringify({
        contacts: [{ email: "not-an-email", contactId: "003aaa", name: "A" }],
      }),
    });
    await expect(import("../src/config/contacts.js")).rejects.toThrow(/Invalid contacts registry/);
  });
});
