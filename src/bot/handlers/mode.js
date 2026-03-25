import { getActiveSession } from "../../db/queries.js";
import { switchMode } from "../../cursor/session-manager.js";
import { escapeHtml } from "../../streaming/formatter.js";
import logger from "../../utils/logger.js";

const VALID_MODES = new Set(["agent", "plan", "ask"]);

const MODE_DESCRIPTIONS = {
  agent: "Full tool access — reads, writes, and runs commands",
  plan: "Planning mode — designs approach before coding (read-only)",
  ask: "Q&amp;A mode — answers questions without making changes (read-only)",
};

export async function handleMode(ctx) {
  const senderId = ctx.from.id;
  const modeArg = ctx.match?.trim().toLowerCase();

  if (!modeArg) {
    const session = getActiveSession(senderId);
    const current = session?.mode || "agent";
    const list = Object.entries(MODE_DESCRIPTIONS)
      .map(([m, desc]) => {
        const marker = m === current ? "→" : " ";
        return `${marker} <b>${m}</b> — ${desc}`;
      })
      .join("\n");

    await ctx.reply(
      `Current mode: <b>${current}</b>\n\n${list}\n\n` +
      `Usage: <code>/mode &lt;agent|plan|ask&gt;</code>`,
      { parse_mode: "HTML" },
    );
    return;
  }

  if (!VALID_MODES.has(modeArg)) {
    await ctx.reply(
      `Invalid mode: <code>${escapeHtml(modeArg)}</code>\n` +
      `Valid modes: <code>agent</code>, <code>plan</code>, <code>ask</code>`,
      { parse_mode: "HTML" },
    );
    return;
  }

  const session = getActiveSession(senderId);
  if (session?.mode === modeArg) {
    await ctx.reply(`Already in <b>${modeArg}</b> mode.`, { parse_mode: "HTML" });
    return;
  }

  try {
    await switchMode(senderId, modeArg, {
      cursorApiKey: ctx.cursorApiKey,
    });

    await ctx.reply(
      `✓ Switched to <b>${modeArg}</b> mode\n` +
      `${MODE_DESCRIPTIONS[modeArg]}`,
      { parse_mode: "HTML" },
    );
  } catch (err) {
    logger.error({ err, senderId, mode: modeArg }, "Failed to switch mode");
    await ctx.reply(`Failed to switch mode: ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
  }
}
