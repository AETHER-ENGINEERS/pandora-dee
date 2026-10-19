# Backups, storage, and migration

**Jade Vault 2.9.0** · [Documentation index](README-docs.md)

## Where data lives

| Store | Contents |
| --- | --- |
| IndexedDB `jade-vault`, object store `kv` | Virtual filesystem, chat/session data, schedules and other app records |
| localStorage keys beginning `jvault:` | Settings and small UI/runtime state |
| IndexedDB `jade-traj` | Model trajectory records |
| IndexedDB `jade-xdc` | Installed webxdc apps and ordered update history |
| TensorFlow.js IndexedDB storage | Models saved with `indexeddb://...` |
| Vector bridge state directory/volume | Separate bot identity, bridge token, messenger state |
| Discord bridge state directory/volume | Separate Discord bot token and bridge bearer token |

Browser storage belongs to a profile and origin. Android uses its WebView's app storage. Clearing site/app data, uninstalling, private browsing cleanup, or storage eviction can remove it. Notes are not automatically saved into a regular device folder. Keep independent exports outside the browser/app.

## Export

In Config's backup section, choose:

- **Full backup:** virtual files/directories, settings, selected localStorage state, and the `jade-vault` database records other than the separately serialized VFS.
- **Config export:** settings/state plus steering, memory, heartbeat, MCP configuration, and skills. Ordinary notes/chats are not included as a full vault archive.

Files are JSON named `jade-vault-backup-YYYY-MM-DD.json` or `jade-vault-config-YYYY-MM-DD.json`. Text files are strings; binary files are represented with base64 objects. Android opens a native Save as dialog; browsers download the file. Use **Copy JSON** if downloading is unavailable, then save the complete text in a secure file.

### Important coverage limits

“Full” is the name of the main vault backup, **not a dump of all browser databases**:

- Trajectories in `jade-traj` require their own JSONL export.
- Installed apps/update history in `jade-xdc` are not dumped by the normal backup function. Export app packages separately where useful; package export does not guarantee update-history recovery.
- TensorFlow.js models saved outside vault files need separate preservation.
- Vector's bot key/state and Discord's bot token/bridge state must be backed up on their respective bridge hosts, not through app exports.

Inspect the source and test a restore for your release before relying on backup coverage.

## Keys and sensitive content

By default, known provider keys, MCP secrets, HTTP secrets, Vector/Discord bridge tokens, and AICord key are omitted from exported settings. **Include keys** adds them. This is not a comprehensive sanitizer:

- Notes, MCP configuration, logs, and other files may contain credentials you placed there manually.
- The Android inbound `apiToken` is not in the current backup exclusion list; treat exports as potentially containing it even when Include keys is off.
- Personal notes, memory, and chats remain sensitive even without credentials.

Backups are ordinary JSON, not encrypted archives. Encrypt/store them appropriately, never commit them to Git, and inspect/redact before sharing. `includesKeys:false` describes the export setting, not proof that no secret exists anywhere in the file.

## Restore

1. Export the current installation before restoring anything.
2. Select a Jade Vault JSON backup using the import control.
3. Read the confirmation carefully:
   - A **full restore replaces** the current main vault, chats, schedules, and settings.
   - A **config restore merges** settings/configuration files while leaving ordinary notes/chats in place. Matching configuration files can still be replaced.
4. Confirm, wait for the reload, and verify notes, binary files, chats, and schedules.
5. Re-enter omitted credentials and check every integration/provider.

Known secret fields absent from a backup can retain current values during restore. Do not treat a restore as guaranteed credential rotation or a complete reset of all independent stores.

### Discord and Vector data

A full app backup includes their chat sessions through the main app database, and ordinary vault files such as `/Jade/Discord Inbox.md`, `/Jade/Vector Inbox.md`, and saved attachments. A config-only export is not an inbox/chat archive. Discord's bot token never belongs in the app settings; the bridge's `bot_token`/`token` files or Docker volume need separate secure preservation. See [Discord](discord.md#security-and-backup) and [Vector](vector.md).

## Migration and upgrades

To move between browser origins, profiles, phones, or browser/Android, export from the old installation and restore into the new one. Keep the old installation/export until verification succeeds. A source-code update or APK installation is not a backup.

For Android updates, use the same application id/signing key and a higher version code. Uninstalling to bypass a signing conflict can erase app data; export first. See [APK instructions](android-apk.md).

Implementation: backup functions in [extras.js](../app/modules/extras.js), with additional credential exclusions patched by [build.py](../app/build.py); separate databases in [traj.js](../app/modules/traj.js) and [xdc.js](../app/modules/xdc.js).
