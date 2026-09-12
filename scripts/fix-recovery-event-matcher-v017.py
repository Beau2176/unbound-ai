from pathlib import Path

path = Path('scripts/migrate-recovery-index-v017.py')
text = path.read_text()

replacements = [
    ('"passkey.added": "Passkey added"', '"passkey.registered": "Passkey added"'),
    ('"passkey.signed_in": "Signed in with passkey"', '"passkey.signed_in": "Passkey sign-in"'),
]

for old, new in replacements:
    count = text.count(old)
    if count != 2:
        raise RuntimeError(f'expected 2 matches for {old!r}, found {count}')
    text = text.replace(old, new)

path.write_text(text)
print('Fixed recovery security-event matcher.')
