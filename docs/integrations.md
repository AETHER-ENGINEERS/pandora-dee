# MCP and HTTP integrations

**Jade Vault 2.9.0** · [Documentation index](README-docs.md)

External integrations can transmit notes, prompts, and credentials to another service. Configure only trusted endpoints and review what tools do before exposing them to Jade.

## MCP servers

Jade uses **streamable HTTP** MCP. A browser cannot spawn a local stdio process, and legacy SSE transport is not supported. Run a suitable HTTP server/bridge separately when necessary.

Configuration lives at `/Pandora/mcp.json` in the virtual vault:

```json
{
  "mcpServers": {
    "workspace": {
      "url": "https://mcp.example.com/mcp",
      "headers": {"Authorization": "Bearer ${WORKSPACE_TOKEN}"},
      "enabled": true,
      "exposure": "codemode",
      "description": "Trusted workspace service"
    }
  }
}
```

The hostname is an example; replace it with your real service. Add `WORKSPACE_TOKEN` to MCP secrets in Config, not the file. Config also supports server timeout and per-tool exposure overrides. Header values beginning with `!` can be resolved by a vault shell command: only use trusted configuration.

Servers connect in the background at startup; edits to the MCP configuration apply live. Browser deployments need server CORS/transport compatibility and cannot bypass HTTPS/mixed-content restrictions.

### Tool exposure

| Mode | Behavior |
| --- | --- |
| `codemode` (default) | Called through JavaScript in the codemode tool |
| `deferred` | Discovered/loaded by `tool_search`, then available to the model |
| `direct` | Declared directly to the model like built-in tools |
| `hidden` | Registered but unavailable to calls |

`toolExposure` maps exact tool names or `*` patterns to an exposure mode; exact matches win. Names are normalized as `mcp__<server>__<tool>`.

### Codemode

A codemode script can discover and call tools:

```js
const candidates = searchTools('workspace search');
console.log(candidates);
```

Then inspect a returned name with `describeTool(name)` and call the actual supported tool:

```js
const result = await tools.mcp__workspace__search({query: 'project'});
console.log(result);
```

The second example assumes that server actually exposes a `search` tool with a `query` argument; inspect its schema first. `describeNamespace()`, `ALL_TOOLS`, `store()`/`load()`, `text()`, and `image()` help inspect/filter results. Only explicit output/return values reach the model. Use `Promise.all` for independent calls only when concurrency is safe.

MCP resources are available through `list_mcp_resources`, `list_mcp_resource_templates`, and `read_mcp_resource`. Codemode itself has network APIs disabled, but called tools can perform network operations and other effects.

## HTTP request tool

`http_request` declares GET, POST, PUT, PATCH, DELETE, and HEAD to the model. Its implementation also accepts OPTIONS when invoked programmatically, but OPTIONS is not in the declared model-tool enum. Provide an HTTP(S) URL, optional query object, headers, and a JSON, form, or raw body. GET/HEAD cannot have a body.

Example tool arguments:

```json
{
  "method": "POST",
  "url": "https://api.example.com/items",
  "headers": {"Authorization": "Bearer {{SERVICE_TOKEN}}"},
  "json": {"title": "Review inbox"},
  "timeout": 30
}
```

Store the value of `SERVICE_TOKEN` in Config → Secrets. The tool substitutes `{{SERVICE_TOKEN}}` at request time. Response output includes status, selected headers, and text/JSON; binary responses can be saved to vault files. Timeouts default to 30 seconds and are bounded to 1–120 seconds.

### Secrets are not universal redaction

The model is given secret **names**, not the substituted values for this tool. Returned text is redacted for known secret values, but the implementation's string redaction only covers values at least four characters long. It does not guarantee removal of encoded/transformed credentials, credentials pasted into notes, or values exposed through arbitrary scripts. Scripts can access configured secrets via `process.env`.

Browser requests remain subject to CORS. The Android WebView has different network integration, but services still must be reachable and correctly authenticated. Test a harmless read endpoint before enabling writes.

Sources: [mcp.js](../app/modules/mcp.js), [net.js](../app/modules/net.js). See [Vector](vector.md) and [Discord](discord.md) for the dedicated messenger bridges and [Android API](http-api.md) for inbound control of Jade.
