# AgentMail OpenClaw Extension — Design

**Date**: 2026-02-22
**Status**: Approved
**Author**: sleontenko + Claude

## Goal

Add email as an OpenClaw channel via AgentMail API. The Cogito agent gets its own email inbox and can:

1. **Receive emails** and auto-respond through the OpenClaw agent (same brain as Telegram/WhatsApp)
2. **Send emails** proactively via agent tools
3. **Thread conversations** — email threads map to OpenClaw conversation threads
4. **Handle attachments** — inbound and outbound
5. **Use custom domain** — `mypraxis.ai` (with fallback to `@agentmail.to`)
6. **Summarize emails** — when no reply is needed, generate a digest
7. **Notify owner** — via existing channels (Telegram) when actionable emails arrive

## Architecture

### Extension Structure

```
extensions/agentmail/
├── package.json
├── openclaw.plugin.json
├── index.ts
└── src/
    ├── channel.ts          # ChannelPlugin definition
    ├── accounts.ts         # Account resolution
    ├── config-schema.ts    # Zod config schema
    ├── types.ts            # TypeScript types
    ├── client.ts           # AgentMail SDK wrapper
    ├── monitor.ts          # WebSocket inbound listener
    ├── send.ts             # Outbound email sending
    ├── probe.ts            # Health/connectivity check
    ├── onboarding.ts       # CLI setup wizard
    ├── format.ts           # Email <-> markdown conversion
    ├── domain.ts           # Custom domain management
    └── runtime.ts          # Runtime singleton
```

### Configuration

In `openclaw.json`:

```json
{
  "channels": {
    "agentmail": {
      "apiKey": "am_...",
      "inboxId": "inbox_123",
      "username": "cogito",
      "domain": "mypraxis.ai",
      "allowFrom": ["*"],
      "dmPolicy": "open"
    }
  }
}
```

Environment variable fallback: `AGENTMAIL_API_KEY`.

### Inbound Flow (WebSocket)

1. `monitor.ts` connects to `wss://ws.agentmail.to/v0?api_key=...`
2. Subscribes to `message.received` for the configured inbox
3. On email receipt: extract from, subject, text/html, attachments, thread_id
4. Convert HTML to clean markdown via `format.ts`
5. Inject into OpenClaw as inbound message (sender = email address)
6. Agent processes and generates reply
7. Reply sent via `outbound.sendText`

Reconnect strategy: exponential backoff (1s, 2s, 4s, ..., max 60s).

### Outbound Flow

1. Agent calls send tool with `to=email@address`
2. `send.ts` converts markdown response to HTML
3. If `threadId` exists: `client.inboxes.messages.reply()`
4. Otherwise: `client.inboxes.messages.send()`
5. Both text and HTML versions included for deliverability

### Capabilities

```typescript
capabilities: {
  chatTypes: ["direct"],
  media: true,        // email attachments
  threads: true,      // email threading
  reactions: false,
  polls: false,
  blockStreaming: true, // send complete response, not streamed
}
```

### Dependencies

- `agentmail` — official TypeScript SDK
- Node 22 native WebSocket (no `ws` package needed)
- OpenClaw `src/markdown/` utilities for text conversion

### Custom Domain Setup

1. Call AgentMail API: `POST /domains` with `mypraxis.ai`
2. API returns required DNS records (SPF, DKIM, MX)
3. Add records via Namecheap DNS (domain registrar)
4. Verify via `POST /domains/{id}/verify`
5. Create inbox on custom domain: `cogito@mypraxis.ai`

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Inbound mechanism | WebSocket | Real-time, no public URL needed, matches WhatsApp Web pattern |
| Extension vs standalone | Extension | Full OpenClaw integration (memory, skills, auto-reply) |
| HTML conversion | Reuse OpenClaw markdown utils | No new dependencies |
| Streaming | Blocked | Email is not a streaming medium |
| Domain | mypraxis.ai (custom) | Brand consistency, fallback to @agentmail.to |

## Scope (MVP = Full)

- Receive emails + auto-respond via OpenClaw agent
- Send emails via agent tools
- Email thread tracking
- Attachment support (inbound + outbound)
- Custom domain (mypraxis.ai)
- Email digest/summary for informational emails
- Owner notifications via Telegram
- CLI onboarding wizard
- Health probe
