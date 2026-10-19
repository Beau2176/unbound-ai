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
- `EMAIL_FEEDBACK_FORWARDING_ADDRESS` — a monitored, SES-authorized address for bounce and complaint notices; independent of customer replies and message recipients
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

Account status reads the expiry of the most recent active challenge. Resending
invalidates the earlier challenge, and its expiry must not replace the new
link's expiry. A pending link becomes expired at its exact expiry boundary.
The `email-postgres-check` CI command exercises these states, one-time concurrent
consumption, failed delivery and recovery against real PostgreSQL 16 and 18.
It uses disposable local test schemas and a delivery fixture; it never sends mail
or connects to a remote production database.

The remaining launch work is external configuration and live verification: verify the sender/domain with SES, configure SPF/DKIM/DMARC as appropriate, obtain production sending access if the AWS account/region is still in the SES sandbox, set production environment secrets, and run end-to-end delivery/expiry/resend/failure tests. Launch-readiness status must stay blocked until that real delivery path is verified.

## Existing account evidence and full-site handoff — October 17, 2026

The business inbox contains AWS's October 11 approval for production sending in
`us-east-2` (US East, Ohio). The request was for Founders Beta transactional mail,
with `unboundforgeworks.com` described as the verified domain. This is useful
existing account evidence, not proof that the full-site sender, credentials,
identity/DKIM state, feedback handling, or live verification path are configured.
The approval quota is capacity, not a spending budget. No email is sent during
this no-spend handoff.

Prepare the full-site connection using the existing region and a sender verified
in that region. `PUBLIC_APP_ORIGIN` must point to the full application,
`https://unbound-ai-app.onrender.com`, so verification links return to the correct
product. `EMAIL_REPLY_TO_ADDRESS` can use the existing business contact,
`unboundai111710@gmail.com`. The exact From address still needs to be selected
and verified against the intended identity; do not assume a new mailbox exists.
Store AWS keys and `EMAIL_VERIFICATION_TOKEN_SECRET` only in the service's secret
configuration. Keep `EMAIL_PROVIDER=none` until live sending is deliberately
authorized and the actual full-site configuration has been reviewed.

For the application sending credential, prepare an IAM identity policy allowing
only `ses:SendEmail` on the exact verified identity ARN, constrained with
`ses:FromAddress` to the selected From address. Replace the placeholders before
application; this is a template, not an applied policy or a credential:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "ses:SendEmail",
    "Resource": "arn:aws:ses:us-east-2:<AWS_ACCOUNT_ID>:identity/<VERIFIED_IDENTITY>",
    "Condition": {
      "StringEquals": { "ses:FromAddress": "<SELECTED_FROM_ADDRESS>" }
    }
  }]
}
```

Account/identity inspection permissions should be separate from the application's
sending permission. Confirm which identity is used and its current verification
state; do not grant SES administration or unrestricted `ses:*` to the app.
AWS documents [IAM action/resource/From restrictions](https://docs.aws.amazon.com/ses/latest/dg/control-user-access.html).

Set `EMAIL_FEEDBACK_FORWARDING_ADDRESS` to a monitored inbox after confirming its
SES verification/authorization in the sending region. The adapter passes it as
the SES v2 `FeedbackForwardingEmailAddress` field. `EMAIL_REPLY_TO_ADDRESS` only
controls customer replies and does not configure the feedback destination.
Leaving the forwarding address blank omits the API override and preserves SES's
default routing; this alone is not evidence that the resulting mailbox is
monitored. A malformed nonempty forwarding address blocks the request locally.
Keep identity email feedback forwarding enabled while using this route. See the
[SES v2 SendEmail reference](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html)
and [email feedback forwarding guide](https://docs.aws.amazon.com/ses/latest/dg/monitor-sending-activity-using-notifications-email.html).

Before live delivery, verify bounce/complaint feedback notifications or event
publishing, suppression handling, monitoring responsibility and pause procedure.
API acceptance is not proof of mailbox delivery. See AWS's
[sending activity definitions and monitoring requirements](https://docs.aws.amazon.com/ses/latest/dg/monitor-sending-activity.html).
No IAM change, DNS edit, case submission, sender activation or test delivery was
performed by this document update.
