<!-- id: backup-system | parent: using | level: 2 | order: 19 | tags: backup, restore, server, encryption, rest api -->
# Backup system

## Manual export / import

Config → Backup: export **full** (notes, chats, schedules, settings) or **config** (settings and persona files), and import either. Secrets (API keys, saved SSH machines, backup token) are left out unless you tick "include keys". The ordinary export does not include everything: apps' update history lives in a separate database (`jade-xdc`).

## Scheduled backup to your server (2.17)

Settings → Backup: server address, token, interval (hours), kind, "include keys" (forces encryption), optional passphrase encryption. **Back up now**, **Test**, a list of what is on the server and **Restore** (asks before replacing anything).

- File: JSON → gzip (`CompressionStream`) → optionally AES-GCM with a PBKDF2 key (210,000 rounds). Names: `jade-vault-<kind>-<timestamp>.json.gz` or `.enc.json`.
- Upload: `PUT /backups/<name>` with `Authorization: Bearer <token>` and `X-Sha256`; the server verifies the checksum and stores atomically.
- Failure: retry after 15 minutes, doubling up to 6 hours; the reason is shown.
- Jade's `backup` tool: `status`, `now`, `list`. **She cannot restore.**
- There is no recovery if you lose the passphrase.

## The server

`server/jade-backup-server.py` (Python 3.9+, standard library only): `--init` makes the token file and folder; options `--host --port --dir --token-file --keep --max-mb --tls-cert --tls-key`. Routes: `GET /health` (no token), `GET /backups`, `PUT|GET|DELETE /backups/<name>`. Constant-time token compare, 1 s delay after a wrong one, names restricted to letters/digits/dot/dash/underscore ending `.json` or `.json.gz`, atomic writes, mode 600/700, size limit, newest N kept per kind. Plain HTTP exposes the token: use TLS or a trusted network, or encrypt. Full setup: [Scheduled backup to your own server](#doc:backup-server).

## Not tested on a real phone

Android's WebView and cleartext rules for plain-HTTP servers on non-local addresses were not exercised on a device when 2.17.0 was built.
