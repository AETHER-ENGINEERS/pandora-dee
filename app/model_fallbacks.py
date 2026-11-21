# ---------- Fallback models on the same provider ----------
# Exec'd by build.py last (after second_ollama.py). One Ollama can serve both cloud models (`…:cloud`, through the
# person's Ollama account) and local ones. When the chosen cloud model hits its usage limit, the fallback used to be
# another *provider*, so a second connection was needed to reach models that the same Ollama already has. Now each
# provider can list fallback models, tried in order before any other provider: the model that ran out rests (30 minutes
# for a limit, 5 for a server error), she carries on with the next one, and the preferred model comes back by itself
# once its rest is over. A lost connection still moves to the next provider, as before.

rep("host2: '',", "host2: '', modelFallbacks: {},")

rep("const provResting = p => (PROV_REST[p] || 0) > Date.now();", """const provResting = p => (PROV_REST[p] || 0) > Date.now();
// fallback models, per provider: the one that couldn't answer rests, the next one on the list takes over
const MODEL_REST = {};
const modelResting = (p, m) => (MODEL_REST[p + '|' + m] || 0) > Date.now();
function modelFailover(quota) {
  const p = activeProv, from = S.model, list = (S.modelFallbacks?.[p] || []).filter(Boolean);
  if (!list.length || !from) return '';
  MODEL_REST[p + '|' + from] = Date.now() + (quota ? 30 : 5) * 60000;
  const next = [S.modelBy?.[p], ...list].find(m => m && m !== from && !modelResting(p, m) && (!models.length || models.includes(m)));
  if (!next) return '';
  S.model = next; fillModelSelects();   // not saved: the preferred model stays the remembered one, and comes back
  return next;
}
// before each prompt: the preferred model is back once its rest is over
function restorePreferredModel() {
  const want = S.modelBy?.[activeProv];
  if (!want || S.model === want || running || modelResting(activeProv, want) || (models.length && !models.includes(want))) return;
  if (!(S.modelFallbacks?.[activeProv] || []).includes(S.model)) return;   // only undo a fallback, never the person's own pick
  S.model = want; fillModelSelects(); toast(`${esc(want)} has rested: switched back to it.`, 'ok');
}
Object.assign(window, { MODEL_REST, modelFailover, restorePreferredModel, readProvFields: () => readProvFields() });""")

rep("        const quota = isQuotaErr(e, msg);\n", """        const quota = isQuotaErr(e, msg);
        // first, another model on the same provider (a cloud model out of its limit → the next one, maybe local)
        if ((quota || /HTTP 5\\d\\d|overloaded|unavailable|not found|did not answer|timed? ?out/i.test(msg)) && !/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
          const was = S.model, nm = modelFailover(quota);
          if (nm) {
            thinkD.remove(); textEl.remove(); jadeBubble(`${was} ${quota ? 'is out of its limit' : "couldn't answer"}. Going on with ${nm}…`);
            toast(`${esc(was)} ${quota ? 'hit its usage limit and rests for 30 minutes' : 'failed and rests for 5 minutes'}. Continuing on ${esc(nm)}, same provider.`, 'ok'); turns--; continue;
          }
        }
""")

rep("async function maybeRestorePrimary() {", "async function maybeRestorePrimary() {\n  restorePreferredModel();")

# settings: the list for the provider being set up, comma-separated
rep('<div id="sFallbackWrap" style="grid-column:1/-1">',
    '<div id="sModelFbWrap" style="grid-column:1/-1"><label class="lbl" for="sModelFb">If its model can\'t answer, try these models on the same provider first</label>'
    '<input id="sModelFb" class="field mt-1" placeholder="e.g. qwen3.8:27b, kitti" autocapitalize="off" autocorrect="off" spellcheck="false">'
    '<div class="hint mt-1">Comma-separated, in order: cloud or local models on the same provider. When a cloud model hits its limit, she goes on with the next one here before trying another provider, and switches back once it has rested.</div></div>\n'
    '          <div id="sFallbackWrap" style="grid-column:1/-1">')
rep("$('#sHost2').value = S.host2 || '';", "$('#sHost2').value = S.host2 || ''; $('#sModelFb').value = (S.modelFallbacks?.[S.provider || 'local'] || []).join(', ');")
rep("S.host2 = $('#sHost2').value.trim().replace(/\\/+$/, '');", "S.host2 = $('#sHost2').value.trim().replace(/\\/+$/, ''); (S.modelFallbacks ||= {})[S.provider] = $('#sModelFb').value.split(',').map(x => x.trim()).filter(Boolean);")
rep("$('#sProvider').onchange = () => { renderFbList(); showProvFields(); };", "$('#sProvider').onchange = () => { renderFbList(); showProvFields(); $('#sModelFb').value = (S.modelFallbacks?.[$('#sProvider').value] || []).join(', '); };")
