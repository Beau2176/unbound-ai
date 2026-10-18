# Conversation mode for the full UNBOUND AI site

Conversation mode is for people who want a relaxed exchange about their day, interests, stories, or whatever is on their mind. They do not need to bring a question, ask for advice, or generate a product.

## Experience

- A **CONVERSATION** button appears above the chat on desktop and mobile. Selecting it opens Standard/Casual chat with the Conversation style. It keeps the current conversation history.
- The active button reads **CONVERSATION ON · EXIT**. Exit returns to Balanced style; all other styles remain available in Chat Options and the Mode Library.
- The composer asks “What's on your mind?” and the mode describes itself as “Just talk with AI. Advice only when you ask.”
- Replies should follow the user's pace, respond naturally, and leave room for small talk, stories, and humor. Advice, answers, and action plans are available when requested. Follow-up questions should fit the exchange rather than appearing after every reply.
- The mode stays honest about being AI. It must not invent a human life, claim to replace people, encourage isolation, or pressure someone to continue talking.
- Existing text, streaming, conversation history, and voice chat paths use the saved mode. Voice retains its existing account, browser, microphone, and provider requirements; selecting Conversation does not start the microphone.

## Implementation

The existing `listener` account preference is now labeled **Conversation**. Keeping that ID preserves saved settings and the 100-mode catalog without a database migration. The chat page saves a signed-in user's preference before confirming the switch; a failed save restores the displayed selection. Guest preferences remain local.

Both chat endpoints use conversation-specific depth instructions. Casual favors brief, speakable replies. Work allows a longer exchange without requiring analysis or a structured solution. The other 99 modes retain their original depth prompts. Explicit product-mode selections and existing access, age, usage, privacy, and safety controls still apply.

The native web shell and packaged mobile UI now apply the shared mode catalog before their UI enhancements, so they include Conversation and the full selector. The catalog builder is independent of server dependencies. The mobile bundle verifier checks the selector and Conversation control; catalog changes also trigger mobile CI. Desktop and mobile summaries use the selected label and refresh when the saved setting changes.

This uses the existing AI chat provider separately from artifact generation. It adds no provider, subscription, or credential. Normal chat and optional voice usage remain subject to the platform's existing limits and costs.

## Verification and release

Run from `app/`:

```sh
node scripts/conversation-mode-contract.js
npm run ci
```

The focused check executes both actual chat route handlers with mocked providers, including saved preference resolution, history continuity, streaming events, the product mode used by voice, and the existing adult gate. It also renders both homepage URLs through the native shell, compiles their inline scripts, and exercises selection, exit, reload, maintenance copy, guest settings, and failed-save behavior. It is included in the regression suite.

These checks do not evaluate live model quality or microphone/audio playback. Before the full-site release, verify an ordinary multi-turn exchange, a request to just listen, a requested suggestion, a subject change, and an explicit stop through the selected live provider; then check voice on a supported device under the existing voice setup.

This feature is prepared for the full platform. It does not publish the full platform or modify the separate Founders Beta site.

Validation on 2026-10-17 with Node 24.19.0: the focused Conversation checks, source validation, security contracts, other regression checks, and backup contracts passed. The full `npm run ci` stopped at `no-spend-launch-preflight-contract.js:19` because `launchPlanPolicy` is undefined. That failure was reproduced on unchanged main commit `107deace639de8a1cbaf490acb731551cff2fb12`. The remaining launch-validation, completion, and usage checks passed when run separately.

The packaged mobile UI also passed `npm run build:local-ui` and `npm run verify:local-ui`, including Android/iOS local-origin transport, native validation contracts, the shared selector, and the bundle hash checks. These are packaging checks, not signed-device or store-release evidence.

The initial dependency audit also reported an existing critical `proxy-addr` advisory (`GHSA-jqcg-44mw-7w3h`) on this branch and unchanged main. Real-browser visual verification of this draft was unavailable because Chromium was not installed and its download failed; the real served HTML and inline scripts were verified through the contract instead.

## Release-readiness follow-up — October 17, 2026

PR #163 fixed the launch-plan metadata location and updated `proxy-addr` to patched version 2.0.8, with behavioral tests for forwarded-address spoofing and legitimate proxy configurations. Its complete Production CI passed, including real PostgreSQL 16/18 recovery checks, and it is deployed on full-site main commit `d347bedba6768909d0a1f1daeb0da5293bf8ed13`. This draft now includes those fixes and reruns its own checks against them.

The full-site database connection was corrected from the expired Render database to the existing restored Neon database. `/healthz`, `/readyz`, and `/api/system/status` returned HTTP 200 with database readiness confirmed. The public full-site interface showed LIVE and green system health. Read-only checks confirmed restored accounts and chat history. The saved recovery archive passed PostgreSQL 18 catalog and complete archive-export verification; no archive was restored over a live database.

Render remains on its existing free plan. The platform HTTP health-check setting remains unset pending dashboard access, and ongoing production backup protection still needs verification. No paid plans or providers were enabled. Conversation remains a draft awaiting live model, audio, and visual checks; these infrastructure repairs do not mark the full commercial launch approved.
