# UNBOUND AI account email verification foundation

UNBOUND AI keeps account email verification provider-neutral until a transactional email vendor is selected for launch.

## Security model

- Verification links use a cryptographically random one-time token.
- Only an HMAC-SHA256 token hash is intended for database storage. The raw token belongs only in the outbound verification URL and must never be logged or returned by account-status APIs.
- Verification links expire. The default lifetime is 30 minutes and can be configured with `EMAIL_VERIFICATION_TOKEN_TTL_MINUTES` within the guarded 10-minute to 24-hour range.
- `EMAIL_VERIFICATION_TOKEN_SECRET` must be supplied outside the repository. Production must never fall back to a checked-in or hard-coded token secret.
- A used token is rejected even if it has not yet expired.
- Verification URLs are HTTPS-only at the email gateway boundary.
- Provider message IDs and provider-specific secret fields are stripped from normalized gateway results.

## Provider selection

`EMAIL_PROVIDER` is intentionally `none` by default. A future provider adapter must implement:

- `id`
- `isConfigured(env)`
- `sendVerification({ toEmail, displayName, verificationUrl })`

The application must remain truthful when no provider is selected or when the selected adapter is not configured.

## Remaining integration work

The server still needs database-backed challenge persistence, create-account/send/resend/consume routes, the account UI state, and launch-readiness wiring. The production email provider, sender domain, SPF/DKIM/DMARC configuration, and real delivery verification remain launch tasks and must not be faked in application status.
