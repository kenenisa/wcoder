import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import pkg from "../../package.json";
import logger from "../utils/logger.js";
import { ACPError } from "../utils/errors.js";
import config from "../config.js";

/**
 * ACP Client — manages a single `agent acp` child process
 * and provides JSON-RPC communication over stdio.
 */
export class ACPClient extends EventEmitter {
  constructor(apiKey, cwd) {
    super();
    this.apiKey = apiKey;
    this.cwd = cwd;
    this.model = null;
    this.process = null;
    this.rl = null;
    this.nextId = 1;
    this.pending = new Map();
    this.sessionId = null;
    this.alive = false;
  }

  async start() {
    const args = ["--api-key", this.apiKey];
    if (this.model) args.push("--model", this.model);
    args.push("acp");

    this.process = spawn("agent", args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: this.cwd,
    });

    this.alive = true;

    this.process.on("error", (err) => {
      this.alive = false;
      const msg = err.code === "ENOENT"
        ? "Cursor CLI ('agent') not found. Is it installed and in PATH?"
        : `Failed to start agent process: ${err.message}`;
      logger.error({ err, cwd: this.cwd }, msg);
      this._rejectAllPending(msg);
      this.emit("exit", { code: 1, signal: null });
    });

    this.process.on("exit", (code, signal) => {
      this.alive = false;
      logger.warn({ code, signal, cwd: this.cwd }, "ACP process exited");
      this._rejectAllPending(`ACP process exited (code=${code})`);
      this.emit("exit", { code, signal });
    });

    this.process.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      logger.debug({ stderr: text }, "ACP stderr");

      if (text.includes("authentication") || text.includes("unauthorized") || text.includes("invalid api key")) {
        this.emit("auth_error", text);
      }
    });

    this.rl = createInterface({ input: this.process.stdout });
    this.rl.on("line", (line) => this._handleLine(line));

    await this._initialize();
    await this._authenticate();
  }

  _handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      logger.debug({ line }, "Non-JSON line from ACP");
      return;
    }

    // Response to a request we sent
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const waiter = this.pending.get(msg.id);
      if (waiter) {
        this.pending.delete(msg.id);
        if (msg.error) {
          waiter.reject(new ACPError(msg.error.message || JSON.stringify(msg.error)));
        } else {
          waiter.resolve(msg.result);
        }
      }
      return;
    }

    // Notification from ACP
    if (msg.method) {
      this._handleNotification(msg);
    }
  }

  _handleNotification(msg) {
    switch (msg.method) {
      case "session/update": {
        const update = msg.params?.update;
        this.emit("session_update", update, msg.params);
        break;
      }
      case "session/request_permission": {
        this._handlePermission(msg);
        break;
      }
      case "cursor/update_todos":
      case "cursor/task":
      case "cursor/generate_image":
      case "cursor/ask_question":
      case "cursor/create_plan":
        this.emit("cursor_extension", msg.method, msg.params);
        break;
      default:
        logger.debug({ method: msg.method }, "Unhandled ACP notification");
    }
  }

  _handlePermission(msg) {
    if (config.behavior.autoApproveTools) {
      this._respond(msg.id, {
        outcome: { outcome: "selected", optionId: "allow-always" },
      });
    } else {
      this.emit("permission_request", msg.id, msg.params);
    }
  }

  _rejectAllPending(message) {
    for (const [, waiter] of this.pending) {
      waiter.reject(new ACPError(message));
    }
    this.pending.clear();
  }

  _send(method, params, timeoutMs = 30_000) {
    if (!this.alive || !this.process) {
      return Promise.reject(new ACPError("ACP process is not running."));
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    try {
      this.process.stdin.write(payload);
    } catch (err) {
      return Promise.reject(new ACPError(`Failed to write to ACP: ${err.message}`));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ACPError(`ACP request '${method}' timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  _respond(id, result) {
    const payload = JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n";
    this.process.stdin.write(payload);
  }

  async _initialize() {
    await this._send("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "wcoder", version: pkg.version },
    });
  }

  async _authenticate() {
    await this._send("authenticate", { methodId: "cursor_login" });
  }

  async newSession(mode = "agent") {
    const result = await this._send("session/new", {
      cwd: this.cwd,
      mode,
      mcpServers: [],
    });
    this.sessionId = result.sessionId;
    return this.sessionId;
  }

  async loadSession(sessionId) {
    const result = await this._send("session/load", {
      sessionId,
    });
    this.sessionId = sessionId;
    return result;
  }

  async prompt(text) {
    if (!this.sessionId) {
      throw new ACPError("No active ACP session. Call newSession() first.");
    }
    return this._send("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    }, 10 * 60_000);
  }

  async cancel() {
    if (!this.sessionId) return;
    try {
      await this._send("session/cancel", { sessionId: this.sessionId });
    } catch {
      // Ignore cancel errors
    }
  }

  respondToPermission(requestId, optionId = "allow-once") {
    this._respond(requestId, {
      outcome: { outcome: "selected", optionId },
    });
  }

  kill() {
    this.alive = false;
    if (this.process) {
      this.process.stdin.end();
      this.process.kill();
      this.process = null;
    }
    this.pending.clear();
  }
}
