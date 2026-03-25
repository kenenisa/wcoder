import config from "../config.js";
import logger from "../utils/logger.js";

const BOT_API = "https://api.telegram.org/bot";

let draftCounter = 0;

export class DraftSender {
  #botToken;
  #chatId;
  #api;
  #formatFn;
  #draftId;
  #accumulated = "";
  #timer = null;
  #debounceMs;
  #maxLen;
  #finalized = false;

  constructor({ botToken, chatId, api, formatFn }) {
    this.#botToken = botToken;
    this.#chatId = chatId;
    this.#api = api;
    this.#formatFn = formatFn;
    this.#draftId = ++draftCounter;
    this.#debounceMs = config.behavior.streamDebounceMs;
    this.#maxLen = config.behavior.maxMessageLength;
  }

  async append(text) {
    if (this.#finalized) return;
    this.#accumulated += text;

    if (this.#accumulated.length >= this.#maxLen) {
      await this.#chunk();
    } else {
      this.#scheduleDraft();
    }
  }

  async finalize() {
    if (this.#finalized) return;
    this.#finalized = true;
    this.#clearTimer();

    if (this.#accumulated.trim()) {
      await this.#sendPermanent(this.#accumulated);
      this.#accumulated = "";
    }
  }

  cancel() {
    this.#finalized = true;
    this.#clearTimer();
    this.#accumulated = "";
  }

  // ── Private ──

  #scheduleDraft() {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#flushDraft();
    }, this.#debounceMs);
  }

  #clearTimer() {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  async #flushDraft() {
    if (!this.#accumulated.trim() || this.#finalized) return;

    try {
      let html = this.#formatFn(this.#accumulated);
      if (html.length > 4096) html = html.slice(0, 4090) + "…";

      await botApiCall(this.#botToken, "sendMessageDraft", {
        chat_id: this.#chatId,
        draft_id: this.#draftId,
        text: html,
        parse_mode: "HTML",
      });
    } catch (err) {
      logger.warn({ err, chatId: this.#chatId }, "sendMessageDraft failed, trying plain text");
      try {
        await botApiCall(this.#botToken, "sendMessageDraft", {
          chat_id: this.#chatId,
          draft_id: this.#draftId,
          text: this.#accumulated.slice(0, 4090),
        });
      } catch {
        // give up on this draft tick
      }
    }
  }

  async #chunk() {
    this.#clearTimer();

    const splitAt = findSplitPoint(this.#accumulated, this.#maxLen);
    const head = this.#accumulated.slice(0, splitAt);
    this.#accumulated = this.#accumulated.slice(splitAt);

    await this.#sendPermanent(head);

    this.#draftId = ++draftCounter;

    if (this.#accumulated.trim()) {
      this.#scheduleDraft();
    }
  }

  async #sendPermanent(rawText) {
    if (!rawText.trim()) return;

    const html = this.#formatFn(rawText);
    const chunks = splitByLength(html, 4096);

    for (const chunk of chunks) {
      try {
        await this.#api.sendMessage(this.#chatId, chunk, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
      } catch (err) {
        logger.warn({ err, chatId: this.#chatId }, "sendMessage with HTML failed, trying plain");
        try {
          await this.#api.sendMessage(this.#chatId, rawText.slice(0, 4096));
        } catch (innerErr) {
          logger.error({ err: innerErr, chatId: this.#chatId }, "sendMessage plain text also failed");
        }
        break;
      }
    }
  }
}

// ── Bot HTTP API helpers ──

export async function botApiCall(botToken, method, params) {
  const url = `${BOT_API}${botToken}/${method}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Bot API ${method} failed: ${resp.status} ${body}`);
  }

  return resp.json();
}

export async function sendTypingAction(botToken, chatId) {
  try {
    await botApiCall(botToken, "sendChatAction", {
      chat_id: chatId,
      action: "typing",
    });
  } catch {
    // best-effort
  }
}

// ── Text splitting utilities ──

function findSplitPoint(text, maxLen) {
  if (text.length <= maxLen) return text.length;

  const paraIdx = text.lastIndexOf("\n\n", maxLen);
  if (paraIdx > maxLen * 0.3) return paraIdx + 2;

  let inCode = false;
  let lastSafeNewline = -1;
  for (let i = 0; i < maxLen; i++) {
    if (text.startsWith("```", i)) {
      inCode = !inCode;
      i += 2;
      continue;
    }
    if (text[i] === "\n" && !inCode) {
      lastSafeNewline = i;
    }
  }
  if (lastSafeNewline > maxLen * 0.3) return lastSafeNewline + 1;

  const nlIdx = text.lastIndexOf("\n", maxLen);
  if (nlIdx > maxLen * 0.3) return nlIdx + 1;

  return maxLen;
}

function splitByLength(text, maxLen) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.3) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}
