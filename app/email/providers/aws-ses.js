const crypto = require("crypto");

const AWS_SERVICE = "ses";
const SES_SEND_PATH = "/v2/email/outbound-emails";
const DEFAULT_SUBJECT = "Verify your UNBOUND AI email";

function cleanEnvValue(value) {
  return String(value || "").trim();
}

function getAwsRegion(env = process.env) {
  const region = cleanEnvValue(env.AWS_REGION || env.AWS_DEFAULT_REGION).toLowerCase();
  return /^[a-z0-9-]{3,40}$/.test(region) ? region : "";
}

function getAwsSesConfig(env = process.env) {
  return {
    accessKeyId: cleanEnvValue(env.AWS_ACCESS_KEY_ID),
    secretAccessKey: cleanEnvValue(env.AWS_SECRET_ACCESS_KEY),
    sessionToken: cleanEnvValue(env.AWS_SESSION_TOKEN),
    region: getAwsRegion(env),
    fromAddress: cleanEnvValue(env.EMAIL_FROM_ADDRESS).toLowerCase(),
    fromName: cleanEnvValue(env.EMAIL_FROM_NAME || "UNBOUND AI").slice(0, 100),
    replyToAddress: cleanEnvValue(env.EMAIL_REPLY_TO_ADDRESS).toLowerCase()
  };
}

function isEmailShape(value) {
  const email = cleanEnvValue(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function isConfigured(env = process.env) {
  const config = getAwsSesConfig(env);
  return Boolean(
    config.accessKeyId &&
      config.secretAccessKey &&
      config.region &&
      isEmailShape(config.fromAddress) &&
      (!config.replyToAddress || isEmailShape(config.replyToAddress))
  );
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function formatAmzDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("A valid signing date is required.");
  }
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function signingKey(secretAccessKey, dateStamp, region, service = AWS_SERVICE) {
  const dateKey = hmac(Buffer.from(`AWS4${secretAccessKey}`, "utf8"), dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, "aws4_request");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMailbox(name, address) {
  const email = cleanEnvValue(address).toLowerCase();
  if (!isEmailShape(email)) return "";
  const safeName = String(name || "")
    .replace(/[\r\n"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return safeName ? `"${safeName}" <${email}>` : email;
}

function buildVerificationMessage({ toEmail, displayName, verificationUrl, env = process.env }) {
  const config = getAwsSesConfig(env);
  const recipient = cleanEnvValue(toEmail).toLowerCase();
  if (!isEmailShape(recipient)) {
    const error = new Error("A valid verification email recipient is required.");
    error.code = "AWS_SES_RECIPIENT_INVALID";
    throw error;
  }

  const url = cleanEnvValue(verificationUrl);
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = null;
  }
  if (!parsedUrl || parsedUrl.protocol !== "https:") {
    const error = new Error("Verification links sent through SES must use HTTPS.");
    error.code = "AWS_SES_VERIFICATION_URL_INVALID";
    throw error;
  }

  const greetingName = String(displayName || "").trim().slice(0, 80);
  const greeting = greetingName ? `Hi ${greetingName},` : "Hello,";
  const text = [
    greeting,
    "",
    "Verify the email address for your UNBOUND AI account by opening this link:",
    url,
    "",
    "This is a one-time verification link. If you did not request this, you can ignore this email.",
    "",
    "UNBOUND AI",
    "A more open tomorrow starts today."
  ].join("\n");

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#050913;color:#f7fbff;padding:24px"><div style="max-width:560px;margin:auto;background:#0b1220;border:1px solid #31506d;border-radius:18px;padding:28px"><h1 style="margin-top:0">Verify your email</h1><p>${escapeHtml(greeting)}</p><p>Verify the email address for your UNBOUND AI account:</p><p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 18px;background:#1d75b7;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:bold">Verify email</a></p><p style="color:#aab8c9">This is a one-time verification link. If you did not request this, you can ignore this email.</p><p style="color:#ffad43;font-weight:bold">UNBOUND AI</p><p style="color:#aab8c9">A more open tomorrow starts today.</p></div></body></html>`;

  const payload = {
    FromEmailAddress: formatMailbox(config.fromName, config.fromAddress),
    Destination: { ToAddresses: [recipient] },
    Content: {
      Simple: {
        Subject: { Data: DEFAULT_SUBJECT, Charset: "UTF-8" },
        Body: {
          Text: { Data: text, Charset: "UTF-8" },
          Html: { Data: html, Charset: "UTF-8" }
        }
      }
    }
  };

  if (config.replyToAddress) {
    payload.ReplyToAddresses = [config.replyToAddress];
  }

  return payload;
}

function buildSignedRequest({ payload, env = process.env, now = new Date() }) {
  const config = getAwsSesConfig(env);
  if (!isConfigured(env)) {
    const error = new Error("Amazon SES email delivery is not configured.");
    error.code = "AWS_SES_NOT_CONFIGURED";
    throw error;
  }

  const host = `email.${config.region}.amazonaws.com`;
  const endpoint = `https://${host}${SES_SEND_PATH}`;
  const body = JSON.stringify(payload);
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const canonicalHeaderPairs = [
    ["content-type", "application/json"],
    ["host", host],
    ["x-amz-date", amzDate]
  ];
  if (config.sessionToken) {
    canonicalHeaderPairs.push(["x-amz-security-token", config.sessionToken]);
  }
  canonicalHeaderPairs.sort(([left], [right]) => left.localeCompare(right));

  const canonicalHeaders = canonicalHeaderPairs
    .map(([name, value]) => `${name}:${String(value).trim()}\n`)
    .join("");
  const signedHeaders = canonicalHeaderPairs.map(([name]) => name).join(";");
  const canonicalRequest = [
    "POST",
    SES_SEND_PATH,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");

  const credentialScope = `${dateStamp}/${config.region}/${AWS_SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signature = crypto
    .createHmac("sha256", signingKey(config.secretAccessKey, dateStamp, config.region))
    .update(stringToSign)
    .digest("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const headers = {
    "content-type": "application/json",
    "x-amz-date": amzDate,
    authorization
  };
  if (config.sessionToken) {
    headers["x-amz-security-token"] = config.sessionToken;
  }

  return { endpoint, headers, body };
}

function createAwsSesProvider({ fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required for Amazon SES.");
  }

  return {
    id: "aws-ses",
    isConfigured,
    async sendVerification({ toEmail, displayName, verificationUrl, env = process.env }) {
      const payload = buildVerificationMessage({
        toEmail,
        displayName,
        verificationUrl,
        env
      });
      const request = buildSignedRequest({ payload, env, now: now() });

      let response;
      try {
        response = await fetchImpl(request.endpoint, {
          method: "POST",
          headers: request.headers,
          body: request.body,
          redirect: "error"
        });
      } catch (cause) {
        const error = new Error("Amazon SES request failed.");
        error.code = "AWS_SES_REQUEST_FAILED";
        error.cause = cause;
        throw error;
      }

      if (!response?.ok) {
        const error = new Error("Amazon SES rejected the verification email request.");
        error.code = "AWS_SES_SEND_FAILED";
        error.statusCode = Number(response?.status || 502);
        throw error;
      }

      let data = {};
      try {
        data = await response.json();
      } catch {
        // A successful SES response should be JSON. Do not expose response text.
      }

      return {
        accepted: true,
        providerMessageId: cleanEnvValue(data?.MessageId) || null
      };
    }
  };
}

module.exports = {
  AWS_SERVICE,
  SES_SEND_PATH,
  DEFAULT_SUBJECT,
  getAwsRegion,
  getAwsSesConfig,
  isConfigured,
  formatAmzDate,
  buildVerificationMessage,
  buildSignedRequest,
  createAwsSesProvider,
  awsSesProvider: createAwsSesProvider()
};
