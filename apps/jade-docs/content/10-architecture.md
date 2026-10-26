<!-- id: architecture | parent: overview | level: 3 | order: 10 | tags: architecture, build, internals, workers, storage -->
# Architecture

## One generated page

The app is `dist/jade-vault.html`: one HTML file with all JavaScript, CSS, fonts, a WebAssembly SQLite and a MicroPython bootstrap. `scripts/build-web.sh` compiles Tailwind and runs `app/build.py`, which:

1. loads the base page `app/base/pi-netrunner-mobile.html` (the original "pi netrunner" agent page: Live2D avatar, BusyBox WebAssembly shell, Ollama agent loop),
2. applies hundreds of **exact-match replacements** with `rep(old, new)`; each `old` must occur exactly once or the build stops (`MISSING` / `AMBIGUOUS`),
3. injects feature modules from `app/modules/*.js` (read with `rd('name.js')`), most of them just before the `BOOT` marker, in a fixed order (browser agent, browser tool, phone, screen, sentry, ssh, think, skill router, delegate, chat history, curiosity, backup, browser scripts),
4. embeds binary assets (SQLite wasm, TensorFlow.js gzip+base64, the built-in Jade Link app),
5. writes `dist/jade-vault.html`, and `app/tools/build_index.py` makes the Android copy with CDN-free basics inlined.

`app/modules/main.js` is a **parallel snapshot** of the core page script kept for reading and tests; the shipped core is the base page plus the patches. Edit the module that build.py actually injects, and check build.py for how a fragment is used.

## Runtime layout

| Piece | Where it runs |
| --- | --- |
| UI, agent loop, tool dispatch, vault, memory, flows, schedules | the page (main thread) |
| BusyBox shell | WebAssembly, in the page |
| `node` (a Node-flavoured runtime with `fs`, `fetch`, `https`, `jade.*`) | a Web Worker (`node_prelude.js`) |
| Python | MicroPython (WASM) in a worker; the vault is its filesystem |
| SQLite 3.53 + sqlite-vec 0.1.9 | WASM (`sqlite_glue.js`, `sqlite_main.js`); shell, Python, node and Jade's tools share it |
| TensorFlow.js 4.22 | loaded only into scripts that ask for it |
| LiteRT.js | loaded on first `litert` use |
| webxdc apps | sandboxed iframes with an opaque origin and a CSP; no vault access, no network |
| Android shell | Java classes behind `NetrunnerAndroid.*` (a JavaScript interface) |

## Storage

- **Vault (VFS).** Notes and files live in a virtual filesystem (`VFS` in main.js). In a browser it is stored in IndexedDB (`jade-vault`). In the Android app (2.13+) it is a real folder, `JadeVault` on shared storage once "all files access" is granted, otherwise the app's own folder; the page keeps only the file list in memory, reads files on demand through a 48 MB cache and writes in order a moment later (`vfs_disk.js`, `Disk.java`).
- **Settings and small state.** `localStorage` keys prefixed `jvault:` (`S` is the settings object; `ls.get/set` for other state such as `cuNext`, `abLast`, `skillStats`, `bsApproved`).
- **Chats.** IndexedDB records `session:<id>` plus a `sessions` list. Flow runs, schedules and MicroPython packages are in the same database.
- **Apps.** a separate `jade-xdc` IndexedDB.
- **Vector index.** `/Jade/.index/vectors.db`, an ordinary SQLite file in the vault (a cache you can delete).

Because of the split, a "full backup" is not everything: see [Backup system](#doc:backup-system).

## Native bridge

`NetrunnerAndroid` exposes methods such as `browser`, `phone`, `screen`, `sentry`, `ssh`, `disk`, `apiResult`. Calls take an id and the Java side answers asynchronously through global callbacks (for example `window.__jbr(id, value)` for the browser). The page checks capability with `naHas('browser')` etc., so every tool degrades to a clear error on a plain browser.

## Where to look

| Question | File |
| --- | --- |
| How is the system prompt built? | `systemPrompt()` in the core, `steer.js`, `memory.js` |
| How is a tool registered and gated? | `WORLD_TOOL_DEFS`, the `activeTools()` filter and `runTool()` cases in build.py |
| Context limits | `ctxguard.js` |
| Providers and fallback | `providers.js`, `extras.js` |
| Flows, cron, heartbeat | `flows.js`, `cron.js`, `heartbeat.js` |
| Bridges | `vector.js`, `discord.js`, `api.js` |
