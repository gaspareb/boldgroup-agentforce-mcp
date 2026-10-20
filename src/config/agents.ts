import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { env } from "./env.js";

const agentConfigSchema = z.object({
  name: z.string().min(1),
  toolName: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, "toolName must be snake_case, starting with a letter"),
  agentId: z.string().min(1),
  description: z.string().min(1),
});

const registrySchema = z.object({
  agents: z.array(agentConfigSchema),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

// Both `tsx watch src/index.ts` (dev) and `node dist/index.js` (Heroku, via Procfile) run with
// cwd at the mcp-server app root, and the whole repo tree (minus dist/ and node_modules) ships
// in the Heroku slug - so reading the checked-in registry from its source path works in both.
const DEFAULT_REGISTRY_PATH = path.resolve(process.cwd(), "src/config/agents.registry.json");

function readRegistryJson(): string {
  if (env.AGENT_REGISTRY_JSON) {
    return env.AGENT_REGISTRY_JSON;
  }
  return readFileSync(DEFAULT_REGISTRY_PATH, "utf-8");
}

function loadAgents(): AgentConfig[] {
  const raw = readRegistryJson();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Agent registry is not valid JSON: ${(err as Error).message}`);
  }

  const result = registrySchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid agent registry: ${issues}`);
  }

  const { agents } = result.data;
  if (agents.length === 0) {
    throw new Error("Agent registry is empty - at least one agent must be configured");
  }

  const seenToolNames = new Set<string>();
  for (const agent of agents) {
    if (seenToolNames.has(agent.toolName)) {
      throw new Error(`Duplicate toolName in agent registry: ${agent.toolName}`);
    }
    seenToolNames.add(agent.toolName);
  }

  return agents;
}

export const agents: AgentConfig[] = loadAgents();
