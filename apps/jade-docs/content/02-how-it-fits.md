<!-- id: how-it-fits | parent: overview | level: 1 | order: 2 | tags: architecture, layers, summary -->
# How the pieces fit

```
 you ──► chat / voice / Vector / Discord / HTTP API / webxdc app / schedule / sentry rule / curiosity wake-up
                │
                ▼
        ┌── Jade's turn ───────────────────────────────────────────────┐
        │ system prompt = base + SOUL.md + AGENTS.md + memory + skills │
        │ model (Ollama, cloud, Groq, llama.cpp, OpenAI-style)          │
        │      ◄──► tools ──► vault · shell · node · python · sqlite    │
        │                     web · MCP · senses · phone · screen        │
        │                     browser · ssh · flows · think · delegate   │
        └───────────────────────────────────────────────────────────────┘
                │                              ▲
                ▼                              │
        vault (notes + files)   memory (Memory.md, journal, vectors.db)
```

## Three ideas to hold on to

1. **One page, many layers.** `dist/jade-vault.html` is built by applying ordered, exact-match patches (`app/build.py`) to a base agent page and injecting feature modules. There is no bundler and no server. If a patch no longer matches the base, the build fails instead of producing something half-patched.
2. **The vault is the memory and the interface.** Settings that shape her (SOUL.md, AGENTS.md, HEARTBEAT.md, CURIOSITY.md, skills, flows, Sentry rules) are ordinary files she can read and, mostly, write. Her work products are notes.
3. **Everything risky is gated.** Secrets are written as `{{NAME}}` and filled in outside the model; calls, texts, SSH commands, new playbooks and restores ask you; web pages, SSH output and screen text are labelled as untrusted data; some settings she cannot edit at all.

## Who can start a turn

| Source | Notes |
| --- | --- |
| You, in the app | normal chat, voice, hands-free |
| Schedules | prompts, shell commands or flows, in plain English or cron |
| Heartbeat | every N minutes within active hours, reads HEARTBEAT.md |
| Curiosity | random wake-ups inside a window, steered by CURIOSITY.md |
| Sentry | a phone event matched a rule, which runs a flow |
| Vector / Discord | people messaging her bot, by role |
| HTTP API | `GET /v1/chat?message=…` on the phone |
| webxdc apps | an update with `notify` for jade@jade.vault (this app uses it) |
