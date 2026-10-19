# Security

## Reporting

Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security tab), not in public issues.

## What to know before you deploy

**Your data stays on your device.** Notes, chats, memory, the trajectory log and app storage live in the
browser's IndexedDB / the Android WebView. Nothing is uploaded except what you send to the model
provider you choose (Ollama, Ollama Cloud, Groq, llama.cpp, OpenAI-compatible) and the services Jade
calls with her tools.

**Keys.** Provider keys, secrets (`{{NAME}}` values for `http_request`) and the Vector bridge token are
kept in app storage. Backups leave them out unless you tick "include keys". Secrets are never shown to
the model and are blanked if a response echoes them.

**The Jade Vector bridge** holds the bot's Vector private key (`~/.jade-vector/nsec`, mode 600) and
exposes the account to anyone with the bridge token.
- The token is 192 random bits and compared in constant time; wrong guesses are slowed down.
- It speaks plain HTTP unless you pass `--tls-cert/--tls-key`. Keep it on a network you trust (home
  Wi-Fi, Tailscale or WireGuard). Do not port-forward it to the internet.
- Give Jade her own Vector account. Never use your personal nsec.

**Jade on Vector talks to strangers.** Messages from anyone but the owner run with a reduced tool set:
- *Public* (anyone): chat in that conversation, react, play its Mini Apps, `notify_owner`, web search. No
  notes, memory, files, shell, code, HTTP or MCP tools, and no messaging other people. Their system
  prompt has no memory or vault contents.
- *Admin* (whitelist): Vector actions (message people, join/leave, invite, moderate), still no vault.
- *Owner*: everything.

Tools are filtered before the model sees them and checked again before they run, so a model talked
into calling a hidden tool gets an error. Prompt injection can still make Jade *say* odd things in a
public chat; it cannot reach your data through tools.

**Webxdc apps** run in a sandboxed frame with no network (CSP `connect-src data: blob:`), no access to
the vault, and an opaque origin.

**Code execution.** `node`, `python`, `sqlite3` and the shell run in Web Workers / WebAssembly inside
the page, on the in-browser filesystem. Scripts can make network requests with `fetch` (subject to the
browser's rules); secrets are available to them as `process.env`.
