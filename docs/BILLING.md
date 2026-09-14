# UNBOUND AI commercial billing

UNBOUND AI uses a provider-neutral billing gateway. The production target selected for the adults-only commercial product is **Segpay**, subject to Segpay underwriting and approval of the actual UNBOUND AI business, content, policies, and launch configuration.

Selecting Segpay in code does not create a Segpay merchant account, approve UNBOUND AI for processing, or turn commercial billing on by itself.

## Why Segpay

The product includes an adults-only mode, so a mainstream processor that prohibits adult services or AI-generated adult content is not an appropriate launch dependency. Segpay publishes adult-merchant compliance guidance, supports recurring subscription businesses, provides hosted payment pages, lifecycle postbacks, and a consumer self-service portal, and discusses underwriting AI-driven adult-content businesses.

External provider approval remains mandatory. The code must never treat technical credentials as evidence that Segpay approved UNBOUND AI.

## Production configuration

Set `BILLING_PROVIDER=segpay` only after the merchant setup is ready.

Required Segpay values:

- `SEGPAY_PAY_PAGE_REF` — hosted pay-page reference configured for the UNBOUND AI TOP subscription.
- `SEGPAY_SIGNING_KEY` — hosted-pay-page HS256 signing key issued by Segpay Merchant Services. Use the string exactly as issued; do not base64-decode it before HMAC signing.
- `SEGPAY_TOP_AMOUNT` — TOP-plan recurring amount in the pay-page's configured currency. No price is hard-coded in the repository.
- `SEGPAY_POSTBACK_USERNAME`
- `SEGPAY_POSTBACK_PASSWORD`
- `SEGPAY_MERCHANT_APPROVAL_VERIFIED=true` — set only after Segpay has actually approved the intended UNBOUND AI business model for production processing.
- `SEGPAY_SIGNED_CHECKOUT_FIELDS_VERIFIED=true` — set only after Merchant Services has confirmed Require Signing for `amount`, `REF1`, and `REF2` on the production pay page.
- `SEGPAY_POSTBACK_AUTH_VERIFIED=true` — set only after the production postback configuration has been tested with the configured Basic Auth credentials.

UNBOUND AI should also keep `BILLING_SUBJECT_SECRET` outside the repository. Existing billing success/cancel URL settings remain provider-neutral.

The Segpay adapter intentionally reports `configured: false` until every required value and verification attestation above is present.

## Checkout security

Checkout uses Segpay's signed hosted-pay-page flow:

- HS256 JWT.
- Maximum 30-minute token lifetime.
- Unique `jti` for each checkout.
- The Segpay signing key is used literally as issued.
- `amount` is signed.
- The opaque UNBOUND billing subject is split into `REF1` and `REF2`, each no longer than 32 characters, and signed.
- Account email is not embedded in the checkout JWT or checkout URL.
- The checkout URL uses `https://pay.segpay.com/<pageref>?jwt=...`.

The billing subject is already an HMAC-derived opaque server identifier. It is not a user ID, email address, or session token.

## Postbacks

Production postback endpoint:

`/api/webhooks/billing`

UNBOUND accepts both GET and POST for this endpoint because Segpay documents both transport forms. POST bodies remain raw for provider verification/parsing; GET query values are passed through the same authenticated normalization path.

Configure Segpay postbacks with HTTPS and the Basic Auth username/password stored in Render. The adapter performs a timing-safe comparison of the `Authorization` header before parsing the payload.

For custom postback URLs, include the fields needed by the lifecycle parser. At minimum, configure the relevant placeholders for:

- `action`
- `purchaseid`
- `tranid` where available
- `stage`
- `approved`
- `trantype`
- `paymentaccountid` where available
- `transtime` where available
- `rint` where available
- `ref1=<REF1>`
- `ref2=<REF2>`

The two merchant-reference fields originate in the signed checkout request and are used to reconnect lifecycle events to the existing server-side subscription record. Confirm the exact Segpay postback placeholder names with Merchant Services during production setup, then verify that the received parameters normalize to `ref1` and `ref2` before enabling the production attestation.

Successful billing webhook acknowledgements return plain text `OK`. This is compatible with Segpay member-management postbacks that require a configured expected response, while transaction postbacks also receive a normal 2xx HTTP status.

Normalized lifecycle mapping includes:

- approved initial/rebill sale -> `active`
- declined initial -> `incomplete`
- declined conversion/rebill -> `past_due`
- cancellation request -> keep `active` with `cancelAtPeriodEnd=true`
- disable/expiry -> `canceled`
- refund/chargeback/revoke/void -> `canceled`
- reactivation -> `active`

Provider event identifiers are deterministic so Segpay retries remain idempotent in the existing billing-webhook event table.

## Customer portal

Subscription-management handoff uses Segpay's consumer self-service portal:

`https://cs.segpay.com/`

UNBOUND does not place provider customer IDs, account emails, card data, or billing secrets in the returned portal URL.

## Remaining external launch work

The adapter is code, not provider approval. Before billing can truthfully pass commercial launch readiness:

1. Apply to Segpay and obtain explicit production approval for UNBOUND AI's actual adults-only/AI business model.
2. Complete Segpay/card-brand compliance requirements for the approved site and content model.
3. Create the TOP recurring price/package and hosted pay page.
4. Have Merchant Services enable/verify signed `amount`, `REF1`, and `REF2`.
5. Configure authenticated transaction/member-management postbacks and test GET/POST delivery as applicable, including the `REF1`/`REF2` round trip.
6. Set the production price and secrets only in Render environment variables.
7. Run real checkout, rebill, cancellation, disable/expiry, refund/chargeback, reactivation, portal, retry/idempotency, and failure tests.
8. Only then set the three Segpay verification attestations to true.

Never commit Segpay signing keys, postback passwords, cardholder data, or merchant credentials. UNBOUND must not collect or store card numbers or CVV data.
