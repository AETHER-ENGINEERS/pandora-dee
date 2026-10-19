# Discord bridge and connector

**Jade Vault 2.9.0** · [Documentation index](README-docs.md)

Connect Pandora to Discord to answer DMs and channel messages, react, share files, and take messages for you. Discord support requires Jade Vault **2.8.0 or later** and a bridge running on a separate computer.

## Architecture and credentials

```text
Jade Vault browser/Android app
  model, tools, roles, triggers, conversation sessions
       ↕ HTTP(S) /mcp + bridge bearer token
Jade Discord bridge on an always-on computer
  discord.py, bot token, incoming-message queue
       ↕ Discord Gateway and REST API
Discord
```

The bridge maintains the bot connection; Pandora's reasoning still runs in the app. Keep both running for replies. discord.py handles Gateway reconnect/resume and Discord rate limits. The app polls the bridge (default interval three seconds).

Two different secrets are involved:

| Credential | Stored/used where | Purpose |
| --- | --- | --- |
| Discord bot token | Bridge host; `~/.jade-discord/bot_token` by default | Logs the bot into Discord |
| Bridge bearer token | Bridge state plus Jade Vault Config | Authorizes access to the bridge's HTTP/MCP service |

Never paste the Discord bot token into Pandora's chat or the app's Bridge token field. Keep bot/bridge tokens separate from model keys, Vector bridge tokens, and Android API tokens.

## 1. Create the Discord bot

1. In the [Discord Developer Portal](https://discord.com/developers/applications), create an application and open its Bot section.
2. Generate/reset the bot token. Supply it to the bridge only, using the interactive setup below.
3. Enable **Message Content Intent** for ordinary channel-text handling.
4. After connecting the app, use **Copy invite link** in its Discord settings to invite the bot to your server. Give only the Discord permissions you need.
5. Enable Discord Developer Mode to copy your own numeric **User ID**. Partner/admin settings use IDs, not display names or usernames.

Message Content Intent is optional in the implementation: if not authorized, the bridge reconnects without it and reports a warning. DMs and messages that @mention the bot can still work, but a plain-text trigger word in an otherwise unreadable channel message is not a substitute for the missing intent.

Discord's server/channel permission system is additional to Pandora's app-level roles. Being a Pandora admin does not grant the bot permissions Discord has denied.

## 2. Install the bridge

Run these commands on the computer hosting the bridge, from a repository checkout containing `jade-discord/`.

### Automatic setup: macOS/Linux

```sh
cd jade-discord
./setup.sh
```

The script requires Python 3.9+, creates a private virtual environment under `~/.jade-discord`, installs the requirements, prompts for the bot token, and registers a launchd or systemd user service. On Debian/Ubuntu you may need the `python3-venv` OS package.

It prints the Bridge URL/token; treat terminal output and logs as private. `./setup.sh --no-service` installs without registering a service; run `~/.jade-discord/run.sh` yourself. `./setup.sh --uninstall` removes the service but **keeps tokens/state**. `JADE_DISCORD_HOME` can change the state directory.

### Manual setup

From `jade-discord/`, in a trusted terminal:

```sh
python3 -m venv "$HOME/.jade-discord-manual-venv"
. "$HOME/.jade-discord-manual-venv/bin/activate"
python3 -m pip install -r requirements.txt
python3 jade_discord_bridge.py --set-token
python3 jade_discord_bridge.py
```

`--set-token` stores the bot token in the bridge state directory with mode 600. Requirements include `discord.py>=2.4` and `audioop-lts` on Python 3.13+. A manual foreground process must stay running; use a service/container for sustained operation.

### Docker Compose

From `jade-discord/`:

```sh
docker compose build
docker compose run --rm jade-discord --set-token
docker compose up -d
docker compose logs
```

Building first makes the local image available for the one-time token setup. Tokens persist in the **`jade-discord-data`** volume at `/data`. Do not remove that volume without preserving the required credentials. The Compose file maps port 8788 and has restart policy `unless-stopped`.

`DISCORD_BOT_TOKEN` is an alternative to interactive token storage, but putting its value in a tracked Compose file would leak it. Prefer interactive storage or your deployment's secret-injection mechanism.

The source provides a local Dockerfile/Compose image named `jade-discord:latest`; the existing GHCR publishing workflow still builds Vector, not Discord. Do not assume a published Discord GHCR image exists from these files alone.

## 3. Connect the app

In the **2.9.0 app**, open Config → Connect → **Discord (Pandora as a bot)**, or type `/discord` in the app chat.

1. Set Bridge URL, for example `http://192.168.1.20:8788/mcp`.
2. Set the **bridge bearer token** printed by the bridge.
3. Set your Discord numeric user ID as **Partner**; review this carefully because it grants full Pandora permissions.
4. Add optional admin IDs.
5. Choose the DM policy, channel whitelist, triggers/words, and Partner-notification policy.
6. Enable **Run Pandora on Discord** and save/apply settings.
7. Check status and any Message Content Intent warning, then invite the bot and test a Partner DM.

Use the bridge computer's LAN/private-VPN address from a phone, not `localhost`. Browser CORS, TLS, and mixed-content constraints still apply. See [provider/network configuration](configuration.md) for the same general browser limitations.

### Participation rules

- An empty channel whitelist does not enable ordinary public channel participation.
- Whitelist entries can identify channel IDs, server IDs, `#channel` names, or server names. Prefer numeric IDs when names are ambiguous; whitespace-delimited parsing can make multiword names unsuitable.
- Channel replies require a trigger: all messages if configured, otherwise a mention, reply to the bot, or a configured word.
- The Partner can bypass the channel whitelist, but still needs the trigger rule in a group channel.
- DM policies distinguish anyone, known users (Partner/admin), and Partner-only behavior. Partner DMs remain eligible; optionally unanswered DMs are filed in the inbox.

## 4. Roles, tools, and Partner notifications

| Role | Implementation behavior |
| --- | --- |
| Partner | Full Pandora tool access, including vault and scripts |
| Admin whitelist | Discord messaging/moderation actions, `discord_history` (public channels), `notify_owner`, and `web_search`; no vault, memory, shell, HTTP, MCP, or file tools |
| Public | Current-chat actions such as replies, reactions, reading, editing/deleting through supported actions; `discord_history` (public channels), `notify_owner` and `web_search`; no general vault/tool access or cross-chat sends |

Tool lists are filtered and execution guards run again. Discord actions also have an action allowlist and public target restrictions; Discord itself enforces message ownership and server permissions. Non-Partner prompts omit ordinary private vault/memory context but include Pandora's SOUL persona, so do not place private facts in persona text expecting it to be Partner-only.

The `discord` tool provides send/reply, typing, reaction, edit/delete, read/profile, server/channel lists, moderation, and Partner file-transfer capabilities. Use real IDs obtained from the service, not invented examples. Numeric user targets can be expressed as `user:<id>` to disambiguate from channels. Ordinary assistant replies in a Discord session are sent back automatically; avoid sending a duplicate explicit tool reply.

- `discord_history` searches the bridge's archive database (bridge started with `--archive`): one call returns a few compact lines, so recalling the server's past costs no context or rate limit. The Partner searches every archived channel; everyone else only channels the whole server can see. Config → Discord → *What you call the archive* gives it your own name in the character's instructions. See the bridge README for the query syntax.
- `notify_owner` in a Discord chat uses `/Pandora/Discord Inbox.md`, not Vector's inbox.
- Notification settings control inbox-only versus immediate Partner notification/DM behavior; urgent requests are handled according to that policy.
- Attachments saved to the vault use `/attachments/discord/<date>/...` by default. Image interpretation depends on a vision-capable model and image settings.
- Jade Vault 2.9.0 limits outgoing vault file sends to **8 MiB**.

**Member-listing limitation:** the 2.9.0 bridge does not enable Server Members Intent and has no setting to turn it on. Enabling the intent in the Developer Portal alone is insufficient for member listing. Use individual user profiles instead; granting broader Discord permissions does not resolve this limitation.

## 5. Running alongside Vector

Enable each integration with its own URL/token. Discord defaults to **8788**, Vector to **8787**. Each has separate chats and incoming queues, coordinated so only one agent conversation runs at a time; when one finishes it wakes the other queue. This is not parallel model execution.

Discord session titles use the game-controller marker; Vector uses the speech-bubble marker. A connected Discord integration also participates in Android background keep-alive logic. Phone battery restrictions can still interrupt processing.

Discord's bridge drops incoming bot messages to avoid loops and discards stale queued messages after **600 seconds** by default. An always-on bridge with a stopped app is not a promise that all messages will eventually get answered.

## Bridge settings and diagnostics

| Option | Meaning/default |
| --- | --- |
| `--host` / `JADE_DISCORD_HOST` | Listen address, default `0.0.0.0` |
| `--port` / `JADE_DISCORD_PORT` | Default 8788 |
| `JADE_DISCORD_HOME` | Default `~/.jade-discord` |
| `--bot-token-file` | Override bot-token file path |
| `DISCORD_BOT_TOKEN` | Override stored bot token |
| `--max-age` / `JADE_DISCORD_MAX_AGE` | Message queue age cutoff, default 600 seconds |
| `--allow-origin` | CORS origin, default `*` |
| `--tls-cert`, `--tls-key` | Enable HTTPS using certificate/key files |
| `--print-token` | Print bridge token privately and exit |
| `--new-token` | Rotate bridge token; update app settings afterwards |
| `--set-token` | Prompt/store bot token and exit |

This bridge uses HTTP MCP at `/mcp` (POST for requests), **not** Android's GET-only `/v1/...` API. Its `/health` endpoint also requires the bearer token; do not assume the Android public health rule applies.

## Security and backup

- Plain HTTP exposes bearer tokens/messages in transit. Use a trusted LAN/private VPN or configured TLS; do not port-forward to the internet.
- Outgoing messages use empty allowed mentions, preventing @everyone/@here/role notification pings. This does not prevent prompt injection or all undesirable speech.
- Discord messages, images, and tool outputs may be sent to the selected model/fallback provider. Review its data policy.
- With **Include keys** off, app backups omit the Discord bridge token (`dcToken`) from exported settings. The bot token is stored separately on the bridge host, not in the normal app settings.
- Full app backups cover ordinary Discord session/inbox/vault attachment data through the main store. Back up the bridge state separately and securely; app exports are not bridge recovery archives.
- The [backup caveats](backup-and-storage.md) still apply, including plaintext exports and the inbound Android API token exclusion gap.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No Discord settings | Confirm the installed app/source is 2.9.0, rebuild web assets before APK assembly |
| HTTP 401 | Correct bridge token, not bot token or Vector token |
| Bridge online, bot not ready | Bot token validity, Gateway access, bridge error/log output |
| DMs work but channel text does not | Message Content Intent, channel permissions/whitelist, trigger rules |
| Channel messages ignored | Empty/incorrect whitelist, trigger word boundaries, wrong numeric IDs |
| Replies delayed while Vector is active | Expected serialized agent turns; check active work before restarting |
| Older messages not answered | Default ten-minute bridge queue expiry and app uptime |
| Member listing fails | Bridge's member-intent implementation limitation described above |
| Files rejected | Current app 8 MiB send limit and Discord permissions |

For general connection and model problems, see [Troubleshooting](troubleshooting.md). For automated bridge tests, see [Development → Tests](development.md#tests).

## Related guides

- [Vector messenger](vector.md) for the other supported messenger connector.
- [Backups and storage](backup-and-storage.md) for preserving chat and bridge data.
- [Security and privacy](security-and-privacy.md) for credential and data-sharing precautions.
