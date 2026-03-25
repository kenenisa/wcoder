import { getActiveSession } from "../../db/queries.js";
import { getACPClient } from "../../cursor/session-manager.js";
import { getCurrentBranch } from "../../git/operations.js";
import { escapeHtml } from "../../streaming/formatter.js";

export async function handleStatus(ctx) {
  const senderId = ctx.from.id;
  const session = getActiveSession(senderId);

  if (!session) {
    await ctx.reply(
      "No active session.\nUse <code>/clone owner/repo</code> to start one.",
      { parse_mode: "HTML" },
    );
    return;
  }

  let liveBranch = session.branch;
  try {
    liveBranch = await getCurrentBranch(session.repo_path);
  } catch {
    // fall back to stored branch
  }

  const acpEntry = getACPClient(senderId);
  const agentStatus = acpEntry?.client?.alive ? "running" : "stopped";

  const title = session.title || session.repo_full_name;

  const lines = [
    `<b>Session #${session.id}</b>: ${escapeHtml(title)}`,
    ``,
    `<b>Repository:</b> <code>${escapeHtml(session.repo_full_name)}</code>`,
    `<b>Branch:</b> <code>${escapeHtml(liveBranch)}</code>`,
    `<b>Model:</b> <code>${escapeHtml(session.model || "default")}</code>`,
    `<b>Mode:</b> <code>${escapeHtml(session.mode || "agent")}</code>`,
    `<b>Agent:</b> ${agentStatus === "running" ? "🟢 running" : "🔴 stopped"}`,
    `<b>Messages:</b> ${session.message_count || 0}`,
  ];

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}
