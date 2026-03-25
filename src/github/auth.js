import { Octokit } from "@octokit/rest";
import { GitHubError } from "../utils/errors.js";

export async function validateGithubToken(token) {
  try {
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.rest.users.getAuthenticated();
    return { valid: true, username: data.login, name: data.name };
  } catch (err) {
    if (err.status === 401) {
      return { valid: false, error: "Invalid or expired token" };
    }
    throw new GitHubError(`GitHub API error: ${err.message}`);
  }
}
