from pathlib import Path

path = Path('app/server.js')
text = path.read_text()
old = '.slice(-20);'
if text.count(old) != 1:
    raise RuntimeError(f'Expected one cleanHistory slice, found {text.count(old)}')
text = text.replace(old, '.slice(-50);', 1)
old_guest = ': cleanHistory(req.body.history);'
if text.count(old_guest) != 2:
    raise RuntimeError(f'Expected two guest history sites, found {text.count(old_guest)}')
text = text.replace(old_guest, ': cleanHistory(req.body.history).slice(-20);')
path.write_text(text)
print('History import preservation fix applied.')
