const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildFuturePlan } = require("../orchestration/planner");
const {
  TEAM_ROLES,
  normalizeAgentTeamInput,
  ensurePlanSupportedByTeam
} = require("../orchestration/teams");
const { integratePlatformParityServerSource } = require("../platform/server-integration");

function main() {
  assert.deepStrictEqual(
    normalizeAgentTeamInput({
      name: "Research Build Team",
      description: "Bounded team",
      roles: ["coordinator", "researcher", "analyst", "builder", "reviewer"]
    }).roles,
    ["coordinator", "researcher", "analyst", "builder", "reviewer"]
  );

  assert.throws(
    () => normalizeAgentTeamInput({
      name: "Missing Review",
      roles: ["coordinator", "analyst"]
    }),
    /Coordinator and Reviewer/
  );
  assert.throws(
    () => normalizeAgentTeamInput({
      name: "Unsafe Custom Role",
      roles: ["coordinator", "reviewer", "shell_operator"]
    }),
    /Unknown Future Core specialist/
  );

  assert(TEAM_ROLES.includes("action_planner"));
  assert(!TEAM_ROLES.includes("shell_operator"));

  const researchPlan = buildFuturePlan("Research the latest market and write a report.");
  assert.strictEqual(
    ensurePlanSupportedByTeam(
      researchPlan,
      ["coordinator", "researcher", "analyst", "builder", "reviewer"]
    ),
    true
  );
  assert.throws(
    () => ensurePlanSupportedByTeam(
      researchPlan,
      ["coordinator", "analyst", "builder", "reviewer"]
    ),
    (error) =>
      error &&
      error.code === "FUTURE_CORE_TEAM_MISSING_SPECIALIST" &&
      error.missingSpecialists.includes("researcher")
  );

  const actionPlan = buildFuturePlan("Prepare and send an email update.");
  assert.throws(
    () => ensurePlanSupportedByTeam(
      actionPlan,
      ["coordinator", "analyst", "reviewer"]
    ),
    (error) =>
      error &&
      error.code === "FUTURE_CORE_TEAM_MISSING_SPECIALIST" &&
      error.missingSpecialists.includes("action_planner")
  );

  const platformRoutes = fs.readFileSync(path.join(__dirname, "..", "platform", "routes.js"), "utf8");
  assert(platformRoutes.includes('"/agent-teams"'));
  assert(platformRoutes.includes('"/agent-teams/:id"'));
  assert(platformRoutes.includes("MAX_AGENT_TEAMS_PER_USER"));

  const futureRoutes = fs.readFileSync(path.join(__dirname, "..", "orchestration", "routes.js"), "utf8");
  assert(futureRoutes.includes("teamId"));
  assert(futureRoutes.includes("ensurePlanSupportedByTeam"));
  assert(futureRoutes.includes("FUTURE_CORE_TEAM_PROJECT_MISMATCH"));
  assert(futureRoutes.includes("job.team = team ? teamSnapshot(team) : null"));

  const minimal = [
    'const { createFutureCoreRouter } = require("./orchestration/routes");',
    "async function schema() {",
    "  await pool.query(`",
    "    CREATE INDEX IF NOT EXISTS future_core_jobs_status_idx",
    "      ON future_core_jobs(status, updated_at DESC);",
    "  `);",
    "}",
    'app.get("/api/health", (req, res) => {',
    "});"
  ].join("\n");

  const integrated = integratePlatformParityServerSource(minimal);
  assert(integrated.includes("CREATE TABLE IF NOT EXISTS agent_teams"));
  assert(integrated.includes("agent_teams_user_idx"));
  assert.strictEqual(integratePlatformParityServerSource(integrated), integrated);

  console.log("PASS platform parity wave 5: bounded project Agent teams are persisted and enforced by Future Core plans.");
}

main();
