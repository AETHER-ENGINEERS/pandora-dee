<!-- id: glossary | parent: overview | level: 4 | order: 33 | tags: glossary, terms -->
# Glossary

| Term | Meaning |
| --- | --- |
| Vault | the virtual filesystem of notes and files |
| Jade | the agent: model + prompt + tools + memory |
| Turn | one user message through to her final reply, with any tool rounds in between |
| Tool round | one model call that asks for tools, plus running them |
| Compaction | summarising old turns to free context |
| Skill | a `SKILL.md` procedure loaded on demand |
| Router | chooses which skills are listed for a message |
| Flow | a saved automation of steps |
| Heartbeat | periodic check driven by HEARTBEAT.md |
| Sentry | event-driven phone reflexes |
| Curiosity | random self-directed wake-ups |
| Ollaya | the local decision service used by `decide` and flow Decide steps |
| MCP | Model Context Protocol servers, configured in `/Jade/mcp.json` |
| webxdc / `.xdc` | sandboxed mini apps (a zip with index.html) |
| Jade Link | the built-in messenger plus shared board |
| Bridge | a small server (Vector, Discord) that connects a messenger to Jade |
| BM25 | the ranking function used by the docs search: term frequency × inverse document frequency with length normalisation |
| RRF | reciprocal rank fusion, used to merge keyword and vector hits |
| `ls` | the small key-value state store (`localStorage`, prefix `jvault:`) |
| `S` | the settings object |
