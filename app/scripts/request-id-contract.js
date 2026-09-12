const assert = require("assert");
const { EventEmitter } = require("events");
const {
  createRequestObservabilityMiddleware
} = require("../ops/request-observability");
const {
  createHttpSecurityMiddleware
} = require("../security/http-security");

function createResponse() {
  const res = new EventEmitter();
  const headers = new Map();
  res.statusCode = 200;
  res.writableEnded = true;
  res.setHeader = (name, value) => {
    headers.set(String(name).toLowerCase(), String(value));
  };
  res.getHeader = (name) => headers.get(String(name).toLowerCase());
  return res;
}

function verifyOrder(order) {
  const logs = [];
  const req = {
    method: "GET",
    path: "/api/request-correlation/12345",
    url: "/api/request-correlation/12345?secret=must-not-log",
    headers: {
      host: "example.invalid",
      "x-request-id": "attacker-supplied-id"
    }
  };
  const res = createResponse();
  const observability = createRequestObservabilityMiddleware({
    logger: (line) => logs.push(String(line))
  });
  const security = createHttpSecurityMiddleware({ isProduction: false });
  let reachedHandler = 0;

  if (order === "observability-first") {
    observability(req, res, () => {
      security(req, res, () => {
        reachedHandler += 1;
      });
    });
  } else {
    security(req, res, () => {
      observability(req, res, () => {
        reachedHandler += 1;
      });
    });
  }

  assert.equal(reachedHandler, 1, `${order}: middleware chain did not reach handler exactly once`);
  assert.ok(req.requestId, `${order}: request ID was not assigned`);
  assert.notEqual(req.requestId, "attacker-supplied-id", `${order}: inbound request ID header must not be trusted`);
  assert.equal(
    res.getHeader("x-request-id"),
    req.requestId,
    `${order}: response header request ID must match req.requestId`
  );

  res.emit("finish");
  assert.equal(logs.length, 1, `${order}: expected exactly one structured request log`);
  const record = JSON.parse(logs[0]);
  assert.equal(record.event, "http_request");
  assert.equal(
    record.requestId,
    req.requestId,
    `${order}: structured log request ID must match response request ID`
  );
  assert.equal(record.path, "/api/request-correlation/:id");
  assert.ok(!logs[0].includes("must-not-log"), `${order}: query string leaked into request log`);
  assert.ok(!logs[0].includes("attacker-supplied-id"), `${order}: inbound request ID leaked into request log`);
}

verifyOrder("observability-first");
verifyOrder("security-first");
console.log("PASS request ID correlation contract: header, request context, and structured log share one server-generated ID.");
