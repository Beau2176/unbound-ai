"use strict";

function integrateAdultStepUpServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "ADULT_STEP_UP_SERVER_SOURCE_EMPTY";
    throw error;
  }

  if (source.includes('"/api/account/adult-step-up/status"')) return source;

  const sessionSchemaAnchor = `    ALTER TABLE user_sessions\n      ADD COLUMN IF NOT EXISTS device_id BIGINT REFERENCES account_devices(id) ON DELETE SET NULL;`;
  if (!source.includes(sessionSchemaAnchor)) {
    const error = new Error("UNBOUND AI session schema anchor is missing.");
    error.code = "ADULT_STEP_UP_SESSION_SCHEMA_ANCHOR_MISSING";
    throw error;
  }
  source = source.replace(
    sessionSchemaAnchor,
    `${sessionSchemaAnchor}\n\n    ALTER TABLE user_sessions\n      ADD COLUMN IF NOT EXISTS adult_step_up_at TIMESTAMPTZ;`
  );

  const createSessionAnchor = `    await client.query(\n      \`INSERT INTO user_sessions (user_id, token_hash, expires_at, device_id)\n       VALUES ($1, $2, NOW() + INTERVAL '\${SESSION_DAYS} days', $3)\`,\n      [userId, tokenHash, device?.id || null]\n    );`;
  if (!source.includes(createSessionAnchor)) {
    const error = new Error("UNBOUND AI create-session anchor is missing.");
    error.code = "ADULT_STEP_UP_CREATE_SESSION_ANCHOR_MISSING";
    throw error;
  }
  source = source.replace(
    createSessionAnchor,
    `    await client.query(\n      \`INSERT INTO user_sessions (\n         user_id, token_hash, expires_at, device_id, adult_step_up_at\n       )\n       VALUES (\n         $1, $2, NOW() + INTERVAL '\${SESSION_DAYS} days', $3,\n         CASE WHEN $4::boolean THEN NOW() ELSE NULL END\n       )\`,\n      [userId, tokenHash, device?.id || null, authMethod === "passkey"]\n    );`
  );

  const assertionAnchor = "async function assertAgeVerifiedAdult(req) {";
  if (!source.includes(assertionAnchor)) {
    const error = new Error("UNBOUND AI adult-access assertion anchor is missing.");
    error.code = "ADULT_STEP_UP_ASSERTION_ANCHOR_MISSING";
    throw error;
  }

  const helperBlock = `function adultStepUpTtlMinutes() {\n  const raw = Number(process.env.ADULT_STEP_UP_TTL_MINUTES || 720);\n  if (!Number.isFinite(raw)) return 720;\n  return Math.max(5, Math.min(1440, Math.floor(raw)));\n}\n\nasync function buildAdultStepUpState(req, userId) {\n  const ttlMinutes = adultStepUpTtlMinutes();\n  const token = parseCookies(req)[SESSION_COOKIE];\n  const passkeyCountResult = await pool.query(\n    \`SELECT COUNT(*)::int AS count FROM account_passkeys WHERE user_id = $1\`,\n    [userId]\n  );\n  const passkeyCount = Number(passkeyCountResult.rows[0]?.count || 0);\n  if (!token) {\n    return {\n      verified: false,\n      verifiedAt: null,\n      expiresAt: null,\n      ttlMinutes,\n      passkeyCount,\n      passkeyRequired: true,\n      reason: "signed-in-session-required"\n    };\n  }\n\n  const result = await pool.query(\n    \`SELECT\n       adult_step_up_at,\n       CASE\n         WHEN adult_step_up_at IS NULL THEN NULL\n         ELSE adult_step_up_at + ($3::int * INTERVAL '1 minute')\n       END AS step_up_expires_at,\n       (\n         adult_step_up_at IS NOT NULL\n         AND adult_step_up_at + ($3::int * INTERVAL '1 minute') > NOW()\n       ) AS verified\n     FROM user_sessions\n     WHERE user_id = $1\n       AND token_hash = $2\n       AND expires_at > NOW()\n     LIMIT 1\`,\n    [userId, hashSessionToken(token), ttlMinutes]\n  );\n  const row = result.rows[0];\n  return {\n    verified: Boolean(row?.verified),\n    verifiedAt: row?.adult_step_up_at || null,\n    expiresAt: row?.step_up_expires_at || null,\n    ttlMinutes,\n    passkeyCount,\n    passkeyRequired: true,\n    reason: row?.verified\n      ? null\n      : passkeyCount > 0\n        ? "passkey-step-up-required"\n        : "passkey-registration-required"\n  };\n}\n\nasync function markCurrentSessionAdultStepUp(req, userId, client = pool) {\n  const token = parseCookies(req)[SESSION_COOKIE];\n  if (!token) return false;\n  const result = await client.query(\n    \`UPDATE user_sessions\n     SET adult_step_up_at = NOW()\n     WHERE user_id = $1\n       AND token_hash = $2\n       AND expires_at > NOW()\n     RETURNING id\`,\n    [userId, hashSessionToken(token)]\n  );\n  return Boolean(result.rows[0]);\n}\n`;
  source = source.replace(assertionAnchor, `${helperBlock}\n${assertionAnchor}`);

  const assertionReturnAnchor = `  return { user, ageVerification };\n}\n\nfunction requireAgeVerifiedAdult(req, res, next) {`;
  if (!source.includes(assertionReturnAnchor)) {
    const error = new Error("UNBOUND AI adult-access return anchor is missing.");
    error.code = "ADULT_STEP_UP_RETURN_ANCHOR_MISSING";
    throw error;
  }
  source = source.replace(
    assertionReturnAnchor,
    `  const adultStepUp = await buildAdultStepUpState(req, user.id);\n  if (!adultStepUp.verified) {\n    const error = new Error(\n      adultStepUp.passkeyCount > 0\n        ? "Confirm this device with your passkey before using Adult Mode."\n        : "Register a passkey on this account before using Adult Mode."\n    );\n    error.statusCode = 403;\n    error.code = "ADULT_DEVICE_AUTH_REQUIRED";\n    error.ageVerification = ageVerification;\n    error.adultStepUp = adultStepUp;\n    throw error;\n  }\n\n  return { user, ageVerification, adultStepUp };\n}\n\nfunction requireAgeVerifiedAdult(req, res, next) {`
  );

  const middlewareSuccessAnchor = `      req.user = result.user;\n      req.ageVerification = result.ageVerification;\n      next();`;
  if (!source.includes(middlewareSuccessAnchor)) {
    const error = new Error("UNBOUND AI adult middleware success anchor is missing.");
    error.code = "ADULT_STEP_UP_MIDDLEWARE_SUCCESS_ANCHOR_MISSING";
    throw error;
  }
  source = source.replace(
    middlewareSuccessAnchor,
    `      req.user = result.user;\n      req.ageVerification = result.ageVerification;\n      req.adultStepUp = result.adultStepUp;\n      next();`
  );

  const middlewareErrorAnchor = `        error: error.message || "Could not verify adult access.",\n        ageVerification: error.ageVerification || null`;
  if (!source.includes(middlewareErrorAnchor)) {
    const error = new Error("UNBOUND AI adult middleware error anchor is missing.");
    error.code = "ADULT_STEP_UP_MIDDLEWARE_ERROR_ANCHOR_MISSING";
    throw error;
  }
  source = source.replace(
    middlewareErrorAnchor,
    `        error: error.message || "Could not verify adult access.",\n        code: error.code || null,\n        ageVerification: error.ageVerification || null,\n        adultStepUp: error.adultStepUp || null`
  );

  const routeAnchor = `app.get(\n  "/api/account/recovery-codes/status",`;
  if (!source.includes(routeAnchor)) {
    const error = new Error("UNBOUND AI passkey route insertion anchor is missing.");
    error.code = "ADULT_STEP_UP_ROUTE_ANCHOR_MISSING";
    throw error;
  }

  const routeBlock = `app.get(\n  "/api/account/adult-step-up/status",\n  requireDatabase,\n  requireSignedIn,\n  async (req, res) => {\n    try {\n      const [ageVerification, adultStepUp] = await Promise.all([\n        buildAgeVerificationState(req.user.id),\n        buildAdultStepUpState(req, req.user.id)\n      ]);\n      return res.json({\n        ageVerification,\n        adultStepUp,\n        ready: Boolean(ageVerification.verified && adultStepUp.verified)\n      });\n    } catch (error) {\n      console.error("UNBOUND AI ADULT STEP-UP STATUS ERROR:", error);\n      return res.status(500).json({ error: "Could not load Adult Mode device-lock status." });\n    }\n  }\n);\n\napp.post(\n  "/api/account/adult-step-up/options",\n  requireDatabase,\n  requireSignedIn,\n  securityActionRateLimit,\n  async (req, res) => {\n    try {\n      const ageVerification = await buildAgeVerificationState(req.user.id);\n      if (!ageVerification.verified) {\n        return res.status(403).json({\n          error: "Complete hard 18+ age verification before unlocking Adult Mode.",\n          code: "HARD_AGE_VERIFICATION_REQUIRED",\n          ageVerification\n        });\n      }\n      const passkeys = await pool.query(\n        \`SELECT id FROM account_passkeys WHERE user_id = $1 LIMIT 1\`,\n        [req.user.id]\n      );\n      if (!passkeys.rows[0]) {\n        return res.status(409).json({\n          error: "Register a passkey before unlocking Adult Mode.",\n          code: "PASSKEY_REGISTRATION_REQUIRED",\n          passkeyRegistrationRequired: true\n        });\n      }\n      const options = await generateAuthentication();\n      await storePasskeyChallenge({\n        ceremony: "authentication",\n        challenge: options.challenge,\n        userId: req.user.id,\n        res\n      });\n      return res.json({ options });\n    } catch (error) {\n      console.error("UNBOUND AI ADULT STEP-UP OPTIONS ERROR:", error);\n      return res.status(500).json({ error: "Could not start Adult Mode device verification." });\n    }\n  }\n);\n\napp.post(\n  "/api/account/adult-step-up/verify",\n  requireDatabase,\n  requireSignedIn,\n  securityActionRateLimit,\n  async (req, res) => {\n    try {\n      const response = req.body?.response;\n      if (!response || typeof response.id !== "string" || !response.id) {\n        clearPasskeyFlowCookie(res);\n        return res.status(400).json({ error: "A passkey response is required." });\n      }\n      const ageVerification = await buildAgeVerificationState(req.user.id);\n      if (!ageVerification.verified) {\n        clearPasskeyFlowCookie(res);\n        return res.status(403).json({\n          error: "Hard 18+ age verification is required before Adult Mode can be unlocked.",\n          code: "HARD_AGE_VERIFICATION_REQUIRED",\n          ageVerification\n        });\n      }\n      const expectedChallenge = await consumePasskeyChallenge(\n        req,\n        res,\n        "authentication",\n        req.user.id\n      );\n      const credentialResult = await pool.query(\n        \`SELECT id, credential_id, public_key, signature_counter, transports, label\n         FROM account_passkeys\n         WHERE user_id = $1 AND credential_id = $2\n         LIMIT 1\`,\n        [req.user.id, response.id]\n      );\n      const credentialRow = credentialResult.rows[0];\n      if (!credentialRow) {\n        return res.status(401).json({ error: "That passkey is not registered to this UNBOUND AI account." });\n      }\n      const verification = await verifyAuthentication({\n        response,\n        expectedChallenge,\n        credential: {\n          id: credentialRow.credential_id,\n          publicKey: new Uint8Array(credentialRow.public_key),\n          counter: Number(credentialRow.signature_counter || 0),\n          transports: normalizePasskeyTransports(credentialRow.transports)\n        }\n      });\n      if (!verification.verified) {\n        return res.status(401).json({ error: "Passkey verification failed." });\n      }\n\n      const client = await pool.connect();\n      try {\n        await client.query("BEGIN");\n        await client.query(\n          \`UPDATE account_passkeys\n           SET signature_counter = $1, last_used_at = NOW()\n           WHERE id = $2 AND user_id = $3\`,\n          [\n            Number(verification.authenticationInfo?.newCounter || 0),\n            credentialRow.id,\n            req.user.id\n          ]\n        );\n        const marked = await markCurrentSessionAdultStepUp(req, req.user.id, client);\n        if (!marked) {\n          const error = new Error("Your signed-in session expired. Sign in again.");\n          error.statusCode = 401;\n          throw error;\n        }\n        await writeSecurityEvent(\n          client,\n          req.user.id,\n          "adult.step_up_verified",\n          null,\n          {\n            label: credentialRow.label || "Passkey",\n            ttlMinutes: adultStepUpTtlMinutes()\n          }\n        );\n        await client.query("COMMIT");\n      } catch (error) {\n        try { await client.query("ROLLBACK"); } catch (_) {}\n        throw error;\n      } finally {\n        client.release();\n      }\n\n      return res.json({\n        adultStepUp: await buildAdultStepUpState(req, req.user.id),\n        ready: true\n      });\n    } catch (error) {\n      console.error("UNBOUND AI ADULT STEP-UP VERIFY ERROR:", error);\n      return res.status(error.statusCode || 400).json({\n        error: error.message || "Could not verify this device for Adult Mode."\n      });\n    }\n  }\n);\n\napp.post(\n  "/api/account/adult-step-up/lock",\n  requireDatabase,\n  requireSignedIn,\n  securityActionRateLimit,\n  async (req, res) => {\n    try {\n      const token = parseCookies(req)[SESSION_COOKIE];\n      if (!token) return res.status(401).json({ error: "Sign in again." });\n      await pool.query(\n        \`UPDATE user_sessions\n         SET adult_step_up_at = NULL\n         WHERE user_id = $1 AND token_hash = $2\`,\n        [req.user.id, hashSessionToken(token)]\n      );\n      await writeSecurityEvent(pool, req.user.id, "adult.step_up_locked", null, {});\n      return res.json({\n        adultStepUp: await buildAdultStepUpState(req, req.user.id),\n        ready: false\n      });\n    } catch (error) {\n      console.error("UNBOUND AI ADULT STEP-UP LOCK ERROR:", error);\n      return res.status(500).json({ error: "Could not lock Adult Mode on this device." });\n    }\n  }\n);\n\n`;

  source = source.replace(routeAnchor, routeBlock + routeAnchor);
  return source;
}

module.exports = {
  integrateAdultStepUpServerSource
};
