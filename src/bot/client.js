import { Bot, webhookCallback } from "grammy";
import config from "../config.js";
import logger from "../utils/logger.js";

export const bot = new Bot(config.telegram.botToken);

export async function startBot() {
  bot.catch((err) => {
    logger.error({ err: err.error, ctx: err.ctx?.update?.update_id }, "Unhandled bot error");
  });

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
