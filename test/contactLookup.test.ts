import { describe, expect, it } from "vitest";

process.env.MCP_SERVER_API_KEY = "test-key";
process.env.SF_LOGIN_URL = "https://example.my.salesforce.com";
process.env.SF_CLIENT_ID = "client-id";
process.env.SF_CLIENT_SECRET = "client-secret";
process.env.AGENT_API_BASE_URL = "https://api.salesforce.com";
// contacts.ts loads this once at import time, so it must be set before the dynamic import below.
process.env.CONTACTS_REGISTRY_JSON = JSON.stringify({
  contacts: [{ email: "rjanzen@example.com", contactId: "003xyz", name: "Robert Janzen" }],
});

const { findContactIdByEmail } = await import("../src/salesforce/contactLookup.js");

describe("findContactIdByEmail", () => {
  it("resolves a known email to its ContactId", async () => {
    await expect(findContactIdByEmail("rjanzen@example.com")).resolves.toBe("003xyz");
  });

  it("is case-insensitive", async () => {
    await expect(findContactIdByEmail("RJanzen@Example.com")).resolves.toBe("003xyz");
  });

  it("returns undefined for an unknown email", async () => {
    await expect(findContactIdByEmail("nobody@example.com")).resolves.toBeUndefined();
  });
});
