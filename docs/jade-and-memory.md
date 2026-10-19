# Jade, memory, and skills

**Jade Vault 2.9.0** · [Documentation index](README-docs.md)

## Working safely with the agent

Jade can search, read, create, replace, and edit notes, execute scripts, access configured integrations, and run automations. Ask for inspection before changes when working with important data:

> Search my project notes and propose a reorganization. Do not write files until I approve.

Review the tool activity and resulting files. `write` replaces an existing file; `edit` uses an exact text replacement that must match once. Back up before bulk transformations. Tool availability depends on settings, provider capabilities, and the caller's role.

Replies have Copy, thumbs-up/down, and Retry controls. Ratings work even with trajectory logging off. Copy collects assistant text from the turn without thinking or tool output; Retry is offered only on the latest reply. Your messages can be copied/edited; code blocks and chats can be copied too. A retry or edited message can lead to another tool run, so do not assume external operations are idempotent.

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

Save the setting, then ask about a topic represented in your memory bullets. For important facts, explicitly ask Jade to search/read the relevant source rather than assuming it is present in the current prompt.

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

## Context and trajectories

Context guard compacts/trims history when needed. Use `/context` (or `/ctx`) in the app chat to inspect context usage; those slash commands are not available over the Android HTTP API. Chat prompts include device-local date/timezone information and message timestamps, so keep the device clock correct. Important durable facts belong in memory or notes, not only a long chat.

The trajectory log records model-visible runs in a separate `jade-traj` IndexedDB database. In Config, export JSONL in OpenAI chat-with-tools or ShareGPT format and filter by reply ratings. Compaction can split a run into multiple records. Exports may contain private prompt content, notes, and tool results: inspect before using them for training or sharing. Export trajectories separately from normal backups.

Sources: [memory.js](../app/modules/memory.js), [steer.js](../app/modules/steer.js), [ctxguard.js](../app/modules/ctxguard.js), [traj.js](../app/modules/traj.js).
