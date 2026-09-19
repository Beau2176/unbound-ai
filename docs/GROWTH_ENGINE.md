# UNBOUND AI growth engine — Years 1–5

This is the internal growth plan for UNBOUND AI under UNBOUND FORGEWORKS LLC. It is separate from the conservative lender forecast.

## Target paid-customer path

- Year 1: 250
- Year 2: 1,000
- Year 3: 3,000
- Year 4: 7,500
- Year 5: 15,000

These are operating targets, not guarantees.

## First growth loop

The first implementation focuses on measurement and referrals because every later marketing decision depends on knowing where paying customers came from.

The growth engine records privacy-minimized first-party events for:

- feature landing-page views;
- account registration;
- paid checkout starts;
- paid subscription activation;
- paid subscription churn;
- referral-link views;
- referral-driven registrations.

It also captures first-touch acquisition fields supplied by the browser:

- source;
- medium;
- campaign;
- content;
- referral code;
- creator/affiliate attribution code;
- landing path.

Do not put email addresses, prompts, chat content, payment details, ID data, or other sensitive user content into growth metadata.

## Referral foundation

Every registered account receives an opaque referral code. The account referral endpoint returns the shareable link and the number of registered accounts attributed to that user.

This version tracks attribution only. It does not promise cash, free months, credits, commissions, or any other reward. A reward or affiliate-payout program must be separately defined, costed, and reviewed before the UI advertises one.

## Feature landing pages

The growth branch now exposes public conversion-focused landing pages for Work Mode, Research Mode, Voice Conversation, File Analysis, Image Tools, Bounded Agents, and Privacy & Control. Their calls to action carry the originating feature path and campaign/partner attribution into account registration.

Landing-page views are aggregate request counts, not unique-user counts. They are directional funnel data and should not be presented as unique visitors.

## Creator / affiliate attribution

Administrators can create, pause, reactivate, and copy creator/affiliate attribution links. A valid active partner code is attached to a new account only at first registration. No payout, reward, commission balance, or contractual entitlement is created by the tracking code itself.

## Year-1 operating KPIs

- End Year 1 with 250 paying subscribers.
- Free-to-paid conversion: 4% or better.
- Monthly paid churn: no worse than 6%.
- Annual-plan adoption: 15% or better once annual billing is live.
- New paid customers from referrals: target 10%.
- New paid customers from creators/affiliates: target 20%.
- Blended CAC ceiling: $80.
- Activation: target 35% or better.

## Next implementation waves

1. Add activation-event measurement so the funnel can distinguish account creation from meaningful first use.
2. Add cancellation-reason capture and permission-aware win-back flows.
3. Add annual billing offers once billing-provider support and pricing terms are finalized.
4. Add cohort retention reporting by acquisition source, campaign, and partner.
5. Add creator/affiliate economics only after payout terms, fraud controls, and unit economics are approved.
6. Add SEO content and additional programmatic landing pages.
7. Add pricing/offer experiments with explicit experiment IDs and guardrails.
8. Begin the B2B pilot funnel in Year 2.

The rule is to scale only channels that show acceptable retention and lifetime value. Do not buy growth blindly.
