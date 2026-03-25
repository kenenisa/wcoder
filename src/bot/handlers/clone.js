import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { cloneRepo, getCurrentBranch } from "../../git/operations.js";
import { startSession } from "../../cursor/session-manager.js";
import { createStreamHandler } from "../../streaming/response-stream.js";
import { escapeHtml } from "../../streaming/formatter.js";
import config from "../../config.js";
import logger from "../../utils/logger.js";

const inProgress = new Set();

export async function handleClone(ctx) {
  const senderId = ctx.from.id;
  const chatId = ctx.chat.id;

  if (inProgress.has(senderId)) {
    await ctx.reply("⏳ A clone/start operation is already running. Please wait.");
    return;
  }

  const repoArg = ctx.match?.trim();
  if (!repoArg || !repoArg.includes("/")) {
    await ctx.reply("Usage: <code>/clone owner/repo [branch]</code>", { parse_mode: "HTML" });
    return;
  }

  const [owner, repo] = repoArg.split(/\s+/)[0].split("/");
  const fullName = `${owner}/${repo}`;
  const repoPath = resolve(config.paths.repos, String(senderId), owner, repo);

  inProgress.add(senderId);
  try {
    if (!existsSync(repoPath)) {
      await ctx.reply(`Cloning <b>${escapeHtml(fullName)}</b>...`, { parse_mode: "HTML" });

      try {
        await cloneRepo(ctx.githubToken, fullName, repoPath);
      } catch (err) {
        logger.error({ senderId, repo: fullName, err: err.message }, "Clone failed");
        await ctx.reply(
          `✗ Failed to clone <b>${escapeHtml(fullName)}</b>: ${escapeHtml(err.message)}\n\nCheck the repo name and ensure your GitHub token has access.`,
          { parse_mode: "HTML" },
        );
        return;
      }
    }

    const branch = await getCurrentBranch(repoPath);

    await ctx.reply(`Starting Cursor agent on <b>${escapeHtml(fullName)}</b>...`, { parse_mode: "HTML" });

    try {
      const session = await startSession(senderId, {
        cursorApiKey: ctx.cursorApiKey,
        repoPath,
        repoFullName: fullName,
        title: fullName,
        model: config.behavior.defaultModel,
        branch,
        onEvent: createStreamHandler(ctx.api, chatId),
      });

      logger.info({ senderId, repo: fullName, sessionId: session.id }, "Session started with ACP");

      await ctx.reply(
        `✓ Cloned <b>${escapeHtml(fullName)}</b>\n` +
        `✓ Session #${session.id} started on branch <code>${escapeHtml(branch)}</code>\n` +
        `✓ Cursor agent is ready\n\n` +
        `Send me a prompt and I'll code on this repo.`,
        { parse_mode: "HTML" },
      );
    } catch (err) {
      logger.error({ senderId, repo: fullName, err: err.message }, "Failed to start ACP session");
      await ctx.reply(
        `✗ Failed to start Cursor agent: ${escapeHtml(err.message)}\n\n` +
        `Make sure the Cursor CLI (<code>agent</code>) is installed on the server and in PATH.`,
        { parse_mode: "HTML" },
      );
    }
  } finally {
    inProgress.delete(senderId);
  }
}
