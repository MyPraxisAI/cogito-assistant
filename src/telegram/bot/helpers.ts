import { formatLocationText, type NormalizedLocation } from "../../channels/location.js";
import type { TelegramAccountConfig } from "../../config/types.telegram.js";
import type {
  TelegramLocation,
  TelegramMessage,
  TelegramStreamMode,
  TelegramVenue,
} from "./types.js";

const TELEGRAM_GENERAL_TOPIC_ID = 1;

export function resolveTelegramForumThreadId(params: {
  isForum?: boolean;
  messageThreadId?: number | null;
}) {
  if (params.isForum && params.messageThreadId == null) {
    return TELEGRAM_GENERAL_TOPIC_ID;
  }
  return params.messageThreadId ?? undefined;
}

/**
 * Build thread params for Telegram API calls (messages, media).
 * General forum topic (id=1) must be treated like a regular supergroup send:
 * Telegram rejects sendMessage/sendMedia with message_thread_id=1 ("thread not found").
 */
export function buildTelegramThreadParams(messageThreadId?: number) {
  if (messageThreadId == null) {
    return undefined;
  }
  const normalized = Math.trunc(messageThreadId);
  if (normalized === TELEGRAM_GENERAL_TOPIC_ID) {
    return undefined;
  }
  return { message_thread_id: normalized };
}

/**
 * Build thread params for typing indicators (sendChatAction).
 * Empirically, General topic (id=1) needs message_thread_id for typing to appear.
 */
export function buildTypingThreadParams(messageThreadId?: number) {
  if (messageThreadId == null) {
    return undefined;
  }
  return { message_thread_id: Math.trunc(messageThreadId) };
}

export function resolveTelegramStreamMode(
  telegramCfg: Pick<TelegramAccountConfig, "streamMode"> | undefined,
): TelegramStreamMode {
  const raw = telegramCfg?.streamMode?.trim().toLowerCase();
  if (raw === "off" || raw === "partial" || raw === "block") return raw;
  return "partial";
}

export function buildTelegramGroupPeerId(chatId: number | string, messageThreadId?: number) {
  return messageThreadId != null ? `${chatId}:topic:${messageThreadId}` : String(chatId);
}

export function buildTelegramGroupFrom(chatId: number | string, messageThreadId?: number) {
  return `telegram:group:${buildTelegramGroupPeerId(chatId, messageThreadId)}`;
}

export function buildSenderName(msg: TelegramMessage) {
  const name =
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ").trim() ||
    msg.from?.username;
  return name || undefined;
}

export function buildSenderLabel(msg: TelegramMessage, senderId?: number | string) {
  const name = buildSenderName(msg);
  const username = msg.from?.username ? `@${msg.from.username}` : undefined;
  let label = name;
  if (name && username) {
    label = `${name} (${username})`;
  } else if (!name && username) {
    label = username;
  }
  const normalizedSenderId =
    senderId != null && `${senderId}`.trim() ? `${senderId}`.trim() : undefined;
  const fallbackId = normalizedSenderId ?? (msg.from?.id != null ? String(msg.from.id) : undefined);
  const idPart = fallbackId ? `id:${fallbackId}` : undefined;
  if (label && idPart) return `${label} ${idPart}`;
  if (label) return label;
  return idPart ?? "id:unknown";
}

export function buildGroupLabel(
  msg: TelegramMessage,
  chatId: number | string,
  messageThreadId?: number,
) {
  const title = msg.chat?.title;
  const topicSuffix = messageThreadId != null ? ` topic:${messageThreadId}` : "";
  if (title) return `${title} id:${chatId}${topicSuffix}`;
  return `group:${chatId}${topicSuffix}`;
}

export function hasBotMention(msg: TelegramMessage, botUsername: string) {
  const text = (msg.text ?? msg.caption ?? "").toLowerCase();
  if (text.includes(`@${botUsername}`)) return true;
  const entities = msg.entities ?? msg.caption_entities ?? [];
  for (const ent of entities) {
    if (ent.type !== "mention") continue;
    const slice = (msg.text ?? msg.caption ?? "").slice(ent.offset, ent.offset + ent.length);
    if (slice.toLowerCase() === `@${botUsername}`) return true;
  }
  return false;
}

export function resolveTelegramReplyId(raw?: string): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

export function describeReplyTarget(msg: TelegramMessage) {
  const reply = msg.reply_to_message;
  if (!reply) return null;
  const replyBody = (reply.text ?? reply.caption ?? "").trim();
  let body = replyBody;
  if (!body) {
    if (reply.photo) body = "<media:image>";
    else if (reply.video) body = "<media:video>";
    else if (reply.audio || reply.voice) body = "<media:audio>";
    else if (reply.document) body = "<media:document>";
    else {
      const locationData = extractTelegramLocation(reply);
      if (locationData) body = formatLocationText(locationData);
    }
  }
  if (!body) return null;
  const sender = buildSenderName(reply);
  const senderLabel = sender ? `${sender}` : "unknown sender";
  return {
    id: reply.message_id ? String(reply.message_id) : undefined,
    sender: senderLabel,
    body,
  };
}

/**
 * Extract forwarded message origin info from Telegram message.
 * Supports both new forward_origin API and legacy forward_from/forward_from_chat fields.
 */
export function describeForwardOrigin(msg: TelegramMessage): {
  source: string;
  date?: number;
} | null {
  const msgAny = msg as unknown as Record<string, unknown>;
  const forwardOrigin = msgAny.forward_origin as
    | {
        type: string;
        sender_user?: { first_name?: string; last_name?: string; username?: string; id?: number };
        sender_user_name?: string;
        sender_chat?: { title?: string; id?: number; username?: string };
        chat?: { title?: string; id?: number; username?: string };
        date?: number;
      }
    | undefined;
  const forwardFrom = msgAny.forward_from as
    | { first_name?: string; last_name?: string; username?: string; id?: number }
    | undefined;
  const forwardFromChat = msgAny.forward_from_chat as
    | { title?: string; id?: number; username?: string; type?: string }
    | undefined;
  const forwardDate = msgAny.forward_date as number | undefined;

  // Try newer forward_origin first
  if (forwardOrigin) {
    let source = "unknown source";
    if (forwardOrigin.type === "user" && forwardOrigin.sender_user) {
      const user = forwardOrigin.sender_user;
      const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
      const username = user.username ? `@${user.username}` : undefined;
      source = name && username ? `${name} (${username})` : name || username || `user:${user.id}`;
    } else if (forwardOrigin.type === "hidden_user" && forwardOrigin.sender_user_name) {
      source = forwardOrigin.sender_user_name;
    } else if (forwardOrigin.type === "chat" && forwardOrigin.sender_chat) {
      const chat = forwardOrigin.sender_chat;
      source = chat.title || (chat.username ? `@${chat.username}` : `chat:${chat.id}`);
    } else if (forwardOrigin.type === "channel" && forwardOrigin.chat) {
      const chat = forwardOrigin.chat;
      source = chat.title || (chat.username ? `@${chat.username}` : `channel:${chat.id}`);
    }
    return { source, date: forwardOrigin.date };
  }

  // Legacy forward_from_chat
  if (forwardFromChat) {
    const chat = forwardFromChat;
    const source = chat.title || (chat.username ? `@${chat.username}` : `chat:${chat.id}`);
    return { source, date: forwardDate };
  }

  // Legacy forward_from
  if (forwardFrom) {
    const user = forwardFrom;
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
    const username = user.username ? `@${user.username}` : undefined;
    const source = name && username ? `${name} (${username})` : name || username || `user:${user.id}`;
    return { source, date: forwardDate };
  }

  return null;
}

export function extractTelegramLocation(msg: TelegramMessage): NormalizedLocation | null {
  const msgWithLocation = msg as {
    location?: TelegramLocation;
    venue?: TelegramVenue;
  };
  const { venue, location } = msgWithLocation;

  if (venue) {
    return {
      latitude: venue.location.latitude,
      longitude: venue.location.longitude,
      accuracy: venue.location.horizontal_accuracy,
      name: venue.title,
      address: venue.address,
      source: "place",
      isLive: false,
    };
  }

  if (location) {
    const isLive = typeof location.live_period === "number" && location.live_period > 0;
    return {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.horizontal_accuracy,
      source: isLive ? "live" : "pin",
      isLive,
    };
  }

  return null;
}
