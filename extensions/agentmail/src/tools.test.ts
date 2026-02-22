import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeAgentMailInboxTool } from "./tools.js";

// Mock dependencies
vi.mock("./runtime.js", () => ({
  getAgentMailRuntime: vi.fn(() => ({
    config: {
      loadConfig: () => ({
        channels: {
          agentmail: {
            apiKey: "test-key",
            inboxId: "test-inbox",
            username: "cogito",
            domain: "agentmail.to",
          },
        },
      }),
    },
  })),
}));

const mockList = vi.fn();
const mockGet = vi.fn();

vi.mock("./client.js", () => ({
  getAgentMailClient: vi.fn(() => ({
    inboxes: {
      messages: {
        list: mockList,
        get: mockGet,
      },
    },
  })),
}));

describe("agentmail_inbox tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list action", () => {
    it("returns formatted message summaries", async () => {
      mockList.mockResolvedValue({
        count: 2,
        messages: [
          {
            messageId: "msg-1",
            from: "alice@example.com",
            subject: "Hello",
            preview: "Hey there, how are you?",
            timestamp: new Date("2026-02-22T10:00:00Z"),
            attachments: [],
            labels: ["inbox"],
          },
          {
            messageId: "msg-2",
            from: "bob@example.com",
            subject: null,
            preview: undefined,
            timestamp: new Date("2026-02-22T09:00:00Z"),
            attachments: [{ filename: "doc.pdf" }],
            labels: ["inbox"],
          },
        ],
      });

      const result = await executeAgentMailInboxTool("call-1", {
        action: "list",
        limit: 5,
      });

      expect(mockList).toHaveBeenCalledWith("test-inbox", { limit: 5 });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(2);
      expect(parsed.showing).toBe(2);
      expect(parsed.messages[0].messageId).toBe("msg-1");
      expect(parsed.messages[0].from).toBe("alice@example.com");
      expect(parsed.messages[0].subject).toBe("Hello");
      expect(parsed.messages[1].subject).toBe("(no subject)");
      expect(parsed.messages[1].hasAttachments).toBe(true);
    });

    it("returns empty result when no messages", async () => {
      mockList.mockResolvedValue({ count: 0, messages: [] });

      const result = await executeAgentMailInboxTool("call-2", {
        action: "list",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.summary).toBe("No messages in inbox.");
    });

    it("clamps limit to 1-50 range", async () => {
      mockList.mockResolvedValue({ count: 0, messages: [] });

      await executeAgentMailInboxTool("call-3", { action: "list", limit: 100 });
      expect(mockList).toHaveBeenCalledWith("test-inbox", { limit: 50 });

      await executeAgentMailInboxTool("call-4", { action: "list", limit: 0 });
      expect(mockList).toHaveBeenCalledWith("test-inbox", { limit: 1 });
    });
  });

  describe("read action", () => {
    it("returns full message content with text", async () => {
      mockGet.mockResolvedValue({
        messageId: "msg-1",
        threadId: "thread-1",
        from: "alice@example.com",
        to: ["cogito@agentmail.to"],
        cc: [],
        subject: "Hello",
        text: "Hey there, how are you doing?",
        html: "<p>Hey there, how are you doing?</p>",
        timestamp: new Date("2026-02-22T10:00:00Z"),
        attachments: [],
        labels: ["inbox"],
      });

      const result = await executeAgentMailInboxTool("call-5", {
        action: "read",
        messageId: "msg-1",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.messageId).toBe("msg-1");
      expect(parsed.from).toBe("alice@example.com");
      expect(parsed.body).toBe("Hey there, how are you doing?");
    });

    it("falls back to HTML when text is empty", async () => {
      mockGet.mockResolvedValue({
        messageId: "msg-2",
        threadId: "thread-2",
        from: "plaud@plaud.ai",
        to: ["cogito@agentmail.to"],
        subject: "Your Note",
        text: undefined,
        html: "<p>Your recording <strong>is ready</strong></p>",
        timestamp: new Date("2026-02-22T09:00:00Z"),
        attachments: [],
        labels: ["inbox"],
      });

      const result = await executeAgentMailInboxTool("call-6", {
        action: "read",
        messageId: "msg-2",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.body).toContain("Your recording");
      expect(parsed.body).toContain("is ready");
      expect(parsed.body).not.toContain("<p>");
    });

    it("returns error when messageId is missing", async () => {
      const result = await executeAgentMailInboxTool("call-7", {
        action: "read",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("messageId is required");
    });
  });

  describe("error handling", () => {
    it("returns error when API call fails", async () => {
      mockList.mockRejectedValue(new Error("API connection failed"));

      const result = await executeAgentMailInboxTool("call-8", {
        action: "list",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe("API connection failed");
    });
  });
});
