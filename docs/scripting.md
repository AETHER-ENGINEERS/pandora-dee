# Shell and scripting

**Jade Vault 2.9.0** · [Documentation index](README-docs.md)

All examples on this page run **inside Jade Vault**, not in a host terminal. The app exposes a virtual filesystem backed by device storage. It does not provide unrestricted host OS access.

## BusyBox shell

```sh
ls -la
cat /Inbox.md
search project
tags
links Welcome
backlinks Welcome
node /scripts/vault-stats.js
```

The shell supports commands, pipes, redirection, `&&`, `||`, variable substitution, and globs. It is not a full desktop shell environment: shell loops/if blocks and package managers are not supported as ordinary host facilities. Write a JavaScript or Python file for more complex logic. Browser networking is available through supported script APIs and tools, not an assumption that every BusyBox networking command works.

## JavaScript runtime

The shell's `node` is a Web Worker sandbox with a compatibility layer, **not a complete Node.js installation**. Supported facilities include virtual `fs`, `path`, `fetch`, an `https` compatibility surface, SQLite modules, and `jade.*`. Arbitrary npm/native packages, child processes, and host filesystem access should not be assumed available. Some import syntax is rewritten for the built-in loader.

Create `/scripts/inbox-count.js`:

```js
const fs = require('fs');
const text = fs.readFileSync('/Inbox.md', 'utf8');
console.log(text.split('\n').filter(line => line.startsWith('- ')).length);
```

Run `node /scripts/inbox-count.js` in Shell. Use explicit vault paths. Script writes and Jade tool calls are synchronized across the bridge, but this is not a general transactional filesystem.

## Jade JavaScript bridge

Top-level `await` is supported in the script sandbox. Availability still depends on settings and invocation context.

| Call | Purpose |
| --- | --- |
| `await jade.list()` | List exposed tools |
| `await jade.tool(name, args)` | Invoke a tool |
| `await jade.tools.read({path: '/Inbox.md'})` | Named tool shorthand |
| `await jade.search(query, limit)` | Vault search |
| `await jade.decide({state, question, type, options})` | Ollaya decision |
| `await jade.ask(prompt, {json, system})` | One model answer without a full tool-using chat |
| `await jade.agent(message)` | Full agent turn; subject to busy/reentrancy checks |
| `await jade.flow(name, input)` | Run a flow |
| `await jade.flows()` | List flows |
| `await jade.shell(command)` | Execute a vault shell command |
| `await jade.notify(title, body)` | Notify the user |
| `await jade.kv.get(key)` / `set(key, value)` / `all()` | Persistent JSON-like script state |

Example:

```js
const inbox = await jade.tools.read({path: '/Inbox.md'});
const summary = await jade.ask('Summarize this inbox in three bullets:\n' + inbox);
console.log(summary);
```

This example sends the inbox content to the selected provider. Use deterministic code instead if no model request is needed.

In 2.9.0, the enabled Discord connector also exposes the `discord` tool to scripts and to a flow's Tool step. Script tool calls are checked against both Vector and Discord role guards; `jade.tool()` is not a way to bypass a messenger caller's permissions. See [Discord](discord.md) for allowed actions and target rules.

Shell equivalents include (the named `Daily digest` flow must already exist):

```sh
jade tool notes_search '{"query":"#project"}'
flow list
flow run 'Daily digest' '{"source":"shell"}'
flow show 'Daily digest'
flow runs 'Daily digest'
```

`jade` also offers decide, ask, agent, notify, and kv subcommands. `flow` also supports enable, disable, import, and export. See the commands' help/output for current argument details.

## MicroPython

`python` runs MicroPython in WebAssembly, not desktop CPython. Use supported standard-library functionality; CPython binary wheels and ordinary pip environments are not available. Runtime assets may require network access when first loaded.

```python
with open('/Inbox.md') as f:
    text = f.read()
print(len(text.splitlines()))
```

Save as `/scripts/count.py`, then run `python /scripts/count.py`.

## SQLite

SQLite is embedded WebAssembly. Database files are real SQLite files in the vault.

```sh
sqlite3 /tasks.db "CREATE TABLE IF NOT EXISTS tasks(title TEXT);"
sqlite3 /tasks.db "INSERT INTO tasks VALUES ('Review inbox');"
sqlite3 /tasks.db "SELECT * FROM tasks;"
```

JavaScript:

```js
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/tasks.db');
console.log(db.prepare('SELECT title FROM tasks').all());
db.close();
```

`better-sqlite3` compatibility and Python `sqlite3` are also provided. Compatibility layers are subsets, not guarantees that every desktop binding API works. See [SQLite build reference](../sqlite-wasm/README.md).

## TensorFlow.js

TensorFlow.js 4.22 is embedded and loaded on demand for scripts using `tf` or `@tensorflow/tfjs`, including flow JavaScript steps. WebGL is used where available in the worker; otherwise CPU is used. It is not loaded into read-only note scripts.

```js
const x = tf.tensor1d([1, 2, 3]);
const y = x.square();
console.log(await y.array());
x.dispose();
y.dispose();
```

Persist supported models with `await model.save('indexeddb://name')` and reload using `tf.loadLayersModel('indexeddb://name')`. That storage is separate from ordinary vault files and must be considered separately when migrating.

## Safety and limitations

Scripts can alter vault files, call tools, and make network requests. Configured secrets can be exposed to scripts via `process.env`. Do not run untrusted scripts. Time limits, worker isolation, and API compatibility do not turn arbitrary code into harmless content. Note scripts have stricter defaults; see [their guide](note-scripts-and-templates.md).

Sources: [node_prelude.js](../app/modules/node_prelude.js), [bridge.js](../app/modules/bridge.js), [python.js](../app/modules/python.js), [sqlite_main.js](../app/modules/sqlite_main.js).
