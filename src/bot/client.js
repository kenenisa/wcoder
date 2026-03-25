import { Bot, webhookCallback } from "grammy";
import config from "../config.js";
import logger from "../utils/logger.js";

export const bot = new Bot(config.telegram.botToken);

const BOT_COMMANDS = [
  { command: "start", description: "Welcome & onboarding" },
  { command: "github", description: "Set GitHub personal access token" },
  { command: "cursor", description: "Set Cursor API key" },
  { command: "repos", description: "List your GitHub repositories" },
  { command: "clone", description: "Clone a repo and start coding" },
  { command: "switch", description: "Switch to another cloned repo" },
  { command: "model", description: "Change AI model" },
  { command: "mode", description: "Switch agent mode (agent/plan/ask)" },
  { command: "new", description: "Start a new coding session" },
  { command: "sessions", description: "List session history" },
  { command: "resume", description: "Resume a previous session" },
  { command: "status", description: "Current session info" },
  { command: "stop", description: "Stop the Cursor agent" },
  { command: "commit", description: "Commit current changes" },
  { command: "push", description: "Push current branch" },
  { command: "pr", description: "Create a pull request" },
  { command: "branch", description: "Create & switch to a new branch" },
  { command: "diff", description: "Show uncommitted changes" },
  { command: "git", description: "Run an arbitrary git command" },
  { command: "help", description: "Show available commands" },
];

export async function startBot() {
  bot.catch((err) => {
    logger.error({ err: err.error, ctx: err.ctx?.update?.update_id }, "Unhandled bot error");
  });

  await bot.api.setMyCommands(BOT_COMMANDS);

  if (config.webhook.domain) {
    const path = `/webhook/${config.webhook.secret || config.telegram.botToken}`;
    const handleUpdate = webhookCallback(bot, "std/http");

    Bun.serve({
      port: config.webhook.port,
      async fetch(req) {
        if (new URL(req.url).pathname === path) return handleUpdate(req);
        return new Response("OK", { status: 200 });
      },
    });

    const webhookUrl = `https://${config.webhook.domain}${path}`;
    await bot.api.setWebhook(webhookUrl);
    logger.info({ port: config.webhook.port, url: webhookUrl }, "Bot listening via webhook");
  } else {
    await bot.start({
      onStart: () => logger.info("Bot is listening for messages (polling)"),
    });
  }
}

export async function downloadFile(fileId) {
  const file = await bot.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
