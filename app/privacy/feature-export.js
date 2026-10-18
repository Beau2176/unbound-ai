// Every table/column below is a fixed allowlist. Never export a whole row or
// an unfiltered provider/job JSON object, even when a new field is added later.
const { TEAM_ROLES } = require("../orchestration/teams");

function scalars(value, fields) {
  const out = {};
  for (const field of fields.split(" ")) {
    const item = value?.[field];
    if (item === null || ["string", "boolean", "number"].includes(typeof item)) out[field] = item;
  }
  return out;
}

function strings(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === "string") : [];
}

function sources(value) {
  return Array.isArray(value) ? value.map(item => scalars(item, "number title url domain source publishedAt retrievedAt")) : [];
}

function usage(value) {
  return scalars(value, "input_tokens output_tokens total_tokens inputTokens outputTokens totalTokens modelCalls webCalls costMicros");
}

function jobSnapshot(value) {
  return {
    version: typeof value?.version === "string" ? value.version : null,
    budget: scalars(value?.budget, "maxConcurrent maxModelCalls maxWebCalls maxCostMicros usedModelCalls usedWebCalls usedCostMicros"),
    tasks: Array.isArray(value?.tasks) ? value.tasks.map(task => ({
      ...scalars(task, "id title specialist status attempts output startedAt completedAt"),
      dependsOn: strings(task?.dependsOn),
      tools: strings(task?.tools),
      approval: scalars(task?.approval, "required reason status approvedAt"),
      sources: sources(task?.sources),
      usage: usage(task?.usage)
    })) : []
  };
}

function manifest(value) {
  return {
    ...scalars(value, "manifestVersion slug name summary category version instructions executableCode externalWriteAccess"),
    permissions: strings(value?.permissions),
    tools: strings(value?.tools)
  };
}

// Columns are selected explicitly and projected again on output. JSON fields
// have their own nested allowlists; credential/provider/worker fields stay out.
const SECTIONS = [
  ["memories", "user_memories", "id content enabled created_at updated_at"],
  ["tasks", "scheduled_tasks", "id title note recurrence interval_count next_run_at last_run_at enabled created_at updated_at"],
  ["taskEvents", "scheduled_task_events", "id task_id title note scheduled_for acknowledged_at created_at"],
  ["connectedApps", "connected_app_connections", "id provider provider_account_id provider_account_login connected_at updated_at last_used_at access_token_expires_at refresh_token_expires_at"],
  ["agentRuns", "agent_runs", "id objective research_enabled max_steps completed_steps status cancel_requested final_output final_sources error_public created_at started_at completed_at updated_at", { final_sources: sources }],
  ["agentSteps", "agent_steps", "id run_id step_number output provider model web_search_calls sources citations usage created_at", {
    sources,
    citations: value => Array.isArray(value) ? value.map(item => scalars(item, "sourceNumber sourceIndex startIndex endIndex title url")) : [],
    usage
  }],
  ["projects", "ai_projects", "id name description status created_at updated_at"],
  ["projectMemories", "project_memories", "id project_id content enabled created_at updated_at"],
  ["projectSkills", "project_skill_settings", "project_id skill_id enabled updated_at"],
  ["vaultAssets", "vault_assets", "id project_id name media_type bytes storage_provider storage_state created_at updated_at"],
  ["codingJobs", "coding_workspace_jobs", "id project_id objective status created_at updated_at completed_at"],
  ["agentTeams", "agent_teams", "id project_id name description roles active created_at updated_at", { roles: value => strings(value).filter(role => TEAM_ROLES.includes(role)) }],
  ["backgroundSchedules", "background_agent_schedules", "id project_id title objective recurrence interval_count allow_research next_run_at last_run_at last_job_id enabled created_at updated_at"],
  ["futureCoreJobs", "future_core_jobs", "id project_id objective intent status snapshot created_at updated_at completed_at", { snapshot: jobSnapshot }],
  ["createdSkills", "marketplace_skills", "id slug name summary category manifest review_status published created_at updated_at", { manifest }, "creator_user_id"],
  ["installedSkills", "marketplace_skill_installs", "id skill_id project_id scope_key enabled created_at updated_at"],
  ["activity", "platform_audit_events", "id action created_at"],
  ["communityLearning", "community_learning_preferences", "enabled updated_at"]
];

function camelCase(column) {
  return column.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

async function loadFeatureExport(pool, userId) {
  if (!pool?.query || !/^[1-9]\d*$/.test(String(userId))) throw new Error("A signed-in account is required for feature export.");
  const sections = await Promise.all(SECTIONS.map(async ([name, table, fieldList, json = {}, owner = "user_id"]) => {
    const fields = fieldList.split(" ");
    const select = fields.map(field => field === "id" || field.endsWith("_id") || field === "bytes" ? `${field}::text AS ${field}` : field).join(", ");
    const order = fields.includes("created_at") ? "created_at, id" : fields.includes("id") ? "id" : fields.join(", ");
    const result = await pool.query(`SELECT ${select} FROM ${table} WHERE ${owner} = $1 ORDER BY ${order}`, [userId]);
    return [name, result.rows.map(row => Object.fromEntries(fields.map(field => [camelCase(field), json[field] ? json[field](row[field]) : row[field]])))];
  }));
  return Object.fromEntries(sections);
}

module.exports = { loadFeatureExport };
