<!-- id: memory-and-search | parent: architecture | level: 3 | order: 12 | tags: memory, journal, embeddings, vector, bm25, search, chat history -->
# Memory, search and context

## Layers of memory

| Layer | What | Where |
| --- | --- | --- |
| Memory | durable facts, one bullet per line under sections; injected into every prompt | `/Jade/Memory.md`, `memory` tool (save, search, forget, list) |
| Journal | a short episodic entry per chat, written when you leave or compaction happens; new durable facts are also copied to Memory | `/Jade/Journal/YYYY-MM-DD.md` |
| Notes | your vault | anywhere, `.md` |
| Raw chats | every message, as stored (JSON with timestamps, sender, tool calls and results) | IndexedDB `session:<id>`, read with `chat_history` |
| Vector index | embeddings of memory, journal, notes, skills, chats | `/Jade/.index/vectors.db` |

## Hybrid search

`embed.js` keeps `vectors.db` (SQLite, FTS5 + sqlite-vec). A search runs **keywords (FTS5) and meaning (vector KNN)** and fuses them with reciprocal rank fusion. Embeddings come from Ollama's `/api/embed` (default `nomic-embed-text`; your own model/address/key in Config → Memory). If the embedder is missing it falls back to keywords, then BM25 (`vault_rankbm25`-style).

Collections: `memory`, `journal`, `notes` (default searches) and `skills`, `chats` (searched only on purpose). The `embeddings` tool: `search` (hybrid, semantic or keyword), `add` to your own collections, `index`, `remove`, `compare`, `status`.

## Raw chat search

`chat_history` actions: `list` the chats, `read` the original JSON messages of one (index, ts, sender, role, text, tool_calls, tool_name, error, images, attachments), `search` all chats by keywords and meaning together (hits are chunked per exchange; filtered by keyword or meaning > 0.4), `index` to (re)build. It only searches raw text; there are no automatic summaries. Gated by the memory switch.

## Context management

- Windows differ per model: `numCtx` (default 16384). Tools list about 10k tokens at full load, so each tool description is kept short.
- `ctxguard.js` estimates tokens, compacts old turns into a summary when a request gets too big (auto-compaction after N turns or when the previous answer used more than `compactPct`% of the window), then trims bulky tool results, and learns real limits from server errors.
- `/context` shows where the window goes (instructions, SOUL, AGENTS, skills, memory, MCP, tools, history).
