const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const {
  DEFAULT_STREAM_DRAIN_TIMEOUT_MS,
  boundedDrainTimeout,
  writeChunkWithBackpressure,
  writeNdjsonEvent
} = require("../http/stream-backpressure");

function response(writeResult = true) {
  const res = new EventEmitter();
  res.destroyed = false;
  res.writableEnded = false;
  res.writes = [];
  res.write = (chunk) => {
    res.writes.push(String(chunk));
    return typeof writeResult === "function"
      ? writeResult(chunk)
      : writeResult;
  };
  return res;
}

async function main() {
  assert.strictEqual(DEFAULT_STREAM_DRAIN_TIMEOUT_MS, 5000);
  assert.strictEqual(boundedDrainTimeout("bad"), 5000);
  assert.strictEqual(boundedDrainTimeout(1), 250);
  assert.strictEqual(boundedDrainTimeout(60000), 30000);

  const immediate = response(true);
  assert.strictEqual(await writeChunkWithBackpressure(immediate, "hello"), true);
  assert.deepStrictEqual(immediate.writes, ["hello"]);

  const delayed = response(false);
  const waiting = writeChunkWithBackpressure(delayed, "buffered", { timeoutMs: 1000 });
  setImmediate(() => delayed.emit("drain"));
  assert.strictEqual(await waiting, true);
  assert.deepStrictEqual(delayed.writes, ["buffered"]);

  const closed = response(false);
  const closedWrite = writeChunkWithBackpressure(closed, "blocked", { timeoutMs: 1000 });
  setImmediate(() => {
    closed.destroyed = true;
    closed.emit("close");
  });
  await assert.rejects(
    closedWrite,
    (error) =>
      error?.code === "AI_REQUEST_ABORTED" &&
      error?.statusCode === 499 &&
      error?.cause?.code === "CLIENT_STREAM_CLOSED"
  );

  const ndjson = response(true);
  assert.strictEqual(
    await writeNdjsonEvent(ndjson, { type: "delta", delta: "x" }),
    true
  );
  assert.strictEqual(
    ndjson.writes[0],
    JSON.stringify({ type: "delta", delta: "x" }) + "\n"
  );

  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert(server.includes('require("./http/stream-backpressure")'));
  assert(server.includes("const writeEvent = (event) => writeNdjsonEvent(res, event);"));
  assert(server.includes("await writeEvent({\n      type: \"meta\""));
  assert(server.includes("await writeEvent({ type: \"delta\", delta });"));
  assert(server.includes("await writeEvent({\n      type: \"done\""));
  assert(!server.includes('res.write(JSON.stringify(event) + "\\n")'));

  console.log(
    "PASS stream backpressure: immediate writes, drain waits, closed-client cancellation, NDJSON framing, and awaited chat-stream writes."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
