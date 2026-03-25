import { getActiveSession } from "../../db/queries.js";

const SESSION_REQUIRED = new Set([
  "commit", "push", "pr", "branch", "diff", "git",
  "model", "mode", "status", "new", "stop", "switch",
]);

export function sessionMiddleware() {
  return async (ctx, next) => {
    const command = ctx.message?.text?.startsWith("/")
      ? ctx.message.text.slice(1).split(/\s+/)[0].toLowerCase().replace(/@\w+$/, "")
      : null;

    if (command && SESSION_REQUIRED.has(command)) {
      const userId = ctx.from?.id;
      const session = getActiveSession(userId);
      if (!session) {
        await ctx.reply(
          "No active coding session.\nUse <code>/clone owner/repo</code> to clone a repository and start coding.",
          { parse_mode: "HTML" },
        );
        return;
      }
      ctx.session = session;
    }

    return next();
  };
}
