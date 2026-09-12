# UNBOUND AI account email verification

UNBOUND AI uses a provider-neutral account-verification design and targets Amazon Simple Email Service (SES) as the production transactional-email provider. Selecting SES in code does **not** enable sending by itself: production remains disabled until the sender identity/domain and required environment credentials are configured.

## Security model

- Verification links use a cryptographically random one-time token.
- Only an HMAC-SHA256 token hash is stored in PostgreSQL. The raw token exists only in the outbound verification link and the browser POST that consumes it.
- Verification links use a browser URL fragment (`#token=...`) so the initial page request and normal request logs never receive the raw token.
- Verification links expire. The default lifetime is 30 minutes and can be configured with `EMAIL_VERIFICATION_TOKEN_TTL_MINUTES` within the guarded 10-minute to 24-hour range.
- `EMAIL_VERIFICATION_TOKEN_SECRET` must be supplied outside the repository. Production must never fall back to a checked-in or hard-coded token secret.
- A used, invalidated, or expired token is rejected.
- Verification URLs are HTTPS-only at the email gateway boundary.
- Provider message IDs and provider-specific secret fields are stripped from normalized gateway results and public account status.
- Verification sends and link-consumption attempts have dedicated PostgreSQL-backed rate-limit scopes.

## Amazon SES production target

Set `EMAIL_PROVIDER=aws-ses` only when the SES sender configuration is ready. The adapter uses the SES v2 HTTPS API with AWS Signature Version 4 and Node's built-in `fetch`, so no additional email SDK dependency is required.

Required environment values:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION` or `AWS_DEFAULT_REGION`
- `EMAIL_FROM_ADDRESS`
- `EMAIL_VERIFICATION_TOKEN_SECRET`
- `PUBLIC_APP_ORIGIN` using HTTPS

Optional values:

- `AWS_SESSION_TOKEN` for temporary credentials
- `EMAIL_FROM_NAME` (defaults to `UNBOUND AI`)
- `EMAIL_REPLY_TO_ADDRESS`
- `EMAIL_VERIFICATION_TOKEN_TTL_MINUTES`
- `RATE_LIMIT_EMAIL_VERIFICATION_SEND_PER_HOUR`
- `RATE_LIMIT_EMAIL_VERIFICATION_CONSUME_PER_15_MIN`

AWS credentials must remain outside the repository. Do not place access keys, secret keys, session tokens, verification tokens, provider message IDs, or complete outbound verification links in logs.

## Provider-neutral gateway contract

Every email provider adapter must implement:

- `id`
- `isConfigured(env)`
- `sendVerification({ toEmail, displayName, verificationUrl, env })`

The application remains truthful when `EMAIL_PROVIDER` is `none`, when an adapter is missing, or when the selected provider is not configured.

## Current integration state

The database schema, send/resend/status/consume service, HTTP routes, verification landing page, startup integration, abuse protection, and Amazon SES adapter are implemented and covered by permanent CI contracts.

The remaining launch work is external configuration and live verification: verify the sender/domain with SES, configure SPF/DKIM/DMARC as appropriate, obtain production sending access if the AWS account/region is still in the SES sandbox, set production environment secrets, and run end-to-end delivery/expiry/resend/failure tests. Launch-readiness status must stay blocked until that real delivery path is verified.
