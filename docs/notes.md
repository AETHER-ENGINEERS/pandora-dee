# Notes and knowledge management

**Jade Vault 2.9.0** · [Documentation index](README-docs.md)

## Files and editing

Notes are `.md` or `.markdown` files in the virtual filesystem. Use Notes to create/open a file, then choose **Edit**, **Read**, or **Split**. Check the save indicator before navigating away. Markdown formatting buttons help insert headings, links, lists, tasks, tags, quotes, and code.

This is an in-app filesystem, not automatic synchronization with an Obsidian folder or your device's ordinary files. Export or back up before migrating. The shell and Jade's tools operate on the same vault.

## Markdown quick reference

```markdown
---
status: active
owner: Me
---
# Project plan

**Bold**, _italic_, ~~struck out~~, and `code`.

- [ ] Review the proposal
- [x] Create the note

See [[Research]] and [[Project plan#Next steps|next actions]].
#project #work/planning

## Next steps
> Keep the next action small.

| Item | Status |
| --- | --- |
| Draft | Ready |

Inline math: $E = mc^2$

$$
a^2 + b^2 = c^2
$$
```

Task checkboxes can be toggled in Read mode. Frontmatter is displayed as note properties; it is also available to note scripts/templates.

## Links and embeds

| Syntax | Purpose |
| --- | --- |
| `[[Note]]` | Link by note name |
| `[[Note\|Label]]` | Custom link label |
| `[[Note#Heading]]` | Jump to a heading |
| `[Label](folder/Note.md)` | Markdown link; local Markdown targets count in the graph |
| `![[Other Note]]` | Embed another note |
| `![[photo.png]]` | Embed a vault image |
| `![[photo.png\|300]]` | Embed with a width in pixels |
| `![Alt text](https://example.com/photo.png)` | Remote image; loading it contacts that host |

Type `[[` to get suggestions. Existing links are distinguished from missing links; tapping a missing link creates a note. Name resolution considers relative/root paths and matching filenames. Prefer explicit paths when filenames are ambiguous. Keep names distinctive: write tools guard against accidental duplicate note names.

## Search, tags, and graph

- Search matches note paths and text; all query terms must match somewhere in the path/content.
- Ranking favors note-name matches and repeated text matches, with a small backlink contribution.
- A query such as `#project` filters by tag, including nested tags such as `#project/client`.
- Tags begin with a letter and can include word characters, `/`, and `-`.
- Links/tags inside code and math are excluded from the link/tag index.
- Open **Links** on a note for backlinks, outgoing links, and unresolved targets.
- The graph shows notes as nodes and links as edges; missing notes are highlighted. Tap to open, drag to pan, and pinch/scroll to zoom. Local graph focuses on the neighborhood around a note.

`.git`, `node_modules`, `.trash`, and Jade's skill files are excluded from normal note indexing. These exclusions are indexing behavior, not a security boundary.

## Attachments

Chat attachments can supply images and other files; image understanding requires a vision-capable provider/model. Added images are stored under `/attachments/images/`. HTTP binary downloads can also be saved into the vault and embedded. PDF extraction/runtime loading may need external assets.

For computed views, see [note scripts and templates](note-scripts-and-templates.md). Implementation: [vault_core.js](../app/modules/vault_core.js), [vault_ui.js](../app/modules/vault_ui.js), [img.js](../app/modules/img.js), and [attach.js](../app/modules/attach.js).
