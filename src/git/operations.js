import simpleGit from "simple-git";
import { existsSync } from "node:fs";
import { GitError } from "../utils/errors.js";
import logger from "../utils/logger.js";

const BLOCKED_PATTERNS = [
  /push\s+--force/i,
  /push\s+-f\b/i,
  /credential/i,
  /config\s+--global/i,
];

export function getGit(repoPath) {
  if (!existsSync(repoPath)) {
    throw new GitError(`Repository path does not exist: ${repoPath}`);
  }
  return simpleGit(repoPath);
}

export async function cloneRepo(token, fullName, destPath) {
  const url = `https://${token}@github.com/${fullName}.git`;
  logger.info({ repo: fullName, dest: destPath }, "Cloning repository");
  const git = simpleGit();
  await git.clone(url, destPath);
  // Remove token from remote URL after cloning for safety
  const repoGit = simpleGit(destPath);
  await repoGit.remote([
    "set-url",
    "origin",
    `https://github.com/${fullName}.git`,
  ]);
  return repoGit;
}

export async function configureCredentials(repoPath, token) {
  const git = getGit(repoPath);
  await git.addConfig("credential.helper", "store", false, "local");
  // Set the remote with the embedded token for push operations
  const remotes = await git.getRemotes(true);
  const origin = remotes.find((r) => r.name === "origin");
  if (origin) {
    const url = origin.refs.push || origin.refs.fetch;
    const authedUrl = url.replace(
      "https://github.com/",
      `https://${token}@github.com/`
    );
    await git.remote(["set-url", "origin", authedUrl]);
  }
}

export async function getCurrentBranch(repoPath) {
  const git = getGit(repoPath);
  const branch = await git.revparse(["--abbrev-ref", "HEAD"]);
  return branch.trim();
}

export async function commitAll(repoPath, message) {
  const git = getGit(repoPath);
  await git.add("-A");
  const status = await git.status();
  if (status.staged.length === 0 && status.created.length === 0 && status.modified.length === 0 && status.deleted.length === 0) {
    return { empty: true };
  }
  const result = await git.commit(message);
  return {
    empty: false,
    hash: result.commit,
    summary: result.summary,
  };
}

export async function push(repoPath, remote = "origin", branch = null) {
  const git = getGit(repoPath);
  if (!branch) {
    branch = await getCurrentBranch(repoPath);
  }
  await git.push(remote, branch, ["--set-upstream"]);
  return { remote, branch };
}

export async function createBranch(repoPath, name) {
  const git = getGit(repoPath);
  await git.checkoutLocalBranch(name);
  return name;
}

export async function getDiff(repoPath) {
  const git = getGit(repoPath);
  const diff = await git.diff();
  const staged = await git.diff(["--staged"]);
  return { unstaged: diff, staged };
}

export async function getStatus(repoPath) {
  const git = getGit(repoPath);
  return await git.status();
}

export async function runGitCommand(repoPath, command) {
  // Safety check
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      throw new GitError(
        `Blocked: "${command}" is not allowed. Dangerous git operations are restricted.`
      );
    }
  }

  const git = getGit(repoPath);
  const args = command.split(/\s+/);
  const result = await git.raw(args);
  return result;
}
