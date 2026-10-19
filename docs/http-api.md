# Android HTTP API

**Jade Vault 2.9.0** · [Documentation index](README-docs.md)

This is the optional **inbound Android app API**, not a browser-hosting API, model-provider API, or Vector/Discord bridge. There is no dedicated `/v1/discord` route in 2.9.0. It runs the normal Jade chat/flows inside the app.

## Enable and secure

1. In **Config → Connect → API endpoint**, enable the API and save.
2. Choose a port (default **8787**, settings range 1024–65535).
3. Use the generated token or set a strong unique token.
4. Leave LAN access off for phone-local use. Enable Wi-Fi/LAN access only on a trusted network.
5. Use the displayed address. A remote client needs the phone's reachable IP, not its own `localhost`.

The server uses plain HTTP; bearer tokens and prompts are not encrypted in transit. Keep it off the public internet. While enabled, Android uses its background notification/service. Rotate the token after accidental disclosure, then save/apply the settings.

## Protocol and authentication

All application endpoints use **GET** and return JSON. `OPTIONS` is handled for CORS; POST and other application methods are rejected with 405. GET calls can have side effects, so never embed chat/flow URLs in pages, preloaders, or automatic link checkers.

Except for health/discovery (`/v1/health`, `/`, `/v1`), authenticate with:

```text
Authorization: Bearer TOKEN
```

`?token=TOKEN` is also accepted, but headers are preferable because query strings can leak through logs/history. Do not share URLs or terminal output containing the token.

Examples below run on a client computer with `TOKEN` set privately and `BASE` set to the actual phone address:

```sh
BASE='http://192.168.1.30:8787'
curl "$BASE/v1/health"
curl -H "Authorization: Bearer $TOKEN" "$BASE/v1/status"
```

## Routes

| Route | Parameters and result |
| --- | --- |
| `/v1/health` | Public liveness/discovery: `ok`, app, API version, endpoints |
| `/v1/status` | `busy`, selected model/provider, current session, version |
| `/v1/chats` | Up to 100 chats, newest first, with id/title/updated/current |
| `/v1/history` | Optional `session`; `limit` defaults to 20, clamped to 1–200; user/assistant text only |
| `/v1/chat` | Submit a chat message; parameters below |
| `/v1/flows` | Flows with trigger, validity, step count, last-run summary |
| `/v1/flow` | Run a flow by `name` (or `flow`), optional JSON `input`; `steps=0` omits step summaries |

### Chat parameters

| Parameter | Meaning |
| --- | --- |
| `message` | Required nonblank text; aliases `q`, `text`, `prompt`; maximum 20,000 characters |
| `session` | Existing chat id, `new`, or omitted for current chat |
| `new=1` | Start a fresh chat |
| `wait=0` | Return HTTP 202 immediately; poll status/history for completion |
| `tools=0` | Omit tool-call summaries from the response; **does not disable tool execution** |
| `timeout` | Native request wait in seconds; default 300, clamped to 1–1800 |
| `json` | JSON object carrying application parameters; explicit query parameters take precedence |

Pass `timeout` as a query parameter, not only inside `json`. Only `/skill:name` slash commands are accepted; other slash commands are refused.

Send a message, URL-encoded safely:

```sh
curl --get -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'message=What notes mention Lisbon?' \
  --data-urlencode 'session=new' \
  "$BASE/v1/chat"
```

Typical successful shape (illustrative values):

```json
{
  "ok": true,
  "api": 1,
  "session": {"id":"example-id","title":"What notes mention Lisbon?","messages":2,"updated":1791916791826},
  "reply": "See [[Trip Ideas]].",
  "error": null,
  "model": "example-model",
  "elapsed_ms": 4210,
  "tool_calls": [{"name":"notes_search","arguments":{"query":"Lisbon"},"ok":true,"result":"..."}]
}
```

Tool argument strings and result previews are truncated; they are not complete audit records. With `wait=0`, the 202 response indicates acceptance, not a final reply. Poll `/v1/status`, then read `/v1/history?session=ID`.

### Run a flow

```sh
curl --get -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'name=Capture inbox' \
  --data-urlencode 'input={"text":"Review budget"}' \
  "$BASE/v1/flow"
```

The result has `ok`, `api`, and `run` containing id, flow, status, error, output, elapsed time, and optional step summaries. There is no remote flow-edit endpoint here; edit flows in the app/vault.

## Errors and retries

Error bodies generally include `ok:false` and `error:{code,message}`; application replies also identify `api:1`.

| HTTP | Typical reason |
| --- | --- |
| 400 | Missing message/name, bad JSON/input, unsupported slash command |
| 401 | Missing or invalid token |
| 404 | Unknown route, chat, or flow |
| 405 | Unsupported method |
| 409 | Jade is busy; chat accepts one message at a time |
| 413 | Message exceeds 20,000 characters |
| 500 | Internal failure/message not accepted |
| 502 | Agent or flow failure |
| 503 | No model selected |
| 504 | Native wait expired; work can continue inside the app |

A timeout is **not cancellation**. Read status/history before retrying: a duplicate request can repeat file writes or external effects. No idempotency-key API is provided.

Sources: [api.js](../app/modules/api.js), [ApiServer.java](../android/src/app/netrunner/jade/ApiServer.java), [API tests](../tests/api_test.mjs), [native API tests](../android/test/ApiServerTest.java).
