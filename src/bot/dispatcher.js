import { bot } from "./client.js";
import { authMiddleware } from "./middleware/auth.js";
import { sessionMiddleware } from "./middleware/session.js";

import { handleStart } from "./handlers/start.js";
import { handleHelp } from "./handlers/help.js";
import { handleGithub } from "./handlers/github.js";
import { handleCursor } from "./handlers/cursor.js";
import { handleRepos } from "./handlers/repos.js";
import { handleClone } from "./handlers/clone.js";
import { handleNew, handleSessions, handleResume, handleStop } from "./handlers/session.js";
import { handleModel } from "./handlers/model.js";
import { handleMode } from "./handlers/mode.js";
import { handleSwitch } from "./handlers/switch.js";
import { handleStatus } from "./handlers/status.js";
import { handleCommit, handlePush, handlePr, handleBranch, handleDiff, handleGit } from "./handlers/git.js";
import { handleUpdate } from "./handlers/update.js";
import { handleMessage } from "./handlers/message.js";

export function registerAll() {
  bot.use(authMiddleware());
  bot.use(sessionMiddleware());

  bot.command("start", handleStart);
  bot.command("help", handleHelp);
  bot.command("github", handleGithub);
  bot.command("cursor", handleCursor);
  bot.command("repos", handleRepos);
  bot.command("clone", handleClone);
  bot.command("new", handleNew);
  bot.command("sessions", handleSessions);
  bot.command("resume", handleResume);
  bot.command("stop", handleStop);
  bot.command("model", handleModel);
  bot.command("mode", handleMode);
  bot.command("switch", handleSwitch);
  bot.command("status", handleStatus);
  bot.command("commit", handleCommit);
  bot.command("push", handlePush);
  bot.command("pr", handlePr);
  bot.command("branch", handleBranch);
  bot.command("diff", handleDiff);
  bot.command("git", handleGit);
  bot.command("update", handleUpdate);

  bot.on("message:text", handleMessage);
  bot.on("message:photo", handleMessage);
}
