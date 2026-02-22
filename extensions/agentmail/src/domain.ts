import { getAgentMailClient } from "./client.js";
import { resolveAgentMailAccount } from "./accounts.js";
import type { CoreConfig } from "./types.js";

export type DomainSetupResult = {
  domainId: string;
  status: string;
  records: Array<{
    type: string;
    name: string;
    value: string;
    priority?: number;
  }>;
};

export async function setupCustomDomain(params: {
  cfg: CoreConfig;
  domain: string;
  accountId?: string;
}): Promise<DomainSetupResult> {
  const account = resolveAgentMailAccount({ cfg: params.cfg, accountId: params.accountId });
  const client = getAgentMailClient(account.apiKey);

  const result = await client.domains.create({
    domain: params.domain,
    feedbackEnabled: true,
  });
  return {
    domainId: result.domainId,
    status: result.status,
    records: result.records ?? [],
  };
}

export async function verifyCustomDomain(params: {
  cfg: CoreConfig;
  domainId: string;
  accountId?: string;
}): Promise<{ verified: boolean; status: string }> {
  const account = resolveAgentMailAccount({ cfg: params.cfg, accountId: params.accountId });
  const client = getAgentMailClient(account.apiKey);

  await client.domains.verify(params.domainId);
  // verify() returns void — fetch the domain to check status
  const domain = await client.domains.get(params.domainId);
  return {
    verified: domain.status === "verified",
    status: domain.status,
  };
}
