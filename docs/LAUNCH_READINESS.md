# UNBOUND AI Commercial Launch Readiness

UNBOUND AI exposes a strict engineering/operational launch gate for the commercial adults-only product.

This gate is intentionally conservative. A healthy web process by itself is not enough to mark the product launch-ready.

## Administrator dashboard and endpoints

Authenticated administrators can open:

- `/launch-readiness.html` — color-coded engineering launch dashboard powered by the real server-side launch gate. It calculates its completion percentage from passed checks versus total checks and does not hard-code green statuses.

Authenticated administrators can query:

- `GET /api/admin/ops/launch-readiness` — focused commercial launch result.
- `GET /api/admin/ops/status` — consolidated operations snapshot including the same launch result.

The gate returns `launchReady: true` only when every blocker check passes.

The dashboard percentage is an engineering/operational percentage only. Business banking approval, advertiser or network acceptance, legal-counsel review, and other owner/business approvals remain separate and must not be represented as complete merely because software exists.

## Required checks

The `commercial_adult` launch profile requires:

1. **Runtime operational** — the app and database are ready and the runtime is not draining or otherwise unavailable.
2. **Maintenance off** — no read-only or offline maintenance gate is active.
3. **AI chat ready** — the configured AI provider is available and supports streaming chat.
4. **Research Mode ready** — the configured AI provider supports the Research Mode capability advertised by the product.
5. **Database recovery ready** — backup protection is declared and verified according to the recovery policy, and a current restore drill is recorded.
6. **Terms and Privacy published** — current policy versions are non-draft and have published URLs.
7. **Legal consent enforcement enabled** — acceptance is enabled and the server is enforcing the current published policy versions.
8. **Transactional account email verified** — the email adapter/credentials are configured, the sender identity/domain is verified, production sending access is verified, and a recent successful real-delivery review is recorded.
9. **Commercial billing ready** — the billing gateway is configured and supports checkout, customer portal, and webhooks.
10. **Hard 18+ verification ready** — the age-verification gateway is configured for at least age 18 and supports both starting verification and webhook completion.

Transactional email intentionally does not turn green just because an adapter exists or credentials are present. The operational attestations are controlled with:

- `EMAIL_SENDER_IDENTITY_VERIFIED=true`
- `EMAIL_PROVIDER_PRODUCTION_ACCESS_VERIFIED=true`
- `EMAIL_DELIVERY_REVIEWED_AT=<ISO-8601 timestamp>`
- optional `EMAIL_DELIVERY_REVIEW_MAX_AGE_DAYS` (default 90, bounded to 1–365 days)

These values should be set only after the corresponding provider/domain configuration and real delivery test have actually been verified.

## Current blockers are expected during build-out

A `blocked` result during development is useful, not an error. It identifies the remaining external or configuration work without weakening the product to make the status look green.

Examples of legitimate blockers include:

- Free Render Postgres with no verified durable backup/restore protection;
- draft or unpublished Terms/Privacy documents;
- transactional email sender/domain or production access not verified;
- no recent real verification-email delivery test;
- billing provider not connected or adapter not installed;
- hard age-verification provider not connected or adapter not installed;
- AI provider credentials missing;
- an intentional maintenance window.

Do not bypass a blocker by manually editing the launch response or hardcoding a green status. Fix or verify the underlying dependency.

### v0.69 timestamp validation

Backup verification, restore-drill and infrastructure-review dates more than five
minutes in the future now block readiness with an explicit future-date message,
matching the transactional email gate's clock-skew allowance. Future dates must
not make unverified work appear current. Missing, invalid and expired dates also
remain blocked. These checks do not change or supply any operational attestation.

## Security and privacy

Launch-readiness output contains capability/configuration state only. It must never include:

- API keys or provider secrets;
- database URLs or credentials;
- webhook secrets;
- passwords, recovery codes, sessions, cookies, or passkeys;
- raw email-verification tokens, verification links, or provider message IDs;
- user emails, names, prompts, responses, or conversation content.

## What this gate does not mean

A green engineering launch gate is **not** legal advice, regulatory certification, a penetration-test certification, an accessibility conformance statement, financial compliance approval, or a substitute for professional review. It means the technical launch requirements encoded by UNBOUND AI are currently reporting ready.
