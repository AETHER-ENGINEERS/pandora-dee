/* =====================================================================
   PEOPLE — names, not ranks (the People layer, as in PDA SEASIDE; Pandora Dee Fae's design, 2026-11-06)
   The characters call people by their names, and by a label the household chooses when there is no name
   to use. Text that reaches a model may carry four variables, filled in here just before each request:
     {{PERSON_NAME}}    the person this app works with: their dossier's name, else the name they go by on
                        Vector or Discord, else PERSON_LABEL
     {{PERSON_LABEL}}   how they are known (their dossier's label, else "Partner")
     {{PEER_LABEL}}     anyone else, said neutrally ("the person you're talking with")
     {{COMPANY_LABEL}}  the household or Free Company ("#OneMoment")
   A dossier is a note in /People/<name>.md with frontmatter name, label and handles (an npub, a Discord id):
   the same notes PDA SEASIDE reads, so one dossier works in both. Only these four are touched, so anything
   else in braces (the secrets' {{NAME}}s) stays as written. Internal names (vecOwner, dcOwner, notify_owner,
   the API's 'assistant' role) stay as they are.
   ===================================================================== */
function relLabels() {
  const d = { personLabel: 'Partner', peerLabel: "the person you're talking with", companyLabel: '#OneMoment' };
  try { for (const k of Object.keys(d)) { const v = S['rel' + k[0].toUpperCase() + k.slice(1)]; if (typeof v === 'string' && v.trim()) d[k] = v.trim(); } } catch {}
  return d;
}
function relDossierFrom(path, text) {
  const fm = {}; const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  if (m) for (const line of m[1].split(/\r?\n/)) { const kv = /^\s*([A-Za-z_]+)\s*:\s*(.*)$/.exec(line); if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, ''); }
  const file = path.split('/').pop().replace(/\.(md|markdown)$/i, '');
  const list = v => String(v || '').replace(/^\[|\]$/g, '').split(/[,\n]/).map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const name = fm.name || fm.PERSON_NAME || file;
  return { path, name, label: fm.label || fm.PERSON_LABEL || '', handles: [...new Set([file, name, ...list(fm.handles), ...list(fm.handle)])] };
}
function relDossiers() {
  const out = [];
  try { if (vfs.isDir('/People')) for (const n of vfs.list('/People')) if (/\.(md|markdown)$/i.test(n)) out.push(relDossierFrom('/People/' + n, vfs.read('/People/' + n))); } catch {}
  return out;
}
function relFind(dossiers, ...keys) {
  const want = keys.map(k => String(k || '').trim().toLowerCase()).filter(Boolean);
  return want.length ? dossiers.find(d => d.handles.some(h => want.includes(h.toLowerCase()))) : undefined;
}
/** The four variables, for the person this app works with (their Vector or Discord handle finds their dossier). */
function relVars() {
  const l = relLabels(); let S_ = {}; try { S_ = S; } catch {}
  const d = relFind(relDossiers(), S_.vecOwner, S_.dcOwner, S_.vecOwnerName, S_.dcOwnerName);
  const PERSON_LABEL = d?.label || l.personLabel;
  const known = String(S_.vecOwnerName || S_.dcOwnerName || '').trim();
  return { PERSON_NAME: d?.name || known || PERSON_LABEL, PERSON_LABEL, PEER_LABEL: l.peerLabel, COMPANY_LABEL: l.companyLabel };
}
function relFill(text, v) {
  const t = String(text ?? '');
  if (!t.includes('{{')) return t;
  try { v = v || relVars(); return t.replace(/\{\{(PERSON_NAME|PERSON_LABEL|PEER_LABEL|COMPANY_LABEL)\}\}/g, (_, k) => v[k]); } catch { return t; }
}
/** Messages and tools on their way to a model: every text filled once per request. */
function relFillMsgs(msgs) {
  const v = relVars();
  return msgs.map(m => typeof m.content === 'string' && m.content.includes('{{') ? { ...m, content: relFill(m.content, v) } : m);
}
function relFillTools(tools) {
  const v = relVars();
  const fillDeep = x => typeof x === 'string' ? relFill(x, v) : Array.isArray(x) ? x.map(fillDeep) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, fillDeep(y)])) : x;
  return (tools || []).map(t => JSON.stringify(t).includes('{{') ? fillDeep(t) : t);
}
/** A new dossier's note, ready to fill in. */
function relDossierTemplate(name, label = relLabels().personLabel, handles = []) {
  return `---\nname: ${name}\nlabel: ${label}\nhandles: ${[name, ...handles].filter(Boolean).join(', ')}\n---\n\n# ${name}\n\nHow we relate, kept so nobody is reduced to a role. Not surveillance: a memory of who they are to us.\n\n- **Where we talk:**\n- **Shared projects:**\n- **First met:**\n- **Consent notes:** (what they're happy for us to remember, share or do)\n- **Voice and style they like:**\n`;
}
