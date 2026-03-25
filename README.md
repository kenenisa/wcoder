# WCoder

A Telegram bot that brings agentic coding to your chat. Send natural-language prompts, get streamed responses with real-time file edits, and manage git workflows — all from Telegram, powered by [Cursor CLI](https://docs.cursor.com/cli) (ACP).

## Features

- **Conversational coding** — chat with Cursor's AI agent directly in Telegram
- **Real-time streaming** — responses stream via `sendMessageDraft` with no flickering
- **GitHub integration** — browse repos, clone, commit, push, and create PRs without leaving the chat
- **Session management** — start, pause, and resume coding sessions with full context preservation
- **Multi-model / multi-mode** — switch between models (`claude-4-sonnet`, `gpt-4.1`, etc.) and modes (`agent`, `plan`, `ask`) on the fly
- **Image input** — send screenshots or mockups and let the agent reason about them
- **Secure token storage** — GitHub PATs and Cursor API keys are AES-256-GCM encrypted at rest
- **Self-contained binary** — compiles to a single executable via `bun build --compile`

## Architecture

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

## Prerequisites

- [Bun](https://bun.sh/) 1.2+
- [Cursor CLI](https://docs.cursor.com/cli) installed and available as `cursor` (or `agent`) on `$PATH`
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

## Quick Start

### From source

```bash
git clone https://github.com/kenenisa/wcoder.git
cd wcoder
bun install

cp .env.example .env
# Edit .env with your BOT_TOKEN and ENCRYPTION_KEY

bun run dev
```

### One-line install (from release)

```bash
curl -fsSL https://raw.githubusercontent.com/kenenisa/wcoder/main/install.sh | bash
```

The installer downloads the pre-built binary for your platform, writes a config file, and sets up a system service (systemd on Linux, launchd on macOS). Run with `--help` for all options:

```bash
curl -fsSL https://raw.githubusercontent.com/kenenisa/wcoder/main/install.sh \
  | bash -s -- --bot-token "YOUR_TOKEN" --domain "wcoder.example.com"
```

## Configuration

Copy `.env.example` and fill in the required values:

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | Yes | Telegram bot token |
| `ENCRYPTION_KEY` | Yes | 32-byte hex key for AES-256-GCM encryption |
| `DATA_DIR` | No | Data directory (default: `./data`) |
| `ADMIN_USER_ID` | No | Telegram user ID allowed to run `/update` |
| `AUTO_APPROVE_TOOLS` | No | Auto-approve Cursor tool calls (default: `true`) |
| `DEFAULT_MODEL` | No | Default AI model (default: `claude-4-sonnet`) |
| `STREAM_DEBOUNCE_MS` | No | Draft update interval in ms (default: `150`) |

## Bot Commands

| Command | Description |
|---|---|
| `/start` | Welcome and onboarding |
| `/github <pat>` | Store GitHub PAT (message auto-deleted) |
| `/cursor <key>` | Store Cursor API key (message auto-deleted) |
| `/repos [page]` | List your GitHub repositories |
| `/clone <owner/repo>` | Clone a repo and start a Cursor session |
| `/switch <owner/repo>` | Switch to an already-cloned repo |
| `/model <name>` | Change AI model |
| `/mode <agent\|plan\|ask>` | Switch agent mode |
| `/commit [message]` | Commit changes (auto-generates message if omitted) |
| `/push [remote] [branch]` | Push current branch |
| `/pr [title]` | Create a pull request |
| `/branch <name>` | Create and switch to a new branch |
| `/git <command>` | Run an arbitrary git command |
| `/diff` | Show uncommitted changes |
| `/status` | Current session info |
| `/new [title]` | Start a new session |
| `/sessions [page]` | List past sessions |
| `/resume <id>` | Resume a previous session |
| `/stop` | Stop the current Cursor agent |
| `/help` | Show available commands |

Any plain text message is forwarded as a prompt to the active Cursor agent session.

## Development

```bash
bun run dev          # Start with --watch
bun test             # Run tests
bun run build        # Compile to native binary (current platform)
```

Cross-platform builds:

```bash
bun run build:linux-x64
bun run build:linux-arm64
bun run build:darwin-x64
bun run build:darwin-arm64
```

## Releases

Pushing a version tag triggers the CI pipeline which runs tests, builds binaries for all platforms, and publishes a GitHub release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Bun 1.2+ |
| Bot framework | grammY |
| Cursor integration | ACP (stdio JSON-RPC) |
| GitHub API | @octokit/rest |
| Git operations | simple-git |
| Database | SQLite (bun:sqlite) |
| Logging | pino |

## License

MIT
