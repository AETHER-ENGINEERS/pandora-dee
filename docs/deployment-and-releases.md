# Deployment and releases

**Jade Vault 2.9.0** · [Documentation index](README-docs.md)

## Browser deployment

From the root of the Jade Vault 2.9.0 source directory, build with `npm install` followed by `npm run build`. There are two relevant generated pages:

- `dist/jade-vault.html`: browser/release page; some dependencies are externally loaded.
- `android/proj/assets/index.html`: core rendering dependencies inlined, also suitable as a static-hosted page.

Serve the chosen page from a static host. No Jade application backend is required; model servers, MCP services, and the Vector/Discord bridges are separate systems. HTTPS is recommended, but HTTPS pages cannot generally call plain HTTP model/bridge endpoints because of mixed-content rules. Plan compatible URLs/TLS/CORS instead of weakening browser security.

### GitHub Pages document root

The checked-in `docs/index.html` is the browser app; `docs/.nojekyll` is already present. The prose documentation index is [README-docs.md](README-docs.md), intentionally separate from the hosted app and the existing short README.

To update the hosted browser app:

```sh
npm run build
cp android/proj/assets/index.html docs/index.html
```

The copy command **replaces the hosted app**. Run it when deploying a new app build, not when updating Markdown documentation. GitHub Pages repository settings must point at the intended source; no dedicated Pages workflow is defined here. Plain Markdown files are primarily browsable through the repository unless your host adds Markdown rendering.

Keep the hosted origin stable to preserve users' browser storage access. Changing the host/path deployment does not migrate data between origins; provide backup/export instructions before a move.

## Versions and artifacts

`VERSION` drives the generated app/release version and APK filename. `android/VERSION_CODE` must increase for Android upgrades. Keep package metadata/changelog aligned when preparing a release. Use the same signing identity for compatible APK updates.

Typical release artifacts:

| Artifact | Contents |
| --- | --- |
| `pandora-dee-<version>.html` | Browser app |
| `pandora-dee-<version>.apk` | Signed Android application, if signing secrets are configured |
| `jade-link-<version>.xdc` | Built-in mini-app package |
| `pandora-vector-<version>.tar.gz` | Vector bridge setup/source kit |
| `pandora-discord-<version>.tar.gz` | Discord bridge setup/source kit, including Python requirements |
| `SHA256SUMS` | Checksums of attached build artifacts |

## GitHub release workflow

[release.yml](../.github/workflows/release.yml) runs when a release is **published**, or by workflow dispatch against an existing release tag. The expected tag convention is `vX.Y.Z`. Ensure the tag's source metadata matches that version; the workflow does not replace version discipline with automatic bumps.

For APK signing, repository Actions secrets are:

| Secret | Purpose |
| --- | --- |
| `JADE_KEYSTORE_B64` | Base64-encoded release keystore |
| `JADE_KEYSTORE_PASSWORD` | Store/private-key password used by this build |
| `JADE_KEY_ALIAS` | Alias, conventionally `netrunner` |

Configure secrets through GitHub's secure settings; never add them to source. Base64 is transport encoding, **not encryption**. The workflow decodes the keystore to a temporary runner path, signs, removes the temporary file, creates both bridge kits/checksums, and uploads release assets. Re-running uploads with clobber, so it can replace assets on that release.

If no signing keystore secret is configured, the workflow warns and **skips the APK**, rather than shipping a debug APK as a release. Add signing secrets and rerun, or attach a correctly release-signed APK through the maintainer process.

The release workflow builds artifacts but does not run `npm test`; ensure CI/tests passed for the exact source being released.

## Other workflows

- [ci.yml](../.github/workflows/ci.yml): builds the app, runs tests, creates a debug APK, installs Discord Python requirements, checks both bridge sources/setup scripts, and separately builds the patched Vector agent image.
- [docker.yml](../.github/workflows/docker.yml): publishes the Vector bridge image to GHCR under its configured triggers/permissions.

The existing GHCR workflow still publishes **Vector**, not Discord. Discord has a local Dockerfile/Compose deployment; see [Discord setup](discord.md#docker-compose). Do not assume this workflow publishes a Discord image, and do not confuse either bridge container with an Android app distribution.

## Release checklist

1. Verify version files, changelog, source tests, and dependency/license notices.
2. Build web and APK artifacts; test both clean installation and compatible upgrade.
3. Verify signing identity and keep a secure keystore backup.
4. Publish the correctly versioned tag/release and inspect workflow results.
5. Confirm expected assets are present; APK may be skipped without secrets.
6. Verify checksums and smoke-test downloaded artifacts.
7. If updating static hosting, deploy the intended generated page separately.
8. Remind users to export data before migration or uninstalling.

For local signing commands, see [Build the Android APK](android-apk.md).
