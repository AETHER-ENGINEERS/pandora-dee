# Pandora Dee's home host

A first step towards the Atelier as a **host plus clients**: her vault is a real folder on one computer, the host, and
her Atelier opens from that computer's address in any browser on the home network or the tailnet. Every device sees
the same files, and the tools the host runs (a real shell first) work on those same files.

The page is the same `dist/pandora-dee.html` the browser and the desktop app open. The browser vault (IndexedDB) and
the desktop app keep working as before.

## Run it

```sh
npm run build                                   # dist/pandora-dee.html
node host/main.cjs --root <her home folder>     # this computer only: http://127.0.0.1:8741/
node host/main.cjs --root <folder> --lan        # also other devices on the network
```

| Option | What |
|---|---|
| `--root <folder>` | Her home: the vault's `/`. `/Pandora/SOUL.md` is `<folder>/Pandora/SOUL.md`. (`PANDORA_HOME` works too) |
| `--state <folder>` | Where the host keeps its own records: paired devices, their settings and a log. Default: `<folder> (host)`, beside the home, never inside it |
| `--port <n>` | Default 8741 |
| `--lan` / `--listen <address>` | Listen on every address, or on one (a tailnet address, say). Without either, this computer only |
| `--page <file>` | Another built page |
| `--shell <program>` | The shell `host_shell` runs. Default: Git Bash on Windows (else `cmd.exe`), `bash` elsewhere |

While it runs, type into its window: `pin` (a new PIN), `devices`, `revoke <name or id>`, `quit`.

For the tailnet, Tailscale's own HTTPS (`tailscale serve`) is better than plain HTTP on the network.

## Pairing

A browser that isn't paired is sent to `/pair` before the Atelier starts, so it never begins on that browser's own
storage. Enter the six-digit PIN the host shows. The device then gets its own key, and the host keeps only its SHA-256.

- A PIN works once, for ten minutes.
- After five wrong PINs, pairing rests for five minutes.
- `revoke` removes a device at once.

The PIN is there to stop little hands, and anyone else on the network, from using the host. It isn't meant as
enterprise security.

Without a key, the host answers only the pages themselves, `/host/hello` and pairing. Another website open in the
same browser can't ask it anything.

## What the host does

- **The vault on real files.** It answers the same `disk*` calls the desktop app's preload and the Android app answer
  (`desktop/disk_host.cjs` does the work), so `app/modules/vfs_disk.js` runs unchanged.
  - Those calls are **synchronous**: the vault reads a file the moment something asks for it. `host/bridge.js` makes
    each one a synchronous request to the host, which browsers still allow on a page's main thread.
  - Deleted files go to the trash folder beside the home.
- **One writer.** One window at a time writes the vault. Another window, on the same device or another, can read, but
  its writes are refused (with a message) until the first has been quiet for half a minute. So two open windows can't
  overwrite each other's files.
- **Host tools, as a tool server.** `/mcp` is an MCP server (streamable HTTP) with:
  - `host_shell`: a real shell on the host, starting in her home folder, or in a vault folder given as `cwd`.
    `$PANDORA_HOME` is the home's full path on the host;
  - `host_info`: what the host is.

  Add it in the Atelier like any tool server, with the host's own address. The bridge adds the device's key to
  requests to `/mcp` on the same address, and to nothing else:

  ```json
  { "mcpServers": { "home": { "url": "http://<host>:8741/mcp", "exposure": "direct" } } }
  ```
- **Each device's own settings.** `GET` and `PUT /host/client/settings` keep each device's settings apart. The page
  doesn't use them yet.
- **A log.** `events.jsonl` in the state folder records pairings, refusals, writer changes and every tool call. It
  holds facts only, never file contents.

## Nap mode: awake only while a client is connected

Her work is meant to happen with someone there. A loop running on its own, answering Vector and Discord, can put the
person's provider details (an Ollama address, an account name) into a channel or a DM with other people. So the host
is **awake only while a client is connected**, and naps otherwise (`host/nap.cjs`).

- **A client** is the Atelier open in a browser or the app. The page's bridge holds a presence stream
  (`/host/presence/stream`) open, and reopens it if it drops. The pairing page alone doesn't count.
- **Waking:** when the first client connects, the host wakes at once.
- **Grace period:** when the last client leaves, the host waits (`--nap-grace <seconds>`, default 60), so a refresh or
  a blink of the Wi-Fi doesn't send it to sleep.
- **While napping, the host doesn't:**
  - run agent turns (they're refused);
  - make any scheduled or heartbeat model calls (they're skipped and logged);
  - send anything through a bridge (a send is refused, even an answer that was already being made when the host fell
    asleep).
- **While napping, the host still does:** files, pairing, `host_shell` when a client calls it, and the log.
  `GET /host/presence` says which state it's in.
- **Messages that arrive while napping are kept, not dropped.**
  - The host still collects them from the bridges (collecting sends nothing) and keeps them.
  - On waking, it answers the ones that arrived within the last 10 minutes, the Discord bridge's own limit for a reply
    to still make sense.
  - Older ones are held for her and the person to see (`GET /host/waiting`), not answered automatically into a
    conversation that has moved on.
  - Without the host collecting them, the Discord bridge would drop them after its 10 minutes.

`host/runtime.cjs` is the one place the host's turns, schedules and bridge traffic pass through, so these rules can't
be stepped around. The Atelier's agent loop moves in behind it in the next step. Until then, turns still run in the
page, and only while a page is open, which already keeps to the same rule.

### What leaves for a bridge is checked

Every message for Vector or Discord passes `host/redact.cjs` first. It hides:

- addresses of this computer, the home network and the tailnet (`*.ts.net`, `100.64.0.0/10`, private IPv6);
- anything on Ollama's port;
- key-shaped strings (`sk-…`, GitHub tokens, Slack tokens, Google keys, `nsec1…`, `Bearer …`, private keys);
- exact words it's told about (provider account names, a provider's host name), plus this computer's name and its user
  name.

The log notes the kinds and counts hidden, never the values. A model error is never sent to a bridge at all, because
that's where addresses turn up.

**It's a backstop.** Patterns can't catch a paraphrase ("one hundred dot…"), and a public address is left alone. The
main protection is that provider details don't reach a bridge turn's context in the first place. For example,
`host_info` doesn't return the home's full path.

## Not yet

These are the next milestones, in this order:

1. **Chats, branches, schedules, settings and run history still live in each browser,** and turns still run in the
   page. A device that opens the host gets her files, not her conversations. They move to the host next, followed by
   the agent loop behind `host/runtime.cjs`, so every device shares one conversation and one heartbeat (while a
   client is connected).
2. **The real shell sees the home through the host's own paths.**
   - A relative path, or `$PANDORA_HOME/Pandora/SOUL.md`, reaches the same file the vault calls `/Pandora/SOUL.md`.
   - A bare `/Pandora/…` in the real shell means the host's own `/`, so it doesn't reach that file.
3. **Plain HTTP on the network** can be read by others on the same network. Prefer the tailnet's HTTPS for anything
   beyond the home network.

Tests: `tests/home_host_test.mjs` and `tests/nap_test.mjs`, in the repo's test run (synthetic homes, a stand-in model
and a stand-in bridge only).
