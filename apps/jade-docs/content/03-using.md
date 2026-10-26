<!-- id: using | parent: overview | level: 2 | order: 3 | tags: guide, usage, daily -->
# Using Jade Vault

## First minutes

1. Open the app. Config → Model: pick the provider (local Ollama address, Ollama Cloud key, Groq, llama.cpp or an OpenAI-compatible endpoint) and a model. Add fallbacks if you want.
2. Chat. She can already read, write and search notes and use the shell.
3. Put standing instructions in `/AGENTS.md` (or `/Jade/AGENTS.md`) and her personality in `/Jade/SOUL.md`.

## What you can ask

- "Read my Inbox and file each item into its own linked note."
- "Schedule a weekly review every Sunday at 6pm." (a prompt, a shell command or a flow)
- "Build me a flow that triages /Inbox.md whenever it changes."
- "What did we decide about X last week?" (journal, memory and raw chat search)
- On the phone: "Set a timer", "What is the loudest it got in the last minute?", "Open the settings app and turn on Wi-Fi" (screen tool).

## Controls you have over her

| Control | Where |
| --- | --- |
| Which tools she is told about | Config → World switches (browser, screen, phone, Sentry, SSH, think, sub-agent), each shows its context cost |
| What she must ask first | calls, texts, SSH commands, new playbooks, restore (always you) |
| What she may spend | max tool rounds, context size, compaction, provider fallbacks |
| What she does on her own | heartbeat, curiosity, Sentry, schedules: each off until you turn it on |
| Her steering | SOUL.md, AGENTS.md, SYSTEM.md, HEARTBEAT.md, CURIOSITY.md, Sentry.json |
| Her memory | Memory.md and the journal are plain notes; edit or delete anything |

## Where things are in the app

Tabs: Chat, Notes (tree, search, editor, reader, links, graph), Flows, Schedule, Apps, Config (tabs: Model, Memory, Tools, Connect, App; with a search box over all settings). Hands-free voice and the Live2D avatar are in Chat. Kiosk mode (Config → App → Background) turns a spare device into a Jade-only machine.
