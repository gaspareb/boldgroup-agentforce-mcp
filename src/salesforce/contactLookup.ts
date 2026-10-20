import { findContactByEmail } from "../config/contacts.js";

// A live SOQL lookup (`SELECT Id FROM Contact WHERE Email = ...`) was the original approach here,
// but the integration user's "Salesforce Integration" license - the one Client Credentials Flow
// requires - explicitly blocks standard CRM objects (Contact, Account included) regardless of
// permission sets; it's a license-level restriction, not a permission gap. Querying with a
// differently-licensed user would need a second Connected App/integration-user setup, so for this
// demo scope we resolve against a small checked-in registry instead. See contacts.registry.json.
export async function findContactIdByEmail(email: string): Promise<string | undefined> {
  return findContactByEmail(email)?.contactId;
}
