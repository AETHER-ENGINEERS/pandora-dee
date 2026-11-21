# ---------- big backups: written and read in pieces, never as one giant string ----------
# Exec'd by build.py last. A backup was made as one JSON string of the whole vault and every chat (indented, at that),
# then copied again into the file. With a big vault (thousands of chats, a vector index of 12,000 texts) Firefox ran out
# of memory and threw the bare string "out of memory", which has no .message, so the button said "Export failed:
# undefined". Now:
# - backupPieces() writes the same JSON as pieces, one line per vault file and per chat, and the file is made from
#   those pieces (Export everything / Export config, and the scheduled backup to a server, which gzips the pieces).
# - readBackupFile() opens a backup as before when it fits in one string; a big one written this way is read line by
#   line instead, through gzip when it's a .json.gz. A big backup in the old indented form says why it can't be opened.
# - Any failure shows its reason ("out of memory" too), never "undefined".
rep("""let lastBackupText = '';
async function exportBackup(kind) {
  const withKeys = $('#sBackupKeys')?.checked; const data = await buildBackup(kind, withKeys);
  lastBackupText = JSON.stringify(data, null, 1);
  const name = `pandora-dee-${kind === 'full' ? 'backup' : 'config'}-${todayStr()}.json`;
  $('#backupNote').textContent = `${kind === 'full' ? 'Full backup' : 'Config'}: ${Object.keys(data.vault.files).length} files${data.db ? `, ${(data.db.sessions || []).length} chats, ${(data.db.schedules || []).length} schedules` : ''} · ${fmtSize(lastBackupText.length)}${withKeys ? ' · includes API keys' : ''}`;
  $('#btnBackupCopy').hidden = false;
  await saveTextFile(name, lastBackupText);
}""", r"""let lastBackupText = '';
const BACKUP_COPY_MAX = 20e6, BACKUP_ONE_PIECE_MAX = 150e6;   // Copy JSON up to 20 MB; files over 150 MB are read line by line
// The backup as JSON in pieces: the head, then one line per vault file and one per stored record (each chat is one).
// Joined, it's an ordinary backup any version can open; it's just never one string while it's made.
function backupPieces(data) {
  const J = JSON.stringify, out = []; const { vault, db, ...head } = data;
  out.push(J(head).slice(0, -1) + ',\n');
  out.push('"vault":' + J({ dirs: vault.dirs || [] }).slice(0, -1) + ',"files":{\n');
  const files = Object.entries(vault.files || {}); files.forEach(([p, v], i) => out.push(J(p) + ':' + J(v) + (i < files.length - 1 ? ',' : '') + '\n'));
  out.push('}}' + (db ? ',' : '') + '\n');
  if (db) { out.push('"db":{\n'); const ks = Object.entries(db); ks.forEach(([k, v], i) => out.push(J(k) + ':' + J(v) + (i < ks.length - 1 ? ',' : '') + '\n')); out.push('}\n'); }
  out.push('}\n');
  return out;
}
const isOutOfMemory = e => e instanceof RangeError || /out of memory|allocation size|invalid string length/i.test(String(e?.message || e));
const errText = e => String(e?.message || e || 'unknown error') + (isOutOfMemory(e) ? ' (the browser ran out of memory for this)' : '');
async function exportBackup(kind) {
  const withKeys = $('#sBackupKeys')?.checked; const data = await buildBackup(kind, withKeys);
  const pieces = backupPieces(data); const size = pieces.reduce((a, p) => a + p.length, 0);
  lastBackupText = size <= BACKUP_COPY_MAX ? pieces.join('') : '';   // Copy JSON only for a backup small enough to paste
  const name = `pandora-dee-${kind === 'full' ? 'backup' : 'config'}-${todayStr()}.json`;
  $('#backupNote').textContent = `${kind === 'full' ? 'Full backup' : 'Config'}: ${Object.keys(data.vault.files).length} files${data.db ? `, ${(data.db.sessions || []).length} chats, ${(data.db.schedules || []).length} schedules` : ''} · ${fmtSize(size)}${withKeys ? ' · includes API keys' : ''}`;
  $('#btnBackupCopy').hidden = !lastBackupText;
  await saveTextFile(name, pieces);
}
// Open a backup file: in one piece when it fits, line by line when it's big (as backupPieces writes it)
async function readBackupFile(file) {
  if (file.size <= BACKUP_ONE_PIECE_MAX) { try { return typeof abReadBackup === 'function' ? await abReadBackup(file) : JSON.parse(await file.text()); } catch (e) { if (!isOutOfMemory(e)) throw e; } }
  return readBackupLines(file);
}
async function readBackupLines(blob) {
  const magic = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  let stream = blob.stream(); if (magic[0] === 0x1f && magic[1] === 0x8b) stream = stream.pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  const old = () => new Error('This backup is too big to open in one piece, and it was made before 2.10.9, which writes big backups so they can be read a line at a time. Open it in the version that made it and export it again from there.');
  let data = null, state = 'head', buf = '';
  const one = l => JSON.parse('{' + l.replace(/,$/, '') + '}');
  const line = l => {
    if (!l || state === 'end') return;
    if (state === 'head') { if (!/^\{"app":/.test(l) || !l.endsWith(',')) throw old(); data = JSON.parse(l.slice(0, -1) + '}'); state = 'vault'; return; }
    if (state === 'vault') { if (!/^"vault":/.test(l)) throw old(); data.vault = { dirs: JSON.parse('{' + l + '}}}').vault.dirs, files: {} }; state = 'files'; return; }
    if (state === 'files') { if (l === '}},') { state = 'db0'; return; } if (l === '}}') { state = 'end'; return; } Object.assign(data.vault.files, one(l)); return; }
    if (state === 'db0') { if (l !== '"db":{') throw old(); data.db = {}; state = 'db'; return; }
    if (state === 'db') { if (l === '}') { state = 'end'; return; } Object.assign(data.db, one(l)); }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (value) { buf += value; let i; while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); } }
    if (done) break;
  }
  line(buf.trim() === '}' ? '' : buf.trim());
  if (state !== 'end' || !data) throw old();
  return data;
}""")
# the buttons say why, never "undefined"
for kind in ('full', 'config'):
    btn = 'btnExportAll' if kind == 'full' else 'btnExportCfg'
    rep(f"$('#{btn}').onclick = () => exportBackup('{kind}').catch(e => toast('Export failed: ' + esc(e.message), 'err'));",
        f"$('#{btn}').onclick = () => exportBackup('{kind}').catch(e => {{ console.error(e); toast('Export failed: ' + esc(errText(e)), 'err'); }});")
# restoring reads big backups line by line
rep("  let data; try { data = typeof abReadBackup === 'function' ? await abReadBackup(file) : JSON.parse(await file.text()); } catch (e) { toast(e && e.message && !/JSON/.test(e.message) ? esc(e.message) : 'That file is not valid JSON.', 'err'); return; }",
    "  let data; try { data = await readBackupFile(file); } catch (e) { console.error(e); toast(e && (e.message || typeof e === 'string') && !/JSON/.test(String(e.message || e)) ? esc(errText(e)) : 'That file is not valid JSON.', 'err'); return; }")
# the scheduled backup to a server: gzip the pieces, no giant string; reading one back falls back to lines too
rep("""  let bytes = enc.encode(JSON.stringify(data)), ext = '.json';
  if (typeof CompressionStream === 'function') { bytes = await abGzip(bytes); ext = '.json.gz'; }""",
    """  const pieces = backupPieces(data); let bytes, ext = '.json';
  if (typeof CompressionStream === 'function') { bytes = new Uint8Array(await new Response(new Blob(pieces).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); ext = '.json.gz'; }
  else bytes = new Uint8Array(await new Blob(pieces).arrayBuffer());""")
rep("""  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = await abGunzip(u8);
  const data = JSON.parse(dec.decode(u8));""",
    """  let data; try { if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = await abGunzip(u8); data = JSON.parse(dec.decode(u8)); }
  catch (e) { if (isOutOfMemory(e)) return readBackupLines(new Blob([u8])); throw e; }   // too big for one string: read it a line at a time""")
rep("/* =====================================================================\n   BOOT", "Object.assign(window, { backupPieces, readBackupFile, readBackupLines, exportBackup, buildBackup });   // for tests/big_backup_test.mjs\n/* =====================================================================\n   BOOT")
