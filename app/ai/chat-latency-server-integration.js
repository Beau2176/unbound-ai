const INTEGRATION_VERSION = "v1.00";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Chat-latency integration marker is missing: ${label}.`);
    error.code = "CHAT_LATENCY_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Chat-latency integration marker is ambiguous: ${label}.`);
    error.code = "CHAT_LATENCY_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function replaceExactlyCount(source, marker, replacement, expectedCount, label) {
  const count = String(source).split(marker).length - 1;
  if (count !== expectedCount) {
    const error = new Error(
      `Chat-latency integration expected ${expectedCount} ${label} marker(s), found ${count}.`
    );
    error.code = "CHAT_LATENCY_SERVER_INTEGRATION_MARKER_COUNT";
    throw error;
  }
  return source.split(marker).join(replacement);
}

function integrateChatLatencyServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "CHAT_LATENCY_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const optionalCapabilityMarker = `async function assertOptionalAccountCapability(req, capabilityKey) {
  const hasSessionCookie = Boolean(parseCookies(req)[SESSION_COOKIE]);
  if (!databaseReady || !pool) {
    if (hasSessionCookie) {
      const error = new Error("Account access is temporarily unavailable.");
      error.statusCode = 503;
      throw error;
    }
    return null;
  }

  const user = await findSessionUser(req);
  if (!user) {
    if (hasSessionCookie) {
      const error = new Error("Your session expired. Sign in again to continue.");
      error.statusCode = 401;
      throw error;
    }
    return null;
  }

  const access = await buildAccountAccess(user);`;
  const optionalCapabilityReplacement = `async function assertOptionalAccountCapability(req, capabilityKey) {
  const hasSessionCookie = Boolean(parseCookies(req)[SESSION_COOKIE]);
  if (!databaseReady || !pool) {
    if (hasSessionCookie) {
      const error = new Error("Account access is temporarily unavailable.");
      error.statusCode = 503;
      throw error;
    }
    return null;
  }

  const user = req.user || (await findSessionUser(req));
  if (!user) {
    if (hasSessionCookie) {
      const error = new Error("Your session expired. Sign in again to continue.");
      error.statusCode = 401;
      throw error;
    }
    return null;
  }

  req.user = user;
  const access = req.accountAccess || (await buildAccountAccess(user));
  req.accountAccess = access;`;
  source = replaceExactlyOnce(
    source,
    optionalCapabilityMarker,
    optionalCapabilityReplacement,
    "optional-capability-cache"
  );

  const requiredCapabilityMarker = `async function assertRequestCapability(req, capabilityKey) {
  if (!databaseReady || !pool) {
    const error = new Error("Account access is temporarily unavailable.");
    error.statusCode = 503;
    throw error;
  }

  const user = await findSessionUser(req);
  if (!user) {
    const error = new Error("Sign in with an account that includes that capability.");
    error.statusCode = 401;
    throw error;
  }

  const access = await buildAccountAccess(user);`;
  const requiredCapabilityReplacement = `async function assertRequestCapability(req, capabilityKey) {
  if (!databaseReady || !pool) {
    const error = new Error("Account access is temporarily unavailable.");
    error.statusCode = 503;
    throw error;
  }

  const user = req.user || (await findSessionUser(req));
  if (!user) {
    const error = new Error("Sign in with an account that includes that capability.");
    error.statusCode = 401;
    throw error;
  }

  req.user = user;
  const access = req.accountAccess || (await buildAccountAccess(user));
  req.accountAccess = access;`;
  source = replaceExactlyOnce(
    source,
    requiredCapabilityMarker,
    requiredCapabilityReplacement,
    "required-capability-cache"
  );

  const adultMarker = `  const user = req.user || (await findSessionUser(req));
  if (!user) {
    const error = new Error("Sign in before using age-restricted UNBOUND AI features.");
    error.statusCode = 401;
    throw error;
  }

  const ageVerification = await buildAgeVerificationState(user.id);`;
  const adultReplacement = `  const user = req.user || (await findSessionUser(req));
  if (!user) {
    const error = new Error("Sign in before using age-restricted UNBOUND AI features.");
    error.statusCode = 401;
    throw error;
  }

  req.user = user;
  const ageVerification =
    req.accountAccess?.ageVerification || (await buildAgeVerificationState(user.id));`;
  source = replaceExactlyOnce(
    source,
    adultMarker,
    adultReplacement,
    "adult-age-verification-cache"
  );

  const persistentChatMarker = `async function preparePersistentChat(req, message, depthStyle, productMode) {
  if (!databaseReady || !pool) {
    return null;
  }

  const user = await findSessionUser(req);`;
  const persistentChatReplacement = `async function preparePersistentChat(req, message, depthStyle, productMode) {
  if (!databaseReady || !pool) {
    return null;
  }

  const user = req.user || (await findSessionUser(req));
  if (user) req.user = user;`;
  source = replaceExactlyOnce(
    source,
    persistentChatMarker,
    persistentChatReplacement,
    "persistent-chat-session-cache"
  );

  const multiModelMarker = `    const multiModelAccess = req.user ? await buildAccountAccess(req.user) : null;`;
  const multiModelReplacement = `    const multiModelAccess = req.user
      ? (req.accountAccess || (await buildAccountAccess(req.user)))
      : null;
    if (multiModelAccess) req.accountAccess = multiModelAccess;`;
  source = replaceExactlyCount(
    source,
    multiModelMarker,
    multiModelReplacement,
    2,
    "multi-model-access-cache"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  replaceExactlyCount,
  integrateChatLatencyServerSource
};
