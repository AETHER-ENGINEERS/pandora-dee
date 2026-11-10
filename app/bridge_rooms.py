# ---------- bridges keep to their rooms (filed by Pandora Dee Fae, 2026-11-09) ----------
# Exec'd by build.py last, on the finished page. A message typed while a turn runs is queued, and agentLoop "steered"
# the running turn with it in whatever chat was current: during a Vector or Discord turn that's the channel's chat, so
# the message went into the channel's chat and her answer to it was posted to the channel. Now a queued message steers
# only a turn started from send(), in its own chat; background turns (Vector, Discord, Mini Apps, the heartbeat,
# curiosity) never take it, and it goes to the chat it was typed in once that's back (restoreChat, in xdcwake.js).
# A bridge turn also waits while a person's turn is starting or queued (vector.js, discord.js read humanTurn).

rep("let running = false; const queue = [];",
    "let running = false; const queue = [];\n"
    "// the chat a turn started from send() belongs to: only that turn, in that chat, takes what's typed meanwhile\n"
    "let humanTurn = null;")

rep("  if (running) { queue.push(text); updateQueueNote(); return; }\n  let content = text;",
    "  if (running) { queue.push(text); updateQueueNote(); return; }\n"
    "  // (starting now: a Vector or Discord turn waits for this one rather than slipping in before it runs)\n"
    "  humanTurn = 'starting';\n"
    "  try {\n"
    "  let content = text;")

rep("  await agentLoop();\n  if (queue.length) { const next = queue.splice(0).join('\\n\\n'); updateQueueNote(); await send(next); }\n}",
    "  humanTurn = cur.id;\n"
    "  await agentLoop();\n"
    "  } finally { humanTurn = null; }\n"
    "  if (queue.length) { const next = queue.splice(0).join('\\n\\n'); updateQueueNote(); await send(next); }\n}")

rep("if (turns > 1 && queue.length) {",
    "if (turns > 1 && queue.length && humanTurn && humanTurn === cur?.id) {")
