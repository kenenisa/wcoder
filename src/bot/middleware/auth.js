import { getUser } from "../../db/queries.js";
import { decrypt } from "../../utils/crypto.js";

const PUBLIC_COMMANDS = new Set(["start", "help", "github", "cursor", "update"]);

export function authMiddleware() {
  return async (ctx, next) => {
    const command = ctx.message?.text?.startsWith("/")
      ? ctx.message.text.slice(1).split(/\s+/)[0].toLowerCase().replace(/@\w+$/, "")
      : null;

    if (command && PUBLIC_COMMANDS.has(command)) {
      return next();
    }

    const userId = ctx.from?.id;
    if (!userId) return;

    const user = getUser(userId);
    if (!user?.github_token || !user?.cursor_api_key) {
      const missing = [];
      if (!user?.github_token) missing.push("/github &lt;token&gt;");
      if (!user?.cursor_api_key) missing.push("/cursor &lt;key&gt;");

      await ctx.reply(
        `You need to set up your credentials first:\n${missing.join("\n")}`,
        { parse_mode: "HTML" },
      );
      return;
    }

    ctx.user = user;
    ctx.githubToken = decrypt(user.github_token);
    ctx.cursorApiKey = decrypt(user.cursor_api_key);

    return next();
  };
}
