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

Validation on 2026-10-17 with Node 24.19.0: the full local `npm run ci` passed, including Conversation route/UI contracts, source validation, security, other regressions, backup contracts, and a dependency audit with zero vulnerabilities. GitHub Production CI run `39089728757` passed on feature head `9e7cd62a16b77ff103bc47cb6ce5885d27b54da9`, including real PostgreSQL 16/18 recovery checks.

GitHub Mobile Native CI run `39089728835` also passed on that head. The packaged mobile UI passed `npm run build:local-ui` and `npm run verify:local-ui`, including Android/iOS local-origin transport, native validation contracts, the shared selector, and bundle hash checks. These are packaging checks, not signed-device or store-release evidence.

Conversation is deployed on the full site. Live browser checks verified the button, active label and summary, composer placeholder, preference persistence after reload, exit to Balanced, and persistence of that exit. The Tools menu exposes Create, Image Studio, and Command Center alongside the existing tools. The voice menu opens with hands-free and automatic playback off. The cloud browser exposes no device playback voices, so microphone and audio playback still require a supported device. Live model quality and account-scoped browser acceptance remain unverified; no paid AI call was made.

The first live visual check found duplicate product links crowding the header. PR #164 corrected this by applying the pure shared mode catalog in the native homepage and keeping product links in Tools. Its served-homepage regression failed before the fix and passed afterward. All five remote server/recovery/Android/iOS checks passed on `c9d5445590fd6089da3d9a8b7f307fdcef6d6eef`; the fix is deployed in main commit `4dda2a8b515f8cede3e4a52c62f6e03b56cc7f58`. Shared-shell changes now trigger mobile CI.

## Release-readiness follow-up — October 17, 2026

PR #163 fixed the launch-plan metadata location and updated `proxy-addr` to patched version 2.0.8, with behavioral tests for forwarded-address spoofing and legitimate proxy configurations. Its complete Production CI passed, including real PostgreSQL 16/18 recovery checks, and it is deployed on full-site main commit `d347bedba6768909d0a1f1daeb0da5293bf8ed13`. This draft includes those fixes and its combined checks passed.

The full-site database connection was corrected from the expired Render database to the existing restored Neon database. `/healthz`, `/readyz`, and `/api/system/status` returned HTTP 200 with database readiness confirmed. The public full-site interface showed LIVE and green system health. Read-only checks confirmed restored accounts and chat history. The saved recovery archive passed PostgreSQL 18 catalog and complete archive-export verification; no archive was restored over a live database.

Render's platform HTTP health-check path is now `/healthz`. The resulting deployment completed successfully, and all nine public smoke checks passed. A current Neon manual snapshot was restored into a separate branch; its schema fingerprint and account/history counts matched the source. The production branch and application connection were not switched. The recovery-copy compute was suspended after verification.

Render and Neon remain on their existing free plans. Both the app and browser worker now have `/healthz` platform health checks. Neon has a six-hour history window and no scheduled snapshots; scheduled backups require a paid plan. The manual snapshot and isolated read checks do not establish ongoing backup protection or an application login/history recovery rehearsal. No paid plans or AI providers were enabled. Conversation's deployed interface is verified, while live model, account, and device audio acceptance remain before commercial launch. See [the release checkpoint](FULL_SITE_RELEASE_CHECKPOINT_2026-10-17.md) for verified evidence and remaining work.
