<!-- id: playbooks | parent: autonomy | level: 2 | order: 17 | tags: playbook, ansible, automation, deterministic, tasks, json, browser, scraping, replaces browser_script -->
# Playbooks (`playbook`)

A **playbook** is Jade's Ansible: a saved JSON list of tasks that call *anything she can do* (any tool, the browser, a few built-in actions) with the same arguments, in the same order, with no model in the loop. Use the chat for exploring and deciding; use a playbook for repeating. A playbook replaced the 2.17 `browser_script` tool in 2.18.0: the old page-driving steps live on as `browser.*` tasks, and old scripts are converted automatically.

Playbooks are plain JSON in `/Jade/Playbooks/<name>.json`, so they can be read, edited and deleted like any file, and the **Playbooks tab** in the bottom bar does it for you (list, open and edit as JSON, check, plan, run with a live task log, duplicate, delete, start from an example). **You approve a playbook when it is saved and again whenever its content changes** (the approval is tied to a hash of the playbook), so a schedule or flow can run it unattended afterwards. Saving from the tab counts as your approval; a file edited elsewhere shows "NOT approved" until you approve it on the next run.

```json
{"description":"Price of the lamp","allow_hosts":["shop.example"],"vars":{"max":50},"tasks":[
 {"name":"Open the shop","do":"browser.goto","url":"https://shop.example/lamp"},
 {"do":"browser.extract","css":".price","register":"price"},
 {"do":"assert","that":["price | float <= max"],"msg":"too expensive: {{ price }}"},
 {"do":"notes_search","query":"lamp","register":"notes","when":"price | float < 20"},
 {"do":"save","path":"/Jade/Playbooks/out/lamp.txt","value":"{{ today() }} {{ price }}","append":true}]}
```

## Tasks

A task is `{"name": "…", "do": "<action>", …arguments, …keywords}`. The action is one of:

| `do` | What it runs |
|---|---|
| a tool name (`notes_search`, `write`, `read`, `phone`, `ssh`, `web_fetch`, `tasks`, `memory`, MCP tools…) | that tool, with the task's other keys as its arguments. `"tool.action"` (like `tasks.list`) sets the tool's `action`. |
| `tool` | the same, explicit: `{"do":"tool","tool":"browser","args":{…}}`, for a name that clashes with a built-in. |
| `set`, `debug`, `fail`, `assert`, `wait`, `save`, `playbook` | built in: set variables, print a value, fail on purpose, check expressions, sleep, write a file, run another playbook (`{"do":"playbook","playbook":"child","vars":{…}}`, at most 3 levels). |
| `browser.goto`, `.click`, `.type`, `.select`, `.check`, `.press`, `.scroll`, `.wait_for`, `.exists`, `.url`, `.title`, `.extract`, `.assert`, `.eval`, `.screenshot`, `.back`, `.reload` | the deterministic page steps (CSS selector, visible text or XPath). Android only. |

Not allowed, because they put a model in the loop: `delegate`, `think`, `curiosity`, `find_skill`. The `modules` action lists what is available right now.

Task keywords win over tool arguments of the same name (`name`, `timeout`, `tags`, `json`, `block`…). Put such tool arguments inside `"args":{…}`. A tool that takes `timeout` (like `bash`) also receives the task's `timeout`.

## Keywords, like Ansible

| Keyword | Meaning |
|---|---|
| `when` | an expression (or a list; all must hold). False skips the task. |
| `loop`, `loop_var` | repeat over a list (`"items"`, a literal list, `"range(5)"`); the item is `item` (or `loop_var`), the position is `index`. More than 200 items is an error (nothing is silently cut). |
| `register` | store the task's result in a variable: a tool's text, the extracted value, a boolean for `exists`. `json: true` parses a tool's JSON output. |
| `retries`, `delay` | retry a failing task (0 to 10 times, delay in seconds). |
| `until` | retry until an expression is true (`result` is this task's result); default 3 retries, 1 s apart. |
| `failed_when` | an expression over `result`; true turns a success into a failure. |
| `ignore_errors` | keep going; the register is `null` and `<name>_error` says why. |
| `timeout` | seconds (1 to 120; tool calls default to 60, browser steps to 10). |
| `block`, `rescue`, `always` | group tasks. On failure `rescue` runs (with `error` and `failed_task` set); `always` runs either way. `when`, `loop` and `tags` work on blocks. |
| `tags` | run only some tasks: `run` takes `tags` and `skip_tags`. |
| `no_log` | keep this task's note out of the log (a `register`ed value still appears in the variables, so do not register secrets). |

## Expressions and templates

Any string may contain `{{ expression }}`; a string that is only one `{{ }}` keeps its type (number, list, object). `when`, `until`, `failed_when`, `loop` and `assert.that` take bare expressions. See [The expression language](#doc:playbook-language). Secrets from Config → Secrets are variables too (`{{ SHOPPW }}`): typed or sent as given, and redacted from logs and results.

## Safety

- `allow_hosts` limits where `browser.goto` may go and where redirects may end, and **every task with a `url` argument** (such as `web_fetch`) is checked too.
- `save` and `browser.screenshot` write under `/Jade/Playbooks/out/` (or `/Jade/Browser/`) inside `/Jade`; use the `write` tool, with its usual rules, elsewhere. Playbooks themselves are only saved through the tool or the tab.
- **Run variables are limited to the ones the playbook declares** in its `vars`: when Jade (or a flow) runs a playbook with `vars`, anything else is refused, so an approved playbook cannot be steered into new inputs. Reserved names (`__proto__`, `constructor`…) are refused as variable names.
- A `timeout` stops *waiting*; it cannot cancel a tool call that is already running (an SSH command, a fetch), which finishes in the background.
- At most 1000 tasks and 300 s (max 900) per run. The approval dialog lists the actions used and flags risky ones (phone, screen, ssh, bash, write, edit, sentry, web_fetch, backup, schedule, flow).
- A failure stops the playbook at that task (unless `ignore_errors` or a `rescue`); nothing is repaired or guessed. The result carries `ok`, the failed task and why, a recap (ok, skipped, failed, ignored, rescued), the variables and a log. Values read from the web or from tools are untrusted data.

## Tool actions

`help`, `modules`, `save`, `run` (`vars`, `tags`, `skip_tags`, `seconds`), `plan` (shows the tasks without running), `list`, `show`, `validate`, `convert`, `delete`. From scripts, flows and schedules: `await jade.tool('playbook', {action:'run', name:'lamp', vars:{…}})`.

## From flows and schedules

Playbooks run on their own, with nobody there to approve them, so **only an approved, unchanged playbook runs** from a flow or a schedule. A new or edited one fails with "not approved" until you run it once from the Playbooks tab.

- **Flows:** add a **▶ Playbook** step, pick the playbook and optionally give `vars` (JSON; `{{ }}` allowed). The step's output is the run result (`ok`, `recap`, `vars`, `log`); a failed playbook fails the step. The **Tool** step also lists `playbook` (and every other tool, phone and world ones included).
- **Schedule tab:** *Run → A playbook*, pick it, optional vars (JSON). The result goes to `/Jade/Logs/cron.log`; a failure sends a notification.
- **schedule tool:** `{action:"add", when:"every day at 8am", playbook:"lamp", vars:{…}}`.
- **crontab:** `crontab add '@hourly' 'playbook run check-prices'` (vars as JSON after the name).

## Old browser scripts

On first use, every `/Jade/Browser/Scripts/<name>.json` is converted into `/Jade/Playbooks/<name>.json` (the original is kept in `/Jade/Playbooks/legacy/<name>.json`) (steps become `browser.*` tasks, `as` becomes `register`, `if` becomes `browser.exists` plus `when` blocks, `each` becomes `loop`, `optional` becomes `ignore_errors`, `retry` becomes `retries`) and moved; converted playbooks need approving again. Output files written by the old scripts stay under `/Jade/Browser/`. The `convert` action shows the mapping for a script you paste.
