# UNBOUND AI GitHub Connected App — Production Registration

This checklist is the approved first Connected App configuration for UNBOUND AI.

## Scope

Launch read-only. Do not enable repository writes, issue writes, pull-request writes, workflow writes, administration, secrets, environments, or organization-management permissions in the first release.

Recommended GitHub App repository permissions:
- Metadata: Read-only (GitHub App baseline/required metadata access)
- Contents: Read-only

Account permissions:
- None beyond the minimum user identity information available to the authorized user-access flow. UNBOUND does not request email, profile-write, or account-management permissions for this release.

Organization permissions:
- None for the first release.

Webhooks:
- Disable webhooks for the first release. UNBOUND v0.87 does not consume GitHub webhook events.

Repository installation:
- During initial testing, choose **Only select repositories** and install the App only on the repositories intentionally connected to UNBOUND.

## Authentication settings

- Use a GitHub App, not a pasted personal access token.
- Use the normal web application authorization flow.
- Request user authorization (OAuth) during installation.
- Keep expiring user authorization tokens enabled.
- PKCE is required by UNBOUND's v0.87 flow using `S256`.
- Do not enable device flow for the web application.
- Do not enable wildcard callback matching.

## URLs

Use the final production HTTPS origin for both values below.

- Homepage URL: `https://<production-host>/`
- Callback URL: `https://<production-host>/api/connections/github/callback`

The callback must match exactly. Do not use wildcard callback matching.

## Production secrets

Store these in Render deployment environment variables only. Do not commit them to GitHub.

- `GITHUB_APP_CLIENT_ID` — GitHub App Client ID
- `GITHUB_APP_CLIENT_SECRET` — GitHub App Client Secret
- `GITHUB_APP_CALLBACK_URL` — exact production callback URL
- `CONNECTED_APPS_TOKEN_KEY` — random 32-byte key encoded as base64 or 64 hexadecimal characters
- `GITHUB_APP_REGISTRATION_VERIFIED=true` — set only after the real registration fields are checked
- `GITHUB_APP_READ_ONLY_PERMISSIONS_VERIFIED=true` — set only after confirming the App requests no permissions broader than the approved read-only scope

Do not set either verification flag true before the corresponding external fact is verified.

## First live test

1. Install the GitHub App on one selected test repository.
2. Sign in to a TOP UNBOUND account.
3. Open `/connected-apps.html`.
4. Select Connect GitHub.
5. Confirm GitHub shows only the approved read-only access.
6. Complete authorization.
7. Confirm UNBOUND shows the connected GitHub username.
8. Load repositories and confirm only explicitly authorized repositories appear.
9. Let/force an access token reach its refresh path and verify refresh succeeds.
10. Disconnect GitHub and verify UNBOUND removes its local connection and provider-side token revocation succeeds.
11. Confirm a replayed callback/state is rejected.
12. Confirm an incorrect/expired state is rejected.

## Security invariants

- GitHub access/refresh tokens are encrypted with AES-256-GCM before database storage.
- OAuth state is stored only as a SHA-256 hash.
- PKCE verifier is encrypted server-side and never sent to browser JavaScript.
- Browser code never receives GitHub access tokens, refresh tokens, Client Secret, or the Connected Apps encryption key.
- The first release exposes no GitHub write actions.
