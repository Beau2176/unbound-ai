const SAFE_DELETION_SUBSCRIPTION_STATUSES = Object.freeze([
  "none",
  "canceled"
]);

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function subscriptionBlocksAccountDeletion(subscription) {
  if (!subscription || !subscription.provider_subscription_id) {
    return false;
  }

  return !SAFE_DELETION_SUBSCRIPTION_STATUSES.includes(
    normalizeStatus(subscription.status)
  );
}

function publicDeletionBlock(subscription) {
  if (!subscriptionBlocksAccountDeletion(subscription)) return null;

  return {
    code: "active_subscription",
    provider: String(subscription.provider || "billing provider").trim() || "billing provider",
    status: normalizeStatus(subscription.status) || "unknown",
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    currentPeriodEnd: subscription.current_period_end || null
  };
}

module.exports = {
  SAFE_DELETION_SUBSCRIPTION_STATUSES,
  subscriptionBlocksAccountDeletion,
  publicDeletionBlock
};
