const PLATFORM_PARITY_VERSION = "v1.0";

const BUILT_IN_SKILLS = Object.freeze([
  Object.freeze({ id: "research", label: "Research", category: "knowledge", tools: ["web_research"], requires: ["web_research"] }),
  Object.freeze({ id: "coding", label: "Coding Agent", category: "builder", tools: ["code_workspace"], requires: ["code_workspace"] }),
  Object.freeze({ id: "documents", label: "Documents", category: "artifact", tools: ["file_analysis"], requires: ["file_analysis"] }),
  Object.freeze({ id: "projects", label: "Project Workspace", category: "workspace", tools: ["project_memory", "vault_metadata"], requires: [] }),
  Object.freeze({ id: "automation", label: "Automations", category: "agent", tools: ["scheduled_tasks", "future_core"], requires: ["future_core"] }),
  Object.freeze({ id: "computer_use", label: "Computer Use", category: "action", tools: ["browser_control"], requires: ["browser_control"] }),
  Object.freeze({ id: "multimodal", label: "Live Multimodal", category: "native", tools: ["voice", "camera", "screen"], requires: [] })
]);

const CONNECTOR_PROTOCOLS = Object.freeze([
  Object.freeze({ id: "native_oauth", label: "Native OAuth Connector", implemented: true }),
  Object.freeze({ id: "mcp", label: "Model Context Protocol", implemented: true }),
  Object.freeze({ id: "rest", label: "REST / OpenAPI", implemented: true }),
  Object.freeze({ id: "a2a", label: "Agent-to-Agent", implemented: false })
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
      research: false,
      adapterState: "active-text-chat"
    },
    {
      id: "google",
      label: "Google Gemini",
      kind: "cloud",
      configured: configured(env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY),
      chat: false,
      research: false,
      adapterState: "credential-detected-adapter-not-yet-active"
    },
    {
      id: "local",
      label: "Local / Private Model",
      kind: "local",
      configured: configured(env.UNBOUND_LOCAL_AI_ENDPOINT),
      chat: true,
      research: false,
      adapterState: "active-openai-compatible-chat"
    }
  ];
}

function connectorCatalog(env = process.env) {
  const remoteBrowser = configured(env.BROWSER_CDP_URL || env.REMOTE_CDP_URL);
  return [
    { id: "github", label: "GitHub", protocol: "native_oauth", configured: configured(env.GITHUB_CLIENT_ID), read: true, write: enabled(env.GITHUB_WRITE_ACTIONS_ENABLED) },
    { id: "mcp_gateway", label: "MCP Gateway", protocol: "mcp", configured: configured(env.UNBOUND_MCP_GATEWAY_URL), read: true, write: false },
    { id: "browser", label: "Computer Use Browser", protocol: "rest", configured: remoteBrowser, read: true, write: remoteBrowser },
    { id: "google_workspace", label: "Google Workspace", protocol: "native_oauth", configured: configured(env.GOOGLE_OAUTH_CLIENT_ID), read: false, write: false },
    { id: "microsoft_365", label: "Microsoft 365", protocol: "native_oauth", configured: configured(env.MICROSOFT_OAUTH_CLIENT_ID), read: false, write: false },
    { id: "slack", label: "Slack", protocol: "native_oauth", configured: configured(env.SLACK_CLIENT_ID), read: false, write: false }
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
    marketplaceRegistry: true
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
