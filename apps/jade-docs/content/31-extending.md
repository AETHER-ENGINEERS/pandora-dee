<!-- id: extending | parent: architecture | level: 3 | order: 31 | tags: extend, add tool, module, build.py, pattern -->
# Extending Jade Vault: adding a tool

1. **Write the module** `app/modules/my_tool.js`: define the implementation `async function myTool(args)`, then register the schema:

```js
WORLD_TOOL_DEFS.push({
  name: 'my_tool',
  description: 'One short sentence. Say what it is for and point to help for details.',
  parameters: { type: 'object', properties: { action: { type: 'string', enum: ['a', 'b'] } }, required: ['action'] },
});
Object.assign(window, { myTool });   // anything a test or another module needs
```

2. **Inject it** in `app/build.py`: add `rd('my_tool.js')` to the line that injects the modules before the BOOT marker (keep the order: later modules may use earlier ones).
3. **Gate it** in the `WORLD_TOOL_DEFS.filter(...)` replacement: `&& (t.name !== 'my_tool' || S.myToolOn)`; add the setting to the `DEFAULTS` replacement.
4. **Dispatch it** in the `runTool` replacement: `case 'my_tool': return await myTool(args);`
5. **Mention it** in the system-prompt prose replacement ("litert: run .tflite models; … my_tool: …") using no apostrophes.
6. **Settings UI** (optional): a block in the settings HTML in build.py and a fill/read pair wired into `world.js`.
7. **Secrets**: if the setting holds a key, append it to the `SECRET_KEYS` replacement so backups exclude it.
8. **Test** with `tests/my_tool_test.mjs` modelled on a similar one, register it in `ALL` in `tests/run.mjs`, and run `ctx_test` + `traj_test` to make sure the prompt still fits the default context.
9. **Document** it in the changelog and here.

## Rules that save time

- Every `rep(old, new)` must match exactly once; prefer adding a module over patching the core.
- Label anything coming from outside as untrusted data; put approvals in `phoneApprove(title, detail)`.
- Keep budgets (steps, seconds, bytes) in the tool and return structured errors that tell the model what to do next.
- A tool called from scripts/flows is `await jade.tool('my_tool', {...})`; nothing extra is needed.
