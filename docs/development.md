# Development and architecture

**Jade Vault 2.9.0** · [Documentation index](README-docs.md)

## Requirements

- Node.js **20+** and npm (CI uses Node 22).
- Python **3.9+** (CI uses 3.12), plus `jade-discord/requirements.txt` for Discord bridge/tests. Python 3.13+ also needs the conditional `audioop-lts` requirement.
- Playwright Chromium and its OS dependencies for browser tests.
- JDK **17+** for native API tests and APK builds.
- Bash and standard Unix tools; use Linux or WSL for the most direct build path.

The app is a generated HTML application, not a conventional React/Vite frontend or hosted backend.

## Repository map

| Path | Role |
| --- | --- |
| `app/base/pi-netrunner-mobile.html` | Base UI, shell, and agent page |
| `app/build.py` | Ordered exact-match transformations that assemble Jade Vault |
| `app/modules/` | Feature source fragments inserted/replaced by the build |
| `app/modules/node_prelude.js` | Worker JavaScript compatibility/runtime layer |
| `app/tools/twbuild.mjs` | Tailwind compilation |
| `app/tools/build_index.py` | Android/static page with core dependencies inlined |
| `app/vendor/` | Embedded SQLite WebAssembly and TensorFlow.js assets |
| `scripts/build-web.sh` | Web build orchestration |
| `scripts/pack_xdc.py` | Mini-app packaging |
| `android/src/` | WebView activity, foreground service, inbound API server |
| `android/stubs/` | Compile-time Android API stubs; not packaged as Android OS implementation |
| `android/proj/` | APK resources and manifest template |
| `android/build-apk.sh` | Java/dex/APK assembly and signing |
| `apps/jade-link/` | Built-in mini app source |
| `jade-vector/` | Vector agent patch, Python bridge, installer, Docker |
| `jade-discord/` | discord.py bridge, Python requirements, installer, Docker, fake test server |
| `sqlite-wasm/` | SQLite build reference and C wrapper |
| `tests/` | Browser, SQLite, Python, and native Java coverage |
| `.github/workflows/` | CI, release asset building, bridge image publishing |
| `docs/index.html` | Checked-in static-hosted app page; not prose documentation |

### Feature map

- Notes: `vault_core.js`, `vault_ui.js`, `seed.js`, `img.js`, `attach.js`.
- Agent configuration: `providers.js`, `memory.js`, `steer.js`, `ctxguard.js`, `traj.js`.
- Execution: `bridge.js`, `node_prelude.js`, `python.js`, `sqlite_glue.js`, `sqlite_main.js`.
- Automation: `flows.js`, `cron.js`, `heartbeat.js`, `templates.js`.
- Connectivity: `mcp.js`, `net.js`, `api.js`, `vector.js`, `discord.js`, `xdc.js`, `xdcwake.js`.
- UI/settings/backup: `settings_tabs.js`, `replybar.js`, `extras.js`.

Inspect `app/build.py` to determine which fragment is actually inserted. `app/modules/main.js` contains a large parallel source snapshot; it is not a normal JavaScript module entry point imported by a bundler. Do not assume changing a similarly named function there changes generated output.

## Install and build

Run the following commands from the root of the Jade Vault 2.9.0 source directory:

```sh
npm install
npm run build
```

Use `npm install`; the repository does not include a root package lockfile. The build needs the project's declared dependencies; do not substitute arbitrary globally installed versions.

### Build pipeline

1. Package `apps/jade-link` as `dist/jade-link.xdc`.
2. `app/build.py` reads the base page, applies transformations/inserts feature fragments and embedded assets, and writes `dist/jade-vault.html`.
3. Compile Tailwind into `dist/tw.css`.
4. `app/tools/build_index.py` writes `android/proj/assets/index.html` with core rendering dependencies inlined.

The exact-match build deliberately fails with `MISSING`, `AMBIGUOUS`, or `RANGE MISSING` when assumptions drift. Fix the source/transformation pair rather than bypassing a failed assertion. Never edit generated HTML to implement a source feature.

## Run locally

```sh
python3 -m http.server 8000 --bind 0.0.0.0 --directory dist
```

Open `/jade-vault.html` on that server. There is no application backend to start for ordinary browser use. For the inlined page, serve `android/proj/assets` and open `/index.html`. Bind to loopback instead when you do not want LAN access; `0.0.0.0` is useful in containers/previews but exposes the server on available interfaces.

Provider/MCP CORS must permit the actual browser origin. A phone opening the page must use reachable service addresses, not the development computer's `localhost`. Stable ports/origins also preserve access to the same browser storage.

## Tests

Build first. For the full 2.9.0 suite, install Discord's Python requirements in a virtual environment **outside the repository**, so it cannot accidentally be committed. Keep the environment active while running the tests, which invoke `python3`:

```sh
python3 -m venv "$HOME/.jade-vault-test-venv"
. "$HOME/.jade-vault-test-venv/bin/activate"
python3 -m pip install -r jade-discord/requirements.txt
npx playwright install chromium
# On supported Linux hosts needing browser libraries:
# npx playwright install --with-deps chromium
npm run test:quick
npm test
```

Run selected suites without the npm wrapper:

```sh
node tests/run.mjs api_test api_java_test flows_test discord_test
```

The runner currently lists **28 suites**, executes them sequentially, and uses an eight-minute per-suite timeout. It requires the web HTML, inlined Android page, and Tailwind output. It recreates `tests/.work` for fixtures/artifacts. Do not run concurrent invocations against that same directory.

Coverage includes vault/browser and Android-page behavior, SQLite/glue/Python, MCP, heartbeat, providers/AICord, context/memory, API/native Java, flows/bridge/templates, replies, TensorFlow.js/GPU fallback, trajectories, webxdc/Jade Link, Vector, Discord, and moving day (Jade Vault → Pandora Dee migration and old-path aliases). The Discord suite uses the real discord.py library against a fake REST/Gateway service and a scripted model; it does not need a production bot token. Some integration tests use stand-ins rather than live external accounts. `JV_NODE_MODULES` supports a nonstandard dependency location in build/test tooling; normal development should not need it.

CI installs Discord Python requirements, compiles both bridges and their test helpers, checks both setup scripts' shell syntax, builds a debug APK, and separately builds the patched Vector agent via Docker. The Docker publishing workflow still targets Vector; Discord's Dockerfile/Compose deployment is built locally. The complete suite can take several minutes; inspect individual failures instead of assuming all external environments match CI.

## Change checklist

1. Identify source fragments and any build-time string replacements involved.
2. Add/update relevant tests for behavior and permission boundaries.
3. Run the build, selected suites, then broader tests as appropriate.
4. Verify browser and Android outputs when changing platform-sensitive code.
5. Update documentation and changelog for user-facing changes.
6. Keep secrets, runtime data, dependency folders, and generated build artifacts out of Git according to `.gitignore`.

For Android packaging see [APK build instructions](android-apk.md); for publishing see [deployment and releases](deployment-and-releases.md).
