const fs = require("fs");
const path = require("path");

const serverPath = path.resolve(__dirname, "..", "server.js");
let server = fs.readFileSync(serverPath, "utf8");

function replaceOnce(source, needle, replacement, label) {
  const count = source.split(needle).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one anchor, found ${count}`);
  }
  return source.replace(needle, replacement);
}

const oldAgeImport = `const {
  normalizeAgeVerificationStatus,
  ageVerificationAllowsAdultAccess,
  getAgeVerificationGatewayStatus
} = require("./age/gateway");`;
const newAgeImport = `const {
  normalizeAgeVerificationStatus,
  ageVerificationAllowsAdultAccess,
  getAgeVerificationGatewayStatus,
  startAgeVerificationSession
} = require("./age/gateway");`;
server = replaceOnce(server, oldAgeImport, newAgeImport, "age gateway import");

const ageStateAnchor = `async function buildAgeVerificationState(userId) {`;
const ageHelpers = `function ageVerificationHmac(value, purpose) {
  const secret = process.env.AGE_VERIFICATION_HASH_SECRET || RATE_LIMIT_SECRET;
  return crypto
    .createHmac("sha256", secret)
    .update(\`${'${purpose}'}:${'${String(value || "")}'}\`)
    .digest("hex");
}

function ageVerificationSubject(userId) {
  return ageVerificationHmac(userId, "subject");
}

function hashAgeVerificationReference(reference) {
  return ageVerificationHmac(reference, "provider-reference");
}

`;
server = replaceOnce(
  server,
  ageStateAnchor,
  ageHelpers + ageStateAnchor,
  "age verification helper insertion"
);

const routeStart = `app.get(\n  "/api/account/age-verification",`;
const routeIndex = server.indexOf(routeStart);
if (routeIndex < 0) {
  throw new Error("age verification GET route anchor not found");
}
const routeEnd = server.indexOf("\n);", routeIndex);
if (routeEnd < 0) {
  throw new Error("age verification GET route end not found");
}
const insertAt = routeEnd + 3;

const startRoute = `

app.post(
  "/api/account/age-verification/start",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const current = await buildAgeVerificationState(req.user.id);
      if (current.verified) {
        return res.status(409).json({
          error: "This account already has active hard 18+ verification.",
          gateway: getAgeVerificationGatewayStatus(),
          ageVerification: current
        });
      }

      const session = await startAgeVerificationSession({
        subject: ageVerificationSubject(req.user.id),
        returnUrl: process.env.AGE_VERIFICATION_RETURN_URL || null,
        cancelUrl: process.env.AGE_VERIFICATION_CANCEL_URL || null,
        requestId: req.requestId || null
      });
      const providerReferenceHash = hashAgeVerificationReference(
        session.providerReference
      );

      await pool.query(
        \`INSERT INTO account_age_verification (
           user_id,
           provider,
           status,
           age_threshold,
           verified_at,
           expires_at,
           provider_reference_hash,
           result_code,
           last_event_at,
           created_at,
           updated_at
         )
         VALUES ($1, $2, 'pending', 18, NULL, $3, $4, 'started', NOW(), NOW(), NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET
           provider = EXCLUDED.provider,
           status = 'pending',
           age_threshold = 18,
           verified_at = NULL,
           expires_at = EXCLUDED.expires_at,
           provider_reference_hash = EXCLUDED.provider_reference_hash,
           result_code = 'started',
           last_event_at = NOW(),
           updated_at = NOW()\`,
        [
          req.user.id,
          session.provider,
          session.expiresAt,
          providerReferenceHash
        ]
      );

      return res.status(201).json({
        verification: {
          provider: session.provider,
          status: "pending",
          minimumAge: 18,
          verificationUrl: session.verificationUrl,
          expiresAt: session.expiresAt
        },
        gateway: getAgeVerificationGatewayStatus()
      });
    } catch (error) {
      if (String(error?.code || "").startsWith("AGE_VERIFICATION_")) {
        return res.status(Number(error.statusCode) || 503).json({
          error: error.publicMessage || "Hard age verification is unavailable.",
          code: error.code,
          gateway: getAgeVerificationGatewayStatus()
        });
      }

      console.error("UNBOUND AI AGE VERIFICATION START ERROR:", error);
      return res.status(500).json({
        error: "Could not start hard age verification."
      });
    }
  }
);`;

if (server.includes('"/api/account/age-verification/start"')) {
  throw new Error("age verification start route already exists before migration");
}
server = server.slice(0, insertAt) + startRoute + server.slice(insertAt);

fs.writeFileSync(serverPath, server);
console.log("Applied v0.41 hard-age verification adapter server integration.");
