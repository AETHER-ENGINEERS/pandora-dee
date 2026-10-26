<!-- id: think-delegate | parent: using | level: 2 | order: 18 | tags: think, tree of thoughts, delegate, sub-agent, verification -->
# Think (tree of thoughts) and delegate (sub-agent)

## `think` (2.16.1)

A tree of reasoning with verification. Jade (or the harness in `auto` mode) branches several lines of thought; each is checked by something that can say no; the best **verified** line is the answer.

- Verifiers: `code` (JavaScript, read-only), `file`, `rubric`, independent `judge`.
- Search modes: `beam` (default), `best_first`, `puct`, with hard budgets in nodes, seconds and tokens. `next` says whether to check or expand and why; `auto` proposes, verifies and backs off bad lines.
- Trees are saved after every step and reload after a restart. `close` records an episode (`/Jade/Tot/episodes.jsonl`) with the pivotal thought.
- `candidates:true` makes the proposer give the answer value itself (a path, a snippet) instead of a plan.
- Not built yet, by design: a learned value model, a PPO controller, a strategy pool, a self-improvement lab (see the design document).
- The tool definition is small; `think help` has the procedure. A vault copy (`think.js` + skill `think-before-acting`) exists for older builds.

## `delegate` (2.17)

A sub-agent: a short tool loop of its own with a clean context that returns **one report**, so pages and search results never fill her context. Read-only by default (read, notes_search, note_links, web_search, web_fetch, skill, find_skill, decide, tool_search); `write:true` adds write, edit, bash. Eight steps by default (max 15), 120 s (max 300). It cannot nest or run twice at once; the report is capped at 6,000 characters and framed as data.
