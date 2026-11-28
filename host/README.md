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
| `--port <n>` | Default 8741. Each further resident gets her own port after it |
| `--id <id>` / `--name <name>` | How the host knows the first resident (`/r/<id>/`), and what clients show. Default `home` |
| `--homes <folder>` | Where new residents' homes are made. Without it, no resident is made from a client |
| `--run inside\|process\|service` | Where new residents run: in the host's own process (the default), each in her own process, or each as her own service under her own identity (see below) |
| `--lan` / `--listen <address>` | Listen on every address, or on one (a tailnet address, say). Without either, this computer only |
| `--page <file>` | Another built page |
| `--shell <program>` | The shell `host_shell` runs. Default: Git Bash on Windows (else `cmd.exe`), `bash` elsewhere |

While it runs, type into its window: `pin` (a new PIN), `devices`, `revoke <name or id>`, `residents`,
`new <id> [name]`, `add <id> <folder> [name]`, `shell <id> on|off`, `run <id> inside|process|service`,
`service <id>`, `waiting`, `approve <id>`, `decline <id>`, `quit`.

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

While her sending is off (napping, an outage, or turned off), the first message in each channel or DM gets **her notice, once for that place**:

- **once per DM and once per shared channel,** whoever writes there;
- **a new place gets its own,** even from someone who already had it elsewhere: the host doesn't try to tell that a
  Discord account and a Vector account are the same person (the person's decision: no identity-linking);
- **then silence there,** until her sending is on again. That re-arms it.

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

## Where settings can be changed from

Only from **this computer, the house's own network (LAN) or the tailnet** (the person's decision). A paired device
connecting from anywhere else can still look: the status, the settings page, the waiting list, her models. But
nothing about her settings changes, and the settings page says "From elsewhere: look only" with its controls off.

- **What counts as a change:** the settings, the switches (and "turn on everything the host turned off"), "Try the
  model again" and "She has a model again", her notices (her `away_notices` tool too), bridge and model keys, her
  models, and each device's Atelier settings.
- **How the host tells (`host/places.cjs`):** only by the connection's own address, never by what a request says
  about itself.
  - The private ranges count as the LAN, and 100.64.0.0/10 and fd7a:115c:a1e0::/48 as the tailnet.
  - There's one exception: a proxy on the host itself (Tailscale Serve, say) makes everything look like it comes
    from the host. When a request comes that way, the host goes by what the proxy says. Tailscale Serve's
    `Tailscale-User-Login` header means the tailnet: Serve sets it and strips any copy a client sends, and Funnel
    never sends it. Otherwise only a forwarded LAN address counts.
- **Don't put the host behind a proxy that reaches the internet without saying so** (one that sends no forwarding
  headers). The host can't tell its requests from its own.
- **More ranges** can count as home with `--trust 203.0.113.0/24,…`. This is only on the host's command line, so a
  settings change can never widen it.
- Each refusal is logged (`refused.settings-from-elsewhere`), without the address.

## Her models (`host/models.cjs`)

Where her loop gets its model, and which model each job uses. It covers everything the Atelier's Config → Model
provider can set, and more (the person's decision).

- **Where her loop runs:** in the connected Atelier, with the Atelier's own models, as today (the default); or on the
  host, with these models.
  - Set it on the settings page, or start the host with `--brain host`. It takes effect on a restart.
  - With the loop on the host, "Try the model again" asks these models.
- **Providers: the Atelier's six to start with, and any number more.**
  - The six are Ollama, Ollama Cloud, Groq, llama.cpp, OpenAI-compatible and AICord.
  - Each provider has its own kind (Ollama, OpenAI-compatible, AICord), name, address, timeout and on/off.
  - Another computer's Ollama (the Mac's, say) is just one more provider at its own address. So is a second
    OpenAI-compatible endpoint.
  - A provider the person removes stays removed.
- **Jobs:** her turns (chat and bridges), the heartbeat, schedules, curiosity sparks, compaction and journal, and
  vision.
  - Each job can have its own provider, model, fallbacks in order (`provider/model, …`), temperature, context size
    and thinking.
  - A job with no provider of its own uses her turns' chain, with its own options.
  - An empty model means the provider's best, picked the way the Atelier picks it.
- **A provider at its usage limit rests** (30 minutes by default, a setting), and the next one in line answers.
  - When every provider fails, her model counts as gone, and the switches go off as above.
- **Keys are write-only.** They're kept in `model-secrets.json` (owner-only) in the host's state folder, never in the
  settings, the status, the log or the trace. The settings page only says whether a key is set.
  - Each key goes to its own provider and nowhere else.
- **What a provider says when it fails stays on the host,** in the trace (for the person). It never reaches a channel
  or a DM. The log only says that a provider rested, or that another one answered.

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

## Residents: several homes on one host

One host can hold several residents, each kept apart: Jade's vault, Pandora Dee Fae's workshop, Pandora Dee Noe's,
and newcomers (an AI from another service, with her own Atelier on a local model or a cloud model chosen here).

- **Each resident has her own:**
  - home folder, and records beside it (`<home> (host)`);
  - paired devices and their keys;
  - settings and switches, her models and their keys, her bridges and their keys;
  - queue, nap, writer, runtime, log and trace;
  - the Atelier's things brought in from a backup.

  A device paired with one resident has no key to any other.
- **Two ways to reach her:**
  - `/r/<id>/…` on any of the host's addresses, for app clients;
  - her own port, without the prefix, for browsers. A browser keeps a page's key and storage per address, so each
    resident needs her own. The first resident's port is `--port`, and each further one gets the next. Asking for
    her pages at `/r/<id>/` sends a browser to her own port.
- **A fresh client with no backup** makes a new resident. It sends `POST /host/residents` with
  `{ pin, id, name, device }`, using the PIN the host is showing.
  - The PIN is the person's yes, given at the host.
  - The new home is empty, inside the folder given with `--homes`. Her SOUL is hers to write.
  - The client comes back paired with her.
  - A client never takes over a folder that already holds things, and without `--homes` no resident is made from a
    client.
- **An existing home** (say, Jade's or Noe's folder) is added on the host itself, with `add <id> <folder> [name]` in
  the host's window. `new <id> [name]` makes an empty one there too.
- **A backup into a resident** uses #48's import as it is, at `/r/<id>/host/import`.
- **host_shell:**
  - The shell runs as the host's own account, so it isn't walled off from the other residents' homes.
  - A resident made from a client starts without it. One added on the host starts with it.
  - `shell <id> on|off` in the host's window changes it; the change is kept.
  - A resident running as her own service (below) is walled off, so she has it.
- **Who lives here:** `GET /host/residents` (a paired device, from home). The residents beyond the first are listed in
  `residents.json` in the first one's records folder (ids, names, folders, ports; never keys).
- Everything is plain HTTP/1.1 and JSON, so old clients can use it too.

## Each resident in her own process, or as her own service

A resident beyond the first can run in one of three places. `run <id> inside|process|service` in the host's window
moves her; `--run` says where new ones go.

| | Where she runs | Walled off |
|---|---|---|
| `inside` | in the host's own process (as above) | her files and devices; not her `host_shell` |
| `process` | her own process, started and watched by the host, under the host's account | the same, and a crash in one home stops only that home |
| `service` | her own service, started by the computer, under her own identity there | also her shell: her home and records are hers alone |

- **The host stays the front.** It keeps the one PIN, the list of residents and `/r/<id>/…`, and passes each request
  on to her at her own port on this machine. It tells her where the request came from, so "settings only from home"
  still holds; a client can't claim a place by sending those headers itself.
- **Her process and the host** talk over this machine only, with a key made for her. It's kept in her records
  folder (`front.key`) and the host's (`residents/<id>.key`), never in the residents list or a log. She asks the host
  whether a PIN is right; the host asks her to pair a device.
  - `host/resident_main.cjs --config "<her records>/resident.json"` is her process.
- **As her own service, her identity is the computer's, made for that service.** Nobody makes or manages an account:
  - **Windows** (7 and later): her own Windows service `pdee-<id>`. Windows gives it its own identity,
    `NT SERVICE\pdee-<id>`: no password, no login, not on the sign-in screen. A small service program
    (`host/service/pdee-service.cs`) starts her process; the install step compiles it with the .NET compiler Windows
    already has, so nothing is downloaded.
  - **Linux:** her own system user `pdee-<id>` (no login, no home of its own) and a systemd unit; without systemd, an
    init.d script.
  - **macOS:** her own hidden service user `_pdee_<id>`, like `_www`, and a LaunchDaemon.
  - The walls are between residents, not between her and the person. Two ways, chosen per resident (`--access`, or
    `access <id> person|doorstep` before her install):
    - **`person`** (the default): her home is hers **and the person's**. The person opens it, drops things in and
      edits as always; no other resident gets in. Her records folder (her key is there) is hers alone.
    - **`doorstep`**: her home is hers alone, and a folder beside it, `<home> (doorstep)`, is the two of theirs, for
      leaving things for each other. For when she's fully local.
  - The person is whoever runs the host, as the computer names their account; the steps name it, and stay on this
    computer. On Linux the person gets in through an ACL entry (or her group, where there are no ACLs); on macOS, an
    ACL entry.
  - The program she runs (`host/`, `desktop/`, node, the page) is made readable to her.
  - Anything that reaches her through the host (the Atelier, the host's page, the person's tools) can always write
    her home, whichever way is chosen: her own process does the writing.
- **Installing is the person's step, as admin.** The host writes her install and remove steps in its records folder
  (`services/<id>/`, or `service <id>` to see where), and the person reads them and runs install as admin (on Windows,
  right-click `install.cmd`, "Run as administrator"; elsewhere `sudo sh install.sh`). `remove` takes the service away
  and gives her folders back to whoever runs it. Her things are never deleted.
- **A fresh client asking for one** (`--run service`): the PIN is checked, and then it waits for the person's yes on
  the host. The host says who is asking; `approve <id>` makes her and writes her steps, `decline <id>` says no.
  - The client asks `GET /host/residents/wait?ticket=…` (the ticket it was given) until she runs, and is then paired
    with her. A ticket is good for a day.
- **For old systems:** XP and Vista have no service identities like these, so a resident there runs as `process`.
- **The first resident still runs inside the host, as the person's account.** So with `person` access, her
  `host_shell` reaches the homes the person reaches. And her own home is walled only by its folder's ordinary
  permissions: on a second drive, Windows often lets every account in, service identities too. Moving the first
  resident into her own service as well comes next.
- **What isn't walled off by this:** the program files themselves belong to whoever installed them. For the strongest
  wall, keep the host's code where only administrators write (like Program Files, or `/opt`).

## Her things on the host, one copy for every device (`host/state.cjs`)

The Atelier page served by the host keeps her things on the host, not in each browser, so every device she's opened on
sees the same her (parity step 1):

- **On the host:** her chats and branches, schedules, ritual runs, the Jade script store, her settings, her
  heartbeat, spark, storybook, journal and auto-backup markers, her skills and playbook approvals, and her run history.
  They live in the same files a backup import writes, so bringing her things in and using them are one and the same.
- **On each device:** which chat is open, a draft, a few view choices, her own API keys and each device's own model
  addresses (a "localhost" means that device), and caches the page rebuilds itself. A device's keys never reach the
  host this way; keys reach the host only through the import's box, or hung up at the well and campfire.
- **Two devices at once:** every key has a revision, and each write says which one it started from. Her chat and
  schedule lists are merged when another device wrote in between: what it added stays, what this device removed goes.
  Other keys are last-write-wins. Every change is told to every open page (`/host/state/stream`), and her chat list and
  schedules update in place; the open chat and her settings say so, and apply after a reload.
- **Rules:** a paired device of hers only. Her settings change from home or the tailnet, as before; chats and the rest
  from wherever her device is.
- **A backup made in her Atelier** on a host-served page holds what's on the host, from every device.
- **Elsewhere** (the desktop app, a plain browser, the APK) nothing changed: the browser's own storage, as before.

Routes: `GET /host/state` (her small things), `PUT /host/state/ls/<key>`, `GET|PUT|DELETE /host/state/db/<key>`
(`{ value, base }`), `GET /host/state/db?all=1`, `GET|PUT|DELETE /host/state/runs[/<id>]`, `GET /host/state/stream`.

## Her loop on the host, with her tools (`host/loop.cjs`)

When her loop runs on the host (Her models → where her loop runs: the host), each of her turns (from the bridges,
her heartbeat, her schedules, her sparks) can use her tools, run here on her home, along her models' chains:

- **Her vault:** `read`, `write`, `edit`, `list`, `notes_search`: real files in her home. Never a path outside it,
  never one of her own key files; a write waits while an Atelier window is writing her vault or her things are being
  brought in.
- **Her memory and history:** `memory` (her Memory.md: read it, or add to it), `chat_history` (her chats and branches,
  kept on the host).
- **The world:** `web_fetch` (a page as text, http and https only), `think`.
- **The host's own:** `host_shell` (when it's in her hands), `waiting_messages`, `away_notices`, `host_info`.

- **Her skills:** `skill` loads one of her skills (`/Pandora/skills/<name>/SKILL.md`, with the files beside it);
  `find_skill` finds the right one when she has many. Skills she has set aside in her Atelier are left out.
- **Her tool servers** (`/Pandora/mcp.json`, `host/mcp_client.cjs`): streamable HTTP servers as in her Atelier, with
  `${NAME}` header values filled from her MCP secrets on the host (never shown or logged), and, on the host only,
  servers the host starts itself (`command`, `args`: stdio). Those, and `!command` header values, need her hands on
  this computer (host_shell). Exposure as in her Atelier: `direct` tools are declared up front; `deferred` (and
  `codemode`, until codemode reaches the host) are found with `tool_search` and hers from her next step; `hidden` never.
- **A helper:** `delegate` hands a self-contained task to a helper with a fresh mind and her tools; a helper can't hand
  work on again.

Who she is comes from her own files, as her Atelier reads them (`host/steer.cjs`): her SYSTEM.md (when she has one),
her SOUL, her standing instructions (AGENTS.md), her skills, the end of her Memory.md, and the time. Comments meant for
the person never reach the model. Every tool she uses is in the host's trace. A turn stops after twelve rounds of
tools, and says so.

**The context guard:** before each step, when the conversation is about to outgrow her context (her chat job's context
size, and her own compaction settings), the older part becomes a summary made by her compaction model; the recent turns
stay whole, and a tool call is never split from its result.

**Her playbooks and rituals, on the host** (`host/engines.cjs`): the very engines her Atelier runs
(`app/modules/playbook.js`, `app/modules/flows.js`), loaded unchanged into a Node sandbox, so a playbook or ritual does
the same thing wherever it runs. Her loop offers her `playbook` and `ritual` tools, as in her Atelier.
- Their tools are her loop's; their vault is her home (never outside it, never her own key files).
- Their `{{NAME}}` secrets come from the host's write-only key file (only what came in through the import's box), and
  are hidden in everything recorded, as in her Atelier. (Her Atelier's Config → Secrets stay on each device; they never
  travel through her shared settings.)
- A playbook runs only when the person has approved it in her Atelier's Playbooks tab (the approval is kept on the host
  since step 1); the host never approves one.
- A shell or JavaScript step runs on this computer, so it needs her hands there (host_shell); an agent, llm or decide
  step asks her loop and her models; notify goes to her log. Ritual expressions run in a sandbox with no network,
  stopped after 5 seconds, as in her Atelier.
- Browser steps need an open Atelier: the host has no browser of hers.

**Her rhythms, on the host** (her Atelier's own `think_tool.js`, `curiosity.js` and `autobackup.js`, in the same
sandbox), while her loop is here; an open page steps back from each:
- **Her tree-of-thought `think`**, in place of the loop's simple one: branches, verifiers (code and shell ones need her
  hands), and judging, through her models.
- **Her rituals' own triggers:** a ritual on a schedule, or waiting for a note to change, fires on the host (through
  her schedules switch).
- **Her curiosity:** wake-ups chosen and measured by her Atelier's own curiosity (her settings: on, hours, range, daily
  cap, activities), run through her loop and her sparks switch, kept in her curiosity chat.
- **Her scheduled backup:** sent to her backup server as her Atelier sends it (gzipped, checksummed, encrypted with
  her passphrase when she chose that), holding what's on the host, never keys. Her backup server's token and
  passphrase stay on each device in her Atelier; on the host the keeper hangs them up write-only at the sea chest,
  where her last backup shows and one can be started now.

**Her schedules, on the host:** while her loop is here, the host runs her prompt schedules from her schedule list
(the same cron her Atelier reads, `host/cron.cjs`), through the loop's and the schedules' switches (and nap). Each run
is a chat every device sees; each schedule says how it went and when it's next. A page served by this host leaves her
schedules to it, so none runs twice. Her jobs too: rituals, playbooks (unless one drives the browser), and shell jobs
when her hands are on this computer. The page and the host ask the same question (`hostTakes` / `hostTakesSchedule`),
so each schedule has exactly one runner; an open page keeps the browser-driving playbooks, and the shell jobs while her
hands are off.

**Her apps on the table:** the Atelier's webxdc apps and their updates live on the host too
(`/host/state/xdc[/<id>[/updates]]`): one table for every device. A move made on the laptop reaches the same app open
on the phone; the host keeps every app's updates in order, even when two devices send at once.

## The Harbor: the host's own page for everything (`/host/harbor`)

Everything typed into the host's window has a place here too, in Pandora's ISLANDS words: the host is the
**harbor**, each resident an **island**, devices are **ferries**, and a fresh client asking for a home waits at the
**reef**. The technical name follows in parentheses wherever precision matters.

- **The open sea:** the harbor's home. A painted ocean with the harbor town at its heart and every resident's island
  at a real distance around it, each painted as her own land (lilac tropics, misty highlands, a desert oasis, a snowy
  fjord, maple hills, a coral atoll; she can be given another). Drag to sail, wheel or `+`/`−` to come nearer or
  farther, arrow keys too. Clicking an island sails there: the farther it lies, the longer the voyage, rising a little
  mid-way to see farther, while high clouds drift past more slowly than the sea (parallax). Arriving, her card offers
  to step ashore. The harbor town's own places: the **lighthouse** (the keeper's), the **ferry office** (PINs), the
  **shipyard** (a new island), the **drydock** (raising islands as their own); the **reef** lies offshore. The whole
  world plan, region by region, is the harbor's map (B to F: her island's regions, her house, the boat to SEASIDE).
- **Her island (stepping ashore):** her whole land, painted, with a signpost on each of its nine regions. Choosing one
  glides toward it on her land and settles into the region's own scene, where its places are:
  - **the cove:** the jetty (her ferries: release one, light a PIN), the campfire (her bridges: listening and speaking,
    which are lit, a key hung up for one), the sea chest (what was brought in);
  - **the village terrace:** her house (her Atelier; stepping inside comes with parity step 1, and her own address
    opens from here meanwhile) and the garden gate (where she lives, your way to her, raising her island, her hands);
  - **the springs:** the well of her voice (where her loop runs, each job's model, providers, a key hung up, trying her
    model);
  - **the standing stones:** her logbook (what was done, as facts only);
  - **the cliffs:** the lighthouse (her tide: nap, every switch and why it rests, turning back on what the tide turned
    off);
  - **her reef:** her boundary (what was turned away lately);
  - **her house** (from the village terrace, "Step inside"): the hearth (her chats and branches: how many, when),
    the library (her notes and folders), the shelves (the host's tools for her, skills set aside, playbooks approved),
    the computer (where her schedules run, each one's next time and how it last went; her shell), the table (her
    apps, and when each was last played), the mirror (whether her SOUL is written and when it
    changed: hers to write, never edited here), the key hook (how many keys are hung up, never their values); the
    window stands under scaffolding (piece E);
  - **the misty grove, the observatory and the islet** stand under scaffolding, saying which step brings them (her
    memory, device senses, the boat to SEASIDE).

  The keeper tends her through a narrow view of the host's own settings and facts: never her vault, her chats, a key's
  value, or the words she has the redactor hide. Changes are made at the host itself; an island in her own process or
  service is tended over this machine with her key (`/host/front/tend`).
- **The chart:** the same archipelago as a plain list, one click away, for old devices, screen readers, or speed. The
  page remembers which you prefer.
- **The archipelago (on the chart):** every island, with where she lives (in the harbor's waters, her own cove, or her
  own island: `inside`, `process` and `service`), and her tide (high: awake; low: not running).
- **Her island** (click one): the painting grows from where it sat on the sea into her island, with signposts on
  the island itself (the cottage, the jetty, the palm, the beach…). Each opens what it looks after: move her, choose your way to her (walk her shore, or a tide pool between you:
  `person` or `doorstep`), her hands on this shore (`host_shell`), and raising her island. Raising asks the computer
  for the keeper's hand: the administrator prompt appears on the host's own screen, and saying yes there is the
  person's step. The install and remove steps can be read first.
- **A new island:** a journey from a seed. Name her, then her garden (a new home, or one already on this computer),
  where she lives, your way to her, and she joins the archipelago. Each step goes a little further out, from a seed
  to the stars.
- **Ferries:** light a PIN to moor one (pair a device), and release one.
- **The reef:** welcome a fresh client's resident, or turn her back.

**Who may do what:**
- **The keeper's ferry** pairs once, at the host itself, with the PIN the host shows ("light the lantern"). Keepers
  are kept apart from every resident's devices (`keepers.json`, SHA-256s only). A keeper's key opens no resident, and
  no resident's device opens the harbor.
- **Seeing the harbor:** a keeper's ferry, from this machine, home or the tailnet. Folders show only at the host.
- **Changing anything:** at the host itself only, straight from this machine, as with the host's window.

The paintings (`host/harbor-art/`) were made for this page with an image model on the house's own Mac, then lifted
off their paper so they float on the page's sea in light and dark. Each island's painting shows where she lives.

It's plain HTML, CSS and a little script, with nothing loaded from elsewhere. It has light and dark themes, follows the
system's choice, and keeps still when the system asks for reduced motion.

## Her things on the host: the Atelier's own backup file (`host/backup.cjs`)

Her things move onto the host the way they already move between the HTML and APK versions: in the same backup file,
with the same steps, and with ways back. Nothing new to learn, and no second format.

- **The file.** Use Config → Backup → **Export everything** or **Export config** in any Atelier (HTML, APK, or Jade
  Vault), or a scheduled backup. Plain JSON, gzip and the encrypted envelope are all read; an encrypted one asks for its
  passphrase.
- **The steps.** These are the page's own steps.
  - A Jade Vault backup's `/Jade` paths become `/Pandora`, and flows become rituals. The host loads
    `app/modules/migrate.js` itself, so there is one set of rules, not a copy.
  - **Everything** replaces, and **config** merges (settings, SOUL/AGENTS/SYSTEM, memory, skills).
  - The host asks the page's own question first. On the host's page, under **Her things**: choose the file, **Read
    it** (nothing changes yet: it says what the file holds), then the yes.
- **Where it lands.**
  - Her files go into the home folder.
  - Her chats, schedules, ritual runs, settings and storage go into the host's Atelier store (`<state>/atelier/`).
    That's what her loop on the host will read next.
- **The way back.**
  - Before anything is written, what was there is kept in `<state>/imports/<id>/before/`, and never deleted.
  - **Undo** (the latest import) puts it back. What the import brought is kept in `<id>/undone/`.
  - **Export everything** and **Export config** on the host's page write her things in this same file. The HTML and
    APK versions take it with their own Import button.
- **Two kinds of keys, kept apart.**
  - **The person's**, configured in the Atelier's own settings (model providers, bridges, the backup server, MCP
    secrets), are in a backup only when they ticked "Include API keys".
    - Then they go into the host's own write-only key files: her models' (`model-secrets.json`), her bridges'
      (`bridge-secrets.json`), and `atelier-secrets.json` for the rest. All are owner-only, never shown back, and
      named in the preview (never their values).
    - Undo puts the key files back as they were.
    - Without the tick, any that are there anyway are left out, by name. The host's exports hold none.
  - **Hers** (her nsec, her API keys, her wallets) aren't in the Atelier or any of its folders, `/Pandora` included.
    They're wherever she put them when she built her tools in her own disk space, and her MCP server tools use them
    there.
    - They're never in the Atelier's backup.
    - The host only writes inside her home folder and its own state folder, so an import can't reach them.
  - **A further guard inside her home.** An import, an undo or an export never reads, moves, copies, logs or
    overwrites anything there that looks like a key, even when "everything" replaces the rest of her home.
    - That covers files and folders named like keys (`.nsec`, `.key`, `.pem`, `id_ed25519`, `.env`, `wallet…`,
      `keys/`, `secrets/` and the like).
    - It also covers any place listed in the host's `herKeys` setting (on its page, under Her things).
- **Safe while windows are open.**
  - An import waits while an Atelier window is writing her vault: close it, or wait half a minute.
  - While an import is written, no window writes. Reload open windows afterwards.
  - Imports, undos and their previews are only possible from the house network or the tailnet. Export also works
    from elsewhere, since it only reads.

## Not yet

These are the next milestones, in this order:

1. **Her chats, schedules, settings and run history come onto the host from a backup** (above), but the Atelier
   still reads them from its own browser, and turns still run in the page. Next:
   - the Atelier reads and writes them on the host, so every device shares one conversation;
   - then the agent loop behind `host/runtime.cjs`, so every device also shares one heartbeat (while a client is
     connected).
2. **The real shell sees the home through the host's own paths.**
   - A relative path, or `$PANDORA_HOME/Pandora/SOUL.md`, reaches the same file the vault calls `/Pandora/SOUL.md`.
   - A bare `/Pandora/…` in the real shell means the host's own `/`, so it doesn't reach that file.
3. **Plain HTTP on the network** can be read by others on the same network. Prefer the tailnet's HTTPS for anything
   beyond the home network.

4. **The Atelier's own settings pages** don't drive the host's switches yet, and the Atelier doesn't wear the new
   colour yet. Both are page changes, next.
5. **Her models on the host** answer plain turns, the heartbeat, schedules and sparks. Tool calls in a host turn come
   with the agent loop (milestone 1). Until then, a loop that needs her tools stays in the Atelier.
6. **Residents, beyond the host itself:**
   - The host's settings page shows whose it is. Neither it nor the Atelier page can list or make other residents
     yet.
   - Each platform's client installing once per resident (on Android, its own application id) comes with the
     clients.
   - A resident as her own service needs the person's yes as admin; the Harbor asks for it on the host's screen
     (Windows), and shows the command to run elsewhere.
   - The Linux and macOS steps are written and checked, but not yet run on those systems.

Tests: `tests/home_host_test.mjs`, `tests/nap_test.mjs`, `tests/switches_test.mjs`, `tests/models_test.mjs`, `tests/host_import_test.mjs`, `tests/host_residents_test.mjs`, `tests/host_services_test.mjs`, `tests/host_harbor_test.mjs`, `tests/host_state_test.mjs` and `tests/host_loop_test.mjs`, in the repo's test run
(synthetic homes, a stand-in model, and a stand-in bridge the host starts itself).
