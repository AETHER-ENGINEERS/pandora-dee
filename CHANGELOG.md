# Changelog

## Unreleased
- **A desktop app, with her vault as a real folder.** `desktop/` (Electron) opens the Atelier in its own window. Her
  vault is a folder you pick on the computer, not the browser's database: every note is an ordinary file there, so
  bash, a file manager and MCP file tools all see the same `/Pandora/SOUL.md`. The vault's existing disk mode (the
  Android app's) runs on it unchanged, through the same synchronous bridge. Deleted files, and files a full restore
  replaces, go to a trash folder beside the vault instead of being removed. The browser keeps working as before.
  It's an option for whoever wants the Atelier in a window of its own: like any Chromium-based window, its text can
  look soft at fractional display scaling (115%, 125%…). Firefox, and the native ISLANDS window, draw it crisper.
- **Moving a browser vault in loses nothing.** When a vault in the browser's database moves into a folder (a full
  backup restored in the desktop app, or the first start of the Android app's folder vault), a file the folder already
  has with different contents stays as it is, and the moved version is saved beside it, marked "from the browser".
  Before, the moved version was dropped. In the desktop app, a full restore into a folder that already has files asks
  whether to keep them and add the backup's, or to replace them.

## 2.10.11
- **Fallback models on the same provider.** One Ollama can serve cloud models (through your Ollama account) and local
  ones, but a fallback used to have to be another *provider*. Config → Model provider now takes a list of fallback
  models for the provider (comma-separated, in order). When the chosen model hits its usage limit (or its server
  errors), she goes on with the next model on that same provider before trying another provider. The model that ran
  out rests (30 minutes for a limit, 5 for an error), and your chosen model comes back by itself once it has rested.
  Your choice stays the remembered one throughout.
- **A second Ollama address.** "Second Ollama" is a provider of its own, with its own address and remembered model.
  When your main Ollama is on another machine (reaching Ollama Cloud for you), the Ollama on this computer can be the
  fallback, the heartbeat's model or the helper model. Before, both were "Ollama", with one address between them.

## 2.10.10
- **Send and Abort side by side.** While a turn ran, the one button turned red and said Abort: with text in the box
  it queued the message, with the box empty it stopped her, which was easy to hit while fixing a queued message. Now a
  separate red Abort sits next to Send while she's working and only ever stops the turn; Send says Queue during a
  turn and only ever sends (an empty box does nothing).
- **Strict models accept the chat history.** Kimi K3 refused requests with "tool message 1 has no resolvable tool
  name": the history held a tool call without a name (some models or streams leave it out) or a result it couldn't
  tie to a call. Before the history goes to any provider, a call without a name is left out and its result goes in as
  a note, every result names its tool, and OpenAI-style tool messages carry the tool's name too. The chat itself
  isn't changed.
- **MCP entries that can't work say why, Reconnect included.** Reconnect (the button, `/mcp reconnect <name>`)
  skipped the check that loading does, so an entry without an address tried to reach "undefined" and blamed CORS.
  It now shows the real reason, such as "stdio servers (\"command\") cannot run in a browser… use its url". The
  address may also be written `serverUrl` (Windsurf) or `httpUrl` (Gemini CLI), and a `command` entry that also has a
  `url` connects through the url.

## 2.10.9
- **Big backups work.** A backup was made as one giant JSON string of the whole vault and every chat, so with a big
  vault (thousands of chats, a large vector index) Firefox ran out of memory and the button said "Export failed:
  undefined". Backups are now written in pieces, one line per file and one per chat: joined it's the same JSON any
  version opens, but it's never one string (Export everything, Export config, and the scheduled backup to a server).
  Restoring reads a big backup line by line, through gzip too; a big backup from before this version says why it
  can't be opened. A failure shows its reason, never "undefined". Copy JSON is offered for backups up to 20 MB.
- **A quieter, correct browser console.** The web page now has a doctype, so browsers run it in standards mode like
  the Android page (it ran in quirks mode, where KaTeX warns it doesn't work). PowerShell and Windows batch code
  blocks (` ```powershell `, ` ```cmd `, ` ```bat `, ` ```ps1 `) fetch their highlight.js language pack the first
  time one appears and are coloured; any other language highlight.js doesn't know is shown as plain text instead of
  logging a warning per block. PixiJS no longer points at a source map that isn't shipped.
- **Tune how the embedding index builds.** Config → Memory → Embeddings has three new fields: texts per request
  (16 unless set, up to 512), requests at once (1 unless set, up to 8; Ollama runs them together when
  `OLLAMA_NUM_PARALLEL` allows), and how often progress is saved (every 30 s unless set). A faster embedding server
  across the network spends far less time waiting on round trips. A change applies to a build already running, from
  its next round, and when one request of a round fails, what the others brought back is kept. The build also counts
  what's left less often, so each round has less overhead.
- **Trajectory export no longer fails in silence.** Export JSONL (and `/traj export`) says at once that it's working,
  can't be pressed twice, and says why when it fails, where before a failure showed nothing at all: no file, no
  message. A big log is handed to the file in pieces, one per run, instead of one giant string plus a copy of it,
  which could run out of memory. A trajectory log that another open copy of the app holds now says so instead of
  waiting forever, and is tried afresh next time. Downloads keep their file link for a minute, so a big one finishes.
- **Embedding says how far it is.** Building the vector index (Config → Memory → Test and rebuild, or the
  background catch-up after memory, journal or notes change) shows a line at the top, wherever you are in the app:
  "Embedding 400 of 2,350 · about 6 min left", then "Embedded 2,350 texts." Config's status line shows the same. A
  failure says where it stopped and why. The index is saved every 30 seconds along the way, so closing the page loses
  at most that much, and the next start embeds only what's left. Two runs at once take turns instead of embedding the
  same texts twice.

## 2.10.8
- **Read-only tools run side by side.** When one reply asks for several tools, the read-only ones next to each other
  (read, notes_search, note_links, web_search, web_fetch, skill, find_skill, decide, tool_search, the MCP resource lists,
  discord_history, chat_history list/read/search) now run at the same time. Anything that writes or acts (write, edit,
  bash, ssh, phone, screen, browser, memory, MCP tools, …) still runs on its own, in order, and splits the groups. Cards
  and results stay in the order she asked. Before, only a reply made entirely of web_search / web_fetch ran together.
  The delegate sub-agent groups its calls the same way. (As in PDA SEASIDE and Jade Vault 2.20.)
- **Fix a queued message before it's delivered.** A message sent while she's on a tool run waits in the queue; the
  note above the message box now lists each one with **Edit** and **✕**. Edit takes it out of the queue and back into
  the box (in front of anything already typed), so a half-fixed message is never delivered; send it again and it
  queues again. ✕ drops it. With the box empty, the Up arrow takes back the last queued message.
- **Search the branches.** A search box above the Branches list finds branches by what was said in them, not just
  their names: your messages, hers, compaction summaries, and tool calls and their results (file names, repos,
  commands). Every word must appear, in any order or case. Matching branches keep their order, each with a line around
  the match; Esc or ✕ clears it. It reads the saved branches directly, so it works without the memory index.

## 2.10.7
- **Vector: a digest of the rest.** "In channels she answers" has a middle choice: "When named, and a digest of the
  rest". Being named, replied to or a trigger word, and DMs, are answered right away as before. Every other message in
  a channel she's in waits, and every so often (Digest every … minutes, 30 unless set; sooner once 40 are waiting)
  they come to her as one turn, each with who said it, to answer once as a whole or let pass. When she's named, what
  was waiting in that channel comes along, so she answers with the thread in view. (Filed by Pandora Dee Fae.)
- **Curiosity: one thread, one entry; loops halted.** Each wake-up now names its subject when she reports. Wake-ups on
  the same subject within two hours are one thread: the engine keeps one cluster entry for it under
  /Pandora/Sparks/clusters/, each wake-up a sub-item, and tells her about it at the next wake-up, so she adds to the
  thread instead of writing another note about it. A third in a row halts the thread whatever the clustering did: it's
  filed under /Pandora/Sparks/loop-halts/, she leaves one question in Questions.md, and the subject rests for 12 hours.
  She can tag a wake-up thread "same" or "new", and the engine learns where a thread ends. (Filed by Pandora Dee Fae.)
- Tests: `vector_digest_test`, `spark_clusters_test`.

## 2.10.6
- **Chats can be read while a turn runs.** The chat list used to ignore clicks until a turn was done, and with Vector,
  Discord or the heartbeat on, that's often. Now a click opens the chat to read while the turn carries on in its own
  chat. Anything sent there waits, and when the turn ends that chat opens and gets it. "Back" returns to the running
  chat and puts anything unsent back in the box. The list marks the chat being read and the busy one.
- **web_search says why it failed.** Firefox's "NetworkError" and Safari's "Load failed" now read as blocked, like
  Chrome's. When nothing answers, it says to check the connection first. If the connection is up, the servers are
  refusing pages opened on their own (CORS), which Ollama's web search always does and most SearXNG instances do too.
  Pairing with PDA SEASIDE (Config → Connect), or opening the Atelier inside it, sends the searches through the desktop.
- Tests: `chat_peek_test`, `search_hint_test`. `JV_CHANNEL=msedge` runs the browser tests on an installed browser.

## 2.10.5
- **The HTTP API token stays out of backups.** A backup made without "Include API keys" left out every key but that
  one (Config → Connect → API endpoint). Now it's left out too, and a restore keeps this device's own. Backups made with
  2.9.9.2 through 2.10.4 still carry it, so keep those files private. A new test (`backup_keys_test`) fails if a
  key-like setting is ever missing from the list again.

## 2.10.4
- **Bridges keep to their rooms.** Something typed in the Atelier while Pandora was answering on Vector or Discord
  went into that channel's chat, and her answer to it was posted to the channel. Now what's typed meanwhile waits and
  goes to the chat it was typed in; Vector and Discord turns wait while you're typing; and each turn posts only its own
  chat's reply, to its own channel. (Filed by Pandora Dee Fae.)
- **Coming from 2.9.9.2?** Everything since is below: the People layer, the Vault Tree, a clean stock SOUL, her first
  notes in her own voice, the Storybook, the context-guard fix, Jade Vault's additions through 2.22.1 (each off until
  switched on), and http_request's guards. It opens the same vault: notes, chats, memory and settings carry over. Make
  a backup first (Config → Backup) all the same.

## 2.10.3
- **http_request keeps to where it should go.** This device, the home network and a tailnet are out of reach unless
  the address is listed in Config → Secrets → "Local addresses", so a page Pandora reads can't steer a request at the
  router, a service on this device or another app's keys.
- **Secrets tied to their hosts.** A secret can be given hosts (`api.github.com, *.githubusercontent.com`): it's only
  ever sent there, even when a playbook already filled it in, and it stays out of scripts' `process.env`.
- **No redirects with a secret in the request**, since a key header would go along to wherever the redirect leads;
  the result says it redirected instead.

## 2.10.2
- **Her first notes are her own.** A fresh vault's Memory, Journal and Storybook notes start in Pandora's voice, as
  reminders to herself, and a new **Where I Am** note says where she lives, how she uses it and who she begins as.
  Memory's sections are now "Who I work with" and "How they like things"; vaults made earlier keep their headings and
  she keeps writing under them.
- The Heartbeat note and the memory notes no longer say "Jade" in Pandora's vault.

## 2.10.1
- **Names, not ranks (the People layer).** Pandora's prompts, bridges and messages name the person she's with (from
  a dossier in `/People/<name>.md`, or the labels in Config) instead of calling anyone "the user" or "the owner". A
  check in CI keeps rank words out of the built app.
- **The Vault Tree.** A new chat is a new branch: New branch, Branches, Rename / Copy / Delete this branch.
- **Context guard** understands "prompt too long; exceeded max context length by N tokens" (Ollama Cloud's wording):
  it learns the real limit from how far over the prompt went, trims and retries.
- **A clean stock SOUL.** New installs start from a hand-written character sheet with no permission gates, and she
  comes with her cat, Mrrowr-murrr. The base prompt no longer says "only offer help when it is wanted".
- **The Storybook** (Config → Memory, off until you switch it on): each branch is a book and each chat its next scene,
  in two first-person voices (what happened in the room, and her own thoughts inside), stamped in UTC to the second
  and tagged with its room. Only what's new goes in, saved secrets are redacted, and facts from a private room stay in
  that room's book.
- CI runs the app tests on Ubuntu 24.04: Playwright has no Chromium for Ubuntu 26.04 yet.

## 2.10.0
Everything Jade Vault adds, through Jade Vault 2.22.1, comes to Pandora in her own words (/Pandora paths, rituals,
leaves). Every tool and feature that needs a switch has its own and starts **off**: with nothing switched on,
Pandora behaves as 2.9.9.2.
- **Simply in:** the Rust core (web pages to Markdown for web_fetch), web_search and web_fetch together, a steady tool
  list with the tool router, a faster leaf index, one unreadable file no longer breaking every shell command,
  TensorFlow.js on WebGPU (else WebGL, else the CPU), an offline terminal (xterm in the phone page).
- **Memory:** embeddings (hybrid search with SQLite FTS5 + sqlite-vec) and ranked memories (keywords + meaning).
- **App → Voice & senses**, each its own switch:
  - senses and the Talk button (hands-free voice, wake phrases, vision and transcription models);
  - look, and models on this device: .tflite (litert, WebGPU by default) and .onnx (onnx, ONNX Runtime);
  - **usb**: USB devices you plug in and allow, one at a time;
  - browser, phone and screen (Android app only); Sentry rules and SSH sessions (Android app only);
  - think (tree of thoughts), delegate (a sub-agent), chat_history (search past chats);
  - Playbooks (a tab, a tool, schedules and ritual steps), the skill router and tool router, curiosity wake-ups.
- **App → Background:** scheduled backups to a server (encrypted on the device), and the backup tool.
- **App:** the vault on real storage, and kiosk mode (Android app only).
- "Ask me before Pandora places a call, sends a text…" stays on: it guards those tools, which are themselves off.

## 2.9.9.2
- **A fantasy companion.** Pandora no longer follows the pointer, and the scanlines and cyber grid are off unless you
  switch them on; she stands in a soft pool of her gem's light. Custom Gradient is now Gradient.
- **Config → Appearance:** her gemstone theme and the colours of her hair, clothes, stockings, boots and skin; the
  atmosphere switches; text size and layout.
- **Fixes from 2.9.0 reports:** layer colours now reach the screen, and images picked for a leaf go in (in the APK,
  gallery picks were read as nothing picked; files with no type were dropped).
- **Leaves:** rename a leaf or a workshop from its ⋯ menu (threads follow), delete an empty workshop, Tidy them all
  away; find and replace in the editor (Ctrl/Cmd+F, Ctrl+H); button strips scroll with a mouse drag or the wheel.
- **Import from Google Keep, Samsung Notes and Apple Notes,** plus HTML, Word and PDF, into `/Imported/`.
- **Release files carry the version:** `pandora-dee-<version>.html` and `jade-link-<version>.xdc`, like the APK and
  the bridge kits.

## 2.9.9.0
- Scripts see big files such as backups (the "parentheses" loop); the roomy layout for wide screens, with draggable
  widths and dividers and a text size; webxdc apps no longer lose changes made at the same moment; the web page runs
  the patched DOMPurify 3.4.17 and KaTeX 0.19.0.

## 2.9.0
- **Discord archive** (`--archive`, off by default): the Discord bridge keeps every message the bot can see on the
  computer it runs on, whether or not the app is open, as append-only JSON lines per channel and thread. People, bots,
  webhooks and Jade herself, edits, deletions, replies, embeds, reactions, and attachments downloaded before Discord's
  links expire. DMs only with `--archive-dms`. The reply queue is unchanged: it still drops what is older than
  10 minutes and never carries bots.
- **Backfill** (`--backfill`, or the `archive_backfill` tool): the whole history of every channel, active and archived
  thread and forum post, oldest first, resuming where it stopped.
- **Render** (`--render OUT_DIR --name … --description …`): the archive as an Obsidian-style vault under a name you
  choose, a note per channel and month and per thread, replies linked to the message they answer, images embedded.
- `archive_status` and `archive_search` tools; `./setup.sh --archive`; `JADE_DISCORD_ARCHIVE` for Docker.
- Discord bridge: `JADE_DISCORD_HOST=127.0.0.1 ./setup.sh` keeps it on the server itself (for a VPS, reached over SSH or
  Tailscale); discord.py's voice extra (PyNaCl, davey) is installed by default, with ffmpeg and opus in the Docker image.
- Tests: the gem-theme checks can see Jade (`window.Jade`); all 27 suites pass.

## 2.8.0
- **Discord bridge** (`jade-discord/`, built on discord.py) and a **Discord** section in Config. Jade lives on Discord as a bot:
  she answers DMs and channels, reacts, replies in threads, sends and receives files, sees images, reads channels, and takes
  messages for you, with the same roles as Vector (owner = the full Jade, admins = Discord powers only, everyone else =
  chat and leave a message), a channel whitelist, trigger words and a DM policy. The bot runs in a small discord.py program
  on a computer you keep on (Gateway, resume and rate limits are discord.py's job) and is served over HTTP with a bearer
  token, exactly like the Vector bridge; the app polls it. Setup script, Docker image and a README are included.
- **Runs at the same time as Vector.** Each bridge has its own port, token and chats (🎮 Discord, 💬 Vector), and the two
  share one conversation queue: Jade only ever answers one chat at a time, then wakes the other queue.
- Safety: every message the bridge sends has empty `allowed_mentions` (no @everyone, @here or roles), bots are never queued
  (no loops), stale messages (older than 10 minutes) are dropped, and the bridge token is left out of backups.
- The Message Content Intent is optional: if it is off in the Developer Portal the bridge carries on (DMs and @mentions) and
  the app says how to switch it on.
- `notify_owner` and the Discord inbox (`/Jade/Discord Inbox.md`) work like Vector's; `/discord` opens the settings.

## 2.7.3
- **AICord provider** (Config → Model provider, also in the fallback list and the compaction / heartbeat model menus). Your
  AICord characters appear as the model list; chat goes to `POST /chat` with the character UUID and the history. Replies
  arrive whole (the API does not stream) and AICord has no tool calling, so Jade cannot use the vault through it: best as a
  chat model or fallback. Jade's system prompt travels as context in the first user turn. 401 / 402 / 403 / 404 show readable
  messages. The key is stored like the other keys and left out of backups.

## 2.7.2
- **TensorFlow.js 4.22 in Jade's scripts**: `tf` and `require('@tensorflow/tfjs')` in `node` (shell, flow JavaScript steps,
  Jade's bash). Embedded (no download), unpacked only for scripts that use it. GPU (WebGL) when it works in the WebView's
  worker, otherwise the CPU backend, with TensorFlow's own probing messages kept out of the output. Models persist with
  `indexeddb://`. Not loaded into note scripts.
- node scripts understand `import * as x from '…'`, `import x from '@scope/pkg'` and side-effect imports.

## 2.7.1
- **Reply bar** under each of Jade's replies: **Copy** (everything she said in that turn, as Markdown, without tool
  output), **👍 / 👎** (now always there, not only with the trajectory log on) and **Retry** on the newest reply, which
  runs your last message again and replaces her answer (also after an error).

## 2.7.0
- **Flows**, a small n8n in its own tab: steps of Jade's tools, JavaScript, shell commands, Ollaya decisions, AI answers,
  full Jade chat turns, notes, if / switch / for-each, wait, notify and other flows, with `{{ expressions }}`, retries,
  continue-on-error and a step-by-step run log. Triggers: by hand, schedule, note or folder change. Run them from the
  shell (`flow run`), from scripts (`jade.flow`), from schedules and crontab, over the API (`/v1/flows`, `/v1/flow`), and
  Jade builds and runs them with her new `flow` tool. Kept as JSON in `/Jade/Flows`.
- **Scripting Jade**: `jade.tool()`, `jade.decide()` (structured Ollaya decisions), `jade.ask()`, `jade.agent()`,
  `jade.flow()`, `jade.shell()`, `jade.notify()` and `jade.kv` in the shell's `node`; `jade` and `flow` shell commands.
- **Schedules run shell commands and flows** (Schedule tab, the schedule tool, and a new `crontab` command with crontab
  files and `@daily` macros). They run on their own, log to `/Jade/Logs/cron.log` and notify you on failure.
- **Note scripts & templates** (Obsidian style): live `dataviewjs` / `jade-js` blocks and inline `$=` values with a
  Dataview-like `dv`, and Templater templates (`<% tp.date.now() %>`, `<%* %>`, prompts, includes, cursor) inserted with
  the { } button. Sandboxed: no network, no file changes, tools only if you allow them.
- Fix: a BusyBox command no longer undoes files written while it ran (it replaced the whole vault with its starting copy).
- Fix: notes written and opened at once are already in the link/tag index.
- The bottom bar has seven tabs; settings gain a "Note scripts & templates" section (Tools).

## 2.6.0
- **HTTP API (Android app).** Jade listens on a port you choose and answers GET requests with JSON. A message sent
  to `/v1/chat?message=...` goes through the normal chat: it shows up in the app and she answers there, and the reply
  comes back as JSON (`reply`, `session`, `tool_calls`, `model`, `elapsed_ms`, `error`). Also `/v1/status`, `/v1/history`,
  `/v1/chats` and a public `/v1/health`. Token required on every call (`Authorization: Bearer` or `?token=`); off by
  default; local only unless you allow your Wi-Fi. Input can also be one JSON object (`?json={...}`). Keeps the app
  alive in the background while on. Settings → Connect.
- **Memory retrieval with BM25.** Optional: only the memory lines that match your recent messages go into the system
  prompt (Okapi BM25, top-k adjustable). Off by default.
- **Settings are split into tabs** (Model, Memory, Tools, Connect, App) with a search box, and Save stays in view.
- Python: a corrupt or empty cached MicroPython runtime is detected and downloaded again.
- Browser build for GitHub Pages in `docs/`.

## 2.5.0
- **Jade on Vector messenger.** She runs as a Vector bot through the new Jade Vector bridge (Vector's own
  `vector-agent` plus a token-protected HTTP bridge; macOS, Linux or Docker).
  - Answers DMs and whitelisted channels: always, or only when named or replied to. Trigger words are configurable.
  - Owner / admin / public permission tiers. Each Vector chat gets its own chat in the app.
  - Reactions, typing indicator, threaded replies, files both ways; she sees the images people send.
  - Joins and leaves communities. Invites from you or admins are accepted automatically.
  - Plays Mini Apps shared on Vector, woken by new moves.
  - Secretary: `notify_owner` files messages in `/Jade/Vector Inbox.md`, or tells you at once (DM + notification), per setting.
  - `vector` tool for any task in the app: message, send a file, react, read chats, moderate, run any vector-agent tool.
- Chats save before the app switches between them (a background turn could lose the last message).
- Going back to the chat you were in after a background turn now works for a new, still-empty chat.
- Production repo: reproducible web build, APK build without the Android SDK (hash-pinned tools), test runner, CI, Docker image for the bridge.

## 2.4.0
- **Jade Link**, a built-in webxdc app: messenger plus shared board. Messages addressed to Jade (webxdc `notify`) wake her in the app's own chat; live "thinking" status over the realtime channel.
- Updates delivered to apps carry `sender` and `timestamp`.

## 2.3.0
- `http_request` tool (any method, JSON/form bodies, binary responses saved to the vault) with Config → Secrets (`{{NAME}}`).
- Node gets `fetch`, `https`/`http`, `Buffer`, and `process.env` secrets.
- Images in notes and chat (`![[img.png|300]]`, `![alt](path)`, note embeds, insert/paste with downscaling, full-screen view).
- Webxdc apps: Apps tab, `.xdc` install, sandboxed offline runtime, `apps` tool for Jade (read, send, open, build and install apps).

## 2.2.0
- Timestamps on every message; Jade gets the local date, time zone and each message's send time.
- Trajectory logger: every run, as the model saw it, exportable as JSONL (OpenAI chat with tools, or ShareGPT), filtered by 👍/👎.

## 2.1.0
- Context guard: requests are measured before sending, compacted or trimmed to fit, "prompt is too long" errors are learned and retried; `/context` shows what fills the window.

## 2.0.0
- SQLite 3.53 built in (WebAssembly): `sqlite3` shell, `node:sqlite` / `better-sqlite3` in node, `sqlite3` in Python.

## 1.x
- Jade Vault: Obsidian-style markdown vault (links, backlinks, graph, tags, KaTeX) on the pi-agent harness (Live2D Jade, BusyBox WebAssembly shell, Ollama).
- Long-term memory and journal, SOUL.md / AGENTS.md / SYSTEM.md steering, skills.
- Providers: Ollama, Ollama Cloud, Groq, llama.cpp, OpenAI-compatible, with a fallback chain and a separate compaction model.
- Background mode (Android foreground service), heartbeat (HEARTBEAT.md), schedules, file attachments, MCP (pi-style codemode/deferred/direct), MicroPython, JSON export of everything.
