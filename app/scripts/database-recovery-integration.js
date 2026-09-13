const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { Client } = require("pg");

// Real PostgreSQL integration test. Never accepts an existing target database.
// Only synthetic data and randomly named databases on a loopback test server.
function validateTestConnection(value) {
  const url = new URL(value);
  assert(["postgres:", "postgresql:"].includes(url.protocol), "PostgreSQL URL required");
  assert(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Only a local test PostgreSQL server is allowed");
  assert.equal(url.pathname, "/postgres", "Connect to the postgres maintenance database");
  assert.equal(url.search, "", "Connection query overrides are not allowed");
  assert.equal(url.hash, "", "Connection fragments are not allowed");
  return url;
}

async function runCommand(command, args, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let diagnostic = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", data => { diagnostic = (diagnostic + data).slice(-4000); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, 60000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      // Do not print database connection strings or command arguments on failure.
      if (code !== 0) reject(new Error(`${command} failed (${code}): ${diagnostic.replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted connection]")}`));
      else resolve();
    });
  });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startApp(databaseUrl, env) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, "../start.js")], {
    env: { ...env, NODE_ENV: "test", DATABASE_URL: databaseUrl, PORT: String(port), PUBLIC_APP_ORIGIN: origin },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  let spawnError;
  child.on("error", error => { spawnError = error; });
  const capture = data => { logs = (logs + data.toString()).slice(-8000); };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  async function stop() {
    if (child.exitCode !== null || child.signalCode !== null || spawnError) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 12000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.kill("SIGTERM");
    });
  }
  try {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null, "Application exited during startup");
      try {
        const response = await fetch(`${origin}/readyz`, { signal: AbortSignal.timeout(500) });
        if (response.ok && (await response.json()).ready) return { origin, stop };
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error("Application did not become database-ready");
  } catch (error) {
    await stop();
    throw new Error(`${error.message}\n${logs.replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted connection]")}`);
  }
}

async function connect(url) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}

async function snapshot(client) {
  const result = {};
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  assert(tables.rowCount >= 20, "The complete account schema must be initialized");
  for (const { tablename } of tables.rows) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    const rows = await client.query(`SELECT row_to_json(t)::text AS row FROM public.${quoted} t ORDER BY row_to_json(t)::text`);
    result[tablename] = {
      count: rows.rowCount,
      sha256: crypto.createHash("sha256").update(JSON.stringify(rows.rows)).digest("hex")
    };
  }
  const sequences = await client.query("SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename");
  result.sequences = {};
  for (const { sequencename } of sequences.rows) {
    const quoted = '"' + sequencename.replaceAll('"', '""') + '"';
    result.sequences[sequencename] = (await client.query(`SELECT last_value::text, is_called FROM public.${quoted}`)).rows;
  }
  return result;
}

async function main() {
  const adminUrl = validateTestConnection(process.env.TEST_POSTGRES_URL || "");
  const prefix = `unbound_ci_${crypto.randomBytes(8).toString("hex")}`;
  const names = [`${prefix}_source`, `${prefix}_restored`];
  const dbUrl = name => { const url = new URL(adminUrl); url.pathname = `/${name}`; return url.toString(); };
  // Deliberately omit all inherited provider secrets and production settings.
  const env = { PATH: process.env.PATH, TZ: "UTC" };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "unbound-recovery-"));
  const created = [];
  let admin;
  let client;
  let app;
  try {
    admin = await connect(adminUrl.toString());
    for (const name of names) {
      await admin.query(`CREATE DATABASE "${name}"`);
      created.push(name);
    }
    app = await startApp(dbUrl(names[0]), env);
    const credentials = { email: "recovery-test@example.invalid", password: crypto.randomBytes(24).toString("hex") };
    const registration = await fetch(`${app.origin}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: app.origin },
      body: JSON.stringify({ ...credentials, displayName: "Recovery test", adultConfirmed: true }),
      signal: AbortSignal.timeout(10000)
    });
    assert.equal(registration.status, 201, "Synthetic account registration failed");
    const userId = (await registration.json()).user.id;
    client = await connect(dbUrl(names[0]));
    const conversation = await client.query(
      "INSERT INTO conversations(user_id,title,depth_style,product_mode) VALUES($1,'Recovery fixture','work','research') RETURNING id", [userId]);
    const conversationId = conversation.rows[0].id;
    await client.query("INSERT INTO conversation_messages(conversation_id,role,content,research_sources) VALUES($1,'assistant','Synthetic recovered answer',$2::jsonb)",
      [conversationId, JSON.stringify([{ url: "https://example.invalid/source", title: "Synthetic source" }])]);
    await client.query("INSERT INTO account_subscriptions(user_id,status,plan_tier) VALUES($1,'none','free') ON CONFLICT(user_id) DO NOTHING", [userId]);
    await client.query("INSERT INTO account_legal_acceptances(user_id,document_type,document_version) VALUES($1,'privacy','ci-fixture')", [userId]);
    await client.query("INSERT INTO usage_events(user_id,provider,model,total_tokens) VALUES($1,'test','synthetic',42)", [userId]);
    await client.query("INSERT INTO admin_audit_log(admin_user_id,admin_email,action,target_user_id) VALUES($1,'recovery-test@example.invalid','ci.recovery_fixture',$1)", [userId]);
    await app.stop(); app = null;
    const before = await snapshot(client);
    await client.end(); client = null;
    await runCommand("bash", [path.join(__dirname, "backup-postgres.sh")], {
      ...env, BACKUP_DATABASE_URL: dbUrl(names[0]), BACKUP_DIR: temp
    });
    const dumps = fs.readdirSync(temp).filter(name => name.endsWith(".dump"));
    assert.equal(dumps.length, 1);
    const dump = path.join(temp, dumps[0]);
    const expectedHash = fs.readFileSync(`${dump}.sha256`, "utf8").split(/\s+/)[0];
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(dump)).digest("hex"), expectedHash);
    await runCommand("pg_restore", ["--dbname", dbUrl(names[1]), "--no-owner", "--no-privileges", "--exit-on-error", "--single-transaction", dump], env);
    client = await connect(dbUrl(names[1]));
    assert.deepEqual(await snapshot(client), before, "Restored table contents or sequences differ from the source");
    await client.end(); client = null;
    app = await startApp(dbUrl(names[1]), env);
    const login = await fetch(`${app.origin}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: app.origin },
      body: JSON.stringify(credentials), signal: AbortSignal.timeout(10000)
    });
    assert.equal(login.status, 200, "Restored account must authenticate");
    const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const history = await fetch(`${app.origin}/api/conversations/${conversationId}`, {
      headers: { Cookie: cookie }, signal: AbortSignal.timeout(10000)
    });
    assert.equal(history.status, 200, "Restored account must load its history");
    const recovered = await history.json();
    assert.equal(recovered.messages[0].content, "Synthetic recovered answer");
    const unauthorized = await fetch(`${app.origin}/api/conversations/${conversationId}`, { signal: AbortSignal.timeout(10000) });
    assert.equal(unauthorized.status, 401, "Recovered history must remain private");
    console.log(`PASS real database recovery: ${Object.keys(before).length - 1} tables, sequence state, integrated startup, account login and private history.`);
  } finally {
    if (app) await app.stop();
    if (client) await client.end();
    if (admin) {
      try {
        for (const name of created.reverse()) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      } finally { await admin.end(); }
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { validateTestConnection };
