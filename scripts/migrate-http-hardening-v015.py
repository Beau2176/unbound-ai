from pathlib import Path

server_path = Path('app/server.js')
server = server_path.read_text()


def replace_one(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)


server = replace_one(
    server,
    '''const {
  getRateLimitPolicy,
  hashRateLimitSubject,
  getRateLimitStatus
} = require("./security/rate-limit");
''',
    '''const {
  getRateLimitPolicy,
  hashRateLimitSubject,
  getRateLimitStatus
} = require("./security/rate-limit");
const {
  createHttpSecurityMiddleware,
  createSameOriginApiGuard,
  getHttpSecurityStatus
} = require("./security/http-security");
''',
    'HTTP security import'
)

server = replace_one(
    server,
    '''app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
''',
    '''app.disable("x-powered-by");
app.use(createHttpSecurityMiddleware({ isProduction: IS_PRODUCTION }));
app.use(
  createSameOriginApiGuard({
    isProduction: IS_PRODUCTION,
    publicOrigin: process.env.PUBLIC_APP_ORIGIN || ""
  })
);
app.use(express.json({ limit: "100kb" }));
''',
    'global HTTP hardening middleware'
)

server = replace_one(
    server,
    '''    ageVerification: getAgeVerificationGatewayStatus(),
    abuseProtection: getRateLimitStatus()
''',
    '''    ageVerification: getAgeVerificationGatewayStatus(),
    abuseProtection: getRateLimitStatus(),
    httpSecurity: getHttpSecurityStatus({
      isProduction: IS_PRODUCTION,
      publicOrigin: process.env.PUBLIC_APP_ORIGIN || ""
    })
''',
    'health HTTP security status'
)

server_path.write_text(server)
