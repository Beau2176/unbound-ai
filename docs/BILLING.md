# UNBOUND AI commercial billing

UNBOUND AI has three customer tiers:

- **Tier 1 — Free:** $0/month.
- **Tier 2 — Premium:** **$59.99/month**.
- **Tier 3 — Ultra:** **$114.99/month**.

Adult Mode is **Ultra-only** and payment never bypasses the separate hard 18+ verification gate.

UNBOUND uses a provider-neutral billing gateway. The production target is **Segpay**, subject to Segpay underwriting and approval of the actual UNBOUND AI business, content, policies, and launch configuration. Selecting Segpay in code does not create a merchant account, approve UNBOUND for processing, or turn billing on by itself.

## Tier boundaries

Premium adds the paid productivity/understanding layer above Free, including web research, citations, file analysis, image understanding, voice, and user-controlled Memory.

Ultra includes Premium and adds the advanced tool layer, including image generation/editing, agents, scheduled monitoring, multi-model routing, connected apps, Command Center, and verified-18+ Adult Mode.

Legacy internal/database plan value `top` is accepted only as a backwards-compatibility alias for **Ultra**. New checkout and entitlement responses use `premium` or `ultra`.

## Production Segpay configuration

Set `BILLING_PROVIDER=segpay` only after the merchant setup is ready.

Required values:

- `SEGPAY_PREMIUM_PAY_PAGE_REF` — hosted pay page for the **$59.99 Premium** recurring package.
- `SEGPAY_ULTRA_PAY_PAGE_REF` — hosted pay page for the **$114.99 Ultra** recurring package. `SEGPAY_PAY_PAGE_REF` remains a temporary backwards-compatible Ultra alias during migration.
- `SEGPAY_SIGNING_KEY` — hosted-pay-page HS256 signing key issued by Segpay Merchant Services. Use the string exactly as issued.
- `SEGPAY_POSTBACK_USERNAME`
- `SEGPAY_POSTBACK_PASSWORD`
- `SEGPAY_MERCHANT_APPROVAL_VERIFIED=true` — only after Segpay actually approves the intended UNBOUND business model.
- `SEGPAY_SIGNED_CHECKOUT_FIELDS_VERIFIED=true` — only after Merchant Services confirms Require Signing for `amount`, `REF1`, and `REF2` on both production pay pages.
- `SEGPAY_POSTBACK_AUTH_VERIFIED=true` — only after production postback authentication is tested.

The exact prices are enforced server-side in the adapter:

- Premium: `59.99`
- Ultra: `114.99`

The browser cannot choose an arbitrary price. Both paid pay-page references plus shared credentials/attestations must be present before the Segpay adapter reports fully configured.

Keep `BILLING_SUBJECT_SECRET`, signing keys, and postback passwords outside the repository.

## Checkout security

Checkout uses Segpay's signed hosted-pay-page flow:

- HS256 JWT.
- Maximum 30-minute token lifetime.
- Unique `jti` for each checkout.
- Exact server-selected plan amount is signed.
- The opaque UNBOUND billing subject is split into signed `REF1` and `REF2` values, each no longer than 32 characters.
- Account email is not embedded in the checkout JWT or checkout URL.
- Checkout uses `https://pay.segpay.com/<pageref>?jwt=...`.

The billing subject is an HMAC-derived opaque server identifier; it is not a user ID, email, or session token.

A customer with an already active/trialing paid subscription is not allowed to start a second direct checkout merely to change plan access. They are sent to **Manage Billing** so UNBOUND does not change entitlement before the billing provider confirms the plan change.

## Postbacks

Production endpoint:

`/api/webhooks/billing`

UNBOUND accepts authenticated GET and POST delivery. Configure the relevant Segpay placeholders for:

- `action`
- `purchaseid`
- `tranid` where available
- `stage`
- `approved`
- `trantype`
- `amount` (or the confirmed Segpay transaction-amount field)
- `paymentaccountid` where available
- `transtime` where available
- `rint` where available
- `ref1=<REF1>`
- `ref2=<REF2>`

For sale/rebill events where a trustworthy amount is present, UNBOUND maps `59.99 -> premium` and `114.99 -> ultra`. Lifecycle events such as cancel/disable/reactivate that do not contain a reliable plan amount return no new plan value; the database keeps the existing tier rather than guessing or accidentally upgrading a customer.

Successful webhook acknowledgements return plain text `OK`. Authentication is timing-safe and provider retries remain idempotent through deterministic event identifiers.

Lifecycle mapping includes:

- approved initial/rebill sale -> `active`
- declined initial -> `incomplete`
- declined conversion/rebill -> `past_due`
- cancellation request -> keep `active` with `cancelAtPeriodEnd=true`
- disable/expiry -> `canceled`
- refund/chargeback/revoke/void -> `canceled`
- reactivation -> `active`

## Customer portal

Subscription management hands off to Segpay's consumer self-service portal at `https://cs.segpay.com/`. UNBOUND does not put provider customer IDs, account emails, card data, or billing secrets in the returned portal URL.

## Remaining external launch work

The code does not equal provider approval. Before live paid launch:

1. Obtain explicit Segpay approval for UNBOUND's actual AI/adults-only business model.
2. Complete Segpay/card-brand compliance requirements.
3. Create **two recurring packages/pay pages**: Premium $59.99 and Ultra $114.99.
4. Confirm signed `amount`, `REF1`, and `REF2` on both packages.
5. Configure authenticated transaction/member-management postbacks and verify the `REF1`/`REF2` round trip.
6. Verify initial Premium sale, initial Ultra sale, recurring billing, cancellation, disable/expiry, refund/chargeback, reactivation, and failure paths.
7. Verify provider-supported Premium↔Ultra subscription changes before enabling an in-app direct plan-change workflow.
8. Only then set the three Segpay production attestations to true.

Never commit Segpay signing keys, postback passwords, cardholder data, or merchant credentials. UNBOUND must not collect or store card numbers or CVV data.
