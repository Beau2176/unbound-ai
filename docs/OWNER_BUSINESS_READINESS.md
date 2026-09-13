# UNBOUND AI Owner / Business Readiness

UNBOUND AI keeps owner/business approvals separate from the engineering launch gate.

The engineering gate answers whether the product's encoded technical launch requirements are ready. The owner/business gate answers whether selected external commercial approvals have actually been verified and recorded.

## Administrator endpoint and dashboard

Authenticated administrators can inspect:

- `/launch-readiness.html` — shows engineering and owner/business percentages separately.
- `GET /api/admin/ops/owner-readiness` — owner/business readiness JSON.

The owner/business API never returns bank account numbers, provider secrets, processor credentials, or private application documents.

## Fail-closed verification

Every owner/business check starts blocked. A check passes only when:

1. its explicit verification flag is true; and
2. its corresponding ISO-8601 review timestamp is present, valid, and not materially in the future.

A flag by itself is not proof. Code integration by itself is not provider approval.

## Verification variables

### Business banking approval

- `UNBOUND_BANKING_APPROVED=true`
- `UNBOUND_BANKING_REVIEWED_AT=<ISO-8601 timestamp>`

Set these only after a bank has approved UNBOUND's actual business model and intended account use.

### Banking and settlement rails

- `UNBOUND_BANKING_RAILS_VERIFIED=true`
- `UNBOUND_BANKING_RAILS_REVIEWED_AT=<ISO-8601 timestamp>`

Set these only after the approved account's intended settlement and normal business-payment paths have been verified.

### Segpay merchant approval

- `UNBOUND_SEGPAY_MERCHANT_APPROVED=true`
- `UNBOUND_SEGPAY_MERCHANT_REVIEWED_AT=<ISO-8601 timestamp>`

Set these only after Segpay has approved the actual UNBOUND business and intended commercial billing model. An implemented adapter is not merchant approval.

### Advertising revenue channel

- `UNBOUND_ADVERTISING_CHANNEL_CONFIRMED=true`
- `UNBOUND_ADVERTISING_CHANNEL_REVIEWED_AT=<ISO-8601 timestamp>`

Set these after at least one real advertiser, direct-sales path, or ad-network relationship has been confirmed for UNBOUND's actual business model.

### Final launch legal review

- `UNBOUND_LEGAL_COUNSEL_REVIEW_COMPLETE=true`
- `UNBOUND_LEGAL_COUNSEL_REVIEWED_AT=<ISO-8601 timestamp>`

Set these only after the actual launch configuration has received the intended final legal review covering the product, policies, age-verification approach, billing, advertising, and material data flows.

## What the percentage means

The owner/business percentage is simply verified checks divided by total owner/business checks. It is not combined with the engineering percentage.

A green owner/business result is an internal record that the configured verification flags and timestamps are present. It is not a representation that UNBOUND AI, its software, or this dashboard granted bank approval, processor approval, legal clearance, or regulatory certification.
