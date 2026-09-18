const DEFAULT_PROVIDER_DEADLINE_POLICY = Object.freeze({
  chatMs: 45000,
  streamMs: 120000,
  researchMs: 180000,
  fileMs: 180000,
  minMs: 5000,
  maxMs: 300000
});

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getProviderDeadlinePolicy(env = process.env) {
  const min = DEFAULT_PROVIDER_DEADLINE_POLICY.minMs;
  const max = DEFAULT_PROVIDER_DEADLINE_POLICY.maxMs;
  return Object.freeze({
    chatMs: boundedInteger(
      env.AI_PROVIDER_TIMEOUT_MS,
      DEFAULT_PROVIDER_DEADLINE_POLICY.chatMs,
      min,
      max
    ),
    streamMs: boundedInteger(
      env.AI_PROVIDER_STREAM_TIMEOUT_MS,
      DEFAULT_PROVIDER_DEADLINE_POLICY.streamMs,
      min,
      max
    ),
    researchMs: boundedInteger(
      env.AI_RESEARCH_TIMEOUT_MS,
      DEFAULT_PROVIDER_DEADLINE_POLICY.researchMs,
      min,
      max
    ),
    fileMs: boundedInteger(
      env.AI_FILE_ANALYSIS_TIMEOUT_MS,
      DEFAULT_PROVIDER_DEADLINE_POLICY.fileMs,
      min,
      max
    )
  });
}

function getProviderDeadlineMs(kind, env = process.env) {
  const policy = getProviderDeadlinePolicy(env);
  if (kind === "stream") return policy.streamMs;
  if (kind === "research") return policy.researchMs;
  if (kind === "file") return policy.fileMs;
  return policy.chatMs;
}

function createProviderDeadline(kind = "chat", {
  env = process.env,
  timeoutMs = null
} = {}) {
  const configured = timeoutMs === null
    ? getProviderDeadlineMs(kind, env)
    : boundedInteger(
        timeoutMs,
        getProviderDeadlineMs(kind, env),
        1,
        DEFAULT_PROVIDER_DEADLINE_POLICY.maxMs
      );
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    const reason = typeof DOMException === "function"
      ? new DOMException("UNBOUND provider deadline exceeded.", "TimeoutError")
      : Object.assign(new Error("UNBOUND provider deadline exceeded."), { name: "TimeoutError" });
    controller.abort(reason);
  }, configured);
  timer.unref?.();

  return Object.freeze({
    kind,
    timeoutMs: configured,
    signal: controller.signal,
    deadlineAt: Date.now() + configured,
    timedOut: () => timedOut,
    cancel() {
      clearTimeout(timer);
    }
  });
}

function isTimeoutLikeError(error) {
  const name = String(error?.name || error?.constructor?.name || "").toLowerCase();
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();

  if (
    name.includes("timeout") ||
    name === "aborterror" ||
    code === "ETIMEDOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_BODY_TIMEOUT"
  ) {
    return true;
  }

  return /\b(?:timed out|timeout)\b/.test(message);
}

function providerDeadlineError(code, label, timeoutMs) {
  const error = new Error(`${label} exceeded the ${timeoutMs} ms UNBOUND deadline.`);
  error.code = code;
  error.statusCode = 504;
  error.timeoutMs = timeoutMs;
  return error;
}

async function runWithProviderDeadline(
  kind,
  operation,
  {
    env = process.env,
    timeoutMs = null,
    code = "AI_PROVIDER_TIMEOUT",
    label = "AI provider request"
  } = {}
) {
  const deadline = createProviderDeadline(kind, { env, timeoutMs });
  try {
    return await operation(deadline);
  } catch (error) {
    if (deadline.timedOut() || isTimeoutLikeError(error)) {
      throw providerDeadlineError(code, label, deadline.timeoutMs);
    }
    throw error;
  } finally {
    deadline.cancel();
  }
}

module.exports = {
  DEFAULT_PROVIDER_DEADLINE_POLICY,
  boundedInteger,
  getProviderDeadlinePolicy,
  getProviderDeadlineMs,
  createProviderDeadline,
  isTimeoutLikeError,
  providerDeadlineError,
  runWithProviderDeadline
};
