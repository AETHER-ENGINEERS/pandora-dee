<!-- id: skills | parent: using | level: 2 | order: 13 | tags: skills, router, find_skill, SKILL.md -->
# Skills and the skill router

A **skill** is a folder `/Jade/skills/<kebab-name>/` with a `SKILL.md` (frontmatter `name` and `description`, then instructions) and optional files the skill refers to by relative path. Jade loads one on demand with the `skill` tool, or you run it with `/skill:name`. Built-ins include daily-review, atomic-notes, literature-note, math-notes and skill-creator (which teaches her to write new ones).

```
---
name: invoice-filing
description: Use when the user wants an invoice saved, renamed and linked to its project note.
---
# Steps
1. …
```

## The router (2.17)

Listing every skill in the prompt costs context. With **15 or fewer** skills all are listed. With more, only the best **6** for the current message are listed, chosen by meaning (vectors over each skill's name and description in the `skills` collection) fused with whole-word overlap, and the `find_skill` tool lets her search for others. Strict mode drops weak matches (vector distance over 0.6 and no word overlap). Counters (`offered / found / used`) are kept in `skillStats`.

## Writing a good description

The description is all the router sees. Say *when to use it* in the words a user would say. One skill per job; put the procedure in the body, not the description.

## Vault-resident helpers

The `think` tool also exists as a vault script (`think.js` plus the `think-before-acting` skill) for older app versions; see [Think and delegate](#doc:think-delegate).
