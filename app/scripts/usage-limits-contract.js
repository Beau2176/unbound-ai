"use strict";
const assert = require("node:assert/strict");
const express = require("express");
const { EventEmitter } = require("node:events");
const { LIMITS, policiesFor, classifyRequest, publicUsagePolicy } = require("../access/usage-policy");
const { evaluate } = require("../access/usage-store");
const { createUsageMiddleware } = require("../access/usage-middleware");
async function main() {
  for (const path of ["/api/chat", "/api/chat/stream", "/API/CHAT/", "/api/chat?x=1"]) {
    assert.deepEqual(classifyRequest({ method: "POST", originalUrl: path, body: { depthStyle: "work", productMode: "research" } }), { chat: 3, research: 1 });
  }
  for (const path of ["/api/voice/status", "/api/agents/runs", "/api/account/usage"]) assert.equal(classifyRequest({ method: "GET", originalUrl: path }), null);
  for (const path of ["/api/artifacts/export", "/api/agents/runs/1/cancel", "/api/future-core-v2/jobs/1/run"]) assert.equal(classifyRequest({ method: "POST", originalUrl: path }), null);
  for (const path of ["/api/future-core-v2/jobs", "/api/platform/coding/jobs/x/dispatch", "/api/platform/mcp/tools/x/call", "/api/platform/a2a/message"]) assert.deepEqual(classifyRequest({ method: "POST", originalUrl: path }), { agents: 1 });
  assert.deepEqual(policiesFor("top", { chat: 1 }), policiesFor("ultra", { chat: 1 }));
  assert.equal(policiesFor("bogus", { images: 1 })[0].limit, 0);
  assert.equal(publicUsagePolicy().plans.find(p => p.id === "max").commercialState, "future");
  assert.equal(publicUsagePolicy().plans.find(p => p.id === "unlimited").commercialState, "future");
  assert.equal(LIMITS.unlimited.chat, null);
  assert.deepEqual(policiesFor("unlimited", { chat: 1 }), []);
  assert(policiesFor("unlimited", { research: 1 })[0].limit > policiesFor("max", { research: 1 })[0].limit);
  for (const feature of Object.keys(LIMITS.premium)) assert(LIMITS.ultra[feature][1] > LIMITS.premium[feature][1]);
  const policy = policiesFor("free", { chat: 1 })[0];
  const now = Date.now();
  assert.equal(evaluate(policy, { window_started_at: new Date(now - 18000000), request_count: 30 }, now).used, 0);
  assert.equal(evaluate(policy, { window_started_at: new Date(now - 17999999), request_count: 30 }, now).remaining, 0);
  let reservations = 0, refunds = 0, blocked = false, storage = true;
  const app = express(); app.use(express.json());
  app.use(createUsageMiddleware({
    getPool: () => storage ? {} : null, secret: "test",
    resolveAccount: async () => ({ user: { id: 7 }, tier: "premium" }),
    guestSubject: () => { throw new Error("Unexpected guest"); },
    reserve: async (_pool, _secret, subject, policies) => {
      assert.equal(subject.value, "7"); reservations++;
      return blocked ? { allowed: false, blocked: policies, retryAfter: 123 } : { allowed: true, windows: [{ remaining: 99 }] };
    }, refund: async () => { refunds++; }
  }));
  app.post("/api/chat", (req, res) => res.status(req.body.fail ? 502 : 200).json({ ok: true }));
  app.get("/api/voice/status", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1"); await EventEmitter.once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = body => fetch(origin + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await request({})).status, 200);
    assert.equal((await request({ fail: true })).status, 502); assert.equal(refunds, 1);
    blocked = true; const response = await request({}); assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "123");
    storage = false; assert.equal((await request({})).status, 503);
    const count = reservations; assert.equal((await fetch(origin + "/api/voice/status")).status, 200); assert.equal(reservations, count);
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log("PASS usage policy: shared endpoints, tier normalization, expiry, future Max/Unlimited, unmetered Unlimited chat, metered expensive tools, 429/reset, refunds and fail-closed storage.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
