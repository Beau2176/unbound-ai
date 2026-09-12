const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Execute the production authorization helper with controlled account dependencies.
const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const start = source.indexOf("async function assertOptionalAccountCapability(");
const end = source.indexOf("async function requireSignedIn(", start);
assert.ok(start >= 0 && end > start);
function check({ cookie = "", ready = true, user = null, usable = true } = {}) {
  const context = vm.createContext({
    SESSION_COOKIE: "unbound_session",
    databaseReady: ready,
    pool: ready ? {} : null,
    parseCookies: () => ({ unbound_session: cookie }),
    findSessionUser: async () => user,
    buildAccountAccess: async () => ({
      capabilities: [{ key: "chat", usable, entitled: usable, available: true }]
    })
  });
  vm.runInContext(source.slice(start, end), context);
  return context.assertOptionalAccountCapability({}, "chat");
}
async function main() {
  assert.equal(await check(), null, "intentional guest access remains supported");
  assert.equal(await check({ ready: false }), null);
  await assert.rejects(check({ cookie: "expired" }), (e) => e.statusCode === 401);
  await assert.rejects(check({ cookie: "revoked" }), (e) => e.statusCode === 401);
  await assert.rejects(check({ cookie: "session", ready: false }), (e) => e.statusCode === 503);
  const user = { id: "1" };
  assert.equal((await check({ cookie: "valid", user })).user, user);
  await assert.rejects(check({ cookie: "valid", user, usable: false }), (e) => e.statusCode === 403);
  console.log("PASS session access: expired/revoked sessions fail closed; guest and entitled account behavior preserved.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
