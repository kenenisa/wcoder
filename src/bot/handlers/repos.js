import { listRepos } from "../../github/api.js";
import { escapeHtml } from "../../streaming/formatter.js";

function formatRepoList(repos, page, hasNext) {
  if (repos.length === 0) {
    return "No repositories found.";
  }

  const lines = repos.map((r, i) => {
    const num = (page - 1) * 10 + i + 1;
    const vis = r.private ? "🔒" : "";
    const lang = r.language ? `(${r.language})` : "";
    const stars = r.stars > 0 ? `★ ${r.stars}` : "";
    const parts = [stars, lang, vis].filter(Boolean).join("  ");
    return `<code>${num}.</code> <b>${escapeHtml(r.full_name)}</b>  ${parts}`;
  });

  let text = `<b>Your repositories</b> (page ${page}):\n\n${lines.join("\n")}`;

  text += "\n\nUse <code>/clone owner/repo</code> to clone and start coding.";
  if (hasNext) {
    text += `\nUse <code>/repos ${page + 1}</code> for the next page.`;
  }

  return text;
}

export async function handleRepos(ctx) {
  const page = Math.max(1, parseInt(ctx.match, 10) || 1);

  await ctx.reply("Fetching repositories...");

  try {
    const { repos, hasNext } = await listRepos(ctx.githubToken, { page });
    const text = formatRepoList(repos, page, hasNext);

    await ctx.reply(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    await ctx.reply(
      `Failed to list repositories: ${escapeHtml(err.message)}`,
      { parse_mode: "HTML" },
    );
  }
}
