function normalizeProviderName(value) {
  return String(value || "none").trim().toLowerCase() || "none";
}

function normalizeHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const providers = new Map();

function registerEmailProvider(provider) {
  const id = normalizeProviderName(provider?.id);
  if (!provider || id === "none") {
    throw new Error("A named email provider adapter is required.");
  }
  if (typeof provider.isConfigured !== "function" || typeof provider.sendVerification !== "function") {
    throw new Error("Email provider adapters must implement isConfigured() and sendVerification().");
  }
  providers.set(id, provider);
  return provider;
}

function getProvider(env = process.env) {
  const name = normalizeProviderName(env.EMAIL_PROVIDER);
  if (name === "none") return null;
  return providers.get(name) || null;
}

function getEmailGatewayStatus(env = process.env) {
  const name = normalizeProviderName(env.EMAIL_PROVIDER);
  const provider = getProvider(env);

  if (name === "none") {
    return {
      provider: "none",
      configured: false,
      canSendVerification: false,
      error: "provider-not-selected"
    };
  }

  if (!provider) {
    return {
      provider: name,
      configured: false,
      canSendVerification: false,
      error: "provider-adapter-not-installed"
    };
  }

  const configured = Boolean(provider.isConfigured(env));
  return {
    provider: provider.id,
    configured,
    canSendVerification: configured,
    error: configured ? null : "provider-not-configured"
  };
}

async function sendAccountVerification({ toEmail, displayName, verificationUrl, env = process.env }) {
  const provider = getProvider(env);
  const status = getEmailGatewayStatus(env);

  if (!provider || !status.configured) {
    const error = new Error("Transactional email provider is not configured.");
    error.code = "EMAIL_PROVIDER_NOT_CONFIGURED";
    throw error;
  }

  const email = String(toEmail || "").trim().toLowerCase();
  if (!email || !email.includes("@") || email.length > 254) {
    const error = new Error("A valid account email is required.");
    error.code = "EMAIL_RECIPIENT_INVALID";
    throw error;
  }

  const safeVerificationUrl = normalizeHttpsUrl(verificationUrl);
  if (!safeVerificationUrl) {
    const error = new Error("Verification URL must use HTTPS.");
    error.code = "EMAIL_VERIFICATION_URL_INVALID";
    throw error;
  }

  const result = await provider.sendVerification({
    toEmail: email,
    displayName: String(displayName || "").trim().slice(0, 120),
    verificationUrl: safeVerificationUrl
  });

  return {
    accepted: result?.accepted !== false,
    provider: provider.id
  };
}

module.exports = {
  registerEmailProvider,
  getEmailGatewayStatus,
  sendAccountVerification,
  normalizeProviderName,
  normalizeHttpsUrl
};
