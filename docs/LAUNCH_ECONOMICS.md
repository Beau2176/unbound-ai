# UNBOUND AI launch economics worksheet

Status: **planning only; no purchase, price change or launch approval**

Reviewed: October 18, 2026 (America/Denver).

This worksheet applies to the full application at
https://unbound-ai-app.onrender.com/. The separate live fifteen-dollar Founders
Beta is outside this budget. Provider capacity, software integrations and a
successful health check do not establish commercial approval or free usage.

## Current product and infrastructure

The intended full-site launch plans are Premium $49.99, Ultra $129.99 and
Unlimited $299.99 per month. Max remains disabled for initial launch. These are
existing product decisions, not new prices or active Segpay packages.

Current evidence:

- Render's application and browser-worker services both remain Free, deploy from
  the existing `main` branch and have `/healthz` configured (verified October 18).
- Production PostgreSQL is on Neon. The expired Render database is not the
  current production database. The earlier $13 web-plus-Render-database estimate
  does not describe this deployment.
- The October 17 recovery checkpoint recorded Neon `free_v3`, a six-hour history
  window, a manual snapshot and an isolated restored copy. Recurring backups
  and actual-copy application startup/login are still unverified. The earlier
  DNS failure must not be mistaken for a completed recovery drill.
- SES sender settings are saved on the full-site backend. The required sending
  credentials are missing and `EMAIL_PROVIDER=none`; full-site email delivery
  has not been tested. No secret values belong in this document.

## Lowest-cost next steps

| Work | Incremental cost basis | Prerequisite / boundary |
| --- | --- | --- |
| Finish secure SES credential configuration | No sending fee for configuration alone | Owner-controlled Amazon access and narrowly scoped credentials; sending stays paused |
| Small owner-only SES delivery test | Below one cent in basic sending charges for three ordinary messages on the basic rates below | Verify account plan, free credits, add-ons and sender configuration; obtain a new test-spending authorization if free coverage is absent |
| Upgrade the main Render service only | Published entry compute is $7/month | This is recurring and covers one service; it does not complete production infrastructure readiness |
| Upgrade both existing Render services at entry compute | $14/month for two $7 services | Recurring compute only; database, backups, bandwidth, other services and taxes are separate |
| Improve Neon recovery coverage | Usage-based quote / estimate needed | Review actual compute, history, storage and backup choices before changing the account |
| Test the selected paid AI / speech provider | Model-specific estimate needed | Confirm the configured provider/model, account funding and explicit request limit before any live call |

A small email test is the cheapest metered validation task currently prepared.
Secure account access is its immediate blocker; buying hosting would not supply
those credentials. None of the amounts in this worksheet authorizes spending.

## Amazon SES rates and test calculation

Official pricing reviewed October 18:

- A-la-carte outbound: $0.10 per 1,000 messages; no minimum sending fee.
- Essentials, first volume band: $0.16 per 1,000 messages; no fixed monthly plan
  charge. Add-ons, message data and other AWS services can add charges.
- Three messages have a base sending cost of $0.00030 or $0.00048 respectively.

The actual account plan and remaining credits are unverified. AWS changed new
SES enrollment in July 2026; do not assume the older 3,000-message free allowance.
Check the account before sending. A sending quota is not a spending allowance.
Do not add Pro, Enterprise, dedicated IPs or deliverability packages for this test.

Sources:

- https://aws.amazon.com/ses/pricing/
- https://aws.amazon.com/blogs/messaging-and-targeting/introducing-amazon-simple-email-service-ses-pricing-plans/

The full-site handoff remains in `docs/EMAIL_VERIFICATION.md`. The saved From
address is `notifications@unboundforgeworks.com`, region `us-east-2`; live identity,
feedback/suppression configuration, approved use and delivery still need review.

## Hosting and database estimates

Render's entry paid web compute (`0.5c-512mb`, formerly Starter) is $7/month for
one 512 MB / 0.5 CPU service. Upgrading the two existing services at that size
would total $14/month in compute. This is a pricing floor, not a capacity test
or complete launch budget. Existing Free resources have not been upgraded.

Neon's current Launch list prices are $0.106 per CU-hour and $0.35 per GB-month
for database storage. Actual usage, restore history, branches, backup choices
and transfer must be estimated from the intended configuration. Do not reuse
an old fixed Render Postgres price as the current Neon cost.

Sources reviewed October 18:

- https://render.com/pricing
- https://render.com/docs/compute-plans
- https://render.com/articles/production-rails-hosting-guide
- https://neon.com/pricing

## AI, billing, verification and business costs

Use the actual provider/model and current official rates when estimating AI:

```text
AI cost = input tokens x input rate
        + cached input tokens x cached rate
        + output tokens x output rate
        + search/tool/media charges
```

The repository supports multiple providers. Old model defaults or token prices
are not evidence of the current deployment's bill. Configuration checks and
mock-provider tests do not establish live generation quality or free coverage.
Device Voice / Listen playback uses the selected operating-system voice without
calling UNBOUND's cloud speech endpoint; paid speech-provider acceptance is a
separate task.

Other inputs still require actual owner/provider decisions or quotes:

- Segpay approval, package configuration, transaction fees, any applicable card
  registration fees, refund/chargeback fees, payout timing and reserve terms.
- An approved bank's actual business-model eligibility and settlement rails.
- Yoti onboarding, enabled verification methods, fallback method, jurisdiction
  coverage and any account minimum or per-check charge.
- Qualified policy/compliance review, final jurisdictions and retention terms.
- Durable backups, private malware scanning and any signed-device/store costs.

A reserve affects available cash; it is not the same as a permanent processing
expense. Preserve the draft policy state and real launch blockers until their
underlying evidence is complete. Do not publish confidential quotes or account
information in this public repository.

## Break-even worksheet

For the existing three intended launch tiers:

```text
gross monthly revenue = 49.99 x Premium subscribers
                      + 129.99 x Ultra subscribers
                      + 299.99 x Unlimited subscribers

net contribution before tax = gross monthly revenue
                            - processing fees and expected refunds/chargebacks
                            - age verification
                            - AI, search and media usage
                            - email and domain costs
                            - compute, database and backups
                            - legal/accounting/support and other operating costs
```

Calculate with actual approved prices, actual provider quotes and representative
usage. No customer count, profit, launch date or guaranteed return is assumed.
Keep one-time, monthly, annual, usage-based and cash-reserve costs separate.
