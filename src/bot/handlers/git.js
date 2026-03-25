import {
  commitAll,
  push,
  createBranch,
  getDiff,
  getStatus,
  runGitCommand,
  getCurrentBranch,
  configureCredentials,
} from "../../git/operations.js";
import { createPullRequest } from "../../github/api.js";
import { getActiveSession, updateSession } from "../../db/queries.js";
import { sendPrompt } from "../../cursor/session-manager.js";
import { escapeHtml, truncateForTelegram } from "../../streaming/formatter.js";
import logger from "../../utils/logger.js";

export async function handleCommit(ctx) {
  const session = ctx.session;
  let message = ctx.match?.trim();

  if (!message) {
    await ctx.reply("Generating commit message…");
    try {
      message = await generateCommitMessage(ctx.from.id);
    } catch {
      message = null;
    }
  }

  if (!message) {
    await ctx.reply(
      "Could not generate a commit message.\nUsage: <code>/commit your message here</code>",
      { parse_mode: "HTML" },
    );
    return;
  }

  try {
    const result = await commitAll(session.repo_path, message);
    if (result.empty) {
      await ctx.reply("Nothing to commit — working tree is clean.");
      return;
    }
    await ctx.reply(
      `✓ Committed: <code>${escapeHtml(result.hash)}</code>\n` +
      `<i>${escapeHtml(message)}</i>`,
      { parse_mode: "HTML" },
    );
  } catch (err) {
    logger.error({ err }, "Commit failed");
    await ctx.reply(`Commit failed: ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
  }
}

export async function handlePush(ctx) {
  const session = ctx.session;

  try {
    await configureCredentials(session.repo_path, ctx.githubToken);
    const args = ctx.match?.trim().split(/\s+/) || [];
    const remote = args[0] || "origin";
    const branch = args[1] || null;
    const result = await push(session.repo_path, remote, branch);

    await ctx.reply(
      `✓ Pushed to <code>${escapeHtml(result.remote)}/${escapeHtml(result.branch)}</code>`,
      { parse_mode: "HTML" },
    );
  } catch (err) {
    logger.error({ err }, "Push failed");
    await ctx.reply(`Push failed: ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
  }
}

export async function handlePr(ctx) {
  const session = ctx.session;
  const title = ctx.match?.trim();

  try {
    await configureCredentials(session.repo_path, ctx.githubToken);
    const currentBranch = await getCurrentBranch(session.repo_path);

    if (currentBranch === "main" || currentBranch === "master") {
      await ctx.reply(
        "You're on the default branch. Create a feature branch first:\n" +
        "<code>/branch my-feature</code>",
        { parse_mode: "HTML" },
      );
      return;
    }

    await push(session.repo_path, "origin", currentBranch);

    const [owner, repo] = session.repo_full_name.split("/");
    const pr = await createPullRequest(ctx.githubToken, owner, repo, {
      title: title || `WCoder: ${session.title || currentBranch}`,
      head: currentBranch,
      base: "main",
    });

    await ctx.reply(
      `✓ PR #${pr.number} created: <b>${escapeHtml(pr.title)}</b>\n` +
      `🔗 <a href="${pr.url}">${pr.url}</a>`,
      { parse_mode: "HTML" },
    );
  } catch (err) {
    logger.error({ err }, "PR creation failed");
    await ctx.reply(`PR creation failed: ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
  }
}

export async function handleBranch(ctx) {
  const session = ctx.session;
  const name = ctx.match?.trim();

  if (!name) {
    await ctx.reply("Usage: <code>/branch my-feature-name</code>", { parse_mode: "HTML" });
    return;
  }

  try {
    await createBranch(session.repo_path, name);
    updateSession(session.id, { branch: name });

    await ctx.reply(
      `✓ Created and switched to branch <code>${escapeHtml(name)}</code>`,
      { parse_mode: "HTML" },
    );
  } catch (err) {
    logger.error({ err }, "Branch creation failed");
    await ctx.reply(`Branch failed: ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
  }
}

export async function handleDiff(ctx) {
  const session = ctx.session;

  try {
    const { unstaged, staged } = await getDiff(session.repo_path);
    const combined = [staged, unstaged].filter(Boolean).join("\n");

    if (!combined.trim()) {
      await ctx.reply("No changes detected.");
      return;
    }

    const { text } = truncateForTelegram(`<pre>${escapeHtml(combined)}</pre>`, 4000);
    await ctx.reply(text, { parse_mode: "HTML" });
  } catch (err) {
    logger.error({ err }, "Diff failed");
    await ctx.reply(`Diff failed: ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
  }
}

export async function handleGit(ctx) {
  const session = ctx.session;
  const command = ctx.match?.trim();

  if (!command) {
    try {
      const status = await getStatus(session.repo_path);
      const lines = [
        `<b>Branch:</b> <code>${escapeHtml(status.current)}</code>`,
        status.ahead > 0 ? `Ahead by ${status.ahead} commit(s)` : null,
        status.behind > 0 ? `Behind by ${status.behind} commit(s)` : null,
        status.modified.length > 0 ? `Modified: ${status.modified.length} file(s)` : null,
        status.created.length > 0 ? `New: ${status.created.length} file(s)` : null,
        status.deleted.length > 0 ? `Deleted: ${status.deleted.length} file(s)` : null,
        status.isClean() ? "Working tree is clean." : null,
      ].filter(Boolean);

      await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
    } catch (err) {
      await ctx.reply(`Git status failed: ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
    }
    return;
  }

  try {
    const output = await runGitCommand(session.repo_path, command);
    const display = output?.trim() || "(no output)";
    const { text } = truncateForTelegram(`<pre>${escapeHtml(display)}</pre>`, 4000);
    await ctx.reply(text, { parse_mode: "HTML" });
  } catch (err) {
    await ctx.reply(`<pre>${escapeHtml(err.message)}</pre>`, { parse_mode: "HTML" });
  }
}

async function generateCommitMessage(telegramId) {
  try {
    const result = await sendPrompt(
      telegramId,
      "Generate a concise conventional commit message for the current staged/unstaged changes. " +
      "Reply with ONLY the commit message, nothing else. No code fences.",
    );
    if (result?.result) return result.result.trim();
  } catch {
    // fall through
  }
  return null;
}
