import { DraftSender, sendTypingAction } from "./draft-sender.js";
import { markdownToTelegramHTML, escapeHtml } from "./formatter.js";
import config from "../config.js";
import logger from "../utils/logger.js";

export class ResponseStream {
  #api;
  #chatId;
  #botToken;
  #maxLen;

  #sender = null;
  #toolBatch = [];

  #queue = [];
  #processing = false;

  constructor({ api, chatId, botToken }) {
    this.#api = api;
    this.#chatId = chatId;
    this.#botToken = botToken;
    this.#maxLen = config.behavior.maxMessageLength;
  }

  async handleEvent(event) {
    this.#queue.push(event);
    if (this.#processing) return;
    this.#processing = true;

    while (this.#queue.length > 0) {
      const evt = this.#queue.shift();
      try {
        await this.#processEvent(evt);
      } catch (err) {
        logger.error({ err, type: evt.type }, "Error processing stream event");
      }
    }

    this.#processing = false;
  }

  async #processEvent(event) {
    switch (event.type) {
      case "text_delta":
        await this.#flushToolBatch();
        await this.#ensureSender().append(event.text);
        break;

      case "tool_call_started": {
        await this.#finalizeSender();
        this.#toolBatch.push({
          callId: event.callId,
          text: `<i>${escapeHtml(event.description)}…</i>`,
          completed: false,
        });
        sendTypingAction(this.#botToken, this.#chatId);
        break;
      }

      case "tool_call_completed": {
        const pending = this.#toolBatch.find(
          (t) => t.callId === event.callId && !t.completed,
        );
        if (pending) {
          pending.text = escapeHtml(event.summary);
          pending.completed = true;
        } else {
          this.#toolBatch.push({
            callId: event.callId,
            text: escapeHtml(event.summary),
            completed: true,
          });
        }
        break;
      }

      case "message_complete":
      case "result":
        await this.#finalizeSender();
        await this.#flushToolBatch();
        break;

      case "permission_auto_approved":
        break;

      case "process_exit":
        await this.#finalizeSender();
        await this.#flushToolBatch();
        await this.#send(
          `⚠️ Agent process exited (code: ${event.code}). ` +
          `Use <code>/clone</code> or <code>/resume</code> to restart.`,
        );
        break;

      case "process_error":
        await this.#send(`⚠️ Agent error: ${escapeHtml(event.error)}`);
        break;

      default:
        break;
    }
  }

  #ensureSender() {
    if (!this.#sender) {
      this.#sender = new DraftSender({
        botToken: this.#botToken,
        chatId: this.#chatId,
        api: this.#api,
        formatFn: markdownToTelegramHTML,
      });
    }
    return this.#sender;
  }

  async #finalizeSender() {
    if (this.#sender) {
      await this.#sender.finalize();
      this.#sender = null;
    }
  }

  async #flushToolBatch() {
    if (this.#toolBatch.length === 0) return;

    const lines = this.#toolBatch.map((t) => t.text);
    this.#toolBatch = [];

    await this.#send(lines.join("\n"));
  }

  async #send(html) {
    const chunks = splitByLength(html, this.#maxLen);
    for (const chunk of chunks) {
      try {
        await this.#api.sendMessage(this.#chatId, chunk, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
      } catch (err) {
        logger.error({ err, chatId: this.#chatId }, "Failed to send message");
      }
    }
  }
}

export function createStreamHandler(api, chatId) {
  const stream = new ResponseStream({
    api,
    chatId,
    botToken: config.telegram.botToken,
  });
  return (event) => stream.handleEvent(event);
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
