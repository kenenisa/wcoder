import { Octokit } from "@octokit/rest";

export function createGitHubClient(token) {
  return new Octokit({ auth: token });
}

export async function listRepos(token, opts = {}) {
  const page = opts.page || 1;
  const perPage = opts.perPage || 10;
  const octokit = createGitHubClient(token);
  const { data, headers } = await octokit.rest.repos.listForAuthenticatedUser({
    sort: "updated",
    direction: "desc",
    per_page: perPage,
    page,
  });

  const linkHeader = headers.link || "";
  const hasNext = linkHeader.includes('rel="next"');

  return {
    repos: data.map((r) => ({
      full_name: r.full_name,
      name: r.name,
      owner: r.owner.login,
      description: r.description,
      language: r.language,
      stars: r.stargazers_count,
      private: r.private,
      default_branch: r.default_branch,
    })),
    page,
    hasNext,
  };
}

export async function createPullRequest(token, owner, repo, { title, head, base, body }) {
  const octokit = createGitHubClient(token);
  const { data } = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    head,
    base,
    body: body || "",
  });
  return {
    number: data.number,
    url: data.html_url,
    title: data.title,
  };
}
