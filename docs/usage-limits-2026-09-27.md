# UNBOUND AI usage policy — September 27, 2026

## Findings and evidence

Inspected main commit 379e55d36e0e53562810cd92a30dd00714e7e9f3, also confirmed as the live Render app deployment. Existing request safeguards largely used the same hourly ceilings for every account; feature entitlements differed, but allowances did not. Current canonical prices are Free $0, Premium $49.99, Ultra $129.99, and future Max $199.99. Prices and launch flags are unchanged.

Official competitor documentation checked September 27, 2026:

- ChatGPT: ordinary chat and expensive models/tools have distinct allowances; the current documentation lists 50 shared Pro-model messages weekly at $100 and 200 GPT-6 Pro messages weekly at $200. Work/Codex have separate allowances. https://help.openai.com/en/articles/20001354-gpt-56-and-gpt-6-pro-in-chatgpt
- Claude: Max offers 5x or 20x Pro session capacity, with five-hour session and weekly limits. https://support.claude.com/en/articles/11049741-what-is-the-max-plan
- Gemini: compute-based five-hour and weekly limits; higher plans multiply capacity, with costly features using more. https://support.google.com/gemini/answer/16275805?hl=en
- Perplexity's current help results describe advanced-model access limits in especially heavy weeks. No stable numeric allowance was independently established from the opened article, so no numeric quota was copied. https://www.perplexity.ai/help-center/en/articles/10352901-what-is-perplexity-pro

There is no single most-popular numerical cap, nor evidence that users prefer these restrictions. This is a representative comparison of major consumer assistants, not an exhaustive survey of every AI service. The design adopts common short-session plus weekly windows, feature-specific limits and greater paid-tier capacity. The numbers below are UNBOUND product decisions, not competitor averages or equivalent compute guarantees.

## Starting allowances

Each entry is **per five hours / per seven days**. Both apply. Each window begins on its first admitted request; it is not a sliding window or a calendar/billing week.

| Feature | Free | Premium | Ultra | Max (future) |
|---|---:|---:|---:|---:|
| Chat credits | 30 / 150 | 150 / 1,000 | 400 / 2,500 | 600 / 4,000 |
| Web research requests | — | 25 / 100 | 75 / 300 | 125 / 500 |
| File analysis | — | 30 / 150 | 75 / 375 | 120 / 600 |
| Document creation plans | — | 20 / 100 | 50 / 250 | 80 / 400 |
| Image analysis | — | 30 / 150 | 75 / 375 | 120 / 600 |
| Image generation/edits | — | — | 20 / 100 | 40 / 200 |
| Cloud voice replies | — | 200 / 1,000 | 500 / 2,500 | 800 / 4,000 |
| Agent runs / external tool calls | — | — | 10 / 50 | 20 / 100 |

Casual chat costs 1 chat credit; Work or Research costs 3. Research also costs 1 research request. Switching stream endpoints, models or devices does not reset account usage. Cloud voice is counted per synthesized reply, not minutes; device speech is outside this quota. Document export and viewing/status polling do not consume these allowances. Existing hourly safeguards still apply (for example 300 account chat requests/hour, 60 research/hour, 20 image requests/hour, 120 voice requests/hour, subject to deployment overrides).

Ultra has about 2.5x Premium's chat and several other allowances at roughly 2.6x its price. Max has 4x Premium's weekly chat allowance at roughly 4x its price. Research and newly unlocked features have their own budgets. This avoids claiming a 20x allowance at 4x the revenue without cost evidence.

## Enforcement and customer experience

- PostgreSQL transaction and per-subject advisory lock reserve both windows and multiple feature charges atomically.
- Buckets exclude tier, so upgrades/downgrades preserve consumed usage. Complimentary/admin access uses the existing effective Ultra plan.
- Guests use the existing anonymous browser token; signed-in usage is shared across devices. Anonymous limits are not a strong person-level identity guarantee.
- HTTP failures refund the original reservation, without refunding a later reset window. Interrupted streams, accepted background jobs that later fail, and rare refund-storage failures may still count.
- Quota storage failures stop metered requests; limits cannot be bypassed by a missing database.
- Scheduled agent jobs reserve the same agent quota within their creation transaction and defer when exhausted. Future Core job creation, external agent messages, MCP calls and coding dispatch share agent quotas. Existing per-job execution budgets remain in force. Resuming the same bounded job does not consume another run.
- The account's Usage & limits panel shows all plans, remaining allowances and reset times. Limits return HTTP 429 with Retry-After and blocked windows. No automatic overage billing is added.
- No launch flags are enabled. Feature gates and provider availability remain separate from allowances.

## Cost qualification

These request counts are starting product limits, not proven profit margins. Actual cost varies substantially with model, context, output length, search calls, voice length, media quality and agent steps. Existing per-request and agent budgets remain essential. Before selling at scale, measure per-feature paid-provider costs and review the allowance economics. No new dollar budget or automatic credit purchase is introduced by this change.
