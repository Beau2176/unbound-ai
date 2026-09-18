function sandboxEndpoint(env = process.env) {
  try {
    const parsed = new URL(String(env.UNBOUND_CODE_SANDBOX_URL || "").trim());
    if (parsed.protocol !== "https:") return null;
    parsed.pathname = parsed.pathname.replace(/\/$/, "");
    return parsed;
  } catch (_) {
    return null;
  }
}

function publicSandboxStatus(env = process.env) {
  return {
    configured: Boolean(sandboxEndpoint(env)),
    remoteExecution: Boolean(sandboxEndpoint(env)),
    productionDeployAllowed: false,
    secretsSentToModel: false
  };
}

function sandboxError(code, message, statusCode = 502) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

async function sandboxRequest(pathname, {
  method = "GET",
  body = null,
  env = process.env,
  fetchImpl = fetch
} = {}) {
  const base = sandboxEndpoint(env);
  if (!base) throw sandboxError("CODE_SANDBOX_NOT_CONFIGURED", "Coding sandbox is not configured.", 503);
  const url = new URL(base.toString());
  url.pathname = base.pathname + String(pathname || "");
  const headers = { accept: "application/json" };
  if (body !== null) headers["content-type"] = "application/json";
  const token = String(env.UNBOUND_CODE_SANDBOX_TOKEN || "").trim();
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetchImpl(url.toString(), {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw sandboxError("CODE_SANDBOX_REQUEST_FAILED", payload?.error || "Coding sandbox request failed.", response.status || 502);
  }
  return payload;
}

async function createSandboxJob({
  objective,
  repository = null,
  branch = null,
  env = process.env,
  fetchImpl = fetch
} = {}) {
  const text = String(objective || "").trim();
  if (!text) throw sandboxError("CODE_SANDBOX_OBJECTIVE_REQUIRED", "Coding objective is required.", 400);
  return sandboxRequest("/jobs", {
    method: "POST",
    env,
    fetchImpl,
    body: {
      objective: text.slice(0, 8000),
      repository: repository ? String(repository).slice(0, 500) : null,
      branch: branch ? String(branch).slice(0, 200) : null,
      permissions: {
        network: "restricted",
        productionDeploy: false,
        irreversibleActions: false
      }
    }
  });
}

async function getSandboxJob(providerJobId, options = {}) {
  const id = encodeURIComponent(String(providerJobId || "").trim());
  if (!id) throw sandboxError("CODE_SANDBOX_JOB_ID_REQUIRED", "Sandbox job ID is required.", 400);
  return sandboxRequest(`/jobs/${id}`, { ...options, method: "GET" });
}

module.exports = {
  sandboxEndpoint,
  publicSandboxStatus,
  sandboxRequest,
  createSandboxJob,
  getSandboxJob
};
