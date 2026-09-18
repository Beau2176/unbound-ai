const DEFAULT_PROVIDER_BULKHEAD_POLICY = Object.freeze({
  maxConcurrent: 16,
  maxQueue: 64,
  queueTimeoutMs: 2500,
  minConcurrent: 1,
  maxConcurrentLimit: 128,
  minQueue: 0,
  maxQueueLimit: 512,
  minQueueTimeoutMs: 100,
  maxQueueTimeoutMs: 30000
});

const states = new Map();

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function cleanProviderId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) ? id : "unknown";
}

function providerEnvPrefix(providerId) {
  const id = cleanProviderId(providerId);
  if (id === "openai") return "OPENAI";
  if (id === "anthropic") return "ANTHROPIC";
  if (id === "google") return "GEMINI";
  if (id === "local") return "LOCAL_AI";
  return null;
}

function getProviderBulkheadPolicy(providerId, env = process.env) {
  const prefix = providerEnvPrefix(providerId);
  const maxConcurrentValue = prefix
    ? env[`${prefix}_MAX_CONCURRENT`] ?? env.AI_PROVIDER_MAX_CONCURRENT
    : env.AI_PROVIDER_MAX_CONCURRENT;
  const maxQueueValue = prefix
    ? env[`${prefix}_MAX_QUEUE`] ?? env.AI_PROVIDER_MAX_QUEUE
    : env.AI_PROVIDER_MAX_QUEUE;
  const queueTimeoutValue = prefix
    ? env[`${prefix}_QUEUE_TIMEOUT_MS`] ?? env.AI_PROVIDER_QUEUE_TIMEOUT_MS
    : env.AI_PROVIDER_QUEUE_TIMEOUT_MS;

  return Object.freeze({
    maxConcurrent: boundedInteger(
      maxConcurrentValue,
      DEFAULT_PROVIDER_BULKHEAD_POLICY.maxConcurrent,
      DEFAULT_PROVIDER_BULKHEAD_POLICY.minConcurrent,
      DEFAULT_PROVIDER_BULKHEAD_POLICY.maxConcurrentLimit
    ),
    maxQueue: boundedInteger(
      maxQueueValue,
      DEFAULT_PROVIDER_BULKHEAD_POLICY.maxQueue,
      DEFAULT_PROVIDER_BULKHEAD_POLICY.minQueue,
      DEFAULT_PROVIDER_BULKHEAD_POLICY.maxQueueLimit
    ),
    queueTimeoutMs: boundedInteger(
      queueTimeoutValue,
      DEFAULT_PROVIDER_BULKHEAD_POLICY.queueTimeoutMs,
      DEFAULT_PROVIDER_BULKHEAD_POLICY.minQueueTimeoutMs,
      DEFAULT_PROVIDER_BULKHEAD_POLICY.maxQueueTimeoutMs
    )
  });
}

function createState() {
  return {
    active: 0,
    queue: [],
    admitted: 0,
    queuedTotal: 0,
    rejected: 0,
    queueTimeouts: 0,
    queueCancellations: 0,
    maxObservedActive: 0,
    maxObservedQueue: 0
  };
}

function stateFor(providerId) {
  const id = cleanProviderId(providerId);
  if (!states.has(id)) states.set(id, createState());
  return { id, state: states.get(id) };
}

function bulkheadError(code, message, providerId, statusCode = 503) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.providerId = cleanProviderId(providerId);
  return error;
}

function isProviderBulkheadError(error) {
  return /^AI_PROVIDER_BULKHEAD_/.test(String(error?.code || ""));
}

function requestCancelledError(providerId, reason = null) {
  const error = bulkheadError(
    "AI_REQUEST_ABORTED",
    "AI request was cancelled before a provider slot became available.",
    providerId,
    499
  );
  if (reason) error.cause = reason;
  return error;
}

function cleanupQueuedItem(item) {
  clearTimeout(item.timer);
  try {
    item.signal?.removeEventListener?.("abort", item.onAbort);
  } catch (_) {}
}

function createPermit(id, state) {
  let released = false;
  state.active += 1;
  state.admitted += 1;
  state.maxObservedActive = Math.max(state.maxObservedActive, state.active);

  return Object.freeze({
    providerId: id,
    release() {
      if (released) return false;
      released = true;
      state.active = Math.max(0, state.active - 1);
      drainQueue(id, state);
      return true;
    }
  });
}

function drainQueue(id, state) {
  while (state.queue.length) {
    const next = state.queue[0];
    if (state.active >= next.maxConcurrent) return;

    state.queue.shift();
    cleanupQueuedItem(next);
    next.settled = true;
    next.resolve(createPermit(id, state));
  }
}

async function acquireProviderBulkheadSlot(providerId, {
  env = process.env,
  signal = null
} = {}) {
  const { id, state } = stateFor(providerId);
  const policy = getProviderBulkheadPolicy(id, env);

  if (signal?.aborted) {
    throw requestCancelledError(id, signal.reason || null);
  }

  if (state.active < policy.maxConcurrent) {
    return createPermit(id, state);
  }

  if (policy.maxQueue === 0 || state.queue.length >= policy.maxQueue) {
    state.rejected += 1;
    throw bulkheadError(
      "AI_PROVIDER_BULKHEAD_REJECTED",
      `AI provider '${id}' is at its configured concurrency and queue limit.`,
      id
    );
  }

  state.queuedTotal += 1;

  return new Promise((resolve, reject) => {
    const item = {
      maxConcurrent: policy.maxConcurrent,
      resolve,
      reject,
      settled: false,
      timer: null,
      signal,
      onAbort: null
    };

    item.onAbort = () => {
      if (item.settled) return;
      item.settled = true;
      const index = state.queue.indexOf(item);
      if (index >= 0) state.queue.splice(index, 1);
      cleanupQueuedItem(item);
      state.queueCancellations += 1;
      reject(requestCancelledError(id, signal?.reason || null));
    };

    item.timer = setTimeout(() => {
      if (item.settled) return;
      item.settled = true;
      const index = state.queue.indexOf(item);
      if (index >= 0) state.queue.splice(index, 1);
      cleanupQueuedItem(item);
      state.queueTimeouts += 1;
      reject(
        bulkheadError(
          "AI_PROVIDER_BULKHEAD_QUEUE_TIMEOUT",
          `AI provider '${id}' remained at capacity beyond the ${policy.queueTimeoutMs} ms queue wait limit.`,
          id
        )
      );
    }, policy.queueTimeoutMs);
    item.timer.unref?.();

    state.queue.push(item);
    state.maxObservedQueue = Math.max(state.maxObservedQueue, state.queue.length);

    if (signal?.aborted) {
      item.onAbort();
    } else {
      signal?.addEventListener?.("abort", item.onAbort, { once: true });
    }
  });
}

async function runWithProviderBulkhead(providerId, operation, options = {}) {
  const permit = await acquireProviderBulkheadSlot(providerId, options);
  try {
    return await operation();
  } finally {
    permit.release();
  }
}

function publicState(providerId, state, policy) {
  return Object.freeze({
    provider: cleanProviderId(providerId),
    active: state.active,
    queued: state.queue.length,
    maxConcurrent: policy.maxConcurrent,
    maxQueue: policy.maxQueue,
    queueTimeoutMs: policy.queueTimeoutMs,
    admitted: state.admitted,
    queuedTotal: state.queuedTotal,
    rejected: state.rejected,
    queueTimeouts: state.queueTimeouts,
    queueCancellations: state.queueCancellations,
    maxObservedActive: state.maxObservedActive,
    maxObservedQueue: state.maxObservedQueue
  });
}

function getProviderBulkheadSnapshot(providerId, env = process.env) {
  const id = cleanProviderId(providerId);
  const state = states.get(id) || createState();
  return publicState(id, state, getProviderBulkheadPolicy(id, env));
}

function getProviderBulkheadSnapshots(providerIds = [], env = process.env) {
  const ids = [...new Set(
    (Array.isArray(providerIds) ? providerIds : [providerIds])
      .map(cleanProviderId)
      .filter((id) => id !== "unknown")
  )];
  const result = {};
  for (const id of ids) {
    result[id] = getProviderBulkheadSnapshot(id, env);
  }
  return Object.freeze(result);
}

function resetProviderBulkheads() {
  for (const [id, state] of states.entries()) {
    for (const item of state.queue.splice(0)) {
      cleanupQueuedItem(item);
      if (!item.settled) {
        item.settled = true;
        item.reject(
          bulkheadError(
            "AI_PROVIDER_BULKHEAD_RESET",
            `AI provider '${id}' bulkhead was reset.`,
            id
          )
        );
      }
    }
  }
  states.clear();
}

module.exports = {
  DEFAULT_PROVIDER_BULKHEAD_POLICY,
  boundedInteger,
  cleanProviderId,
  providerEnvPrefix,
  getProviderBulkheadPolicy,
  acquireProviderBulkheadSlot,
  runWithProviderBulkhead,
  getProviderBulkheadSnapshot,
  getProviderBulkheadSnapshots,
  isProviderBulkheadError,
  resetProviderBulkheads
};
