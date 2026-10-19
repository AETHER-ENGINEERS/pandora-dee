# Compatibility and limitations

**Jade Vault 2.9.0** · [Documentation index](README-docs.md)

Use this guide to plan your installation, understand which features need a network connection, and decide what to back up.

## Supported platforms

| Platform | Requirements and behavior |
| --- | --- |
| Browser | A modern browser with JavaScript, IndexedDB, and WebAssembly support. Provider and integration requests must satisfy the browser's CORS and HTTPS rules. |
| Android | Android 7 or newer. The app uses Android WebView; keep WebView updated for browser features and security fixes. |
| Discord bridge | A separate computer running Python 3.9+ with the supplied requirements, or Docker. Discord support requires Jade Vault 2.8.0 or later. |
| Vector bridge | A separate macOS/Linux computer or Docker host running the Vector bridge and its agent. |

For installation, see [Getting started](getting-started.md), [Discord](discord.md), or [Vector](vector.md). To build your own APK, see [Build the Android APK](android-apk.md).

## Local storage and network access

Your notes, chats, memory, and settings are stored on your device. Local storage does not make every feature available offline:

- Chat needs access to the selected model server. The model may run on your own computer or with a cloud provider.
- Web search, HTTP requests, MCP tools, and messenger connections need their respective services.
- Some optional interface/runtime assets load externally. The Android build includes core rendering dependencies, but not every optional feature is independent of network access.
- Model prompts can contain notes, memory, chat history, images, and tool results. Configured fallback providers may also receive that context.

A phone's `localhost` address refers to the phone, not another computer. Use the model or bridge computer's reachable LAN/private-VPN address. HTTPS-hosted browser pages may block plain HTTP endpoints as mixed content; configure compatible TLS and CORS rather than disabling browser security.

See [Configuration](configuration.md) and [Security and privacy](security-and-privacy.md) for connection and data-sharing guidance.

## Models and scripting

Tool calling and image understanding depend on your provider/model. AICord offers character chat without tool calling, so it cannot perform normal vault-agent workflows. See [provider capabilities](configuration.md).

The shell's JavaScript and Python runtimes operate on Jade Vault's virtual files. They are not complete desktop Node.js/CPython installations: arbitrary npm packages, native extensions, host processes, and ordinary pip environments are not available. TensorFlow.js uses WebGL where supported and otherwise falls back to CPU. See [Shell and scripting](scripting.md).

Note scripts are read-only and have no direct network access by default. If you enable tool calls from note scripts/templates, those tools can still modify files or contact external services. Only enable that permission for notes you trust. See [Note scripts and templates](note-scripts-and-templates.md).

## Background work and messenger replies

Schedules, heartbeat checks, and messenger replies require Jade Vault to be running. Browser suspension, Android battery restrictions, a stopped app, or an unavailable model can delay or prevent work. Android background mode helps maintain uptime but does not guarantee delivery of every scheduled action or message.

Discord and Vector can be enabled together. They have separate bridge URLs, tokens, chats, and incoming queues, but Jade processes their agent turns **one at a time**. A busy conversation can delay another reply.

Discord's bridge drops bot-authored messages to avoid loops and discards queued messages older than **600 seconds** by default. Keeping the bridge online while Jade Vault is stopped does not preserve an unlimited backlog. See [Discord settings](discord.md#bridge-settings-and-diagnostics) to adjust the queue age limit.

## Discord-specific limits

- Sending vault files is limited to **8 MiB** in Jade Vault 2.9.0.
- Without Message Content Intent, the bot can still handle DMs and @mentions, but ordinary channel-text triggers are limited.
- The 2.9.0 bridge does not enable Server Members Intent or provide a setting for it. Enabling the intent in the Developer Portal alone is insufficient for member listing. Use individual user profiles instead.
- Outgoing allowed mentions are disabled, so messages do not notify @everyone, @here, or roles.

See the [Discord guide](discord.md) for participation rules, owner/admin/public permissions, and troubleshooting.

## Backup coverage

A **full backup** preserves the main vault's files, chat sessions, schedules, settings, and related app records. It does not include every independent data store:

| Data | What to do |
| --- | --- |
| Trajectory log | Export JSONL separately from its settings section. |
| Webxdc apps and update history | Export app packages where useful; package export does not guarantee recovery of board/message history. |
| TensorFlow.js models saved to IndexedDB | Preserve separately from ordinary vault files. |
| Vector bot identity and bridge state | Back up securely on the Vector bridge host. |
| Discord bot token and bridge state | Back up securely on the Discord bridge host. |

**Include keys** off omits known secret fields, including the Vector and Discord bridge tokens, from exported settings. It is not a complete sanitizer: the inbound Android API token (`apiToken`) is not in that exclusion list, and files can contain credentials you entered manually. Treat every backup as sensitive, unencrypted data.

Read [Backups and storage](backup-and-storage.md) before migrating, restoring, clearing browser storage, or uninstalling the Android app.

## Privacy in shared conversations

Non-owner messenger callers have restricted tools and do not receive ordinary private vault/memory context. However, Jade's SOUL persona text can appear in their prompts. Keep private facts out of persona text if you do not want them shared. Non-owner messenger scopes can also use web search.

Both messenger bridges and the inbound Android API use bearer tokens. Plain HTTP does not encrypt tokens or message content. Use trusted networks/private VPNs or the bridges' TLS support, and do not expose these services through public port forwarding.

For more detail, see [Security and privacy](security-and-privacy.md). For problems not covered here, see [Troubleshooting](troubleshooting.md).
