const crypto = require("crypto");

const JOB_STATUSES = Object.freeze([
  "planned",
  "running",
  "waiting_approval",
  "paused_budget",
  "completed",
  "failed",
  "cancelled"
]);

const TASK_STATUSES = Object.freeze([
  "pending",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled"
]);

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeBudget(input = {}) {
  return {
    maxConcurrent: clampInteger(input.maxConcurrent, 3, 1, 6),
    maxModelCalls: clampInteger(input.maxModelCalls, 16, 1, 64),
    maxWebCalls: clampInteger(input.maxWebCalls, 12, 0, 64),
    maxCostMicros: clampInteger(input.maxCostMicros, 500000, 0, 50000000),
    usedModelCalls: clampInteger(input.usedModelCalls, 0, 0, 1000000),
    usedWebCalls: clampInteger(input.usedWebCalls, 0, 0, 1000000),
    usedCostMicros: clampInteger(input.usedCostMicros, 0, 0, 100000000000)
  };
}

function createJobState({ id = crypto.randomUUID(), userId = null, plan, budget = {} } = {}) {
  if (!plan || !Array.isArray(plan.tasks) || !plan.objective) {
    const error = new Error("A valid Future Core plan is required.");
    error.code = "FUTURE_CORE_PLAN_REQUIRED";
    throw error;
  }

  const now = new Date().toISOString();
  return {
    id: String(id),
    userId: userId === null ? null : String(userId),
    version: "v2.0",
    objective: plan.objective,
    intent: plan.intent,
    status: "planned",
    budget: normalizeBudget(budget),
    tasks: plan.tasks.map((item) => ({
      ...item,
      status: item.approval?.required ? "waiting_approval" : "pending",
      approval: {
        required: Boolean(item.approval?.required),
        reason: item.approval?.reason || null,
        status: item.approval?.required ? "pending" : "not_required",
        approvedAt: null,
        approvedBy: null
      },
      attempts: 0,
      output: "",
      sources: [],
      usage: null,
      error: null,
      startedAt: null,
      completedAt: null
    })),
    createdAt: now,
    updatedAt: now,
    completedAt: null
  };
}

function dependenciesCompleted(job, task) {
  const ids = Array.isArray(task.dependsOn) ? task.dependsOn : [];
  return ids.every((id) => job.tasks.find((candidate) => candidate.id === id)?.status === "completed");
}

function budgetExhausted(job) {
  const b = job.budget;
  return b.usedModelCalls >= b.maxModelCalls ||
    b.usedWebCalls > b.maxWebCalls ||
    b.usedCostMicros > b.maxCostMicros;
}

function refreshJobStatus(job) {
  if (["failed", "cancelled", "completed"].includes(job.status)) return job;
  if (budgetExhausted(job)) {
    job.status = "paused_budget";
    job.updatedAt = new Date().toISOString();
    return job;
  }
  if (job.tasks.every((task) => task.status === "completed")) {
    job.status = "completed";
    job.completedAt = new Date().toISOString();
  } else if (job.tasks.some((task) => task.status === "waiting_approval" && dependenciesCompleted(job, task))) {
    job.status = "waiting_approval";
  } else if (job.tasks.some((task) => task.status === "running")) {
    job.status = "running";
  } else {
    job.status = "planned";
  }
  job.updatedAt = new Date().toISOString();
  return job;
}

function getRunnableTasks(job) {
  if (!job || ["failed", "cancelled", "completed", "paused_budget"].includes(job.status)) return [];
  return job.tasks
    .filter((task) =>
      task.status === "pending" &&
      task.approval?.status !== "pending" &&
      dependenciesCompleted(job, task)
    )
    .slice(0, job.budget.maxConcurrent);
}

function startTask(job, taskId) {
  const task = job.tasks.find((item) => item.id === taskId);
  if (!task || task.status !== "pending" || !dependenciesCompleted(job, task)) {
    const error = new Error("Task is not runnable.");
    error.code = "FUTURE_CORE_TASK_NOT_RUNNABLE";
    throw error;
  }
  task.status = "running";
  task.attempts += 1;
  task.startedAt = new Date().toISOString();
  job.status = "running";
  job.updatedAt = task.startedAt;
  return task;
}

function completeTask(job, taskId, result = {}) {
  const task = job.tasks.find((item) => item.id === taskId);
  if (!task || task.status !== "running") {
    const error = new Error("Task is not running.");
    error.code = "FUTURE_CORE_TASK_NOT_RUNNING";
    throw error;
  }
  task.status = "completed";
  task.output = String(result.output || "");
  task.sources = Array.isArray(result.sources) ? result.sources : [];
  task.usage = result.usage || null;
  task.error = null;
  task.completedAt = new Date().toISOString();
  refreshJobStatus(job);
  return task;
}

function failTask(job, taskId, error) {
  const task = job.tasks.find((item) => item.id === taskId);
  if (!task) return null;
  task.status = "failed";
  task.error = String(error?.publicMessage || error?.message || error || "Task failed.");
  task.completedAt = new Date().toISOString();
  job.status = "failed";
  job.updatedAt = task.completedAt;
  return task;
}

function approveTask(job, taskId, approvedBy = "user") {
  const task = job.tasks.find((item) => item.id === taskId);
  if (!task || !task.approval?.required) {
    const error = new Error("This task does not require approval.");
    error.code = "FUTURE_CORE_APPROVAL_NOT_REQUIRED";
    throw error;
  }
  if (!dependenciesCompleted(job, task)) {
    const error = new Error("Approval cannot be applied before prerequisite work is completed.");
    error.code = "FUTURE_CORE_APPROVAL_TOO_EARLY";
    throw error;
  }
  task.approval.status = "approved";
  task.approval.approvedAt = new Date().toISOString();
  task.approval.approvedBy = String(approvedBy || "user").slice(0, 120);
  task.status = "pending";
  refreshJobStatus(job);
  return task;
}

function applyUsage(job, usage = {}) {
  job.budget.usedModelCalls += clampInteger(usage.modelCalls, 0, 0, 1000);
  job.budget.usedWebCalls += clampInteger(usage.webCalls, 0, 0, 1000);
  job.budget.usedCostMicros += clampInteger(usage.costMicros, 0, 0, 1000000000);
  refreshJobStatus(job);
  return job.budget;
}

function cancelJob(job) {
  if (["completed", "failed", "cancelled"].includes(job.status)) return job;
  for (const task of job.tasks) {
    if (!["completed", "failed"].includes(task.status)) task.status = "cancelled";
  }
  job.status = "cancelled";
  job.updatedAt = new Date().toISOString();
  job.completedAt = job.updatedAt;
  return job;
}

function serializeJob(job) {
  return JSON.stringify(job);
}

function hydrateJob(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : structuredClone(value);
  if (!parsed || !JOB_STATUSES.includes(parsed.status) || !Array.isArray(parsed.tasks)) {
    const error = new Error("Stored Future Core job is invalid.");
    error.code = "FUTURE_CORE_JOB_INVALID";
    throw error;
  }
  for (const task of parsed.tasks) {
    if (!TASK_STATUSES.includes(task.status)) {
      const error = new Error("Stored Future Core task state is invalid.");
      error.code = "FUTURE_CORE_TASK_STATE_INVALID";
      throw error;
    }
  }
  parsed.budget = normalizeBudget(parsed.budget);
  return parsed;
}

module.exports = {
  JOB_STATUSES,
  TASK_STATUSES,
  normalizeBudget,
  createJobState,
  dependenciesCompleted,
  budgetExhausted,
  refreshJobStatus,
  getRunnableTasks,
  startTask,
  completeTask,
  failTask,
  approveTask,
  applyUsage,
  cancelJob,
  serializeJob,
  hydrateJob
};
