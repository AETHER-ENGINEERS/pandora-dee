# Vector messenger integration

**Jade Vault 2.9.0** · [Documentation index](README-docs.md)

Jade's model and permissions remain in the app. A separate always-on computer runs a Python HTTP bridge and Vector's patched `vector-agent`, which maintains the messenger identity and receives events. The bridge does not independently run Jade's brain.

```text
Jade Vault app → HTTP(S) + bearer token → Jade Vector bridge
                                           → vector-agent → Vector network
```

## Install the bridge

On macOS/Linux, from the repository:

```sh
cd jade-vector
./setup.sh
```

The setup script fetches the targeted Vector revision, applies the patch, builds the Rust agent, and configures launchd or a systemd user service. It can install missing prerequisites; review the script before running it. `./setup.sh --no-service` builds without registering a service; `./setup.sh --uninstall` removes the service but keeps key/data.

Docker alternative:

```sh
cd jade-vector
docker compose up -d --build
docker compose logs
```

Read the printed Bridge URL/token privately. Docker uses the `jade-vector-data` volume. Do not publish logs containing credentials.

## Connect Jade Vault

1. Open **Config → Connect → Vector messenger**.
2. Enter the bridge URL reachable from this device and its bearer token.
3. Set your own Vector **npub** as owner. This determines who has full agent permissions.
4. Optionally configure admin and channel whitelists, DM policy, trigger rules/words, polling, and secretary notifications.
5. Enable the integration; copy Jade's npub and send a test DM from your owner account.
6. Keep Jade Vault running. On Android, use Config's Background mode as appropriate.

On a phone, the bridge URL is the computer's LAN/VPN address, not `localhost`. For browser clients, consider CORS and HTTPS mixed content.

## Identity and permissions

The bridge creates a bot key at `~/.jade-vector/nsec` (Docker: `/data/nsec`, mode 600). Use a dedicated bot account, not your personal key. To use an existing bot, supply `VECTOR_NSEC` or the stored key before first start. Whoever possesses the key can act as the bot; back it up securely.

| Caller | Permissions |
| --- | --- |
| Owner | Full Jade tool access |
| Whitelisted admin | Vector administrative/messaging powers and web search, no vault tools |
| Public user | Conversation-scoped chat/reactions/Mini Apps, owner notification, web search; no notes, memory, files, shell, HTTP, or MCP |

Tools are filtered before prompting and checked again at execution. Non-owner prompts exclude ordinary private vault/memory context, but include SOUL persona text. Keep private facts out of persona text. Still review outgoing behavior: role enforcement cannot guarantee sensible model-generated speech.

## Run alongside Discord

In 2.9.0, [Discord](discord.md) and Vector can both be enabled. Each has its own bridge URL/token, messenger sessions, and incoming queue. Their queues coordinate busy checks and wake one another so Jade handles **one agent conversation at a time**, not parallel model turns. Connected bridges also participate in Android background-mode decisions.

The `notify_owner` tool routes messages from Discord chats to `/Jade/Discord Inbox.md`; Vector chats use `/Jade/Vector Inbox.md`. Configure the notification policy separately for each connector. Discord defaults to port 8788; Vector defaults to 8787.

## Bridge settings

| Setting | Default/use |
| --- | --- |
| `--host` / `JADE_VECTOR_HOST` | `0.0.0.0`; use `127.0.0.1` for local-only access |
| `--port` / `JADE_VECTOR_PORT` | 8787 |
| `--tls-cert`, `--tls-key` | Enable HTTPS |
| `--allow-origin` | Defaults to `*`; token authentication still required |
| `--new-token` | Rotate the bridge token; update the app afterwards |
| `--print-token` | Print current token and exit; keep output private |
| `JADE_VECTOR_HOME` | State directory, default `~/.jade-vector` |
| `VECTOR_LOG` | Agent logging level, default `warn` |

The Android inbound API also defaults to 8787, but is a **different service**, usually on a different device. URLs/tokens are not interchangeable.

Use trusted LAN, Tailscale, or WireGuard connectivity. Plain HTTP is not encrypted; do not port-forward the bridge to the internet. Back up bridge identity/state separately from Jade Vault exports. For detailed setup and a fake-agent test command, see [jade-vector/README.md](../jade-vector/README.md).
