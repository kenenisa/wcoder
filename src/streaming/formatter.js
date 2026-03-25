/**
 * Convert Markdown text to Telegram-compatible HTML.
 *
 * Telegram supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a>, <blockquote>
 * We convert from Markdown equivalents and strip unsupported syntax.
 */

export function markdownToTelegramHTML(md) {
  if (!md) return "";

  let html = md;

  // Escape HTML entities first (but we'll unescape our own tags after)
  html = escapeHtml(html);

  // Code blocks: ```lang\ncode\n``` → <pre><code class="language-lang">code</code></pre>
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_, lang, code) => {
      const cls = lang ? ` class="language-${lang}"` : "";
      return `<pre><code${cls}>${code.trimEnd()}</code></pre>`;
    }
  );

  // Inline code: `code` → <code>code</code>
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold: **text** or __text__ → <b>text</b>
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  html = html.replace(/__(.+?)__/g, "<b>$1</b>");

  // Italic: *text* or _text_ → <i>text</i>
  // Avoid matching inside already-processed bold tags
  html = html.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, "<i>$1</i>");
  html = html.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "<i>$1</i>");

  // Strikethrough: ~~text~~ → <s>text</s>
  html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Links: [text](url) → <a href="url">text</a>
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2">$1</a>'
  );

  // Headers: # Header → <b>HEADER</b>
  html = html.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // Blockquotes: > text → <blockquote>text</blockquote>
  html = html.replace(/^&gt;\s*(.+)$/gm, "<blockquote>$1</blockquote>");
  // Merge consecutive blockquote lines
  html = html.replace(/<\/blockquote>\n<blockquote>/g, "\n");

  // Horizontal rules
  html = html.replace(/^---+$/gm, "—————————");

  return html;
}

export function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Truncate text to fit Telegram's message limit, respecting HTML tags.
 * Returns { text, truncated }.
 */
export function truncateForTelegram(html, maxLength = 4000) {
  if (html.length <= maxLength) {
    return { text: html, truncated: false };
  }

  // Find a safe cut point — avoid cutting inside tags
  let cutAt = maxLength;
  const openTag = html.lastIndexOf("<", cutAt);
  const closeTag = html.lastIndexOf(">", cutAt);

  if (openTag > closeTag) {
    // We're inside a tag, cut before it
    cutAt = openTag;
  }

  // Close any open <pre> or <code> tags
  const text = closeOpenTags(html.slice(0, cutAt));
  return { text, truncated: true };
}

function closeOpenTags(html) {
  const tagStack = [];
  const tagRegex = /<\/?([a-z]+)[^>]*>/gi;
  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    const [fullMatch, tagName] = match;
    if (fullMatch.startsWith("</")) {
      if (tagStack.length > 0 && tagStack[tagStack.length - 1] === tagName.toLowerCase()) {
        tagStack.pop();
      }
    } else if (!fullMatch.endsWith("/>")) {
      tagStack.push(tagName.toLowerCase());
    }
  }

  // Close remaining open tags in reverse
  let result = html;
  for (let i = tagStack.length - 1; i >= 0; i--) {
    result += `</${tagStack[i]}>`;
  }
  return result;
}
