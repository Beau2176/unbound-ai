const FUTURE_CORE_V2_VERSION = "v2.0-staged";

const SPECIALISTS = Object.freeze({
  coordinator: Object.freeze({ id: "coordinator", label: "Coordinator", purpose: "Own the objective, reconcile subtask results, and keep the job moving." }),
  researcher: Object.freeze({ id: "researcher", label: "Researcher", purpose: "Gather and verify current evidence using approved read-only research tools." }),
  analyst: Object.freeze({ id: "analyst", label: "Analyst", purpose: "Break down problems, compare evidence, surface assumptions, and reason through tradeoffs." }),
  builder: Object.freeze({ id: "builder", label: "Builder", purpose: "Produce concrete artifacts, implementation drafts, plans, and structured outputs." }),
  reviewer: Object.freeze({ id: "reviewer", label: "Reviewer", purpose: "Check completeness, contradictions, unsupported claims, and delivery quality." }),
  action_planner: Object.freeze({ id: "action_planner", label: "Action Planner", purpose: "Prepare external actions without executing them until the required human approval exists." })
});

const TOOL_REGISTRY = Object.freeze({
  web_research: Object.freeze({ id: "web_research", label: "Web Research", kind: "read", enabledByDefault: true, approvalRequired: false, externalSideEffect: false }),
  memory_context: Object.freeze({ id: "memory_context", label: "Relevant Memory", kind: "read", enabledByDefault: true, approvalRequired: false, externalSideEffect: false }),
  file_analysis: Object.freeze({ id: "file_analysis", label: "File Analysis", kind: "read", enabledByDefault: true, approvalRequired: false, externalSideEffect: false }),
  connected_apps_read: Object.freeze({ id: "connected_apps_read", label: "Connected Apps Read", kind: "read", enabledByDefault: true, approvalRequired: false, externalSideEffect: false }),
  browser_read: Object.freeze({ id: "browser_read", label: "Browser Read", kind: "read", enabledByDefault: false, approvalRequired: false, externalSideEffect: false, requiresRuntimeConfiguration: true }),
  external_action: Object.freeze({
    id: "external_action",
    label: "External Action",
    kind: "write",
    enabledByDefault: false,
    approvalRequired: true,
    externalSideEffect: true,
    examples: Object.freeze(["send", "submit", "buy", "pay", "book", "apply", "delete", "publish", "deploy", "transfer"])
  })
});

function normalizeSpecialist(value) {
  const id = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SPECIALISTS, id) ? id : "coordinator";
}

function getToolDefinition(value) {
  const id = String(value || "").trim().toLowerCase();
  return TOOL_REGISTRY[id] || null;
}

function taskNeedsApproval(task = {}) {
  if (task?.approval?.required) return true;
  return (Array.isArray(task.tools) ? task.tools : []).some((toolId) => Boolean(getToolDefinition(toolId)?.approvalRequired));
}

function unavailableToolsForTask(task = {}, availability = {}) {
  return (Array.isArray(task.tools) ? task.tools : []).filter((toolId) => {
    const tool = getToolDefinition(toolId);
    if (!tool) return true;
    if (Object.prototype.hasOwnProperty.call(availability, toolId)) return !Boolean(availability[toolId]);
    return !Boolean(tool.enabledByDefault);
  });
}

function publicRegistry() {
  return {
    version: FUTURE_CORE_V2_VERSION,
    specialists: Object.values(SPECIALISTS),
    tools: Object.values(TOOL_REGISTRY).map((tool) => ({
      id: tool.id,
      label: tool.label,
      kind: tool.kind,
      approvalRequired: Boolean(tool.approvalRequired),
      externalSideEffect: Boolean(tool.externalSideEffect),
      enabledByDefault: Boolean(tool.enabledByDefault),
      requiresRuntimeConfiguration: Boolean(tool.requiresRuntimeConfiguration)
    }))
  };
}

module.exports = {
  FUTURE_CORE_V2_VERSION,
  SPECIALISTS,
  TOOL_REGISTRY,
  normalizeSpecialist,
  getToolDefinition,
  taskNeedsApproval,
  unavailableToolsForTask,
  publicRegistry
};
