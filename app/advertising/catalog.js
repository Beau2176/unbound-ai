const DEFAULT_PACKAGES = Object.freeze([
  {
    code: "starter",
    name: "Starter",
    durationDays: 7,
    amountCents: 2500,
    featured: false,
    description: "One standard advertiser card for 7 days."
  },
  {
    code: "monthly",
    name: "Monthly",
    durationDays: 30,
    amountCents: 7500,
    featured: false,
    description: "One standard advertiser card for 30 days."
  },
  {
    code: "featured",
    name: "Featured",
    durationDays: 30,
    amountCents: 15000,
    featured: true,
    description: "Featured placement for 30 days with priority positioning."
  }
]);

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function advertisingPackages(env = process.env) {
  const currency = String(env.ADVERTISING_CURRENCY || "USD").trim().toUpperCase();
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  const overrides = {
    starter: positiveInteger(env.ADVERTISING_STARTER_CENTS, 2500),
    monthly: positiveInteger(env.ADVERTISING_MONTHLY_CENTS, 7500),
    featured: positiveInteger(env.ADVERTISING_FEATURED_CENTS, 15000)
  };

  return DEFAULT_PACKAGES.map((item) => ({
    ...item,
    amountCents: overrides[item.code],
    currency: safeCurrency
  }));
}

function getAdvertisingPackage(code, env = process.env) {
  const normalized = String(code || "").trim().toLowerCase();
  return advertisingPackages(env).find((item) => item.code === normalized) || null;
}

function cleanText(value, maxLength) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text || text.length > maxLength) return null;
  return text;
}

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

function cleanHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol !== "https:") return null;
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

function normalizeAdvertisingCreative(input = {}) {
  const businessName = cleanText(input.businessName, 100);
  const contactEmail = cleanEmail(input.contactEmail);
  const websiteUrl = cleanHttpsUrl(input.websiteUrl);
  const headline = cleanText(input.headline, 90);
  const description = cleanText(input.description, 280);

  if (!businessName || !contactEmail || !websiteUrl || !headline || !description) {
    return null;
  }

  return {
    businessName,
    contactEmail,
    websiteUrl,
    headline,
    description
  };
}

module.exports = {
  DEFAULT_PACKAGES,
  advertisingPackages,
  getAdvertisingPackage,
  normalizeAdvertisingCreative,
  cleanHttpsUrl
};
