# Getting started

**Jade Vault 2.9.0** · [Documentation index](README-docs.md)

## Choose a platform

| Platform | Install | Important differences |
| --- | --- | --- |
| Browser | Open `jade-vault.html` from a release, or use a static-hosted copy | Browser storage is tied to the origin/profile; CORS and mixed-content rules apply |
| Android | Install a release APK on Android 7+ | WebView storage, native file saving, TTS, background service, optional HTTP API |
| Build from source | Follow the [development guide](development.md) | Node and Python required; APK also requires Java |

Use **version 2.9.0** release files or the corresponding source checkout for these guides. A later release may behave differently. Get release files from the repository's [Releases](https://github.com/AETHER-ENGINEERS/jade-vault/releases). Only install APKs from a source you trust. To create your own, see [Build the Android APK](android-apk.md).

A stable static URL is preferable to moving HTML files between locations. Changing protocol, hostname, port, or browser profile can make your existing browser vault appear absent because it uses different storage.

## First session

1. Open the app and explore the seeded Welcome, Inbox, Todo List, and guide notes.
2. Open **Config → Model** and choose a provider. Supply the endpoint and key where required.
3. Connect, select a model, and save the settings. See [configuration](configuration.md) for network requirements.
4. In Chat, try: `Read my Inbox and suggest a plan. Do not change any files yet.`
5. After reviewing the suggestion, ask Jade to create a linked note. Check the result in Notes.
6. Export a full backup from Config before importing substantial data or changing installations.

A model that supports tool calling is needed for normal agent workflows. AICord is character chat without tool calling, so it is not a substitute for a tool-capable agent model.

## Main work areas

- **Notes:** create, search, edit, read, and link Markdown files; inspect backlinks and the graph.
- **Chat:** ask Jade to work with the vault; review tool activity and replies.
- **Shell:** operate on the app's virtual files with BusyBox and browser-based runtimes.
- **Schedule:** configure timed prompts, commands, or flows.
- **Rituals:** build and inspect multistep automations.
- **Apps:** use offline webxdc mini apps, including Jade Link.
- **Config:** models, memory/steering, tools, integrations, backup, and platform settings.

## Optional messenger connections

Use [Discord](discord.md) or [Vector](vector.md) to reach Jade from a messenger. Each needs a separately running bridge, its own URL/token, and a configured owner identity. Discord's bot token stays on the bridge host; do not paste it into Jade's chat.

## Local data does not mean all features work offline

Notes and stored data live on this device. Model requests still require access to the selected model server. Web search, HTTP tools, MCP, Vector, and Discord need their respective services. Some runtime/UI assets are loaded externally. The Android build inlines core rendering dependencies, SQLite, and other embedded assets, but is not a promise that every optional feature is network-independent.

Schedules, heartbeat checks, and Vector/Discord replies need the app running. Both messengers can be enabled together, but Jade processes their agent turns one at a time. Android background mode helps keep the app alive; it is not an always-on server guarantee. See [automation](automation.md) and [troubleshooting](troubleshooting.md).
