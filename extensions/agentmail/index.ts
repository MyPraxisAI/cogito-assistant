import type { AnyAgentTool, ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { agentmailPlugin } from "./src/channel.js";
import { setAgentMailRuntime } from "./src/runtime.js";
import { AgentMailInboxToolSchema, executeAgentMailInboxTool } from "./src/tools.js";

const plugin = {
  id: "agentmail",
  name: "AgentMail",
  description: "Email channel via AgentMail API",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setAgentMailRuntime(api.runtime);
    api.registerChannel({ plugin: agentmailPlugin as ChannelPlugin });

    api.registerTool({
      name: "agentmail_inbox",
      label: "AgentMail Inbox",
      description:
        "Read emails from your AgentMail inbox. " +
        "Actions: list (recent messages with sender, subject, preview) or read (full message content by messageId).",
      parameters: AgentMailInboxToolSchema,
      execute: executeAgentMailInboxTool,
    } as AnyAgentTool);
  },
};

export default plugin;
