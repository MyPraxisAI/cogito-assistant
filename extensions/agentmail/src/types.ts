import type { BaseProbeResult } from "openclaw/plugin-sdk";
import type { DmPolicy, OpenClawConfig } from "openclaw/plugin-sdk";

export type AgentMailAccountConfig = {
  name?: string;
  enabled?: boolean;
  apiKey?: string;
  apiKeyFile?: string;
  inboxId?: string;
  username?: string;
  domain?: string;
  dmPolicy?: DmPolicy;
  allowFrom?: Array<string | number>;
  defaultTo?: string;
  blockStreaming?: boolean;
};

export type AgentMailConfig = AgentMailAccountConfig & {
  accounts?: Record<string, AgentMailAccountConfig>;
};

export type CoreConfig = OpenClawConfig & {
  channels?: OpenClawConfig["channels"] & {
    agentmail?: AgentMailConfig;
  };
};

export type ResolvedAgentMailAccount = {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  apiKey: string;
  apiKeySource: string;
  inboxId: string;
  username: string;
  domain: string;
  config: AgentMailAccountConfig;
};

export type AgentMailProbe = BaseProbeResult<string> & {
  inboxId: string;
  email: string;
  domain: string;
  latencyMs?: number;
};

export type AgentMailInboundMessage = {
  messageId: string;
  threadId: string;
  inboxId: string;
  from: string;
  fromDisplay?: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    attachmentId: string;
  }>;
  timestamp: number;
  inReplyTo?: string;
  references?: string[];
};
