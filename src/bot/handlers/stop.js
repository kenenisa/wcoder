import { getActiveSession, updateSession } from "../../db/queries.js";
import { stopACPSession } from "../../cursor/session-manager.js";

export async function handleStop(event) {
  const chatId = event.message.chatId || event.message.peerId?.userId;
  const session = getActiveSession(Number(chatId));

  if (!session) {
    await event.message.reply({ message: "No active session to stop." });
    return;
  }

  stopACPSession(Number(chatId));
  updateSession(session.id, { status: "stopped" });

  await event.message.reply({
    message:
      `✓ Session #${session.id} stopped.\n\n` +
      "Use /clone or /resume to start a new session.",
  });
}
