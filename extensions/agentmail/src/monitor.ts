import {
  createReplyPrefixOptions,
  type OpenClawConfig,
  type RuntimeEnv,
} from "openclaw/plugin-sdk";
import { resolveAgentMailAccount } from "./accounts.js";
import { emailHtmlToText, formatInboundEmailBody } from "./format.js";
import { getAgentMailRuntime } from "./runtime.js";
import { sendAgentMailMessage } from "./send.js";
import type {
  AgentMailInboundMessage,
  CoreConfig,
} from "./types.js";

const CHANNEL_ID = "agentmail" as const;

export type MonitorOptions = {
  accountId?: string;
  config?: CoreConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  onMessage?: (message: AgentMailInboundMessage) => void | Promise<void>;
};

type WebSocketEvent = {
  type: string;
  event_type?: string;
  event_id?: string;
  message?: {
    inbox_id?: string;
    thread_id?: string;
    message_id?: string;
    from?: string | { address: string; name?: string };
    to?: Array<string | { address: string; name?: string }>;
    subject?: string;
    text?: string;
    html?: string;
    attachments?: Array<{
      filename: string;
      content_type: string;
      size: number;
      attachment_id: string;
    }>;
    timestamp?: string;
    in_reply_to?: string;
    references?: string[];
  };
};

function parseFrom(from: string | { address: string; name?: string } | undefined): {
  address: string;
  display?: string;
} {
  if (!from) return { address: "unknown" };
  if (typeof from === "string") return { address: from };
  return { address: from.address, display: from.name };
}

function parseToList(
  to: Array<string | { address: string; name?: string }> | undefined,
): string[] {
  if (!to) return [];
  return to.map((entry) => (typeof entry === "string" ? entry : entry.address));
}

function parseInboundMessage(event: WebSocketEvent): AgentMailInboundMessage | null {
  const msg = event.message;
  if (!msg?.message_id || !msg.inbox_id) return null;

  const from = parseFrom(msg.from);

  return {
    messageId: msg.message_id,
    threadId: msg.thread_id ?? msg.message_id,
    inboxId: msg.inbox_id,
    from: from.address,
    fromDisplay: from.display,
    to: parseToList(msg.to),
    subject: msg.subject ?? "",
    text: msg.text ?? "",
    html: msg.html,
    attachments: (msg.attachments ?? []).map((a) => ({
      filename: a.filename,
      contentType: a.content_type,
      size: a.size,
      attachmentId: a.attachment_id,
    })),
    timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
    inReplyTo: msg.in_reply_to,
    references: msg.references,
  };
}

async function handleInbound(params: {
  message: AgentMailInboundMessage;
  account: ReturnType<typeof resolveAgentMailAccount>;
  config: CoreConfig;
  runtime: RuntimeEnv;
  statusSink?: MonitorOptions["statusSink"];
}): Promise<void> {
  const { message, account, config, runtime, statusSink } = params;
  const core = getAgentMailRuntime();

  const rawBody =
    message.text?.trim() || (message.html ? emailHtmlToText(message.html) : "");
  if (!rawBody) {
    runtime.log?.(
      `agentmail: skipping message ${message.messageId} from ${message.from} — no text or html content`,
    );
    return;
  }

  statusSink?.({ lastInboundAt: message.timestamp });

  const senderDisplay = message.fromDisplay
    ? `${message.fromDisplay} <${message.from}>`
    : message.from;

  const peerId = message.from;
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config as OpenClawConfig,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: "direct",
      id: peerId,
    },
  });

  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(
    config as OpenClawConfig,
  );
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });

  const emailBody = formatInboundEmailBody({
    from: senderDisplay,
    subject: message.subject,
    text: rawBody,
    hasAttachments: message.attachments.length > 0,
    attachmentNames: message.attachments.map((a) => a.filename),
  });

  const body = core.channel.reply.formatAgentEnvelope({
    channel: "Email",
    from: senderDisplay,
    timestamp: message.timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: emailBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `agentmail:${message.from}`,
    To: `agentmail:${account.inboxId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "direct",
    ConversationLabel: senderDisplay,
    SenderName: message.fromDisplay || message.from,
    SenderId: message.from,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    MessageSid: message.messageId,
    Timestamp: message.timestamp,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `agentmail:${account.inboxId}`,
    CommandAuthorized: false,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`agentmail: failed updating session meta: ${String(err)}`);
    },
  });

  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config as OpenClawConfig,
    agentId: route.agentId,
    channel: CHANNEL_ID,
    accountId: account.accountId,
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
          subject: message.subject
            ? `Re: ${message.subject.replace(/^Re:\s*/i, "")}`
            : undefined,
          replyToMessageId: message.messageId,
          threadId: message.threadId,
          accountId: account.accountId,
        });
        statusSink?.({ lastOutboundAt: Date.now() });
        core.channel.activity.record({
          channel: CHANNEL_ID,
          accountId: account.accountId,
          direction: "outbound",
        });
      },
      onError: (err, info) => {
        runtime.error?.(`agentmail ${info.kind} reply failed: ${String(err)}`);
      },
    },
    replyOptions: {
      onModelSelected,
      disableBlockStreaming:
        typeof account.config.blockStreaming === "boolean"
          ? !account.config.blockStreaming
          : undefined,
    },
  });
}

export async function monitorAgentMailProvider(
  opts: MonitorOptions,
): Promise<{ stop: () => void }> {
  const core = getAgentMailRuntime();
  const cfg = opts.config ?? (core.config.loadConfig() as CoreConfig);
  const account = resolveAgentMailAccount({
    cfg,
    accountId: opts.accountId,
  });

  const runtime: RuntimeEnv = opts.runtime ?? {
    log: (...args: unknown[]) =>
      core.logging.getChildLogger().info(args.map(String).join(" ")),
    error: (...args: unknown[]) =>
      core.logging.getChildLogger().error(args.map(String).join(" ")),
    exit: () => {
      throw new Error("Runtime exit not available");
    },
  };

  if (!account.configured) {
    throw new Error(
      `AgentMail is not configured for account "${account.accountId}" (need apiKey and inboxId in channels.agentmail).`,
    );
  }

  const logger = core.logging.getChildLogger({
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = 1000;
  const MAX_BACKOFF_MS = 60_000;

  function resetBackoff() {
    backoffMs = 1000;
  }

  function nextBackoff(): number {
    const current = backoffMs;
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    return current;
  }

  function connect() {
    if (stopped) return;

    const wsUrl = `wss://ws.agentmail.to/v0?api_key=${account.apiKey}`;
    logger.info(`[${account.accountId}] connecting to AgentMail WebSocket`);

    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      logger.error(`[${account.accountId}] WebSocket creation failed: ${String(err)}`);
      scheduleReconnect();
      return;
    }

    ws.addEventListener("open", () => {
      logger.info(`[${account.accountId}] WebSocket connected`);
      resetBackoff();

      // Subscribe to message events for our inbox
      ws?.send(
        JSON.stringify({
          type: "subscribe",
          event_types: ["message.received"],
          inbox_ids: [account.inboxId],
        }),
      );
    });

    ws.addEventListener("message", async (event) => {
      try {
        const data: WebSocketEvent = JSON.parse(
          typeof event.data === "string" ? event.data : String(event.data),
        );

        if (data.type !== "event" || data.event_type !== "message.received") {
          return;
        }

        const message = parseInboundMessage(data);
        if (!message) {
          logger.debug?.(`[${account.accountId}] ignoring unparseable WebSocket event`);
          return;
        }

        logger.info(
          `[${account.accountId}] received email from ${message.from} — subject: ${message.subject || "(none)"}, text: ${message.text ? message.text.length + " chars" : "empty"}, html: ${message.html ? message.html.length + " chars" : "empty"}`,
        );

        // Skip messages from our own inbox (avoid echo)
        const ownAddress = `${account.username}@${account.domain}`;
        if (
          message.from === ownAddress ||
          message.from.endsWith(`<${ownAddress}>`)
        ) {
          logger.debug?.(`[${account.accountId}] skipping echo from own inbox`);
          return;
        }

        core.channel.activity.record({
          channel: CHANNEL_ID,
          accountId: account.accountId,
          direction: "inbound",
          at: message.timestamp,
        });

        if (opts.onMessage) {
          await opts.onMessage(message);
          return;
        }

        await handleInbound({
          message,
          account,
          config: cfg,
          runtime,
          statusSink: opts.statusSink,
        });
      } catch (err) {
        logger.error(
          `[${account.accountId}] error processing WebSocket message: ${String(err)}`,
        );
      }
    });

    ws.addEventListener("close", (event) => {
      if (stopped) return;
      logger.info(
        `[${account.accountId}] WebSocket closed (code=${event.code}, reason=${event.reason || "none"})`,
      );
      ws = null;
      scheduleReconnect();
    });

    ws.addEventListener("error", (event) => {
      logger.error(
        `[${account.accountId}] WebSocket error: ${String((event as ErrorEvent).message ?? "unknown")}`,
      );
    });
  }

  function scheduleReconnect() {
    if (stopped) return;
    const delay = nextBackoff();
    logger.info(`[${account.accountId}] reconnecting in ${delay}ms`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function stop() {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      try {
        ws.close(1000, "shutdown");
      } catch {
        // ignore close errors
      }
      ws = null;
    }
  }

  // Handle AbortSignal
  if (opts.abortSignal) {
    if (opts.abortSignal.aborted) {
      return { stop };
    }
    opts.abortSignal.addEventListener("abort", () => stop(), { once: true });
  }

  // Start the initial connection
  connect();

  logger.info(
    `[${account.accountId}] AgentMail monitor started for inbox ${account.inboxId} (${account.username}@${account.domain})`,
  );

  return { stop };
}
