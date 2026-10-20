import { env } from "../config/env.js";
import { logger } from "../util/logger.js";
import { SalesforceAuthError, type SalesforceToken } from "./types.js";

let cachedToken: SalesforceToken | null = null;
let inFlightFetch: Promise<SalesforceToken> | null = null;

async function fetchToken(): Promise<SalesforceToken> {
  const url = `${env.SF_LOGIN_URL}/services/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.SF_CLIENT_ID,
    client_secret: env.SF_CLIENT_SECRET,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new SalesforceAuthError(
      `Failed to obtain Salesforce access token (${response.status}): ${text}`,
    );
  }

  const data = (await response.json()) as { access_token?: string; instance_url?: string };
  if (!data.access_token || !data.instance_url) {
    throw new SalesforceAuthError("Salesforce token response missing access_token/instance_url");
  }

  logger.debug("Fetched new Salesforce access token");
  return { accessToken: data.access_token, instanceUrl: data.instance_url };
}

/** Returns a cached token, fetching one on first use. Concurrent callers share one in-flight fetch. */
export async function getValidToken(): Promise<SalesforceToken> {
  if (cachedToken) return cachedToken;

  if (!inFlightFetch) {
    inFlightFetch = fetchToken()
      .then((token) => {
        cachedToken = token;
        return token;
      })
      .finally(() => {
        inFlightFetch = null;
      });
  }

  return inFlightFetch;
}

/** Client-credentials tokens don't hand back a reliable TTL, so callers invalidate reactively on 401/403. */
export function invalidateToken(): void {
  cachedToken = null;
}
