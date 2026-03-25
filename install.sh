#!/usr/bin/env bash
set -euo pipefail

# --- Configuration -----------------------------------------------------------
REPO="kenenisa/wcoder"
INSTALL_DIR="/usr/local/bin"
SERVICE_USER="wcoder"
DATA_DIR="/var/lib/wcoder"
ENV_FILE="/etc/wcoder.env"

# --- Helpers ------------------------------------------------------------------
info()  { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m!\033[0m %s\n' "$*"; }
err()   { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; }
die()   { err "$@"; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not installed."
}

# --- Detect existing install --------------------------------------------------
IS_UPDATE=false
CURRENT_VERSION=""

detect_existing() {
  if [[ -x "${INSTALL_DIR}/wcoder" ]]; then
    IS_UPDATE=true
    CURRENT_VERSION="$("${INSTALL_DIR}/wcoder" --version 2>/dev/null || echo "unknown")"
    ok "Existing installation found (${CURRENT_VERSION})"
  fi

  if [[ -f "$ENV_FILE" ]]; then
    info "Loading existing config from $ENV_FILE ..."
    set -a
    source "$ENV_FILE"
    set +a
    BOT_TOKEN="${BOT_TOKEN:-${BOT_TOKEN_CLI:-}}"
    ENCRYPTION_KEY="${ENCRYPTION_KEY:-}"
    WEBHOOK_DOMAIN="${WEBHOOK_DOMAIN:-}"
    WEBHOOK_PORT="${WEBHOOK_PORT:-8443}"
    WEBHOOK_SECRET="${WEBHOOK_SECRET:-}"
    DATA_DIR="${DATA_DIR:-/var/lib/wcoder}"
  fi
}

# --- Detect platform ----------------------------------------------------------
detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    linux)  OS="linux" ;;
    darwin) OS="darwin" ;;
    *)      die "Unsupported OS: $os" ;;
  esac

  case "$arch" in
    x86_64|amd64)  ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)             die "Unsupported architecture: $arch" ;;
  esac

  PLATFORM="${OS}-${ARCH}"
  ok "Detected platform: $PLATFORM"
}

# --- Parse CLI flags ----------------------------------------------------------
BOT_TOKEN=""
ENCRYPTION_KEY=""
WEBHOOK_DOMAIN=""
WEBHOOK_PORT="8443"
WEBHOOK_SECRET=""
ADMIN_USER_ID=""
GITHUB_REPO=""
VERSION="latest"
SKIP_SERVICE=false

usage() {
  cat <<USAGE
Usage: install.sh [OPTIONS]

Install or update WCoder. On first run, configures the bot token,
encryption key, webhook, data directory, and system service.
On subsequent runs, updates the binary and restarts the service
while preserving existing configuration.

Options:
  --bot-token TOKEN        Telegram bot token (required on first install)
  --encryption-key KEY     32-byte hex key (auto-generated if omitted)
  --domain DOMAIN          Webhook domain (omit for long-polling)
  --webhook-port PORT      Local webhook port (default: 8443)
  --webhook-secret SECRET  Webhook path secret (auto-generated if domain set)
  --data-dir DIR           Data directory (default: /var/lib/wcoder)
  --admin-id USER_ID       Telegram user ID for /update command
  --repo OWNER/NAME        GitHub repo for self-update (e.g. yourname/wcoder)
  --version VERSION        Release version tag (default: latest)
  --skip-service           Don't install/restart a system service
  -h, --help               Show this help
USAGE
  exit 0
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --bot-token)        BOT_TOKEN="$2";        shift 2 ;;
      --encryption-key)   ENCRYPTION_KEY="$2";    shift 2 ;;
      --domain)           WEBHOOK_DOMAIN="$2";    shift 2 ;;
      --webhook-port)     WEBHOOK_PORT="$2";      shift 2 ;;
      --webhook-secret)   WEBHOOK_SECRET="$2";    shift 2 ;;
      --data-dir)         DATA_DIR="$2";          shift 2 ;;
      --admin-id)         ADMIN_USER_ID="$2";     shift 2 ;;
      --repo)             GITHUB_REPO="$2";       shift 2 ;;
      --version)          VERSION="$2";           shift 2 ;;
      --skip-service)     SKIP_SERVICE=true;      shift ;;
      -h|--help)          usage ;;
      *)                  die "Unknown option: $1" ;;
    esac
  done
}

# --- Interactive prompts (only for fresh installs) ----------------------------
HAS_TTY=false
[[ -t 0 ]] && HAS_TTY=true
if [[ "$HAS_TTY" == false ]] && [[ -r /dev/tty ]]; then
  HAS_TTY=true
fi

prompt() {
  local var_name="$1" prompt_text="$2" required="${3:-false}"
  if [[ "$HAS_TTY" == false ]]; then
    if [[ "$required" == true && -z "${!var_name}" ]]; then
      die "$var_name is required. Pass --$(echo "$var_name" | tr '[:upper:]' '[:lower:]' | tr '_' '-') via CLI flags."
    fi
    return
  fi
  printf '%s' "$prompt_text" >/dev/tty
  read -r "$var_name" </dev/tty
}

prompt_config() {
  if [[ "$IS_UPDATE" == true ]]; then
    info "Updating — existing config will be preserved"
    return
  fi

  if [[ -z "$BOT_TOKEN" ]]; then
    prompt BOT_TOKEN "Telegram bot token: " true
    [[ -n "$BOT_TOKEN" ]] || die "Bot token is required. Pass --bot-token TOKEN."
  fi

  if [[ -z "$ENCRYPTION_KEY" ]]; then
    ENCRYPTION_KEY="$(openssl rand -hex 32)"
    ok "Generated encryption key"
  fi

  if [[ -z "$WEBHOOK_DOMAIN" ]]; then
    prompt WEBHOOK_DOMAIN "Webhook domain (leave empty for long-polling): "
  fi

  if [[ -n "$WEBHOOK_DOMAIN" && -z "$WEBHOOK_SECRET" ]]; then
    WEBHOOK_SECRET="$(openssl rand -hex 20)"
    ok "Generated webhook secret"
  fi

  if [[ -z "$ADMIN_USER_ID" ]]; then
    prompt ADMIN_USER_ID "Admin Telegram user ID (for /update command, leave empty to skip): "
  fi

  if [[ -z "$GITHUB_REPO" ]]; then
    prompt GITHUB_REPO "GitHub repo (owner/name, for self-update): "
  fi

  if [[ -n "$GITHUB_REPO" ]]; then
    REPO="$GITHUB_REPO"
  fi
}

# --- Stop running service before replacing binary -----------------------------
stop_service() {
  if [[ "$IS_UPDATE" != true ]]; then return; fi

  info "Stopping running service ..."
  case "$OS" in
    linux)
      sudo systemctl stop wcoder 2>/dev/null || true
      ;;
    darwin)
      local plist="$HOME/Library/LaunchAgents/com.wcoder.bot.plist"
      launchctl unload "$plist" 2>/dev/null || true
      ;;
  esac
}

# --- Download binary ----------------------------------------------------------
download_binary() {
  need curl
  need tar

  local asset="wcoder-${PLATFORM}.tar.gz"
  local url

  if [[ "$VERSION" == "latest" ]]; then
    url="https://github.com/${REPO}/releases/latest/download/${asset}"
  else
    url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
  fi

  info "Downloading $asset ..."
  DOWNLOAD_TMPDIR="$(mktemp -d)"
  trap 'rm -rf "${DOWNLOAD_TMPDIR:-}"' EXIT

  curl -fsSL "$url" -o "${DOWNLOAD_TMPDIR}/${asset}" || die "Download failed. Check that the release exists."
  tar -xzf "${DOWNLOAD_TMPDIR}/${asset}" -C "$DOWNLOAD_TMPDIR"

  info "Installing to ${INSTALL_DIR}/wcoder ..."
  sudo install -m 755 "${DOWNLOAD_TMPDIR}/wcoder-${PLATFORM}" "${INSTALL_DIR}/wcoder"
  ok "Binary installed"
}

# --- Write env file (skip on update unless flags override) --------------------
write_env() {
  if [[ "$IS_UPDATE" == true && -f "$ENV_FILE" ]]; then
    ok "Config unchanged at $ENV_FILE"
    return
  fi

  info "Writing config to $ENV_FILE ..."
  sudo tee "$ENV_FILE" > /dev/null <<EOF
BOT_TOKEN=${BOT_TOKEN}
ENCRYPTION_KEY=${ENCRYPTION_KEY}

WEBHOOK_DOMAIN=${WEBHOOK_DOMAIN}
WEBHOOK_PORT=${WEBHOOK_PORT}
WEBHOOK_SECRET=${WEBHOOK_SECRET}

ADMIN_USER_ID=${ADMIN_USER_ID}
GITHUB_REPO=${GITHUB_REPO}

DATA_DIR=${DATA_DIR}
REPOS_DIR=${DATA_DIR}/repos
TMP_DIR=${DATA_DIR}/tmp
EOF
  sudo chmod 600 "$ENV_FILE"
  ok "Config written (readable only by root)"
}

# --- Create system user -------------------------------------------------------
ensure_user() {
  if ! id "$SERVICE_USER" &>/dev/null; then
    info "Creating system user '${SERVICE_USER}' ..."
    if [[ "$OS" == "linux" ]]; then
      sudo useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
    else
      SERVICE_USER="$(whoami)"
    fi
  fi
  sudo mkdir -p "$DATA_DIR" "$DATA_DIR/updates"
  sudo chown -R "$SERVICE_USER" "$DATA_DIR"
}

# --- Caddy reverse proxy (automatic TLS) --------------------------------------
install_caddy() {
  if [[ -z "$WEBHOOK_DOMAIN" ]]; then return; fi
  if [[ "$IS_UPDATE" == true ]]; then return; fi

  info "Setting up Caddy for automatic HTTPS ..."

  if ! command -v caddy &>/dev/null; then
    info "Installing Caddy ..."
    case "$OS" in
      linux)
        sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null 2>&1 || true
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
          | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
          | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
        sudo apt-get update -qq >/dev/null 2>&1
        sudo apt-get install -y caddy >/dev/null 2>&1
        ;;
      darwin)
        if command -v brew &>/dev/null; then
          brew install caddy >/dev/null 2>&1
        else
          die "Install Homebrew first, or install Caddy manually: https://caddyserver.com/docs/install"
        fi
        ;;
    esac
    ok "Caddy installed"
  else
    ok "Caddy already installed"
  fi

  local caddyfile="/etc/caddy/Caddyfile"
  if [[ "$OS" == "darwin" ]]; then
    caddyfile="$HOME/.config/caddy/Caddyfile"
    mkdir -p "$(dirname "$caddyfile")"
  fi

  info "Writing Caddyfile for ${WEBHOOK_DOMAIN} ..."
  local caddy_content="${WEBHOOK_DOMAIN} {
	reverse_proxy localhost:${WEBHOOK_PORT}
}"

  if [[ "$OS" == "darwin" ]]; then
    echo "$caddy_content" > "$caddyfile"
  else
    echo "$caddy_content" | sudo tee "$caddyfile" > /dev/null
  fi

  case "$OS" in
    linux)
      sudo systemctl enable caddy >/dev/null 2>&1
      sudo systemctl restart caddy
      ;;
    darwin)
      if brew services list 2>/dev/null | grep -q caddy; then
        brew services restart caddy >/dev/null 2>&1
      else
        caddy start --config "$caddyfile" --adapter caddyfile >/dev/null 2>&1 &
      fi
      ;;
  esac

  ok "Caddy configured — TLS certificates will be provisioned automatically"
}

# --- Sudoers for self-update --------------------------------------------------
install_sudoers() {
  if [[ "$OS" != "linux" ]]; then return; fi

  local sudoers="/etc/sudoers.d/wcoder"
  if [[ -f "$sudoers" ]]; then return; fi

  info "Granting self-update permissions ..."
  sudo tee "$sudoers" > /dev/null <<EOF
# Allow the wcoder service to replace its own binary via /update command
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/install -m 755 ${DATA_DIR}/updates/wcoder-new ${INSTALL_DIR}/wcoder
EOF
  sudo chmod 440 "$sudoers"
  ok "Sudoers drop-in installed"
}

# --- systemd (Linux) ---------------------------------------------------------
install_systemd() {
  local unit="/etc/systemd/system/wcoder.service"
  info "Installing systemd service ..."
  sudo tee "$unit" > /dev/null <<EOF
[Unit]
Description=WCoder Telegram Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
EnvironmentFile=${ENV_FILE}
ExecStart=${INSTALL_DIR}/wcoder
Restart=always
RestartSec=5
WorkingDirectory=${DATA_DIR}

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable wcoder
  sudo systemctl restart wcoder
  ok "systemd service installed and started"
}

# --- launchd (macOS) ----------------------------------------------------------
install_launchd() {
  local plist="$HOME/Library/LaunchAgents/com.wcoder.bot.plist"
  info "Installing launchd agent ..."
  mkdir -p "$HOME/Library/LaunchAgents"

  local env_keys=""
  env_keys+="      <key>BOT_TOKEN</key><string>${BOT_TOKEN}</string>\n"
  env_keys+="      <key>ENCRYPTION_KEY</key><string>${ENCRYPTION_KEY}</string>\n"
  env_keys+="      <key>DATA_DIR</key><string>${DATA_DIR}</string>\n"
  env_keys+="      <key>REPOS_DIR</key><string>${DATA_DIR}/repos</string>\n"
  env_keys+="      <key>TMP_DIR</key><string>${DATA_DIR}/tmp</string>\n"
  if [[ -n "$WEBHOOK_DOMAIN" ]]; then
    env_keys+="      <key>WEBHOOK_DOMAIN</key><string>${WEBHOOK_DOMAIN}</string>\n"
    env_keys+="      <key>WEBHOOK_PORT</key><string>${WEBHOOK_PORT}</string>\n"
    env_keys+="      <key>WEBHOOK_SECRET</key><string>${WEBHOOK_SECRET}</string>\n"
  fi

  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.wcoder.bot</string>
  <key>ProgramArguments</key>
  <array>
    <string>${INSTALL_DIR}/wcoder</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${DATA_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
$(printf '%b' "$env_keys")
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${DATA_DIR}/wcoder.log</string>
  <key>StandardErrorPath</key>
  <string>${DATA_DIR}/wcoder.err.log</string>
</dict>
</plist>
EOF

  launchctl load "$plist"
  ok "launchd agent installed and started"
}

# --- Install Cursor CLI (agent) -----------------------------------------------
CURSOR_CLI_FALLBACK_VERSION="2026.03.25-933d5a6"

install_cursor_cli() {
  if [[ -x "${INSTALL_DIR}/agent" ]]; then
    ok "Cursor CLI ('agent') already installed at ${INSTALL_DIR}/agent"
    return
  fi

  info "Installing Cursor CLI ..."

  # Try to get the download URL from the official installer script
  local download_url=""
  local installer_script
  installer_script="$(curl -fsSL https://cursor.com/install 2>/dev/null || true)"

  if [[ -n "$installer_script" ]]; then
    download_url="$(echo "$installer_script" | grep -oP 'DOWNLOAD_URL="[^"]*' | head -1 | cut -d'"' -f2)"
  fi

  # Fallback to direct download URL
  if [[ -z "$download_url" ]]; then
    local cli_os="${OS}"
    local cli_arch="${ARCH}"
    download_url="https://downloads.cursor.com/lab/${CURSOR_CLI_FALLBACK_VERSION}/${cli_os}/${cli_arch}/agent-cli-package.tar.gz"
    info "Using fallback download URL (${CURSOR_CLI_FALLBACK_VERSION})"
  fi

  local tmpdir
  tmpdir="$(mktemp -d)"

  info "Downloading Cursor CLI ..."
  if ! curl -fsSL "$download_url" | tar --strip-components=1 -xzf - -C "$tmpdir"; then
    rm -rf "$tmpdir"
    warn "Cursor CLI download failed."
    warn "Install it manually:"
    warn "  curl -fsSL https://cursor.com/install | bash"
    warn "  sudo cp ~/.local/bin/agent ${INSTALL_DIR}/agent"
    warn "  sudo systemctl restart wcoder"
    return
  fi

  if [[ -f "${tmpdir}/cursor-agent" ]]; then
    sudo install -m 755 "${tmpdir}/cursor-agent" "${INSTALL_DIR}/agent"
    ok "Cursor CLI installed to ${INSTALL_DIR}/agent"
  else
    rm -rf "$tmpdir"
    warn "cursor-agent binary not found in downloaded package."
    warn "Install it manually:"
    warn "  curl -fsSL https://cursor.com/install | bash"
    warn "  sudo cp ~/.local/bin/agent ${INSTALL_DIR}/agent"
    return
  fi

  rm -rf "$tmpdir"
}

# --- Main ---------------------------------------------------------------------
main() {
  parse_args "$@"

  # Resolve "latest" to the actual release tag
  if [[ "$VERSION" == "latest" ]]; then
    local resolved
    resolved="$(curl -fsSL -o /dev/null -w '%{url_effective}' \
      "https://github.com/${REPO}/releases/latest" 2>/dev/null \
      | grep -oP 'v[0-9]+\.[0-9]+\.[0-9]+' || true)"
    if [[ -n "$resolved" ]]; then
      VERSION="$resolved"
    fi
  fi

  echo ""
  echo "  WCoder Installer — ${VERSION}"
  echo ""

  detect_platform
  detect_existing
  prompt_config
  stop_service
  download_binary
  install_cursor_cli
  write_env
  ensure_user
  install_sudoers
  install_caddy

  if [[ "$SKIP_SERVICE" == false ]]; then
    case "$OS" in
      linux)  install_systemd ;;
      darwin) install_launchd ;;
    esac
  fi

  echo ""
  if [[ "$IS_UPDATE" == true ]]; then
    ok "WCoder updated successfully!"
  else
    ok "WCoder installed successfully!"
  fi
  echo ""
  echo "  Binary:  ${INSTALL_DIR}/wcoder"
  echo "  Config:  ${ENV_FILE}"
  echo "  Data:    ${DATA_DIR}"
  if [[ -n "$WEBHOOK_DOMAIN" ]]; then
    echo "  Webhook: https://${WEBHOOK_DOMAIN}/webhook/..."
    echo "  Caddy:   ${WEBHOOK_DOMAIN} → localhost:${WEBHOOK_PORT} (auto-TLS)"
  fi
  echo ""
}

main "$@"
