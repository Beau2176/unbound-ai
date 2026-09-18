const { taskNeedsApproval } = require("./registry");

const MAX_OBJECTIVE_CHARS = 12000;
const MAX_PLAN_TASKS = 12;

function cleanObjective(value) {
  const objective = String(value || "").trim();
  if (!objective || objective.length > MAX_OBJECTIVE_CHARS) {
    const error = new Error("Future Core objective is invalid.");
    error.code = "FUTURE_CORE_OBJECTIVE_INVALID";
    error.statusCode = 400;
    error.publicMessage = `Enter an objective between 1 and ${MAX_OBJECTIVE_CHARS.toLocaleString()} characters.`;
    throw error;
  }
  return objective;
}

function detectIntent(objective) {
  const text = String(objective || "").toLowerCase();
  const research = /\b(research|look up|search|latest|current|verify|sources?|news|compare evidence|market|trend)\b/.test(text);
  const build = /\b(build|create|code|implement|develop|design|draft|make|produce|write|refactor|fix|website|app|artifact)\b/.test(text);
  const action = /\b(send|submit|buy|purchase|pay|book|apply|delete|publish|deploy|transfer|post|message|email)\b/.test(text);
  const analyze = /\b(analy[sz]e|evaluate|review|debug|diagnose|strategy|plan|investigate|compare|explain)\b/.test(text);

  if (action && (research || build || analyze)) return "mixed_action";
  if (research && build) return "research_build";
  if (action) return "action";
  if (research) return "research";
  if (build) return "build";
  if (analyze) return "analysis";
  return "general";
}

function task(id, title, specialist, dependsOn = [], tools = [], approval = null) {
  const item = {
    id,
    title,
    specialist,
    dependsOn,
    tools,
    approval: approval || { required: false, reason: null }
  };
  item.approval.required = taskNeedsApproval(item);
  return item;
}

function buildFuturePlan(objectiveInput, options = {}) {
  const objective = cleanObjective(objectiveInput);
  const intent = detectIntent(objective);
  const tasks = [];

  if (["research", "research_build", "mixed_action"].includes(intent)) {
    tasks.push(task("research", "Gather current, source-backed evidence", "researcher", [], ["web_research", "memory_context"]));
  }

  const analysisDependencies = tasks.length ? ["research"] : [];
  tasks.push(task("analysis", "Break down the objective and define the working approach", "analyst", analysisDependencies, ["memory_context"]));

  if (["build", "research_build", "mixed_action"].includes(intent)) {
    tasks.push(task("build", "Produce the requested implementation or artifact", "builder", ["analysis"], ["memory_context"]));
  }

  if (["action", "mixed_action"].includes(intent)) {
    const deps = tasks.some((item) => item.id === "build") ? ["build"] : ["analysis"];
    tasks.push(task("prepare_action", "Prepare the external action and verify its inputs", "action_planner", deps, ["memory_context"]));
    tasks.push(task(
      "execute_action",
      "Execute the approved external action",
      "coordinator",
      ["prepare_action"],
      ["external_action"],
      { required: true, reason: "External or potentially irreversible actions require explicit user approval immediately before execution." }
    ));
  }

  const reviewDependsOn = tasks
    .filter((item) => item.id !== "execute_action")
    .slice(-1)
    .map((item) => item.id);
  tasks.push(task("review", "Review the work for completeness, contradictions, and unsupported claims", "reviewer", reviewDependsOn, []));

  if (tasks.length > MAX_PLAN_TASKS) {
    const error = new Error("Future Core generated too many tasks.");
    error.code = "FUTURE_CORE_PLAN_TOO_LARGE";
    throw error;
  }

  return {
    version: "v2.0",
    objective,
    intent,
    createdAt: new Date().toISOString(),
    tasks,
    requiredSpecialists: [...new Set(tasks.map((item) => item.specialist))],
    requiredTools: [...new Set(tasks.flatMap((item) => item.tools))],
    requiresHumanApproval: tasks.some((item) => item.approval.required),
    options: {
      allowResearch: options.allowResearch !== false,
      allowExternalActions: Boolean(options.allowExternalActions)
    }
  };
}

module.exports = {
  MAX_OBJECTIVE_CHARS,
  MAX_PLAN_TASKS,
  cleanObjective,
  detectIntent,
  buildFuturePlan
};
