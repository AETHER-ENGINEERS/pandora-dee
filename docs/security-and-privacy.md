# Security, privacy, and licensing

**Jade Vault 2.9.0** · [Documentation index](README-docs.md)

Read the project's [security policy](../SECURITY.md) for vulnerability reporting. Report security issues privately through GitHub's Security → Report a vulnerability rather than a public issue.

## Data boundaries

Jade Vault stores its main data locally, but “local-first” does not mean “nothing can leave the device.”

| Feature | What can leave the device |
| --- | --- |
| Model chat, compaction, journal, AI flow steps | Prompt context, relevant notes/memory/history, tool results, supported images |
| Fallback providers | Context sent to another configured provider after failover |
| Web search/fetch and remote images | Queries/URLs, connection metadata, requested content |
| HTTP/MCP tools and scripts | Whatever the configured request/tool/code transmits |
| Vector and Discord | Messages/files and bot activity through their separate bridges/networks |
| UI/runtime asset loading | Requests to external asset/CDN hosts where still used |
| Exports | Plaintext data written wherever you save/share it |

A local Ollama server can reduce cloud model exposure, but network tools and optional assets can still contact external services. Restrict tool settings and provider fallbacks to match your requirements.

## Credentials

Provider keys and integration tokens are kept in app storage. Do not place secrets in ordinary notes, steering files, screenshots, or chat. Use designated secret fields and supported placeholders. HTTP substitution/redaction is a convenience, not universal data-loss prevention; short, encoded, or script-exposed values may not be covered.

**Backups need inspection even with Include keys off.** Current exclusions do not cover every possible credential location, including the Android inbound API token. See [backup coverage](backup-and-storage.md).

## Code and prompt injection

- Shell/JavaScript/Python/SQLite execute in browser workers/WebAssembly on virtual files, not host processes.
- A worker can still alter vault data, call permitted tools, make network requests, and access configured secrets in supported script environments.
- Note scripts are read-only/no-network by default. Enabling tool calls from note scripts makes imported executable notes more powerful.
- Web pages, messages, attachments, app updates, and external tool results can contain malicious instructions. Ask Jade to treat them as data; do not rely on prompting alone as an access-control boundary.
- Review destructive tools and external side effects. Back up before bulk changes and test on noncritical data.

## Exposed services

The Android API, Vector bridge, and Discord bridge are distinct bearer-token services. Each has its own URL/token; never substitute a Discord bot token for a bridge bearer token. Plain HTTP does not encrypt the token or payload. Keep them on trusted networks/private VPNs; do not port-forward to the internet. Use the bridge's TLS support where appropriate and restrict CORS origins/network reachability. CORS is not authentication or encryption.

Vector's bridge holds a bot private key; Discord's bridge holds a Discord bot token. Bridge bearer-token compromise can allow bot actions, while compromise of the underlying bot key/token grants bot identity. Use dedicated bot accounts and secure each state directory/volume. Discord outbound allowed mentions are disabled and bot-authored incoming messages are ignored, but these safeguards do not guarantee harmless generated speech.

Vector and Discord callers have owner/admin/public tool restrictions checked at prompt construction and tool execution. Verify owner/admin npubs for Vector and numeric user IDs for Discord before enabling unattended operation. In 2.9.0, both messenger non-owner tool allowlists include `web_search`; other actions vary by connector/role. SOUL persona text can be included in non-owner prompts even though ordinary private vault/memory context is omitted, so keep private facts out of persona text. These restrictions do not prevent every inappropriate generated reply.

## Webxdc isolation

Mini apps run in sandboxed frames with an opaque origin and restricted network CSP. They do not directly access the vault. Their updates can still cause separately authorized Jade actions; inspect protocols/code and treat payloads as untrusted content.

## Android considerations

Keep Android and its WebView updated. Grant notification/background/battery permissions only as needed. The app uses a foreground service for background work; device battery policies can still stop it. Device compromise or unrestricted physical access can expose local data; local storage is not application-level end-to-end encryption.

## Licenses

The Jade Vault project code is [MIT](../LICENSE), but bundled components have separate terms. BusyBox is GPL-2.0, Live2D Cubism Core uses a proprietary license, and the Jade avatar model is not covered by the project's MIT license. Review [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and component licenses before redistribution or commercial packaging.
