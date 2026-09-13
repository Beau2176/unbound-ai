const crypto = require("crypto");

const TOKEN_VERSION = "v1";
const TOKEN_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function parseTokenKey(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  if (/^[a-f0-9]{64}$/i.test(text)) {
    return Buffer.from(text, "hex");
  }

  try {
    const decoded = Buffer.from(text, "base64");
    return decoded.length === TOKEN_KEY_BYTES ? decoded : null;
  } catch (_) {
    return null;
  }
}

function getTokenVaultStatus(env = process.env) {
  const key = parseTokenKey(env.CONNECTED_APPS_TOKEN_KEY);
  return {
    configured: Boolean(key),
    algorithm: "aes-256-gcm",
    version: TOKEN_VERSION,
    error: key ? null : "token-key-not-configured"
  };
}

function requireTokenKey(env = process.env) {
  const key = parseTokenKey(env.CONNECTED_APPS_TOKEN_KEY);
  if (!key) {
    const error = new Error("Connected Apps token encryption key is not configured.");
    error.code = "CONNECTED_APPS_TOKEN_KEY_NOT_CONFIGURED";
    throw error;
  }
  return key;
}

function encryptSecret(value, { env = process.env, aad = "unbound-connected-app" } = {}) {
  const plaintext = Buffer.from(String(value || ""), "utf8");
  if (!plaintext.length) {
    const error = new Error("Connected Apps secret is empty.");
    error.code = "CONNECTED_APPS_SECRET_EMPTY";
    throw error;
  }

  const key = requireTokenKey(env);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(String(aad), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    TOKEN_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

function decryptSecret(value, { env = process.env, aad = "unbound-connected-app" } = {}) {
  const encoded = String(value || "").trim();
  const parts = encoded.split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) {
    const error = new Error("Connected Apps encrypted secret is invalid.");
    error.code = "CONNECTED_APPS_SECRET_FORMAT_INVALID";
    throw error;
  }

  let iv;
  let tag;
  let ciphertext;
  try {
    iv = Buffer.from(parts[1], "base64url");
    tag = Buffer.from(parts[2], "base64url");
    ciphertext = Buffer.from(parts[3], "base64url");
  } catch (_) {
    const error = new Error("Connected Apps encrypted secret is invalid.");
    error.code = "CONNECTED_APPS_SECRET_FORMAT_INVALID";
    throw error;
  }

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || !ciphertext.length) {
    const error = new Error("Connected Apps encrypted secret is invalid.");
    error.code = "CONNECTED_APPS_SECRET_FORMAT_INVALID";
    throw error;
  }

  try {
    const key = requireTokenKey(env);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(String(aad), "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (cause) {
    const error = new Error("Connected Apps encrypted secret could not be authenticated.");
    error.code = "CONNECTED_APPS_SECRET_AUTH_FAILED";
    error.cause = cause;
    throw error;
  }
}

module.exports = {
  TOKEN_VERSION,
  parseTokenKey,
  getTokenVaultStatus,
  encryptSecret,
  decryptSecret
};
