/**
 * Convert markdown agent response to HTML email body.
 */
export function markdownToEmailHtml(markdown: string): string {
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
