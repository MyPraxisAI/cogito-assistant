import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { CoreConfig, ResolvedAgentMailAccount, AgentMailAccountConfig } from "./types.js";
import { readFileSync } from "node:fs";

function resolveApiKey(config: AgentMailAccountConfig): { apiKey: string; source: string } {
  if (config.apiKey?.trim()) {
    return { apiKey: config.apiKey.trim(), source: "config" };
  }
  if (config.apiKeyFile?.trim()) {
    try {
      const key = readFileSync(config.apiKeyFile.trim(), "utf-8").trim();
      if (key) return { apiKey: key, source: `file:${config.apiKeyFile}` };
    } catch {
      // fall through
    }
  }
  const envKey = process.env.AGENTMAIL_API_KEY?.trim();
  if (envKey) {
    return { apiKey: envKey, source: "env:AGENTMAIL_API_KEY" };
  }
  return { apiKey: "", source: "none" };
}

export function listAgentMailAccountIds(cfg: CoreConfig): string[] {
  const section = cfg.channels?.agentmail;
  if (!section) return [];
  const accountIds = section.accounts ? Object.keys(section.accounts) : [];
  const hasTopLevel = Boolean(section.apiKey || section.apiKeyFile || process.env.AGENTMAIL_API_KEY);
  if (hasTopLevel && !accountIds.includes(DEFAULT_ACCOUNT_ID)) {
    accountIds.unshift(DEFAULT_ACCOUNT_ID);
  }
  return accountIds.length > 0 ? accountIds : [DEFAULT_ACCOUNT_ID];
}

export function resolveDefaultAgentMailAccountId(cfg: CoreConfig): string {
  const ids = listAgentMailAccountIds(cfg);
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

export function resolveAgentMailAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedAgentMailAccount {
  const { cfg, accountId } = params;
  const resolvedId = accountId ?? resolveDefaultAgentMailAccountId(cfg);
  const section = cfg.channels?.agentmail;

  const accountConfig: AgentMailAccountConfig =
    (resolvedId !== DEFAULT_ACCOUNT_ID
      ? section?.accounts?.[resolvedId]
      : undefined) ?? section ?? {};

  const merged: AgentMailAccountConfig = { ...section, ...accountConfig };
  const { apiKey, source: apiKeySource } = resolveApiKey(merged);
  const domain = merged.domain?.trim() || "agentmail.to";
  const username = merged.username?.trim() || "";
  const inboxId = merged.inboxId?.trim() || "";

  return {
    accountId: resolvedId,
    name: merged.name?.trim() || `${username || "agent"}@${domain}`,
    enabled: merged.enabled !== false,
    configured: Boolean(apiKey && inboxId),
    apiKey,
    apiKeySource,
    inboxId,
    username,
    domain,
    config: merged,
  };
}
