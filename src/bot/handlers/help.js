const HELP_TEXT = `<b>WCoder Commands</b>

<b>Setup</b>
/start — Welcome &amp; onboarding
/github &lt;pat&gt; — Set GitHub token
/cursor &lt;api_key&gt; — Set Cursor API key

<b>Repositories</b>
/repos [page] — List your repositories
/clone &lt;owner/repo&gt; [branch] — Clone &amp; start coding
/switch &lt;owner/repo&gt; — Switch to another repo

<b>Coding</b>
Just type a message to send a prompt to the agent.
Send an image with a caption for visual context.

/model &lt;name&gt; — Change AI model
/mode &lt;agent|plan|ask&gt; — Switch agent mode

<b>Sessions</b>
/new [title] — Start a new session
/sessions [page] — List session history
/resume &lt;id&gt; — Resume a previous session
/status — Current session info
/stop — Stop the agent

<b>Git</b>
/commit [message] — Commit changes
/push [remote] [branch] — Push branch
/pr [title] — Create a pull request
/branch &lt;name&gt; — Create &amp; switch branch
/diff — Show uncommitted changes
/git &lt;command&gt; — Run a git command`;

export async function handleHelp(ctx) {
  await ctx.reply(HELP_TEXT, { parse_mode: "HTML" });
}
