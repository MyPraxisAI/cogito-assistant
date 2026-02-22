import { Type } from "@sinclair/typebox";
import { resolveAgentMailAccount } from "./accounts.js";
import { getAgentMailClient } from "./client.js";
import { emailHtmlToText } from "./format.js";
import { getAgentMailRuntime } from "./runtime.js";
import type { CoreConfig } from "./types.js";

const ACTIONS = ["list", "read"] as const;

type AgentToolResult = {
  content: Array<{ type: string; text: string }>;
  details?: unknown;
};

function stringEnum<T extends readonly string[]>(
  values: T,
  options: { description?: string } = {},
) {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    ...options,
  });
}

export const AgentMailInboxToolSchema = Type.Object(
  {
    action: stringEnum(ACTIONS, {
      description: "Action: list (recent messages) or read (specific message)",
    }),
    messageId: Type.Optional(
      Type.String({ description: "Message ID to read (required for 'read' action)" }),
    ),
    limit: Type.Optional(
      Type.Number({ description: "Number of messages to list (default 10, max 50)" }),
    ),
  },
  { additionalProperties: false },
);

type ToolParams = {
  action: (typeof ACTIONS)[number];
  messageId?: string;
  limit?: number;
};

function json(payload: unknown): AgentToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function formatTimestamp(ts: Date | number): string {
  const date = ts instanceof Date ? ts : new Date(ts);
  return date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, " UTC");
}

export async function executeAgentMailInboxTool(
  _toolCallId: string,
  params: ToolParams,
  _signal?: AbortSignal,
  _onUpdate?: unknown,
): Promise<AgentToolResult> {
  try {
    const core = getAgentMailRuntime();
    const cfg = core.config.loadConfig() as CoreConfig;
    const account = resolveAgentMailAccount({ cfg });

    if (!account.configured) {
      throw new Error(
        "AgentMail is not configured (need apiKey and inboxId in channels.agentmail)",
      );
    }

    const client = getAgentMailClient(account.apiKey);

    switch (params.action) {
      case "list": {
        const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
        const response = await client.inboxes.messages.list(account.inboxId, {
          limit,
        });
        const messages = response.messages ?? [];

        if (messages.length === 0) {
          return json({ messages: [], summary: "No messages in inbox." });
        }

        const summary = messages.map((msg) => ({
          messageId: msg.messageId,
          from: msg.from,
          subject: msg.subject || "(no subject)",
          preview: msg.preview?.slice(0, 200) || "",
          timestamp: formatTimestamp(msg.timestamp),
          hasAttachments: (msg.attachments?.length ?? 0) > 0,
          labels: msg.labels,
        }));

        return json({
          count: response.count,
          showing: messages.length,
          messages: summary,
        });
      }

      case "read": {
        if (!params.messageId) {
          throw new Error("messageId is required for 'read' action");
        }

        const msg = await client.inboxes.messages.get(account.inboxId, params.messageId);
        const body = msg.text?.trim() || (msg.html ? emailHtmlToText(msg.html) : "(empty)");

        return json({
          messageId: msg.messageId,
          threadId: msg.threadId,
          from: msg.from,
          to: msg.to,
          cc: msg.cc,
          subject: msg.subject || "(no subject)",
          body,
          timestamp: formatTimestamp(msg.timestamp),
          attachments:
            msg.attachments?.map((a) => ({
              filename: a.filename,
              contentType: a.contentType,
              size: a.size,
            })) ?? [],
          labels: msg.labels,
        });
      }

      default: {
        params.action satisfies never;
        throw new Error(`Unknown action: ${String(params.action)}. Valid actions: list, read`);
      }
    }
  } catch (err) {
    return json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
