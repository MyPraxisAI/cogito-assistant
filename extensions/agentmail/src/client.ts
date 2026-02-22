import { AgentMailClient } from "agentmail";

const clients = new Map<string, AgentMailClient>();

export function getAgentMailClient(apiKey: string): AgentMailClient {
  let client = clients.get(apiKey);
  if (!client) {
    client = new AgentMailClient({ apiKey });
    clients.set(apiKey, client);
  }
  return client;
}
