const assert = require("node:assert/strict");
const crypto = require("node:crypto");

// Called only by the loopback-only recovery integration runner. Every account,
// provider value and credential here is synthetic, in that run's restored DB.
async function verifyAccountPrivacy({ origin, client, userId, credentials, cookie, conversationId }) {
  assert.equal(new URL(origin).hostname, "127.0.0.1", "Privacy integration requires the local test application");
  const database = (await client.query("SELECT current_database() AS name")).rows[0].name;
  assert.match(database, /^unbound_ci_[a-f0-9]{16}_restored$/, "Privacy integration requires its disposable restored database");
  const marker = label => `privacy-fixture-${label}`;
  const hash = label => crypto.createHash("sha256").update(marker(label)).digest("hex");
  const cookies = response => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  async function request(route, { method = "GET", body, session = cookie, requestOrigin = origin } = {}) {
    return fetch(`${origin}${route}`, {
      method,
      headers: { Cookie: session, Origin: requestOrigin, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000)
    });
  }
  const deleteBody = { password: credentials.password, confirmation: "DELETE" };
  const deletion = overrides => request("/api/account", { method: "DELETE", body: deleteBody, ...overrides });

  const control = await request("/api/auth/register", {
    method: "POST", session: "",
    body: { email: "privacy-control@example.invalid", password: credentials.password, displayName: "Privacy control", adultConfirmed: true }
  });
  assert.equal(control.status, 201, "Synthetic control account registration must succeed");
  const controlId = (await control.json()).user.id;
  const controlCookie = cookies(control);
  const controlConversation = (await client.query(
    "INSERT INTO conversations(user_id,title) VALUES($1,'Other account private title') RETURNING id", [controlId]
  )).rows[0].id;
  await client.query("INSERT INTO user_ai_preferences(user_id,ai_style) VALUES($1,'listener') ON CONFLICT(user_id) DO UPDATE SET ai_style='listener'", [userId]);
  await client.query("INSERT INTO account_recovery_codes(user_id,batch_id,code_hash) VALUES($1,'ci-privacy',$2)", [userId, hash("recovery")]);
  await client.query("INSERT INTO account_passkeys(user_id,credential_id,public_key,label) VALUES($1,$2,$3,'Synthetic passkey')",
    [userId, marker("credential"), Buffer.from(marker("public-key"))]);
  await client.query("INSERT INTO account_devices(user_id,device_token_hash,device_label) VALUES($1,$2,'Synthetic device')", [userId, hash("device")]);
  await client.query("INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 day')", [userId, hash("session")]);
  await client.query("INSERT INTO account_email_verification(user_id,status) VALUES($1,'pending') ON CONFLICT(user_id) DO UPDATE SET status='pending'", [userId]);
  await client.query("INSERT INTO email_verification_challenges(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '30 minutes')", [userId, hash("email")]);
  await client.query("INSERT INTO user_memories(user_id,content) VALUES($1,'Synthetic remembered preference')", [userId]);
  await client.query("INSERT INTO connected_app_connections(user_id,provider,provider_account_id,provider_account_login,access_token_ciphertext,refresh_token_ciphertext) VALUES($1,'synthetic','ci-account','ci-login',$2,$3)",
    [userId, marker("access-token"), marker("refresh-token")]);
  const taskId = (await client.query(
    "INSERT INTO scheduled_tasks(user_id,title,enabled) VALUES($1,'Disabled privacy fixture',FALSE) RETURNING id", [userId]
  )).rows[0].id;
  await client.query("INSERT INTO scheduled_task_events(task_id,user_id,title,scheduled_for) VALUES($1,$2,'Synthetic reminder',NOW())", [taskId, userId]);
  await client.query("INSERT INTO account_age_verification(user_id,status,provider_reference_hash) VALUES($1,'unverified',$2) ON CONFLICT(user_id) DO UPDATE SET provider_reference_hash=$2", [userId, hash("age")]);
  const usageId = (await client.query(
    "INSERT INTO usage_events(user_id,provider,model,total_tokens,provider_response_id) VALUES($1,'synthetic','privacy',42,$2) RETURNING id", [userId, marker("response")]
  )).rows[0].id;
  const ageEventId = (await client.query(
    "INSERT INTO age_verification_events(user_id,provider,provider_event_id,payload_sha256,error_text) VALUES($1,'synthetic','ci-privacy-age',$2,$3) RETURNING id", [userId, hash("payload"), marker("age-error")]
  )).rows[0].id;
  const auditId = (await client.query(
    "INSERT INTO admin_audit_log(admin_user_id,admin_email,action,target_user_id,target_email) VALUES($1,$2,'ci.privacy_fixture',$1,$2) RETURNING id", [userId, credentials.email]
  )).rows[0].id;

  const anonymousExport = await request("/api/account/export", { session: "" });
  assert.equal(anonymousExport.status, 401);
  const exported = await request("/api/account/export");
  assert.equal(exported.status, 200, "Restored account export must succeed");
  assert.match(exported.headers.get("content-disposition"), /^attachment; filename="unbound-ai-data-\d{4}-\d{2}-\d{2}\.json"$/);
  assert.match(exported.headers.get("cache-control"), /no-store/);
  const data = await exported.json();
  assert.equal(data.account.email, credentials.email);
  assert.equal(data.preferences.aiStyle, "listener");
  assert.equal(data.conversations.find(item => String(item.id) === String(conversationId)).messages[0].content, "Synthetic recovered answer");
  const text = JSON.stringify(data);
  for (const secret of [credentials.password, marker("credential"), marker("public-key"), marker("access-token"), marker("refresh-token"), marker("response"), ...["recovery", "device", "session", "email", "age"].map(hash)]) {
    assert(!text.includes(secret), "Account export must exclude credential/correlation fixture values");
  }
  assert(!text.includes("privacy-control@example.invalid") && !text.includes("Other account private title"), "Export must be scoped to the signed-in account");
  const controlExport = await request("/api/account/export", { session: controlCookie });
  assert.equal(controlExport.status, 200);
  assert(!(await controlExport.text()).includes("Synthetic recovered answer"));

  assert.equal((await deletion({ body: { ...deleteBody, confirmation: "delete" } })).status, 400);
  assert.equal((await deletion({ body: { ...deleteBody, password: "incorrect-synthetic-password" } })).status, 401);
  assert.equal((await deletion({ requestOrigin: "https://cross-origin.invalid" })).status, 403);
  await client.query("UPDATE account_subscriptions SET provider='synthetic',provider_subscription_id='ci-subscription',status='active',cancel_at_period_end=TRUE WHERE user_id=$1", [userId]);
  const blocked = await deletion();
  assert.equal(blocked.status, 409, "An active subscription must block deletion even with cancellation scheduled");
  assert.equal((await blocked.json()).deletionBlocked.code, "active_subscription");
  assert.equal((await client.query("SELECT COUNT(*)::int AS count FROM users WHERE id=$1", [userId])).rows[0].count, 1);
  await client.query("UPDATE account_subscriptions SET status='canceled' WHERE user_id=$1", [userId]);

  // Force a late DB failure after cleanup updates and prove transaction rollback.
  await client.query("CREATE FUNCTION ci_fail_privacy_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic privacy deletion failure'; END $$");
  await client.query("CREATE TRIGGER ci_privacy_delete_failure BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION ci_fail_privacy_delete()");
  try {
    assert.equal((await deletion()).status, 500);
    assert.equal((await client.query("SELECT user_id::text,provider_response_id FROM usage_events WHERE id=$1", [usageId])).rows[0].user_id, String(userId));
    assert.equal((await client.query("SELECT provider_response_id FROM usage_events WHERE id=$1", [usageId])).rows[0].provider_response_id, marker("response"));
    assert.equal((await client.query("SELECT error_text FROM age_verification_events WHERE id=$1", [ageEventId])).rows[0].error_text, marker("age-error"));
    const audit = (await client.query("SELECT admin_email,target_email FROM admin_audit_log WHERE id=$1", [auditId])).rows[0];
    assert.equal(audit.admin_email, credentials.email);
    assert.equal(audit.target_email, credentials.email);
  } finally {
    await client.query("DROP TRIGGER ci_privacy_delete_failure ON users");
    await client.query("DROP FUNCTION ci_fail_privacy_delete()");
  }
  assert.equal((await request(`/api/conversations/${conversationId}`)).status, 200, "A rolled-back deletion must preserve login/history");
  const deleted = await deletion();
  assert.equal(deleted.status, 200);
  assert.equal((await deleted.json()).deleted, true);
  assert(deleted.headers.getSetCookie().some(value => /Max-Age=0/.test(value)), "Deletion must expire browser credentials");
  for (const table of ["users", "user_ai_preferences", "user_sessions", "account_devices", "account_security_events", "account_security_alerts", "account_passkeys", "account_recovery_codes", "account_email_verification", "email_verification_challenges", "account_legal_acceptances", "account_subscriptions", "account_age_verification", "conversations", "user_memories", "connected_app_connections", "scheduled_tasks", "scheduled_task_events"]) {
    const column = table === "users" ? "id" : "user_id";
    assert.equal((await client.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${column}=$1`, [userId])).rows[0].count, 0, `Deleted account rows must be removed from ${table}`);
  }
  assert.equal((await client.query("SELECT COUNT(*)::int AS count FROM conversation_messages WHERE conversation_id=$1", [conversationId])).rows[0].count, 0);
  const retainedUsage = (await client.query("SELECT user_id,provider_response_id FROM usage_events WHERE id=$1", [usageId])).rows[0];
  assert(retainedUsage && retainedUsage.user_id === null && retainedUsage.provider_response_id === null);
  const retainedAge = (await client.query("SELECT user_id,error_text FROM age_verification_events WHERE id=$1", [ageEventId])).rows[0];
  assert(retainedAge && retainedAge.user_id === null && retainedAge.error_text === null);
  const retainedAudit = (await client.query("SELECT admin_user_id,admin_email,target_user_id,target_email FROM admin_audit_log WHERE id=$1", [auditId])).rows[0];
  assert.deepEqual(retainedAudit, { admin_user_id: null, admin_email: "deleted-account", target_user_id: null, target_email: null });
  assert.equal((await request("/api/account/export")).status, 401, "Old sessions must no longer authorize export");
  assert.equal((await request(`/api/conversations/${conversationId}`)).status, 401);
  assert.equal((await request("/api/auth/login", { method: "POST", session: "", body: credentials })).status, 401);
  assert.equal((await request(`/api/conversations/${controlConversation}`, { session: controlCookie })).status, 200, "The other account and its history must remain usable");
  console.log("PASS real account privacy: scoped export, secret exclusions, deletion confirmation/password/origin/billing gates, rollback, cleanup, session revocation and other-account isolation.");
}

module.exports = { verifyAccountPrivacy };
