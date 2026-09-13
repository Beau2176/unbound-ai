# UNBOUND AI — Multi-model routing

v0.85 adds TOP-only chat routing through server-configured model profiles.

## Security and cost boundary

The browser never submits a raw model ID. It submits one of four bounded profile names:

- `auto`
- `fast`
- `deep`
- `research`

The server checks the signed-in account's `multi_model` entitlement on every chat request. If the account cannot use the capability, the normal default model is used regardless of the browser profile.

A malformed/unknown browser profile normalizes to `auto`. If a requested server profile is not configured, routing falls back to the normal default model. This keeps profile rollout fail-safe and prevents a client from selecting arbitrary provider models or bypassing server cost choices.

## Environment configuration

The default model remains the provider's normal model (`OPENAI_MODEL` / `AI_MODEL` for the current OpenAI provider).

Optional routing profiles:

```text
AI_MODEL_FAST=<provider model id>
AI_MODEL_DEEP=<provider model id>
AI_MODEL_RESEARCH=<provider model id>
```

For the current OpenAI provider these aliases are also supported:

```text
OPENAI_FAST_MODEL=<model id>
OPENAI_DEEP_MODEL=<model id>
OPENAI_RESEARCH_MODEL=<model id>
```

`AI_MODEL_*` takes precedence over the matching `OPENAI_*_MODEL` alias.

Do not put API keys or other secrets in model ID variables.

## AUTO behavior

For an entitled TOP account:

- Research Mode -> Research profile when configured
- Work depth -> Deep profile when configured
- Casual depth -> Fast profile when configured
- Missing profile -> normal default model

An entitled user may also explicitly choose FAST, DEEP, or RESEARCH from the chat UI. This changes the server profile preference only; it does not expose or accept arbitrary model IDs.

## FREE / guest behavior

FREE and guest chat stays on the normal default model. Sending `modelProfile=deep`, `fast`, or `research` manually does not grant routing access because the server recomputes account entitlement.

## Provider independence

The routing policy chooses a model identifier and passes it through the existing provider-neutral AI gateway. v0.85 does not add a second AI vendor or a second API credential. The remaining `connected_apps` capability is still separate and not implemented by this work.

## Rollout guidance

1. Merge and deploy v0.85 with no optional profile variables first; all chat continues using the normal default model.
2. Configure one profile at a time using a model that the selected AI provider/account actually supports.
3. Verify usage/cost and response quality before adding another profile.
4. Keep Research Mode web-search compatibility in mind when selecting the research profile.
5. Remove a profile variable to fall back immediately to the normal default model.

Permanent CI verifies routing/fallback behavior, TOP entitlement enforcement, server-only model IDs, UI profile bounds, and production source integration.
