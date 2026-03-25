const required = (name) => {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
};

const optional = (name, fallback) => process.env[name] || fallback;

const adminId = optional("ADMIN_USER_ID", "");

const config = {
  telegram: {
    botToken: required("BOT_TOKEN"),
  },
  encryption: {
    key: required("ENCRYPTION_KEY"),
  },
  webhook: {
    domain: optional("WEBHOOK_DOMAIN", ""),
    port: Number(optional("WEBHOOK_PORT", "8443")),
    secret: optional("WEBHOOK_SECRET", ""),
  },
  paths: {
    data: optional("DATA_DIR", "./data"),
    repos: optional("REPOS_DIR", "./data/repos"),
    tmp: optional("TMP_DIR", "./data/tmp"),
  },
  behavior: {
    autoApproveTools: optional("AUTO_APPROVE_TOOLS", "true") === "true",
    defaultModel: optional("DEFAULT_MODEL", "claude-4-sonnet"),
    streamDebounceMs: Number(optional("STREAM_DEBOUNCE_MS", "150")),
    maxMessageLength: Number(optional("MAX_MESSAGE_LENGTH", "4000")),
  },
  adminUserId: adminId ? Number(adminId) : null,
  githubRepo: optional("GITHUB_REPO", ""),
};

export default config;
