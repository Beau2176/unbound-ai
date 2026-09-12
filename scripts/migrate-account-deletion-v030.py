from pathlib import Path


def one(path, old, new, label):
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    path.write_text(text.replace(old, new, 1))


server = Path("app/server.js")
entitlements = Path("app/access/entitlements.js")
index = Path("app/index.html")

one(
    server,
    '''const {
  buildExportFilename,
  buildDataExport
} = require("./privacy/data-export");
''',
    '''const {
  buildExportFilename,
  buildDataExport
} = require("./privacy/data-export");
const {
  publicDeletionBlock
} = require("./privacy/account-deletion");
''',
    "account deletion import"
)

one(
    entitlements,
    '''  data_export: Object.freeze({
    label: "Download My Data",
    description: "Download a privacy-safe JSON copy of account data and conversation history.",
    implemented: true,
    minimumPlan: "free"
  }),
  legal_consent: Object.freeze({
''',
    '''  data_export: Object.freeze({
    label: "Download My Data",
    description: "Download a privacy-safe JSON copy of account data and conversation history.",
    implemented: true,
    minimumPlan: "free"
  }),
  account_deletion: Object.freeze({
    label: "Delete My Account",
    description: "Permanently delete the account and personal account data after re-authentication and billing safety checks.",
    implemented: true,
    minimumPlan: "free"
  }),
  legal_consent: Object.freeze({
''',
    "account deletion entitlement"
)

one(
    server,
    '''      if (!passwordMatches) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Current password is incorrect." });
      }

      // Audit records are intentionally retained for platform integrity, but
''',
    '''      if (!passwordMatches) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Current password is incorrect." });
      }

      const subscriptionResult = await client.query(
        `SELECT
           provider,
           provider_subscription_id,
           status,
           cancel_at_period_end,
           current_period_end
         FROM account_subscriptions
         WHERE user_id = $1
         LIMIT 1
         FOR UPDATE`,
        [lockedUser.id]
      );
      const deletionBlock = publicDeletionBlock(subscriptionResult.rows[0] || null);

      if (deletionBlock) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error:
            "Cancel the external subscription and wait until it reaches canceled status before deleting this UNBOUND AI account.",
          deletionBlocked: deletionBlock
        });
      }

      // Operational usage and provider webhook records may be retained for
      // aggregate integrity, fraud prevention, or reconciliation. Remove the
      // account link and provider-response/error correlation fields first.
      await client.query(
        `UPDATE usage_events
         SET user_id = NULL,
             provider_response_id = NULL
         WHERE user_id = $1`,
        [lockedUser.id]
      );
      await client.query(
        `UPDATE age_verification_events
         SET user_id = NULL,
             error_text = NULL
         WHERE user_id = $1`,
        [lockedUser.id]
      );

      // Audit records are intentionally retained for platform integrity, but
''',
    "account deletion billing and retained-record hardening"
)

one(
    index,
    '''          <strong>This permanently deletes your account and saved conversations.</strong>
          Active sessions, subscription records, entitlement overrides, and complimentary grants tied to the account are removed. Retained operational usage/audit records are detached from your user ID and identifying audit email fields are scrubbed.
''',
    '''          <strong>This permanently deletes your account and saved conversations.</strong>
          Active sessions, subscription records, entitlement overrides, and complimentary grants tied to the account are removed. Retained operational usage/audit records are detached from your user ID and identifying provider/audit fields are scrubbed. If an external paid subscription is still open, deletion is blocked until that subscription reaches canceled status so billing cannot continue against an account that no longer exists.
''',
    "account deletion warning copy"
)

print("Applied UNBOUND AI v0.30 account deletion hardening.")
