# AgentMail Extension Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add email as an OpenClaw channel via AgentMail API — receive, auto-respond, send, thread, and handle attachments.

**Architecture:** New extension at `extensions/agentmail/` following the IRC extension pattern. WebSocket-based inbound via `wss://ws.agentmail.to/v0`, outbound via AgentMail TypeScript SDK. The channel plugin registers with `api.registerChannel()` and uses `dispatchReplyWithBufferedBlockDispatcher` for agent injection.

**Tech Stack:** TypeScript, `agentmail` npm SDK, Zod config schemas, Node 22 native WebSocket, OpenClaw plugin-sdk.

**Reference files** (read these to understand patterns):
- `extensions/irc/src/channel.ts` — full channel plugin definition
- `extensions/irc/src/inbound.ts` — inbound message handling + agent dispatch
- `extensions/irc/src/monitor.ts` — provider monitoring (WebSocket/connection)
- `extensions/irc/src/types.ts` — type definitions
- `extensions/irc/src/accounts.ts` — account resolution
- `extensions/irc/src/config-schema.ts` — Zod config schema
- `extensions/irc/src/runtime.ts` — runtime singleton pattern
- `extensions/irc/src/send.ts` — outbound sending
- `extensions/irc/src/probe.ts` — health check

---

## Task 1: Scaffold Extension Package

**Files:**
- Create: `extensions/agentmail/package.json`
- Create: `extensions/agentmail/openclaw.plugin.json`
- Create: `extensions/agentmail/index.ts`
- Create: `extensions/agentmail/src/runtime.ts`

**Step 1: Create package.json**

```json
{
  "name": "@openclaw/agentmail",
  "version": "2026.2.22",
  "description": "OpenClaw AgentMail email channel plugin",
  "type": "module",
  "dependencies": {
    "agentmail": "latest"
  },
  "devDependencies": {
    "openclaw": "workspace:*"
  },
  "openclaw": {
    "extensions": [
      "./index.ts"
    ]
  }
}
```

**Step 2: Create openclaw.plugin.json**

```json
{
  "id": "agentmail",
  "channels": ["agentmail"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
```

**Step 3: Create runtime.ts** (singleton pattern, copy from `extensions/irc/src/runtime.ts`)

```typescript
import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setAgentMailRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getAgentMailRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("AgentMail runtime not initialized");
  }
  return runtime;
}
```

**Step 4: Create index.ts** (minimal — will fill channel plugin in later tasks)

```typescript
import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { agentmailPlugin } from "./src/channel.js";
import { setAgentMailRuntime } from "./src/runtime.js";

const plugin = {
  id: "agentmail",
  name: "AgentMail",
  description: "Email channel via AgentMail API",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setAgentMailRuntime(api.runtime);
    api.registerChannel({ plugin: agentmailPlugin as ChannelPlugin });
  },
};

export default plugin;
```

**Step 5: Install agentmail dependency**

Run: `cd extensions/agentmail && pnpm install`
Expected: `agentmail` package installed

**Step 6: Commit**

```bash
git add extensions/agentmail/package.json extensions/agentmail/openclaw.plugin.json extensions/agentmail/index.ts extensions/agentmail/src/runtime.ts
git commit --no-verify -m "feat(agentmail): scaffold extension package"
```

---

## Task 2: Types and Config Schema

**Files:**
- Create: `extensions/agentmail/src/types.ts`
- Create: `extensions/agentmail/src/config-schema.ts`

**Step 1: Create types.ts**

Define the config shape, resolved account, probe result, and inbound message types.

```typescript
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
```

**Step 2: Create config-schema.ts**

```typescript
import { DmPolicySchema } from "openclaw/plugin-sdk";
import { z } from "zod";

const AgentMailAccountSchema = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    apiKey: z.string().optional(),
    apiKeyFile: z.string().optional(),
    inboxId: z.string().optional(),
    username: z.string().optional(),
    domain: z.string().optional(),
    dmPolicy: DmPolicySchema,
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    defaultTo: z.string().optional(),
    blockStreaming: z.boolean().optional(),
  })
  .strict();

export const AgentMailConfigSchema = AgentMailAccountSchema.extend({
  accounts: z.record(z.string(), AgentMailAccountSchema).optional(),
}).strict();
```

**Step 3: Commit**

```bash
git add extensions/agentmail/src/types.ts extensions/agentmail/src/config-schema.ts
git commit --no-verify -m "feat(agentmail): add types and config schema"
```

---

## Task 3: Account Resolution

**Files:**
- Create: `extensions/agentmail/src/accounts.ts`

Follow `extensions/irc/src/accounts.ts` pattern. Resolve API key from config, env var, or file.

**Step 1: Create accounts.ts**

```typescript
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
```

**Step 2: Commit**

```bash
git add extensions/agentmail/src/accounts.ts
git commit --no-verify -m "feat(agentmail): add account resolution"
```

---

## Task 4: AgentMail SDK Client Wrapper

**Files:**
- Create: `extensions/agentmail/src/client.ts`

Thin wrapper around AgentMail SDK that creates a client from resolved account config.

**Step 1: Create client.ts**

```typescript
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
```

Note: The `agentmail` SDK import will need to be verified after `pnpm install`. The SDK may export differently — check `node_modules/agentmail` after installation and adjust import if needed.

**Step 2: Commit**

```bash
git add extensions/agentmail/src/client.ts
git commit --no-verify -m "feat(agentmail): add SDK client wrapper"
```

---

## Task 5: Outbound Sending

**Files:**
- Create: `extensions/agentmail/src/send.ts`
- Create: `extensions/agentmail/src/format.ts`

**Step 1: Create format.ts**

Simple markdown-to-HTML and HTML-to-text conversion for emails.

```typescript
/**
 * Convert markdown agent response to HTML email body.
 * Wraps in a basic email-safe HTML template.
 */
export function markdownToEmailHtml(markdown: string): string {
  // Basic markdown → HTML conversion for email
  let html = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.5; color: #333;"><p>${html}</p></div>`;
}

/**
 * Extract clean text from HTML email content.
 * Strips tags, decodes entities, normalizes whitespace.
 */
export function emailHtmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Build inbound message body with email metadata for the agent.
 */
export function formatInboundEmailBody(params: {
  from: string;
  subject: string;
  text: string;
  hasAttachments: boolean;
  attachmentNames?: string[];
}): string {
  const parts: string[] = [];
  parts.push(`Subject: ${params.subject}`);
  if (params.hasAttachments && params.attachmentNames?.length) {
    parts.push(`Attachments: ${params.attachmentNames.join(", ")}`);
  }
  parts.push("");
  parts.push(params.text);
  return parts.join("\n");
}
```

**Step 2: Create send.ts**

```typescript
import { getAgentMailClient } from "./client.js";
import { resolveAgentMailAccount } from "./accounts.js";
import { markdownToEmailHtml } from "./format.js";
import type { CoreConfig } from "./types.js";

export async function sendAgentMailMessage(params: {
  cfg: CoreConfig;
  to: string;
  text: string;
  subject?: string;
  threadId?: string;
  replyToMessageId?: string;
  accountId?: string;
}): Promise<{ messageId: string; threadId: string }> {
  const { cfg, to, text, subject, threadId, replyToMessageId, accountId } = params;
  const account = resolveAgentMailAccount({ cfg, accountId });

  if (!account.configured) {
    throw new Error("AgentMail is not configured (need apiKey and inboxId)");
  }

  const client = getAgentMailClient(account.apiKey);
  const html = markdownToEmailHtml(text);

  // Reply to existing thread
  if (replyToMessageId) {
    const result = await client.inboxes.messages.reply(
      account.inboxId,
      replyToMessageId,
      { text, html },
    );
    return { messageId: result.messageId, threadId: result.threadId };
  }

  // New message
  const result = await client.inboxes.messages.send(account.inboxId, {
    to,
    subject: subject ?? "Message from Cogito",
    text,
    html,
  });
  return { messageId: result.messageId, threadId: result.threadId };
}
```

Note: The AgentMail SDK uses camelCase (`messageId`, `threadId`) — verify after install and adjust if the SDK uses snake_case (`message_id`, `thread_id`).

**Step 3: Commit**

```bash
git add extensions/agentmail/src/format.ts extensions/agentmail/src/send.ts
git commit --no-verify -m "feat(agentmail): add outbound sending and email formatting"
```

---

## Task 6: WebSocket Monitor (Inbound)

**Files:**
- Create: `extensions/agentmail/src/monitor.ts`

This is the core file. Connects to AgentMail WebSocket, receives `message.received` events, and injects them into the OpenClaw agent pipeline.

**Step 1: Create monitor.ts**

Follow `extensions/irc/src/monitor.ts` + `extensions/irc/src/inbound.ts` pattern.

```typescript
import {
  createReplyPrefixOptions,
  logInboundDrop,
  type OpenClawConfig,
  type RuntimeEnv,
} from "openclaw/plugin-sdk";
import { resolveAgentMailAccount } from "./accounts.js";
import { emailHtmlToText, formatInboundEmailBody } from "./format.js";
import { sendAgentMailMessage } from "./send.js";
import { getAgentMailRuntime } from "./runtime.js";
import type { AgentMailInboundMessage, CoreConfig } from "./types.js";

const CHANNEL_ID = "agentmail";

type MonitorOptions = {
  accountId: string;
  config: CoreConfig;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  statusSink?: (patch: Record<string, unknown>) => void;
  onMessage?: (msg: AgentMailInboundMessage) => Promise<void>;
};

function parseWebSocketEvent(data: string): AgentMailInboundMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed.type !== "event" || parsed.event_type !== "message.received") {
      return null;
    }
    const msg = parsed.message;
    if (!msg) return null;

    const text = msg.text?.trim() || emailHtmlToText(msg.html ?? "") || "";
    if (!text) return null;

    return {
      messageId: msg.message_id,
      threadId: msg.thread_id,
      inboxId: msg.inbox_id,
      from: typeof msg.from === "string" ? msg.from : msg.from?.address ?? "",
      fromDisplay: typeof msg.from === "object" ? msg.from?.name : undefined,
      to: Array.isArray(msg.to)
        ? msg.to.map((t: string | { address: string }) =>
            typeof t === "string" ? t : t.address,
          )
        : [String(msg.to)],
      subject: msg.subject ?? "(no subject)",
      text,
      html: msg.html,
      attachments: (msg.attachments ?? []).map(
        (a: { filename: string; content_type: string; size: number; attachment_id: string }) => ({
          filename: a.filename,
          contentType: a.content_type,
          size: a.size,
          attachmentId: a.attachment_id,
        }),
      ),
      timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
      inReplyTo: msg.in_reply_to,
      references: msg.references,
    };
  } catch {
    return null;
  }
}

async function handleAgentMailInbound(params: {
  message: AgentMailInboundMessage;
  config: CoreConfig;
  runtime: RuntimeEnv;
  accountId: string;
  statusSink?: (patch: Record<string, unknown>) => void;
}): Promise<void> {
  const { message, config, runtime, accountId, statusSink } = params;
  const core = getAgentMailRuntime();
  const account = resolveAgentMailAccount({ cfg: config, accountId });

  statusSink?.({ lastInboundAt: message.timestamp });

  // Access control
  const allowFrom = account.config.allowFrom ?? [];
  if (allowFrom.length > 0 && !allowFrom.includes("*")) {
    const senderEmail = message.from.toLowerCase();
    const allowed = allowFrom.some((entry) =>
      String(entry).toLowerCase() === senderEmail,
    );
    if (!allowed) {
      logInboundDrop?.(CHANNEL_ID, message.from, "not in allowFrom");
      return;
    }
  }

  // Resolve routing
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config as OpenClawConfig,
    channel: CHANNEL_ID,
    accountId,
    peer: { kind: "direct", id: message.from },
  });

  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config as OpenClawConfig);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });

  // Format the email body for the agent
  const emailBody = formatInboundEmailBody({
    from: message.fromDisplay || message.from,
    subject: message.subject,
    text: message.text,
    hasAttachments: message.attachments.length > 0,
    attachmentNames: message.attachments.map((a) => a.filename),
  });

  const body = core.channel.reply.formatAgentEnvelope({
    channel: "Email",
    from: message.fromDisplay || message.from,
    timestamp: message.timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: emailBody,
  });

  // Build context payload
  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: emailBody,
    CommandBody: emailBody,
    From: `agentmail:${message.from}`,
    To: `agentmail:${account.inboxId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "direct",
    ConversationLabel: message.fromDisplay || message.from,
    SenderName: message.fromDisplay || message.from.split("@")[0],
    SenderId: message.from,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    MessageSid: message.messageId,
    Timestamp: message.timestamp,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `agentmail:${message.from}`,
    CommandAuthorized: true,
  });

  // Record session
  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`agentmail: failed updating session meta: ${String(err)}`);
    },
  });

  // Dispatch to agent
  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config as OpenClawConfig,
    agentId: route.agentId,
    channel: CHANNEL_ID,
    accountId,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config as OpenClawConfig,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: async (payload) => {
        const text = (payload as { text?: string }).text ?? "";
        if (!text.trim()) return;

        await sendAgentMailMessage({
          cfg: config,
          to: message.from,
          text,
          replyToMessageId: message.messageId,
          accountId,
        });
        statusSink?.({ lastOutboundAt: Date.now() });
        core.channel.activity.record({
          channel: CHANNEL_ID,
          accountId,
          direction: "outbound",
        });
      },
      onError: (err, info) => {
        runtime.error?.(`agentmail ${info.kind} reply failed: ${String(err)}`);
      },
    },
    replyOptions: {
      onModelSelected,
    },
  });
}

export async function monitorAgentMailProvider(opts: MonitorOptions): Promise<{ stop: () => void }> {
  const { accountId, config, runtime, abortSignal, statusSink } = opts;
  const account = resolveAgentMailAccount({ cfg: config, accountId });
  const core = getAgentMailRuntime();

  if (!account.configured) {
    throw new Error(`AgentMail not configured for account "${accountId}"`);
  }

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = 1000;
  const MAX_RECONNECT_DELAY = 60_000;
  let stopped = false;

  function connect() {
    if (stopped || abortSignal.aborted) return;

    const url = `wss://ws.agentmail.to/v0?api_key=${account.apiKey}`;
    ws = new WebSocket(url);

    ws.addEventListener("open", () => {
      reconnectDelay = 1000;
      statusSink?.({ connected: true, lastConnectedAt: Date.now() });
      runtime.info?.(`agentmail [${accountId}]: WebSocket connected`);

      // Subscribe to events for our inbox
      ws?.send(
        JSON.stringify({
          type: "subscribe",
          event_types: ["message.received"],
          inbox_ids: [account.inboxId],
        }),
      );
    });

    ws.addEventListener("message", async (event) => {
      const data = typeof event.data === "string" ? event.data : String(event.data);
      const message = parseWebSocketEvent(data);
      if (!message) return;

      core.channel.activity.record({
        channel: CHANNEL_ID,
        accountId,
        direction: "inbound",
        at: message.timestamp,
      });

      if (opts.onMessage) {
        await opts.onMessage(message);
        return;
      }

      await handleAgentMailInbound({
        message,
        config,
        runtime,
        accountId,
        statusSink,
      });
    });

    ws.addEventListener("close", () => {
      statusSink?.({ connected: false });
      if (!stopped && !abortSignal.aborted) {
        runtime.warn?.(
          `agentmail [${accountId}]: WebSocket closed, reconnecting in ${reconnectDelay}ms`,
        );
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
          connect();
        }, reconnectDelay);
      }
    });

    ws.addEventListener("error", (err) => {
      runtime.error?.(`agentmail [${accountId}]: WebSocket error: ${String(err)}`);
      statusSink?.({ lastError: String(err) });
    });
  }

  // Handle abort signal
  abortSignal.addEventListener("abort", () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  });

  connect();

  return {
    stop: () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
```

**Step 2: Commit**

```bash
git add extensions/agentmail/src/monitor.ts
git commit --no-verify -m "feat(agentmail): add WebSocket inbound monitor with agent dispatch"
```

---

## Task 7: Health Probe

**Files:**
- Create: `extensions/agentmail/src/probe.ts`

**Step 1: Create probe.ts**

```typescript
import { getAgentMailClient } from "./client.js";
import { resolveAgentMailAccount } from "./accounts.js";
import type { AgentMailProbe, CoreConfig } from "./types.js";

export async function probeAgentMail(
  cfg: CoreConfig,
  opts?: { accountId?: string; timeoutMs?: number },
): Promise<AgentMailProbe> {
  const account = resolveAgentMailAccount({ cfg, accountId: opts?.accountId });

  if (!account.apiKey) {
    return { ok: false, error: "no API key configured", inboxId: "", email: "", domain: "" };
  }

  const client = getAgentMailClient(account.apiKey);
  const start = Date.now();

  try {
    const inbox = await client.inboxes.get(account.inboxId);
    const latencyMs = Date.now() - start;

    return {
      ok: true,
      inboxId: account.inboxId,
      email: `${account.username}@${account.domain}`,
      domain: account.domain,
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err),
      inboxId: account.inboxId,
      email: `${account.username}@${account.domain}`,
      domain: account.domain,
      latencyMs: Date.now() - start,
    };
  }
}
```

Note: Verify `client.inboxes.get(inboxId)` is the correct SDK method after install. It may be `client.inboxes.retrieve(inboxId)` or similar — check the SDK exports.

**Step 2: Commit**

```bash
git add extensions/agentmail/src/probe.ts
git commit --no-verify -m "feat(agentmail): add health probe"
```

---

## Task 8: Channel Plugin Definition

**Files:**
- Create: `extensions/agentmail/src/channel.ts`

This assembles all pieces into the `ChannelPlugin` object.

**Step 1: Create channel.ts**

```typescript
import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
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

const CHANNEL_ID = "agentmail";

export const agentmailPlugin: ChannelPlugin<ResolvedAgentMailAccount, AgentMailProbe> = {
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: "AgentMail",
    selectionLabel: "Email (AgentMail)",
    docsPath: "/channels/agentmail",
    blurb: "Send and receive email via AgentMail API",
    order: 90,
    aliases: ["email"],
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
        clearBaseFields: ["name", "apiKey", "apiKeyFile", "inboxId", "username", "domain"],
      }),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      email: `${account.username}@${account.domain}`,
      domain: account.domain,
      credentialSource: account.apiKeySource,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (
        resolveAgentMailAccount({ cfg: cfg as CoreConfig, accountId }).config.allowFrom ?? []
      ).map((entry) => String(entry)),
    resolveDefaultTo: ({ cfg, accountId }) =>
      resolveAgentMailAccount({ cfg: cfg as CoreConfig, accountId }).config.defaultTo?.trim() ||
      undefined,
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(cfg.channels?.agentmail?.accounts?.[resolvedAccountId]);
      const basePath = useAccountPath
        ? `channels.agentmail.accounts.${resolvedAccountId}.`
        : "channels.agentmail.";
      return {
        policy: account.config.dmPolicy ?? "open",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: `${basePath}allowFrom`,
        approveHint: formatPairingApproveHint("agentmail"),
      };
    },
  },
  pairing: {
    idLabel: "email",
    normalizeAllowEntry: (entry) => entry.trim().toLowerCase(),
  },
  messaging: {
    normalizeTarget: (raw) => {
      const trimmed = raw.trim().toLowerCase();
      return trimmed.includes("@") ? trimmed : undefined;
    },
    targetResolver: {
      looksLikeId: (raw) => raw.includes("@"),
      hint: "<email@address>",
    },
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 50_000, // emails can be long
    blockStreaming: true,
    sendText: async ({ cfg, to, text, threadId, accountId }) => {
      const result = await sendAgentMailMessage({
        cfg: cfg as CoreConfig,
        to,
        text,
        threadId: threadId ? String(threadId) : undefined,
        accountId: accountId ?? undefined,
      });
      return { channel: CHANNEL_ID, messageId: result.messageId };
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, accountId, threadId }) => {
      // For now, include media URL in text body
      const combined = mediaUrl ? `${text}\n\nAttachment: ${mediaUrl}` : text;
      const result = await sendAgentMailMessage({
        cfg: cfg as CoreConfig,
        to,
        text: combined,
        threadId: threadId ? String(threadId) : undefined,
        accountId: accountId ?? undefined,
      });
      return { channel: CHANNEL_ID, messageId: result.messageId };
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
      probeAgentMail(cfg as CoreConfig, { accountId: account.accountId, timeoutMs }),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      credentialSource: account.apiKeySource,
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
          `AgentMail not configured for account "${account.accountId}" (need apiKey and inboxId in channels.agentmail).`,
        );
      }
      ctx.log?.info(
        `[${account.accountId}] starting AgentMail provider (${account.username}@${account.domain})`,
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
```

**Step 2: Commit**

```bash
git add extensions/agentmail/src/channel.ts
git commit --no-verify -m "feat(agentmail): add channel plugin definition"
```

---

## Task 9: Register Channel in OpenClaw

**Files:**
- Modify: `src/channels/registry.ts` — add `"agentmail"` to `ChatChannelId` (if needed for core recognition) OR leave as extension-only channel (like msteams)
- Modify: `pnpm-workspace.yaml` — add `extensions/agentmail` to workspace

**Step 1: Check how extensions are discovered**

Read `pnpm-workspace.yaml` to see if there's a wildcard for `extensions/*`. If `extensions/*` is already a workspace pattern, no changes needed there.

Run: `cat pnpm-workspace.yaml`

If `extensions/*` is listed, skip this step. Otherwise add it.

**Step 2: Run pnpm install to register the new workspace package**

Run: `pnpm install`

**Step 3: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml extensions/agentmail/
git commit --no-verify -m "feat(agentmail): register extension in workspace"
```

---

## Task 10: Custom Domain Setup

**Files:**
- Create: `extensions/agentmail/src/domain.ts`

**Step 1: Create domain.ts**

Helper functions for custom domain management.

```typescript
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
```

Note: Verify SDK method names (`client.domains.create`, `client.domains.verify`) after install. Response property names may differ (`domainId` vs `domain_id`).

**Step 2: Commit**

```bash
git add extensions/agentmail/src/domain.ts
git commit --no-verify -m "feat(agentmail): add custom domain management helpers"
```

---

## Task 11: Integration Test — End to End

**Files:**
- Create: `extensions/agentmail/src/monitor.test.ts`

**Step 1: Write integration test for message parsing**

```typescript
import { describe, it, expect } from "vitest";
import { emailHtmlToText, markdownToEmailHtml, formatInboundEmailBody } from "./format.js";

describe("format", () => {
  describe("emailHtmlToText", () => {
    it("strips HTML tags and decodes entities", () => {
      const html = "<p>Hello <strong>world</strong></p><p>&amp; goodbye</p>";
      const text = emailHtmlToText(html);
      expect(text).toContain("Hello world");
      expect(text).toContain("& goodbye");
    });

    it("converts br and p tags to newlines", () => {
      const html = "line1<br>line2</p><p>line3";
      const text = emailHtmlToText(html);
      expect(text).toContain("line1\nline2");
    });
  });

  describe("markdownToEmailHtml", () => {
    it("converts bold markdown to strong tags", () => {
      const md = "Hello **world**";
      const html = markdownToEmailHtml(md);
      expect(html).toContain("<strong>world</strong>");
    });

    it("wraps in styled div", () => {
      const html = markdownToEmailHtml("test");
      expect(html).toContain("font-family");
      expect(html).toContain("<p>");
    });
  });

  describe("formatInboundEmailBody", () => {
    it("includes subject in body", () => {
      const body = formatInboundEmailBody({
        from: "user@test.com",
        subject: "Test Subject",
        text: "Hello there",
        hasAttachments: false,
      });
      expect(body).toContain("Subject: Test Subject");
      expect(body).toContain("Hello there");
    });

    it("lists attachment names when present", () => {
      const body = formatInboundEmailBody({
        from: "user@test.com",
        subject: "Files",
        text: "See attached",
        hasAttachments: true,
        attachmentNames: ["report.pdf", "data.csv"],
      });
      expect(body).toContain("report.pdf");
      expect(body).toContain("data.csv");
    });
  });
});
```

**Step 2: Run test**

Run: `pnpm vitest run extensions/agentmail/src/format.test.ts` (adjust based on project vitest config)
Expected: All tests pass.

**Step 3: Commit**

```bash
git add extensions/agentmail/src/format.test.ts
git commit --no-verify -m "test(agentmail): add format utility tests"
```

---

## Task 12: Configure for Cogito + Custom Domain

This task is manual/interactive — configuring the actual deployment.

**Step 1: Add API key to Cogito config**

SSH into Mac Mini and add to `openclaw.json`:

```json
{
  "channels": {
    "agentmail": {
      "username": "cogito",
      "domain": "agentmail.to",
      "dmPolicy": "open",
      "allowFrom": ["*"]
    }
  }
}
```

Set the API key via environment variable:
```bash
export AGENTMAIL_API_KEY="am_..."
```

**Step 2: Create inbox via AgentMail console or API**

Use the AgentMail console (https://console.agentmail.to/) to create an inbox, then copy the inbox ID to config:

```json
{
  "channels": {
    "agentmail": {
      "inboxId": "<from console>"
    }
  }
}
```

**Step 3: Set up custom domain mypraxis.ai**

1. In AgentMail console or via API: create domain `mypraxis.ai`
2. Get DNS records required
3. Add DNS records via Namecheap (`mcp__namecheap__namecheap_set_dns_hosts`)
4. Verify domain
5. Update config: `"domain": "mypraxis.ai"`

**Step 4: Restart gateway**

```bash
openclaw gateway restart
```

**Step 5: Test by sending email to cogito@mypraxis.ai (or @agentmail.to)**

---

## Dependency Graph

```
Task 1 (scaffold) → Task 2 (types) → Task 3 (accounts) → Task 4 (client)
                                                               ↓
Task 5 (send + format) ← ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
        ↓
Task 6 (monitor) — depends on 3, 4, 5
        ↓
Task 7 (probe) — depends on 3, 4
        ↓
Task 8 (channel.ts) — depends on all above
        ↓
Task 9 (register) — depends on 8
        ↓
Task 10 (domain) — depends on 4
        ↓
Task 11 (tests) — depends on 5
        ↓
Task 12 (deploy) — depends on 9
```
