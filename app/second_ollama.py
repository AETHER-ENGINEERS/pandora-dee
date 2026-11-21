# ---------- A second Ollama: another address, as its own provider ----------
# Exec'd by build.py last. "Ollama" was one provider with one address, so when that address is an Ollama on another
# machine (reaching Ollama Cloud through it), the Ollama on this computer couldn't also be in the fallback list: it was
# the same provider. Now "Second Ollama" has its own address and its own remembered model, and can be the provider, a
# fallback, the heartbeat's model or the helper model, like any other. When the first Ollama's cloud models run out of
# their limit, the second one answers with what's installed locally.

# the provider itself
rep("  local: { label: 'Ollama', chip: 'OLLAMA' },",
    "  local: { label: 'Ollama', chip: 'OLLAMA' },\n  local2: { label: 'Second Ollama', chip: 'OLLAMA 2' },")
rep("  if (p === 'cloud') return new OpenAICompat({ base: 'https://ollama.com/v1'",
    "  if (p === 'local2') { const host = (c.host2 || 'http://localhost:11434').replace(/\\/+$/, ''); const cl = OllamaLib ? new OllamaLib({ host }) : new FetchOllama({ host }); cl._lib = !!OllamaLib; cl._base = host; cl.headers = {}; return cl; }\n"
    "  if (p === 'cloud') return new OpenAICompat({ base: 'https://ollama.com/v1'")
rep("  if (p === 'cloud' && !c.ollamaKey) return",
    "  if (p === 'local2' && !/^https?:\\/\\//.test(c.host2 || '')) return 'no address set for the second Ollama (Config → Model provider)';\n"
    "  if (p === 'cloud' && !c.ollamaKey) return")
rep("p === 'local' || p === 'llamacpp' ? 6000 : 15000", "p === 'local' || p === 'local2' || p === 'llamacpp' ? 6000 : 15000")
rep("const providerName = () => activeProv === 'local' ? `Ollama at ${S.host || DEFAULTS.host}` :",
    "const providerName = () => activeProv === 'local2' ? `the second Ollama at ${S.host2}` : activeProv === 'local' ? `Ollama at ${S.host || DEFAULTS.host}` :")
# it's an Ollama too: its context window is num_ctx, and the header chip names its address
rep("activeProv === 'local' ? (+S.numCtx || 16384) : 131072", "(activeProv === 'local' || activeProv === 'local2') ? (+S.numCtx || 16384) : 131072")
rep("activeProv === 'local' ? 'Config → Context window (num_ctx)'", "(activeProv === 'local' || activeProv === 'local2') ? 'Config → Context window (num_ctx)'")
rep("setOllamaChip('ok', activeProv === 'local' ?", "setOllamaChip('ok', activeProv === 'local2' ? `${new URL(S.host2).host} · 2nd` : activeProv === 'local' ?")

# settings: on by default in the fallback order (unticked), an address field, and in every provider list
rep("fallbackOrder: ['local', 'llamacpp', 'cloud', 'groq', 'openai', 'aicord'],", "fallbackOrder: ['local', 'local2', 'llamacpp', 'cloud', 'groq', 'openai', 'aicord'], host2: '',")
rep("...S.fallbacks, 'local', 'llamacpp', 'cloud', 'groq', 'openai', 'aicord'])]", "...S.fallbacks, 'local', 'local2', 'llamacpp', 'cloud', 'groq', 'openai', 'aicord'])]")
s = s.replace('<option value="local">Ollama on my computer</option>', '<option value="local">Ollama on my computer</option><option value="local2">Second Ollama (another address)</option>')
rep('          <div data-prov="llamacpp"><label class="lbl" for="sLcppHost">',
    '          <div data-prov="local2"><label class="lbl" for="sHost2">Second Ollama address</label><input id="sHost2" class="field mt-1" placeholder="http://localhost:11434" autocapitalize="off" autocorrect="off" spellcheck="false"></div>\n'
    '          <div data-prov="llamacpp"><label class="lbl" for="sLcppHost">')
rep("  llamacpp: 'Your own llama-server.",
    "  local2: 'Another Ollama, at its own address: for example the one on this computer, when the main Ollama is on another machine (and reaches Ollama Cloud for you). As a fallback it answers with its own local models when the first one is out of reach or out of its limit. Start it with OLLAMA_ORIGINS=\"*\" too.',\n"
    "  llamacpp: 'Your own llama-server.")
rep("S.oaiKey = $('#sOaiKey').value.trim();", "S.oaiKey = $('#sOaiKey').value.trim(); S.host2 = $('#sHost2').value.trim().replace(/\\/+$/, '');")
rep("$('#sOaiKey').value = S.oaiKey || '';", "$('#sOaiKey').value = S.oaiKey || ''; $('#sHost2').value = S.host2 || '';")
rep("lcppHost: ($('#sLcppHost')?.value.trim() || 'http://localhost:8080')", "host2: ($('#sHost2')?.value.trim() || '').replace(/\\/+$/, ''), lcppHost: ($('#sLcppHost')?.value.trim() || 'http://localhost:8080')")
