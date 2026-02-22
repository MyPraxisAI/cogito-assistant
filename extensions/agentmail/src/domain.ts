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

  const result = await client.domains.create({ domain: params.domain });
  return {
    domainId: result.domainId ?? result.domain_id,
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

  const result = await client.domains.verify(params.domainId);
  return {
    verified: result.status === "verified",
    status: result.status,
  };
}
