# WCoder — Telegram Bot for Agentic Coding via Cursor CLI

## 1. Overview

WCoder is a Bun-based application that exposes a Telegram bot as a conversational interface to Cursor CLI's agent mode. Users chat with the bot as they would with Cursor in an IDE — sending natural language prompts, receiving streamed responses, reviewing tool calls, and managing git workflows — all from within Telegram.

The bot authenticates users via GitHub personal access tokens, lets them browse and select repositories, clones chosen repos to the server's filesystem, and spawns Cursor CLI (via ACP — Agent Client Protocol) against those repos. Every message the user sends in the chat is forwarded to the active Cursor agent session; every response chunk is streamed back to Telegram using the `sendMessageDraft` Bot API method for a smooth, non-flickering experience.

---

## 2. Goals & Non-Goals

### Goals

- Provide a fully functional Cursor-like agentic coding experience through Telegram.
- Stream agent responses in real-time using `sendMessageDraft`.
- Support GitHub operations (clone, commit, push, PR creation) natively.
- Support image uploads so the agent can reason about screenshots/mockups.
- Support switching between repos, models, and agent modes mid-conversation.
- Lay groundwork for swapping in alternative CLI backends (Claude CLI, GitHub Copilot CLI, wcoder) in the future.

### Non-Goals (v1)

- Multi-user concurrency on a single server (v1 targets single-user or small-team use).
- A web dashboard or admin panel.
- Voice input support.
- File download/upload beyond images.

---

## 3. Architecture

```
┌──────────────┐        ┌─────────────────────────────────────────────┐
│              │  Bot   │                 WCoder Server                │
│   Telegram   │  API   │                                             │
│    Client    │◄──────►│  ┌───────────┐   ┌──────────────────────┐   │
│   (User)     │        │  │  Bot Core │   │  Session Manager     │   │
│              │        │  │  (grammY) │──►│  (per-user state)    │   │
└──────────────┘        │  └───────────┘   └──────┬───────────────┘   │
                        │                         │                   │
                        │         ┌───────────────┼──────────┐        │
                        │         ▼               ▼          ▼        │
                        │  ┌────────────┐  ┌───────────┐ ┌────────┐  │
                        │  │ Cursor ACP │  │  GitHub   │ │  Git   │  │
                        │  │  Bridge    │  │  Service  │ │ Service│  │
                        │  │ (stdio)    │  │ (REST API)│ │(shell) │  │
                        │  └─────┬──────┘  └───────────┘ └────────┘  │
                        │        │                                    │
                        │        ▼                                    │
                        │  ┌────────────┐                             │
                        │  │ Cursor CLI │                             │
                        │  │  (agent    │                             │
                        │  │   acp)     │                             │
                        │  └────────────┘                             │
                        └─────────────────────────────────────────────┘
```

### Component Breakdown


| Component             | Responsibility                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Bot Core (grammY)** | Connects to Telegram via Bot API. Receives messages, dispatches commands via middleware, calls `sendMessageDraft` for streaming, sends final messages.                                      |
| **Session Manager**   | Maintains per-user state: GitHub token, active repo, active Cursor ACP process, current model/mode, draft IDs, conversation history references.                                            |
| **Cursor ACP Bridge** | Spawns `agent acp` as a child process per active session. Sends JSON-RPC requests (`session/prompt`, `session/new`, etc.) to stdin, parses NDJSON responses from stdout, and emits events. |
| **GitHub Service**    | Uses the GitHub REST API (via `@octokit/rest`) with the user's PAT to list repos, create PRs, etc.                                                                                         |
| **Git Service**       | Executes git commands (clone, commit, push, branch) in the cloned repo directory via `child_process`.                                                                                      |


---

## 4. Technology Stack


| Layer              | Technology                          | Rationale                                                                                                                                            |
| ------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime            | Bun 1.2+                            | Fast startup, native TypeScript support, built-in SQLite, excellent child_process and streaming support                                              |
| Language           | JavaScript (ESM)                    | User requirement                                                                                                                                     |
| Telegram Bot      | grammY (`grammy` npm)               | Bot API framework; built-in middleware, command routing, and direct access to all Bot API methods including `sendMessageDraft`                       |
| Cursor Integration | Cursor CLI via ACP (stdio JSON-RPC) | Official protocol for custom client integrations; supports sessions, streaming, permissions                                                          |
| GitHub API         | `@octokit/rest`                     | Official GitHub SDK                                                                                                                                  |
| Git Operations     | `simple-git`                        | Mature git wrapper for Node.js                                                                                                                       |
| Config / Secrets   | Bun native `.env` loading           | `BOT_TOKEN`, `ENCRYPTION_KEY`                                                                                                                        |
| Data Persistence   | SQLite (`bun:sqlite`)               | Built into Bun; zero-dependency; stores user tokens, session metadata, repo mappings                                                                 |


---

## 5. User Flow

### 5.1 Onboarding

```
User: /start
Bot:  Welcome to WCoder! I'm your coding assistant powered by Cursor.

      To get started, I need two things:

      1. A GitHub Personal Access Token (PAT) with `repo` scope
         Generate one here: https://github.com/settings/tokens/new?scopes=repo

      2. A Cursor API key for the AI agent
         Get yours at: https://cursor.com/settings/api-keys

      Send them to me with:
      /github ghp_xxxxxxxxxxxx
      /cursor sk-cursor-xxxxxxxxxxxx
```

```
User: /github ghp_abc123...
Bot:  ✓ GitHub token verified! Connected as @username.
      You have access to 47 repositories.

      Now send your Cursor API key with:
      /cursor sk-cursor-xxxxxxxxxxxx
```

```
User: /cursor sk-cursor-abc123...
Bot:  ✓ Cursor API key verified!

      You're all set. Use /repos to browse your repositories,
      or /clone owner/repo to get started.
```

### 5.2 Repository Selection & Activation

```
User: /repos
Bot:  Your repositories (page 1/5):

      1. user/frontend-app          ★ 12  (TypeScript)
      2. user/api-server            ★ 8   (Python)
      3. user/mobile-app            ★ 3   (Dart)
      ...

      Use /clone <owner/repo> to clone and start coding.
      Use /repos 2 for the next page.
```

```
User: /clone user/frontend-app
Bot:  Cloning user/frontend-app...
      ✓ Cloned to /data/repos/user/frontend-app
      ✓ Cursor agent started on this repository.

      You can now send me prompts and I'll code on this repo.
      Try: "Refactor the auth module to use JWT"
```

### 5.3 Coding Conversation

Every plain text message (non-command) is forwarded to the Cursor agent:

```
User: Add a dark mode toggle to the settings page

Bot:  [streams via sendMessageDraft]
      I'll add a dark mode toggle to the settings page. Let me first
      look at the existing settings component...

      📖 Reading src/components/Settings.tsx
      📖 Reading src/styles/theme.ts

      I can see the current settings layout. I'll:
      1. Add a theme context provider
      2. Create a toggle component
      3. Update the settings page

      ✏️ Writing src/contexts/ThemeContext.tsx (42 lines)
      ✏️ Editing src/components/Settings.tsx (+15 lines)
      ✏️ Editing src/styles/theme.ts (+28 lines)

      Done! I've added a dark mode toggle to the settings page.
      The toggle persists the user's preference in localStorage.
```

### 5.4 Git Operations

```
User: /commit
Bot:  Generating commit message from staged changes...

      Commit message: "feat: add dark mode toggle to settings page"
      ✓ Committed (abc1234)

User: /push
Bot:  ✓ Pushed to origin/main

User: /pr
Bot:  Creating PR from current branch...
      ✓ PR #42 created: "feat: add dark mode toggle to settings page"
      🔗 https://github.com/user/frontend-app/pull/42
```

### 5.5 Session Management

Users can start new sessions and resume old ones:

```
User: /new refactor auth module
Bot:  ✓ Previous session saved: "dark mode toggle" (#3)
      ✓ New session started: "refactor auth module" (#4)
      Repository: user/frontend-app (main)

      Send me a prompt to get started.
```

```
User: /sessions
Bot:  Your sessions:

      → #4  refactor auth module     user/frontend-app  (active)
        #3  dark mode toggle         user/frontend-app  2 hours ago
        #2  fix login bug            user/api-server    yesterday
        #1  initial setup            user/frontend-app  3 days ago

      Use /resume <id> to switch to a previous session.
```

```
User: /resume 3
Bot:  ✓ Resumed session #3: "dark mode toggle"
      Repository: user/frontend-app (main)

      Conversation context restored. You can continue where you left off.
```

### 5.6 Image Input

Images can include a caption, which is used as the prompt alongside the image:

```
User: [sends a screenshot of a UI mockup]
      Caption: "Make this page look like this design"

Bot:  [streams via sendMessageDraft]
      I can see the mockup. Let me analyze the layout...
      [continues with code changes]
```

If no caption is provided, the bot uses a default prompt like "Analyze this image and apply any relevant changes."

---

## 6. Telegram Bot Interface

### 6.1 Commands


| Command                        | Description                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `/start`                       | Welcome message and onboarding instructions                                                 |
| `/github <pat>`                | Store GitHub PAT (message deleted from chat immediately for security)                       |
| `/cursor <api_key>`            | Store Cursor API key (message deleted from chat immediately for security)                   |
| `/repos [page]`                | List user's GitHub repositories with pagination                                             |
| `/clone <owner/repo> [branch]` | Clone a repo and start a Cursor agent session                                               |
| `/switch <owner/repo>`         | Switch to a different already-cloned repo                                                   |
| `/model <model_name>`          | Change the AI model (e.g., `claude-4-sonnet`, `gpt-4.1`)                                    |
| `/mode <agent|plan|ask>`       | Switch Cursor agent mode                                                                    |
| `/commit [message]`            | Commit current changes (auto-generates message if omitted)                                  |
| `/push [remote] [branch]`      | Push current branch                                                                         |
| `/pr [title]`                  | Create a PR from the current branch                                                         |
| `/branch <name>`               | Create and switch to a new branch                                                           |
| `/git <command>`               | Execute an arbitrary git command                                                            |
| `/status`                      | Show current session info (repo, branch, model, mode)                                       |
| `/diff`                        | Show current uncommitted changes                                                            |
| `/new [title]`                 | Start a new session on the current repo (saves the current session to history)              |
| `/sessions [page]`             | List past and current sessions with titles, repos, and timestamps                           |
| `/resume <id>`                 | Resume a previous session by ID (restores full conversation context via ACP `session/load`) |
| `/stop`                        | Stop the current Cursor agent process and mark session as stopped                           |
| `/help`                        | Show available commands                                                                     |


### 6.2 Message Handling

- **Text messages** → forwarded as prompts to Cursor ACP `session/prompt`
- **Photo/image messages** → downloaded, saved to a temp path, and referenced in the prompt sent to Cursor (as a file path the agent can read). The image caption, if present, is used as the prompt text; otherwise a default analysis prompt is sent.
- **Document messages** → if an image format, treated as above (caption included)
- **Reply to a bot message** → treated as a follow-up prompt with context

### 6.3 Response Streaming via `sendMessageDraft`

The `sendMessageDraft` Bot API method (available since Bot API 9.3, unrestricted since 9.5) is the primary mechanism for delivering responses:

```
POST https://api.telegram.org/bot<token>/sendMessageDraft
{
  "chat_id": 123456789,
  "draft_id": <unique_nonzero_int>,
  "text": "<partial_response_so_far>",
  "parse_mode": "HTML"
}
```

**Streaming strategy:**

1. On receiving a `session/update` with `agent_message_chunk`, append the text delta to an accumulator.
2. Every ~150ms (debounced), call `sendMessageDraft` with the accumulated text so far, using a consistent `draft_id` for the current response.
3. When the response is complete (next tool call starts, or `result` event), send the final message via `sendMessage` — this replaces the draft with a permanent message.
4. For tool call events (file reads, writes, shell commands), send them as separate short messages or inline status updates.
5. Start a new `draft_id` for the next assistant message segment.

**Why direct HTTP for `sendMessageDraft`?**

While grammY provides access to standard Bot API methods, `sendMessageDraft` (Bot API 9.3+) may not yet be in grammY's typed method list. We call it directly via HTTP (`fetch`) to `https://api.telegram.org/bot<token>/sendMessageDraft` for streaming drafts. All other bot operations use grammY's built-in API methods.

### 6.4 Formatting for Telegram

Telegram supports a limited subset of formatting. We use **HTML parse mode** for maximum control:


| Agent Output           | Telegram HTML                                         |
| ---------------------- | ----------------------------------------------------- |
| Code blocks            | `<pre><code class="language-js">...</code></pre>`     |
| Inline code            | `<code>...</code>`                                    |
| Bold                   | `<b>...</b>`                                          |
| Italic                 | `<i>...</i>`                                          |
| Links                  | `<a href="url">text</a>`                              |
| Headers (# / ## / ###) | `<b>HEADER TEXT</b>` (Telegram has no header support) |
| Tables                 | Converted to `<pre>` formatted ASCII tables           |
| Lists                  | Converted to text with bullet/number prefixes         |
| Block quotes           | `<blockquote>...</blockquote>`                        |


A `MarkdownToTelegramHTML` formatter module will handle this conversion, stripping unsupported elements and escaping special characters (`<`, `>`, `&`).

---

## 7. Cursor ACP Integration

### 7.1 Process Lifecycle

```
spawn("agent", ["--api-key", userCursorApiKey, "acp"], {
  stdio: ["pipe", "pipe", "inherit"],
  cwd: repoPath
})
```

Each user's own Cursor API key (provided via `/cursor`) is passed to their ACP process. This means each user authenticates with their own Cursor account and billing.

The ACP process is long-lived per user session. Multiple prompts are sent within the same session.

### 7.2 Session Flow

**New session:**

```
initialize → authenticate → session/new → [session/prompt ↔ session/update]* → session/cancel
```

**Resume previous session:**

```
initialize → authenticate → session/load(sessionId) → [session/prompt ↔ session/update]*
```

When a user runs `/resume <id>`, we look up the `acp_session_id` from the database and call `session/load` to restore the full conversation context. When a user runs `/new`, the current session is marked `paused` and a fresh `session/new` is created.

### 7.3 Key ACP Messages

**Sending a prompt:**

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "session/prompt",
  "params": {
    "sessionId": "<uuid>",
    "prompt": [
      { "type": "text", "text": "Add dark mode toggle" }
    ]
  }
}
```

**Receiving streamed updates (from stdout):**

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "<uuid>",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": { "text": "I'll start by reading..." }
    }
  }
}
```

**Handling permission requests:**

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "session/request_permission",
  "params": {
    "tool": "writeFile",
    "path": "src/components/Toggle.tsx"
  }
}
```

Response (auto-approve in `--force` style, or relay to user):

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "outcome": { "outcome": "selected", "optionId": "allow-always" }
  }
}
```

### 7.4 Mode Switching

When the user issues `/mode plan`, we send:

```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "session/new",
  "params": {
    "cwd": "/data/repos/user/frontend-app",
    "mode": "plan",
    "mcpServers": []
  }
}
```

### 7.5 Image Handling

When a user sends an image:

1. The bot downloads the photo to `/data/tmp/<user_id>/<uuid>.jpg` via the Bot API `getFile` method.
2. The image file path is included in the prompt sent to Cursor ACP.
3. Cursor's agent reads the image file using its vision-capable model.

If Cursor ACP does not natively support image file references in prompts, we fall back to:

- Saving the image to the repo's working directory.
- Telling the agent: "I've placed a screenshot at `./tmp/screenshot.png`. Please analyze it."

---

## 8. GitHub & Git Integration

### 8.1 GitHub Service (`@octokit/rest`)


| Operation      | API Call                                        |
| -------------- | ----------------------------------------------- |
| Validate token | `GET /user`                                     |
| List repos     | `GET /user/repos` with pagination               |
| Create PR      | `POST /repos/{owner}/{repo}/pulls`              |
| Get PR info    | `GET /repos/{owner}/{repo}/pulls/{pull_number}` |


### 8.2 Git Service (`simple-git`)


| Command   | Implementation                                                               |
| --------- | ---------------------------------------------------------------------------- |
| `/clone`  | `git clone https://<token>@github.com/owner/repo.git /data/repos/owner/repo` |
| `/commit` | `git add -A && git commit -m "<message>"`                                    |
| `/push`   | `git push origin <branch>`                                                   |
| `/branch` | `git checkout -b <name>`                                                     |
| `/pr`     | Create branch, push, then call GitHub API to create PR                       |
| `/diff`   | `git diff` output, formatted in a `<pre>` block                              |
| `/git`    | Pass-through to `simple-git` for arbitrary commands                          |


Git credentials are injected via the credential helper or by embedding the PAT in the remote URL.

---

## 9. Data Model

### Users Table


| Column            | Type             | Description                                    |
| ----------------- | ---------------- | ---------------------------------------------- |
| `telegram_id`     | INTEGER PK       | Telegram user ID                               |
| `github_token`    | TEXT (encrypted) | GitHub PAT (AES-256-GCM encrypted at rest)     |
| `github_username` | TEXT             | Cached GitHub username                         |
| `cursor_api_key`  | TEXT (encrypted) | Cursor API key (AES-256-GCM encrypted at rest) |
| `created_at`      | DATETIME         | Account creation timestamp                     |
| `updated_at`      | DATETIME         | Last update timestamp                          |


### Sessions Table


| Column           | Type       | Description                                               |
| ---------------- | ---------- | --------------------------------------------------------- |
| `id`             | INTEGER PK | Auto-incrementing, user-facing session number             |
| `telegram_id`    | INTEGER FK | User reference                                            |
| `title`          | TEXT       | User-provided or auto-generated session title             |
| `repo_full_name` | TEXT       | `owner/repo`                                              |
| `repo_path`      | TEXT       | Filesystem path to cloned repo                            |
| `acp_session_id` | TEXT       | Cursor ACP session ID (used for `session/load` to resume) |
| `model`          | TEXT       | Model name at time of last use                            |
| `mode`           | TEXT       | `agent` / `plan` / `ask`                                  |
| `branch`         | TEXT       | Git branch at time of last use                            |
| `status`         | TEXT       | `active` / `paused` / `stopped`                           |
| `message_count`  | INTEGER    | Number of prompts sent in this session                    |
| `created_at`     | DATETIME   | Session creation timestamp                                |
| `last_active_at` | DATETIME   | Last prompt timestamp (for sorting in `/sessions`)        |


### Draft State (in-memory only)


| Field                | Type      | Description                                     |
| -------------------- | --------- | ----------------------------------------------- |
| `draft_id`           | INTEGER   | Current `sendMessageDraft` draft ID             |
| `accumulated_text`   | STRING    | Text accumulated for current streaming response |
| `last_flush_at`      | TIMESTAMP | When we last called `sendMessageDraft`          |
| `pending_tool_calls` | ARRAY     | Tool calls awaiting display                     |


---

## 10. Project Structure

```
wcoder/
├── package.json
├── .env.example
├── README.md
├── src/
│   ├── index.js                  # Entry point: start bot + load config
│   ├── config.js                 # Environment and configuration loading
│   ├── bot/
│   │   ├── client.js             # grammY Bot initialization, file download helper
│   │   ├── handlers/
│   │   │   ├── start.js          # /start command
│   │   │   ├── github.js          # /github command (GitHub PAT)
│   │   │   ├── cursor.js          # /cursor command (Cursor API key)
│   │   │   ├── repos.js          # /repos command
│   │   │   ├── clone.js          # /clone command
│   │   │   ├── switch.js         # /switch command
│   │   │   ├── model.js          # /model command
│   │   │   ├── mode.js           # /mode command
│   │   │   ├── git.js            # /commit, /push, /pr, /branch, /git, /diff
│   │   │   ├── status.js         # /status command
│   │   │   ├── session.js        # /new, /sessions, /resume commands
│   │   │   ├── stop.js           # /stop command
│   │   │   ├── help.js           # /help command
│   │   │   └── message.js        # Plain text/image message handler (→ Cursor)
│   │   ├── middleware/
│   │   │   ├── auth.js           # Ensure user has both GitHub + Cursor tokens before proceeding
│   │   │   └── session.js        # Ensure user has an active repo session
│   │   └── dispatcher.js         # Routes incoming updates to handlers
│   ├── cursor/
│   │   ├── acp-client.js         # ACP JSON-RPC client (spawn, send, receive)
│   │   ├── session-manager.js    # Manages ACP sessions per user
│   │   └── event-parser.js       # Parses ACP NDJSON events into structured objects
│   ├── github/
│   │   ├── api.js                # Octokit wrapper for GitHub operations
│   │   └── auth.js               # Token validation and user info
│   ├── git/
│   │   └── operations.js         # Git clone, commit, push, branch, PR operations
│   ├── streaming/
│   │   ├── draft-sender.js       # sendMessageDraft HTTP caller with debouncing
│   │   └── formatter.js          # Markdown → Telegram HTML converter
│   ├── db/
│   │   ├── connection.js         # bun:sqlite connection setup
│   │   ├── migrations.js         # Schema creation / migration
│   │   └── queries.js            # Prepared query functions
│   └── utils/
│       ├── crypto.js             # AES-256-GCM encrypt/decrypt for tokens
│       ├── logger.js             # Structured logging (pino or similar)
│       └── errors.js             # Custom error classes
├── data/                         # Runtime data (gitignored)
│   ├── repos/                    # Cloned repositories
│   ├── tmp/                      # Temporary files (images, etc.)
│   └── wcoder.db                 # SQLite database
└── tests/
    ├── cursor/
    │   └── acp-client.test.js
    ├── streaming/
    │   └── formatter.test.js
    └── bot/
        └── handlers.test.js
```

---

## 11. Streaming Pipeline Detail

This is the core of the user experience — getting agent output into Telegram smoothly.

```
Cursor ACP stdout
       │
       ▼
  NDJSON Line Parser
       │
       ├── session/update (agent_message_chunk)
       │         │
       │         ▼
       │   Text Accumulator
       │         │
       │         ├── [debounce 150ms]
       │         │         │
       │         │         ▼
       │         │   Markdown → Telegram HTML
       │         │         │
       │         │         ▼
       │         │   sendMessageDraft(chat_id, draft_id, html)
       │         │
       │         └── [on response complete]
       │                   │
       │                   ▼
       │             sendMessage(chat_id, html)  ← permanent message
       │
       ├── session/update (tool_call_started)
       │         │
       │         ▼
       │   Format tool call indicator
       │   (e.g., "📖 Reading src/foo.ts")
       │         │
       │         ▼
       │   Append to accumulator OR send as separate message
       │
       ├── session/update (tool_call_completed)
       │         │
       │         ▼
       │   Format result summary
       │   (e.g., "✏️ Wrote src/bar.ts (42 lines)")
       │
       └── session/request_permission
                 │
                 ▼
           Auto-approve (default)
           OR prompt user via inline keyboard
```

### Message Chunking Strategy

Telegram messages have a 4096-character limit. For large responses:

1. Track accumulated text length.
2. When approaching 4000 chars, finalize the current message via `sendMessage`.
3. Start a new `draft_id` and continue streaming into the next message.
4. Number continued messages (e.g., "... (continued 2/3)").

### Draft ID Management

- Each streaming response gets a unique `draft_id` (incrementing integer per user).
- Draft IDs are never reused within a session to avoid visual conflicts.
- When a new prompt comes in while still streaming, cancel the current stream and start fresh.

---

## 12. Security Considerations


| Concern                         | Mitigation                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GitHub PAT exposure in chat     | `/github` message is deleted from chat immediately after processing. Bot sends a confirmation that doesn't include the token.      |
| Cursor API key exposure in chat | `/cursor` message is deleted from chat immediately after processing. Same treatment as GitHub PAT.                                 |
| Token/key storage               | Both GitHub PAT and Cursor API key are encrypted at rest with AES-256-GCM. Encryption key from `ENCRYPTION_KEY` env var.           |
| Arbitrary git command execution | `/git` command is restricted: no `push --force` to main/master, no credential operations. Dangerous commands require confirmation. |
| Cursor agent file access        | Agent runs with `--force` (auto-approve) by default but only within the cloned repo directory. The `cwd` is set to the repo path.  |
| Multi-user isolation            | Each user's repos are cloned to `/data/repos/<telegram_id>/owner/repo`. ACP processes are per-user.                                |
| Bot token security              | Stored in environment variables, never logged.                                                                                     |
| Rate limiting                   | Debounce `sendMessageDraft` calls. Queue incoming messages if Cursor is still processing.                                          |


---

## 13. Configuration

### `.env.example`

```env
# Telegram
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=abcdef1234567890abcdef1234567890
BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11

# Security
ENCRYPTION_KEY=32-byte-hex-key-for-aes-256-gcm

# Paths
DATA_DIR=/data
REPOS_DIR=/data/repos
TMP_DIR=/data/tmp

# Behavior
AUTO_APPROVE_TOOLS=true
DEFAULT_MODEL=claude-4-sonnet
STREAM_DEBOUNCE_MS=150
MAX_MESSAGE_LENGTH=4000
```

---

## 14. Error Handling


| Scenario                              | Behavior                                                           |
| ------------------------------------- | ------------------------------------------------------------------ |
| Cursor CLI crashes                    | Detect process exit, notify user, offer `/reset` to restart        |
| GitHub token invalid/expired          | Detect 401 from API, prompt user to re-authenticate with `/github` |
| Cursor API key invalid/expired        | Detect auth failure from ACP, prompt user to update with `/cursor` |
| Clone fails (private repo, no access) | Report error to user with the specific reason                      |
| Network timeout                       | Retry with exponential backoff (3 attempts), then notify user      |
| `sendMessageDraft` rate limited       | Increase debounce interval dynamically                             |
| Message exceeds 4096 chars            | Auto-chunk into multiple messages                                  |
| ACP permission request timeout        | Auto-approve after 30s if user doesn't respond                     |
| Concurrent prompts                    | Queue prompts; only one active `session/prompt` at a time per user |


---

## 15. Future Extensions


| Feature                      | Notes                                                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Alternative CLI backends** | Abstract the `cursor/acp-client.js` into a `CLIBackend` interface. Implement `ClaudeCLIBackend`, `CopilotCLIBackend`, etc. User selects via `/backend cursor|claude|copilot`. |
| **Multi-user support**       | Add resource limits per user (max repos, max concurrent sessions). Add user allowlist/admin controls.                                                                         |
| **File sharing**             | Let the bot send modified files back to the user as documents.                                                                                                                |
| **Diff preview**             | Before committing, show an inline diff for user approval.                                                                                                                     |
| **Webhook mode**             | Run the bot with webhooks instead of long-polling for production deployment (nginx + HTTPS).                                                                                  |
| **MCP server integration**   | Pass MCP server configs to the ACP session for extended tool access (databases, APIs, etc.).                                                                                  |
| **Session search**           | Full-text search across session history (search by prompt content, file names, etc.).                                                                                         |
| **Voice input**              | Accept voice messages, transcribe with Whisper, forward as text prompts.                                                                                                      |
| **Group chat support**       | Allow the bot to be used in group chats with mention-based activation.                                                                                                        |


---

## 16. Implementation Phases

### Phase 1 — Foundation

- Project scaffolding (package.json, ESM setup, directory structure)
- Config loading and environment validation
- GramJS bot client setup and connection
- Command dispatcher and handler registration
- `/start` and `/help` commands
- SQLite database setup with schema migrations

### Phase 2 — Authentication & GitHub Integration

- `/github` command with PAT validation and encrypted storage
- `/cursor` command with API key validation and encrypted storage
- Auth middleware (block commands until both tokens are provided)
- GitHub API service (list repos, validate access)
- `/repos` command with pagination
- `/clone` command (clone repo to filesystem)
- Git service (simple-git wrapper)

### Phase 3 — Cursor ACP Bridge & Session Management

- ACP client: spawn `agent acp`, JSON-RPC communication
- Session lifecycle: initialize → authenticate → session/new → prompt
- Session resume: `session/load` for restoring previous conversations
- Event parser for NDJSON stream
- Permission request handling (auto-approve)
- Message handler: forward plain text to ACP as prompts
- `/new` command (start new session, save current)
- `/sessions` command (list session history with pagination)
- `/resume` command (resume a previous session by ID)

### Phase 4 — Response Streaming

- `sendMessageDraft` HTTP caller
- Markdown → Telegram HTML formatter
- Text accumulator with debounced flushing
- Message chunking for long responses
- Tool call formatting (read/write/shell indicators)
- Final message delivery via `sendMessage`

### Phase 5 — Git Workflow Commands

- `/commit` with auto-generated messages
- `/push` command
- `/pr` command (branch creation + GitHub PR API)
- `/branch` command
- `/diff` command
- `/git` passthrough with safety guards

### Phase 6 — Advanced Features

- `/model` command (switch models mid-session)
- `/mode` command (agent/plan/ask)
- `/switch` command (switch between repos)
- Image upload handling and forwarding to Cursor
- `/status` command
- Error recovery and process monitoring

---

## 17. Key Technical Decisions

### Why grammY?

grammY is a lightweight Bot API framework that only requires a bot token (no API ID/hash). It provides built-in middleware, command routing, and typed access to all Bot API methods. For `sendMessageDraft` (which may not yet be in grammY's types), we call the Bot HTTP API directly via `fetch()`. This is simpler and more maintainable than MTProto-based libraries like GramJS.

### Why ACP over `--print --output-format stream-json`?

ACP provides a persistent, bidirectional session. With `--print`, each prompt spawns a new process and a new conversation — there is no memory of previous turns. ACP's `session/prompt` allows multiple prompts within the same session, preserving full conversation context. This is essential for a chat-based interface where users send multiple related messages.

### Why SQLite (via `bun:sqlite`)?

The data model is simple (users + sessions). SQLite requires zero infrastructure, runs embedded, and is more than sufficient for the expected scale. Bun ships with a built-in SQLite driver (`bun:sqlite`), so there's zero extra dependency. It can be swapped for PostgreSQL later if needed.

### Why HTML parse mode over MarkdownV2?

MarkdownV2 requires escaping 18+ special characters, making it fragile for dynamically generated content (especially code). HTML parse mode is more predictable — we only need to escape `<`, `>`, and `&`. Code blocks work reliably with `<pre><code>`.

---

## 18. Dependencies

```json
{
  "dependencies": {
    "grammy": "^1.41.0",
    "@octokit/rest": "^21.0.0",
    "simple-git": "^3.27.0",
    "pino": "^9.0.0",
    "pino-pretty": "^11.0.0"
  },
  "devDependencies": {
    "bun-types": "latest"
  }
}
```

Note: `bun:sqlite` is a Bun built-in — no npm dependency needed. `dotenv` is also unnecessary since Bun natively loads `.env` files. Tests use `bun:test` (built-in).

```

```

