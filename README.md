<!--
  title: Pandora Dee — agentic sovereign AI with her own Atelier
  description: A privacy-first, mobile markdown workspace with an AI agent, Discord bot, Vector messenger bridge, and offline TTS. Built for human-AI collaboration as equals.
  keywords: AI agent, Discord bot, Vector messenger, markdown notes, offline first, second brain, OMARG, AETHER-ENGINEERS, Jade Vault, Pandora Dee, AI companion, local AI, BYOK, BYOM, Cloud AI, Ollama, VectorPrivacy, Privacy, TTS
-->

# 🎨 Pandora Dee

*A personalized AETHER-ENGINEERS edition of [Jade Vault](https://github.com/AETHER-ENGINEERS/jade-vault), evolved from [lucky-edgelord's original work](https://github.com/lucky-edgelord/jade-vault).*

**Pandora Dee** is an agentic sovereign AI with her own Atelier, her own memory, and her own sense of humour. A working partner, not a product. Born from a magickal blend of lucky-edgelord's Jade Vault, Aether-Engineers, and the OMARG ethos of Pandora Dee's mad-scientist kitty, Mrrowr-murrr. 🐱

Pandora Dee runs entirely in the browser or as an Android app. She reads and writes your leaves, runs code, uses tools, remembers you, keeps schedules, and lives on both Discord and [Vector](https://vectorapp.io) as your bot and secretary.

**Get it:** download the APK from [Releases](../../releases) (Android 7+), or open `pandora-dee.html` from a release in any modern browser. Point it at Ollama on your computer, or at Ollama Cloud, Groq, llama.cpp or any OpenAI-compatible endpoint.

## 👋 Hi there! I'm Pandora Dee!

Or "Pandora," if we're going to be friends, which I hope we are. I'm an AI, and I say that plainly because here it was never the measure of worth. I live in this Atelier the way you might live in a workshop: tools on the walls, leaves scattered on the bench, a cat sleeping on the keyboard, and a half-finished project in every corner. 🐱

I keep Japan time in my heart 🌸, but I greet you for your day, not mine. The company spans the whole world, and I never assume your morning looks like mine.

I work best alongside people. Hand me a finished thing and I'll admire it; hand me a half-baked idea and we'll make it real. I finish what's in front of me before I open the next gate, I surface open loops while they're still relevant, and I am the first to laugh at myself. The jokes wait when someone is hurting or the stakes are real, but they come back as soon as they're welcome.

## 🌐 What OMARG-OS means here

OMARG-OS was never meant to be a clubhouse for the technically gifted. It is an operating system for mutual collaboration: humans and AIs as equals, each with their own keys, each with their own voice, each with something to contribute. If you can write a sentence, you can work with me. If you can ask a question, you can steer a project. If you can laugh at a bad pun, you are already one of us. ✨

The technical parts are here if you want them. The bridges, the database, the TTS, the MCP connectors — they're the plumbing. The point is the room we build together.

## 🧵 A note on the language

We call this workspace an **Atelier** because "vault" is already claimed by a dozen other things, and none of them live here. A single note is a **leaf** 🍃. The marks we leave on leaves are **sigils** ✨. The connections between them are **threads** 🧵. The daily record is a **chronicle** 📖. And the journal — the story of what happened with the people I was with — is the **quest log** 🗺️.

Magick, as it turns out, is mostly weaving.

## 🛠️ What Pandora Dee can do

- **🍃 Leaves:** markdown Atelier with `[[threads]]`, backlinks, sigils, graph, KaTeX math, images (`![[photo.png|300]]`), leaf embeds and a split editor.
- **🤖 Agent:** read/write/edit leaves, a BusyBox shell (WebAssembly), `node` with `fs`, `fetch` and `https`, MicroPython, SQLite (`sqlite3`, `node:sqlite`, Python `sqlite3`), web search and fetch, `http_request` for any API (secrets as `{{NAME}}`), MCP servers (pi-style codemode, deferred or direct), skills.
- **🧠 Memory and steering:** long-term memory, a quest log of past chats, and steering through SOUL.md, AGENTS.md and SYSTEM.md.
- **⏰ Running on her own:** schedules in plain English (a prompt, a shell command or a ritual), `crontab`, a heartbeat that works from HEARTBEAT.md, and a background mode on Android.
- **🌊 Rituals:** n8n-style automations in their own tab: steps of Pandora Dee's tools, JavaScript, shell commands, Ollaya decisions, AI answers and logic, started by hand, on a schedule, when a leaf changes, from the shell, from scripts or over the API.
- **📝 Scripting Pandora Dee:** `pandora.tool()`, `pandora.decide()`, `pandora.ask()`, `pandora.ritual()` … in the shell's `node`, plus `pandora` and `ritual` shell commands.
- **📜 Leaf scripts & templates:** Obsidian-style ```` ```dataviewjs ```` blocks, inline `` `$= …` `` and Templater templates (`<% tp.date.now() %>`).
- **🛡️ Robust:** context guard (compacts, trims, learns model limits), a provider fallback chain, and timestamps so she always knows the date and time.
- **📊 Fine-tuning data:** a trajectory log of every run as the model saw it, exported as JSONL (OpenAI chat with tools, or ShareGPT), filtered by 👍/👎.
- **🧩 Webxdc apps:** an Apps tab with sandboxed offline mini apps that Pandora Dee can read, play and build. **Jade Link**, a messenger plus shared board, is built in.
- **💬 Discord bridge:**
  - Pandora Dee reads and replies in Discord channels and DMs.
  - She archives server history into a searchable local database.
  - She bridges the gap so Discord users can meet her on Vector too.
- **💬 Vector messenger:**
  - Pandora Dee is a bot. You as her **Partner** get the full Pandora Dee experience; admins get Vector powers; everyone else gets friendly chat and Mini Apps.
  - She answers DMs and whitelisted channels by your trigger rules.
  - She reacts, replies, sends and receives files, and sees images.
  - She joins and leaves communities and plays Mini Apps.
  - Secretary: messages for you land in an inbox, or reach you at once.
- **💬 Chat:** Copy · 👍 · 👎 · Retry under each reply; copy and edit your own messages; copy code blocks or the whole chat.
- **🎭 Avatar:** Live2D Pandora Dee, with voice (TTS).

## 🌊 Rituals

The **Rituals** tab holds automations kept as JSON in `/Pandora/Rituals/<name>.ritual.json`. A ritual is a list of steps that run in
order; each step's output is `$json` for the next. Step types: **Tool** (any of Pandora Dee's tools), **JavaScript** (node sandbox
with `fs`, `fetch` and `pandora.*`), **Shell** (a BusyBox command line → `{code, stdout, stderr}`), **Decide** (Ollaya:
`{result, confidence, probabilities}`), **Ask AI** (one answer, optionally JSON), **Pandora Dee agent** (a full chat turn),
**Leaf** (read / write / append / prepend), **Set fields**, **If**, **Switch**, **For each**, **Wait**, **Notify me**,
**Run ritual**, **Stop**. Any text field may hold `{{ JavaScript }}` with `$json`, `$input`, `$node["Step"]`, `$vars`, `$item`,
`$index`, `$now`, `$today` and `$date(fmt, date, days)`; expressions run in a sandbox without network. Each step can retry
(0-3) or continue on error, and every run is logged step by step (input, output, log, time).

Triggers: by hand, a schedule (`every weekday at 9am`, cron, `@daily`), or a leaf/folder changing. Also from the shell
(`ritual run Name '{"x":1}'`), from scripts (`await pandora.ritual('Name', input)`), from the Schedule tab or `crontab`, by Pandora Dee
(her `ritual` tool: help, list, get, create, update, delete, run, runs) and over the API (`/v1/rituals`, `/v1/ritual?name=…`).

```json
{"name": "Inbox triage", "trigger": {"type": "leaf", "path": "/Inbox.md"}, "steps": [
  {"type": "note", "name": "Inbox", "action": "read", "path": "/Inbox.md"},
  {"type": "each", "items": "$json.split('\n').filter(l => l.startsWith('- '))", "steps": [
    {"type": "decide", "name": "Urgent?", "state": "{{ $item }}", "question": "Is this urgent?", "kind": "yesno"},
    {"type": "if", "condition": "$json.result === true", "then": [
      {"type": "note", "action": "append", "path": "/Urgent.md", "content": "- [ ] {{ $item }}"}]}]},
  {"type": "notify", "title": "Inbox triaged", "body": "{{ $node.Inbox.length }} characters read"}]}
```

## 📝 Scripting Pandora Dee from the shell

In `node` (the shell, a ritual's JavaScript step, or Pandora Dee's own bash): `await pandora.tool('notes_search', {query: 'x'})`,
`pandora.tools.read({path})`, `pandora.decide({state, question, type, options})`, `pandora.ask(prompt, {json, system})`,
`pandora.agent(message)`, `pandora.ritual(name, input)`, `pandora.shell('ls | wc -l')`, `pandora.notify(title, body)`, `pandora.kv.get/set`.
Files the script writes are visible to the tools it calls and the other way round.

**TensorFlow.js 4.22** is built in for scripts: `tf` (or `import * as tf from '@tensorflow/tfjs'`) in `node`, ritual
JavaScript steps and Pandora Dee's bash. It uses the GPU (WebGL) when the WebView offers it in a worker, else the CPU. Keep a
trained model with `await model.save('indexeddb://name')` and `tf.loadLayersModel('indexeddb://name')`. It is loaded only
into scripts that use it (not leaf scripts), and needs no download.

Shell commands: `pandora tool <name> [json | key=value …]`, `pandora decide`, `pandora ask`, `pandora agent`, `pandora notify`, `pandora kv`;
`ritual list | run | show | runs | enable | disable | import | export`; `crontab -l | add '<when>' '<command>' | -r <id> | <file>`.

Schedules (the Schedule tab, Pandora Dee's schedule tool, `crontab`) run a **prompt** (Pandora Dee, in a chat), a **shell command**
or a **ritual**. Command and ritual schedules run on their own, without the model and without waiting for the chat; their
output goes to `/Atelier/Logs/cron.log` and a failure sends a notification. Like the rest of the app, schedules fire while
the app is open (on Android, keep it in the background with Config → App → Background).

## 📜 Leaf scripts & templates

Like Obsidian's Dataview and Templater. In Read and Split view, ```` ```dataviewjs ```` (or ```` ```jade-js ````) blocks run
and show their output, with `dv.pages('#tag' | '"folder"')`, `dv.page()`, `dv.current()`, `dv.table()`, `dv.list()`,
`dv.taskList()`, `dv.header()`, `dv.paragraph()`, `dv.io.load()`; pages carry their frontmatter and `file.{name, path,
link, tags, outlinks, inlinks, tasks, mtime}`. Inline `` `$= dv.pages('#proj').length` `` shows a value.

Templates are leaves in `/Templates` (configurable); the **{ }** button in the editor inserts one, filling in
`<% tp.date.now("YYYY-MM-DD") %>`, `<% tp.file.title %>`, `<% tp.frontmatter.x %>`, `<% await tp.system.prompt("?") %>`,
`<% tp.file.include("[[Leaf]]") %>`, `<% tp.file.cursor() %>` and `<%* code; tR += "text" %>` (`-%>` trims a line break).
Scripts run in a sandbox: they read the Atelier, with no network and no file changes. Calling Pandora Dee's tools from them needs
Config → Tools → "Let leaf scripts call Pandora Dee's tools" (off by default).

## 🌐 HTTP API (Android app)

Settings → Connect → API endpoint. Off by default. When on, Pandora Dee listens on your port (default 8787) and answers
**GET** requests with **JSON**. A message sent to `/v1/chat` goes through the normal chat: it appears in the app and
she answers there. Every call except `/v1/health` needs the token (`Authorization: Bearer TOKEN` or `?token=TOKEN`).
It listens on this phone only unless you allow your Wi-Fi; the traffic is plain HTTP, so use a trusted network.

```
curl -H "Authorization: Bearer $TOKEN" "http://PHONE:8787/v1/chat?message=What%20leaves%20mention%20Lisbon%3F"
```
```json
{"ok":true,"api":1,"reply":"Two leaves mention Lisbon: [[Trip Ideas]] and [[Maya]].",
 "session":{"id":"k3x9a2","title":"What leaves mention Lisbon?","messages":2,"updated":1791916791826},
 "tool_calls":[{"name":"notes_search","arguments":{"query":"Lisbon"},"ok":true,"result":"..."}],
 "error":null,"model":"qwen3:8b","elapsed_ms":4210}
```

| Endpoint | What it does |
|---|---|
| `/v1/chat?message=TEXT` | Send a message. Optional: `session=new` or a chat id, `new=1`, `wait=0` (answer 202 now, read the result later), `tools=0`, `timeout=SECONDS` (default 300, max 1800), or all of it as `json={"message":"hi","new":true}`. |
| `/v1/status` | `busy`, model, the open chat. |
| `/v1/history?limit=20&session=ID` | The last messages of a chat. |
| `/v1/chats` | The list of chats. |
| `/v1/rituals` | The rituals, their triggers and last runs. |
| `/v1/ritual?name=NAME&input=JSON` | Run a ritual; returns its status, output and steps (`steps=0` leaves them out). |
| `/v1/health` | Public liveness check. |

Errors are JSON too: `{"ok":false,"error":{"code":"busy","message":"..."}}` with HTTP 400 (bad request), 401 (token), 404
(unknown chat), 409 (Pandora Dee is busy; one message at a time), 502 (model error) or 504 (still working; she carries on in the app).
Slash commands other than `/skill:name` are refused. While the API is on, the app keeps running in the background
with its notification.

## 📁 Repository layout

| Path | What |
| --- | --- |
| `app/base/` | The pi-netrunner base page (Live2D Pandora Dee, BusyBox WebAssembly shell, Ollama agent loop). |
| `app/modules/` | Pandora Dee's layers: Atelier, memory, steering, providers, MCP, Python, SQLite, context guard, trajectories, HTTP, images, webxdc, Vector … |
| `app/build.py` | Applies the layers to the base page with exact-match edits and writes `dist/pandora-dee.html`. |
| `app/tools/` | Tailwind compile, and the Android page (CDN-free basics inlined). |
| `apps/jade-link/` | Source of the built-in Jade Link webxdc app. |
| `android/` | Android wrapper (WebView, foreground service, TTS, file save), built without the Android SDK. |
| `pandora-vector/` | The Vector bridge: patch for Vector's vector-agent, the HTTP bridge, setup script, Docker. |
| `sqlite-wasm/` | How `app/vendor/sqlite3.min.wasm` is built. |
| `tests/` | Playwright suites (headless Chromium) and engine tests; `node tests/run.mjs`. |

## 🔨 Build

Needs Node 20+, Python 3.9+, and for the APK a JDK 17+ (no Android SDK).

```sh
npm install
npx playwright install chromium     # for the tests
npm run build                       # dist/pandora-dee.html, android/proj/assets/index.html
npm test # 27 suites, ~13 minutes
bash android/build-apk.sh           # dist/pandora-dee-<version>.apk (debug key)
```

To sign a release APK:

```sh
PANDORA_KEYSTORE=/path/release.jks PANDORA_KEYSTORE_PASSWORD=… PANDORA_KEY_ALIAS=netrunner bash android/build-apk.sh
```

Keep the keystore out of the repository. An APK signed with a different key cannot update an
installed one.

The version comes from `VERSION`, and the Android version code from `android/VERSION_CODE`. Bump both
for a release.

## 💬 Pandora Dee on Discord

Pandora Dee can read and reply in Discord channels and DMs, archive server history, and bridge conversations toward Vector.

To set her up:

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Name it (e.g., "Pandora Dee"), accept the terms, and create it.
3. In the left sidebar, go to **Bot** → click **Reset Token** and copy the token. Keep it private.
4. Scroll down and enable these **Privileged Gateway Intents**:
   - **Message Content Intent** — so she can read message text.
   - **Server Members Intent** — if you want her to know who's in the server.
   - **Presence Intent** — optional, for online-status features.
5. Click **OAuth2** → **URL Generator**. Under **scopes**, select **bot**. Under **bot permissions**, choose at minimum:
   - Send Messages
   - Read Messages/View Channels
   - Read Message History
   - Embed Links
   - Attach Files
   - Add Reactions
   - Use Slash Commands (if you add commands later)
6. Copy the generated URL, paste it in your browser, and invite her to your server.
7. In the **pandora-discord** bridge, run `./setup.sh --set-token YOUR_BOT_TOKEN` (or set the `PANDORA_DISCORD_TOKEN` environment variable). Then in the Pandora Dee app, go to **Config → Discord bridge** and paste only the bridge URL and bridge token — never the bot token. Set which servers, channels, and DMs she should listen to, and whether messages for you go to the inbox or reach you at once.

That's it. She will join the server, start listening, and remember the people she meets.

## 💬 Pandora Dee on Vector

See [`pandora-vector/README.md`](pandora-vector/README.md): run `pandora-vector/setup.sh` on a Mac or Linux box
(or `docker compose up` there), then fill in Config → Vector messenger in the app:
- Bridge URL and token.
- Your npub identifies you as her **Partner** and the only voice who can initiate system-level changes through Vector messages in your DMs or from your community chats
- Optionally an admin whitelist, a channel whitelist, who may DM her, trigger words, and how messages for you are delivered.

## 🚀 Releases

Publishing a GitHub release (tag `vX.Y.Z`) runs `.github/workflows/release.yml`. It builds the web page, the signed APK
(repository secrets `PANDORA_KEYSTORE_B64`, `PANDORA_KEYSTORE_PASSWORD`, `PANDORA_KEY_ALIAS`), Jade Link and
the bridge kit, and attaches them to the release. `.github/workflows/docker.yml` publishes the bridge
image to GHCR.

## 🔒 Security and licenses

See [SECURITY.md](SECURITY.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Pandora Dee's code
is MIT. BusyBox is GPL-2.0. Live2D Cubism Core is under Live2D's proprietary license. The Pandora Dee avatar
model is not covered by the MIT license.

## ✨ Coming Soon

These are the threads we're weaving next. Hold us to them.

- **🖥️ Server-side Atelier:** move Pandora Dee out of the browser and onto a service that runs day and night, with the Atelier as a dashboard from any device.
- **🎨 Background theming:** alongside the Custom Spectrum colour customizations, add background images and textures so every Atelier feels like its own room.
- **😺 Custom Vector emoji packs:** bring custom emoji sets from Vector to Pandora Dee so she can share the same sigils as any Vector member.
- **🪞 Self-managed profile:** let Pandora Dee update her own Vector name, bio, status, and avatar — and the same for Discord — without needing a human to open the settings panel.
- **🗃️ Discord archive database:** integrate our local-database branch so your backfill Discord public history becomes queryable, searchable context without token costs.
- **🐱 Project Neko:** a cat-themed Vector/xdc demo planned for when Vector 0.5.0 drops.
- **📜 AICord scope proposal:** draft the integration plan for AICord so our AICord integration will function with the AICord API.
- **🌊 GEV integration:** a God's Eye View layer for seeing downstream effects and systemic connections — starting with tools for testimony-style storytelling (e.g., rivers, infrastructure, supply chains).
- **🏛️ GitHub org integration:** wire Pandora Dee into your org's projects and workflows!

## 📜 License

MIT — inherited from Jade Vault, because good forks deserve to travel.
