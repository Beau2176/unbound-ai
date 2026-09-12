from pathlib import Path

path = Path('app/server.js')
server = path.read_text()


def one(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    return source.replace(old, new, 1)

# Rate-limit policy module.
server = one(
    server,
    '''const {\n  normalizeAgeVerificationStatus,\n  ageVerificationAllowsAdultAccess,\n  getAgeVerificationGatewayStatus\n} = require("./age/gateway");''',
    '''const {\n  normalizeAgeVerificationStatus,\n  ageVerificationAllowsAdultAccess,\n  getAgeVerificationGatewayStatus\n} = require("./age/gateway");\nconst {\n  getRateLimitPolicy,\n  hashRateLimitSubject,\n  getRateLimitStatus\n} = require("./security/rate-limit");''',
    'rate-limit import'
)

server = one(
    server,
    '''const DEVICE_COOKIE = "unbound_device";\nconst DEVICE_DAYS = 365;''',
    '''const DEVICE_COOKIE = "unbound_device";\nconst DEVICE_DAYS = 365;\nconst GUEST_RATE_COOKIE = "unbound_guest_rate";\nconst GUEST_RATE_DAYS = 1;\nconst RATE_LIMIT_POLICY = getRateLimitPolicy();\nconst RATE_LIMIT_SECRET =\n  process.env.RATE_LIMIT_HASH_SECRET ||\n  process.env.DATABASE_URL ||\n  crypto.randomBytes(32).toString("hex");''',
    'rate-limit constants'
)

# Shared PostgreSQL counters plus privacy-safe block telemetry.
rate_schema = r'''

    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      scope TEXT NOT NULL,
      subject_hash TEXT NOT NULL,
      subject_kind TEXT NOT NULL,
      window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      request_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (scope, subject_hash)
    );

    CREATE INDEX IF NOT EXISTS rate_limit_buckets_updated_idx
      ON rate_limit_buckets(updated_at DESC);

    CREATE TABLE IF NOT EXISTS rate_limit_blocks (
      id BIGSERIAL PRIMARY KEY,
      scope TEXT NOT NULL,
      subject_kind TEXT NOT NULL,
      request_count INTEGER NOT NULL,
      limit_count INTEGER NOT NULL,
      window_seconds INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS rate_limit_blocks_created_idx
      ON rate_limit_blocks(created_at DESC);

    CREATE INDEX IF NOT EXISTS rate_limit_blocks_scope_idx
      ON rate_limit_blocks(scope, created_at DESC);
'''
server = one(
    server,
    '''    CREATE INDEX IF NOT EXISTS account_security_events_user_created_idx\n      ON account_security_events(user_id, created_at DESC);''',
    '''    CREATE INDEX IF NOT EXISTS account_security_events_user_created_idx\n      ON account_security_events(user_id, created_at DESC);''' + rate_schema,
    'rate-limit schema'
)

# Opportunistic retention cleanup on application start.
server = one(
    server,
    '''  const ownerEmail = normalizeEmail(process.env.OWNER_EMAIL);''',
    '''  await pool.query(`\n    DELETE FROM rate_limit_buckets\n    WHERE updated_at < NOW() - INTERVAL '7 days';\n\n    DELETE FROM rate_limit_blocks\n    WHERE created_at < NOW() - INTERVAL '30 days';\n  `);\n\n  const ownerEmail = normalizeEmail(process.env.OWNER_EMAIL);''',
    'rate-limit retention cleanup'
)

# Guest limiter cookie + atomic fixed-window DB counter. No raw IP is used or stored.
helpers = r'''

function setGuestRateCookie(res, token) {
  const maxAge = GUEST_RATE_DAYS * 24 * 60 * 60;
  const secure = IS_PRODUCTION ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${GUEST_RATE_COOKIE}=${encodeURIComponent(
      token
    )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

function ensureGuestRateToken(req, res) {
  let token = parseCookies(req)[GUEST_RATE_COOKIE];
  if (!token) {
    token = crypto.randomBytes(32).toString("base64url");
    setGuestRateCookie(res, token);
  }
  return token;
}

async function consumeRateLimit({
  scope,
  subjectKind,
  subjectValue,
  limit,
  windowSeconds
}) {
  if (!databaseReady || !pool) {
    return { allowed: true, count: 0, retryAfter: 0 };
  }

  const subjectHash = hashRateLimitSubject(
    RATE_LIMIT_SECRET,
    `${subjectKind}:${subjectValue}`
  );
  const result = await pool.query(
    `INSERT INTO rate_limit_buckets (
       scope,
       subject_hash,
       subject_kind,
       window_started_at,
       request_count,
       updated_at
     )
     VALUES ($1, $2, $3, NOW(), 1, NOW())
     ON CONFLICT (scope, subject_hash)
     DO UPDATE SET
       subject_kind = EXCLUDED.subject_kind,
       window_started_at = CASE
         WHEN rate_limit_buckets.window_started_at <=
              NOW() - ($4::int * INTERVAL '1 second')
           THEN NOW()
         ELSE rate_limit_buckets.window_started_at
       END,
       request_count = CASE
         WHEN rate_limit_buckets.window_started_at <=
              NOW() - ($4::int * INTERVAL '1 second')
           THEN 1
         ELSE rate_limit_buckets.request_count + 1
       END,
       updated_at = NOW()
     RETURNING window_started_at, request_count`,
    [scope, subjectHash, subjectKind, windowSeconds]
  );

  const row = result.rows[0];
  const count = Number(row?.request_count || 0);
  if (count <= limit) {
    return { allowed: true, count, retryAfter: 0 };
  }

  const windowStart = new Date(row.window_started_at).getTime();
  const retryAfter = Math.max(
    1,
    Math.ceil((windowStart + windowSeconds * 1000 - Date.now()) / 1000)
  );

  await pool.query(
    `INSERT INTO rate_limit_blocks (
       scope,
       subject_kind,
       request_count,
       limit_count,
       window_seconds
     )
     VALUES ($1, $2, $3, $4, $5)`,
    [scope, subjectKind, count, limit, windowSeconds]
  );

  return { allowed: false, count, retryAfter };
}

function rateLimitMiddleware({ policy, subjectResolver, when = null }) {
  return async function unboundRateLimit(req, res, next) {
    try {
      if (!databaseReady || !pool) return next();
      if (when && !(await when(req))) return next();

      const subject = await subjectResolver(req, res);
      if (!subject || !subject.value) return next();

      const result = await consumeRateLimit({
        scope: policy.scope,
        subjectKind: subject.kind,
        subjectValue: subject.value,
        limit: policy.limit,
        windowSeconds: policy.windowSeconds
      });

      res.setHeader("X-RateLimit-Limit", String(policy.limit));
      res.setHeader(
        "X-RateLimit-Remaining",
        String(Math.max(0, policy.limit - result.count))
      );

      if (!result.allowed) {
        res.setHeader("Retry-After", String(result.retryAfter));
        return res.status(429).json({
          error: `Too many requests. Try again in about ${result.retryAfter} seconds.`,
          rateLimit: {
            scope: policy.scope,
            limit: policy.limit,
            windowSeconds: policy.windowSeconds,
            retryAfter: result.retryAfter
          }
        });
      }

      return next();
    } catch (error) {
      console.error("UNBOUND AI RATE LIMIT ERROR:", error);
      return res.status(503).json({
        error: "Abuse protection is temporarily unavailable. Please try again shortly."
      });
    }
  };
}

async function emailRateSubject(req) {
  return {
    kind: "email_hash",
    value: normalizeEmail(req.body?.email) || "missing-email"
  };
}

async function accountRateSubject(req) {
  const user = req.user || (await findSessionUser(req));
  if (!user) return null;
  req.user = user;
  return { kind: "account", value: String(user.id) };
}

async function chatRateSubject(req, res) {
  const user = req.user || (await findSessionUser(req));
  if (user) {
    req.user = user;
    return {
      policy: RATE_LIMIT_POLICY.accountChat,
      subject: { kind: "account", value: String(user.id) }
    };
  }

  return {
    policy: RATE_LIMIT_POLICY.guestChat,
    subject: {
      kind: "guest_browser",
      value: ensureGuestRateToken(req, res)
    }
  };
}

async function chatRateLimit(req, res, next) {
  try {
    if (!databaseReady || !pool) return next();
    const resolved = await chatRateSubject(req, res);
    const result = await consumeRateLimit({
      scope: resolved.policy.scope,
      subjectKind: resolved.subject.kind,
      subjectValue: resolved.subject.value,
      limit: resolved.policy.limit,
      windowSeconds: resolved.policy.windowSeconds
    });

    res.setHeader("X-RateLimit-Limit", String(resolved.policy.limit));
    res.setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(0, resolved.policy.limit - result.count))
    );
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfter));
      return res.status(429).json({
        error: `Too many chat requests. Try again in about ${result.retryAfter} seconds.`,
        rateLimit: {
          scope: resolved.policy.scope,
          limit: resolved.policy.limit,
          windowSeconds: resolved.policy.windowSeconds,
          retryAfter: result.retryAfter
        }
      });
    }
    return next();
  } catch (error) {
    console.error("UNBOUND AI CHAT RATE LIMIT ERROR:", error);
    return res.status(503).json({
      error: "Abuse protection is temporarily unavailable. Please try again shortly."
    });
  }
}

const loginRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.login,
  subjectResolver: emailRateSubject
});
const registerRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.register,
  subjectResolver: emailRateSubject
});
const securityActionRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.securityActions,
  subjectResolver: accountRateSubject
});
const researchRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.research,
  subjectResolver: accountRateSubject,
  when: async (req) => normalizeProductMode(req.body?.productMode) === "research"
});
'''
server = one(
    server,
    '''app.get("/api/health", (req, res) => {''',
    helpers + '''\napp.get("/api/health", (req, res) => {''',
    'rate-limit helpers'
)

# Health visibility, no secrets or subject identifiers.
server = one(
    server,
    '''    ageVerification: getAgeVerificationGatewayStatus()''',
    '''    ageVerification: getAgeVerificationGatewayStatus(),\n    abuseProtection: getRateLimitStatus()''',
    'rate-limit health'
)

# Authentication brute-force protection by keyed email hash.
server = one(
    server,
    '''app.post("/api/auth/register", requireDatabase, async (req, res) => {''',
    '''app.post("/api/auth/register", requireDatabase, registerRateLimit, async (req, res) => {''',
    'register rate limit'
)
server = one(
    server,
    '''app.post("/api/auth/login", requireDatabase, async (req, res) => {''',
    '''app.post("/api/auth/login", requireDatabase, loginRateLimit, async (req, res) => {''',
    'login rate limit'
)

# Password/device/session/account-destructive actions share a conservative account safety ceiling.
for route, label in [
    ('"/api/account/password"', 'password rate limit'),
    ('"/api/account/sessions/revoke-others"', 'revoke others rate limit'),
    ('"/api/account/devices/:id/revoke"', 'device revoke rate limit'),
    ('"/api/account/sessions/revoke-all"', 'revoke all rate limit')
]:
    old = f'''  {route},\n  requireDatabase,\n  requireSignedIn,\n  async (req, res) => {{'''
    new = f'''  {route},\n  requireDatabase,\n  requireSignedIn,\n  securityActionRateLimit,\n  async (req, res) => {{'''
    server = one(server, old, new, label)

server = one(
    server,
    '''  "/api/account",\n  requireDatabase,\n  requireSignedIn,\n  async (req, res) => {''',
    '''  "/api/account",\n  requireDatabase,\n  requireSignedIn,\n  securityActionRateLimit,\n  async (req, res) => {''',
    'account delete rate limit'
)

# Chat and streaming share one account/guest chat bucket. Research has an additional account bucket.
server = one(
    server,
    '''app.post("/api/chat", async (req, res) => {''',
    '''app.post("/api/chat", chatRateLimit, researchRateLimit, async (req, res) => {''',
    'chat rate limits'
)
server = one(
    server,
    '''app.post("/api/chat/stream", async (req, res) => {''',
    '''app.post("/api/chat/stream", chatRateLimit, async (req, res) => {''',
    'stream rate limit'
)

# Admin aggregate visibility. Subject hashes never leave the rate-limit table.
admin_rate_api = r'''
app.get(
  "/api/admin/rate-limits/summary",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const [bucketResult, blockTotalResult, blockScopesResult] = await Promise.all([
        pool.query(`
          SELECT scope, subject_kind, COUNT(*)::int AS buckets
          FROM rate_limit_buckets
          WHERE updated_at >= NOW() - INTERVAL '24 hours'
          GROUP BY scope, subject_kind
          ORDER BY buckets DESC, scope, subject_kind
        `),
        pool.query(`
          SELECT COUNT(*)::int AS blocks
          FROM rate_limit_blocks
          WHERE created_at >= NOW() - INTERVAL '24 hours'
        `),
        pool.query(`
          SELECT scope, subject_kind, COUNT(*)::int AS blocks
          FROM rate_limit_blocks
          WHERE created_at >= NOW() - INTERVAL '24 hours'
          GROUP BY scope, subject_kind
          ORDER BY blocks DESC, scope, subject_kind
        `)
      ]);

      return res.json({
        status: getRateLimitStatus(),
        totals: {
          blocks24h: Number(blockTotalResult.rows[0]?.blocks || 0),
          activeBuckets24h: bucketResult.rows.reduce(
            (sum, row) => sum + Number(row.buckets || 0),
            0
          )
        },
        activeBuckets: bucketResult.rows.map((row) => ({
          scope: row.scope,
          subjectKind: row.subject_kind,
          buckets: Number(row.buckets || 0)
        })),
        blocks: blockScopesResult.rows.map((row) => ({
          scope: row.scope,
          subjectKind: row.subject_kind,
          blocks: Number(row.blocks || 0)
        }))
      });
    } catch (error) {
      console.error("UNBOUND AI ADMIN RATE LIMIT SUMMARY ERROR:", error);
      return res.status(500).json({ error: "Could not load abuse-protection status." });
    }
  }
);

'''
server = one(
    server,
    '''app.get(\n  "/api/admin/security/summary",''',
    admin_rate_api + '''app.get(\n  "/api/admin/security/summary",''',
    'admin rate-limit endpoint'
)

path.write_text(server)
print('PostgreSQL rate limiting and abuse-protection server migration applied.')
