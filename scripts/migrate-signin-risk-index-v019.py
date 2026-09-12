from pathlib import Path

path = Path('app/index.html')
text = path.read_text()


def one(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)


one(
'''        "passkey.signed_in": "Passkey sign-in",
        "recovery.codes_generated": "Recovery codes generated",
''',
'''        "passkey.signed_in": "Passkey sign-in",
        "auth.password_failed": "Failed password sign-in",
        "auth.password_signed_in": "Password sign-in",
        "recovery.codes_generated": "Recovery codes generated",
''',
'sign-in risk security event labels'
)

path.write_text(text)
print('Applied UNBOUND AI v0.19 sign-in risk UI migration.')
