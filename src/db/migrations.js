import { getDb } from "./connection.js";
import logger from "../utils/logger.js";

export function runMigrations() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id INTEGER PRIMARY KEY,
      github_token TEXT,
      github_username TEXT,
      cursor_api_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL REFERENCES users(telegram_id),
      title TEXT,
      repo_full_name TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      acp_session_id TEXT,
      model TEXT,
      mode TEXT DEFAULT 'agent',
      branch TEXT DEFAULT 'main',
      status TEXT DEFAULT 'active',
      message_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  logger.info("Database migrations complete");
}
