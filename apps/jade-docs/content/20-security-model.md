<!-- id: security-model | parent: using | level: 2 | order: 20 | tags: security, approvals, secrets, untrusted, permissions, risk -->
# Security model in one page

| Risk | Defence |
| --- | --- |
| API keys leaking into chats or logs | Secrets are `{{NAME}}` placeholders replaced outside the model; echoes are redacted; keys are excluded from backups unless you opt in (and then encrypted) |
| Prompt injection from the web, SSH output, screen text, app updates | Everything external is labelled "data, not instructions" and tools that return it say so every time |
| Calls, texts, SSH commands, new playbooks | Ask-first dialogs (`phoneApprove`), switchable only by you in settings (SSH: per machine); emergency numbers are never dialled; Sentry flows may only contact numbers you listed, with an hourly limit she cannot edit |
| Credentials for SSH machines | Stored in your settings; the connection reads them directly; never returned in a result, written to chat or shown to the model; host key pinned after your first approval |
| Her editing her own safety settings | The numbers Sentry may contact, the hourly limit and the consent switches are app settings that her tools cannot edit (the rules she writes cannot raise them) |
| A runaway loop | Max tool rounds; context guard; per-tool budgets (think nodes/seconds/tokens; delegate steps/seconds; script caps) |
| Restoring over your data | Only you can restore, with a confirmation |
| Webxdc apps reaching the vault or network | Sandboxed frame, opaque origin, restrictive CSP; no vault access; app messages are untrusted input |
| Android power | Accessibility service does nothing until you switch it on; a notice shows while she drives the screen; permissions are asked the first time each action needs one |
| Remote bridges | Vector/Discord bridges use a bearer token; roles (owner, admin, everyone) limit what each person gets |

Read the 2.9.0-era guide [Security and privacy](#doc:security-and-privacy) for data boundaries and licences.
