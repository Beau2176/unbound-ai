# UNBOUND AI final launch rehearsal

This is the end-to-end rehearsal required after the real infrastructure, backup/restore, banking, Segpay, Yoti, SES, final legal review, and private ClamAV dependencies are truthfully ready.

Before that point, use this document only as a **dry-run checklist**. Do not fake provider events, approval timestamps, policy publication, or readiness flags merely to make the rehearsal pass.

## Entry conditions

Do not begin the final production rehearsal unless:

- `npm run ci` is green on the exact candidate commit;
- `npm run launch-preflight` reports every prerequisite stage ready;
- Render uses intended always-on production compute and a durable non-expiring production database;
- the platform health check is configured and passing against `/healthz` or the deliberately selected equivalent;
- a current production backup is verified and a restore drill into an isolated database is current;
- the business bank/settlement rails are approved and verified;
- Segpay, Yoti, and SES production paths are genuinely configured and approved;
- final non-draft Terms/Privacy are reviewed, published, accepted, and enforced;
- private ClamAV scanning is operating in required fail-closed mode;
- maintenance mode is off unless a deliberate maintenance-state test is being performed.

## Phase 1 — platform and recovery

1. Confirm the candidate commit deployed successfully and matches the intended Git SHA.
2. Verify `/healthz`, `/readyz`, and `/api/system/status` return the expected healthy/ready state without secrets.
3. Confirm normal request IDs/log correlation works and logs do not contain query-string secrets, authorization headers, cookies, raw verification tokens, prompts, card data, or provider secrets.
4. Verify the platform health-check probes are succeeding.
5. Verify current production backup evidence.
6. Restore the verified backup into an isolated database using the documented recovery procedure.
7. Start the application against the isolated restored database and verify representative login/history/account data as appropriate.
8. Confirm the restore drill did not mutate or replace production.
9. Record the real backup/restore timestamps only after the drill succeeds.

## Phase 2 — new visitor and hard 18+ verification

1. Open the public site as a new visitor with no existing session.
2. Confirm general public/guest behavior is available only within intended limits.
3. Attempt to enter an adults-only capability without verified age and confirm access is blocked.
4. Start the Yoti hosted verification flow.
5. Confirm no account email, user ID, password, cookie, raw ID image, selfie, or biometric template is placed into the provider request/URL by UNBOUND.
6. Complete a valid over-18 test and confirm only the authenticated normalized server state unlocks Adult Mode.
7. Exercise fail/underage outcome, cancellation, expiry, duplicate notification, stale notification, tampered signature, unknown future state, and provider-outage cases.
8. Confirm every non-verified/expired/revoked outcome remains fail-closed.

## Phase 3 — account registration and email verification

1. Register a new account.
2. Confirm account/session creation succeeds independently of a temporary mail-provider failure.
3. Confirm the initial verification email is sent only when the full transactional-email readiness gate is green.
4. Verify the link uses the browser-only token fragment and the raw token is removed from browser history before submission.
5. Complete verification successfully.
6. Test resend, expired token, invalid token, already-used token, and provider failure.
7. Confirm logs/public API output never expose raw verification tokens, complete verification URLs, AWS secrets, or provider message IDs.

## Phase 4 — TOP purchase and billing lifecycle

1. From a FREE account, start TOP checkout.
2. Confirm the checkout is HTTPS, hosted by Segpay, and contains the signed production amount plus opaque `REF1`/`REF2` references rather than account email/user ID.
3. Complete an approved first payment and confirm TOP entitlement becomes active only after the authenticated provider lifecycle event.
4. Confirm duplicate/retried provider events are idempotent.
5. Exercise declined initial payment and declined rebill.
6. Exercise cancellation and confirm access follows the intended end-of-period behavior.
7. Exercise disable/expiry and reactivation.
8. Exercise refund/chargeback/revoke/void handling in the approved provider test method.
9. Verify the customer-portal handoff uses HTTPS and exposes no provider customer identifier/account data in the browser URL.
10. Confirm UNBOUND never receives/stores card numbers or CVV.

## Phase 5 — core AI experience

1. Send a normal Casual Mode prompt and verify a complete streamed answer.
2. Use Work Mode and verify the deeper behavior expected for that mode.
3. Use Research Mode and verify source-backed/citation behavior supported by the configured provider.
4. Trigger an intentionally interrupted/early-EOF test and confirm partial text remains marked `Response interrupted before completion`, survives reload as interrupted, and is not treated as a completed Go Deeper source.
5. Verify model-profile controls cannot inject an arbitrary raw provider model ID.
6. Confirm usage/cost metadata remains privacy-safe and entitlement enforcement cannot be bypassed client-side.

## Phase 6 — voice

1. Verify Voice / Listen works.
2. Verify Voice 2 — Clear remains the reliable local/default fallback.
3. Verify additional configured voices behave as intended.
4. Force a cloud-voice failure/rate-limit condition using an approved test setup and confirm safe fallback rather than a broken UI.
5. Confirm no provider API key is exposed in browser code or responses.

## Phase 7 — files, images, and malware defense

1. Upload an accepted clean file for TOP file analysis.
2. Confirm static filename/type/signature/active-content checks run before provider use.
3. Confirm private ClamAV scans the bytes before provider forwarding.
4. Test the harmless EICAR antivirus test file and verify the upload is blocked before the AI provider sees it.
5. Simulate scanner unavailable/timeout behavior and verify `required` mode fails closed with a generic error.
6. Test image understanding with a valid supported image.
7. Test Image Studio generation.
8. Test Image Studio editing with a clean source image and confirm source bytes are not persisted by UNBOUND.
9. Confirm public scanner status does not expose the private ClamAV host/port.

## Phase 8 — account, legal, and billing management

1. Confirm Account Access shows the correct current non-draft Terms/Privacy versions.
2. Verify a new/current account must accept the exact enforced versions where required.
3. Confirm legal acceptance cannot be recorded for a draft version.
4. Verify email verification state, billing state, age-verification state, and TOP entitlement are represented truthfully.
5. Open the customer billing portal.
6. Complete the approved subscription cancellation flow and verify lifecycle state after the provider callback.
7. Request account data export and inspect for intended content only.
8. Attempt account deletion while an externally billable/non-final subscription state exists and confirm deletion is safely blocked.
9. After the subscription is in a safe final state, complete account deletion and confirm retained operational records are scrubbed/detached according to policy.

## Phase 9 — admin, monitoring, and incident controls

1. Open the protected admin/launch-readiness pages as an administrator and verify unauthenticated/non-admin access is denied.
2. Confirm engineering launch readiness and owner/business readiness are shown separately.
3. Confirm there is no UI/API override that can force a blocked launch green.
4. Test `read_only` maintenance mode: safe reads continue, mutations are blocked with the intended status/Retry-After behavior.
5. Test `offline` mode: API traffic is blocked except the deliberate system-status path.
6. Return maintenance to `off` and confirm the composer/service returns to normal.
7. Exercise graceful shutdown/draining and verify new unsafe work is not accepted during drain.
8. Review error/latency/connection metrics for the rehearsal and record any capacity issue before public launch.

## Phase 10 — go/no-go record

Record:

- exact Git commit/deploy ID;
- Render web/database plan and region;
- platform health-check evidence;
- backup verification and isolated restore evidence;
- bank/settlement verification reference;
- Segpay merchant/test references;
- Yoti onboarding/template/test references;
- SES sender/production-access/delivery-test references;
- final Terms/Privacy versions and qualified review date;
- ClamAV private-scanner/EICAR/outage-test evidence;
- `npm run ci` result;
- `npm run launch-preflight` result;
- known defects, severity, and disposition;
- rollback owner and rollback procedure;
- explicit go/no-go decision.

A green engineering dashboard alone is not sufficient. Launch only when the real external approvals and owner/business checks are also satisfied.

## Immediate rollback triggers

Treat these as no-go/rollback conditions until resolved:

- hard age verification can be bypassed or accepts unauthenticated/unknown provider state;
- card/identity/provider secrets appear in logs/browser output;
- payment events create incorrect or non-idempotent access state;
- required ClamAV scanning can be bypassed for a user-supplied upload;
- database restore cannot reproduce expected data/state;
- final policy acceptance/enforcement is missing or points at draft/wrong versions;
- the production database is expiring/non-durable;
- critical security/regression CI fails;
- service health/readiness is materially unstable under expected launch load.
