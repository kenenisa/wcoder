import { getUser } from "../../db/queries.js";

const WELCOME = `<b>Welcome to WCoder!</b>
Your coding assistant powered by Cursor.

To get started, I need two things:

<b>1.</b> A GitHub Personal Access Token (PAT) with <code>repo</code> scope
   Generate one here: https://github.com/settings/tokens/new?scopes=repo

<b>2.</b> A Cursor API key for the AI agent
   Get yours at: https://cursor.com/settings/api-keys

Send them to me with:
<code>/github ghp_xxxxxxxxxxxx</code>
<code>/cursor sk-cursor-xxxxxxxxxxxx</code>`;

const WELCOME_BACK = `<b>Welcome back!</b>

Use /repos to browse repositories, or /clone owner/repo to start coding.
Use /sessions to see your previous sessions, or /help for all commands.`;

export async function handleStart(ctx) {
  const user = getUser(ctx.from.id);
  const hasTokens = user?.github_token && user?.cursor_api_key;

  await ctx.reply(hasTokens ? WELCOME_BACK : WELCOME, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}
