from pathlib import Path

path = Path('scripts/migrate-recovery-index-v017.py')
text = path.read_text()
old = ''''''        \\\"sessions.all_revoked\\\": \\\"All sessions logged out\\\",\n        \\\"passkey.added\\\": \\\"Passkey added\\\",\n        \\\"passkey.removed\\\": \\\"Passkey removed\\\",\n        \\\"passkey.signed_in\\\": \\\"Signed in with passkey\\\"\n'''','''
new = ''''''        \\\"sessions.all_revoked\\\": \\\"All sessions logged out\\\",\n        \\\"passkey.registered\\\": \\\"Passkey added\\\",\n        \\\"passkey.removed\\\": \\\"Passkey removed\\\",\n        \\\"passkey.signed_in\\\": \\\"Passkey sign-in\\\"\n'''','''
if old not in text:
    raise RuntimeError('old recovery event matcher was not found')
text = text.replace(old, new, 1)
old_new = ''''''        \\\"sessions.all_revoked\\\": \\\"All sessions logged out\\\",\n        \\\"passkey.added\\\": \\\"Passkey added\\\",\n        \\\"passkey.removed\\\": \\\"Passkey removed\\\",\n        \\\"passkey.signed_in\\\": \\\"Signed in with passkey\\\",\n        \\\"recovery.codes_generated\\\": \\\"Recovery codes generated\\\",\n        \\\"recovery.code_used\\\": \\\"Account recovered with recovery code\\\"\n'''','''
new_new = ''''''        \\\"sessions.all_revoked\\\": \\\"All sessions logged out\\\",\n        \\\"passkey.registered\\\": \\\"Passkey added\\\",\n        \\\"passkey.removed\\\": \\\"Passkey removed\\\",\n        \\\"passkey.signed_in\\\": \\\"Passkey sign-in\\\",\n        \\\"recovery.codes_generated\\\": \\\"Recovery codes generated\\\",\n        \\\"recovery.code_used\\\": \\\"Account recovered with recovery code\\\"\n'''','''
if old_new not in text:
    raise RuntimeError('new recovery event matcher was not found')
text = text.replace(old_new, new_new, 1)
path.write_text(text)
print('Fixed recovery security-event matcher.')
