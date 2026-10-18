# Account data and privacy workflow review

Status: **DRAFT REVIEW MATERIAL**. This records software behavior and prepares an
operating process; it does not publish a binding retention policy, set legal
deadlines, or establish legal approval.

## Existing operator and contact

UNBOUND AI is operated by UNBOUND FORGEWORKS LLC. The existing business email is
`unboundai111710@gmail.com`; the draft Terms and Privacy Notice now identify it
for support/legal/privacy inquiries. On October 17, 2026, the owner selected the
mailing address in the saved LLC record for public display: **251 Villa Vista St,
Sterling, CO 80751, United States**. It is now in both draft policies. A public
business phone remains optional and unconfirmed.

## Current product behavior

| Record group | Current export/deletion behavior | Decision still needed before final publication |
| --- | --- | --- |
| Core account/profile, AI style and conversation history | The signed-in JSON export includes the account, style, access and account-scoped conversations/messages. Account deletion removes the user and cascading history/preferences. | Inactive-account and conversation-retention policy; complete scope of a formal rights response |
| Device/security metadata | Export includes device labels/timestamps, security events/alerts, passkey labels/metadata and recovery-code counts. Password hashes, session/device tokens, recovery-code hashes and passkey credential/key values are excluded. Account deletion cascades account security records. | Security-record retention and any reviewed exceptions |
| Email verification | State/challenges are deleted with the account. A token's expiry limits its use; expiry alone is not proof of physical record deletion. | Challenge cleanup schedule and delivery/feedback record policy |
| Saved Memory, reminders and task events | Export version 2 includes all account-owned rows, including disabled items and acknowledged events. These tables cascade on deletion. | Reviewed retention periods and the full scope of a formal rights response |
| Connected apps | Export includes connection/provider account metadata, timestamps and token expiry times. Credential ciphertext, OAuth state and PKCE material are excluded. Account-owned connections cascade on deletion. | External provider disconnect/revocation work |
| Projects and saved work | Export includes projects, project memories/skill settings, vault asset metadata, coding job metadata, agent teams, background schedules, bounded agent runs/steps, selected Future Core job snapshots, creator-owned skill manifests and installation settings, activity action/timestamps and community-learning preference. Account-owned rows cascade on deletion. | Review of storage/provider retention and any data held outside these database records |
| Subscription/consent/age account state | Account-owned rows cascade on deletion. A linked subscription in any state other than none/canceled blocks deletion; scheduled cancellation while still active is not sufficient. | Reviewed billing/consent/age retention rules and provider obligations |
| Usage and age-verification event rows | Deletion detaches the user. Usage provider-response correlation and age-event error text are cleared. Other operational fields remain. | Specific retention periods and an assessment of remaining provider/event correlation |
| Administrative audit rows | User foreign keys are detached; actor email becomes deleted-account and target email is cleared. Other audit fields remain. | Audit retention and review of metadata that could identify a person |
| Backups and isolated recovery copies | Live deletion does not rewrite existing archives/snapshots or previously restored copies. | Actual backup retention/expiry, access, disposal and restored-data handling |

The version 2 `features` object has 18 sections: `memories`, `tasks`,
`taskEvents`, `connectedApps`, `agentRuns`, `agentSteps`, `projects`,
`projectMemories`, `projectSkills`, `vaultAssets`, `codingJobs`, `agentTeams`,
`backgroundSchedules`, `futureCoreJobs`, `createdSkills`, `installedSkills`,
`activity`, and `communityLearning`. Every feature query is account-bound and
uses explicit columns without a history/page limit. Large IDs and vault byte
counts remain strings to avoid numeric precision loss. Existing core fields
retain their format.

Nested snapshots, sources, usage and manifests use explicit field allowlists.
Future Core exports include saved task output/status, dependencies, approval
status/times and budget totals. They omit raw provider payloads, approval actor
identifiers, internal errors and unknown snapshot fields. Coding-provider job
IDs and worker claim tokens are excluded. Activity export contains actions and
timestamps rather than internal audit detail. Vault entries contain metadata;
this JSON does not fetch file bytes, external provider history or raw files.
It does not revoke a connected provider's credentials.

The download defaults to six attempts per account per hour, counted across
successful and failed requests. `RATE_LIMIT_ACCOUNT_EXPORTS_PER_HOUR` can set
1–120 attempts. Unauthenticated requests cannot consume an account's quota;
other accounts have independent quotas. A blocked request returns HTTP 429 and
`Retry-After`. A failed section returns an error, never a partial file.

This is an implementation map, not a claim that all retained rows are anonymous.
It must be expanded when features or schema change. The current download button
must not be described as a complete statutory rights-response system merely
because its core account/history export succeeds.

## Isolated account verification

The PostgreSQL recovery CI runs account/privacy verification only against its
newly restored synthetic database. It checks signed-in export scope, attachment
and no-store headers, secret/correlation exclusions, and separation from a second
synthetic account. Both accounts have fixtures across all 18 feature sections,
with disabled schedules and already-completed jobs so no provider can run.
Nested credential sentinels must be absent from the output. A deliberately
unavailable feature table must fail the whole download, repair must restore it,
and exhausting one account's reduced test quota must leave the other account's
quota usable. It exercises exact deletion confirmation, current password,
cross-origin rejection and active-subscription protection. A temporary trigger
forces a late deletion failure to verify rollback restores the prior account
links and correlation fields. After successful deletion, it checks cascading
cleanup, retained-record scrubbing, old-session denial, and the other account's
continued access. The source database snapshot must remain unchanged.

These are automated test cases, not production user-deletion evidence or a pass
for the complete live launch-rehearsal step. They send no provider requests and
use no live customer data. Test databases and fixtures are removed by the
existing recovery runner's cleanup.

## Draft manual request-handling process

1. Receive the request through the existing business email and keep a restricted
   request record with received date, request type and minimal account reference.
2. Verify the requester through an appropriate account-controlled channel before
   disclosing data or deleting an account. Never ask for passwords, recovery
   codes, private passkey material or provider keys in an email response.
3. Clarify the scope when necessary. The in-product export can supply the core
   account/history portion; review other enabled feature data separately.
4. Review billing state, legal holds/required records, connected-provider effects
   and backup handling before completing deletion or asserting total erasure.
5. Carry out the authorized action, check the result, record the outcome and
   explain any reviewed retention or technical limits in the response.
6. Apply the jurisdiction-specific response, extension, appeal and authorized-
   agent rules selected in qualified review. No deadline is invented here.

The launch remains blocked until the final operating decisions, provider setup
and reviewed policies are actually completed. No request acknowledgment or other
email is automatically sent by this preparation.
