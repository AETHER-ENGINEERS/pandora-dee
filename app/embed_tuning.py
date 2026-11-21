# ---------- how the embedding index builds: texts per request, requests at once, how often it saves ----------
# Exec'd by build.py last. Building the index sent 16 texts per request, one request at a time, which on a big vault and
# an embedding server across the network (a Mac over Tailscale) spends most of its time waiting on round trips. Now
# Config → Memory → Embeddings sets how many texts go in each request (16 unless set, up to 512), how many requests run
# at once (1 unless set, up to 8; Ollama answers them together when OLLAMA_NUM_PARALLEL allows), and how often progress
# is saved (every 30 s unless set). A change applies to a build already running, from its next round.
rep('<div class="flex items-center gap-3 flex-wrap"><button type="button" class="btn btn-ghost" id="btnEmbedRebuild">',
    '<div class="grid grid-cols-3 gap-2 embed-tuning">'
    '<label class="flex flex-col gap-1 text-sm" for="sEmbedBatch"><span>Texts per request</span><input type="number" id="sEmbedBatch" class="field" min="1" max="512" step="1" placeholder="16"></label>'
    '<label class="flex flex-col gap-1 text-sm" for="sEmbedParallel"><span>Requests at once</span><input type="number" id="sEmbedParallel" class="field" min="1" max="8" step="1" placeholder="1"></label>'
    '<label class="flex flex-col gap-1 text-sm" for="sEmbedSaveSecs"><span>Save progress every (s)</span><input type="number" id="sEmbedSaveSecs" class="field" min="5" max="600" step="5" placeholder="30"></label>'
    '</div>\n'
    '        <p class="hint">A faster embedding server can take more texts per request and more requests at once (Ollama runs several together when <code>OLLAMA_NUM_PARALLEL</code> allows). Changes apply to a build already running, from its next round.</p>\n'
    '        <div class="flex items-center gap-3 flex-wrap"><button type="button" class="btn btn-ghost" id="btnEmbedRebuild">')
# shown when Config opens
rep("$('#sEmbedNotes').checked = !!S.embedNotes;",
    "$('#sEmbedNotes').checked = !!S.embedNotes; $('#sEmbedBatch').value = S.embedBatch || ''; $('#sEmbedParallel').value = S.embedParallel || ''; $('#sEmbedSaveSecs').value = S.embedSaveSecs || '';")
# saved by Save & Reconnect, and used at once by Test and rebuild (both read the form the same way)
rep("embedNotes: $('#sEmbedNotes').checked }",
    "embedNotes: $('#sEmbedNotes').checked, ...embedTuningForm() }", count=2)
rep("function embedProgressText(p) {",
    "// the three fields as numbers in range; an empty field means the default\n"
    "function embedTuningForm() {\n"
    "  const n = (id, lo, hi) => { const v = Math.round(+$(id).value); return v ? Math.max(lo, Math.min(hi, v)) : undefined; };\n"
    "  return { embedBatch: n('#sEmbedBatch', 1, 512), embedParallel: n('#sEmbedParallel', 1, 8), embedSaveSecs: n('#sEmbedSaveSecs', 5, 600) };\n"
    "}\n"
    "function embedProgressText(p) {")
