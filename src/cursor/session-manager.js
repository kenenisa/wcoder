import { ACPClient } from "./acp-client.js";
import { parseSessionUpdate, formatToolEvent } from "./event-parser.js";
import {
  createSession,
  getSession,
  getActiveSession,
  updateSession,
  pauseActiveSession,
} from "../db/queries.js";
import { getCurrentBranch } from "../git/operations.js";
import config from "../config.js";
import logger from "../utils/logger.js";

/**
 * In-memory map: telegramId → { acpClient, onEvent, promptQueue, prompting }
 */
const activeSessions = new Map();

export function getSessionManager() {
  return activeSessions;
}

export function getACPClient(telegramId) {
  const entry = activeSessions.get(Number(telegramId));
  if (!entry) return null;
  return { client: entry.acpClient, chatId: telegramId };
}

export function getActiveACPClient(telegramId) {
  return activeSessions.get(Number(telegramId))?.acpClient ?? null;
}

// ── Start a new session (clone handler uses this) ──

export async function startSession(telegramId, opts) {
  telegramId = Number(telegramId);

  killExisting(telegramId);
  pauseActiveSession(telegramId);

  const acpClient = new ACPClient(opts.cursorApiKey, opts.repoPath);
  await acpClient.start();
  const acpSessionId = await acpClient.newSession(opts.mode || "agent");

  const sessionId = createSession(telegramId, {
    title: opts.title || opts.repoFullName,
    repo_full_name: opts.repoFullName,
    repo_path: opts.repoPath,
    acp_session_id: acpSessionId,
    model: opts.model || config.behavior.defaultModel,
    mode: opts.mode || "agent",
    branch: opts.branch || "main",
  });

  const entry = {
    acpClient,
    onEvent: opts.onEvent,
    promptQueue: [],
    prompting: false,
  };
  activeSessions.set(telegramId, entry);
  wireACPEvents(telegramId, acpClient, entry);

  logger.info({ telegramId, sessionId, acpSessionId }, "Session started");
  return getSession(sessionId);
}

// ── New session on the same repo ──

export async function newSessionOnCurrentRepo(telegramId, opts) {
  telegramId = Number(telegramId);
  const current = getActiveSession(telegramId);
  if (!current) throw new Error("No active session to replace.");

  killExisting(telegramId);
  pauseActiveSession(telegramId);

  const acpClient = new ACPClient(opts.cursorApiKey, current.repo_path);
  await acpClient.start();
  const acpSessionId = await acpClient.newSession(current.mode || "agent");

  let branch;
  try {
    branch = await getCurrentBranch(current.repo_path);
  } catch {
    branch = current.branch;
  }

  const sessionId = createSession(telegramId, {
    title: opts.title || current.repo_full_name,
    repo_full_name: current.repo_full_name,
    repo_path: current.repo_path,
    acp_session_id: acpSessionId,
    model: current.model,
    mode: current.mode,
    branch,
  });

  const entry = {
    acpClient,
    onEvent: opts.onEvent,
    promptQueue: [],
    prompting: false,
  };
  activeSessions.set(telegramId, entry);
  wireACPEvents(telegramId, acpClient, entry);

  logger.info({ telegramId, sessionId, acpSessionId }, "New session on same repo");
  return getSession(sessionId);
}

// ── Resume a previous session ──

export async function resumeSession(telegramId, dbSessionId, opts) {
  telegramId = Number(telegramId);
  const target = getSession(dbSessionId);
  if (!target) throw new Error(`Session #${dbSessionId} not found.`);

  killExisting(telegramId);
  pauseActiveSession(telegramId);

  const acpClient = new ACPClient(opts.cursorApiKey, target.repo_path);
  await acpClient.start();
  await acpClient.loadSession(target.acp_session_id);

  updateSession(dbSessionId, { status: "active", last_active_at: new Date().toISOString() });

  const entry = {
    acpClient,
    onEvent: opts.onEvent,
    promptQueue: [],
    prompting: false,
  };
  activeSessions.set(telegramId, entry);
  wireACPEvents(telegramId, acpClient, entry);

  logger.info({ telegramId, dbSessionId, acpSessionId: target.acp_session_id }, "Session resumed");
  return target;
}

// ── Switch model (requires new ACP process) ──

export async function switchModel(telegramId, model, opts) {
  telegramId = Number(telegramId);
  const current = getActiveSession(telegramId);
  if (!current) throw new Error("No active session.");

  killExisting(telegramId);

  const acpClient = new ACPClient(opts.cursorApiKey, current.repo_path);
  acpClient.model = model;
  await acpClient.start();
  const acpSessionId = await acpClient.newSession(current.mode || "agent");

  updateSession(current.id, {
    model,
    acp_session_id: acpSessionId,
    last_active_at: new Date().toISOString(),
  });

  const entry = {
    acpClient,
    onEvent: opts.onEvent,
    promptQueue: [],
    prompting: false,
  };
  activeSessions.set(telegramId, entry);
  wireACPEvents(telegramId, acpClient, entry);

  logger.info({ telegramId, model, acpSessionId }, "Model switched");
}

// ── Switch mode (new ACP session, same process) ──

export async function switchMode(telegramId, mode, opts) {
  telegramId = Number(telegramId);
  const current = getActiveSession(telegramId);
  if (!current) throw new Error("No active session.");

  const entry = activeSessions.get(telegramId);
  if (!entry?.acpClient?.alive) {
    throw new Error("Agent process is not running. Use /clone or /resume to restart.");
  }

  const acpSessionId = await entry.acpClient.newSession(mode);

  updateSession(current.id, {
    mode,
    acp_session_id: acpSessionId,
    last_active_at: new Date().toISOString(),
  });

  logger.info({ telegramId, mode, acpSessionId }, "Mode switched");
}

// ── Send a prompt (with queueing) ──

export async function sendPrompt(telegramId, text, images = []) {
  telegramId = Number(telegramId);
  const entry = activeSessions.get(telegramId);
  if (!entry?.acpClient?.alive) {
    throw new Error("No active ACP session. Use /clone or /resume to start one.");
  }

  let fullPrompt = text;
  if (images.length > 0) {
    const paths = images.map((p) => `Image: ${p}`).join("\n");
    fullPrompt = `${text}\n\n${paths}`;
  }

  return new Promise((resolve, reject) => {
    entry.promptQueue.push({ text: fullPrompt, resolve, reject });
    drainQueue(entry);
  });
}

async function drainQueue(entry) {
  if (entry.prompting || entry.promptQueue.length === 0) return;
  entry.prompting = true;

  while (entry.promptQueue.length > 0) {
    const { text, resolve, reject } = entry.promptQueue.shift();
    try {
      const result = await entry.acpClient.prompt(text);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  }

  entry.prompting = false;
}

// ── Stop ──

export function stopSession(telegramId) {
  telegramId = Number(telegramId);
  const session = getActiveSession(telegramId);
  if (session) {
    updateSession(session.id, { status: "stopped" });
  }
  killExisting(telegramId);
}

export function stopACPSession(telegramId) {
  stopSession(telegramId);
}

// ── Internal ──

function killExisting(telegramId) {
  const entry = activeSessions.get(telegramId);
  if (entry?.acpClient) {
    entry.acpClient.kill();
    activeSessions.delete(telegramId);
  }
}

function wireACPEvents(telegramId, acpClient, entry) {
  const onEvent = entry.onEvent;
  if (!onEvent) return;

  acpClient.on("session_update", (update) => {
    const parsed = parseSessionUpdate(update);
    if (!parsed) return;

    switch (parsed.type) {
      case "text_chunk":
        onEvent({ type: "text_delta", text: parsed.text });
        break;

      case "tool_start": {
        const desc = formatToolEvent(parsed);
        onEvent({
          type: "tool_call_started",
          callId: parsed.callId,
          tool: parsed.tool.name,
          description: desc,
        });
        break;
      }

      case "tool_complete": {
        const summary = formatToolEvent(parsed);
        onEvent({
          type: "tool_call_completed",
          callId: parsed.callId,
          tool: parsed.tool.name,
          summary,
        });
        break;
      }

      case "message_complete":
        onEvent({ type: "message_complete" });
        break;

      case "turn_complete":
        onEvent({ type: "result", stopReason: parsed.stopReason });
        break;
    }
  });

  acpClient.on("exit", ({ code, signal }) => {
    onEvent({ type: "process_exit", code, signal });
    const session = getActiveSession(telegramId);
    if (session) {
      updateSession(session.id, { status: "stopped" });
    }
    activeSessions.delete(telegramId);
    logger.warn({ telegramId, code, signal }, "ACP process exited, session marked stopped");
  });

  acpClient.on("auth_error", (message) => {
    onEvent({
      type: "process_error",
      error: "Cursor authentication failed. Update your API key with /cursor",
    });
    logger.error({ telegramId, message }, "Cursor auth error");
  });
}
