# Troubleshooting

**Jade Vault 2.9.0** · [Documentation index](README-docs.md)

Before clearing storage, reinstalling, or restoring: **export your current data**. Record app version, platform, provider/model, and the exact error without exposing tokens or private notes.

## Model connection and chat

| Symptom | What to check |
| --- | --- |
| Offline/model list empty | Server running, correct API base, compatible `/models` or `/api/tags`, valid key |
| Works on computer, not phone | Phone uses computer LAN/VPN IP; `localhost` on phone is not the computer |
| Browser `Failed to fetch` | Server reachability, CORS, TLS certificates, HTTPS-to-HTTP mixed content; browser console/network details |
| HTTP 401 | Correct provider/key, no accidental whitespace, expected authentication scheme |
| HTTP 429 | Rate limit/quota; reduce requests or use an explicitly configured fallback |
| Replies but no tools | Tool support in selected model/provider, enabled tool settings; AICord has no tool calling |
| Unexpected provider/model | Fallback activated; inspect active provider and each provider's saved model selection |
| Context errors | Lower requested context/output or start a shorter chat; context guard cannot exceed server/model limits |
| Images ignored | Vision support, attachment processing, compatible provider/model |

Never paste provider keys into an issue to demonstrate an error. A local model still needs a reachable server. See [configuration](configuration.md).

## Missing notes or storage

1. Confirm the same browser profile, protocol, host, and port are in use.
2. Check whether this is the Android app or a browser installation: they have separate stores.
3. Search by full path/name and check link resolution where duplicate filenames exist.
4. Inspect backup contents before restoring; a config export is not a full notes backup.
5. Do not clear site/app data as an initial repair step. Check [storage coverage](backup-and-storage.md).

A full restore replaces the main store but does not imply restoration of app update history, trajectories, TensorFlow models, or bridge identity.

## Notes, scripts, and templates

- Missing links: use an explicit path, verify spelling and note existence.
- Graph/search omissions: ensure Markdown extension; `.git`, `node_modules`, `.trash`, and skill paths are excluded from normal note indexing.
- Script shows as code: use `dataviewjs`/`jade-js` and switch to Read/Split.
- Tool calls rejected in note scripts: permission is off by default; only enable after reviewing the code.
- Template not listed: check configured template folder (default `/Templates`).
- Desktop package import fails: the JavaScript and MicroPython runtimes are compatibility sandboxes, not full Node/CPython installations.
- GPU unavailable: TensorFlow.js falls back to CPU; worker/WebView GPU support varies.

See [scripting](scripting.md) and [note scripts/templates](note-scripts-and-templates.md).

## Automations and background work

- Schedules/Vector/Discord/heartbeat need the app running; closed or suspended processes cannot execute them.
- On Android, enable background mode and appropriate notifications/battery exemptions. Device policies can still stop work.
- Check device clock/timezone, trigger configuration, enabled state, and catch-up settings.
- Heartbeat silently skips an effectively empty HEARTBEAT file or acknowledges with `HEARTBEAT_OK`.
- Inspect flow run details and `/Jade/Logs/cron.log` for command/flow schedules.
- “Jade is busy” can mean an agent-containing flow was called during another chat turn. Launch it manually or later.
- Expression errors/timeouts: validate JavaScript and available `$json` shape; inspect the previous step's output.
- Continued errors produce `{error:...}` rather than the expected success object; handle that explicitly.
- Repeated writes/messages may come from retries or self-triggering note flows. Disable the trigger while debugging.

See [automation](automation.md).

## Integrations

**MCP:** validate `/Jade/mcp.json`, streamable HTTP transport (not stdio/legacy SSE), endpoint CORS, headers/secrets, enabled state, and tool exposure. Codemode/deferred tools are intentionally not all declared directly to the model.

**Vector:** confirm bridge process/container, reachable URL/token, dedicated bot key, owner npub, DM/channel/trigger policy, and that Jade Vault is running. The bridge can stay online without the app generating replies. Protect logs that print the token.

**Discord:** confirm app/source version 2.9.0, bridge URL ending in `/mcp`, bridge bearer token (not the bot token), numeric owner/admin IDs, channel whitelist, and trigger/DM settings. Missing Message Content Intent limits ordinary channel text while DMs/@mentions can still work. Messages older than the default ten-minute bridge cutoff are dropped. A Vector turn can delay a Discord turn because agent work is serialized. See the [Discord troubleshooting table](discord.md#troubleshooting), including the member-intent limitation.

**HTTP request tool:** inspect status/body, method and body compatibility, secret names, CORS, and timeout. GET/HEAD cannot carry request bodies. A remote API may receive a write even if the client later times out; check before retrying.

**Android API:** health is public but other routes need the correct API token. Confirm LAN access for remote clients, port/firewall, and phone address. This is not the Vector bridge token. HTTP 409 means busy; 504 does not cancel the ongoing chat. `tools=0` only removes response summaries.

See [integrations](integrations.md), [Vector](vector.md), [Discord](discord.md), and [HTTP API](http-api.md).

## Build and tests

| Failure | Next step |
| --- | --- |
| Missing npm dependencies | Run `npm install`; use Node 20+ |
| Exact-match build failure | Inspect base/module changes and `app/build.py` markers; do not suppress checks |
| Missing generated test pages | Run `npm run build` before tests |
| Chromium executable missing | Run `npx playwright install chromium` |
| Missing Linux browser libraries | On supported systems use `npx playwright install --with-deps chromium` |
| Discord tests cannot import discord.py/audioop | Activate the test virtual environment and install `jade-discord/requirements.txt`; see [development setup](development.md#tests) |
| Java API test fails to launch | Install full JDK 17+, verify `java`/`javac` PATH |
| Tests interfere with one another | Do not run multiple runners concurrently: each resets `tests/.work` |
| All-suite run slow | Run a specific suite via `node tests/run.mjs flows_test`, then broaden coverage |
| APK compilation/signing failure | Follow [APK troubleshooting](android-apk.md#common-failures) and inspect full build output |

## Requesting help

Include reproduction steps, version, browser/Android/WebView version, selected provider/model, relevant sanitized logs, and whether the issue occurs on a clean test vault. Use a small synthetic note/flow rather than publishing a real backup or trajectory. Security vulnerabilities belong in the [private reporting process](../SECURITY.md).
