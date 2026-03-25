import {
  getActiveSession,
  getSession,
  getUserSessions,
  getUserSessionCount,
} from "../../db/queries.js";
import {
  newSessionOnCurrentRepo,
  resumeSession,
  stopSession,
} from "../../cursor/session-manager.js";
import { createStreamHandler } from "../../streaming/response-stream.js";
import { escapeHtml } from "../../streaming/formatter.js";
import logger from "../../utils/logger.js";

function relativeTime(isoString) {
  const then = new Date(isoString + "Z");
  const diffMs = Date.now() - then.getTime();

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;

  return `${Math.floor(days / 30)}mo ago`;
}

// ── /new [title] ──

export async function handleNew(ctx) {
  const senderId = ctx.from.id;
  const chatId = ctx.chat.id;

  const current = getActiveSession(senderId);
  if (!current) {
    await ctx.reply(
      "No active session to save.\nUse <code>/clone owner/repo</code> to start one first.",
      { parse_mode: "HTML" },
    );
    return;
  }

  const title = ctx.match?.trim() || null;

  try {
    const session = await newSessionOnCurrentRepo(senderId, {
      cursorApiKey: ctx.cursorApiKey,
      title,
      onEvent: createStreamHandler(ctx.api, chatId),
    });

    const prevTitle = escapeHtml(current.title || `Session #${current.id}`);
    const newTitle = escapeHtml(session.title || `Session #${session.id}`);

    await ctx.reply(
      `✓ Previous session saved: "${prevTitle}" (#${current.id})\n` +
      `✓ New session started: "${newTitle}" (#${session.id})\n` +
      `Repository: <b>${escapeHtml(session.repo_full_name)}</b>\n\n` +
      `Send me a prompt to get started.`,
      { parse_mode: "HTML" },
    );
  } catch (err) {
    logger.error({ err, senderId }, "Failed to start new session");
    await ctx.reply(`Failed to start new session: ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
  }
}

// ── /sessions [page] ──

export async function handleSessions(ctx) {
  const senderId = ctx.from.id;
  const pageSize = 10;
  const page = Math.max(1, parseInt(ctx.match, 10) || 1);
  const offset = (page - 1) * pageSize;

  const sessions = getUserSessions(senderId, pageSize, offset);
  const total = getUserSessionCount(senderId);
  const totalPages = Math.ceil(total / pageSize);

  if (sessions.length === 0) {
    await ctx.reply("You have no sessions yet.\nUse <code>/clone owner/repo</code> to start one.", { parse_mode: "HTML" });
    return;
  }

  const currentActive = getActiveSession(senderId);

  const lines = sessions.map((s) => {
    const isActive = currentActive && s.id === currentActive.id;
    const marker = isActive ? "→" : " ";
    const statusTag = isActive
      ? "(active)"
      : s.status === "paused"
        ? relativeTime(s.last_active_at)
        : `(${s.status})`;
    const title = escapeHtml(s.title || s.repo_full_name);
    const repo = escapeHtml(s.repo_full_name);

    return `${marker} <b>#${s.id}</b>  ${title}  <code>${repo}</code>  ${statusTag}`;
  });

  let text = `<b>Your sessions</b> (page ${page}/${totalPages}):\n\n${lines.join("\n")}`;
  text += "\n\nUse <code>/resume &lt;id&gt;</code> to switch to a previous session.";

  if (page < totalPages) {
    text += `\nUse <code>/sessions ${page + 1}</code> for the next page.`;
  }

  await ctx.reply(text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
}

// ── /resume <id> ──

export async function handleResume(ctx) {
  const senderId = ctx.from.id;
  const chatId = ctx.chat.id;

  const id = parseInt(ctx.match, 10);
  if (!id) {
    await ctx.reply(
      "Usage: <code>/resume &lt;id&gt;</code>\n\nUse <code>/sessions</code> to see your session history.",
      { parse_mode: "HTML" },
    );
    return;
  }

  const target = getSession(id);
  if (!target) {
    await ctx.reply(`Session #${id} not found.\nUse <code>/sessions</code> to see available sessions.`, { parse_mode: "HTML" });
    return;
  }

  if (target.telegram_id !== senderId) {
    await ctx.reply("That session doesn't belong to you.");
    return;
  }

  if (!target.acp_session_id) {
    await ctx.reply(`Session #${id} has no ACP session to resume. Use <code>/clone</code> to start fresh.`, { parse_mode: "HTML" });
    return;
  }

  await ctx.reply(`Resuming session #${id}...`);

  try {
    const session = await resumeSession(senderId, id, {
      cursorApiKey: ctx.cursorApiKey,
      onEvent: createStreamHandler(ctx.api, chatId),
    });

    const title = escapeHtml(session.title || `Session #${session.id}`);

    await ctx.reply(
      `✓ Resumed session #${id}: "${title}"\n` +
      `Repository: <b>${escapeHtml(session.repo_full_name)}</b>\n\n` +
      `Conversation context restored. You can continue where you left off.`,
      { parse_mode: "HTML" },
    );
  } catch (err) {
    logger.error({ err, senderId, sessionId: id }, "Failed to resume session");
    await ctx.reply(`Failed to resume session #${id}: ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
  }
}

// ── /stop ──

export async function handleStop(ctx) {
  const senderId = ctx.from.id;

  const session = getActiveSession(senderId);
  if (!session) {
    await ctx.reply("No active session to stop.");
    return;
  }

  stopSession(senderId);

  const title = escapeHtml(session.title || `Session #${session.id}`);

  await ctx.reply(
    `✓ Stopped session #${session.id}: "${title}"\n\n` +
    `Use <code>/clone</code> to start a new session or <code>/resume</code> to resume a previous one.`,
    { parse_mode: "HTML" },
  );
}
