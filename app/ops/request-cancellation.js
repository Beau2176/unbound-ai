function abortReason() {
  return typeof DOMException === "function"
    ? new DOMException("UNBOUND client request disconnected.", "AbortError")
    : Object.assign(
        new Error("UNBOUND client request disconnected."),
        { name: "AbortError" }
      );
}

function createRequestCancellation(req, res) {
  const controller = new AbortController();
  let cleaned = false;

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    try { req?.removeListener?.("aborted", onRequestAborted); } catch (_) {}
    try { res?.removeListener?.("close", onResponseClose); } catch (_) {}
    try { res?.removeListener?.("finish", onResponseFinish); } catch (_) {}
  }

  function abort(reason = abortReason()) {
    if (!controller.signal.aborted) {
      controller.abort(reason);
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

  req?.once?.("aborted", onRequestAborted);
  res?.once?.("close", onResponseClose);
  res?.once?.("finish", onResponseFinish);

  if (req?.aborted || (res?.destroyed && !res?.writableEnded)) {
    abort();
  }

  return Object.freeze({
    signal: controller.signal,
    abort,
    cleanup
  });
}

async function runWithRequestCancellation(req, res, operation) {
  const cancellation = createRequestCancellation(req, res);
  try {
    return await operation(cancellation.signal);
  } finally {
    cancellation.cleanup();
  }
}

module.exports = {
  abortReason,
  createRequestCancellation,
  runWithRequestCancellation
};
