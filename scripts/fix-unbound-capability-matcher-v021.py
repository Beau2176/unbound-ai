from pathlib import Path

path = Path('scripts/migrate-unbound-mode-v021.py')
text = path.read_text()

old = '''    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    path.write_text(text.replace(old, new, 1))
'''
new = '''    count = text.count(old)
    if label == 'unbound non-stream capability' and count == 2:
        path.write_text(text.replace(old, new))
        return
    if label == 'unbound stream capability' and count == 0 and 'unbound_mode' in text:
        return
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    path.write_text(text.replace(old, new, 1))
'''

count = text.count(old)
if count != 1:
    raise RuntimeError(f'migration helper matcher: expected 1 match, found {count}')
path.write_text(text.replace(old, new, 1))
print('Fixed Unbound Mode duplicate capability matcher.')
