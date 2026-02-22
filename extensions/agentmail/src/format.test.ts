import { describe, it, expect } from "vitest";
import { emailHtmlToText, markdownToEmailHtml, formatInboundEmailBody } from "./format.js";

describe("format", () => {
  describe("emailHtmlToText", () => {
    it("strips HTML tags and decodes entities", () => {
      const html = "<p>Hello <strong>world</strong></p><p>&amp; goodbye</p>";
      const text = emailHtmlToText(html);
      expect(text).toContain("Hello world");
      expect(text).toContain("& goodbye");
    });

    it("converts br and p tags to newlines", () => {
      const html = "line1<br>line2</p><p>line3";
      const text = emailHtmlToText(html);
      expect(text).toContain("line1\nline2");
    });

    it("strips style and script tags entirely", () => {
      const html = "<style>.foo{color:red}</style><p>visible</p><script>alert(1)</script>";
      const text = emailHtmlToText(html);
      expect(text).toBe("visible");
    });

    it("converts list items", () => {
      const html = "<ul><li>first</li><li>second</li></ul>";
      const text = emailHtmlToText(html);
      expect(text).toContain("- first");
      expect(text).toContain("- second");
    });
  });

  describe("markdownToEmailHtml", () => {
    it("converts bold markdown to strong tags", () => {
      const md = "Hello **world**";
      const html = markdownToEmailHtml(md);
      expect(html).toContain("<strong>world</strong>");
    });

    it("converts italic markdown to em tags", () => {
      const md = "Hello *world*";
      const html = markdownToEmailHtml(md);
      expect(html).toContain("<em>world</em>");
    });

    it("converts inline code to code tags", () => {
      const md = "Use `npm install`";
      const html = markdownToEmailHtml(md);
      expect(html).toContain("<code>npm install</code>");
    });

    it("wraps in styled div", () => {
      const html = markdownToEmailHtml("test");
      expect(html).toContain("font-family");
      expect(html).toContain("<p>");
    });

    it("escapes HTML entities in input", () => {
      const md = "Use <script> tag";
      const html = markdownToEmailHtml(md);
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });
  });

  describe("formatInboundEmailBody", () => {
    it("includes subject in body", () => {
      const body = formatInboundEmailBody({
        from: "user@test.com",
        subject: "Test Subject",
        text: "Hello there",
        hasAttachments: false,
      });
      expect(body).toContain("Subject: Test Subject");
      expect(body).toContain("Hello there");
    });

    it("lists attachment names when present", () => {
      const body = formatInboundEmailBody({
        from: "user@test.com",
        subject: "Files",
        text: "See attached",
        hasAttachments: true,
        attachmentNames: ["report.pdf", "data.csv"],
      });
      expect(body).toContain("report.pdf");
      expect(body).toContain("data.csv");
      expect(body).toContain("Attachments:");
    });

    it("omits attachments line when no attachments", () => {
      const body = formatInboundEmailBody({
        from: "user@test.com",
        subject: "No files",
        text: "Just text",
        hasAttachments: false,
      });
      expect(body).not.toContain("Attachments:");
    });
  });
});
