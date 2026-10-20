export interface SalesforceToken {
  accessToken: string;
  instanceUrl: string;
}

export class SalesforceAuthError extends Error {}

export class AgentSessionExpiredError extends Error {}

export class AgentApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
