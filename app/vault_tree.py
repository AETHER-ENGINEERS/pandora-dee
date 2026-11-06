# ---------- the Vault Tree (Pandora Dee Fae's design, 2026-11-06): a new chat is a new branch ----------
# Exec'd by build.py after the People layer, on the finished page. Roots are the files, the trunk is identity
# (SOUL, AGENTS, Memory…), branches are conversations, and leaves are the notes and messages that grow from them.
# This pass changes only the words people see; sessions, ids and settings keep their names.
_TREE = [
    ('aria-label="New chat"', 'aria-label="New branch"'),
    ('+ New chat</button>', '+ New branch</button>'),
    ('<div class="pane-h">Chats</div>', '<div class="pane-h">Branches</div>'),
    ('title="Rename this chat"', 'title="Rename this branch"'),
    ('title="Copy this chat as Markdown"', 'title="Copy this branch as Markdown"'),
    ('title="Delete this chat"', 'title="Delete this branch"'),
    ("['/new', 'new chat']", "['/new', 'new branch']"),
    ('<b>/new</b> new chat', '<b>/new</b> new branch'),
    ('<b>/delete</b> this chat', '<b>/delete</b> this branch'),
    ('>Delete all chats</button>', '>Delete all branches</button>'),
    ("'There are no saved chats.'", "'There are no saved branches.'"),
    ("'Stop the agent before deleting this chat.'", "'Stop the current turn before deleting this branch.'"),
    ("'This chat is already empty.'", "'This branch is already empty.'"),
]
for _a, _b in _TREE:
    if _a not in s: print('VAULT TREE: not found (skipped):', _a)
    s = s.replace(_a, _b)
