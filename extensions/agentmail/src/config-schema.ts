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
