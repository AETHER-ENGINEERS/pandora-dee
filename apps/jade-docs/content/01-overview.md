<!-- id: overview | parent: | level: 1 | order: 1 | tags: start, introduction, summary -->
# Jade Vault: overview

Jade Vault is an Obsidian-style markdown vault with an AI agent, **Jade**, built in. It runs as one HTML page in any modern browser and as an Android app (a thin native shell around that same page). Everything the agent does goes through the page: it reads and writes your notes, runs code in WebAssembly sandboxes, calls tools, remembers you, wakes on schedules, and on the phone it can use the camera, microphone, sensors, calls, texts, a second browser, other apps' screens and SSH.

**This documentation describes version 2.18.0.** The pages marked *Guides* from "Install and get started" to "Troubleshooting" were written for 2.9.0 and are still right about what they cover; everything added since is in the pages written for this edition and in the changelog.

## The pieces, in one paragraph

A **vault** (a virtual filesystem of notes and files) is the shared ground. **Jade** is a model-driven loop: she gets your message plus a system prompt built from her steering files, memory and skills, may call **tools**, and answers. The model is not part of the app: you point it at Ollama, Ollama Cloud, Groq, llama.cpp or any OpenAI-compatible server, with a fallback chain. Around the loop sit **memory** (a file, a journal and a vector index), **autonomy** (heartbeat, schedules, flows, Sentry reflex rules, curiosity wake-ups), **world tools** (senses, phone, screen, browser, SSH), **integration** (MCP, HTTP, Vector and Discord bridges, an HTTP API, webxdc apps) and **safety** (approvals, secrets, untrusted-data labelling, scoped permissions).

## How to read these docs

| You want | Go to |
| --- | --- |
| The one-minute picture | [How the pieces fit](#doc:how-it-fits) |
| To use it | [Using Jade Vault](#doc:using) and the *Guides* section |
| To know what a tool does | [Tools reference](#doc:tools) |
| How it works inside | [Architecture](#doc:architecture), [A turn, step by step](#doc:turn-lifecycle) |
| To change or extend it | [Extending Jade Vault](#doc:extending), [Build, test and release](#doc:build-test-release) |
| Exact settings, files, modules | [Settings](#doc:settings-reference), [Vault layout](#doc:vault-layout), [Modules](#doc:modules) |
| What changed when | [Changelog](#doc:changelog) |

The level buttons at the top (Overview, Guides, Internals, Reference) filter the tree and the search results. The search is ranked (BM25) across every section of every page. And you can **ask Jade** from the Ask tab: she reads these pages and the source and answers here. See [Talking to Jade in this app](#doc:docs-app).

## Numbers

About 47 JavaScript modules (about 1.26 MB of source, one 388 KB core), 32 tools in the full set (plus `find_skill` when the skill router is active), 23 Android Java classes (about 6,000 lines), 46 test suites, a Python bridge each for Vector and Discord, and a stdlib Python backup server.
