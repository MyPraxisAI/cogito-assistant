import { resolveAgentMailAccount } from "./accounts.js";
import { getAgentMailClient } from "./client.js";
import type { AgentMailProbe, CoreConfig } from "./types.js";

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return typeof err === "string" ? err : JSON.stringify(err);
}

export async function probeAgentMail(
  cfg: CoreConfig,
  opts?: { accountId?: string; timeoutMs?: number },
): Promise<AgentMailProbe> {
  const account = resolveAgentMailAccount({ cfg, accountId: opts?.accountId });
  const base: AgentMailProbe = {
    ok: false,
    inboxId: account.inboxId,
    email: `${account.username}@${account.domain}`,
    domain: account.domain,
  };

  if (!account.configured) {
    return {
      ...base,
      error: "missing apiKey or inboxId",
    };
  }

  const started = Date.now();
  try {
    const client = getAgentMailClient(account.apiKey);
    const timeoutMs = opts?.timeoutMs ?? 8000;

    // Use AbortController for timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      await client.inboxes.get(account.inboxId);
    } finally {
      clearTimeout(timer);
    }

    const elapsed = Date.now() - started;
    return {
      ...base,
      ok: true,
      latencyMs: elapsed,
    };
  } catch (err) {
    return {
      ...base,
      error: formatError(err),
    };
  }
}
