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
