from pathlib import Path

path = Path('app/server.js')
text = path.read_text()


def one(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)


one(
'''const {
  normalizeAlertSeverity,
  buildNewDeviceAlert,
  getSecurityAlertStatus
} = require("./security/alerts");
''',
'''const {
  normalizeAlertSeverity,
  buildNewDeviceAlert,
  getSecurityAlertStatus
} = require("./security/alerts");
const {
  getSignInRiskConfig,
  buildRepeatedFailureAlert,
  getSignInRiskStatus
} = require("./security/signin-risk");
''',
'sign-in risk imports'
)

one(
'''const RATE_LIMIT_POLICY = getRateLimitPolicy();
''',
'''const RATE_LIMIT_POLICY = getRateLimitPolicy();
const SIGNIN_RISK_CONFIG = getSignInRiskConfig();
''',
'sign-in risk config'
)

helper = r'''
async function recordFailedPasswordSignIn(userId, req) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [userId]);

    await writeSecurityEvent(
      client,
      userId,
      "auth.password_failed",
      null,
      { label: coarseDeviceLabel(req) },
      "warning"
    );

    const countResult = await client.query(
      `SELECT COUNT(*)::int AS failures
       FROM account_security_events
       WHERE user_id = $1
         AND event_type = 'auth.password_failed'
         AND created_at >= NOW() - ($2::int * INTERVAL '1 minute')`,
      [userId, SIGNIN_RISK_CONFIG.failedPasswordWindowMinutes]
    );
    const failures = Number(countResult.rows[0]?.failures || 0);

    if (failures >= SIGNIN_RISK_CONFIG.failedPasswordThreshold) {
      const existingAlert = await client.query(
        `SELECT id
         FROM account_security_alerts
         WHERE user_id = $1
           AND event_type = 'auth.repeated_failed_sign_in'
           AND created_at >= NOW() - ($2::int * INTERVAL '1 minute')
         LIMIT 1`,
        [userId, SIGNIN_RISK_CONFIG.failedPasswordWindowMinutes]
      );

      if (!existingAlert.rows[0]) {
        const alert = buildRepeatedFailureAlert({
          count: failures,
          windowMinutes: SIGNIN_RISK_CONFIG.failedPasswordWindowMinutes
        });
        await writeSecurityAlert(client, userId, alert);
      }
    }

    await client.query("COMMIT");
    return failures;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

'''
one(
'''function publicSecurityAlert(row) {
''',
helper + '''function publicSecurityAlert(row) {
''',
'failed sign-in recorder'
)

one(
'''    securityAlerts: getSecurityAlertStatus()
''',
'''    securityAlerts: getSecurityAlertStatus(),
    signInRisk: getSignInRiskStatus()
''',
'sign-in risk health status'
)

one(
'''    if (!user || !passwordMatches) {
      return res.status(401).json({
        error: "Email or password is incorrect."
      });
    }

    await createSession(user.id, res, req);
''',
'''    if (!user || !passwordMatches) {
      if (user && !passwordMatches) {
        try {
          await recordFailedPasswordSignIn(user.id, req);
        } catch (securityError) {
          console.error("UNBOUND AI FAILED SIGN-IN SECURITY LOG ERROR:", securityError);
        }
      }
      return res.status(401).json({
        error: "Email or password is incorrect."
      });
    }

    const sessionResult = await createSession(user.id, res, req);
    try {
      await writeSecurityEvent(
        pool,
        user.id,
        "auth.password_signed_in",
        sessionResult?.device?.id || null,
        { label: sessionResult?.device?.device_label || coarseDeviceLabel(req) }
      );
    } catch (securityError) {
      console.error("UNBOUND AI SIGN-IN SECURITY LOG ERROR:", securityError);
    }
''',
'password sign-in risk wiring'
)

path.write_text(text)
print('Applied UNBOUND AI v0.19 sign-in risk server migration.')
