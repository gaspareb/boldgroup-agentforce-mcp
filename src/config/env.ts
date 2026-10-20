import { z } from "zod";

const envSchema = z.object({
  MCP_SERVER_API_KEY: z.string().min(1, "MCP_SERVER_API_KEY is required"),
  SF_LOGIN_URL: z.string().url(),
  SF_CLIENT_ID: z.string().min(1),
  SF_CLIENT_SECRET: z.string().min(1),
  AGENT_API_BASE_URL: z.string().url(),
  AGENT_REGISTRY_JSON: z.string().optional(),
  CONTACTS_REGISTRY_JSON: z.string().optional(),
  PORT: z.string().optional(),
  NODE_ENV: z.string().optional(),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

export const port = Number(env.PORT ?? 3000);
