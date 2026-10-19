# Build the Android APK

**Jade Vault 2.9.0** · [Documentation index](README-docs.md) · [Development guide](development.md)

These instructions create Jade Vault's Android app from this repository. The current build does **not** use Gradle or require the Android SDK/Android Studio: it compiles Java against repository stubs, converts classes to dex, assembles with apktool, and signs the result.

## 1. Prepare the build environment

Use Linux or WSL for the closest match to CI. macOS may need GNU-compatible utilities or a Linux environment because the script uses tools such as `sha256sum` and GNU-style `sed`. Use the Jade Vault **2.9.0 source**, with `VERSION` set to `2.9.0` and `android/VERSION_CODE` set to `23`. Run all following commands from that repository root unless stated otherwise.

Required:

- Node.js **20+** and npm (CI uses Node 22).
- Python **3.9+**.
- JDK **17+**, including `java`, `javac`, and `keytool` (a JRE alone is insufficient).
- Bash, `curl`, `unzip`, `sha256sum`, `sed`, `find`, `grep`, and standard Unix file utilities.
- Internet access to npm and GitHub release assets on the first build.

Check tools:

```sh
node --version
npm --version
python3 --version
java -version
javac -version
command -v keytool curl unzip sha256sum sed
```

If multiple JDKs are installed, ensure `java` and `javac` on PATH refer to the intended JDK. On Debian/Ubuntu, a typical system prerequisite installation is:

```sh
sudo apt-get update
sudo apt-get install -y openjdk-17-jdk python3 python3-venv curl unzip coreutils
```

Install Node 20+ separately using your preferred maintained distribution if your OS package is older. Git is needed to clone the project but is not an APK assembly dependency.

## 2. Install dependencies and build a debug APK

```sh
npm install
npm run build:apk
```

`build:apk` is defined as:

```sh
bash scripts/build-web.sh && bash android/build-apk.sh
```

Or run the stages explicitly:

```sh
npm run build
bash android/build-apk.sh
```

**Always rebuild the web assets after changing app source.** Running only the APK script packages whatever `android/proj/assets/index.html` already contains; it does not regenerate that page.

### Output and intermediate files

| Path | Purpose |
| --- | --- |
| `dist/jade-vault.html` | Generated browser app |
| `dist/tw.css` | Compiled Tailwind CSS |
| `dist/jade-link.xdc` | Built-in mini-app package |
| `android/proj/assets/index.html` | Generated inlined page loaded by the Android WebView |
| `android/.tools/` | Downloaded packaging tools and local debug keystore |
| `android/build/` | Temporary classes, dex, APK assembly/signing output |
| `dist/jade-vault-<version>.apk` | Final signed APK |

The APK filename/version comes from `VERSION` (**2.9.0**). The Android version code comes from `android/VERSION_CODE` (**23**). The expected final artifact is `dist/jade-vault-2.9.0.apk`. The script patches the copied manifest/apktool metadata during assembly; it does not require manually patching those templates for each local build.

Without release-signing variables, the script creates/reuses `android/.tools/debug.jks` and signs with a local **debug key**. That file's continued existence matters: a new debug key cannot update an app installed with an older one. Debug APKs are for development, not production distribution.

### What the APK script does

1. Download/cache apktool 2.10.0, uber-apk-signer 1.3.0, and dex-tools 2.4; verify pinned SHA-256 hashes.
2. Extract `dx.jar` from dex-tools.
3. Check that the generated Android page exists.
4. Recreate `android/build`, copy resources, and set version metadata.
5. Compile Android stubs and app Java with `javac --release 8`.
6. Produce dex targeting minimum API 24 (Android 7).
7. Assemble an unsigned APK with apktool.
8. Sign/align it and copy the signed APK into `dist`.

Do not remove checksum verification to work around a download failure. Confirm network access/tool versions and investigate mismatches.

## 3. Test before distribution

The build does not automatically run tests. Discord Python dependencies are needed for the full 2.9.0 suite and the separately hosted bridge, **not** for compiling the APK UI itself. Rebuilding from 2.9.0 includes the Discord connector; it does not bundle or start the Python bridge on the phone. From the repository root:

```sh
python3 -m venv "$HOME/.jade-vault-test-venv"
. "$HOME/.jade-vault-test-venv/bin/activate"
python3 -m pip install -r jade-discord/requirements.txt
npx playwright install chromium
npm test
```

For a focused first check:

```sh
node tests/run.mjs vault_apk_test api_test api_java_test discord_test
```

Browser/native API tests do not replace device testing. Install the APK on a test device and exercise notes, chat, file export, notifications, TTS, background behavior, and API settings relevant to your release.

## 4. Create a release signing key

Skip this step if you already have the key used for published Jade Vault APKs. **An existing installation can only be updated by a compatible signing identity.** Creating a new key is not a way to update an official release you cannot sign.

Create a private directory outside the checkout and a keystore (example path/alias):

```sh
mkdir -p "$HOME/.jade-signing"
chmod 700 "$HOME/.jade-signing"
keytool -genkeypair \
  -keystore "$HOME/.jade-signing/jade-release.jks" \
  -alias netrunner \
  -keyalg RSA -keysize 2048 -validity 10000
chmod 600 "$HOME/.jade-signing/jade-release.jks"
```

`keytool` prompts for passwords and identity details. Use a strong password and securely back up both keystore and recovery information. For this project's signer invocation, use the **same password for the keystore and private key**, since the script supplies one password to both options.

Never commit the keystore, password, or a base64 copy. Losing the signing key can prevent compatible future updates.

## 5. Build with the release key

In Bash, read the password without placing it in shell history:

```sh
npm run build
export JADE_KEYSTORE="$HOME/.jade-signing/jade-release.jks"
export JADE_KEY_ALIAS=netrunner
read -r -s -p 'Keystore password: ' JADE_KEYSTORE_PASSWORD
printf '\n'
export JADE_KEYSTORE_PASSWORD
bash android/build-apk.sh
unset JADE_KEYSTORE_PASSWORD JADE_KEYSTORE JADE_KEY_ALIAS
```

Use an absolute keystore path: the script changes into `android/` before invoking signing tools. `JADE_KEY_ALIAS` defaults to `netrunner`, but explicitly matching the real alias avoids confusion. Environment variables are sensitive during the build; run only on a trusted machine and avoid logging them. If the build fails, still unset the password afterwards.

Inspect signer output for verification and confirm the final APK exists:

```sh
ls -lh "dist/jade-vault-$(cat VERSION).apk"
sha256sum "dist/jade-vault-$(cat VERSION).apk"
```

A checksum identifies the file; it does not independently prove publisher identity. The script's signing-output filter is not a substitute for verifying the final package with trusted tooling. If Android SDK Build Tools happen to be installed, `apksigner verify --verbose --print-certs <apk>` is an optional additional check, not a repository build prerequisite.

## 6. Install on Android

The app supports Android **7+**. Transfer the APK to the device and open it. Android may ask you to allow “Install unknown apps” for the transfer/browser/file-manager app; grant only as needed and revoke afterwards if appropriate.

Optional development installation with Android Platform Tools (not required to build):

```sh
adb install -r "dist/jade-vault-$(cat VERSION).apk"
```

`-r` requests an update/reinstall while retaining data where Android allows it. A signing mismatch or disallowed version downgrade still fails. Export a backup before replacing installations; **do not uninstall merely to bypass an update error without preserving data**.

After installation, verify the selected model is reachable from the phone. `localhost` is the phone; use the model host's LAN/private-VPN address for another computer. Enable notification/background options only as required. Battery optimizations may still interrupt unattended work.

## 7. Versioning and updates

For a distributable new version:

1. Update `VERSION` and increment `android/VERSION_CODE`.
2. Keep related package/changelog metadata consistent as part of your release process.
3. Rebuild web assets, test, and sign with the **same release key** as the previous APK.
4. Test updating an existing installation before publishing.

The app id is `app.netrunner.vault`. A debug-signed custom build generally cannot update an official release-signed installation. Side-by-side variants would require intentional application-id/build changes; this script does not create them automatically.

## Common failures

| Symptom | Check |
| --- | --- |
| `Build the web app first` | Run `npm install` and `npm run build` before the APK script |
| `java`, `javac`, or `keytool` missing | Install a full JDK 17+ and correct PATH |
| `sha256sum`/`sed` failure | Use Linux/WSL or install compatible GNU tools |
| GitHub download/checksum failure | Check connectivity, proxy/truncation, pinned versions; do not disable checks |
| Keystore not found | Use an absolute `JADE_KEYSTORE` path |
| Alias/password rejected | Inspect the keystore with `keytool -list -keystore /absolute/path`; match alias and key/store passwords |
| No signed APK copied | Inspect full apktool/signer output and `android/build/out/`; do not distribute `unsigned.apk` |
| Android update incompatible | Match the signing key/app id and use a valid higher version code |
| Old UI after rebuilding | Re-run `npm run build`, then rebuild the APK and install that exact artifact |

For automated signed release assets and GitHub secret names, see [deployment and releases](deployment-and-releases.md). Source of truth: [android/build-apk.sh](../android/build-apk.sh), [package.json](../package.json), and [AndroidManifest.xml](../android/proj/AndroidManifest.xml).
