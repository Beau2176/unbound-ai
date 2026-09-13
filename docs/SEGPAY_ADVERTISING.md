# UNBOUND AI — Segpay Advertising Checkout

Status: **code-ready, externally disabled by default**.

UNBOUND AI uses a separate Segpay advertising adapter for one-time advertiser purchases. It deliberately does not reuse the TOP subscription checkout lifecycle.

## Why a separate adapter exists

UNBOUND subscriptions are recurring membership billing. Advertising packages are one-time purchases for a defined placement period. Segpay supports One Time price points and signed hosted-pay-page requests, but the Merchant Portal/pay page must be configured for that use case before UNBOUND can truthfully enable checkout.

Official Segpay references reviewed for this implementation:

- Hosted Pay Page Signed Requests: https://gethelp.segpay.com/docs/Content/GatewayDocs/HostedPP-SignedRequests.htm
- Price Points: https://gethelp.segpay.com/docs/Content/GettingStarted/GS-MP-Setup03.htm
- Transaction Postback Matrix: https://gethelp.segpay.com/docs/Content/DeveloperDocs/ProcessingAPI/Postbacks-TransactionMatrix.htm
- Postback Parameters: https://gethelp.segpay.com/docs/Content/DeveloperDocs/ProcessingAPI/07-PostbackParameters.htm

## Required environment configuration

Advertising checkout stays disabled until all of these are present and verified:

```text
ADVERTISING_PAYMENT_PROVIDER=segpay
SEGPAY_ADVERTISING_PAY_PAGE_REF=<Segpay advertising pay-page reference>
SEGPAY_ADVERTISING_SIGNING_KEY=<Segpay signing key>
SEGPAY_ADVERTISING_POSTBACK_USERNAME=<Basic-auth username>
SEGPAY_ADVERTISING_POSTBACK_PASSWORD=<Basic-auth password>
SEGPAY_ADVERTISING_CURRENCY=USD
SEGPAY_ADVERTISING_MERCHANT_APPROVAL_VERIFIED=true
SEGPAY_ADVERTISING_ONE_TIME_PRICING_VERIFIED=true
SEGPAY_ADVERTISING_SIGNED_FIELDS_VERIFIED=true
SEGPAY_ADVERTISING_POSTBACK_AUTH_VERIFIED=true
```

Do not commit live values. `SEGPAY_ADVERTISING_*` settings are intentionally separate from subscription `SEGPAY_*` settings.

## Merchant/Segpay setup required before enabling

1. Segpay must explicitly approve UNBOUND's merchant account/business model for the advertising product.
2. Create or approve a Segpay pay page / price-point arrangement that supports UNBOUND's one-time advertising charges.
3. Confirm with Segpay Merchant Services that the `amount` field is enforced as a signed field.
4. Confirm REF1 and REF2 are accepted and protected for UNBOUND's opaque order correlation value.
5. Configure the advertising postback to use HTTPS and Basic authentication.
6. Configure the advertising postback as **POST** for the current production route. The adapter understands query parameters for contract/future compatibility, but the current production route receives Segpay advertising events as POST bodies.
7. Test all current packages in Segpay's approved test environment before turning on real purchases.

## Current package amounts

UNBOUND's current code defaults are:

- Starter — $25 / 7 days
- Monthly — $75 / 30 days
- Featured — $150 / 30 days

The adapter does not hard-code those prices. It signs the amount selected by the server-side UNBOUND advertising catalog. The Segpay advertising currency must match the catalog currency; the intended launch value is USD.

## Checkout integrity

For each purchase UNBOUND generates a random 64-character opaque subject. The adapter:

- splits that subject into signed `REF1` and `REF2` fields;
- signs the exact charge amount in the hosted-pay-page JWT;
- uses a unique JWT `jti` and a 30-minute expiry;
- never puts the advertiser's UNBOUND order ID into the external checkout reference;
- requires explicit advertising-provider configuration rather than inheriting subscription billing automatically.

## Postback lifecycle mapping

UNBOUND maps Segpay transaction postbacks to the advertising payment states used by the public placement gate:

- approved `Sale / Auth` -> `paid`
- declined `Sale / Auth` -> `failed`
- `Sale / Void` -> `canceled`
- `Credit`, `Charge`, `Revoke`, or `RDRreversal` -> `refunded`
- `CBReversal` -> `paid` (funds returned to merchant)

Public advertiser cards require both `payment_status='paid'` and `review_status='approved'`. A refund/chargeback therefore removes the placement from the paid-publication condition without requiring manual intervention.

## Launch checklist

Do not set the verification flags from assumptions. Before advertising checkout is enabled in production:

- [ ] Segpay confirms UNBOUND advertising purchases are allowed under the merchant account.
- [ ] Advertising one-time/dynamic pricing configuration is created and tested.
- [ ] Signed amount + REF1/REF2 configuration is confirmed.
- [ ] Authenticated POST postback is configured to `/api/webhooks/advertising`.
- [ ] Starter, Monthly, and Featured test transactions complete with the expected amounts.
- [ ] Declined payment does not publish an ad.
- [ ] Refund/void/chargeback test removes paid eligibility.
- [ ] Duplicate and stale postbacks remain idempotent.
- [ ] Successful payment still requires the v0.83 advertising-policy review before publication.

Merging v0.84 alone must not be treated as proof that Segpay has approved or activated advertising checkout.
