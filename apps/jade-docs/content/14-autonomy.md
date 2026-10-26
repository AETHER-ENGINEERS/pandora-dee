<!-- id: autonomy | parent: using | level: 2 | order: 14 | tags: heartbeat, schedules, flows, cron, sentry, curiosity, autonomous -->
# Running on her own

Everything here is **off until you switch it on**, runs only while the app is alive (on Android, enable Background; the HTTP API and Sentry also keep it running), and is logged.

## Heartbeat

Every N minutes (default 30) inside active hours, Jade reads `/Jade/HEARTBEAT.md` and follows it. If nothing needs attention she answers `HEARTBEAT_OK`: the run is silent and pruned. Otherwise the details land in the "♥ Heartbeat" chat and you get a notification. An empty file (only comments, headings, empty checkboxes) skips the run without calling the model. It can use its own provider and model.

## Schedules and cron

The `schedule` tool, the Schedule tab and `crontab` create schedules in plain English (`every weekday at 9am`), cron or `@daily`. A schedule runs a **prompt** (Jade, in a chat), a **shell command** or a **flow**. Command and flow schedules run on their own, without the model; output goes to `/Jade/Logs/cron.log` and a failure sends a notification.

## Flows

n8n-style automations kept as `/Jade/Flows/<name>.flow.json`: steps run in order, each output is `$json` for the next. Step types: Tool, JavaScript, Shell, Decide (Ollaya), Ask AI, Jade agent, Note, Set fields, If, Switch, For each, Wait, Notify, Run flow, Stop. Text fields may hold `{{ JavaScript }}` with `$json`, `$input`, `$node["Step"]`, `$vars`, `$item`, `$index`, `$now`, `$today`, `$date()`. Triggers: by hand, schedule, or a note/folder change; also from the shell (`flow run`), scripts (`jade.flow`), the API (`/v1/flow`) and Jade's `flow` tool. Every run is logged step by step. Full reference: [Flows and scheduling](#doc:automation).

## Sentry (2.16)

Phone events run flows: 15 systems (battery, network, screen, headset, bluetooth, volume keys, light, motion, location/geofences, calls, texts, notifications, foreground app, loudness, wake phrase…) added one by one. Rules in `/Jade/Config/Sentry.json` (hot-reloaded): state rules (`when`, `for_s`, `clear`) and event rules (`on`, `where`), each with cooldown, hourly cap and active hours. Location, calls, texts, notifications, microphone and camera need consent plus the Android permission. A Sentry-run flow may text or call only numbers you listed, up to a limit you set, which she cannot edit.

## Curiosity wake-ups (2.17)

At random times inside a window you choose, Jade wakes in her own chat "✦ Curiosity" and picks one of: **explore**, **reflect**, **connect** notes, **practice** a skill, **anticipate** (prepare something for you), **ask** you one question, or **rest**. Steer it with `/Jade/CURIOSITY.md`. Details: [Curiosity engine](#doc:curiosity).

## Playbooks

Deterministic automation that runs without the model, in the shape of Ansible: [Playbooks](#doc:playbooks) (any tool, the browser, variables, when/loop/rescue), edited in the Playbooks tab.

## Scheduled backup

Upload the vault to your own server on a schedule: [Backup system](#doc:backup-system).
