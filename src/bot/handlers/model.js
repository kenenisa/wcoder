import { getActiveSession } from "../../db/queries.js";
import { switchModel } from "../../cursor/session-manager.js";
import { createStreamHandler } from "../../streaming/response-stream.js";
import { escapeHtml } from "../../streaming/formatter.js";
import logger from "../../utils/logger.js";

const KNOWN_MODELS = [
  "claude-4-sonnet",
  "claude-4-opus",
  "gpt-4.1",
  "gpt-4.1-mini",
  "o3",
  "o4-mini",
  "gemini-2.5-pro",
];

export async function handleModel(ctx) {
  const senderId = ctx.from.id;
  const chatId = ctx.chat.id;
  const modelArg = ctx.match?.trim();

  if (!modelArg) {
    const session = getActiveSession(senderId);
    const current = session?.model || "unknown";
    const list = KNOWN_MODELS.map((m) => `  <code>${m}</code>`).join("\n");

    await ctx.reply(
      `Current model: <b>${escapeHtml(current)}</b>\n\n` +
      `Usage: <code>/model &lt;name&gt;</code>\n\n` +
      `Available models:\n${list}`,
      { parse_mode: "HTML" },
    );
    return;
  }

  const session = getActiveSession(senderId);
  if (session?.model === modelArg) {
    await ctx.reply(`Already using model <b>${escapeHtml(modelArg)}</b>.`, { parse_mode: "HTML" });
    return;
  }

  await ctx.reply(`Switching model to <b>${escapeHtml(modelArg)}</b>…`, { parse_mode: "HTML" });

  try {
    await switchModel(senderId, modelArg, {
      cursorApiKey: ctx.cursorApiKey,
      onEvent: createStreamHandler(ctx.api, chatId),
    });

    await ctx.reply(
      `✓ Model switched to <b>${escapeHtml(modelArg)}</b>\n` +
      `A new agent session has been started.`,
      { parse_mode: "HTML" },
    );
  } catch (err) {
    logger.error({ err, senderId, model: modelArg }, "Failed to switch model");
    await ctx.reply(`Failed to switch model: ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
  }
}
