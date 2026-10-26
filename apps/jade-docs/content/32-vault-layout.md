<!-- id: vault-layout | parent: settings-reference | level: 4 | order: 32 | tags: files, paths, layout, vault, jade folder -->
# Files Jade Vault uses inside the vault

| Path | Purpose |
| --- | --- |
| `/Jade/SOUL.md` | persona and voice, added to every prompt |
| `/AGENTS.md`, `/Jade/AGENTS.md` | your standing instructions |
| `/Jade/SYSTEM.md` | optional replacement for the built-in intro and guidelines |
| `/Jade/Memory.md` | durable memory facts |
| `/Jade/Journal/YYYY-MM-DD.md` | journal entries |
| `/Jade/HEARTBEAT.md` | the heartbeat checklist |
| `/Jade/CURIOSITY.md` | your steering for curiosity wake-ups |
| `/Jade/Curiosity/…` | what she wrote while curious (Explorations, Prepared, Questions.md) |
| `/Jade/skills/<name>/SKILL.md` | skills |
| `/Jade/Flows/<name>.flow.json` | flows |
| `/Jade/Config/Sentry.json` | Sentry rules |
| `/Jade/mcp.json` | MCP servers |
| `/Jade/Playbooks/<name>.json` | playbooks (outputs under `/Jade/Playbooks/out/`); old browser scripts were converted from `/Jade/Browser/Scripts/` |
| `/Jade/Tot/…` | think trees and `episodes.jsonl` |
| `/Jade/Logs/cron.log` | output of command and flow schedules |
| `/Jade/.index/vectors.db` | the vector/FTS index (a cache) |
| `/Jade/Tools/`, `/Jade/Data/` | scripts and data she (or you) put there |
| `/Templates/` | note templates |
| `/attachments/YYYY-MM-DD/` | files you attach in chat (PDFs get a `.pdf.md` text sidecar) |
| `/Apps/downloads/` | installed `.xdc` downloads |
| `/Welcome.md`, `/Inbox.md`, … | the starter notes |

Paths are inside the virtual vault. On Android the vault is the `JadeVault` folder on the phone.
