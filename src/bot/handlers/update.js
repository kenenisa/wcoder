import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import pkg from "../../../package.json";
import config from "../../config.js";
import logger from "../../utils/logger.js";

const ARCH_MAP = { x64: "x64", arm64: "arm64" };
const OS_MAP = { linux: "linux", darwin: "darwin" };

export async function handleUpdate(ctx) {
  if (!config.adminUserId || ctx.from?.id !== config.adminUserId) {
    await ctx.reply("This command is restricted to the bot administrator.");
    return;
  }

  if (!config.githubRepo) {
    await ctx.reply("GITHUB_REPO is not configured.");
    return;
  }

  const os = OS_MAP[process.platform];
  const arch = ARCH_MAP[process.arch];
  if (!os || !arch) {
    await ctx.reply(`Unsupported platform: ${process.platform}/${process.arch}`);
    return;
  }

  const assetName = `wcoder-${os}-${arch}`;
  await ctx.reply(`Current version: <b>${pkg.version}</b>\nChecking for updates…`, { parse_mode: "HTML" });

  try {
    const releaseRes = await fetch(
      `https://api.github.com/repos/${config.githubRepo}/releases/latest`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!releaseRes.ok) throw new Error(`GitHub API: ${releaseRes.status}`);
    const release = await releaseRes.json();

    const latestTag = release.tag_name;
    const latestVersion = latestTag.replace(/^v/, "");

    if (latestVersion === pkg.version) {
      await ctx.reply(`Already on the latest version (<b>${pkg.version}</b>).`, { parse_mode: "HTML" });
      return;
    }

    const asset = release.assets.find((a) => a.name === `${assetName}.tar.gz`);
    if (!asset) throw new Error(`No release asset for ${assetName}`);

    await ctx.reply(`Downloading <b>${latestTag}</b> (${assetName})…`, { parse_mode: "HTML" });

    const downloadRes = await fetch(asset.browser_download_url);
    if (!downloadRes.ok) throw new Error(`Download failed: ${downloadRes.status}`);

    const updatesDir = join(config.paths.data, "updates");
    const tarPath = join(updatesDir, `${assetName}.tar.gz`);
    const binPath = join(updatesDir, assetName);
    const targetPath = join(updatesDir, "wcoder-new");

    await Bun.write(tarPath, downloadRes);

    let result = spawnSync("tar", ["-xzf", tarPath, "-C", updatesDir]);
    if (result.status !== 0) throw new Error("Failed to extract archive");

    const { renameSync } = await import("node:fs");
    renameSync(binPath, targetPath);
    await unlink(tarPath).catch(() => {});

    result = spawnSync("sudo", [
      "install", "-m", "755", targetPath, process.execPath,
    ]);
    if (result.status !== 0) throw new Error("Failed to install binary (sudo permission issue?)");
    await unlink(targetPath).catch(() => {});

    await ctx.reply(`Updated <b>${pkg.version}</b> → <b>${latestTag}</b>. Restarting…`, { parse_mode: "HTML" });
    logger.info({ from: pkg.version, to: latestTag }, "Self-update complete, restarting");

    setTimeout(() => process.exit(0), 500);
  } catch (err) {
    logger.error({ err }, "Self-update failed");
    await ctx.reply(`Update failed: ${err.message}`);
  }
}
