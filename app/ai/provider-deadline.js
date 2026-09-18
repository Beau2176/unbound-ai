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
  timeoutMs = null,
  externalSignal = null
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
  let externallyAborted = false;
  let externalAbortReason = null;

  const abortFromExternal = () => {
    externallyAborted = true;
    externalAbortReason = externalSignal?.reason || null;
    if (controller.signal.aborted) return;
    const reason = externalSignal?.reason || (
      typeof DOMException === "function"
        ? new DOMException("UNBOUND request was cancelled.", "AbortError")
        : Object.assign(new Error("UNBOUND request was cancelled."), { name: "AbortError" })
    );
    controller.abort(reason);
  };

  if (externalSignal?.aborted) {
    abortFromExternal();
  } else if (externalSignal?.addEventListener) {
    externalSignal.addEventListener("abort", abortFromExternal, { once: true });
  }

  const timer = setTimeout(() => {
    if (controller.signal.aborted) return;
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
    externallyAborted: () => externallyAborted,
    externalAbortReason: () => externalAbortReason,
    cancel() {
      clearTimeout(timer);
      try {
        externalSignal?.removeEventListener?.("abort", abortFromExternal);
      } catch (_) {}
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

function providerCancellationError(label = "AI provider request", reason = null) {
  const error = new Error(`${label} was cancelled because the client request ended.`);
  error.code = "AI_REQUEST_ABORTED";
  error.statusCode = 499;
  if (reason) error.cause = reason;
  return error;
}

function isProviderCancellationError(error) {
  return String(error?.code || "") === "AI_REQUEST_ABORTED";
}

async function runWithProviderDeadline(
  kind,
  operation,
  {
    env = process.env,
    timeoutMs = null,
    externalSignal = null,
    code = "AI_PROVIDER_TIMEOUT",
    label = "AI provider request"
  } = {}
) {
  const deadline = createProviderDeadline(kind, {
    env,
    timeoutMs,
    externalSignal
  });
  try {
    if (deadline.externallyAborted()) {
      throw providerCancellationError(label, deadline.externalAbortReason());
    }
    return await operation(deadline);
  } catch (error) {
    if (deadline.externallyAborted() && !deadline.timedOut()) {
      throw providerCancellationError(label, deadline.externalAbortReason() || error);
    }
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
  providerCancellationError,
  isProviderCancellationError,
  runWithProviderDeadline
};
