# ---------- Vector: a digest mode (asked for by Pandora Dee Fae) ----------
# Exec'd by build.py after search_hint.py, on the finished page. In channels she answered every message, or only when
# named. Now there's a middle way: "A digest of the rest". Being named, replied to, or a trigger word, and DMs, are
# still answered right away; every other message in a channel she's in waits, and every so often (Digest every …
# minutes; sooner once 40 are waiting) they come to her as one turn, each with who said it, to answer once as a whole
# or let pass (NO_REPLY). When she's named, what was waiting in that channel comes along, so she has the thread.

rep('<option value="mention">When named or replied to</option><option value="all">Every message</option></select></div>',
    '<option value="mention">When named or replied to</option><option value="digest">When named, and a digest of the rest</option><option value="all">Every message</option></select></div>\n'
    '          <div><label class="lbl" for="sVecDigest">Digest every (minutes)</label><input id="sVecDigest" type="number" min="5" max="1440" class="field mt-1" placeholder="30"></div>')

rep("sVecNotify: 'vecNotify', sVecPoll: 'vecPoll' };", "sVecNotify: 'vecNotify', sVecPoll: 'vecPoll', sVecDigest: 'vecDigest' };")
rep("({ vecDm: 'anyone', vecTrigger: 'mention', vecWords: 'jade', vecNotify: 'inbox', vecPoll: 5 }[k] ?? '')",
    "({ vecDm: 'anyone', vecTrigger: 'mention', vecWords: 'jade', vecNotify: 'inbox', vecPoll: 5, vecDigest: 30 }[k] ?? '')")
rep("S[k] = k === 'vecPoll' ? Math.max(2, Math.min(120, +el.value || 5)) : el.value.trim();",
    "S[k] = k === 'vecPoll' ? Math.max(2, Math.min(120, +el.value || 5)) : k === 'vecDigest' ? Math.max(5, Math.min(1440, +el.value || 30)) : el.value.trim();")

# a channel message that doesn't call for her waits in the digest; one that does brings the waiting ones along
rep("    answer = (role === 'owner' || vecChannelAllowed(m.chat_id)) && vecTriggered(m);\n  }",
    "    const inRoom = role === 'owner' || vecChannelAllowed(m.chat_id);\n"
    "    answer = inRoom && vecTriggered(m);\n"
    "    if (inRoom && !answer && S.vecTrigger === 'digest') { vecDigestAdd(m, sender); return; }\n"
    "    if (answer && VEC.digest?.[m.chat_id]) { const d = VEC.digest[m.chat_id]; delete VEC.digest[m.chat_id]; vecEnqueue({ kind: 'msg', chat_id: m.chat_id, is_group: true, sender, role, msgs: [...d.msgs, m], digest: true, named: m.id }); return; }\n"
    "  }")

# a digest is due: after its minutes, or once it's long
rep("    for (const m of msgs) vecIncoming(m);\n",
    "    for (const m of msgs) vecIncoming(m);\n    vecDigestDue();\n")

DIGEST_JS = r"""
/* ---- Vector digest (vector_digest.py) ---- */
VEC.digest = {};   // chat id → { at, msgs } (each message with its sender), waiting for the digest
const VEC_DIGEST_MAX = 40;
function vecDigestAdd(m, sender) {
  const d = (VEC.digest[m.chat_id] ??= { at: Date.now(), msgs: [] });
  d.msgs.push({ ...m, npub: m.npub || sender });
  if (d.msgs.length >= VEC_DIGEST_MAX) vecDigestDue(true);
}
/** Digests whose time has come (or every one that's waiting, with `all`), each as one turn in its channel. */
function vecDigestDue(all = false, now = Date.now()) {
  const every = Math.max(5, +S.vecDigest || 30) * 60000;
  for (const [chat, d] of Object.entries(VEC.digest)) {
    if (!all && now - d.at < every && d.msgs.length < VEC_DIGEST_MAX) continue;
    delete VEC.digest[chat];
    vecEnqueue({ kind: 'msg', chat_id: chat, is_group: true, sender: '', role: 'public', msgs: d.msgs, digest: true });
  }
}
/** A digest as she reads it: who said what, and what she's asked to do with it. */
function vecDigestText(item, where) {
  const named = item.named ? item.msgs.find(m => m.id === item.named) : null;
  const people = [...new Set(item.msgs.map(m => vecName(m.npub) || 'someone'))];
  const lines = item.msgs.map(m => `${m.id === item.named ? '→ ' : ''}${vecName(m.npub) || 'someone'} (message ${m.id}): ${String(m.content || (m.attachments?.length ? '[a file]' : '')).replace(/\s+/g, ' ').slice(0, 600)}`);
  return `[Vector ${where} · ${named ? `${vecName(named.npub) || 'someone'} named you; here's what was said before it` : `a digest: ${item.msgs.length} message${item.msgs.length === 1 ? '' : 's'} since you last looked`}, from ${people.join(', ')}]\n` +
    lines.join('\n') + '\n\n' +
    (named
      ? `(Answer the message marked →, with the rest as the conversation it's part of. Your plain-text answer is sent to this chat as a reply to it. Answer NO_REPLY to stay silent.)`
      : `(Read it as one conversation. If something in it is worth answering, answer once, briefly, as one message to the channel (it's sent as a reply to the last message); you can name who you're answering. If nothing needs you, answer NO_REPLY. Pass anything {{PERSON_NAME}} should know on with notify_owner.)`);
}
Object.assign(window, { vecDigestAdd, vecDigestDue, vecDigestText });
"""
rep("function vecEnqueue(item) {", DIGEST_JS + "function vecEnqueue(item) {")

# a digest turn is put to her as a digest (each message with who said it)
rep("      content = `[Vector ${where} · from ${who} · ${roleTxt}]\\n${parts.join('\\n\\n')}\\n\\n` +",
    "      if (item.digest) content = vecDigestText(item, where); else content = `[Vector ${where} · from ${who} · ${roleTxt}]\\n${parts.join('\\n\\n')}\\n\\n` +")

# in the chat, a digest shows without the note on what to do with it
rep(r"display: content.split('\n(Your plain-text')[0], ts: Date.now(), _vec: true };",
    r"display: content.split(/\n\((?:Your plain-text|Answer the message marked|Read it as one conversation)/)[0], ts: Date.now(), _vec: true };")
