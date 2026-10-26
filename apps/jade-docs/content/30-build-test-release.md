<!-- id: build-test-release | parent: architecture | level: 3 | order: 30 | tags: build, test, release, apk, ci, version -->
# Build, test and release

## Requirements

Node 20+, Python 3.9+, Playwright Chromium (for the browser tests), JDK 17+ for the APK and native tests. No Android SDK.

## Commands

```sh
npm install
npm run build                 # scripts/build-web.sh -> dist/jade-vault.html + the Android page
node tests/run.mjs            # all suites (about 10 minutes); or: node tests/run.mjs ctx_test traj_test
bash android/build-apk.sh     # dist/jade-vault-<version>.apk (debug key unless JADE_KEYSTORE is set)
python3 scripts/pack_xdc.py apps/jade-docs dist/jade-docs.xdc
```

The version comes from `VERSION` and `android/VERSION_CODE`; bump both (and `package.json`, `CHANGELOG.md`). An APK signed with a different key cannot update an installed one.

## Tests

`tests/run.mjs` copies `tw.css` into `tests/.work`, links fixtures, and runs each suite in a fresh headless Chromium via `tests/_harness.mjs`, which loads `dist/jade-vault.html`, fakes the network (Ollama, Ollaya, a data URL), and returns `{page, ctx, ok, log, fail, sh, api, write, read, model, ollaya, done, extraRoutes}`. `model.chatReply(msgs, userText)` scripts streaming chat, `model.answer` scripts one-shot answers, `extraRoutes.push(async route => true|false)` adds fake servers. Android tests simulate the native side: a second Playwright page stands in for the second WebView, `__brOut` is the bridge, `NetrunnerAndroid.*` is stubbed. Java logic is tested on a plain JVM (`android/test/run.sh`). Python bridges and the backup server have their own tests. See [Test suites](#doc:tests).

## Pitfalls we hit

- `ok()` output shows only failures, and a crash before `done()` hides FAIL lines.
- Page-global scoping: module `const`s are not on `window` unless exported with `Object.assign(window, …)`; `sessions` and `cur` are getter-only, mutate in place.
- Tool prose in `build.py` lives inside a single-quoted JS string: an unescaped apostrophe breaks the whole page at boot.
- Every tool description counts against a 16k context window; keep them short.
- Do not rebuild `dist` while a full test run is in progress.

## Releases

A GitHub release (tag `vX.Y.Z`) runs `.github/workflows/release.yml`: builds the web page, the signed APK (secrets `JADE_KEYSTORE_B64`, `JADE_KEYSTORE_PASSWORD`, `JADE_KEY_ALIAS`), Jade Link and the bridge kit. `docker.yml` publishes the bridge image. More: [Deployment and releases](#doc:deployment-and-releases).
