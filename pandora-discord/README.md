# Jade Discord bridge

Puts Jade on **Discord** as a bot. The bot itself is a small [discord.py](https://discordpy.readthedocs.io)
program that keeps the Gateway connection (heartbeats, resume, reconnects, rate limits) and serves
the bot over HTTP as an MCP server with a bearer token, so the Jade Vault app (phone or browser) can
reach it. It is the twin of the [Jade Vector bridge](../jade-vector/README.md) and **runs at the same
time**: each has its own port and token, and in the app both share one conversation queue, so Jade
never answers two chats at once.

- `jade_discord_bridge.py`: the bot and the HTTP bridge (discord.py plus the Python standard library).
- `setup.sh` (macOS, Linux), `Dockerfile`, `docker-compose.yml`.
- `test/fake_discord.py`: a fake Discord (REST and Gateway) used by the test suite with the real discord.py.

Jade's brain stays in the app: the bridge only carries messages. Keep the app running (Android:
Config → Background mode) for her to answer; the bridge keeps the bot online and queues what
arrives in between (messages older than 10 minutes are dropped, so she does not answer yesterday's chat).

```
 phone / browser                      computer that stays on
┌──────────────────┐   HTTP + token   ┌──────────────────────────┐   Discord Gateway
│ Jade Vault       │ ───────────────▶ │ jade_discord_bridge.py   │   and REST API
│ (model, tools,   │ ◀─────────────── │   └─ discord.py bot      │ ◀──────────────▶ Discord
│  triggers, roles)│                  └──────────────────────────┘
└──────────────────┘
```

## 1. Make the bot

1. <https://discord.com/developers/applications> → **New Application** → **Bot**.
2. **Reset Token** and copy it (you will give it to the bridge, never to the app).
3. Under **Privileged Gateway Intents** switch on **Message Content Intent**. Without it the bot only sees
   DMs and messages that @mention it (the bridge tells the app so, and carries on).
4. Add her to your server: in Jade Vault → Config → Discord, after connecting, **Copy invite link** and open it.

## 2. Install the bridge

### macOS or Linux

```sh
cd jade-discord
./setup.sh
```

It creates a virtualenv in `~/.jade-discord`, installs discord.py, asks for the bot token, and starts
the bridge as a service (launchd on macOS, a systemd user service on Linux). It prints the **Bridge URL**
and the **Bridge token**.

- `./setup.sh --no-service` installs only; run `~/.jade-discord/run.sh` yourself.
- `./setup.sh --uninstall` removes the service and keeps your tokens.
- On a **public server** (a VPS), run `JADE_DISCORD_HOST=127.0.0.1 ./setup.sh` so the bridge listens on the server
  itself only, and reach it through an SSH tunnel or Tailscale. The default (`0.0.0.0`) suits a computer at home.

### By hand

```sh
pip install -r requirements.txt            # discord.py (Python 3.9+; 3.13 also needs audioop-lts, listed)
python3 jade_discord_bridge.py --set-token # stores the bot token in ~/.jade-discord/bot_token (mode 600)
python3 jade_discord_bridge.py             # serves http://0.0.0.0:8788/mcp, prints the bridge token
```

### Docker

```sh
cd jade-discord
docker compose run --rm jade-discord --set-token     # once: stores the bot token in the data volume
docker compose up -d --build
docker compose logs | grep "Bridge token"
```

Or skip `--set-token` and set `DISCORD_BOT_TOKEN` in `docker-compose.yml`.

## 3. Connect Jade Vault

Config → **Discord (Jade as a bot)**: paste the **Bridge URL** (for example `http://192.168.1.20:8788/mcp`)
and the **Bridge token**, put your own Discord user id as **Owner** (Developer Mode → right-click yourself →
Copy User ID), switch **Run Jade on Discord** on. Then choose who may DM her, which channels she takes part in
(ids, `#names` or server names), the trigger words, and what happens to messages for you.

You (the owner) get the same Jade as in the app, with every tool. Admins get Discord powers (message people,
kick, ban, leave servers) but never your notes, memory or files. Everyone else can chat and leave you messages.

## 4. The archive (optional)

The reply queue forgets: what arrives while the app is closed waits 10 minutes, then Jade lets it go, so she never answers
yesterday's chat. The **archive** is the other half. Turn it on and the bridge keeps **every message the bot can see**, on
the computer it runs on, whether or not the app is open: people, other bots and webhooks, Jade's own replies, edits,
deletions, replies (with the message they answer), embeds, reactions and attachments (downloaded at once, because
Discord's file links expire).

```sh
python3 jade_discord_bridge.py --archive                  # keep live messages (servers; add --archive-dms for DMs)
python3 jade_discord_bridge.py --backfill                 # once: the whole history of every server, then exit
python3 jade_discord_bridge.py --render ~/vault --name "My Archive" --description "What this server remembers."
./setup.sh --archive                                      # the same as a service
```

In Docker, set `JADE_DISCORD_ARCHIVE: "1"` in `docker-compose.yml`; the archive lives in the data volume.

**What it keeps.** `~/.jade-discord/archive/<server id>/<channel id>.jsonl`, one line per event (`create`, `edit`,
`delete`), never rewritten; `channels.json` (names, topics, which channel a thread belongs to); `files/` (attachments).
Nothing is decided or summarised here: it is the raw record, the floor that later passes dig in.

**Backfill.** `--backfill [server id …]`, or the `archive_backfill` tool while the bridge runs, reads every text, voice
and announcement channel, every active and archived thread and every forum post the bot can read, oldest first. It
remembers how far it got in each channel (`state.json`), so it can be stopped and run again, and a second run only adds
what is new. While the bridge is running as a service, use the tool rather than a second process. The bot needs **View Channel** and **Read Message History**; private archived threads also need **Manage
Threads** (it skips what it cannot read and says so).

**Render.** `--render OUT_DIR` writes the archive as markdown notes, an Obsidian-style vault, without Discord or a token:
`<name>/<server>/<channel>/<YYYY-MM>.md`, threads in `<channel>/threads/`, every reply linked to the message it answers,
images embedded from `<name>/_files/`, and an index note. `--name` and `--description` are yours: call it an archive,
a memory, a library or anything else; the folder and the index note take that name. Deleted messages are left out of
the notes and of search. Render again any time; the notes are rewritten from the archive.

**Tools.** `archive_status` (size, and how a backfill is going), `archive_backfill`, `archive_search` (text or author;
`chat_id` to stay in one channel).

**Tell your members.** The archive keeps everyone's messages, not only yours, on whatever computer runs the bridge.
Say so on the server, keep that computer's disk private, and remember the raw record still holds deleted messages
(only the notes and search leave them out): delete the archive folder to forget them.

## Safety

- The bridge's token is 192 random bits; every request needs it (`Authorization: Bearer …`). Wrong tokens get a
  401 after a short delay. `--new-token` replaces it.
- The bridge speaks plain HTTP. Keep it on a trusted network (home Wi-Fi, Tailscale or WireGuard), or serve HTTPS
  with `--tls-cert` and `--tls-key`.
- Every message the bridge sends has empty `allowed_mentions`: Jade can never ping @everyone, @here or roles.
- Bots are never queued, so two bots cannot talk each other into a loop.
- The bot token never leaves the bridge's computer, and the app leaves the bridge token out of backups.

## Tools

`status`, `my_user`, `get_new_messages`, `send_message` (channel or DM, replies, long text split under 2000
characters), `send_typing`, `react`, `edit_message`, `delete_message`, `get_messages`, `send_file_bytes`,
`download_attachment`, `get_user`, `list_guilds`, `list_channels`, `list_members` (needs the Server Members
Intent), `kick`, `ban`, `unban`, `leave_guild`; with `--archive`: `archive_status`, `archive_backfill`, `archive_search`.

## Options

`--port` (8788), `--host` (0.0.0.0), `--max-age` seconds a queued message stays valid (600), `--allow-origin`
(CORS, default `*`), `--tls-cert/--tls-key`, `--print-token`, `--new-token`, `--set-token`,
`--bot-token-file`; the archive: `--archive`, `--archive-dir`, `--archive-dms`, `--archive-files-mb` (25; 0 keeps links
only), `--backfill [server id …]`, `--render OUT_DIR`, `--name`, `--description`. Environment: `JADE_DISCORD_HOME`,
`JADE_DISCORD_PORT`, `DISCORD_BOT_TOKEN`, `JADE_DISCORD_ARCHIVE`, `JADE_DISCORD_ARCHIVE_DIR`, `JADE_DISCORD_ARCHIVE_DMS`,
`JADE_DISCORD_ARCHIVE_FILES_MB`, `JADE_DISCORD_ARCHIVE_NAME`, `JADE_DISCORD_ARCHIVE_DESCRIPTION`.

## Tests

`npm test` runs `tests/discord_test.mjs`: the real bridge with the real discord.py against `test/fake_discord.py`,
together with the Vector bridge and a scripted model (roles, scopes, triggers, chunking, resume, the Message
Content fallback, one shared queue). `tests/discord_archive_py.py` covers the archive: live messages, bots, edits,
deletions, files, DMs left out, backfill of channels and threads, resuming, search and the rendered notes. Both need
`pip install discord.py`.
