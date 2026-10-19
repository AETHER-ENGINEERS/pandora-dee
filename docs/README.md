# Jade Vault: browser version

**Jade Vault 2.9.0.** Start with [README-docs.md](README-docs.md) for the full user, integration, development, and Android APK guides.

`index.html` is the generated browser app, not the documentation index. Serve it from a static host; see [deployment instructions](deployment-and-releases.md). From a **2.9.0 source checkout**, rebuild with `npm install` and `npm run build`, then copy `android/proj/assets/index.html` to `docs/index.html` when updating the hosted app.

Notes, memory, chats, and settings are stored locally in IndexedDB/localStorage, but model requests and enabled web/HTTP/MCP/messenger features can transmit data to their configured services. Some assets also load externally. Read [security and privacy](security-and-privacy.md) and [backups and storage](backup-and-storage.md) before deployment or migration.
