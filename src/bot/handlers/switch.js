import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { getActiveSession, getUserSessions } from "../../db/queries.js";
import { startSession } from "../../cursor/session-manager.js";
import { createStreamHandler } from "../../streaming/response-stream.js";
import { getCurrentBranch } from "../../git/operations.js";
import { escapeHtml } from "../../streaming/formatter.js";
import config from "../../config.js";
import logger from "../../utils/logger.js";

export async function handleSwitch(ctx) {
  const senderId = ctx.from.id;
  const chatId = ctx.chat.id;
  const repoArg = ctx.match?.trim();

  if (!repoArg) {
    const cloned = getClonedRepos(senderId);
    if (cloned.length === 0) {
      await ctx.reply(
        "No cloned repositories.\nUse <code>/clone owner/repo</code> to get started.",
        { parse_mode: "HTML" },
      );
      return;
    }

    const current = getActiveSession(senderId);
    const lines = cloned.map((r) => {
      const marker = current?.repo_full_name === r ? "→" : " ";
      return `${marker} <code>${escapeHtml(r)}</code>`;
    });

    await ctx.reply(
      `<b>Cloned repositories:</b>\n\n${lines.join("\n")}\n\n` +
      `Usage: <code>/switch owner/repo</code>`,
      { parse_mode: "HTML" },
    );
    return;
  }

  if (!repoArg.includes("/")) {
    await ctx.reply("Usage: <code>/switch owner/repo</code>", { parse_mode: "HTML" });
    return;
  }

  const [owner, repo] = repoArg.split("/");
  const fullName = `${owner}/${repo}`;
  const repoPath = resolve(config.paths.repos, String(senderId), owner, repo);

  if (!existsSync(repoPath)) {
    await ctx.reply(
      `Repository <b>${escapeHtml(fullName)}</b> is not cloned.\n` +
      `Use <code>/clone ${escapeHtml(fullName)}</code> first.`,
      { parse_mode: "HTML" },
    );
    return;
  }

  const current = getActiveSession(senderId);
  if (current?.repo_full_name === fullName) {
    await ctx.reply(`Already working on <b>${escapeHtml(fullName)}</b>.`, { parse_mode: "HTML" });
    return;
  }

  await ctx.reply(`Switching to <b>${escapeHtml(fullName)}</b>…`, { parse_mode: "HTML" });

  try {
    let branch;
    try {
      branch = await getCurrentBranch(repoPath);
    } catch {
      branch = "main";
    }

    const session = await startSession(senderId, {
      cursorApiKey: ctx.cursorApiKey,
      repoPath,
      repoFullName: fullName,
      title: fullName,
      model: current?.model || config.behavior.defaultModel,
      mode: current?.mode || "agent",
      branch,
      onEvent: createStreamHandler(ctx.api, chatId),
    });

    await ctx.reply(
      `✓ Switched to <b>${escapeHtml(fullName)}</b>\n` +
      `Session #${session.id} on branch <code>${escapeHtml(branch)}</code>\n\n` +
      `Send me a prompt to start coding.`,
      { parse_mode: "HTML" },
    );
  } catch (err) {
    logger.error({ err, senderId, repo: fullName }, "Failed to switch repo");
    await ctx.reply(`Failed to switch: ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
  }
}

function getClonedRepos(telegramId) {
  const sessions = getUserSessions(telegramId, 100, 0);
  const seen = new Set();
  const repos = [];
  for (const s of sessions) {
    if (!seen.has(s.repo_full_name)) {
      seen.add(s.repo_full_name);
      repos.push(s.repo_full_name);
    }
  }
  return repos;
}
