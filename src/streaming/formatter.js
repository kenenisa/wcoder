/**
 * Convert Markdown text to Telegram-compatible HTML.
 *
 * Telegram supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a>, <blockquote>
 * We convert from Markdown equivalents and strip unsupported syntax.
 *
 * Strategy: extract code blocks into placeholders before escaping HTML so
 * their contents are escaped exactly once, then apply block-level and
 * inline transformations on the already-escaped text.
 */

export function markdownToTelegramHtml(md) {
  if (!md) return "";

  const placeholders = [];
  const ph = (html) => {
    const idx = placeholders.length;
    placeholders.push(html);
    return `\x00P${idx}\x00`;
  };

  let html = md;

  // --- Phase 1: extract code (raw, before escaping) ---

  // Fenced code blocks (handles unclosed blocks for streaming via `$` fallback)
  html = html.replace(/```(\w*)\n([\s\S]*?)(?:```|$)/g, (_, lang, code) => {
    const cls = lang ? ` class="language-${lang}"` : "";
    return ph(`<pre><code${cls}>${escapeHtml(code.trimEnd())}</code></pre>`);
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, (_, code) => ph(`<code>${escapeHtml(code)}</code>`));

  // --- Phase 2: escape remaining HTML ---

  html = escapeHtml(html);

  // --- Phase 3: block-level transformations ---

  // Tables (2+ consecutive lines bounded by |) → <pre>
  html = html.replace(/((?:^\|.*\|[ \t]*$\n?){2,})/gm, (table) => {
    const lines = table.trimEnd().split("\n")
      .filter((l) => !/^\|[\s\-:|]+\|$/.test(l));
    if (lines.length === 0) return table;
    return ph(`<pre>${lines.join("\n")}</pre>`);
  });

  html = html.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  html = html.replace(/^&gt;\s*(.+)$/gm, "<blockquote>$1</blockquote>");
  html = html.replace(/<\/blockquote>\n<blockquote>/g, "\n");

  html = html.replace(/^-{3,}$/gm, "────────────────");

  // --- Phase 4: inline transformations ---

  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<b><i>$1</i></b>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  html = html.replace(/__(.+?)__/g, "<b>$1</b>");

  // *text* italic — [^\s*] at start prevents matching list markers like `* item`
  html = html.replace(/(?<!\w)\*([^\s*][^*]*?)\*(?!\w)/g, "<i>$1</i>");
  html = html.replace(/(?<!\w)_([^\s_][^_]*?)_(?!\w)/g, "<i>$1</i>");

  html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // --- Phase 5: cleanup ---

  html = html.replace(/\n{3,}/g, "\n\n");

  // Restore placeholders
  html = html.replace(/\x00P(\d+)\x00/g, (_, idx) => placeholders[parseInt(idx)]);

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
