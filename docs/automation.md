# Rituals, schedules, and heartbeat

**Jade Vault 2.9.0** · [Documentation index](README-docs.md)

> Automations execute while the app is running. A closed browser, suspended tab, stopped Android process, or unavailable provider can delay/prevent work. Android background mode helps but does not provide server-grade scheduling guarantees.

## Ritual storage and execution

Rituals are JSON files at `/Pandora/Rituals/<name>.ritual.json`, editable in the Rituals tab or through Atelier files/tools. Steps execute in order. Each output becomes `$json` for the next step; the original input remains `$input`.

A model-free example that appends a capture and notifies you:

```json
{
  "name": "Capture inbox",
  "description": "Append a supplied item to the inbox",
  "enabled": true,
  "trigger": {"type": "manual"},
  "vars": {"path": "/Inbox.md"},
  "timeout": 60,
  "steps": [
    {"type": "note", "name": "Capture", "action": "append",
     "path": "{{ $vars.path }}", "content": "\n- {{ $input.text }}"},
    {"type": "notify", "title": "Captured", "body": "Added an inbox item"}
  ]
}
```

Save/import this JSON as `/Pandora/Rituals/Capture inbox.ritual.json`, then run it from Rituals with input `{"text":"Review the project plan"}`. Back up first when testing rituals that modify important leaves.

Jade Vault's flows keep working: `<name>.flow.json` files load (a `<name>.ritual.json` of the same name wins, and saving writes `.ritual.json`), and `flow run`, `jade.flow()`, `/v1/flow` and the `flow` tool are aliases of `ritual run`, `pandora.ritual()`, `/v1/ritual` and the `ritual` tool. Old `/Jade/Flows` files move to `/Pandora/Rituals` by themselves; see [Backup and storage](backup-and-storage.md#migration-and-upgrades).

### Top-level fields

| Field | Meaning |
| --- | --- |
| `name`, `description` | Display name and explanation |
| `enabled` | Enables/disables automatic triggering |
| `trigger` | `manual`, `schedule` with `when`, or `note` with `path` |
| `vars` | User-defined variables available as `$vars` |
| `timeout` | Overall deadline in seconds; default 600, bounded to 5–3600 |
| `steps` | Ordered array of steps |

### Step types and important fields

| `type` | Fields and behavior |
| --- | --- |
| `tool` | `tool`, `args`, optional `parse`; call an enabled tool (including Discord), optionally parse JSON output |
| `js` | `code`, `timeout`; node sandbox with `fs`, `fetch`, `pandora.*`; returns a value or printed output |
| `shell` | `command`, `cwd`, `allowFail`, `timeout`; produces `{code, stdout, stderr}` |
| `decide` | `state`, `question`, `kind` (`choice`, `score`, `yesno`), `options`; Ollaya decision result |
| `llm` | `prompt`, optional `system`, `json`; one answer, no agent tools |
| `agent` | `prompt`, `chat` (`new` or `same`); full Pandora chat turn |
| `note` | `action` (`read`, `write`, `append`, `prepend`), `path`, `content` |
| `set` | `fields`, `keep`; construct an object, optionally retaining incoming fields |
| `if` | `condition`, `then`, `else`; run a branch |
| `switch` | `value`, `cases` with `match`/`steps`, `default`; first matching case |
| `each` | `items`, `steps`; iterate with `$item` and `$index`; returns collected results |
| `wait` | `seconds`; pause up to 300 seconds |
| `notify` | `title`, `body`; toast/native notification as available |
| `flow` | `flow`, optional `input`; run another ritual |
| `stop` | Optional `value`; end successfully |

Common fields include `id`, `name`, `disabled`, `retries` (0–3), and `onError` (`stop` or `continue`). Continuing after a failure produces `{ "error": "…" }`; downstream steps must handle it. Retrying a step can repeat writes, messages, or API calls. Container steps are not retried as a whole.

### Expressions

Text fields can interpolate `{{ JavaScript }}`. A field consisting solely of one expression can preserve the expression's value/type. Condition/list fields are JavaScript expressions, for example `$json.count > 0` or `$json.items`.

| Variable | Value |
| --- | --- |
| `$json` | Current step input |
| `$input` | Original ritual input |
| `$node["Step name"]` | Output of a named prior step |
| `$vars` | Ritual variables |
| `$item`, `$index` | Current loop item and index |
| `$now`, `$today` | Current ISO timestamp and local date |
| `$flow`, `$run` | Ritual/run context |
| `$date(fmt, date, days)` | Date formatting/offset helper |

Expression evaluation has no network access and a five-second worker timeout. Actual JavaScript and tool steps have broader capabilities. Ritual execution is bounded to 5,000 steps, nested ritual depth 5, and per-script/shell time limits (default 60 seconds, capped at 600). Run records show step status, input/output previews, errors, logs, and timing; do not treat previews as complete file archives.

Discord's tool is available in the 2.9.0 ritual editor's tool list/descriptions. Configure the connector before calling it; no Discord-specific step type is needed. `notify_owner` invoked in a Discord chat routes to the Discord inbox/notification policy. See [Discord permissions](discord.md#4-roles-tools-and-Partner-notifications).

### Triggers and entry points

- Manual: Run in Rituals.
- Scheduled: `{"type":"schedule","when":"every weekday at 9am"}`.
- Leaf/workshop: `{"type":"note","path":"/Inbox.md"}`. Avoid rituals that repeatedly trigger themselves through writes.
- Shell: `ritual run 'Capture inbox' '{"text":"Review budget"}'`.
- JavaScript: `await pandora.ritual('Capture inbox', {text: 'Review budget'})`.
- Pandora's `ritual` tool: help, list, get, create, update, delete, run, runs (a call to `flow`, its Jade Vault name, still reaches it).
- Android API: `/v1/ritual?name=...&input=...`.

Agent steps cannot run while Pandora is busy in a chat turn. Do not call an agent-containing ritual from Pandora's own active tool turn; use the UI or a schedule instead.

## Schedules and crontab

The Schedule tab supports **prompts**, **shell commands**, and **rituals**. Natural language examples: `in 20 minutes`, `tomorrow at 7pm`, `every 30 minutes`, `weekdays at 8:30`, and `every monday at 6pm`. Five-field cron and aliases such as `@daily` are also accepted.

```sh
crontab -l
crontab add 'every day at 9am' 'echo daily-check'
```

Remove by schedule id with `crontab -r <id>`, or load a crontab file with `crontab <file>`. Prompts use Pandora/model chat. Commands and ritual schedules run independently of the chat loop, although individual ritual steps may still need a model. Command/ritual cron output goes to `/Pandora/Logs/cron.log`; failures notify the user. Inspect catch-up settings rather than assuming every missed occurrence will replay. Scheduling follows device time; verify timezone and clock.

## Heartbeat

Config's Heartbeat section periodically runs instructions from `/Pandora/HEARTBEAT.md` during active hours (default interval 30 minutes). Example:

```markdown
# Checks
- If /Inbox.md has more than five items, remind me to sort it.
- Otherwise reply HEARTBEAT_OK.
```

A file containing only headings, comments, blanks, or empty checkboxes skips the model call. `HEARTBEAT_OK` is treated as a quiet acknowledgment; other replies are retained in the Heartbeat chat and notified. Heartbeat can use a separate provider/model. It is a periodic agent check, not an exact-time alarm.

Sources: [flows.js](../app/modules/flows.js), [cron.js](../app/modules/cron.js), [heartbeat.js](../app/modules/heartbeat.js).
