from pathlib import Path

path = Path('app/server.js')
server = path.read_text()

old = '''    const token = parseCookies(req)[SESSION_COOKIE];
    const tokenHash = token ? hashSessionToken(token) : null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        `SELECT id, password_hash FROM users WHERE id = $1 LIMIT 1 FOR UPDATE`,
        [req.user.id]
      );'''
new = '''    const association = await associateCurrentSessionWithDevice(
      req.user.id,
      req,
      res
    );
    const tokenHash = association.tokenHash;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        `SELECT id, password_hash FROM users WHERE id = $1 LIMIT 1 FOR UPDATE`,
        [req.user.id]
      );'''

count = server.count(old)
if count != 1:
    raise RuntimeError(f'current-device association: expected 1 match, found {count}')

server = server.replace(old, new, 1)
path.write_text(server)
print('Current-device revocation protection hardened server-side.')
