# UNBOUND AI hard 18+ age verification

UNBOUND AI uses a provider-neutral hard age-verification gateway. The production target selected for the adults-only product is **Yoti Age Verification Service (AVS)**, subject to Yoti onboarding and approval of the actual UNBOUND AI business, content, jurisdictions, and production configuration.

Selecting Yoti in code does not create a Yoti account, approve UNBOUND AI for production, or make Adult Mode launch-ready by itself.

## Why Yoti AVS

Yoti's current developer guidance explicitly recommends its Age Verification Service for adult-industry integrations. AVS provides a hosted user flow and can combine approved age-assurance methods while returning the relying business an age-check result rather than requiring the relying business to collect or retain the underlying evidence.

UNBOUND AI therefore keeps the provider boundary strict:

- UNBOUND does not request or store raw identity-document images.
- UNBOUND does not request or store facial images or biometric templates.
- UNBOUND does not store the user's exact age from the Yoti notification.
- UNBOUND stores only the normalized verification state, threshold, timestamps, result code, and a hash of the Yoti session reference.

## Production configuration

Set `AGE_VERIFICATION_PROVIDER=yoti` only after the Yoti production setup is ready.

Required values:

- `YOTI_API_KEY` — Yoti AVS API bearer token.
- `YOTI_SDK_ID` — SDK ID issued through Yoti Hub.
- `YOTI_TEMPLATE_ID` — production AVS template configured for the approved over-18 flow.
- `YOTI_NOTIFICATION_PUBLIC_KEY` — Yoti notification-signature public key in PEM form. Render may store newlines normally or as escaped `\n`; the adapter normalizes either representation.
- `PUBLIC_APP_ORIGIN` — production HTTPS UNBOUND origin. This is used to construct `/api/webhooks/age-verification`.
- `AGE_VERIFICATION_RETURN_URL` — optional HTTPS return URL after the hosted flow. If absent, the public app origin is used.
- `AGE_VERIFICATION_CANCEL_URL` — optional HTTPS cancellation URL. If absent, the public app origin is used.
- optional `YOTI_SESSION_TTL_SECONDS` — default 900 seconds; bounded to Yoti's supported session window.
- optional `YOTI_VERIFICATION_VALID_DAYS` — default 365 days; controls UNBOUND's re-verification lifetime after a successful over-18 result.

Three production attestations are also required before the adapter reports itself configured:

- `YOTI_ADULT_INDUSTRY_ONBOARDING_VERIFIED=true`
- `YOTI_OVER_18_TEMPLATE_VERIFIED=true`
- `YOTI_NOTIFICATION_SIGNATURE_VERIFIED=true`

Set these only after the corresponding real provider/onboarding checks have been completed. API credentials alone must never make hard age verification report ready.

## Hosted verification flow

For each verification attempt, UNBOUND creates a new Yoti AVS session using the configured production template. The request contains:

- the template ID;
- a short session TTL;
- the existing UNBOUND opaque age-verification subject as `reference_id`;
- HTTPS return, cancellation, and notification URLs;
- synchronous checks enabled so the hosted flow waits for configured checks when possible.

The user is redirected only to Yoti's hosted `https://age.yoti.com/` flow using the returned session ID and configured SDK ID.

UNBOUND never places an account email, user ID, password, session cookie, document image, selfie, or biometric template into the Yoti session request or verification URL.

## Notification authentication

Yoti sends HTTPS POST notifications to:

`/api/webhooks/age-verification`

The endpoint already uses the server's raw-body webhook path. The Yoti adapter authenticates the notification before parsing or applying it.

Signature verification follows Yoti's documented RSA-PSS / SHA-256 scheme:

1. Parse the JSON notification.
2. Remove `sequence_number` and `signature` from the signed payload.
3. JSON-serialize the remaining payload and remove whitespace as Yoti documents.
4. Base64-decode the notification signature.
5. Calculate the RSA-PSS salt length from signature length minus the SHA-256 digest length and framing bytes.
6. Verify with the configured Yoti public key using RSA-PSS and SHA-256.

Tampered or unsigned notifications fail before provider state is parsed.

Yoti retries notifications when a successful HTTP response is not received. The existing UNBOUND webhook-event table and provider-event IDs keep retries idempotent.

## Normalized states

The adapter deliberately keeps Yoti-specific details out of the rest of the application.

- completed + successful threshold result -> `verified`
- completed + failed threshold result -> `failed`
- explicit failure/error -> `failed`
- expired/timeout -> `expired`
- pending/processing -> `pending`
- revoked -> `revoked`

A `verified` result is accepted only when the signed notification explicitly reports a successful result from the production template. The gateway continues to enforce UNBOUND's hard minimum age of 18.

UNBOUND does not persist the notification's exact `age`, evidence ID, signature, or opaque user reference. The only provider reference used for account matching is Yoti's session key, and the existing server hashes that reference before storing it.

## Remaining external launch work

The adapter is code, not provider approval. Before hard 18+ verification can truthfully pass commercial launch readiness:

1. Complete Yoti onboarding for UNBOUND AI's actual adults-only / AI-assisted use case and planned launch jurisdictions.
2. Confirm the production AVS template is approved and configured as an OVER-18 check using the methods Yoti/compliance require for the target jurisdictions.
3. Obtain the production API key, SDK ID, template ID, and correct notification-signature public key.
4. Configure HTTPS return/cancel URLs and the production notification URL.
5. Store all provider credentials and keys only in Render environment variables; never commit them.
6. Test valid over-18 completion, under-18/fail behavior, retries, expiry, cancellation, tampered signatures, duplicate notifications, stale notifications, and provider outages.
7. Confirm Adult Mode remains inaccessible until the normalized server-side status is verified and unexpired.
8. Decide and document the production re-verification interval for the jurisdictions being served.
9. Only after those checks pass, set the three Yoti verification attestations to true.
10. Include Yoti verification costs and jurisdiction-specific compliance costs in the final launch-cost model.

Never bypass the hard age gate with a birth-date checkbox, self-attestation, client-side flag, or hard-coded green launch status.
