import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getActiveSession, incrementMessageCount } from "../../db/queries.js";
import {
  sendPrompt,
  getACPClient,
  startSession,
} from "../../cursor/session-manager.js";
import { createStreamHandler } from "../../streaming/response-stream.js";
import { escapeHtml } from "../../streaming/formatter.js";
import { downloadFile } from "../client.js";
import config from "../../config.js";
import logger from "../../utils/logger.js";

export async function handleMessage(ctx) {
  const senderId = ctx.from.id;
  const chatId = ctx.chat.id;

  const session = getActiveSession(senderId);
  if (!session) {
    await ctx.reply(
      "You don't have an active coding session.\n\n" +
      "Use <code>/clone owner/repo</code> to clone a repository and start,\n" +
      "or <code>/resume &lt;id&gt;</code> to resume a previous session.",
      { parse_mode: "HTML" },
    );
    return;
  }

  let acpEntry = getACPClient(senderId);
  if (!acpEntry || !acpEntry.client.alive) {
    await ctx.reply("Starting agent…");

    try {
      await startSession(senderId, {
        cursorApiKey: ctx.cursorApiKey,
        repoPath: session.repo_path,
        repoFullName: session.repo_full_name,
        title: session.title,
        model: session.model,
        mode: session.mode,
        branch: session.branch,
        onEvent: createStreamHandler(ctx.api, chatId),
      });
    } catch (err) {
      logger.error({ err, senderId }, "Failed to start ACP session");
      await ctx.reply(`Failed to start agent: ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      return;
    }
  }

  let promptText = ctx.message?.text || ctx.message?.caption || "";
  const images = [];

  const photo = ctx.message?.photo;
  if (photo && photo.length > 0) {
    try {
      const largest = photo[photo.length - 1];
      const imgDir = resolve(config.paths.tmp, String(senderId));
      mkdirSync(imgDir, { recursive: true });

      const imgPath = resolve(imgDir, `${randomUUID()}.jpg`);
      const buffer = await downloadFile(largest.file_id);
      writeFileSync(imgPath, buffer);
      images.push(imgPath);
      logger.info({ senderId, imgPath }, "Downloaded image from Telegram");
    } catch (err) {
      logger.warn({ err, senderId }, "Failed to download image");
    }
  }

  if (!promptText && images.length === 0) return;

  if (!promptText && images.length > 0) {
    promptText = "Analyze this image and apply any relevant changes.";
  }

  incrementMessageCount(session.id);

  try {
    await sendPrompt(senderId, promptText, images);
  } catch (err) {
    logger.error({ err, senderId }, "Failed to send prompt to ACP");
    await ctx.reply(`Failed to process your message: ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
  }
}
