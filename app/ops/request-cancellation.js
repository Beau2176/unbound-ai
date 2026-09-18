const REQUEST_CANCELLATION_VERSION = "v1.2";

const activeCancellations = new Set();

const metrics = {
  created: 0,
  completed: 0,
  aborted: 0,
  clientDisconnectAborts: 0,
  shutdownAborts: 0,
  lastAbortAt: null,
  lastAbortReason: null
};

function cancellationReason(
  code = "CLIENT_DISCONNECT",
  message = "UNBOUND client request disconnected."
) {
  const error = new Error(message);
  error.name = "AbortError";
  error.code = code;
  return error;
}

function abortReason() {
  return cancellationReason(
    "CLIENT_DISCONNECT",
    "UNBOUND client request disconnected."
  );
}

function shutdownAbortReason(signalName = "shutdown") {
  const signal = String(signalName || "shutdown").trim().slice(0, 40) || "shutdown";
  const error = cancellationReason(
    "SERVER_SHUTDOWN",
    "UNBOUND AI is restarting; active AI work was cancelled for graceful shutdown."
  );
  error.signalName = signal;
  return error;
}

function recordAbort(reason) {
  metrics.aborted += 1;
  metrics.lastAbortAt = Date.now();
  metrics.lastAbortReason = String(reason?.code || "ABORTED").slice(0, 80);

  if (reason?.code === "SERVER_SHUTDOWN") {
    metrics.shutdownAborts += 1;
  } else {
    metrics.clientDisconnectAborts += 1;
  }
}

function createRequestCancellation(req, res) {
  const controller = new AbortController();
  let cleaned = false;
  let aborted = false;
  let context = null;

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    try { req?.removeListener?.("aborted", onRequestAborted); } catch (_) {}
    try { res?.removeListener?.("close", onResponseClose); } catch (_) {}
    try { res?.removeListener?.("finish", onResponseFinish); } catch (_) {}
    if (context) activeCancellations.delete(context);
    if (!aborted) metrics.completed += 1;
  }

  function abort(reason = abortReason()) {
    if (!controller.signal.aborted) {
      aborted = true;
      controller.abort(reason);
      recordAbort(reason);
    }
    cleanup();
  }

  function onRequestAborted() {
    abort();
  }

  function onResponseClose() {
    if (!res?.writableEnded) {
      abort();
      return;
    }
    cleanup();
  }

  function onResponseFinish() {
    cleanup();
  }

  context = Object.freeze({
    signal: controller.signal,
    abort,
    cleanup
  });
  activeCancellations.add(context);
  metrics.created += 1;

  req?.once?.("aborted", onRequestAborted);
  res?.once?.("close", onResponseClose);
  res?.once?.("finish", onResponseFinish);

  if (req?.aborted || (res?.destroyed && !res?.writableEnded)) {
    abort();
  }

  return context;
}

async function runWithRequestCancellation(req, res, operation) {
  const cancellation = createRequestCancellation(req, res);
  try {
    return await operation(cancellation.signal);
  } finally {
    cancellation.cleanup();
  }
}

function handleCancelledJsonResponse(
  res,
  error,
  {
    message = "UNBOUND AI is restarting. Please retry shortly.",
    retryAfterSeconds = 5
  } = {}
) {
  if (String(error?.code || "") !== "AI_REQUEST_ABORTED") return false;
  if (res?.destroyed || res?.writableEnded) return true;

  if (error?.cause?.code !== "SERVER_SHUTDOWN") {
    return true;
  }

  try {
    res.setHeader?.("Retry-After", String(
      Math.max(1, Math.min(60, Number(retryAfterSeconds) || 5))
    ));
    res.status(503).json({
      error: String(message || "UNBOUND AI is restarting. Please retry shortly.").slice(0, 240),
      retryable: true,
      reason: "server-restart"
    });
  } catch (_) {}
  return true;
}

function abortAllRequestCancellations(
  reason = shutdownAbortReason("shutdown")
) {
  const contexts = [...activeCancellations];
  let abortedCount = 0;

  for (const context of contexts) {
    if (context.signal.aborted) continue;
    context.abort(reason);
    abortedCount += 1;
  }

  return Object.freeze({
    abortedCount,
    activeAfterAbort: activeCancellations.size
  });
}

function getRequestCancellationSnapshot() {
  return Object.freeze({
    version: REQUEST_CANCELLATION_VERSION,
    scope: "current_process",
    active: activeCancellations.size,
    created: metrics.created,
    completed: metrics.completed,
    aborted: metrics.aborted,
    clientDisconnectAborts: metrics.clientDisconnectAborts,
    shutdownAborts: metrics.shutdownAborts,
    lastAbortAt: metrics.lastAbortAt
      ? new Date(metrics.lastAbortAt).toISOString()
      : null,
    lastAbortReason: metrics.lastAbortReason
  });
}

module.exports = {
  REQUEST_CANCELLATION_VERSION,
  cancellationReason,
  abortReason,
  shutdownAbortReason,
  createRequestCancellation,
  runWithRequestCancellation,
  handleCancelledJsonResponse,
  abortAllRequestCancellations,
  getRequestCancellationSnapshot
};
