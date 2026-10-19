# Note scripts and templates

**Jade Vault 2.9.0** · [Documentation index](README-docs.md)

Jade Vault implements Dataview- and Templater-style features. Enable **Run JavaScript in notes** in Config → Tools → Note scripts & templates to render live script blocks (enabled by default). These are compatibility features, not full installations of the Obsidian plugins; do not assume every plugin API is supported.

## Computed note views

In **Read** and **Split**, fenced `dataviewjs` or `jade-js` blocks run and render their output:

```dataviewjs
const pages = dv.pages('#project');
dv.header(2, 'Projects');
dv.table(['Note', 'Status'], pages.map(p => [p.file.link, p.status || 'Not set']));
```

An inline expression displays a scalar value:

```markdown
Project count: `$= dv.pages('#project').length`
```

### Supported surface

| API | Purpose |
| --- | --- |
| `dv.pages('#tag')` | Select pages by tag |
| `dv.pages('"folder"')` | Select pages in a folder |
| `dv.page(...)` | Read a page record |
| `dv.current()` | Current note record |
| `dv.table(headers, rows)` | Render a table |
| `dv.list(items)` | Render a list |
| `dv.taskList(tasks)` | Render tasks |
| `dv.header(level, text)` | Render a heading |
| `dv.paragraph(text)` | Render text |
| `dv.io.load(path)` | Load vault content |

Frontmatter parsing supports a small YAML subset: scalar `key: value`, inline lists, and indented list items, not arbitrary nested YAML. Page records expose frontmatter properties plus `file.name`, `file.path`, `file.link`, `file.tags`, `file.outlinks`, `file.inlinks`, `file.tasks`, and `file.mtime`.

## Templates

Templates are Markdown notes under `/Templates` by default; the folder is configurable. Use the editor's **{ }** button to select and insert a template.

Example `/Templates/Daily.md`:

```markdown
# <% tp.file.title %>
Date: <% tp.date.now("YYYY-MM-DD") %>

## Focus
<% await tp.system.prompt("What is today's focus?") %>

## Tasks
- [ ] <% tp.file.cursor() %>
```

Supported features include:

- `<% tp.date.now("YYYY-MM-DD") %>` for formatted dates.
- `<% tp.file.title %>` and `<% tp.frontmatter.x %>` for note metadata.
- `<% await tp.system.prompt("Question?") %>` for user input.
- `<% tp.file.include("[[Note]]") %>` for included note content.
- `<% tp.file.cursor() %>` for cursor placement.
- `<%* code; tR += "text" %>` for a code block that contributes output.
- `-%>` to trim a line break.

## Permission model

By default, note scripts can read the vault but cannot make network requests or persist file changes. Calling Jade's tools requires **Config → Tools → Note scripts & templates → Let note scripts and templates call Jade's tools**, which is off by default. Enabling it widens the power of code embedded in notes, including imported notes: review the source before granting it. Direct script network access remains disabled, but permitted tool calls can perform network requests or change files. The read-only script setting does not make those tool effects read-only.

Rendering can rerun note scripts, so avoid non-idempotent tool calls from a computed note. Use a manually run flow or shell script for intentional writes and external effects.

If a block does not render, confirm Read/Split mode, the exact fence language, valid JavaScript, and that the APIs used are supported. See [scripting](scripting.md) for the more capable execution environment.

Source: [templates.js](../app/modules/templates.js).
