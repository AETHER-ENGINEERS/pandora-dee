# Jade Vector bridge

Puts Jade on [Vector](https://vectorapp.io), the private messenger. Vector's protocol (encrypted DMs,
Concord communities, Mini Apps over Iroh) runs in Vector's own **vector-agent**, an MCP server. This
folder adds:

- `patch_vector_agent.py`: adds the tools Jade needs to vector-agent: `send_message` (DMs and channels,
  threaded replies), `react`, `send_typing`, `edit_message`, `delete_message`, `send_file_bytes`,
  `download_attachment`, `get_new_events` (reactions, edits, deletes, invites).
- `jade_vector_bridge.py`: runs vector-agent and serves it over HTTP with a bearer token, so the
  Jade Vault app (phone or browser) can reach it. Standard-library Python only.
- `setup.sh` (macOS, Linux) and a `Dockerfile` / `docker-compose.yml`.

Jade's brain stays in the app: the bridge only carries messages. Keep the app running (Android:
Config → Background mode) for her to answer; the bridge keeps the account online and queues what
arrives in between.

```
 phone / browser                      computer that stays on
┌──────────────────┐   HTTP + token   ┌───────────────────────────────┐   Nostr relays,
│ Jade Vault       │ ───────────────▶ │ jade_vector_bridge.py         │   Blossom, Iroh
│ (model, tools,   │ ◀─────────────── │   └─ vector-agent (MCP stdio) │ ◀────────────▶ Vector
│  triggers, roles)│                  └───────────────────────────────┘
└──────────────────┘
```

## Install

### macOS or Linux

```sh
cd jade-vector
./setup.sh
```

It installs what is missing (Xcode tools on macOS; a C compiler, clang, pkg-config and git through
apt, dnf or pacman on Linux; Rust through rustup). Then it:
1. Fetches Vector at the commit the patch was written against and applies the patch.
2. Builds `vector-agent` (the first build takes a while).
3. Starts the bridge as a service: launchd on macOS, a systemd user service on Linux.
4. Prints the **Bridge URL** and **Bridge token** to put in Jade Vault → Config → Vector messenger.

- `./setup.sh --no-service` builds only; run `~/.jade-vector/run.sh` yourself.
- `./setup.sh --uninstall` removes the service and keeps your key and data.

### Docker

```sh
cd jade-vector
docker compose up -d --build
docker compose logs | grep "Bridge token"
```

The bot key, token and chat history live in the `jade-vector-data` volume. To use an existing bot
account, set `VECTOR_NSEC` in `docker-compose.yml` before the first start.

## The bot account

On first start the bridge creates a fresh Vector identity for Jade and stores it in
`~/.jade-vector/nsec` (`/data/nsec` in Docker, mode 600). Back that file up: whoever has it *is* Jade
on Vector. To use an account you made in the Vector app, put its `nsec1…` there (or set
`VECTOR_NSEC`) before the first start. Never use your personal key.

In the app, Config → Vector messenger → **Copy her npub**, then message her from your Vector account.

## Options

| Flag / variable | Default | |
| --- | --- | --- |
| `--port` / `JADE_VECTOR_PORT` | 8787 | |
| `--host` / `JADE_VECTOR_HOST` | 0.0.0.0 | `127.0.0.1` to keep it on this machine |
| `--tls-cert`, `--tls-key` | off | serve HTTPS |
| `--allow-origin` | `*` | CORS origin for browser use (the token still applies) |
| `--new-token` | | make a new token; the old one stops working |
| `--print-token` | | print the token and exit |
| `JADE_VECTOR_HOME` | `~/.jade-vector` | key, token, data |
| `VECTOR_NSEC` | | use this key instead of the stored one |
| `VECTOR_LOG` | `warn` | vector-agent log level |

## Reaching it from your phone

On the same Wi-Fi, use the computer's LAN address (the setup prints it). Away from home, use
Tailscale or WireGuard and the computer's tailnet address. Do not port-forward the bridge to the
internet: anyone with the token controls the bot.

## Testing without Vector

`test/fake_vector_agent.py` is a stand-in for vector-agent with the same tools and an in-memory
network; the repository's `tests/vector_test.mjs` drives the app through the real bridge with it.

```sh
python3 jade_vector_bridge.py --agent "python3 test/fake_vector_agent.py" --host 127.0.0.1
```
