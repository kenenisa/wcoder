import { upsertUser } from "../../db/queries.js";
import { encrypt } from "../../utils/crypto.js";
import { validateGithubToken } from "../../github/auth.js";
import logger from "../../utils/logger.js";

export async function handleGithub(ctx) {
  const chatId = ctx.chat.id;
  const senderId = ctx.from.id;

  try {
    await ctx.api.deleteMessage(chatId, ctx.message.message_id);
  } catch {
    // best-effort deletion
  }

  const token = ctx.match?.trim();
  if (!token) {
    await ctx.reply(
      "Usage: <code>/github ghp_xxxxxxxxxxxx</code>\n\nGenerate a token at: https://github.com/settings/tokens/new?scopes=repo",
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );
    return;
  }

  await ctx.reply("Validating GitHub token...");

  try {
    const result = await validateGithubToken(token);

      if (!result.valid) {
        await ctx.reply(
          `✗ GitHub token validation failed: ${result.error}\n\nPlease check your token and try again.`,
          { parse_mode: "HTML" },
        );
        return;
      }

      const encryptedToken = encrypt(token);

      upsertUser(senderId, {
        github_token: encryptedToken,
        github_username: result.username,
      });

      logger.info({ senderId, username: result.username }, "GitHub token stored");

      await ctx.reply(
        `✓ GitHub token verified! Connected as <b>@${result.username}</b>.\n\nNow send your Cursor API key with:\n<code>/cursor sk-cursor-xxxxxxxxxxxx</code>`,
        { parse_mode: "HTML" },
      );
    } catch (err) {
      logger.warn({ senderId, err: err.message }, "GitHub token validation failed");
      await ctx.reply(
        `✗ GitHub token validation failed: ${err.message}\n\nPlease check your token and try again.`,
        { parse_mode: "HTML" },
      );
    }
}
