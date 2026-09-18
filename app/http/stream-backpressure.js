const DEFAULT_STREAM_DRAIN_TIMEOUT_MS = 5000;

function streamBackpressureAbortError(
  code = "CLIENT_STREAM_BACKPRESSURE",
  message = "UNBOUND client stream became unwritable."
) {
  const cause = new Error(message);
  cause.name = "AbortError";
  cause.code = code;

  const error = new Error(message);
  error.code = "AI_REQUEST_ABORTED";
  error.statusCode = 499;
  error.cause = cause;
  return error;
}

function boundedDrainTimeout(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_STREAM_DRAIN_TIMEOUT_MS;
  return Math.min(Math.max(parsed, 250), 30000);
}

function waitForDrain(
  res,
  { timeoutMs = DEFAULT_STREAM_DRAIN_TIMEOUT_MS } = {}
) {
  if (!res || res.destroyed || res.writableEnded) {
    return Promise.reject(
      streamBackpressureAbortError(
        "CLIENT_STREAM_CLOSED",
        "UNBOUND client stream closed before buffered output drained."
      )
    );
  }
  if (typeof res.once !== "function") {
    return Promise.reject(
      streamBackpressureAbortError(
        "CLIENT_STREAM_BACKPRESSURE_UNSUPPORTED",
        "UNBOUND response stream cannot wait for backpressure drain."
      )
    );
  }

  const waitMs = boundedDrainTimeout(timeoutMs);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      try { res.removeListener?.("drain", onDrain); } catch (_) {}
      try { res.removeListener?.("close", onClose); } catch (_) {}
      try { res.removeListener?.("error", onError); } catch (_) {}
      if (timer) clearTimeout(timer);
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onDrain = () => finish(resolve, true);
    const onClose = () => finish(
      reject,
      streamBackpressureAbortError(
        "CLIENT_STREAM_CLOSED",
        "UNBOUND client stream closed while waiting for buffered output."
      )
    );
    const onError = () => finish(
      reject,
      streamBackpressureAbortError(
        "CLIENT_STREAM_WRITE_ERROR",
        "UNBOUND client stream failed while waiting for buffered output."
      )
    );

    res.once("drain", onDrain);
    res.once("close", onClose);
    res.once("error", onError);

    timer = setTimeout(() => {
      finish(
        reject,
        streamBackpressureAbortError(
          "CLIENT_STREAM_BACKPRESSURE_TIMEOUT",
          "UNBOUND client stream stayed backpressured too long."
        )
      );
    }, waitMs);
    timer.unref?.();

    if (res.destroyed || res.writableEnded) {
      onClose();
    }
  });
}

async function writeChunkWithBackpressure(
  res,
  chunk,
  options = {}
) {
  if (!res || res.destroyed || res.writableEnded) {
    throw streamBackpressureAbortError(
      "CLIENT_STREAM_CLOSED",
      "UNBOUND client stream is no longer writable."
    );
  }

  let accepted;
  try {
    accepted = res.write(String(chunk ?? ""));
  } catch (_) {
    throw streamBackpressureAbortError(
      "CLIENT_STREAM_WRITE_ERROR",
      "UNBOUND client stream rejected output."
    );
  }

  if (accepted !== false) return true;
  return waitForDrain(res, options);
}

async function writeNdjsonEvent(res, event, options = {}) {
  return writeChunkWithBackpressure(
    res,
    JSON.stringify(event) + "\n",
    options
  );
}

module.exports = {
  DEFAULT_STREAM_DRAIN_TIMEOUT_MS,
  streamBackpressureAbortError,
  boundedDrainTimeout,
  waitForDrain,
  writeChunkWithBackpressure,
  writeNdjsonEvent
};
