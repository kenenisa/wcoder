import { describe, test, expect } from "bun:test";
import { markdownToTelegramHtml, escapeHtml } from "../../src/streaming/formatter.js";

describe("escapeHtml", () => {
  test("escapes <, >, and &", () => {
    expect(escapeHtml("<div>&")).toBe("&lt;div&gt;&amp;");
  });

  test("leaves normal text untouched", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

describe("markdownToTelegramHtml", () => {
  test("returns empty string for empty input", () => {
    expect(markdownToTelegramHtml("")).toBe("");
    expect(markdownToTelegramHtml(null)).toBe("");
    expect(markdownToTelegramHtml(undefined)).toBe("");
  });

  test("converts bold **text**", () => {
    expect(markdownToTelegramHtml("hello **world**")).toBe("hello <b>world</b>");
  });

  test("converts bold __text__", () => {
    expect(markdownToTelegramHtml("hello __world__")).toBe("hello <b>world</b>");
  });

  test("converts italic *text*", () => {
    expect(markdownToTelegramHtml("hello *world*")).toBe("hello <i>world</i>");
  });

  test("does not convert list marker * as italic", () => {
    const result = markdownToTelegramHtml("* item one\n* item two");
    expect(result).not.toContain("<i>");
  });

  test("converts strikethrough ~~text~~", () => {
    expect(markdownToTelegramHtml("hello ~~world~~")).toBe("hello <s>world</s>");
  });

  test("converts inline code", () => {
    expect(markdownToTelegramHtml("use `console.log`")).toBe(
      "use <code>console.log</code>",
    );
  });

  test("converts fenced code blocks with language", () => {
    const md = '```js\nconst x = 1;\n```';
    const html = markdownToTelegramHtml(md);
    expect(html).toContain('<pre><code class="language-js">');
    expect(html).toContain("const x = 1;");
    expect(html).toContain("</code></pre>");
  });

  test("converts fenced code blocks without language", () => {
    const md = "```\nsome code\n```";
    const html = markdownToTelegramHtml(md);
    expect(html).toContain("<pre><code>");
    expect(html).toContain("some code");
  });

  test("handles unclosed code blocks (streaming partial)", () => {
    const md = "```python\ndef foo():\n  pass";
    const html = markdownToTelegramHtml(md);
    expect(html).toContain('<pre><code class="language-python">');
    expect(html).toContain("def foo():");
  });

  test("escapes HTML inside code blocks", () => {
    const md = "```html\n<div>hello</div>\n```";
    const html = markdownToTelegramHtml(md);
    expect(html).toContain("&lt;div&gt;hello&lt;/div&gt;");
  });

  test("converts links [text](url)", () => {
    const md = "click [here](https://example.com)";
    const html = markdownToTelegramHtml(md);
    expect(html).toBe('click <a href="https://example.com">here</a>');
  });

  test("converts headers to bold", () => {
    expect(markdownToTelegramHtml("# Title")).toContain("<b>Title</b>");
    expect(markdownToTelegramHtml("## Subtitle")).toContain("<b>Subtitle</b>");
    expect(markdownToTelegramHtml("### Heading 3")).toContain("<b>Heading 3</b>");
  });

  test("converts blockquotes", () => {
    const md = "> This is a quote";
    const html = markdownToTelegramHtml(md);
    expect(html).toContain("<blockquote>");
    expect(html).toContain("This is a quote");
  });

  test("merges consecutive blockquotes", () => {
    const md = "> line one\n> line two";
    const html = markdownToTelegramHtml(md);
    const blockquoteCount = (html.match(/<blockquote>/g) || []).length;
    expect(blockquoteCount).toBe(1);
  });

  test("converts tables to pre blocks", () => {
    const md = "| Col1 | Col2 |\n| ---- | ---- |\n| a    | b    |";
    const html = markdownToTelegramHtml(md);
    expect(html).toContain("<pre>");
    expect(html).toContain("Col1");
  });

  test("converts horizontal rules", () => {
    const result = markdownToTelegramHtml("---");
    expect(result).toContain("─");
  });

  test("handles mixed formatting", () => {
    const md = "**bold** and *italic* and `code`";
    const html = markdownToTelegramHtml(md);
    expect(html).toContain("<b>bold</b>");
    expect(html).toContain("<i>italic</i>");
    expect(html).toContain("<code>code</code>");
  });

  test("does not double-escape HTML entities in code", () => {
    const md = "Use `<div>` for containers";
    const html = markdownToTelegramHtml(md);
    expect(html).toContain("<code>&lt;div&gt;</code>");
    expect(html).not.toContain("&amp;lt;");
  });

  test("handles bold+italic ***text***", () => {
    const md = "this is ***important***";
    const html = markdownToTelegramHtml(md);
    expect(html).toContain("<b><i>important</i></b>");
  });

  test("collapses excessive newlines", () => {
    const md = "hello\n\n\n\n\nworld";
    const html = markdownToTelegramHtml(md);
    expect(html).not.toContain("\n\n\n");
  });
});
