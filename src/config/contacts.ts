import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { env } from "./env.js";

const contactConfigSchema = z.object({
  email: z.string().email(),
  contactId: z.string().min(1),
  name: z.string().min(1),
});

const registrySchema = z.object({
  contacts: z.array(contactConfigSchema),
});

export type ContactConfig = z.infer<typeof contactConfigSchema>;

// Same cwd reasoning as agents.ts - works under both `tsx watch` (dev) and the Heroku Procfile.
const DEFAULT_REGISTRY_PATH = path.resolve(process.cwd(), "src/config/contacts.registry.json");

function readRegistryJson(): string {
  if (env.CONTACTS_REGISTRY_JSON) {
    return env.CONTACTS_REGISTRY_JSON;
  }
  return readFileSync(DEFAULT_REGISTRY_PATH, "utf-8");
}

function loadContacts(): Map<string, ContactConfig> {
  const raw = readRegistryJson();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Contacts registry is not valid JSON: ${(err as Error).message}`);
  }

  const result = registrySchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid contacts registry: ${issues}`);
  }

  const byEmail = new Map<string, ContactConfig>();
  for (const contact of result.data.contacts) {
    byEmail.set(contact.email.toLowerCase(), contact);
  }
  return byEmail;
}

const contactsByEmail: Map<string, ContactConfig> = loadContacts();

export function findContactByEmail(email: string): ContactConfig | undefined {
  return contactsByEmail.get(email.toLowerCase());
}
