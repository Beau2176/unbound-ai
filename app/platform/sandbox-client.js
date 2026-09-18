const DEFAULT_TIMEOUT_MS = 30000;

function clean(value, max = 2000) {
  const text = String(value || "").trim();
  return text && text.length <= max ? text : null;
}

function getSandboxConfig(env = process.env) {
  const raw = clean(env.UNBOUND_CODE_SANDBOX_URL, 1000);
  let endpoint = null;
  try {
    const parsed = new URL(raw || "");
    if (parsed.protocol === "https:") endpoint = parsed.toString().replace(/\/$/, "");
  } catch (_) {}
  return {
    endpoint,
    token: clean(env.UNBOUND_CODE_SANDBOX_TOKEN, 2000),
    configured: Boolean(endpoint && clean(env.UNBOUND_CODE_SANDBOX_TOKEN, 2000)),
    timeoutMs: Math.min(Math.max(Number(env.UNBOUND_CODE_SANDBOX_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, 3000), 120000)
  };
}

async function sandboxRequest(path, body, {
  env = process.env,
  fetchImpl = fetch
} = {}) {
  const config = getSandboxConfig(env);
  if (!config.configured) {
    const error = new Error("Coding sandbox provider is not configured.");
    error.code = "CODE_SANDBOX_NOT_CONFIGURED";
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(`${config.endpoint}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.token}`,
        "user-agent": "UNBOUND-AI-Code-Workspace/1.0"
      },
      body: JSON.stringify(body || {})
    });
    let payload = null;
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      const error = new Error("Coding sandbox rejected the request.");
      error.code = "CODE_SANDBOX_API_ERROR";
      error.statusCode = response.status;
      throw error;
    }
    return payload && typeof payload === "object" ? payload : {};
  } catch (cause) {
    if (cause?.code) throw cause;
    const error = new Error(cause?.name === "AbortError" ? "Coding sandbox request timed out." : "Coding sandbox request failed.");
    error.code = cause?.name === "AbortError" ? "CODE_SANDBOX_TIMEOUT" : "CODE_SANDBOX_REQUEST_FAILED";
    error.cause = cause;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function submitCodingJob({ objective, projectId = null, userId = null, env = process.env, fetchImpl = fetch } = {}) {
  const payload = await sandboxRequest("/v1/jobs", {
    objective: String(objective || "").slice(0, 8000),
    projectId: projectId ? String(projectId) : null,
    userReference: userId ? String(userId) : null,
    permissions: {
      network: "public-only",
      secrets: "server-injected-only",
      irreversibleExternalActions: false
    }
  }, { env, fetchImpl });
  const id = clean(payload.id || payload.jobId, 300);
  if (!id) {
    const error = new Error("Coding sandbox returned an invalid job.");
    error.code = "CODE_SANDBOX_JOB_INVALID";
    throw error;
  }
  return {
    providerJobId: id,
    status: clean(payload.status, 80) || "queued"
  };
}

function publicSandboxStatus(env = process.env) {
  const config = getSandboxConfig(env);
  return {
    configured: config.configured,
    isolatedExecutionRequired: true,
    mainAppServerExecutionAllowed: false,
    irreversibleExternalActions: false,
    browserSuppliedEndpointAccepted: false
  };
}

module.exports = {
  getSandboxConfig,
  sandboxRequest,
  submitCodingJob,
  publicSandboxStatus
};
