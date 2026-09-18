const crypto = require("crypto");
const { SPECIALISTS } = require("./registry");

const MAX_AGENT_TEAMS_PER_USER = 20;
const MAX_TEAM_NAME = 100;
const MAX_TEAM_DESCRIPTION = 1000;
const TEAM_ROLES = Object.freeze(Object.keys(SPECIALISTS));

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function normalizeRoles(value) {
  const input = Array.isArray(value) ? value : [];
  const roles = [];
  for (const item of input) {
    const role = String(item || "").trim().toLowerCase();
    if (!role || roles.includes(role)) continue;
    if (!TEAM_ROLES.includes(role)) {
      const error = new Error("Unknown Future Core specialist: " + role + ".");
      error.code = "AGENT_TEAM_ROLE_INVALID";
      error.statusCode = 400;
      throw error;
    }
    roles.push(role);
  }
  if (roles.length < 2 || roles.length > TEAM_ROLES.length) {
    const error = new Error("Agent teams must contain between 2 and " + TEAM_ROLES.length + " specialists.");
    error.code = "AGENT_TEAM_SIZE_INVALID";
    error.statusCode = 400;
    throw error;
  }
  if (!roles.includes("coordinator") || !roles.includes("reviewer")) {
    const error = new Error("Agent teams must include the Coordinator and Reviewer specialists.");
    error.code = "AGENT_TEAM_CORE_ROLES_REQUIRED";
    error.statusCode = 400;
    throw error;
  }
  return roles;
}

function normalizeAgentTeamInput(body = {}) {
  const name = cleanText(body.name, MAX_TEAM_NAME);
  const description = cleanText(body.description, MAX_TEAM_DESCRIPTION);
  if (!name) {
    const error = new Error("Agent team name is required.");
    error.code = "AGENT_TEAM_NAME_REQUIRED";
    error.statusCode = 400;
    throw error;
  }
  return {
    id: crypto.randomUUID(),
    name,
    description,
    roles: normalizeRoles(body.roles)
  };
}

function publicAgentTeam(row) {
  const roles = Array.isArray(row.roles) ? row.roles : [];
  return {
    id: String(row.id),
    projectId: row.project_id ? String(row.project_id) : null,
    name: row.name,
    description: row.description || "",
    roles: roles.filter((role) => TEAM_ROLES.includes(role)),
    active: row.active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function ensurePlanSupportedByTeam(plan, roles) {
  const allowed = new Set(normalizeRoles(roles));
  const required = Array.isArray(plan?.requiredSpecialists) ? plan.requiredSpecialists : [];
  const missing = required.filter((role) => !allowed.has(role));
  if (missing.length) {
    const error = new Error("This Agent team is missing required specialists: " + missing.join(", ") + ".");
    error.code = "FUTURE_CORE_TEAM_MISSING_SPECIALIST";
    error.statusCode = 409;
    error.publicMessage = "That Agent team does not contain every specialist required for this objective.";
    error.missingSpecialists = missing;
    throw error;
  }
  return true;
}

function teamSnapshot(row) {
  const team = publicAgentTeam(row);
  return {
    id: team.id,
    name: team.name,
    roles: team.roles
  };
}

module.exports = {
  MAX_AGENT_TEAMS_PER_USER,
  MAX_TEAM_NAME,
  MAX_TEAM_DESCRIPTION,
  TEAM_ROLES,
  normalizeRoles,
  normalizeAgentTeamInput,
  publicAgentTeam,
  ensurePlanSupportedByTeam,
  teamSnapshot
};
