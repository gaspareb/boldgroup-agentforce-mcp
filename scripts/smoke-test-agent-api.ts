// Standalone CLI to validate the Salesforce Agent API v1 client against a real BoldGroup agent,
// before any MCP code is involved. Usage: npm run smoke-test -- <agentId> ["message"] [email]
import { endSession, sendMessage } from "../src/salesforce/agentApiClient.js";

async function main(): Promise<void> {
  const agentId = process.argv[2];
  const message = process.argv[3] ?? "Hello, who are you and what can you help with?";
  const email = process.argv[4];

  if (!agentId) {
    console.error('Usage: npm run smoke-test -- <agentId> ["message"] [email]');
    process.exit(1);
  }

  console.log(`Sending message to agent ${agentId}: ${message}${email ? ` (as ${email})` : ""}`);
  const reply = await sendMessage(agentId, undefined, message, email);
  console.log(`Agent reply (sessionId=${reply.sessionId}):`);
  console.log(reply.text);

  console.log("Sending a follow-up in the same session...");
  const followUp = await sendMessage(agentId, reply.sessionId, "Can you say that again, differently?", email);
  console.log(`Agent reply (sessionId=${followUp.sessionId}):`);
  console.log(followUp.text);

  await endSession(followUp.sessionId);
  console.log("Session ended.");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
