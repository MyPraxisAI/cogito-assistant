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
