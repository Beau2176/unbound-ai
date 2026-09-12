# UNBOUND AI launch economics worksheet

Status: **working launch-planning document — not a pricing decision**

Last verified: 2026-09-12

This worksheet turns the remaining external launch blockers into concrete cost categories and formulas. It deliberately does **not** choose a production customer subscription price, promise a provider fee, or mark any external readiness gate green.

The live application currently uses `FREE` and `TOP` product tiers. `SEGPAY_TOP_AMOUNT` has no default in code and must remain unset until the commercial price is deliberately chosen and approved through the real Segpay setup.

## 1. Known minimum infrastructure cost

Current live state observed through Render on 2026-09-12:

- `unbound-ai-app` web service: Render Free plan.
- `unbound-ai-db`: Render Free Postgres, which is not acceptable as durable commercial production storage.
- Render service health-check path is currently blank and still needs to be configured to `/healthz` (or another deliberately selected health endpoint) in Render.

Current published Render entry paid compute:

| Component | Production-planning floor | Notes |
| --- | ---: | --- |
| Always-on web service (`0.5c-512mb`, legacy Starter) | $7/month | 0.5 CPU, 512 MB RAM. This is a cost floor, not a load-capacity recommendation. |
| Postgres compute (`0.1c-256mb`, legacy Basic-256mb) | $6/month | 256 MB RAM, up to 100 connections. This is a cost floor, not a capacity recommendation. |
| Postgres storage | $0.30/GB/month | Add actual provisioned storage. |
| Bandwidth above included allowance | current Render metered rate | Validate against the workspace/plan selected at launch. |

**Known Render compute floor: $13/month plus database storage and any metered overages.**

Sources checked:

- https://render.com/pricing
- https://render.com/docs/compute-plans

Issue links: #25 infrastructure, #29 backup/restore.

## 2. OpenAI API operating cost

The current application default model is `gpt-5.6-luna` unless `OPENAI_MODEL` or `AI_MODEL` overrides it.

Current published standard token pricing for GPT-5.6 Luna:

- Input: **$0.20 per 1M tokens**
- Cached input: **$0.02 per 1M tokens**
- Output: **$1.20 per 1M tokens**
- General web-search tool: **$10 per 1,000 web runs**, plus search-content tokens billed at the model rate.

Monthly AI cost formula for the current default model:

```text
AI cost =
  (uncached input tokens / 1,000,000 × $0.20)
+ (cached input tokens / 1,000,000 × $0.02)
+ (output tokens / 1,000,000 × $1.20)
+ (web search runs / 1,000 × $10)
+ any other enabled tool charges
```

Do not hard-code these rates into customer pricing. The repository already has environment-driven usage/cost metering so current provider prices can be reviewed separately from product entitlements.

Sources checked:

- https://developers.openai.com/api/docs/models/gpt-5.6-luna
- https://openai.com/api/

## 3. Amazon SES transactional email

Amazon SES is the production-target account email provider, but production sending remains disabled until the domain/sender, DNS authentication, production access, credentials, and live delivery test are verified.

Current published sending options include:

- À-la-carte outbound email: **$0.10 per 1,000 emails**, plus applicable data/add-on charges.
- SES Essentials, first 10M emails/month: **$0.16 per 1,000 emails**. New qualifying SES account/region combinations may start on Essentials but can switch to à-la-carte pricing.

At UNBOUND's expected early transactional volume, message-send cost itself should be small compared with infrastructure, billing, age verification, legal/compliance, and AI usage. The final worksheet still needs the actual AWS region/account plan and domain/DNS costs.

Source checked:

- https://aws.amazon.com/ses/pricing/

Issue link: #30.

## 4. Segpay commercial billing

Segpay is the production-target processor, but exact processing economics are **quote-dependent** and must not be invented.

Current official Segpay material states:

- Processing fees vary by merchant business model and volume and require a merchant quote.
- For high-risk merchants, including adult businesses, Segpay's published FAQ lists annual card-brand registration fees of **$950 Visa + $500 Mastercard**.
- Segpay states it takes a **5% six-month rolling reserve** for relevant merchant accounts; its current merchant documentation describes reserves as being withheld during the first six months and released through later payouts.
- The Merchant Portal exposes the account's actual settle fee, authorization fee, decline fee, refund fee, chargeback fee, reserve rate, reserve period, and payout delay after onboarding.

Known potential annual card-brand registration total if those high-risk fees apply:

```text
$950 + $500 = $1,450/year
```

Do **not** treat $1,450 as the complete Segpay cost. Add the actual quoted settle/transaction fees, chargeback/refund/decline fees, reserve cash-flow effect, and payout timing after the merchant account is approved.

Sources checked:

- https://segpay.com/csfaq/
- https://gethelp.segpay.com/docs/Content/MPDocs/MP-ViewEditMerchantInfo.htm
- https://gethelp.segpay.com/docs/Content/MPDocs/FinancialDetails/MP-FinancialDetails-Report-Reserves.htm

Issue link: #48.

## 5. Yoti hard 18+ age verification

Yoti AVS is the production-target hard age-verification provider. The production adapter is live in code but disabled pending onboarding, approved OVER-18 template, non-biometric fallback verification, keys, notification-signature setup, jurisdiction review, and real tests.

**No fixed production AVS per-check rate is assumed in this worksheet.** Current Yoti developer material directs customers to contact Yoti for pricing for certain US partner checks, and public materials do not provide one universal production AVS price that is safe to use for UNBOUND's launch model.

Required cost inputs after onboarding:

- Minimum monthly/account commitment, if any.
- Per-check price by enabled verification method.
- Jurisdiction-specific partner/check fees.
- Re-verification frequency and resulting checks per active adult user.
- Any setup/onboarding or compliance-review fees.

Sources checked:

- https://developers.yoti.com/age-verification/us-partner
- https://developers.yoti.com/age-verification/credit-card

Issue link: #27.

## 6. Legal/compliance and business setup

No legal budget should be invented before the operator/entity and launch jurisdictions are finalized. Obtain real quotes for:

- Entity/business formation or maintenance, if still required.
- Qualified Terms/Privacy/adult-platform legal review.
- State/country-specific age-assurance and adult-content compliance review.
- Privacy/data-protection advice and required registrations/notices.
- Trademark/IP review if desired.
- Accounting/tax setup.
- Domain/registrar and DNS costs.

The provider-aware draft Terms/Privacy package in v0.61 is review preparation only and does not replace professional review.

Issue link: #28.

## 7. Known published launch-cost floor vs unknowns

The currently known published cost floor is intentionally narrow:

```text
Known recurring infrastructure compute floor:
  Render web       $7/month
  Render Postgres  $6/month
  -------------------------
  subtotal         $13/month

Known potential annual high-risk card-brand registration if applicable:
  Visa             $950/year
  Mastercard       $500/year
  -------------------------
  subtotal         $1,450/year
```

Everything below remains variable or quote-dependent and must be added before a real commercial-launch budget is approved:

- Render database storage, bandwidth, and any larger production compute selected after load testing.
- OpenAI token/tool usage.
- Amazon SES usage, DNS/domain, and optional deliverability features.
- Segpay merchant-specific processing/settlement/chargeback/refund/decline fees and reserve cash flow.
- Yoti AVS onboarding and per-check costs.
- Legal/compliance/accounting/business costs.
- Taxes, refunds, fraud, chargebacks, customer support, and contingency reserve.

## 8. Revenue and break-even formulas — without choosing a price

Let:

- `P` = TOP monthly customer price, intentionally undecided.
- `N` = number of paying TOP subscribers.
- `R` = gross monthly subscription revenue = `P × N`.
- `B` = Segpay percentage-based processing/settlement rate after the real quote.
- `F` = Segpay fixed per-transaction fees and expected decline/refund/chargeback costs.
- `Y` = monthly Yoti cost.
- `A` = monthly OpenAI cost.
- `E` = monthly email/domain cost.
- `I` = monthly infrastructure cost.
- `L` = monthly-equivalent legal/compliance/business overhead.
- `O` = all other monthly operating costs.

Then:

```text
Net contribution before tax =
  (P × N)
- ((P × N) × B)
- F
- Y
- A
- E
- I
- L
- O
```

Do not set `SEGPAY_TOP_AMOUNT` until `P` is deliberately chosen from actual provider economics and market strategy.

## 9. External launch decision register

| Blocker | What is already complete | What must happen before enabling | Cost input needed |
| --- | --- | --- | --- |
| #25 Render infrastructure | App/deployment/readiness code | Move off Free web + expiring Free DB; configure `/healthz`; verify production profile | Final web/DB/storage/bandwidth selection |
| #29 DB recovery | Backup scripts/runbooks/readiness | Real durable backup + isolated restore drill | Managed backup/storage or external backup cost |
| #30 SES | Adapter, verification flow, readiness gate | Domain/sender/DNS, production access, credentials, live delivery | SES plan + domain/DNS |
| #48 Segpay | Adapter, checkout, authenticated lifecycle postbacks | Merchant approval, final price, signed fields, real payments | Merchant quote + reserve + card-brand fees |
| #27 Yoti | Adapter, signed notifications, hard gate | Provider approval, template/keys, sandbox + production checks | Yoti quote by method/jurisdiction |
| #28 Legal | Provider-aware draft package and enforcement gate | Operator/jurisdictions/business terms + qualified review + final publication | Actual professional/legal/business quotes |

## 10. Rules for future updates

1. Use current official provider pricing or an actual account quote; do not guess.
2. Record the date each price/quote was verified.
3. Keep one-time, annual, monthly, usage-based, and cash-reserve costs separate.
4. A reserve is a cash-flow requirement, not the same thing as a permanent processing expense.
5. Do not turn launch-readiness flags green merely because a projected cost is affordable.
6. Do not commit provider credentials, quotes containing confidential merchant details, bank information, or secrets to the public repository.
7. Do not convert historical planning prices into the production TOP price without an explicit business decision.
