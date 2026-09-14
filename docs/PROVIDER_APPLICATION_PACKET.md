# UNBOUND AI bank, provider, and counsel preparation packet

This document is a preparation aid for truthful eligibility/onboarding conversations. It is not an application submission, approval, legal advice, or authorization to spend money.

## Standard business description

Use a description consistent with the actual product:

> UNBOUND AI is an adults-only (18+) AI/SaaS platform. It provides general AI assistance plus mature-content features for verified adults. The service uses a hard age-verification provider before adults-only access, prohibits minors and exploitative, non-consensual, unlawful, fraudulent, malware, trafficking, and other prohibited content, uses hosted third-party payment processing rather than storing card numbers/CVV, and minimizes identity/provider data retained by UNBOUND. AI answers and paid advertising are kept separate. Provider approvals and production readiness are tracked explicitly rather than inferred from software configuration.

Do not describe UNBOUND as a generic software company if a reviewer asks about the adults-only features. Do not claim a provider, bank, or lawyer approved UNBOUND until that approval actually exists.

## Business-bank pre-application questions

Ask a business banker/compliance reviewer **before submitting an application**:

1. Will the bank open and maintain a business deposit account for an 18+ AI/SaaS platform with mature-content features and hard age verification?
2. Is this model prohibited, restricted/manual-review, or acceptable under current policy?
3. Can the account receive ACH settlements from an approved high-risk/adult-compatible processor such as Segpay?
4. Can it receive ACH or wire payments from advertising networks/sponsors whose businesses are otherwise lawful?
5. Are outgoing ACH, domestic wires, business debit-card payments, and vendor payments supported?
6. Are there special reserves, holds, transaction limits, enhanced due-diligence reviews, or notice requirements for this business category?
7. How are chargeback/reserve-related debits or processor adjustments handled?
8. What are the real monthly, ACH, incoming/outgoing wire, cash, and excess-transaction fees?
9. Is the deposit account FDIC insured, and what entity/account titling documentation is required?
10. Can the bank provide written eligibility confirmation or a compliance case/reference number before the account is funded?

Record the date, reviewer/channel, outcome, restrictions, case/reference number, and any documents requested. Do not set `UNBOUND_BANKING_APPROVED` or `UNBOUND_BANKING_RAILS_VERIFIED` until the real account and rails are verified.

## Segpay underwriting/setup packet

### Product facts to provide

- adults-only AI/SaaS service with an enforced hard 18+ gateway for adult features;
- prohibited-minor/exploitation/non-consensual/unlawful-content rules;
- hosted Segpay checkout; UNBOUND does not collect/store card numbers or CVV;
- recurring TOP subscription is the intended first commercial billing product;
- customer self-service uses Segpay's HTTPS consumer portal;
- UNBOUND uses opaque merchant references rather than account email/user ID in checkout correlation;
- authenticated postbacks drive subscription lifecycle state;
- separate advertising checkout, if activated later, remains a distinct one-time flow.

### Questions/confirmations to obtain

1. Written approval for UNBOUND's actual adults-only/AI-assisted product and launch content model.
2. Required card-brand/site compliance items before production processing.
3. Approved recurring TOP price/package and hosted pay-page reference.
4. Confirmation that Require Signing is enabled for `amount`, `REF1`, and `REF2`.
5. Exact transaction and member-management postback configuration, including how `REF1` and `REF2` are returned.
6. Basic-auth requirements for production postbacks.
7. Supported test/sandbox method for initial sale, rebill, decline, cancellation, disable/expiry, reactivation, refund, chargeback/revoke/void, duplicate delivery, and portal handoff.
8. Fees, reserves, chargeback terms, settlement timing, and payout rails needed for the final economics model.

Do not put signing keys/postback passwords in this document. Do not set `SEGPAY_MERCHANT_APPROVAL_VERIFIED`, `SEGPAY_SIGNED_CHECKOUT_FIELDS_VERIFIED`, `SEGPAY_POSTBACK_AUTH_VERIFIED`, or the owner/business merchant-approval flag until the corresponding facts are verified.

## Yoti onboarding/setup packet

### Use-case description

UNBOUND needs hosted hard 18+ verification before enabling adults-only capabilities. UNBOUND's design intentionally avoids storing raw ID images, selfies, biometric templates, exact age, notification signatures, or Yoti secrets in account records. It stores normalized verification state, threshold/timestamps/result code, and a hashed provider session reference.

### Questions/confirmations to obtain

1. Is UNBOUND's adults-only AI/SaaS use case approved for the intended launch jurisdictions?
2. Which age-assurance methods are required for each launch jurisdiction?
3. Can the production AVS service/template be configured explicitly as OVER-18?
4. When biometric processing is offered, what approved non-biometric alternative must be provided?
5. What production API key, SDK ID, template ID, and notification-signature public key are required?
6. Confirm the production notification URL and RSA-PSS/SHA-256 signature requirements.
7. Confirm sandbox and production testing paths for success, fail/underage outcome, cancellation, expiry, duplicate/stale notification, tampered signature, and provider outage.
8. What re-verification interval is recommended/required by the applicable jurisdictions or contract terms?
9. What per-check/minimum/contract costs should be included in launch economics?

Do not set any `YOTI_*_VERIFIED` attestation until the actual corresponding check has passed.

## Amazon SES/domain preparation packet

Prepare these items without putting secrets in the repository:

- production sender domain/address;
- AWS region selection;
- DKIM records and verification plan;
- SPF alignment plan;
- deliberate DMARC policy and reporting destination;
- production-access request status if the selected region/account remains sandboxed;
- least-privilege IAM credential policy for sending verification mail only as required;
- bounce and complaint monitoring/handling plan;
- delivery-test matrix: initial send, resend, used token, expired token, invalid token, provider failure, new-account automatic send.

Do not mark `EMAIL_SENDER_IDENTITY_VERIFIED`, `EMAIL_PROVIDER_PRODUCTION_ACCESS_VERIFIED`, or `EMAIL_DELIVERY_REVIEWED_AT` complete until those real checks pass.

## Qualified legal/compliance review packet

Give counsel the current Terms/Privacy drafts, `docs/LEGAL_DATA_FLOW_REVIEW.md`, this packet, age-verification design, billing design, advertising policy, account deletion/export behavior, and launch-readiness controls.

Decisions/questions that must be resolved before final publication include:

- legal operator/entity, business address, support contact, and privacy contact;
- launch jurisdictions and any jurisdictions intentionally excluded;
- final subscription price, renewal cadence, cancellation, refund, trial/tax terms, and processor/card-brand disclosures;
- adult-content scope, age-assurance obligations, underage-account handling, and re-verification policy;
- retention schedules and deletion exceptions for billing/security/legal records;
- privacy-rights request mechanics and response timelines;
- provider/subprocessor disclosures, international-transfer language, and jurisdiction-specific notices;
- AI output/IP terms and user-content rights/licensing;
- acceptable-use restrictions and enforcement;
- advertising disclosures and separation from AI answers;
- governing law, venue/arbitration/class-action treatment if used;
- warranties, limitation of liability, indemnity, and dispute handling.

Keep the published pages marked draft/non-binding until qualified review is complete. The owner/business legal-review flag must reflect real review, not internal drafting.

## ClamAV deployment preparation packet

The production target is a private `clamd` service reachable only from UNBOUND's application network.

Before deployment, define:

- private host/service topology; never public port 3310 exposure;
- ClamAV `INSTREAM` maximum larger than UNBOUND's 8 MB upload maximum;
- connect/scan timeout policy;
- signature-update ownership and monitoring;
- health/availability alerting;
- restart and outage behavior;
- validation cases using ordinary clean files and the harmless EICAR antivirus test string/file only;
- staged `disabled` -> `best-effort` -> `required` rollout;
- evidence that confirmed malware and required-mode scanner failures block provider forwarding.

Do not use live malware for testing and do not claim production antivirus is active because the client code exists.

## Evidence record template

For each external dependency record:

- Dependency/provider:
- Date reviewed:
- Exact product/business description supplied:
- Reviewer/contact channel:
- Approval / decline / conditional status:
- Case/reference number:
- Conditions/restrictions:
- Fees/costs quoted:
- Credentials/secrets received: **record only where securely stored, never record the secret here**
- Test cases completed:
- Production readiness flags allowed to change:
- Remaining blocker:

This evidence is what justifies changing a readiness attestation later. The existence of code, credentials, or a verbal assumption is not enough.
