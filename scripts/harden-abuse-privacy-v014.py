from pathlib import Path

path = Path('app/server.js')
server = path.read_text()

old = '''function ensureGuestRateToken(req, res) {'''
new = '''function clearGuestRateCookie(res) {
  const secure = IS_PRODUCTION ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${GUEST_RATE_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`
  );
}

function ensureGuestRateToken(req, res) {'''
if server.count(old) != 1:
    raise RuntimeError(f'guest cookie helper: expected 1 match, found {server.count(old)}')
server = server.replace(old, new, 1)

old = '''      clearSessionCookie(res);
      clearDeviceCookie(res);

      return res.json({
        ok: true,
        deleted: true'''
new = '''      clearSessionCookie(res);
      clearDeviceCookie(res);
      clearGuestRateCookie(res);

      return res.json({
        ok: true,
        deleted: true'''
if server.count(old) != 1:
    raise RuntimeError(f'deletion cookie cleanup: expected 1 match, found {server.count(old)}')
server = server.replace(old, new, 1)

path.write_text(server)
print('Permanent account deletion now clears guest rate-limit token too.')
