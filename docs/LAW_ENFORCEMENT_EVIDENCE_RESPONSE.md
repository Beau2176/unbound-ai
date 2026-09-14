# UNBOUND AI law-enforcement evidence response

## Purpose

UNBOUND AI keeps the high-risk evidence vault separate from ordinary customer activity. The dedicated **Law Enforcement** admin workspace exists only to help an authorized UNBOUND administrator locate and manually export previously preserved high-risk safety evidence after UNBOUND has received a specific request from law enforcement.

This workflow does **not** turn anything over automatically. It does not email, upload, transmit, or push evidence to any agency or third party.

The evidence vault and this response workspace do not determine that a user committed a crime. Preservation categories are safety/enforcement categories, not legal findings.

## Dedicated code branch

Development for this feature is isolated on the GitHub branch:

`law-enforcement`

The production workspace route is:

`/law-enforcement`

That route is protected by the existing UNBOUND database and administrator gates.

## Required request information

Before a search can run, an administrator must create a law-enforcement request record containing:

- agency name;
- requesting officer/representative name or identifier;
- case, request, subpoena, warrant, or other request reference;
- subject/person name;
- approximate date;
- approximate time;
- search window around that approximate time.

The default search window is plus/minus 3 hours. The interface supports narrower or broader windows up to plus/minus 24 hours.

## Search behavior

The search only looks inside `abuse_evidence_records`; it does not search or copy every normal customer conversation.

The request search is constrained by:

1. an exact, case-insensitive match against the account `display_name`; and
2. the request's approximate occurrence time plus/minus the selected search window.

Search results expose evidence metadata only. Plaintext preserved payloads are not decrypted merely because a search was run.

## Manual download

The administrator selects one or more matching preserved records and enters a disclosure-review note before an export can be created.

For every selected record the export workflow:

1. verifies that the evidence record still matches the request's subject and time window;
2. places the evidence record on legal hold using the request reference;
3. decrypts the record through the existing audited evidence-vault reader;
4. writes a separate `law_enforcement_export` audit entry;
5. generates a local JSON evidence package;
6. computes a SHA-256 hash for the export package; and
7. records the export timestamp, administrator, and package hash on the law-enforcement request record.

The browser downloads the package locally. No disclosure transport client exists in the law-enforcement module.

## Evidence package

The downloaded JSON package contains:

- export version and generated timestamp;
- the law-enforcement request metadata;
- the selected preserved evidence records and their original integrity hashes;
- the plaintext evidence payloads for the selected records;
- a package-level SHA-256 integrity hash; and
- an explicit statement that the package was created for manual response to a specific law-enforcement request.

Because the export contains sensitive plaintext evidence, it should be handled as restricted material after download.

## Audit and legal hold

The existing `abuse_evidence_access_audit` table records each decrypted read, legal-hold transition, and law-enforcement export event.

Selected evidence is placed on legal hold at export time so ordinary retention cleanup cannot remove it while the request is being handled.

## No automatic disclosure

The feature intentionally contains no automatic law-enforcement reporting or delivery path. A search or preservation event cannot cause evidence to leave UNBOUND. An administrator must deliberately create an export after a specific request has been logged.

The final production disclosure policy, retention periods, preservation duties, mandatory-reporting obligations, and response process should be reviewed for the jurisdictions where UNBOUND operates before commercial launch.
