const PLATFORM_PARITY_VERSION = "v1.0";

const BUILT_IN_SKILLS = Object.freeze([
  Object.freeze({ id: "research", label: "Research", category: "knowledge", tools: ["web_research"], requires: ["web_research"] }),
  Object.freeze({ id: "coding", label: "Coding Agent", category: "builder", tools: ["code_workspace"], requires: ["code_workspace"] }),
  Object.freeze({ id: "documents", label: "Documents & Artifacts", category: "artifact", tools: ["file_analysis", "artifact_creation"], requires: ["file_analysis", "artifact_creation"] }),
  Object.freeze({ id: "projects", label: "Project Workspace", category: "workspace", tools: ["project_memory", "vault_metadata"], requires: [] }),
  Object.freeze({ id: "automation", label: "Automations", category: "agent", tools: ["scheduled_tasks", "future_core"], requires: ["future_core"] }),
  Object.freeze({ id: "computer_use", label: "Computer Use", category: "action", tools: ["browser_control"], requires: ["browser_control"] }),
  Object.freeze({ id: "multimodal", label: "Live Multimodal", category: "native", tools: ["voice", "camera", "screen"], requires: [] })
]);

const CONNECTOR_PROTOCOLS = Object.freeze([
  Object.freeze({ id: "native_oauth", label: "Native OAuth Connector", implemented: true }),
  Object.freeze({ id: "mcp", label: "Model Context Protocol", implemented: true }),
  Object.freeze({ id: "rest", label: "REST / OpenAPI", implemented: true }),
  Object.freeze({ id: "a2a", label: "Agent-to-Agent", implemented: true })
]);

function configured(value) {
  return Boolean(String(value || "").trim());
}

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function providerCatalog(env = process.env) {
  return [
    {
      id: "openai",
      label: "OpenAI",
      kind: "cloud",
      configured: configured(env.OPENAI_API_KEY || env.AI_API_KEY),
      chat: true,
      research: true
    },
    {
      id: "anthropic",
      label: "Anthropic",
      kind: "cloud",
      configured: configured(env.ANTHROPIC_API_KEY),
      chat: true,
      streaming: true,
      reasoningControls: true,
      supportedEffortLevels: Object.freeze(["low", "medium", "high", "xhigh", "max"]),
      defaultEffort: "high",
      defaultModel: "claude-sonnet-5",
      adaptiveThinking: true,
      research: false,
      adapterState: "active-sonnet-5-streaming-adaptive-thinking"
    },
    {
      id: "google",
      label: "Google Gemini",
      kind: "cloud",
      configured: configured(env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY),
      chat: true,
      streaming: true,
      reasoningControls: true,
      supportedThinkingLevels: Object.freeze(["low", "medium", "high"]),
      defaultThinkingLevel: "medium",
      defaultModel: "gemini-3.8-flash",
      research: false,
      adapterState: "active-gemini-3.8-chat-streaming-thinking"
    },
    {
      id: "local",
      label: "Local / Private Model",
      kind: "local",
      configured: configured(env.UNBOUND_LOCAL_AI_ENDPOINT),
      chat: true,
      streaming: true,
      research: false,
      adapterState: "active-openai-compatible-streaming-chat"
    }
  ];
}

function connectorCatalog(env = process.env) {
  const remoteBrowser = configured(env.BROWSER_CDP_URL || env.REMOTE_CDP_URL);
  const googleWorkspaceConfigured = Boolean(
    configured(env.GOOGLE_OAUTH_CLIENT_ID) &&
    configured(env.GOOGLE_OAUTH_CLIENT_SECRET) &&
    configured(env.GOOGLE_OAUTH_CALLBACK_URL) &&
    enabled(env.GOOGLE_OAUTH_REGISTRATION_VERIFIED) &&
    enabled(env.GOOGLE_OAUTH_READ_ONLY_SCOPES_VERIFIED) &&
    enabled(env.GOOGLE_OAUTH_RESTRICTED_SCOPES_VERIFIED) &&
    configured(env.CONNECTED_APPS_TOKEN_KEY)
  );
  const microsoft365Configured = Boolean(
    configured(env.MICROSOFT_OAUTH_CLIENT_ID) &&
    configured(env.MICROSOFT_OAUTH_CLIENT_SECRET) &&
    configured(env.MICROSOFT_OAUTH_CALLBACK_URL) &&
    enabled(env.MICROSOFT_OAUTH_REGISTRATION_VERIFIED) &&
    enabled(env.MICROSOFT_OAUTH_READ_ONLY_SCOPES_VERIFIED) &&
    enabled(env.MICROSOFT_OAUTH_FILE_READ_SCOPE_VERIFIED) &&
    configured(env.CONNECTED_APPS_TOKEN_KEY)
  );
  const slackConfigured = Boolean(
    configured(env.SLACK_CLIENT_ID) &&
    configured(env.SLACK_REDIRECT_URL) &&
    enabled(env.SLACK_APP_REGISTRATION_VERIFIED) &&
    enabled(env.SLACK_PKCE_ENABLED_VERIFIED) &&
    enabled(env.SLACK_READ_ONLY_SCOPES_VERIFIED) &&
    enabled(env.SLACK_TOKEN_ROTATION_VERIFIED) &&
    configured(env.CONNECTED_APPS_TOKEN_KEY)
  );
  return [
    { id: "github", label: "GitHub", protocol: "native_oauth", configured: configured(env.GITHUB_CLIENT_ID), read: true, write: enabled(env.GITHUB_WRITE_ACTIONS_ENABLED) },
    { id: "mcp_gateway", label: "MCP Gateway", protocol: "mcp", configured: configured(env.UNBOUND_MCP_GATEWAY_URL), read: true, write: false },
    { id: "browser", label: "Computer Use Browser", protocol: "rest", configured: remoteBrowser, read: true, write: remoteBrowser },
    { id: "a2a_peer", label: "A2A Peer", protocol: "a2a", configured: configured(env.UNBOUND_A2A_AGENT_CARD_URL), read: true, write: configured(env.UNBOUND_A2A_AGENT_CARD_URL), approvalRequired: true },
    { id: "google_workspace", label: "Google Workspace", protocol: "native_oauth", configured: googleWorkspaceConfigured, read: googleWorkspaceConfigured, write: false, dataAccess: "metadata-only" },
    { id: "microsoft_365", label: "Microsoft 365", protocol: "native_oauth", configured: microsoft365Configured, read: microsoft365Configured, write: false, dataAccess: "basic-mail-calendar-plus-onedrive-metadata" },
    { id: "slack", label: "Slack", protocol: "native_oauth", configured: slackConfigured, read: slackConfigured, write: false, dataAccess: "public-channel-read-only" }
  ];
}

function workspaceStatus(env = process.env) {
  return {
    projects: true,
    vaultMetadata: true,
    encryptedObjectStorage: configured(env.UNBOUND_OBJECT_STORAGE_PROVIDER) && configured(env.UNBOUND_OBJECT_STORAGE_KEY),
    codeWorkspace: configured(env.UNBOUND_CODE_SANDBOX_URL),
    futureCore: String(env.UNBOUND_FUTURE_CORE_V2_ENABLED || "").toLowerCase() === "true",
    nativeMultimodalBridge: true,
    artifactStudio: true,
    artifactExports: Object.freeze(["docx", "xlsx", "pptx"]),
    marketplaceRegistry: true,
    marketplaceEnabled: enabled(env.UNBOUND_SKILL_MARKETPLACE_ENABLED),
    creatorMarketplace: enabled(env.UNBOUND_SKILL_CREATOR_ENABLED),
    marketplaceExecution: "manifest_only"
  };
}

function publicPlatformCatalog(env = process.env) {
  return {
    version: PLATFORM_PARITY_VERSION,
    skills: BUILT_IN_SKILLS,
    protocols: CONNECTOR_PROTOCOLS,
    providers: providerCatalog(env),
    connectors: connectorCatalog(env),
    workspace: workspaceStatus(env)
  };
}

module.exports = {
  PLATFORM_PARITY_VERSION,
  BUILT_IN_SKILLS,
  CONNECTOR_PROTOCOLS,
  providerCatalog,
  connectorCatalog,
  workspaceStatus,
  publicPlatformCatalog
};
