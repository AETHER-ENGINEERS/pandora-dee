# Pandora Dee documentation

Pandora Dee is a device-local Markdown Atelier with an AI companion, browser-based scripting, automations, and an Android wrapper, grown from Jade Vault. These guides follow **Pandora Dee 2.10.11**; UI labels may vary slightly between releases. Config has Model, Memory, Tools, Connect, and App tabs, plus a search box.

## Pandora Dee's words

Pandora Dee is the Jade Vault edition these guides now describe, and its interface uses the Atelier's words. Many guides still use Jade Vault's terms; they mean the same things:

| Jade Vault | In Pandora Dee's interface |
| --- | --- |
| vault | **Atelier** |
| note / page | **leaf** / **leaves** (the Leaves tab) |
| folder | **workshop** when you browse leaves; path fields and file pickers still say folder |
| tag | **sigil** |
| link | **thread** (backlinks keep their name) |
| daily note | **chronicle** |
| journal | **quest log** |
| flow (Flows tab) | **ritual** (Rituals tab) |
| owner | **Partner** |
| `/Jade/…`, `/Jade/Flows/` | `/Pandora/…`, `/Pandora/Rituals/` |
| `jade.*`, `jade` / `flow` commands, `/v1/flows` | `pandora.*`, `pandora` / `ritual` commands, `/v1/rituals` |

Jade Vault's names keep working: `jade.*`, the `jade` and `flow` commands, `/v1/flows`, `.flow.json` files and paths under `/Jade` all still resolve. Her tool names (`notes_search`, `read`, `write` and the rest) are unchanged; only `flow` became `ritual`, and calls to `flow` still reach it. See [Backup and storage](backup-and-storage.md#migration-and-upgrades) for how an existing install moves in.

## Version and compatibility

These guides cover **Pandora Dee 2.10.11**. They began as Jade Vault 2.9.0's, and most of that still applies as written. What's newer is in the [CHANGELOG](../CHANGELOG.md); the larger pieces since 2.9.0 are the People layer and the Vault Tree, chats that can be read while a turn runs, Vector's [digest mode](vector.md#digest-mode), curiosity's [thread clustering and loop halt](automation.md#curiosity-wake-ups), (2.10.8) [read-only tools that run side by side, queued messages you can fix, and search across branches](jade-and-memory.md#tools-queued-messages-and-branches), (2.10.9) [embedding progress and build settings](jade-and-memory.md#the-embedding-index) and [backups of big vaults](backup-and-storage.md#export), and (2.10.11) [fallback models on the same provider and a second Ollama address](configuration.md#fallbacks-and-model-capabilities). For platform requirements, network access, background operation, and backup coverage, see [Compatibility and limitations](compatibility-and-limitations.md).

## Start here

1. [Install and get started](getting-started.md).
2. [Configure a model provider](configuration.md).
3. [Write and organize notes](notes.md).
4. [Back up your data](backup-and-storage.md).

## User and integration guides

| Page | Contents |
| --- | --- |
| [Getting started](getting-started.md) | Browser and Android installation, first conversation, offline limits |
| [Compatibility and limitations](compatibility-and-limitations.md) | Platform requirements, network access, background work, backup coverage |
| [Configuration and providers](configuration.md) | Ollama, cloud providers, llama.cpp, AICord, fallbacks, secrets |
| [Notes and knowledge management](notes.md) | Markdown, links, tags, search, graph, images, attachments |
| [Pandora, memory, and skills](jade-and-memory.md) | Chat, tools, steering files, journal, skills, context management |
| [Shell and scripting](scripting.md) | BusyBox, JavaScript bridge, MicroPython, SQLite, TensorFlow.js |
| [Note scripts and templates](note-scripts-and-templates.md) | Dataview-style queries, inline expressions, Templater syntax |
| [Rituals and scheduling](automation.md) | Ritual JSON reference, expressions, schedules, crontab, heartbeat |
| [MCP and HTTP integrations](integrations.md) | MCP configuration, tool exposure, resources, HTTP requests |
| [Apps and Jade Link](apps.md) | Sandboxed webxdc apps, update protocol, packaging |
| [Discord](discord.md) | Bot creation, bridge setup, permissions, shared queue, diagnostics |
| [Vector messenger](vector.md) | Bridge setup, Docker, account ownership, roles, network safety |
| [Android HTTP API](http-api.md) | Authentication, routes, parameters, examples, error handling |
| [Backups and storage](backup-and-storage.md) | Full/config exports, restore, migration, separate data stores |
| [Security and privacy](security-and-privacy.md) | Data boundaries, credentials, code execution, licenses |
| [Troubleshooting](troubleshooting.md) | Provider, storage, automation, bridge, API, build problems |

## Developer and build guides

| Page | Contents |
| --- | --- |
| [Development and architecture](development.md) | Repository map, build pipeline, local serving, tests, contribution checklist |
| [Build the Android APK](android-apk.md) | Required tools, debug build, release keystore, signing, installation, upgrades |
| [Deployment and releases](deployment-and-releases.md) | Static hosting, GitHub Pages asset, release artifacts, CI and signing secrets |

## Project references

- [Project README](../README.md), [changelog](../CHANGELOG.md), and [version](../VERSION).
- [Browser deployment README](README.md) and [browser application](index.html).
- [Security policy](../SECURITY.md), [license](../LICENSE), and [third-party notices](../THIRD_PARTY_NOTICES.md).
- [Vector bridge reference](../pandora-vector/README.md).
- [Jade Link protocol](../apps/jade-link/README.md).
- [SQLite WebAssembly build reference](../sqlite-wasm/README.md).

> Paths such as `/Pandora/SOUL.md` are files **inside the app's virtual vault**, rather than paths in your computer's regular filesystem. Commands in build/development guides run on your computer; commands in scripting guides run inside Jade Vault unless explicitly stated otherwise.
