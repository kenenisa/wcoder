import { upsertUser, getUser } from "../../db/queries.js";
import { encrypt } from "../../utils/crypto.js";
import logger from "../../utils/logger.js";

export async function handleCursor(ctx) {
  const chatId = ctx.chat.id;
  const senderId = ctx.from.id;

  try {
    await ctx.api.deleteMessage(chatId, ctx.message.message_id);
  } catch {
    // best-effort deletion
  }

  const apiKey = ctx.match?.trim();
  if (!apiKey) {
    await ctx.reply(
      "Usage: <code>/cursor sk-cursor-xxxxxxxxxxxx</code>\n\nGet your API key at: https://cursor.com/settings/api-keys",
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );
    return;
  }

  const encryptedKey = encrypt(apiKey);
  upsertUser(senderId, { cursor_api_key: encryptedKey });

  logger.info({ senderId }, "Cursor API key stored");

  const user = getUser(senderId);
  const hasGithub = !!user?.github_token;

  if (hasGithub) {
    await ctx.reply(
      "✓ Cursor API key saved!\n\nYou're all set. Use /repos to browse your repositories, or <code>/clone owner/repo</code> to get started.",
      { parse_mode: "HTML" },
    );
  } else {
    await ctx.reply(
      "✓ Cursor API key saved!\n\nNow send your GitHub token with:\n<code>/github ghp_xxxxxxxxxxxx</code>",
      { parse_mode: "HTML" },
    );
  }
}
