from pathlib import Path

path = Path('scripts/migrate-passkeys-server-v016.py')
text = path.read_text()
old = '''one(
''' + "'''    abuseProtection: getRateLimitStatus(),\n    httpSecurity: getHttpSecurityStatus({ isProduction: IS_PRODUCTION })\n'''" + ''',
''' + "'''    abuseProtection: getRateLimitStatus(),\n    httpSecurity: getHttpSecurityStatus({ isProduction: IS_PRODUCTION }),\n    passkeys: getPasskeyStatus()\n'''" + ''',
'passkey health status'
)
'''
new = '''one(
''' + "'''    abuseProtection: getRateLimitStatus(),\n    httpSecurity: getHttpSecurityStatus({\n      isProduction: IS_PRODUCTION,\n      publicOrigin: process.env.PUBLIC_APP_ORIGIN || \"\"\n    })\n'''" + ''',
''' + "'''    abuseProtection: getRateLimitStatus(),\n    httpSecurity: getHttpSecurityStatus({\n      isProduction: IS_PRODUCTION,\n      publicOrigin: process.env.PUBLIC_APP_ORIGIN || \"\"\n    }),\n    passkeys: getPasskeyStatus()\n'''" + ''',
'passkey health status'
)
'''
if old not in text:
    raise RuntimeError('passkey health migration block not found')
path.write_text(text.replace(old, new, 1))
print('passkey health matcher fixed')
