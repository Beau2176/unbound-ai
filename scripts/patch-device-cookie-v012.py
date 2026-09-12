from pathlib import Path

server_path = Path('app/server.js')
server = server_path.read_text()

old = '  res.setHeader(\n    "Set-Cookie",'
new = '  res.append(\n    "Set-Cookie",'
count = server.count(old)
if count != 2:
    raise RuntimeError(f'cookie setter: expected 2 matches, found {count}')

server = server.replace(old, new)
server_path.write_text(server)
print('Session and device Set-Cookie headers now append safely.')
