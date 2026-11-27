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
- **Napping turns her switches off** (see Switches below): the agent loop, the heartbeat, schedules, curiosity sparks
  and sending, and they stay off after a client reconnects until the person turns them on. Receiving stays on. So:
  - agent turns don't run;
  - no scheduled, heartbeat or spark model calls (skipped, and logged once per change of reason);
  - nothing goes out through a bridge, including an answer that was already being made when the host fell asleep,
    except her notice, once (below).
- **While napping, the host still does:** files, pairing, `host_shell` when a client calls it, and the log.
  `GET /host/presence` says which state it's in.
- **Messages that arrive while napping wait in a queue on disk** (`host/queue.cjs`, `bridge-queue.jsonl` in the state
  folder):
  - **in arrival order**: the order the host received them, with messages from different bridges arriving together
    taken Vector-first or in whatever order the bridges are listed;
  - **each with its source:** which bridge, who sent it, which chat, when it arrived and when it was sent;
  - **nothing in the queue expires or is trimmed,** and **waking doesn't hand them to her:** she may only have napped
    for a model switch. It survives a host restart.
  - The host keeps collecting them from the bridges while napping (collecting sends nothing and calls no model).
    That's also what keeps the Discord bridge from dropping them after its own 10 minutes. If the host isn't running
    at all, the bridges' own limits apply again.
- **A connected client sees "N messages waiting",** a small indicator the bridge script draws at the top of the
  Atelier. It offers three choices:
  1. **Give them to her now:** all, or the next five, oldest first. Each is her turn and her reply, through the bridge
     it came from. A message leaves the queue only once her turn for it has finished. If the host stops partway
     through, she gets it again after the restart, told that it's a retry.
  2. **Later:** they stay queued.
  3. **Write them to a file:** every waiting message, oldest first, with when it arrived, the bridge, the sender and the
     chat, written as Markdown to `/Pandora/Waiting Messages/<date> <time>.md` in her vault, for her to read at her
     own pace. A new file each time, never over an earlier one. **The queue is left as it is.** "Clear the queue" is
     then offered: it needs the person to confirm, and it only clears messages a written file already holds, so
     nothing is lost if the file is misplaced.
- **Live conversations while awake** are answered straight away. They go through the same queue on disk first, so one
  interrupted by a restart isn't lost either.
- **A large queue:** past 1,000 waiting messages, the host says so (in the log, and in the indicator) and leaves the
  decision to the person. It never trims the queue.

| Route | What |
|---|---|
| `GET /host/waiting` | the count, the messages in order, and the last file written |
| `POST /host/waiting/deliver` | `{ "count": n }` for the next n, or `{}` for all |
| `POST /host/waiting/later` | |
| `POST /host/waiting/write` | → `{ path, count }` |
| `POST /host/waiting/clear` | `{ "confirm": true }`; refused unless a written file holds every waiting message |

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

## Switches

Her **agent loop, heartbeat, schedules and curiosity sparks**, and her bridges' **receiving** and **sending**, are
each a switch (`host/settings.cjs`). A switch is on only when it's turned on **and** nothing holds it off. Wherever a
switch is shown, so is why it's off:

- **off:** the person turned it off;
- **off since the nap / off since the model outage:** the host turned it off. It stays off until the person turns it
  on, one by one or all at once ("Turn on everything the host turned off");
- **napping:** no client is connected (holds the loop, heartbeat, schedules, sparks and sending);
- **no model:** her model is gone (holds the same).

**After a nap,** reconnecting changes nothing: the loop, heartbeat, schedules, sparks and sending stay off until the
person turns them on. A reconnect may follow a planned model switch, and the heartbeat is often best left off while
conversations are busy. "They come back on by themselves" is a setting, **off by default**, for later, when a local
model can carry her.

**Receiving** stays on through naps and outages, so messages keep landing in the queue. The person can turn it off;
then the host stops reading the bridges, and their own limits apply.

## When her model goes away

When a model call fails with a **usage limit**, a **refused key** or an **unreachable** server (`host/errors.cjs`),
the host takes it as her model being gone:

- **It turns off the heartbeat, schedules, sparks and sending** ("off since the model outage"). The loop waits for a
  model. Receiving stays on. The log says so, and so do the settings page and the client.
- **"Try the model again"** checks it and shows whether it answers. **"She has a model again"** marks it back by hand.
  (A setting can also let a regular check mark it back.) **None of these turns anything on:** sending, the heartbeat,
  schedules and sparks wait for the person, until she's definitely ready.
- **Provider and model error text never reaches a channel or a DM.**
  - Anything about to go out through a bridge that looks like one is stopped. That includes the Atelier's own
    "⚠ <error>" reply, and a usage-limit message naming the person's account.
  - The stop is logged (the facts) and traced (the words, for the person), and is itself taken as a sign the model is
    gone.

## Her notice while she can't answer

While her sending is off (napping, an outage, or turned off), someone who writes to her gets **her notice, once**:

- **once per person in a DM,** and **once per shared channel** (for everyone in it);
- **never twice to the same person:** someone who saw it in a channel doesn't get it again in a DM;
- **then silence,** until her sending is on again. That re-arms it.

**The words are hers.** Each bridge has a default ("Fae is napping, she'll respond to your messages as soon as she's
able!"), and she can have her own words for one person or one chat, or say nothing (empty).

- **Who changes them:** she does with her `away_notices` tool, and the person does on the settings page (and, next, in
  the Atelier).
- **What they can be:** plain configured text, never made by a model. A notice that reads like a provider error, or
  carries an address, a key or a hidden word, is refused.
- **What still happens:** every message still waits in the queue.

## The host is her bridge

The host runs her Vector and Discord bridges itself (`host/bridges.cjs`). These are the Atelier's own `pandora-vector`
and `pandora-discord`, started as the host's children (or reached where they already run), set up in the settings
page.

- **It reads every new message into the queue, napping or not,** so nothing is lost while she can't answer.
- **The Atelier reaches the bridges through the host** at `/bridges/<name>/mcp`, with the very same tools as today, so
  its Vector and Discord behaviour doesn't change. Point its Discord or Vector address at
  `http://<host>/bridges/discord/mcp` (any key: the page's bridge script sends the device's own).
- **The host hands it the messages it may answer now,** exactly as the bridge gave them.
- **Everything the Atelier sends goes through the host's checks:** switches, error text, hidden words. Reading tools pass
  straight through.
- **The bridge's own key** goes into the settings page's write-only key field (`--print-token` on the bridge shows it).
  It's kept in `bridge-secrets.json` in the host's folder, owner-only, and never shown back. A bridge that reads its key
  from the environment can be given it as `keyEnv`.

## What waited: she's told, and has her own tool

- **Her notice:** while messages wait, a turn the host runs begins with a short notice (how many, which bridge, who
  from; never their words). Her `waiting_messages` tool's description says the same, so the Atelier's loop sees it
  whenever it lists her tools.
- **Her tool, `waiting_messages`:** `list` (who and where), `read` (one or all, when she chooses; reading leaves them
  queued) and `handled` (they leave the queue).
- **The person's three choices** stay as they are.

## The host's settings page: `/host/`

A detailed page for everything the host does:

- the switches, each with why it's off, and the buttons to turn them back on;
- whether a model is attached, and what it last said, for the person only;
- the behaviour settings;
- the waiting queue and its choices;
- the bridges, with their setup and keys;
- what happened (the trace);
- paired devices, her host tools, the files, the colours and the log.

It reads and changes the host's one set of settings (`/host/status`, `/host/settings`), the same ones the Atelier
changes, and refreshes every two seconds, so a change made in either shows in both.

**Colours:** buttons, borders and important text use the Atelier's new brand colour, **#BD72F3** (RGB 189, 114, 243;
hue 183, sat 202, lum 168 on Windows' 0–240 scale). The other colours are the Atelier's current defaults. All can be
changed.

**What happened (the trace):** `trace.jsonl` in the host's folder records what went to which model and what came back,
each bridge message in and out (after hiding), what was stopped and why, and her tool's use. It stays on the host, and
the page shows it. The log (`events.jsonl`) keeps facts only.

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

4. **The Atelier's own settings pages** don't drive the host's switches yet, and the Atelier doesn't wear the new
   colour yet. Both are page changes, next.

Tests: `tests/home_host_test.mjs`, `tests/nap_test.mjs` and `tests/switches_test.mjs`, in the repo's test run
(synthetic homes, a stand-in model, and a stand-in bridge the host starts itself).
