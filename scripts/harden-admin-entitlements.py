from pathlib import Path

server_path = Path('app/server.js')
admin_path = Path('app/admin.html')
server = server_path.read_text()
admin = admin_path.read_text()


def one(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    return source.replace(old, new, 1)

# Signed-in overrides must affect every implemented account capability while
# preserving guest Standard chat behavior.
helper = r'''
async function assertOptionalAccountCapability(req, capabilityKey) {
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
  if (!user) return null;

  const access = await buildAccountAccess(user);
  const capability = access?.capabilities.find((item) => item.key === capabilityKey);
  if (!capability || !capability.usable) {
    const error = new Error(
      capability?.entitled && !capability?.available
        ? "That capability is included in your access level but is not live yet."
        : "Your current access level does not include that capability."
    );
    error.statusCode = 403;
    throw error;
  }

  return { user, access, capability };
}

'''
server = one(server, 'async function requireSignedIn(req, res, next) {', helper + 'async function requireSignedIn(req, res, next) {', 'optional capability helper')

# Normal sourced chat: enforce core chat/depth for signed-in users and both
# web-search + citation entitlements for Research Mode.
server = one(
    server,
    '    const depthStyle = normalizeDepthStyle(req.body.depthStyle);\n    const productMode = normalizeProductMode(req.body.productMode);\n\n    if (productMode === "research" && !gatewayStatus.research) {',
    '    const depthStyle = normalizeDepthStyle(req.body.depthStyle);\n    const productMode = normalizeProductMode(req.body.productMode);\n\n    await assertOptionalAccountCapability(req, "chat");\n    await assertOptionalAccountCapability(\n      req,\n      depthStyle === "work" ? "work_mode" : "casual_mode"\n    );\n\n    if (productMode === "research" && !gatewayStatus.research) {',
    'sourced chat core gates'
)
server = one(
    server,
    '    if (productMode === "research") {\n      await assertRequestCapability(req, "web_research");\n    }',
    '    if (productMode === "research") {\n      await assertRequestCapability(req, "web_research");\n      await assertRequestCapability(req, "citations");\n    }',
    'Research citation gate'
)

# Streaming Standard chat: enforce chat/depth/streaming for signed-in users.
stream_marker = '    if (productMode === "research") {\n      return res.status(400).json({\n        error: "Research Mode uses the sourced response endpoint instead of streaming."\n      });\n    }\n\n'
stream_gates = '''    if (productMode === "research") {\n      return res.status(400).json({\n        error: "Research Mode uses the sourced response endpoint instead of streaming."\n      });\n    }\n\n    await assertOptionalAccountCapability(req, "chat");\n    await assertOptionalAccountCapability(\n      req,\n      depthStyle === "work" ? "work_mode" : "casual_mode"\n    );\n    await assertOptionalAccountCapability(req, "streaming");\n\n'''
server = one(server, stream_marker, stream_gates, 'stream capability gates')

# Mark whether an override is still active so expired records are not
# represented as effective in the admin UI.
server = one(
    server,
    'function publicEntitlementOverride(row) {\n  return {\n    key: row.entitlement_key,',
    'function publicEntitlementOverride(row) {\n  const active =\n    !row.expires_at || new Date(row.expires_at).getTime() > Date.now();\n\n  return {\n    key: row.entitlement_key,\n    active,',
    'override active state'
)

# Admin table labels expired overrides honestly while leaving Clear available.
admin = one(
    admin,
    '        const source = override\n          ? `${override.enabled ? "OVERRIDE ENABLE" : "OVERRIDE DISABLE"}${override.expiresAt ? ` · until ${formatDateTime(override.expiresAt)}` : ""}${override.reason ? ` · ${override.reason}` : ""}`\n          : `PLAN · ${capability.source || "plan"}`;',
    '        const source = override\n          ? `${override.active === false ? "EXPIRED OVERRIDE" : (override.enabled ? "OVERRIDE ENABLE" : "OVERRIDE DISABLE")}${override.expiresAt ? ` · until ${formatDateTime(override.expiresAt)}` : ""}${override.reason ? ` · ${override.reason}` : ""}${override.active === false ? ` · effective: ${capability.source || "plan"}` : ""}`\n          : `PLAN · ${capability.source || "plan"}`;',
    'expired override display'
)

server_path.write_text(server)
admin_path.write_text(admin)
print('Admin entitlement enforcement hardened.')
