<!-- id: docs-app | parent: overview | level: 1 | order: 4 | tags: docs app, ask jade, bm25, search, notes, protocol -->
# Talking to Jade in this app

## Browse and search

The **Browse** tab is a tree by page; the four level buttons filter it (Overview, Guides, Internals, Reference). The **Search** tab ranks every section of every page with **BM25** (term frequency, inverse document frequency, length normalisation; title and heading matches weigh more, prefixes count at half weight, the exact phrase gets a bonus). Click a hit to open that page at that heading.

## Ask Jade

The **Ask Jade** tab sends your question (with the page you were reading, any text you selected, and the three best search hits) to Jade as an app update that wakes her. She answers *in this tab*, with page links she wants you to read. If she goes off script and answers in chat, the app still shows her reply here.

She can also, when it helps you: add a **note** to a page, suggest a page to read (a banner), or **edit or add a page** (an "edited" badge shows what changed). Your own notes and bookmarks are updates too, so she sees them.

## The protocol (short)

`ask` → `answer`; also `note`, `bookmark`, `goto`, `page` (set/del). The full contract is in the app's README (`apps action=source file=README.md`), and the vault tool `docs_tool.js` validates and sends them correctly, with a lookup/search over the same pages, so replies reference real page ids. See the `document` skill.

## Limits

Nothing here changes the real software: edits to a page change only this app's copy, for you and her. Regenerate the app (`scripts/build-docs-app.py`) after the code changes.
