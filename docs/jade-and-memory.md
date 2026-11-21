# Pandora, memory, and skills

**Pandora Dee 2.10.11** · [Documentation index](README-docs.md)

## Working safely with the agent

Pandora can search, read, create, replace, and edit notes, execute scripts, access configured integrations, and run automations. Ask for inspection before changes when working with important data:

> Search my project notes and propose a reorganization. Do not write files until I approve.

Review the tool activity and resulting files. `write` replaces an existing file; `edit` uses an exact text replacement that must match once. Back up before bulk transformations. Tool availability depends on settings, provider capabilities, and the caller's role.

Replies have Copy, thumbs-up/down, and Retry controls. Ratings work even with trajectory logging off. Copy collects assistant text from the turn without thinking or tool output; Retry is offered only on the latest reply. Your messages can be copied/edited; code blocks and chats can be copied too. A retry or edited message can lead to another tool run, so do not assume external operations are idempotent.


### Tools, queued messages, and branches

When one reply asks for several tools, the read-only ones next to each other run at the same time: `read`, `notes_search`, `note_links`, `web_search`, `web_fetch`, `skill`, `find_skill`, `decide`, `tool_search`, the MCP resource lists, `discord_history`, and `chat_history` when listing, reading, or searching. Anything that writes or acts (`write`, `edit`, `bash`, `ssh`, phone, screen, browser, `memory`, MCP tools, and so on) runs on its own, in order, and the read-only calls on either side of it wait for it. Tool cards and results always appear in the order Pandora asked, whatever order they finish in. A `delegate` sub-agent groups its calls the same way.

A message you send while she's on a tool run waits in the queue above the message box and reaches her before her next round. Each queued message shows with **Edit** and **✕**. **Edit** takes it out of the queue and back into the box (in front of anything you've typed), so a half-fixed message is never delivered; send it again and it queues again. **✕** drops it. With the box empty, the **Up arrow** takes back the last queued message. While she's working, the button next to the box says **Queue** and only ever sends; a separate red **Abort** button beside it stops the turn.

The search box above the **Branches** list finds branches by what was said in them, not just their names: your messages, hers, compaction summaries, and tool calls with their results (so file names, repositories, and commands match too). Every word must appear, in any order or case. Matching branches keep their order, each with a highlighted line around the match; **Esc** or the box's **✕** clears it. It reads the saved branches directly, so it works without the memory index that `chat_history` search uses.

## Memory and journal

| Vault path | Role |
| --- | --- |
| `/Pandora/Memory.md` | Durable facts/preferences included in context |
| `/Pandora/Journal.md` | Entry point for the journal |
| `/Pandora/Journal/` | Daily notes summarizing earlier chats |

Ask `Remember that I prefer short weekly reviews` or use the memory tool's save, list, search, and forget actions. Memory is editable Markdown: review it for stale, incorrect, or sensitive facts. Journal generation is model-assisted and can use the configured provider; it is not a perfect transcript or guaranteed factual record.

### Optional BM25 memory retrieval

Under **Config → Memory → Long-term memory**, enable **Rank memories with BM25** to select memory bullets by relevance. It is **off by default**. Top-k defaults to **8**, bounded to **1–30**.

- Ranking runs locally with no embedding service or external vector database.
- It matches memory bullets against the last two user messages (up to the last 1,500 characters), not against every note in the vault.
- If no bullets match, it falls back to the five newest memory lines.
- Recent journal text is added separately; use memory search to retrieve older journal content.
- With BM25 disabled, the normal memory block is still budgeted (approximately 2,600 characters), so it does not necessarily include every stored fact.

Save the setting, then ask about a topic represented in your memory bullets. For important facts, explicitly ask Pandora to search/read the relevant source rather than assuming it is present in the current prompt.

## Steering files

| Path | Effect |
| --- | --- |
| `/Pandora/SOUL.md` | Persona, tone, values |
| `/AGENTS.md` and `/Pandora/AGENTS.md` | Standing user instructions |
| `/Pandora/SYSTEM.md` | Optional replacement for the base introduction/guidelines |
| `/Pandora/skills/<name>/SKILL.md` | On-demand instruction pack |

HTML comments in steering/skill content are removed before prompting. SYSTEM is a powerful override: prefer a small AGENTS addition for routine preferences rather than replacing the baseline instructions.

Example `/AGENTS.md`:

```markdown
# Working agreements
- Search for an existing note before creating one.
- Ask before deleting notes or sending external messages.
- Use YYYY-MM-DD dates and cite the note paths you used.
```

SOUL persona text can also appear in non-owner Vector/Discord prompts. Keep private facts in appropriate notes/memory rather than assuming persona text is owner-only.

These are model instructions, not a permission enforcement layer. Do not rely on a sentence in a prompt to isolate sensitive data.

## Create a skill

Create `/Pandora/skills/weekly-review/SKILL.md`:

```markdown
---
name: weekly-review
description: Review active projects. Use when the user asks for a weekly review.
---
# Weekly review
1. Search notes tagged #project and read relevant notes.
2. List unfinished tasks and unresolved questions.
3. Propose three priorities; ask before changing notes.
```

Skills are listed by name/description and loaded on demand with the skill tool or `/skill:weekly-review`. Keep descriptions specific and steps compatible with available tools. A skill is guidance, not installed executable code or a new permission boundary.

### The embedding index

With **Config → Memory → Embeddings** on, memory search also matches by meaning: texts are embedded by an Ollama embedding model (`nomic-embed-text` unless set) and kept in a sqlite-vec index inside the vault, `/Pandora/.index/vectors.db`. One text is a memory line, a journal section, a skill, a piece of a note (about 1,000 characters, when **Also index all my leaves** is on), or a chat exchange (once `chat_history` search has been used). **Test and rebuild the index** embeds everything again; otherwise only new or changed texts are embedded, in the background.

While embedding, a line at the top of the app shows how far it is: `Embedding 400 of 2,350 · about 6 min left`, then `Embedded 2,350 texts.` Config's status line shows the same. Progress is saved every 30 seconds, so if the page closes, the next start embeds only what's left. A failure says where it stopped and why; what was done is kept.

For a faster embedding server, three fields set how a build runs: **Texts per request** (16 unless set, up to 512), **Requests at once** (1 unless set, up to 8; Ollama answers several together only when its `OLLAMA_NUM_PARALLEL` allows), and **Save progress every** (30 s unless set). A change applies to a build already running, from its next round.

## Context and trajectories

Context guard compacts/trims history when needed. Use `/context` (or `/ctx`) in the app chat to inspect context usage; those slash commands are not available over the Android HTTP API. Chat prompts include device-local date/timezone information and message timestamps, so keep the device clock correct. Important durable facts belong in memory or notes, not only a long chat.

The trajectory log records model-visible runs in a separate `jade-traj` IndexedDB database. In Config, export JSONL in OpenAI chat-with-tools or ShareGPT format and filter by reply ratings (or type `/traj export`). The export says when it starts and, if it fails, why; a big log is saved in pieces. Compaction can split a run into multiple records. Exports may contain private prompt content, notes, and tool results: inspect before using them for training or sharing. Export trajectories separately from normal backups.

Sources: [memory.js](../app/modules/memory.js), [steer.js](../app/modules/steer.js), [ctxguard.js](../app/modules/ctxguard.js), [traj.js](../app/modules/traj.js).
