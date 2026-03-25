import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import config from "../config.js";

let db;

export function getDb() {
  if (!db) {
    const dbPath = `${config.paths.data}/wcoder.db`;
    mkdirSync(dirname(dbPath), { recursive: true });
    db = new Database(dbPath, { create: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
  }
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
