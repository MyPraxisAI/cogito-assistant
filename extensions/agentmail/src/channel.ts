import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
  PAIRING_APPROVED_MESSAGE,
  setAccountEnabledInConfigSection,
  deleteAccountFromConfigSection,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";
import {
  listAgentMailAccountIds,
  resolveDefaultAgentMailAccountId,
  resolveAgentMailAccount,
  type ResolvedAgentMailAccount,
} from "./accounts.js";
import { AgentMailConfigSchema } from "./config-schema.js";
import { monitorAgentMailProvider } from "./monitor.js";
import { probeAgentMail } from "./probe.js";
import { getAgentMailRuntime } from "./runtime.js";
import { sendAgentMailMessage } from "./send.js";
import type { AgentMailProbe, CoreConfig } from "./types.js";

function normalizeEmailTarget(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed.includes("@")) return "";
  return trimmed;
}

function looksLikeEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

export const agentmailPlugin: ChannelPlugin<ResolvedAgentMailAccount, AgentMailProbe> = {
  id: "agentmail",
  meta: {
    id: "agentmail",
    label: "AgentMail",
    selectionLabel: "Email (AgentMail)",
    docsPath: "/channels/agentmail",
    blurb: "Email via AgentMail (agentmail.to)",
    order: 90,
    aliases: ["email"],
    quickstartAllowFrom: true,
  },
  capabilities: {
    chatTypes: ["direct"],
    media: true,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.agentmail"] },
  configSchema: buildChannelConfigSchema(AgentMailConfigSchema),
  config: {
    listAccountIds: (cfg) => listAgentMailAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) =>
      resolveAgentMailAccount({ cfg: cfg as CoreConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultAgentMailAccountId(cfg as CoreConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "agentmail",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "agentmail",
        accountId,
        clearBaseFields: [
          "name",
          "apiKey",
          "apiKeyFile",
          "inboxId",
          "username",
          "domain",
        ],
      }),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      inboxId: account.inboxId,
      email: `${account.username}@${account.domain}`,
      domain: account.domain,
      apiKeySource: account.apiKeySource,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (
        resolveAgentMailAccount({ cfg: cfg as CoreConfig, accountId }).config.allowFrom ??
        []
      ).map((entry) => String(entry)),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => normalizeEmailTarget(String(entry)))
        .filter(Boolean),
    resolveDefaultTo: ({ cfg, accountId }) =>
      resolveAgentMailAccount({ cfg: cfg as CoreConfig, accountId }).config.defaultTo
        ?.trim() || undefined,
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const typedCfg = cfg as CoreConfig;
      const useAccountPath = Boolean(
        typedCfg.channels?.agentmail?.accounts?.[resolvedAccountId],
      );
      const basePath = useAccountPath
        ? `channels.agentmail.accounts.${resolvedAccountId}.`
        : "channels.agentmail.";
      return {
        policy: account.config.dmPolicy ?? "open",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: `${basePath}allowFrom`,
        approveHint: formatPairingApproveHint("agentmail"),
        normalizeEntry: (raw) => normalizeEmailTarget(raw),
      };
    },
  },
  pairing: {
    idLabel: "email",
    normalizeAllowEntry: (entry) => normalizeEmailTarget(entry),
    notifyApproval: async ({ cfg, id }) => {
      const target = normalizeEmailTarget(id);
      if (!target) {
        throw new Error(`invalid AgentMail pairing id: ${id}`);
      }
      await sendAgentMailMessage({
        cfg: cfg as CoreConfig,
        to: target,
        text: PAIRING_APPROVED_MESSAGE,
        subject: "Access Approved",
      });
    },
  },
  messaging: {
    normalizeTarget: normalizeEmailTarget,
    targetResolver: {
      looksLikeId: looksLikeEmail,
      hint: "<email@example.com>",
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) =>
      getAgentMailRuntime().channel.text.chunkMarkdownText(text, limit),
    chunkerMode: "markdown",
    textChunkLimit: 50_000,
    sendText: async ({ to, text, accountId, replyToId, threadId }) => {
      const core = getAgentMailRuntime();
      const cfg = core.config.loadConfig() as CoreConfig;
      const result = await sendAgentMailMessage({
        cfg,
        to,
        text,
        accountId: accountId ?? undefined,
        replyToMessageId: replyToId ?? undefined,
        threadId: threadId != null ? String(threadId) : undefined,
      });
      return {
        channel: "agentmail",
        messageId: result.messageId,
        meta: { threadId: result.threadId },
      };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, replyToId, threadId }) => {
      const core = getAgentMailRuntime();
      const cfg = core.config.loadConfig() as CoreConfig;
      const combined = mediaUrl ? `${text}\n\nAttachment: ${mediaUrl}` : text;
      const result = await sendAgentMailMessage({
        cfg,
        to,
        text: combined,
        accountId: accountId ?? undefined,
        replyToMessageId: replyToId ?? undefined,
        threadId: threadId != null ? String(threadId) : undefined,
      });
      return {
        channel: "agentmail",
        messageId: result.messageId,
        meta: { threadId: result.threadId },
      };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ account, snapshot }) => ({
      configured: snapshot.configured ?? false,
      inboxId: account.inboxId,
      email: `${account.username}@${account.domain}`,
      domain: account.domain,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ cfg, account, timeoutMs }) =>
      probeAgentMail(cfg as CoreConfig, {
        accountId: account.accountId,
        timeoutMs,
      }),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      inboxId: account.inboxId,
      email: `${account.username}@${account.domain}`,
      domain: account.domain,
      apiKeySource: account.apiKeySource,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      probe,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      if (!account.configured) {
        throw new Error(
          `AgentMail is not configured for account "${account.accountId}" (need apiKey and inboxId in channels.agentmail).`,
        );
      }
      ctx.log?.info(
        `[${account.accountId}] starting AgentMail provider (inbox=${account.inboxId}, ${account.username}@${account.domain})`,
      );
      const { stop } = await monitorAgentMailProvider({
        accountId: account.accountId,
        config: ctx.cfg as CoreConfig,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
      });
      return { stop };
    },
  },
};
