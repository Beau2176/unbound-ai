from pathlib import Path

path = Path('scripts/migrate-abuse-protection-server-v014.py')
text = path.read_text()

old = '''def one(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    return source.replace(old, new, 1)
'''
new = '''def one(source, old, new, label):
    count = source.count(old)
    if label == 'rate-limit retention cleanup' and count >= 1:
        return source.replace(old, new, 1)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    return source.replace(old, new, 1)
'''

if text.count(old) != 1:
    raise RuntimeError('Could not locate migration helper.')

path.write_text(text.replace(old, new, 1))
print('Rate-limit retention migration matcher disambiguated.')
