export class AppError extends Error {
  constructor(message, code) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class AuthError extends AppError {
  constructor(message = "Authentication required") {
    super(message, "AUTH_ERROR");
  }
}

export class SessionError extends AppError {
  constructor(message = "No active session") {
    super(message, "SESSION_ERROR");
  }
}

export class ACPError extends AppError {
  constructor(message = "Cursor ACP error") {
    super(message, "ACP_ERROR");
  }
}

export class GitError extends AppError {
  constructor(message = "Git operation failed") {
    super(message, "GIT_ERROR");
  }
}

export class GitHubError extends AppError {
  constructor(message = "GitHub API error") {
    super(message, "GITHUB_ERROR");
  }
}
