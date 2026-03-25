import { getDb } from "./connection.js";

// ── Users ──

export function getUser(telegramId) {
  return getDb().query("SELECT * FROM users WHERE telegram_id = ?").get(telegramId);
}

export function upsertUser(telegramId, fields) {
  const user = getUser(telegramId);
  if (!user) {
    getDb()
      .query(
        `INSERT INTO users (telegram_id, github_token, github_username, cursor_api_key)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        telegramId,
        fields.github_token ?? null,
        fields.github_username ?? null,
        fields.cursor_api_key ?? null
      );
  } else {
    const sets = [];
    const params = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) {
        sets.push(`${k} = ?`);
        params.push(v);
      }
    }
    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    params.push(telegramId);
    getDb()
      .query(`UPDATE users SET ${sets.join(", ")} WHERE telegram_id = ?`)
      .run(...params);
  }
}

// ── Sessions ──

export function createSession(telegramId, data) {
  const result = getDb()
    .query(
      `INSERT INTO sessions (telegram_id, title, repo_full_name, repo_path, acp_session_id, model, mode, branch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      telegramId,
      data.title ?? null,
      data.repo_full_name,
      data.repo_path,
      data.acp_session_id ?? null,
      data.model ?? null,
      data.mode ?? "agent",
      data.branch ?? "main"
    );
  return result.lastInsertRowid;
}

export function getSession(id) {
  return getDb().query("SELECT * FROM sessions WHERE id = ?").get(id);
}

export function getActiveSession(telegramId) {
  return getDb()
    .query("SELECT * FROM sessions WHERE telegram_id = ? AND status = 'active' ORDER BY last_active_at DESC LIMIT 1")
    .get(telegramId);
}

export function getUserSessions(telegramId, limit = 10, offset = 0) {
  return getDb()
    .query("SELECT * FROM sessions WHERE telegram_id = ? ORDER BY last_active_at DESC LIMIT ? OFFSET ?")
    .all(telegramId, limit, offset);
}

export function getUserSessionCount(telegramId) {
  return getDb()
    .query("SELECT COUNT(*) as count FROM sessions WHERE telegram_id = ?")
    .get(telegramId).count;
}

export function updateSession(id, fields) {
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) {
      sets.push(`${k} = ?`);
      params.push(v);
    }
  }
  if (sets.length === 0) return;
  params.push(id);
  getDb()
    .query(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
}

export function pauseActiveSession(telegramId) {
  getDb()
    .query("UPDATE sessions SET status = 'paused' WHERE telegram_id = ? AND status = 'active'")
    .run(telegramId);
}

export function incrementMessageCount(sessionId) {
  getDb()
    .query("UPDATE sessions SET message_count = message_count + 1, last_active_at = datetime('now') WHERE id = ?")
    .run(sessionId);
}

export const getSessionById = getSession;
export const listSessions = getUserSessions;
export const countSessions = getUserSessionCount;
