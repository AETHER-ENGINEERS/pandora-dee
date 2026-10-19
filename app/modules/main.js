
/* =====================================================================
   PI NETRUNNER — a browser-only take on the pi coding agent
   Core loop: user prompt → Ollama /api/chat (tools) → run tools → repeat
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const enc = new TextEncoder(), dec = new TextDecoder();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtK = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

function toast(msg, kind = 'info') {
  const t = $('#toast'); $('#toastMsg').innerHTML = msg;
  $('#toastMsg').style.color = kind === 'err' ? 'var(--rd)' : kind === 'ok' ? 'var(--ok)' : 'var(--fg)';
  t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 5200);
}

/* ---------------- storage ---------------- */
const ls = {
  get(k, d) { try { const v = localStorage.getItem('jvault:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('jvault:' + k, JSON.stringify(v)); } catch {} }
};
const idb = (() => {
  let dbp;
  const open = () => dbp ??= new Promise((res, rej) => {
    try { const r = indexedDB.open('jade-vault', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); }
  });
  return {
    async get(k) { try { const db = await open(); return await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch { return undefined; } },
    async set(k, v) { try { const db = await open(); await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch {} },
    async del(k) { try { const db = await open(); await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = res; t.onerror = res; }); } catch {} }
  };
})();

/* ---------------- settings ---------------- */
const DEFAULTS = { provider: 'local', fallbacks: [], fallbackOrder: ['local', 'llamacpp', 'cloud', 'groq', 'openai'], lcppHost: 'http://localhost:8080', lcppKey: '', hbOn: false, hbEvery: 30, hbStart: '08:00', hbEnd: '22:00', hbChat: 'own', hbPrompt: '', hbProv: '', hbModel: '', auxProv: '', auxModel: '', bgMode: 'agent', bgNotify: true, groqKey: '', oaiHost: '', oaiKey: '', modelBy: {}, memoryOn: true, journalOn: true, compactAuto: true, compactAfter: 8, compactKeep: 2, compactPct: 85, jadeCompact: false, jadeShow: true, jadeVoice: false, voiceName: '', voicePitch: 1.25, voiceRate: 1.03, jadeFrame: 'portrait', ollayaOn: false, ollayaHost: 'http://localhost:11435', ollayaModel: '', ollayaKey: '', host: 'http://localhost:11434', model: '', temperature: 0.2, numCtx: 16384, think: false, maxTurns: 40, bbUrl: '', engine: 'auto', search: 'auto', ollamaKey: '', searx: '' };
const S = Object.assign({}, DEFAULTS, ls.get('settings', {}));
const saveSettings = () => { if (window.__restoring || window.__modelOverride) return; if (activeProv && S.model) (S.modelBy ||= {})[activeProv] = S.model; ls.set('settings', S); };

/* =====================================================================
   JADE CAT — Live2D companion (pixi-live2d-display, Cubism 4)
   Model files are served to the Live2D loader from memory (no network):
   a loader middleware answers by file name, and the texture is pre-seeded
   into PIXI's texture cache under the exact URL the model will ask for.
   ===================================================================== */
const Jade = (() => {
  const MODEL_URL = 'https://jade.local/jadecat.model3.json';
  const UNSAFE_EVAL_SHIM = 'https://cdn.jsdelivr.net/npm/@pixi/unsafe-eval@6.5.10/dist/browser/unsafe-eval.min.js';
  const state = {
    app: null, model: null, ready: false, failed: null, host: null,
    mood: 'idle', moodUntil: 0, moodNext: 'idle',
    gaze: null, pointer: { x: 0, y: 0, t: 0 }, wander: 0,
    blink: { next: 0, t: -1 }, nodT: -1, earT: -1,
    speaking: false, mouth: 0, mouthTarget: 0, bump: 0, utterId: 0,
    cur: {}, frame: 'portrait', onStatus: () => {}, onSpeak: () => {},
  };
  const P = {
    AX: 'ParamAngleX', AY: 'ParamAngleY', AZ: 'ParamAngleZ', EYE_L: 'ParamEyeLOpen', EYE_R: 'ParamEyeROpen',
    SMILE_L: 'ParamEyeLSmile', SMILE_R: 'ParamEyeRSmile', BROW_LY: 'ParamBrowLY', BROW_RY: 'ParamBrowRY',
    BROW_LA: 'ParamBrowLAngle', BROW_RA: 'ParamBrowRAngle', BROW_LF: 'ParamBrowLForm', BROW_RF: 'ParamBrowRForm',
    MOUTH_FORM: 'ParamMouthForm', MOUTH_OPEN: 'ParamMouthOpenY', CHEEK: 'ParamCheek', EAR_X: 'Param6', EAR_Y: 'Param7',
  };
  // Expression targets per mood (absolute values, blended every frame)
  const MOODS = {
    idle:      { gaze: null,          [P.BROW_LY]: 0,    [P.BROW_RY]: 0,    [P.MOUTH_FORM]: 0.25, [P.SMILE_L]: 0,   [P.SMILE_R]: 0,   [P.CHEEK]: 0,   label: 'online' },
    listening: { gaze: [-0.75, -0.35], [P.BROW_LY]: 0.25, [P.BROW_RY]: 0.25, [P.MOUTH_FORM]: 0.4,  [P.SMILE_L]: 0,   [P.SMILE_R]: 0,   [P.CHEEK]: 0,   label: 'listening' },
    thinking:  { gaze: [0.55, 0.65],   [P.BROW_LY]: 0.45, [P.BROW_RY]: 0.15, [P.MOUTH_FORM]: -0.2, [P.SMILE_L]: 0,   [P.SMILE_R]: 0,   [P.CHEEK]: 0,   label: 'thinking' },
    writing:   { gaze: [-0.7, -0.15],  [P.BROW_LY]: 0.1,  [P.BROW_RY]: 0.1,  [P.MOUTH_FORM]: 0.3,  [P.SMILE_L]: 0,   [P.SMILE_R]: 0,   [P.CHEEK]: 0,   label: 'writing' },
    working:   { gaze: [0.05, -0.85],  [P.BROW_LY]: -0.15,[P.BROW_RY]: -0.15,[P.MOUTH_FORM]: 0,    [P.SMILE_L]: 0,   [P.SMILE_R]: 0,   [P.CHEEK]: 0,   label: 'jacked in' },
    happy:     { gaze: [0, 0.1],       [P.BROW_LY]: 0.35, [P.BROW_RY]: 0.35, [P.MOUTH_FORM]: 1,    [P.SMILE_L]: 1,   [P.SMILE_R]: 1,   [P.CHEEK]: 1,   label: 'done' },
    error:     { gaze: [0, -0.1],      [P.BROW_LY]: -0.8, [P.BROW_RY]: -0.8, [P.MOUTH_FORM]: -1,   [P.SMILE_L]: 0,   [P.SMILE_R]: 0,   [P.CHEEK]: 0,   [P.BROW_LA]: -1, [P.BROW_RA]: -1, [P.BROW_LF]: -1, [P.BROW_RF]: -1, label: 'error' },
  };
  const EXPR_KEYS = [P.BROW_LY, P.BROW_RY, P.BROW_LA, P.BROW_RA, P.BROW_LF, P.BROW_RF, P.MOUTH_FORM, P.SMILE_L, P.SMILE_R, P.CHEEK];

  const b64gz = async (id) => {
    const bin = Uint8Array.from(atob(document.getElementById(id).textContent.replace(/\s+/g, '')), c => c.charCodeAt(0));
    return new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  };
  const jsonOf = (id) => JSON.parse(document.getElementById(id).textContent);
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(s); });
  const evalAllowed = () => { try { return new Function('return 1')() === 1; } catch { return false; } };

  async function ensureEvalShim() {
    if (evalAllowed()) return;
    // Pixi 6 compiles shader sync code with new Function; under a strict CSP use the official no-eval build
    await loadScript(UNSAFE_EVAL_SHIM);
    const ue = window.PIXI?.unsafeEval || window._pixi_unsafe_eval || window.__pixi_unsafe_eval;
    try { ue?.install?.(window.PIXI); } catch {}
  }

  function setP(core, id, v) { try { core.setParameterValueById(id, v); } catch {} }
  function addP(core, id, v) { try { core.addParameterValueById(id, v); } catch {} }

  async function init({ host, onStatus, onSpeak } = {}) {
    state.host = host; state.onStatus = onStatus || (() => {}); state.onSpeak = onSpeak || (() => {});
    if (!window.PIXI || !PIXI.live2d) throw new Error('Live2D runtime failed to load');
    state.onStatus('waking her up…');
    const files = {
      'jadecat.model3.json': jsonOf('l2d-model'), 'jadecat.physics3.json': jsonOf('l2d-physics'), 'jadecat.cdi3.json': jsonOf('l2d-cdi'),
      'jadecat.moc3': await b64gz('l2d-moc'),
    };
    const L = PIXI.live2d;
    if (!L.Live2DLoader.__jade) {
      L.Live2DLoader.middlewares.unshift((ctx, next) => {
        const name = String(ctx.url).split(/[?#]/)[0].split('/').pop();
        if (Object.prototype.hasOwnProperty.call(files, name)) {
          const v = files[name]; ctx.result = v instanceof ArrayBuffer ? v.slice(0) : JSON.parse(JSON.stringify(v)); return Promise.resolve();
        }
        return next();
      });
      L.Live2DLoader.__jade = true;
    }
    // texture: decode the embedded WebP and pre-seed PIXI's cache under the URL the model will resolve
    const img = new Image(); img.src = document.getElementById('l2d-tex').textContent.trim();
    await img.decode();
    const texUrl = new URL(files['jadecat.model3.json'].FileReferences.Textures[0], MODEL_URL).href;
    if (!PIXI.utils.TextureCache[texUrl]) PIXI.Texture.addToCache(PIXI.Texture.from(img), texUrl);

    let app;
    const mk = () => new PIXI.Application({ resizeTo: host, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(devicePixelRatio || 1, 2) });
    try { app = mk(); } catch (e) {
      if (!/unsafe-eval/i.test(String(e?.message))) throw e;
      await ensureEvalShim(); app = mk();
    }
    app.view.className = 'jade-canvas';
    host.prepend(app.view);
    state.app = app;
    const model = await L.Live2DModel.from(MODEL_URL, { autoInteract: false, autoUpdate: true });
    state.model = model;
    model.visible = false;
    app.stage.addChild(model);
    const core = model.internalModel.coreModel;
    for (const k of EXPR_KEYS) state.cur[k] = 0;
    model.internalModel.on('beforeModelUpdate', () => frame(core));
    app.ticker.addOnce(() => { layout(); model.visible = true; });
    new ResizeObserver(() => { app.resize(); layout(); }).observe(host);
    window.addEventListener('pointermove', e => { state.pointer = { x: e.clientX, y: e.clientY, t: performance.now() }; }, { passive: true });
    state.ready = true; state.onStatus('');
    return api;
  }

  function layout() {
    const { app, model } = state; if (!model) return;
    model.scale.set(1);
    const b = model.getLocalBounds(); const w = app.renderer.width / app.renderer.resolution, h = app.renderer.height / app.renderer.resolution;
    if (!w || !h) return;
    if (h < 130) {
      // compact strip: just her face, parked on the left
      const viewH = b.height * 0.155;
      const s = h / viewH;
      model.scale.set(s); model.pivot.set(b.x + b.width / 2, b.y + b.height * 0.012); model.position.set(Math.max(40, h * 0.55), 0);
    } else if (state.frame === 'full') {
      const s = Math.min(w * 0.92 / b.width, h * 0.94 / b.height);
      model.scale.set(s); model.pivot.set(b.x + b.width / 2, b.y + b.height / 2); model.position.set(w / 2, h / 2 + h * 0.01);
    } else {
      // portrait: head + upper body fills the stage, cropped below the chest
      const viewH = b.height * 0.44, viewW = b.width * 0.66;
      const s = Math.min(h / viewH, w / viewW);
      model.scale.set(s); model.pivot.set(b.x + b.width / 2, b.y); model.position.set(w / 2, h * 0.035);
    }
  }

  function frame(core) {
    const now = performance.now();
    if (state.mood !== 'idle' && state.moodUntil && now > state.moodUntil) { state.mood = state.moodNext; state.moodUntil = 0; }
    const M = MOODS[state.mood] || MOODS.idle;
    // gaze: mood target > recent pointer > lazy wander
    const fc = state.model.internalModel.focusController;
    let gx, gy;
    if (state.speaking) { gx = 0; gy = 0.05; }
    else if (M.gaze) { [gx, gy] = M.gaze; gx += Math.sin(now / 900) * 0.05; }
    else if (now - state.pointer.t < 4000) {
      const r = state.app.view.getBoundingClientRect();
      gx = Math.max(-1, Math.min(1, (state.pointer.x - (r.left + r.width / 2)) / (window.innerWidth * 0.35)));
      gy = Math.max(-1, Math.min(1, -(state.pointer.y - (r.top + r.height * 0.3)) / (window.innerHeight * 0.4)));
    } else { state.wander += 0.006; gx = Math.sin(state.wander) * 0.35; gy = Math.cos(state.wander * 0.6) * 0.15; }
    fc.focus(gx, gy);
    // expressions (smoothed)
    for (const k of EXPR_KEYS) { const t = M[k] ?? 0; state.cur[k] += (t - state.cur[k]) * 0.12; setP(core, k, state.cur[k]); }
    // blink (the model has no EyeBlink group, so we drive it)
    const B = state.blink; let open = 1;
    if (B.t < 0 && now > B.next) B.t = now;
    if (B.t >= 0) { const d = now - B.t; open = d < 70 ? 1 - d / 70 : d < 110 ? 0 : d < 230 ? (d - 110) / 120 : 1; if (d >= 230) { B.t = -1; B.next = now + 1800 + Math.random() * 4200 * (Math.random() < 0.15 ? 0.1 : 1); } }
    const smile = Math.max(state.cur[P.SMILE_L], 0);
    setP(core, P.EYE_L, open * (1 - smile * 0.35)); setP(core, P.EYE_R, open * (1 - smile * 0.35));
    // mouth: speech lipsync or closed
    if (state.speaking) { const n = 0.5 + 0.5 * Math.sin(now / 55) * Math.sin(now / 137 + 1.3); state.mouthTarget = 0.18 + 0.62 * n + state.bump; state.bump *= 0.86; }
    else state.mouthTarget = state.mood === 'happy' ? 0.25 : 0;
    state.mouth += (state.mouthTarget - state.mouth) * (state.mouthTarget > state.mouth ? 0.55 : 0.25);
    setP(core, P.MOUTH_OPEN, Math.min(1, state.mouth));
    for (const [k, v] of Object.entries(state.extra || {})) setP(core, k, v);
    // nod + ear twitch (transient)
    if (state.nodT >= 0) { const d = (now - state.nodT) / 600; if (d > 1) state.nodT = -1; else addP(core, P.AY, -Math.sin(d * Math.PI) * 14); }
    if (state.earT < 0 && Math.random() < (state.mood === 'working' ? 0.012 : 0.002)) state.earT = now;
    if (state.earT >= 0) { const d = (now - state.earT) / 260; if (d > 1) state.earT = -1; else { addP(core, P.EAR_X, Math.sin(d * Math.PI * 2) * 0.8); addP(core, P.EAR_Y, Math.sin(d * Math.PI) * 0.6); } }
  }

  // ---------------- public api ----------------
  function setMood(m, ms = 0, then = 'idle') {
    if (!MOODS[m]) m = 'idle';
    state.mood = m; state.moodUntil = ms ? performance.now() + ms : 0; state.moodNext = then;
  }
  function nod() { state.nodT = performance.now(); }
  function setFrame(f) { state.frame = f === 'full' ? 'full' : 'portrait'; layout(); }

  // speech (Web Speech API) with procedural lipsync
  let voices = [];
  const loadVoices = () => { try { voices = speechSynthesis.getVoices(); } catch { voices = []; } return voices; };
  if (!!window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
  function pickVoice(name) {
    const v = voices.length ? voices : loadVoices(); if (!v.length) return null;
    if (name) { const f = v.find(x => x.name === name); if (f) return f; }
    const pref = [/Libby|Sonia|Maisie|Mia|Hazel/i, /Google UK English Female/i, /Serena|Kate|Martha|Stephanie/i, /en-GB/i, /Female|Samantha|Zira|Aria|Jenny/i, /^en/i];
    for (const re of pref) { const f = v.find(x => re.test(x.name) || re.test(x.lang)); if (f) return f; }
    return v[0];
  }
  function speechText(md) {
    return String(md || '')
      .replace(/```[\s\S]*?```/g, '\n(code below)\n').replace(/`([^`]+)`/g, '$1')
      .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (m, a, b) => b || a)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^#+\s*/gm, '').replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '').replace(/[*_~>|#]/g, '')
      .replace(/https?:\/\/\S+/g, 'a link')
      .replace(/([^.!?:;,\s])[ \t]*\n+/g, '$1. ')          // line / list-item ends become pauses
      .replace(/\s+/g, ' ').trim();
  }
  // Split into short pieces: browsers silently stop long utterances (~15 s) and some drop big queues.
  function chunkText(t, max = 180) {
    const out = [];
    for (let s of t.match(/[^.!?…]+[.!?…]*["')\]]*\s*/g) || [t]) {
      s = s.trim(); if (!s) continue;
      while (s.length > max) {
        let cut = s.lastIndexOf(', ', max); if (cut < max * 0.4) cut = s.lastIndexOf(' ', max); if (cut < max * 0.4) cut = max;
        out.push(s.slice(0, cut + 1).trim()); s = s.slice(cut + 1).trim();
      }
      if (s) out.push(s);
    }
    return out;
  }
  // Native TTS bridge (the Android app exposes window.NetrunnerAndroid; WebView has no speechSynthesis)
  const nativeTTS = () => typeof window.NetrunnerAndroid?.speak === 'function';
  const nativeCbs = new Map(); let nativeSeq = 0;
  window.__jadeTTS = (ev, uid) => { const cb = nativeCbs.get(uid); if (cb) cb(ev); };
  function speakChunk(c, v, rate, pitch, onstart, ondone) {
    if (nativeTTS()) {
      const uid = 'u' + (++nativeSeq); let started = false;
      nativeCbs.set(uid, ev => { if (ev === 'start' && !started) { started = true; onstart(); } else if (ev !== 'start') { nativeCbs.delete(uid); ondone(); } });
      try { window.NetrunnerAndroid.speak(uid, c, pitch, rate); } catch { nativeCbs.delete(uid); ondone(); }
      return;
    }
    const u = new SpeechSynthesisUtterance(c); if (v) { u.voice = v; u.lang = v.lang; } u.rate = rate; u.pitch = pitch;
    let done = false; const fin = () => { if (!done) { done = true; clearTimeout(guard); ondone(); } };
    u.onstart = onstart; u.onboundary = () => { state.bump = 0.35; }; u.onend = fin; u.onerror = fin;
    // safety net: if the engine never fires onend, move on after a generous estimate
    const guard = setTimeout(fin, 4000 + c.length * 140 / Math.max(rate, 0.3));
    speechSynthesis.speak(u);
  }
  function speak(text, { voice, rate = 1.03, pitch = 1.25 } = {}) {
    if (!(!!window.speechSynthesis) && !nativeTTS()) return false;
    const t = speechText(text); if (!t) return false;
    stop();
    const id = ++state.utterId; const v = nativeTTS() ? null : pickVoice(voice);
    const chunks = chunkText(t); let i = 0;
    const next = () => {
      if (id !== state.utterId) return;
      if (i >= chunks.length) { state.speaking = false; state.onSpeak(''); return; }
      const c = chunks[i++];
      speakChunk(c, v, rate, pitch, () => { if (id === state.utterId) { state.speaking = true; state.onSpeak(c); } }, next);
    };
    next();
    return true;
  }
  function stop() {
    state.utterId++; state.speaking = false;
    try { speechSynthesis.cancel(); } catch {}
    if (nativeTTS()) { try { window.NetrunnerAndroid.stop(); } catch {} nativeCbs.clear(); }
  }

  const api = { init, setMood, nod, setFrame, speak, stop, voices: () => (voices.length ? voices : loadVoices()), get ready() { return state.ready; }, get mood() { return state.mood; }, label: () => (MOODS[state.mood] || MOODS.idle).label, state, P };
  return api;
})();

/* =====================================================================
   CRON — 5-field cron (minute hour day-of-month month day-of-week), local time.
   Supports * , - / and names (jan..dec, sun..sat), 7 = Sunday, and the
   shortcuts @hourly @daily @weekly @monthly @yearly.
   ===================================================================== */
const Cron = (() => {
  const SHORT = { '@hourly': '0 * * * *', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@weekly': '0 0 * * 0', '@monthly': '0 0 1 * *', '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *' };
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const FIELDS = [
    { name: 'minute', min: 0, max: 59 }, { name: 'hour', min: 0, max: 23 }, { name: 'day of month', min: 1, max: 31 },
    { name: 'month', min: 1, max: 12, names: MON, base: 1 }, { name: 'day of week', min: 0, max: 7, names: DOW, base: 0 },
  ];
  function field(src, f) {
    const set = new Set();
    for (const part of src.toLowerCase().split(',')) {
      const m = /^(\*|[a-z0-9]+(?:-[a-z0-9]+)?)(?:\/(\d+))?$/.exec(part);
      if (!m) throw new Error(`bad ${f.name} "${part}"`);
      const val = (x) => {
        if (f.names) { const i = f.names.indexOf(x); if (i >= 0) return i + f.base; }
        if (!/^\d+$/.test(x)) throw new Error(`bad ${f.name} "${x}"`);
        const n = +x; if (n < f.min || n > f.max) throw new Error(`${f.name} ${n} is out of range ${f.min}-${f.max}`); return n;
      };
      let lo, hi;
      if (m[1] === '*') { lo = f.min; hi = f.max; if (f.name === 'day of week') hi = 6; }
      else if (m[1].includes('-')) { [lo, hi] = m[1].split('-').map(val); if (lo > hi) throw new Error(`${f.name} range ${m[1]} runs backwards`); }
      else { lo = val(m[1]); hi = m[2] ? f.max : lo; }
      const step = m[2] ? +m[2] : 1; if (!step) throw new Error(`${f.name} step must be at least 1`);
      for (let v = lo; v <= hi; v += step) set.add(f.name === 'day of week' && v === 7 ? 0 : v);
    }
    return set;
  }
  function parse(expr) {
    let e = String(expr || '').trim().replace(/\s+/g, ' ');
    if (SHORT[e.toLowerCase()]) e = SHORT[e.toLowerCase()];
    const parts = e.split(' ');
    if (parts.length !== 5) throw new Error(`cron needs 5 fields (minute hour day month weekday), got ${parts.length}`);
    const [min, hour, dom, mon, dow] = parts.map((p, i) => field(p, FIELDS[i]));
    return { expr: e, min, hour, dom, mon, dow, domStar: parts[2] === '*', dowStar: parts[4] === '*' };
  }
  function dayOk(c, d) {
    const a = c.dom.has(d.getDate()), b = c.dow.has(d.getDay());
    if (c.domStar && c.dowStar) return true;
    if (c.domStar) return b; if (c.dowStar) return a;
    return a || b;                                   // classic cron: either day field may match
  }
  function next(expr, from = Date.now()) {
    const c = typeof expr === 'string' ? parse(expr) : expr;
    const d = new Date(from); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
    for (let i = 0; i < 200000; i++) {
      if (!c.mon.has(d.getMonth() + 1)) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); continue; }
      if (!dayOk(c, d)) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
      if (!c.hour.has(d.getHours())) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
      if (!c.min.has(d.getMinutes())) { d.setMinutes(d.getMinutes() + 1, 0, 0); continue; }
      return d.getTime();
    }
    return null;                                      // e.g. 30 February
  }
  function upcoming(expr, n = 3, from = Date.now()) { const out = []; let t = from; for (let i = 0; i < n; i++) { t = next(expr, t); if (!t) break; out.push(t); } return out; }
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (h, m) => { const d = new Date(2000, 0, 1, h, m); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  function describe(expr) {
    let c; try { c = parse(expr); } catch { return expr; }
    const [mi, ho, dm, mo, dw] = c.expr.split(' ');
    const one = (s) => /^\d+$/.test(s);
    let m;
    if ((m = /^\*\/(\d+)$/.exec(mi)) && ho === '*' && dm === '*' && mo === '*' && dw === '*') return `every ${m[1]} minutes`;
    if (mi === '*' && ho === '*' && dm === '*' && mo === '*' && dw === '*') return 'every minute';
    if (one(mi) && ho === '*' && dm === '*' && mo === '*' && dw === '*') return mi === '0' ? 'every hour' : `every hour at :${pad(mi)}`;
    if (one(mi) && (m = /^\*\/(\d+)$/.exec(ho)) && dm === '*' && mo === '*' && dw === '*') return `every ${m[1]} hours at :${pad(mi)}`;
    if (one(mi) && one(ho) && mo === '*') {
      const t = hm(+ho, +mi);
      if (dm === '*' && dw === '*') return `daily at ${t}`;
      if (dm === '*' && (dw === '1-5' || dw === 'mon-fri')) return `weekdays at ${t}`;
      if (dm === '*' && (dw === '0,6' || dw === '6,0' || dw === 'sat,sun')) return `weekends at ${t}`;
      if (dm === '*' && c.dow.size === 1) return `every ${DOW_LONG[[...c.dow][0]]} at ${t}`;
      if (dm === '*' && dw !== '*' && c.dow.size > 1) return `every ${[...c.dow].sort((a, b) => a - b).map(d => DOW_LONG[d].slice(0, 3)).join(' & ')} at ${t}`;
      if (one(dm) && dw === '*') return `monthly on day ${dm} at ${t}`;
      if ((m = /^\*\/(\d+)$/.exec(dm)) && dw === '*') return `every ${m[1]} days at ${t}`;
    }
    return c.expr;
  }
  // ---------- plain English -> cron (recurring) or a one-time timestamp ----------
  const DAYMAP = { sun: 0, sunday: 0, sundays: 0, mon: 1, monday: 1, mondays: 1, tue: 2, tues: 2, tuesday: 2, tuesdays: 2, wed: 3, weds: 3, wednesday: 3, wednesdays: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4, thursdays: 4, fri: 5, friday: 5, fridays: 5, sat: 6, saturday: 6, saturdays: 6 };
  const HELP = 'Use plain English like "every day at 9am", "weekdays at 8:30", "every monday at 6pm", "every 30 minutes", "in 20 minutes", "tomorrow at 7pm", or a 5-field cron like "0 9 * * *".';
  function timeOf(t) {
    if (/\b(noon|midday)\b/.test(t)) return [12, 0];
    if (/\bmidnight\b/.test(t)) return [0, 0];
    const m = /(?:^|\s)(?:at\s+)?(\d{1,2})(?:[:.h](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=\s|$)/.exec(t);
    if (m && (m[2] || m[3] || /\bat\s+\d/.test(t) || /^\d{1,2}$/.test(t.trim()) || /\b(daily|weekdays?|weekends?|day|week)\s+\d/.test(t))) {
      let h = +m[1]; const mi = +(m[2] || 0); const ap = (m[3] || '').replace(/\./g, '');
      if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
      if (h <= 23 && mi <= 59) return [h, mi];
    }
    if (/\bmorning\b/.test(t)) return [9, 0];
    if (/\bafternoon\b/.test(t)) return [14, 0];
    if (/\bevening\b/.test(t)) return [18, 0];
    if (/\b(tonight|night|nightly)\b/.test(t)) return [21, 0];
    return null;
  }
  function fromText(text) {
    const raw = String(text ?? '').trim();
    if (!raw) throw new Error('no time was given. ' + HELP);
    if (SHORT[raw.toLowerCase()] || /^[\d*][\d*\/,\-]*(\s+[\d*\/,\-a-z]+){4}$/i.test(raw)) { try { return { cron: parse(raw).expr }; } catch (e) { if (raw.split(/\s+/).length === 5) throw new Error(e.message + '. ' + HELP); } }
    let t = ' ' + raw.toLowerCase().replace(/[,;]/g, ' ').replace(/\b(and|&|the|o'?clock)\b/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    let m;
    if ((m = /\bin\s+(\d+|an?|one)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)\b/.exec(t))) {
      const n = /^\d+$/.test(m[1]) ? +m[1] : 1, u = m[2][0];
      if (!n) throw new Error('the delay must be at least 1. ' + HELP);
      return { once: Date.now() + n * (u === 'm' ? 60e3 : u === 'h' ? 3600e3 : 864e5) };
    }
    if (/\b(every|each)\s+minute\b/.test(t)) return { cron: '* * * * *' };
    if ((m = /\b(?:every|each)\s+(\d+)\s*(m|mins?|minutes?)\b/.exec(t))) { const n = +m[1]; if (n < 1) throw new Error('interval must be at least 1 minute'); return { cron: n >= 60 ? '0 * * * *' : `*/${n} * * * *` }; }
    if ((m = /\b(?:every|each)\s+(\d+)\s*(h|hrs?|hours?)\b/.exec(t))) { const n = +m[1]; if (n < 1 || n > 23) throw new Error('hour interval must be 1-23'); return { cron: `0 */${n} * * *` }; }
    if (/\b(hourly|every hour|each hour)\b/.test(t)) return { cron: '0 * * * *' };
    const everyNDays = /\b(?:every|each)\s+(\d+)\s*days?\b/.exec(t);
    const clean = t.replace(/\b(?:every|each|in)\s+\d+\s*\w+/g, ' ').replace(/\bon\s+the\s+\d{1,2}(st|nd|rd|th)?\b|\b\d{1,2}(st|nd|rd|th)\b/g, ' ');
    const tm = timeOf(clean); const [h, mi] = tm || [9, 0];
    const days = new Set(); for (const w of t.split(' ')) if (w in DAYMAP) days.add(DAYMAP[w]);
    let dow = /\bweekdays?\b/.test(t) ? '1-5' : /\bweekends?\b/.test(t) ? '0,6' : days.size ? [...days].sort((a, b) => a - b).join(',') : '';
    const recurring = /\b(every|each|daily|nightly|weekly|monthly|weekdays?|weekends?)\b/.test(t) || /\b(sun|mon|tues|wednes|thurs|fri|satur)days\b/.test(t);
    if (recurring) {
      if (everyNDays) { const n = +everyNDays[1]; if (n < 1 || n > 31) throw new Error('day interval must be 1-31'); return { cron: `${mi} ${h} */${n} * *` }; }
      if (/\b(monthly|every month|each month)\b/.test(t)) { const d = /\b(\d{1,2})(st|nd|rd|th)\b/.exec(t)?.[1] || /\bon\s+(?:the\s+)?(\d{1,2})\b/.exec(t)?.[1] || 1; if (+d < 1 || +d > 31) throw new Error('day of month must be 1-31'); return { cron: `${mi} ${h} ${+d} * *` }; }
      if (/\b(weekly|every week|each week)\b/.test(t) && !dow) dow = '1';
      return { cron: `${mi} ${h} * * ${dow || '*'}` };
    }
    const at = new Date(); at.setSeconds(0, 0);
    if (/\btomorrow\b/.test(t)) { at.setDate(at.getDate() + 1); at.setHours(h, mi, 0, 0); return { once: at.getTime() }; }
    if (days.size === 1) { const d = [...days][0]; at.setDate(at.getDate() + ((d - at.getDay() + 7) % 7)); at.setHours(h, mi, 0, 0); if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 7); return { once: at.getTime() }; }
    if (tm || /\b(today|tonight)\b/.test(t)) { at.setHours(h, mi, 0, 0); if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1); return { once: at.getTime() }; }
    throw new Error(`could not understand the time "${raw}". ` + HELP);
  }
  return { parse, next, upcoming, describe, fromText, HELP };
})();

/* =====================================================================
   VIRTUAL FILESYSTEM
   ===================================================================== */
class VFS {
  constructor() { this.nodes = new Map([['/', { dir: true, mtime: Date.now() }]]); this.listeners = new Set(); }
  norm(p, cwd = '/') {
    if (p == null || p === '') p = '.';
    p = String(p);
    if (p === '~') p = '/'; else if (p.startsWith('~/')) p = '/' + p.slice(2);
    const parts = (p.startsWith('/') ? p : cwd + '/' + p).split('/'); const out = [];
    for (const s of parts) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); }
    return '/' + out.join('/');
  }
  parent(p) { if (p === '/') return '/'; const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); }
  base(p) { return p === '/' ? '/' : p.slice(p.lastIndexOf('/') + 1); }
  exists(p) { return this.nodes.has(p); }
  isDir(p) { return this.nodes.get(p)?.dir === true; }
  isFile(p) { const n = this.nodes.get(p); return !!n && !n.dir; }
  stat(p) { const n = this.nodes.get(p); if (!n) throw new Error(`${p}: No such file or directory`); return { dir: !!n.dir, size: n.dir ? 4096 : n.data.length, mtime: n.mtime }; }
  mkdirp(p) { if (p === '/') return; if (this.isFile(p)) throw new Error(`${p}: Not a directory`); if (this.isDir(p)) return; this.mkdirp(this.parent(p)); this.nodes.set(p, { dir: true, mtime: Date.now() }); this.changed(); }
  mkdir(p) { if (this.exists(p)) throw new Error(`${p}: File exists`); if (!this.isDir(this.parent(p))) throw new Error(`${this.parent(p)}: No such file or directory`); this.nodes.set(p, { dir: true, mtime: Date.now() }); this.changed(); }
  readBytes(p) { const n = this.nodes.get(p); if (!n) throw new Error(`${p}: No such file or directory`); if (n.dir) throw new Error(`${p}: Is a directory`); return n.data; }
  read(p) { return dec.decode(this.readBytes(p)); }
  write(p, data, { mkdirs = false } = {}) {
    if (p === '/') throw new Error('/: Is a directory');
    const par = this.parent(p);
    if (mkdirs) this.mkdirp(par); else if (!this.isDir(par)) throw new Error(`${par}: No such file or directory`);
    if (this.isDir(p)) throw new Error(`${p}: Is a directory`);
    this.nodes.set(p, { data: typeof data === 'string' ? enc.encode(data) : data, mtime: Date.now() }); this.changed();
  }
  append(p, data) {
    const prev = this.isFile(p) ? this.readBytes(p) : new Uint8Array(); const add = typeof data === 'string' ? enc.encode(data) : data;
    const m = new Uint8Array(prev.length + add.length); m.set(prev); m.set(add, prev.length); this.write(p, m);
  }
  list(p) {
    if (!this.exists(p)) throw new Error(`${p}: No such file or directory`);
    if (!this.isDir(p)) throw new Error(`${p}: Not a directory`);
    const pre = p === '/' ? '/' : p + '/'; const out = [];
    for (const k of this.nodes.keys()) if (k !== p && k.startsWith(pre) && !k.slice(pre.length).includes('/')) out.push(k.slice(pre.length));
    return out.sort();
  }
  *walk(p) { const pre = p === '/' ? '/' : p + '/'; for (const k of [...this.nodes.keys()].sort()) if (k === p || k.startsWith(pre)) yield k; }
  rm(p, recursive = false) {
    if (p === '/') throw new Error("refusing to remove '/'");
    if (!this.exists(p)) throw new Error(`${p}: No such file or directory`);
    if (this.isDir(p)) { if (this.list(p).length && !recursive) throw new Error(`${p}: Directory not empty`); for (const k of [...this.nodes.keys()]) if (k.startsWith(p + '/')) this.nodes.delete(k); }
    this.nodes.delete(p); this.changed();
  }
  move(a, b) {
    if (!this.exists(a)) throw new Error(`${a}: No such file or directory`);
    if (this.isDir(b)) b = (b === '/' ? '' : b) + '/' + this.base(a);
    if (b === a) return; if (b.startsWith(a + '/')) throw new Error(`cannot move '${a}' into itself`);
    if (!this.isDir(this.parent(b))) throw new Error(`${this.parent(b)}: No such file or directory`);
    const moves = [...this.nodes.entries()].filter(([k]) => k === a || k.startsWith(a + '/'));
    for (const [k] of moves) this.nodes.delete(k);
    for (const [k, v] of moves) this.nodes.set(b + k.slice(a.length), v);
    this.changed();
  }
  copy(a, b, recursive = false) {
    if (!this.exists(a)) throw new Error(`${a}: No such file or directory`);
    if (this.isDir(b)) b = (b === '/' ? '' : b) + '/' + this.base(a);
    if (this.isDir(a)) {
      if (!recursive) throw new Error(`-r not specified; omitting directory '${a}'`);
      for (const k of [...this.walk(a)]) { const n = this.nodes.get(k); const t = b + k.slice(a.length); if (n.dir) this.mkdirp(t); else this.write(t, n.data.slice(), { mkdirs: true }); }
    } else this.write(b, this.readBytes(a).slice());
  }
  changed() { clearTimeout(this._t); this._t = setTimeout(() => { this.listeners.forEach(f => f()); this.persist(); }, 60); }
  persist() { if (window.__restoring) return; idb.set('vfs', [...this.nodes.entries()]); }
  async load() { const e = await idb.get('vfs'); if (Array.isArray(e) && e.length) { this.nodes = new Map(e); return true; } return false; }
  entries() { return [...this.nodes.entries()]; }
  replace(entries) { this.nodes = new Map(entries); if (!this.nodes.has('/')) this.nodes.set('/', { dir: true, mtime: Date.now() }); this.changed(); }
}
const vfs = new VFS();

const SEED = {
  '/Welcome.md': `# Welcome to the Vault

This is your second brain, jacked straight into the browser. Every note is a
markdown file in a filesystem stored on this device. Jade can read, write,
search and link them for you, and she still has the full BusyBox shell.

## Start here
- [[Markdown Reference]]: everything the editor renders
- [[Linking Notes]]: how [[wiki links]] and backlinks work
- [[Graph View]]: see your notes as a constellation
- [[Todo List]]: tap a checkbox in Read mode to tick it
- [[Inbox]]: drop quick thoughts here, then ask Jade to file them

## Ask Jade
- "Read my Inbox and turn each idea into its own linked note"
- "What links to [[Linking Notes]]?"
- "Make a Map of Content that links every note by tag"

#start
`,
  '/Inbox.md': `# Inbox

Quick capture. Ask Jade to sort these into notes.

- Look into spaced repetition for the notes in #learning
- Idea: a weekly review note every Sunday (try "schedule a weekly review every sunday at 6pm")
- [[Project Neon]] needs a plan
`,
  '/Todo List.md': `# Todo List

- [x] Open the vault
- [ ] Write a note with a [[wiki link]] in it
- [ ] Tap a missing (pink) link to create that note
- [ ] Open the [[Graph View]]
- [ ] Ask Jade to summarise the vault

#tasks
`,
  '/guides/Markdown Reference.md': `# Markdown Reference

## Text
**Bold**, _italic_, ~~strike~~, \`inline code\` and [external links](https://ollama.com).

## Lists
- Bullet
  - Nested bullet
1. Numbered
2. Items

## Tasks
- [ ] Open task
- [x] Done task

## Quote
> Wake up, samurai. We have notes to write.

## Code
\`\`\`js
const note = '[[Welcome]]'; // links inside code are ignored
console.log(note);
\`\`\`

## Table
| Syntax | Result |
| --- | --- |
| \`[[Note]]\` | link to a note |
| \`[[Note|label]]\` | link with your own label |
| \`[[Note#Heading]]\` | link to a heading |
| \`#tag\` | tag, tap it to filter |

---
Back to [[Welcome]] · #guide
`,
  '/guides/Linking Notes.md': `# Linking Notes

Type \`[[\` in the editor and pick a note from the suggestions. Links work
by note name, so you can move notes between folders without breaking them.

- Green links point at notes that exist.
- Pink links point at notes that do not exist yet. Tap one to create it.
- **Backlinks**: open the Links panel under any note to see what points to it.
- Normal markdown links to \`.md\` files count too: [the reference](Markdown%20Reference.md).

Jump to a heading with [[Markdown Reference#Tasks]], or give a link a label:
[[Graph View|the constellation]].

#guide
`,
  '/guides/Graph View.md': `# Graph View

The Graph button on the Notes screen draws every note as a node and every
link as a line. Bigger nodes have more links. Pink nodes are notes you linked
to but have not written yet.

- Tap a node to open it
- Drag to pan, pinch or scroll to zoom
- Open it from a note for the **local** graph (two hops around that note)

Related: [[Linking Notes]] · #guide
`,
  '/projects/Project Neon.md': `---
status: idea
created: ${new Date().toISOString().slice(0, 10)}
---
# Project Neon

A placeholder project so the graph has something to show. Ask Jade to
"plan Project Neon with tasks and write the plan into this note".

- Inspiration: [[Inbox]]
- Next: [[Neon Plan]]

#project #learning
`,
  '/scripts/vault-stats.js': `// Run me from the Shell tab:  node scripts/vault-stats.js
const fs = require('fs'), path = require('path');
const walk = d => fs.readdirSync(d).flatMap(n => { const p = path.join(d, n); try { return walk(p); } catch { return [p]; } });
const notes = walk('/').filter(p => p.endsWith('.md'));
let words = 0, links = 0;
for (const p of notes) { const t = fs.readFileSync(p, 'utf8'); words += (t.match(/\\S+/g) || []).length; links += (t.match(/\\[\\[[^\\]]+\\]\\]/g) || []).length; }
console.log(\`\${notes.length} notes, \${words} words, \${links} wiki links\`);
`,
};
function seedFs() { for (const [p, c] of Object.entries(SEED)) vfs.write(p, c, { mkdirs: true }); }

/* =====================================================================
   VAULT CORE — an Obsidian-style knowledge base on top of the VFS.
   Notes are .md files anywhere in the filesystem. [[wiki links]] (with
   |alias and #heading), markdown links to .md files, backlinks, #tags,
   ranked search. The index rebuilds lazily whenever any file changes.
   ===================================================================== */
const isNote = (p) => /\.(md|markdown)$/i.test(p);
const noteName = (p) => vfs.base(p).replace(/\.(md|markdown)$/i, '');
const Vault = { index: null, dirty: true, renderFrom: null };
function allNotes() {
  const out = [];
  for (const [p, n] of vfs.nodes) if (!n.dir && isNote(p) && !/\/(node_modules|\.git|\.trash)\//.test(p) && !/^\/jade\/skills\//i.test(p)) out.push(p);
  return out.sort((a, b) => a.localeCompare(b));
}
const WIKI_RE = /\[\[([^\[\]\n|#]+)(#[^\[\]\n|]*)?(?:\|([^\[\]\n]+))?\]\]/g;
const TAG_RE = /(^|[\s(\[,;])#([A-Za-z][\w\/-]*)/g;
const stripCode = (md) => String(md).replace(/^(```|~~~)[\s\S]*?^\1/gm, ' ').replace(/`[^`\n]*`/g, ' ').replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/\$(?!\s)[^$\n]+?\$/g, ' ');
const KNOWN_EXT = /\.(md|markdown|txt|js|mjs|cjs|ts|json|csv|tsv|html?|css|sh|py|ya?ml|xml|svg|log|ini|toml|png|jpe?g|gif|webp|pdf)$/i;
const nameKey = s => noteName(s).toLowerCase().replace(/[\s_\-]+/g, ' ').trim();
function resolveNote(target, fromPath) {
  let t = String(target ?? '').trim().replace(/\\/g, '/');
  if (!t) return null;
  if (!isNote(t)) t += '.md';
  const notes = Vault.index?.notes || allNotes();
  const dir = fromPath ? vfs.parent(fromPath) : '/';
  for (const cand of [vfs.norm(t, dir), vfs.norm(t, '/')]) if (vfs.isFile(cand)) return cand;
  const lc = t.toLowerCase(), base = lc.split('/').pop();
  let hits = lc.includes('/') ? notes.filter(p => p.toLowerCase().endsWith('/' + lc.replace(/^\/+/, ''))) : [];
  if (!hits.length) hits = notes.filter(p => vfs.base(p).toLowerCase() === base);
  if (!hits.length) { const k = nameKey(base); if (k) hits = notes.filter(p => nameKey(p) === k); }
  if (!hits.length) return null;
  hits.sort((a, b) => (vfs.parent(b) === dir) - (vfs.parent(a) === dir) || a.length - b.length || a.localeCompare(b));
  return hits[0];
}
function buildIndex() {
  const notes = allNotes();
  const idx = { notes, out: new Map(), back: new Map(), tags: new Map(), missing: new Map(), words: 0 };
  Vault.index = idx;
  for (const p of notes) idx.back.set(p, new Set());
  for (const p of notes) {
    let text = ''; try { text = vfs.read(p); } catch {}
    const body = stripCode(text), out = new Set(), miss = new Set();
    for (const m of body.matchAll(WIKI_RE)) {
      const r = resolveNote(m[1], p);
      if (r) { if (r !== p) { out.add(r); idx.back.get(r)?.add(p); } } else miss.add(m[1].trim());
    }
    for (const m of body.matchAll(/\]\(([^)\s]+\.(?:md|markdown))(?:#[^)]*)?\)/gi)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(m[1])) continue;
      let target; try { target = decodeURIComponent(m[1]); } catch { target = m[1]; }
      const r = resolveNote(target, p); if (r && r !== p) { out.add(r); idx.back.get(r)?.add(p); }
    }
    idx.out.set(p, out); idx.missing.set(p, miss);
    for (const m of body.matchAll(TAG_RE)) { const tag = m[2].replace(/[\/-]+$/, '').toLowerCase(); if (!tag) continue; if (!idx.tags.has(tag)) idx.tags.set(tag, new Set()); idx.tags.get(tag).add(p); }
    idx.words += (text.match(/\S+/g) || []).length;
  }
  Vault.dirty = false;
  return idx;
}
const vaultIndex = () => (Vault.dirty || !Vault.index ? buildIndex() : Vault.index);
vfs.listeners.add(() => { Vault.dirty = true; });
function noteTags(p) { const idx = vaultIndex(); return [...idx.tags.entries()].filter(([, s]) => s.has(p)).map(([t]) => t).sort(); }
function searchNotes(query, limit = 20) {
  const q = String(query ?? '').trim(); if (!q) return [];
  const idx = vaultIndex(), res = [];
  const tagQ = /^#[\w\/-]+$/.test(q) ? q.slice(1).toLowerCase() : null;
  const terms = tagQ ? [] : q.toLowerCase().split(/\s+/).filter(Boolean);
  for (const p of idx.notes) {
    let text = ''; try { text = vfs.read(p); } catch { continue; }
    const lc = text.toLowerCase(), name = noteName(p).toLowerCase(), pl = p.toLowerCase();
    if (tagQ) { const ok = [...idx.tags.entries()].some(([t, s]) => (t === tagQ || t.startsWith(tagQ + '/')) && s.has(p)); if (!ok) continue; }
    else if (!terms.every(t => lc.includes(t) || pl.includes(t))) continue;
    let score = 0, first = -1;
    for (const t of terms) {
      if (name === t) score += 30; else if (name.includes(t)) score += 12;
      let i = -1, c = 0; while ((i = lc.indexOf(t, i + 1)) >= 0 && c < 60) { if (first < 0 || i < first) first = i; c++; }
      score += c;
    }
    if (tagQ) { const i = lc.indexOf('#' + tagQ); first = i; score = 1; }
    score += Math.min(5, idx.back.get(p)?.size || 0) * 0.5;
    const s = Math.max(0, (first < 0 ? 0 : first) - 50);
    const snippet = (s ? '…' : '') + text.slice(s, s + 190).replace(/\s+/g, ' ').trim() + (text.length > s + 190 ? '…' : '');
    res.push({ path: p, score, snippet });
  }
  return res.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}
// ---- markdown: [[wiki links]] and #tags as marked extensions (used for notes AND chat replies) ----
(() => {
  if (!window.marked?.use) return;
  const wiki = {
    name: 'wikilink', level: 'inline',
    start(src) { const i = src.indexOf('[['); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^\[\[([^\[\]\n|#]+)(#[^\[\]\n|]*)?(?:\|([^\[\]\n]+))?\]\]/.exec(src);
      if (m) return { type: 'wikilink', raw: m[0], target: m[1].trim(), heading: (m[2] || '').slice(1).trim(), alias: (m[3] || '').trim() };
    },
    renderer(tok) {
      const r = resolveNote(tok.target, Vault.renderFrom);
      const label = tok.alias || (tok.heading ? `${tok.target} › ${tok.heading}` : tok.target);
      return `<a href="#" class="wiki-link${r ? '' : ' missing'}" data-wiki="${esc(tok.target)}"${tok.heading ? ` data-heading="${esc(tok.heading)}"` : ''} title="${esc(r || 'Not created yet: tap to create')}">${esc(label)}</a>`;
    },
  };
  const tag = {
    name: 'notetag', level: 'inline',
    start(src) { const m = /(^|[\s(\[,;])#[A-Za-z]/.exec(src); return m ? m.index + m[1].length : undefined; },
    tokenizer(src) { const m = /^#([A-Za-z][\w\/-]*)/.exec(src); if (m) return { type: 'notetag', raw: m[0], tag: m[1].replace(/[\/-]+$/, '') }; },
    renderer(tok) { return `<a href="#" class="tag-chip" data-tag="${esc(tok.tag.toLowerCase())}">#${esc(tok.tag)}</a>`; },
  };
  // LaTeX: $$display$$, \[display\], $inline$, \(inline\). Rendered with KaTeX after sanitising (see md()).
  const mathBlock = {
    name: 'mathBlock', level: 'block',
    start(src) { const m = /(^|\n) {0,3}(\$\$|\\\[)/.exec(src); return m ? m.index + m[1].length : undefined; },
    tokenizer(src) { const m = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src) || /^ {0,3}\\\[([\s\S]+?)\\\][ \t]*(?:\n+|$)/.exec(src); if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() }; },
    renderer(t) { return `<div class="math-tex" data-display="1" data-tex="${esc(t.text)}"></div>\n`; },
  };
  const mathInline = {
    name: 'mathInline', level: 'inline',
    start(src) { const m = /\$|\\\(/.exec(src); return m ? m.index : undefined; },
    tokenizer(src) {
      let m = /^\$\$([^$]+?)\$\$/.exec(src); if (m) return { type: 'mathInline', raw: m[0], text: m[1].trim(), display: true };
      m = /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<![\s\\])\$(?!\d)/.exec(src); if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: false };
      m = /^\\\(([\s\S]+?)\\\)/.exec(src); if (m) return { type: 'mathInline', raw: m[0], text: m[1].trim(), display: false };
    },
    renderer(t) { return `<span class="math-tex" data-display="${t.display ? 1 : 0}" data-tex="${esc(t.text)}"></span>`; },
  };
  try { marked.use({ extensions: [mathBlock, mathInline] }); } catch (e) { console.warn('math extension failed', e); }
  try { marked.use({ extensions: [wiki, tag] }); } catch (e) { console.warn('wiki link extension failed', e); }
})();

// ---- tool paths: forgiving about missing ".md", case and folders, strict about duplicates ----
const cleanPath = raw => vfs.norm(String(raw ?? '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s*\/\s*/g, '/').replace(/[ \t]+/g, ' '), '/');
function findExisting(raw) {
  const p = cleanPath(raw); if (vfs.exists(p)) return p;
  const want = [p.toLowerCase()]; if (!KNOWN_EXT.test(p)) want.push(p.toLowerCase() + '.md');
  for (const k of vfs.nodes.keys()) if (!vfs.isDir(k) && want.includes(k.toLowerCase())) return k;
  if (isNote(p) || !KNOWN_EXT.test(p)) { const r = resolveNote(String(raw ?? '').trim().replace(/^\/+/, ''), null); if (r) return r; }
  return null;
}
const readPath = raw => findExisting(raw) || cleanPath(raw);
function writePath(raw) {
  let p = cleanPath(raw); if (p === '/') throw new Error('path is required');
  const ex = findExisting(raw);
  if (ex && [p.toLowerCase(), p.toLowerCase() + '.md'].includes(ex.toLowerCase())) return ex;
  if (!KNOWN_EXT.test(p) && !vfs.isDir(p)) p += '.md';
  if (isNote(p) && !vfs.exists(p)) {
    const k = nameKey(p); const twin = vaultIndex().notes.find(q => nameKey(q) === k);
    if (twin && !/^(skill|agents|soul|system|readme|index)\.md$/i.test(vfs.base(p))) throw new Error(`A note named "${noteName(twin)}" already exists at ${twin}. Do not create a duplicate: read ${twin} and use edit to change it, or write to exactly "${twin}" to replace it. If you really need a separate note, pick a clearly different name.`);
  }
  return p;
}

function renderTex(el) {
  const tex = el.dataset.tex || '', disp = el.dataset.display === '1';
  if (window.katex) { try { el.innerHTML = katex.renderToString(tex, { displayMode: disp, throwOnError: false, strict: 'ignore', trust: false, maxExpand: 500 }); el.classList.add('math-ok'); return; } catch (e) { el.title = e.message; } }
  el.textContent = disp ? `$$${tex}$$` : `$${tex}$`; el.classList.add('math-raw');
}

/* =====================================================================
   BUSYBOX WASM (runs in a module worker via @bjorn3/browser_wasi_shim)
   ===================================================================== */
/* BusyBox 1.37 (Emscripten build) is embedded in this page as gzip+base64.
   Every command gets a fresh BusyBox instance (≈ms) seeded from the VFS; the FS is copied back after.
   Host: a classic blob worker (preferred: real timeouts), else the main thread. */
const BB_CORE = `
async function __bbExec(BusyBoxModule, MOD, d) {
  const { args, stdin, entries, cwd } = d;
  const SYS = new Set(['/dev', '/proc']);
  const inp = new TextEncoder().encode(stdin || ''); let ip = 0; const out = [], err = [];
  const M = await BusyBoxModule({
    noInitialRun: true, thisProgram: 'busybox',
    instantiateWasm(imports, cb) { WebAssembly.instantiate(MOD, imports).then(i => cb(i, MOD)); return {}; },
    stdin: () => ip < inp.length ? inp[ip++] : null,
    stdout: c => { if (c != null) out.push(c); }, stderr: c => { if (c != null) err.push(c); },
    print: () => {}, printErr: () => {},
  });
  const FS = M.FS; const defaults = new Set();
  // stdio is already open, so Emscripten's /dev, /proc and /home can go: they would leak into
  // the agent's filesystem and make grep -r / find hang on /dev/urandom
  const nuke = (q) => { let st; try { st = FS.lstat(q); } catch { return; } if (FS.isDir(st.mode)) { let kids = []; try { kids = FS.readdir(q); } catch {} for (const n of kids) if (n !== '.' && n !== '..') nuke(q + '/' + n); try { FS.rmdir(q); } catch {} } else { try { FS.unlink(q); } catch {} } };
  if (!entries.some(([p]) => p === '/home' || p.startsWith('/home/'))) nuke('/home');
  for (const q of ['/proc/self/fd', '/proc/self', '/proc']) { try { FS.rmdir(q); } catch {} }
  nuke('/dev');
  if (!entries.some(([p]) => p === '/tmp' || p.startsWith('/tmp/'))) { try { FS.rmdir('/tmp'); } catch {} }
  const scan = (dir) => { for (const n of FS.readdir(dir)) { if (n === '.' || n === '..') continue; const q = (dir === '/' ? '' : dir) + '/' + n; if (SYS.has(q)) continue; defaults.add(q); if (FS.isDir(FS.stat(q).mode)) scan(q); } };
  scan('/');
  const orig = new Set();
  for (const [p, n] of entries) { if (p === '/') continue; orig.add(p); if (n.dir) { try { FS.mkdirTree(p); } catch {} } else { try { FS.mkdirTree(p.slice(0, p.lastIndexOf('/')) || '/'); } catch {} FS.writeFile(p, n.data); } }
  try { FS.mkdirTree(cwd); } catch {} FS.chdir(cwd);
  let code = 0;
  try { code = M.callMain(args) ?? 0; } catch (x) { code = typeof x?.status === 'number' ? x.status : 134; if (typeof x?.status !== 'number') err.push(...new TextEncoder().encode(String(x?.message || x) + '\\n')); }
  const res = [['/', { dir: true }]];
  const walk = (dir) => { for (const n of FS.readdir(dir)) { if (n === '.' || n === '..') continue; const q = (dir === '/' ? '' : dir) + '/' + n; if (SYS.has(q)) continue; let st; try { st = FS.lstat(q); } catch { continue; } if (FS.isDir(st.mode)) { res.push([q, { dir: true }]); walk(q); } else if (FS.isFile(st.mode)) res.push([q, { data: FS.readFile(q) }]); } };
  walk('/');
  // drop Emscripten's own empty default dirs unless the VFS had them or something was written inside
  const keep = res.filter(([p, n]) => !(n.dir && defaults.has(p) && !orig.has(p) && !res.some(([q]) => q.startsWith(p + '/') && !(defaults.has(q) && !orig.has(q)))));
  return { ok: true, out: new Uint8Array(out), err: new Uint8Array(err), code, entries: keep };
}`;
const BB_WORKER_TAIL = `
let __MOD = null;
self.onmessage = async (e) => {
  const d = e.data;
  if (d.type === 'init') {
    try { __MOD = await WebAssembly.compile(d.wasm); self.postMessage({ type: 'ready' }); }
    catch (x) { self.postMessage({ type: 'fail', error: 'WebAssembly compile in worker: ' + (x?.message || x) }); }
    return;
  }
  try { const r = await __bbExec(BusyBoxModule, __MOD, d); r.id = d.id; self.postMessage(r); }
  catch (x) { self.postMessage({ id: d.id, ok: false, error: String(x?.message || x) }); }
};`;
const bb = { module: null, applets: new Set(), name: '', glue: '', wasm: null, host: '', mainFns: null };
let bbWorker = null, bbWorkerUrl = null, bbSeq = 0; const bbPending = new Map();
async function gunzipB64(id) {
  const b64 = document.getElementById(id).textContent.replace(/\s+/g, '');
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
// Emscripten glue as a classic script: no ES export, no import.meta (blob/opaque origins can't resolve it anyway)
const classicGlue = () => bb.glue.replace(/export\s+default\s+BusyBoxModule\s*;?\s*$/, '').replace(/import\.meta\.url/g, '"about:blank"');
function bbSpawn() {
  bbWorkerUrl ??= URL.createObjectURL(new Blob([classicGlue() + '\n' + BB_CORE + '\n' + BB_WORKER_TAIL], { type: 'text/javascript' }));
  let w;
  const ready = new Promise((res, rej) => {
    try { w = new Worker(bbWorkerUrl); } catch (e) { return rej(new Error(`new Worker() refused: ${e.message}`)); }
    const t = setTimeout(() => rej(new Error('worker did not answer within 10s')), 10000);
    w.onmessage = e => { if (e.data.type === 'ready') { clearTimeout(t); w.onmessage = bbOnMessage; res(); } else if (e.data.type === 'fail') { clearTimeout(t); rej(new Error(e.data.error)); } };
    w.onerror = e => { clearTimeout(t); e.preventDefault?.(); rej(new Error(e.message ? `${e.message}${e.lineno ? ` (line ${e.lineno})` : ''}` : 'worker script was blocked or failed to load')); };
    w.onmessageerror = () => { clearTimeout(t); rej(new Error('worker message could not be cloned')); };
    w.postMessage({ type: 'init', wasm: bb.wasm });
  });
  bbWorker = { get w() { return w; }, ready };
}
function bbOnMessage(e) { const p = bbPending.get(e.data.id); if (p) { bbPending.delete(e.data.id); p(e.data); } }
async function loadMainThreadHost() {
  // 1) Function constructor (needs eval permission)  2) blob <script> tag (needs blob: in script-src)
  const src = classicGlue() + '\n' + BB_CORE;
  try { const f = new Function(src + '\nreturn { BusyBoxModule, __bbExec };'); return f(); } catch (e1) {
    const url = URL.createObjectURL(new Blob([src + '\nwindow.__bbHost = { BusyBoxModule, __bbExec };'], { type: 'text/javascript' }));
    await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = url; sc.onload = res; sc.onerror = () => rej(new Error(`eval blocked (${e1.message}) and blob scripts blocked`)); document.head.appendChild(sc); });
    if (!window.__bbHost) throw new Error('glue loaded but did not define BusyBoxModule');
    return window.__bbHost;
  }
}
const entriesForBb = () => vfs.entries().map(([p, n]) => [p, n.dir ? { dir: true } : { data: n.data }]);
async function bbRun(args, stdin = '', timeoutMs = 30000, cwd = '/') {
  if (bb.host === 'main') {
    try { return await Promise.race([bb.mainFns.__bbExec(bb.mainFns.BusyBoxModule, bb.module, { args, stdin, entries: entriesForBb(), cwd }), sleep(timeoutMs).then(() => ({ ok: false, timeout: true, error: `timed out after ${timeoutMs / 1000}s` }))]); }
    catch (e) { return { ok: false, error: String(e?.message || e) }; }
  }
  if (!bbWorker) bbSpawn();
  try { await bbWorker.ready; } catch (e) { bbWorker = null; return { ok: false, error: e.message }; }
  const id = ++bbSeq; const w = bbWorker.w;
  return new Promise(resolve => {
    const t = setTimeout(() => { bbPending.delete(id); w.terminate(); if (bbWorker?.w === w) bbWorker = null; for (const [, r] of bbPending) r({ ok: false, error: 'worker restarted' }); bbPending.clear(); resolve({ ok: false, timeout: true, error: `timed out after ${timeoutMs / 1000}s` }); }, timeoutMs);
    bbPending.set(id, r => { clearTimeout(t); resolve(r); });
    w.postMessage({ id, args, stdin, entries: entriesForBb(), cwd });
  });
}
function applyBbEntries(entries) {
  const next = new Map(); let changed = false;
  for (const [p, n] of entries) {
    const old = vfs.nodes.get(p);
    if (n.dir) next.set(p, old?.dir ? old : (changed = true, { dir: true, mtime: Date.now() }));
    else { const same = old && !old.dir && old.data.length === n.data.length && old.data.every((b, i) => b === n.data[i]); if (!same) changed = true; next.set(p, same ? old : { data: n.data, mtime: Date.now() }); }
  }
  if (changed || next.size !== vfs.nodes.size) vfs.replace([...next.entries()]);
}
async function loadEmbeddedBusybox() {
  const fail = [];
  try {
    const [wasm, glue] = await Promise.all([gunzipB64('bb-wasm'), gunzipB64('bb-glue')]);
    bb.wasm = wasm; bb.glue = dec.decode(glue); bb.module = await WebAssembly.compile(wasm); bb.name = 'BusyBox 1.37 (embedded)';
  } catch (e) { bb.module = null; updateShellChip(); toast(`BusyBox WASM could not be unpacked: ${esc(e.message)}. Using JS applets.`, 'err'); return; }
  const tryList = async () => { const r = await bbRun(['--list'], '', 20000); if (!r.ok) throw new Error(r.error); bb.applets = new Set(dec.decode(r.out).split(/\s+/).filter(Boolean)); if (!bb.applets.size) throw new Error('busybox --list returned nothing'); };
  try { bb.host = 'worker'; await tryList(); }
  catch (e) {
    fail.push('worker: ' + e.message); console.warn('BusyBox worker host failed', e);
    try { bb.mainFns = await loadMainThreadHost(); bb.host = 'main'; await tryList(); toast('BusyBox WASM is running on the main thread (workers are blocked here), so long commands can briefly freeze the page.'); }
    catch (e2) { fail.push('main thread: ' + e2.message); console.warn('BusyBox main-thread host failed', e2); bb.module = null; bb.host = ''; toast(`BusyBox WASM failed to start. ${esc(fail.join(' · '))}. Using JS applets.`, 'err'); }
  }
  updateShellChip();
}
function concat(chunks) { const n = chunks.reduce((a, c) => a + c.length, 0); const m = new Uint8Array(n); let o = 0; for (const c of chunks) { m.set(c, o); o += c.length; } return m; }

/* =====================================================================
   SHELL — small POSIX-ish shell; applets from BusyBox WASM or JS
   ===================================================================== */
function tokenize(s) {
  const toks = []; let i = 0, w = null;
  const lit = (v, q) => { w ??= []; const l = w[w.length - 1]; if (l && l.t === 'lit' && l.q === q) l.v += v; else w.push({ t: 'lit', v, q }); };
  const end = () => { if (w) { toks.push({ t: 'w', segs: w }); w = null; } };
  const readVar = (q) => {
    const n = s[i + 1]; w ??= [];
    if (n === '(') { let d = 0, j = i + 1; for (; j < s.length; j++) { if (s[j] === '(') d++; else if (s[j] === ')') { d--; if (!d) break; } } if (j >= s.length) throw new Error('unterminated $('); w.push({ t: 'sub', v: s.slice(i + 2, j), q }); i = j + 1; return; }
    if (n === '{') { const j = s.indexOf('}', i); if (j < 0) throw new Error('bad substitution'); w.push({ t: 'var', v: s.slice(i + 2, j), q }); i = j + 1; return; }
    const m = /^([A-Za-z_]\w*|[?$#0-9])/.exec(s.slice(i + 1));
    if (m) { w.push({ t: 'var', v: m[1], q }); i += 1 + m[1].length; return; }
    lit('$', q); i++;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { if (s[i + 1] === '\n') { i += 2; continue; } lit(s[i + 1] ?? '', true); i += 2; continue; }
    if (c === "'") { const j = s.indexOf("'", i + 1); if (j < 0) throw new Error('unterminated quote'); w ??= []; lit(s.slice(i + 1, j), true); i = j + 1; continue; }
    if (c === '"') {
      i++; w ??= []; lit('', true);
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && '"\\$`'.includes(s[i + 1])) { lit(s[i + 1], true); i += 2; }
        else if (s[i] === '$') readVar(true); else { lit(s[i], true); i++; }
      }
      if (s[i] !== '"') throw new Error('unterminated quote'); i++; continue;
    }
    if (c === '$') { readVar(false); continue; }
    if (c === ' ' || c === '\t' || c === '\r') { end(); i++; continue; }
    if (c === '\n') { end(); toks.push({ t: 'op', v: ';' }); i++; continue; }
    if (c === '#' && !w) { while (i < s.length && s[i] !== '\n') i++; continue; }
    const m = /^(2>&1|&>|2>>|2>|>>|>&2|1>|>|<|&&|\|\||\||;|&)/.exec(s.slice(i));
    if (m && !(w && m[1].startsWith('2'))) { end(); toks.push({ t: 'op', v: m[1] }); i += m[1].length; continue; }
    lit(c, false); i++;
  }
  end(); return toks;
}
function parse(toks) {
  const list = []; let pipeline = [], cmd = { words: [], redirs: [] };
  const endCmd = () => { if (cmd.words.length || cmd.redirs.length) pipeline.push(cmd); cmd = { words: [], redirs: [] }; };
  const endPipe = op => { endCmd(); if (pipeline.length) list.push({ pipeline, op }); else if (op === '&&' || op === '||') throw new Error(`syntax error near '${op}'`); pipeline = []; };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'w') { cmd.words.push(t.segs); continue; }
    switch (t.v) {
      case '|': endCmd(); break;
      case '&&': case '||': case ';': case '&': endPipe(t.v === '&' ? ';' : t.v); break;
      case '2>&1': case '>&2': cmd.redirs.push({ op: t.v }); break;
      default: { const tgt = toks[++k]; if (!tgt || tgt.t !== 'w') throw new Error(`syntax error near '${t.v}'`); cmd.redirs.push({ op: t.v === '1>' ? '>' : t.v, target: tgt.segs }); }
    }
  }
  endPipe(';'); return list;
}
const GLOB_ESC = '\u0001';
function globToRe(pat, { anchored = true } = {}) {
  let r = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === GLOB_ESC) { r += pat[++i].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); continue; }
    if (c === '*') r += '[^/]*'; else if (c === '?') r += '[^/]';
    else if (c === '[') { const j = pat.indexOf(']', i + 1); if (j > i) { let cls = pat.slice(i + 1, j); if (cls[0] === '!') cls = '^' + cls.slice(1); r += '[' + cls.replace(/\\/g, '\\\\') + ']'; i = j; } else r += '\\['; }
    else r += c.replace(/[.+^${}()|\\/\]]/g, '\\$&');
  }
  return new RegExp(anchored ? '^' + r + '$' : r);
}

class Shell {
  constructor({ cwd = '/', env = {}, onOutput = null } = {}) { this.cwd = cwd; this.env = { HOME: '/', USER: 'pi', SHELL: '/bin/sh', PATH: '/bin', ...env }; this.lastCode = 0; this.onOutput = onOutput; this.aborted = false; this.timeoutMs = 60000; }
  getVar(n) { if (n === '?') return String(this.lastCode); if (n === '$') return '1337'; if (n === '#') return '0'; if (n === '0') return 'sh'; if (n === 'PWD') return this.cwd; return this.env[n] ?? ''; }
  async expandWord(segs) {
    let s = '', glob = false;
    const escG = v => v.replace(/[*?[\]]/g, m => GLOB_ESC + m);
    for (const g of segs) {
      if (g.t === 'lit') { if (g.q) s += escG(g.v); else { s += g.v; if (/[*?[]/.test(g.v)) glob = true; } }
      else if (g.t === 'var') s += escG(this.getVar(g.v));
      else if (g.t === 'sub') { const r = await this.capture(g.v); s += escG(r.replace(/\n+$/, '')); }
    }
    if (glob) { const m = this.glob(s); if (m.length) return m; }
    return [s.replaceAll(GLOB_ESC, '')];
  }
  glob(pat) {
    const abs = pat.startsWith('/'); const absPat = vfs.norm(pat.replaceAll(GLOB_ESC, '\u0002'), this.cwd).replaceAll('\u0002', GLOB_ESC);
    const re = globToRe(absPat); const showDot = /(^|\/)\./.test(pat.replaceAll(GLOB_ESC, ''));
    const out = [];
    for (const p of vfs.nodes.keys()) { if (p === '/' || !re.test(p)) continue; if (!showDot && /\/\.[^/]*$/.test(p)) continue; out.push(p); }
    out.sort();
    if (abs) return out;
    const pre = this.cwd === '/' ? '/' : this.cwd + '/';
    return out.map(p => p.startsWith(pre) ? p.slice(pre.length) : p);
  }
  async capture(src) { const sub = new Shell({ cwd: this.cwd, env: { ...this.env } }); sub.timeoutMs = this.timeoutMs; const r = await sub.run(src); return r.chunks.filter(c => !c.err).map(c => c.s).join(''); }
  /** run a script; returns {chunks:[{s,err}], code} */
  async run(src, { stdin = '' } = {}) {
    const chunks = []; const emit = (s, err = false) => { if (!s) return; chunks.push({ s, err }); this.onOutput?.(s, err); };
    let list;
    try { list = parse(tokenize(src)); } catch (e) { emit(`sh: ${e.message}\n`, true); this.lastCode = 2; return { chunks, code: 2 }; }
    let prevOp = ';';
    for (const item of list) {
      if (this.aborted) { emit('^C\n', true); this.lastCode = 130; break; }
      if ((prevOp === '&&' && this.lastCode !== 0) || (prevOp === '||' && this.lastCode === 0)) { prevOp = item.op; continue; }
      try { this.lastCode = await this.runPipeline(item.pipeline, stdin, emit); }
      catch (e) { if (e && e.__exit !== undefined) { this.lastCode = e.__exit; break; } emit(`sh: ${e.message}\n`, true); this.lastCode = 1; }
      prevOp = item.op;
    }
    return { chunks, code: this.lastCode };
  }
  async runPipeline(pipeline, stdin, emit) {
    let input = stdin, code = 0;
    for (let k = 0; k < pipeline.length; k++) {
      const cmd = pipeline[k]; const last = k === pipeline.length - 1;
      const argv = []; for (const w of cmd.words) argv.push(...await this.expandWord(w));
      let inp = k === 0 ? input : input;
      let outTo = null, errTo = null, mergeErr = false, outToErr = false;
      for (const r of cmd.redirs) {
        if (r.op === '2>&1') { mergeErr = true; continue; }
        if (r.op === '>&2') { outToErr = true; continue; }
        const t = (await this.expandWord(r.target))[0];
        const p = t === '/dev/null' ? null : vfs.norm(t, this.cwd);
        if (r.op === '<') { if (t === '/dev/null') inp = ''; else inp = vfs.read(p); }
        else if (r.op === '>' || r.op === '>>') outTo = { p, append: r.op === '>>', dn: t === '/dev/null' };
        else if (r.op === '2>' || r.op === '2>>') errTo = { p, append: r.op === '2>>', dn: t === '/dev/null' };
        else if (r.op === '&>') { outTo = { p, append: false, dn: t === '/dev/null' }; mergeErr = true; }
      }
      if (outTo && !outTo.dn) { if (outTo.append) { if (!vfs.exists(outTo.p)) vfs.write(outTo.p, ''); } else vfs.write(outTo.p, ''); }
      const r = await this.exec(argv, inp ?? '');
      let out = r.out || '', err = r.err || '';
      if (mergeErr) { out += err; err = ''; }
      if (outToErr) { err += out; out = ''; }
      if (errTo) { if (!errTo.dn) (errTo.append ? vfs.append(errTo.p, err) : vfs.write(errTo.p, err)); err = ''; }
      if (outTo) { if (!outTo.dn) vfs.append(outTo.p, out); out = ''; }
      if (err) emit(err, true);
      if (last) emit(out); else input = out;
      code = r.code;
    }
    return code;
  }
  async exec(argv, stdin) {
    // VAR=value prefixes
    while (argv.length && /^[A-Za-z_]\w*=/.test(argv[0])) { const a = argv.shift(); const i = a.indexOf('='); this.env[a.slice(0, i)] = a.slice(i + 1); }
    if (!argv.length) return { out: '', err: '', code: 0 };
    let [name, ...args] = argv;
    if (name === 'busybox' && args.length && !args[0].startsWith('-')) { name = args.shift(); }
    const ctx = { argv: args, stdin, sh: this, outS: '', errS: '', o(s) { this.outS += s; }, e(s) { this.errS += s; }, P: p => vfs.norm(p, this.cwd), name };
    const fin = code => ({ out: ctx.outS, err: ctx.errS, code: code ?? 0 });
    try {
      if (BUILTINS[name]) return fin(await BUILTINS[name](ctx));
      const engine = S.engine;
      const useWasm = bb.module && bb.applets.has(name) && engine !== 'js' && !JS_ONLY.has(name);
      if (useWasm) {
        const r = await this.execWasm(name, args, stdin);
        // this BusyBox build trims some options (e.g. find -type): retry with the JS applet in auto mode
        if (r.code !== 0 && engine === 'auto' && APPLETS[name] && /unrecognized|invalid option|unknown option|not implemented/i.test(r.err)) return fin(await APPLETS[name](ctx));
        return r;
      }
      if (engine === 'wasm' && !JS_ONLY.has(name)) {
        if (!bb.module) return { out: '', err: `sh: ${name}: BusyBox WASM is not loaded (Config → BusyBox WASM)\n`, code: 127 };
        return { out: '', err: `sh: ${name}: applet not found in this BusyBox build\n`, code: 127 };
      }
      if (APPLETS[name]) return fin(await APPLETS[name](ctx));
      if (bb.module && bb.applets.has(name)) return await this.execWasm(name, args, stdin);
      if (vfs.isFile(vfs.norm(name, this.cwd)) && /\.(sh)$/.test(name)) return fin(await BUILTINS.sh({ ...ctx, argv: [name, ...args] }));
      return { out: '', err: `sh: ${name}: not found\n`, code: 127 };
    } catch (e) {
      if (e && e.__exit !== undefined) throw e;
      return { out: ctx.outS, err: ctx.errS + `${name}: ${e.message}\n`, code: 1 };
    }
  }
  async execWasm(name, args, stdin) {
    const r = await bbRun([name, ...args], stdin, this.timeoutMs, this.cwd);
    if (!r.ok) return { out: '', err: `busybox ${name}: ${r.error}
`, code: r.timeout ? 124 : 126 };
    applyBbEntries(r.entries);
    return { out: dec.decode(r.out), err: dec.decode(r.err), code: r.code };
  }
}

/* ---------- helpers for applets ---------- */
function opts(args, spec = '') {
  const takes = new Set([...spec.matchAll(/(\w):/g)].map(m => m[1])); const f = {}; const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { rest.push(...args.slice(i + 1)); break; }
    if (/^-\d+$/.test(a) && takes.has('n')) { f.n = a.slice(1); continue; }
    if (a.startsWith('--') && a.length > 2) { const [k, v] = a.slice(2).split('='); f[k] = v ?? true; continue; }
    if (a.startsWith('-') && a.length > 1) { for (let j = 1; j < a.length; j++) { const ch = a[j]; if (takes.has(ch)) { f[ch] = a.slice(j + 1) || args[++i]; break; } f[ch] = true; } continue; }
    rest.push(a);
  }
  return { f, rest };
}
function inputs(c, files) {
  if (!files.length) return [{ name: '-', text: c.stdin }];
  return files.map(fn => { if (fn === '-') return { name: '-', text: c.stdin }; try { return { name: fn, text: vfs.read(c.P(fn)) }; } catch (e) { c.e(`${c.name}: ${e.message}\n`); return null; } }).filter(Boolean);
}
const splitLines = t => { if (!t) return []; const l = t.split('\n'); if (l[l.length - 1] === '') l.pop(); return l; };
function breToJs(p) { // POSIX basic regex → JS
  let r = ''; for (let i = 0; i < p.length; i++) { const c = p[i];
    if (c === '\\' && i + 1 < p.length) { const n = p[++i]; if ('(){}|+?'.includes(n)) r += n; else r += '\\' + n; }
    else if ('(){}|+?'.includes(c)) r += '\\' + c; else r += c; }
  return r;
}
const fmtSize = n => n < 1024 ? n + '' : n < 1048576 ? (n / 1024).toFixed(1) + 'K' : (n / 1048576).toFixed(1) + 'M';
const MON = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const fmtDate = t => { const d = new Date(t); return `${MON[d.getMonth()]} ${String(d.getDate()).padStart(2)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/* ---------- builtins (always JS) ---------- */
const JS_ONLY = new Set(['node', 'js', 'preview', 'clear', 'help', 'sh', 'bash', 'xargs', 'open', 'links', 'backlinks', 'tags', 'search', 'today', 'mcp', 'python', 'python3', 'micropython', 'pip', 'pip3']);
const BUILTINS = {
  cd(c) { const t = c.P(c.argv[0] ?? '/'); if (!vfs.isDir(t)) { c.e(`cd: ${c.argv[0]}: No such directory\n`); return 1; } c.sh.cwd = t; return 0; },
  pwd(c) { c.o(c.sh.cwd + '\n'); return 0; },
  export(c) { for (const a of c.argv) { const i = a.indexOf('='); if (i > 0) c.sh.env[a.slice(0, i)] = a.slice(i + 1); } return 0; },
  unset(c) { for (const a of c.argv) delete c.sh.env[a]; return 0; },
  exit(c) { throw { __exit: parseInt(c.argv[0] ?? '0') || 0 }; },
  true: () => 0, false: () => 1, ':': () => 0,
  async sh(c) {
    const { f, rest } = opts(c.argv, 'c:');
    const sub = new Shell({ cwd: c.sh.cwd, env: { ...c.sh.env } }); sub.timeoutMs = c.sh.timeoutMs;
    let src = f.c; if (src == null) { if (!rest.length) { src = c.stdin; } else src = vfs.read(c.P(rest[0])); }
    const r = await sub.run(src);
    for (const ch of r.chunks) ch.err ? c.e(ch.s) : c.o(ch.s);
    return r.code;
  },
  get bash() { return this.sh; },
  source(c) { return BUILTINS.sh(c); },
  which(c) { let code = 0; for (const a of c.argv) { if (BUILTINS[a] || APPLETS[a] || bb.applets.has(a)) c.o(`/bin/${a}\n`); else code = 1; } return code; },
  type(c) { for (const a of c.argv) c.o(BUILTINS[a] ? `${a} is a shell builtin\n` : (bb.applets.has(a) && S.engine !== 'js') ? `${a} is /bin/${a} (busybox.wasm)\n` : APPLETS[a] ? `${a} is /bin/${a} (js applet)\n` : `${a}: not found\n`); return 0; },
  clear() { term.clear(); return 0; },
  help(c) {
    const names = new Set([...Object.keys(BUILTINS), ...Object.keys(APPLETS), ...bb.applets]);
    c.o(`Jade Vault shell — ${bb.module ? `BusyBox WASM (${bb.applets.size} applets) + JS` : 'JS applets'}\n` +
        `Supports: pipes |, redirects > >> < 2> 2>&1 &>, && || ;, $VAR, $(cmd), globs * ? [..]\n` +
        `No loops/if blocks: use node or python for scripting. Extra: node, python (MicroPython), xargs.\nVault: open <note>, links [note], backlinks <note>, tags [tag], search <words|#tag>, today.\nMCP: mcp list | add <name> <url> | remove | reconnect | tools [server] | call <tool> '<json>'.\n\n` +
        [...names].sort().join('  ') + '\n'); return 0;
  },
  async xargs(c) {
    const { f, rest } = opts(c.argv, 'n:I:');
    const items = c.stdin.split(/\s+/).filter(Boolean); const cmd = rest.length ? rest : ['echo'];
    const runOne = async argv => { const r = await c.sh.exec([...argv], ''); c.o(r.out); c.e(r.err); return r.code; };
    let code = 0;
    if (f.I) { for (const it of c.stdin.split('\n').filter(Boolean)) code = (await runOne(cmd.map(a => a.replaceAll(f.I, it)))) || code; }
    else { const n = parseInt(f.n) || items.length || 1; for (let i = 0; i < Math.max(items.length, 1); i += n) code = (await runOne([...cmd, ...items.slice(i, i + n)])) || code; }
    return code;
  },
  async node(c) { return runNode(c); },
  get js() { return this.node; },
  open(c) {
    const a = c.argv.find(x => !x.startsWith('-')); if (!a) { c.e('usage: open <note name or path> [-e|-r]\n'); return 1; }
    const p = vfs.isFile(c.P(a)) ? c.P(a) : resolveNote(a, null);
    if (!p) { c.e(`open: ${a}: no such note (create it with: touch "${a}.md")\n`); return 1; }
    openFile(p, { mode: c.argv.includes('-e') ? 'edit' : c.argv.includes('-r') ? 'read' : undefined }); c.o(`Opened ${p}\n`); return 0;
  },
  get preview() { return this.open; },
  links(c) {
    const a = c.argv[0]; const p = a ? (vfs.isFile(c.P(a)) ? c.P(a) : resolveNote(a, null)) : null;
    const idx = vaultIndex();
    if (!a) { let n = 0; for (const [q, set] of idx.out) for (const t of set) { c.o(`${q} -> ${t}\n`); n++; } for (const [q, set] of idx.missing) for (const m of set) c.o(`${q} -> [[${m}]] (missing)\n`); if (!n) c.o('no links yet\n'); return 0; }
    if (!p) { c.e(`links: ${a}: no such note\n`); return 1; }
    for (const t of idx.out.get(p) || []) c.o(`-> ${t}\n`); for (const m of idx.missing.get(p) || []) c.o(`-> [[${m}]] (missing)\n`);
    for (const t of idx.back.get(p) || []) c.o(`<- ${t}\n`); return 0;
  },
  backlinks(c) {
    const a = c.argv[0]; if (!a) { c.e('usage: backlinks <note>\n'); return 1; }
    const p = vfs.isFile(c.P(a)) ? c.P(a) : resolveNote(a, null); if (!p) { c.e(`backlinks: ${a}: no such note\n`); return 1; }
    for (const t of vaultIndex().back.get(p) || []) c.o(t + '\n'); return 0;
  },
  tags(c) {
    const idx = vaultIndex(); const a = (c.argv[0] || '').replace(/^#/, '').toLowerCase();
    if (a) { for (const p of [...(idx.tags.get(a) || [])].sort()) c.o(p + '\n'); return idx.tags.has(a) ? 0 : 1; }
    for (const [t, set] of [...idx.tags].sort((x, y) => y[1].size - x[1].size || x[0].localeCompare(y[0]))) c.o(`#${t}\t${set.size}\n`); return 0;
  },
  search(c) {
    const q = c.argv.join(' '); if (!q) { c.e('usage: search <words | #tag>\n'); return 1; }
    const r = searchNotes(q, 30); for (const h of r) c.o(`${h.path}\n  ${h.snippet}\n`); if (!r.length) c.o('no matches\n'); return r.length ? 0 : 1;
  },
  today(c) { openToday(); c.o(`Opened /daily/${todayStr()}.md\n`); return 0; },
  async python(c) { return runPython(c); },
  get python3() { return this.python; },
  get micropython() { return this.python; },
  pip(c) { c.e('pip is not available: MicroPython runs in the browser and has no package installer. Use its standard library (json, re, math, random, collections, os, time, hashlib, struct, binascii, heapq, io).\n'); return 1; },
  get pip3() { return this.pip; },
  async mcp(c) { try { return await mcpShell(c); } catch (e) { c.e(`mcp: ${e.message}\n`); return 1; } },
};

/* ---------- JS applets (fallback when BusyBox WASM isn't loaded) ---------- */
const APPLETS = {
  echo(c) { let a = c.argv, nl = true, esc_ = false; while (a.length && /^-[neE]+$/.test(a[0])) { if (a[0].includes('n')) nl = false; if (a[0].includes('e')) esc_ = true; a = a.slice(1); } let s = a.join(' '); if (esc_) s = s.replace(/\\(n|t|\\|e|r)/g, (m, x) => ({ n: '\n', t: '\t', '\\': '\\', e: '\x1b', r: '\r' }[x])); c.o(s + (nl ? '\n' : '')); return 0; },
  printf(c) { const [fmt = '', ...args] = c.argv; let i = 0; const s = fmt.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/%(-?\d*)([sdif%])/g, (m, w, t) => { if (t === '%') return '%'; let v = args[i++] ?? ''; if (t === 'd' || t === 'i') v = String(parseInt(v) || 0); else if (t === 'f') v = String(parseFloat(v) || 0); const n = parseInt(w); return isNaN(n) ? v : n < 0 ? v.padEnd(-n) : v.padStart(n); }); c.o(s); return 0; },
  cat(c) { const { f, rest } = opts(c.argv); let n = 1; for (const x of inputs(c, rest)) { if (f.n) c.o(splitLines(x.text).map(l => `${String(n++).padStart(6)}\t${l}`).join('\n') + '\n'); else c.o(x.text); } return c.errS ? 1 : 0; },
  ls(c) {
    const { f, rest } = opts(c.argv); const targets = rest.length ? rest : ['.']; let code = 0; const multi = targets.length > 1 || f.R;
    const line = (p, name) => { const st = vfs.stat(p); return f.l ? `${st.dir ? 'drwxr-xr-x' : '-rw-r--r--'} 1 pi pi ${(f.h ? fmtSize(st.size) : String(st.size)).padStart(7)} ${fmtDate(st.mtime)} ${name}${st.dir && f.F !== false ? '/' : ''}` : name + (st.dir ? '/' : ''); };
    const doDir = (p, label) => {
      let names = vfs.list(p); if (!f.a && !f.A) names = names.filter(n => !n.startsWith('.'));
      if (f.t) names.sort((a, b) => vfs.stat(vfs.norm(b, p)).mtime - vfs.stat(vfs.norm(a, p)).mtime);
      if (f.r) names.reverse();
      if (multi) c.o(`${label}:\n`);
      if (f.l) c.o(`total ${names.length}\n`);
      for (const n of names) c.o(line(vfs.norm(n, p), n) + '\n');
      if (f.R) for (const n of names) { const q = vfs.norm(n, p); if (vfs.isDir(q)) { c.o('\n'); doDir(q, label === '.' ? './' + n : label.replace(/\/$/, '') + '/' + n); } }
    };
    for (const t of targets) { const p = c.P(t); if (!vfs.exists(p)) { c.e(`ls: ${t}: No such file or directory\n`); code = 1; continue; } if (vfs.isDir(p) && !f.d) doDir(p, t); else c.o(line(p, t) + '\n'); if (multi && !f.R) c.o('\n'); }
    return code;
  },
  mkdir(c) { const { f, rest } = opts(c.argv); for (const d of rest) f.p ? vfs.mkdirp(c.P(d)) : vfs.mkdir(c.P(d)); return 0; },
  rmdir(c) { for (const d of c.argv) vfs.rm(c.P(d), false); return 0; },
  rm(c) { const { f, rest } = opts(c.argv); let code = 0; for (const x of rest) { const p = c.P(x); if (!vfs.exists(p)) { if (!f.f) { c.e(`rm: ${x}: No such file or directory\n`); code = 1; } continue; } if (vfs.isDir(p) && !(f.r || f.R)) { c.e(`rm: ${x}: is a directory\n`); code = 1; continue; } vfs.rm(p, true); } return code; },
  touch(c) { for (const x of opts(c.argv).rest) { const p = c.P(x); if (vfs.isFile(p)) vfs.nodes.get(p).mtime = Date.now(), vfs.changed(); else vfs.write(p, ''); } return 0; },
  mv(c) { const { rest } = opts(c.argv); const dst = c.P(rest.pop()); if (rest.length > 1 && !vfs.isDir(dst)) throw new Error(`target '${dst}' is not a directory`); for (const s of rest) vfs.move(c.P(s), dst); return 0; },
  cp(c) { const { f, rest } = opts(c.argv); const dst = c.P(rest.pop()); for (const s of rest) vfs.copy(c.P(s), dst, f.r || f.R || f.a); return 0; },
  head(c) { const { f, rest } = opts(c.argv, 'n:c:'); for (const x of inputs(c, rest)) { if (f.c) c.o(x.text.slice(0, +f.c)); else { const n = +(f.n ?? 10); const L = splitLines(x.text); c.o((n < 0 ? L.slice(0, n) : L.slice(0, n)).map(l => l + '\n').join('')); } } return 0; },
  tail(c) { const { f, rest } = opts(c.argv, 'n:c:'); for (const x of inputs(c, rest)) { if (f.c) c.o(x.text.slice(-f.c)); else { const L = splitLines(x.text); const s = String(f.n ?? 10); c.o((s.startsWith('+') ? L.slice(+s.slice(1) - 1) : L.slice(-Math.abs(+s) || L.length)).map(l => l + '\n').join('')); } } return 0; },
  wc(c) { const { f, rest } = opts(c.argv); const all = !f.l && !f.w && !f.c && !f.m; let T = [0, 0, 0]; const ins = inputs(c, rest);
    const row = (a, n) => [f.l || all ? a[0] : null, f.w || all ? a[1] : null, f.c || f.m || all ? a[2] : null].filter(v => v != null).map(v => String(v).padStart(7)).join(' ') + (n !== '-' ? ' ' + n : '') + '\n';
    for (const x of ins) { const a = [(x.text.match(/\n/g) || []).length, (x.text.match(/\S+/g) || []).length, enc.encode(x.text).length]; T = T.map((v, i) => v + a[i]); c.o(row(a, x.name)); }
    if (ins.length > 1) c.o(row(T, 'total')); return 0; },
  grep(c) {
    const { f, rest } = opts(c.argv, 'e:m:A:B:C:'); let pat = f.e ?? rest.shift(); if (pat == null) { c.e('usage: grep [-inrvlcEFwoq] PATTERN [FILE...]\n'); return 2; }
    let src = f.F ? pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : (f.E || f.P ? pat : breToJs(pat)); if (f.w) src = `\\b(?:${src})\\b`; if (f.x) src = `^(?:${src})$`;
    const re = new RegExp(src, f.i ? 'i' : ''); const reG = new RegExp(src, f.i ? 'gi' : 'g');
    let files = rest; const rec = f.r || f.R; if (rec && !files.length) files = ['.'];
    let list = [];
    for (const fn of files) { const p = c.P(fn); if (vfs.isDir(p)) { if (!rec) { c.e(`grep: ${fn}: Is a directory\n`); continue; } for (const q of vfs.walk(p)) if (vfs.isFile(q) && !/\/(node_modules|\.git)\//.test(q)) list.push({ name: fn === '.' ? q.slice(c.sh.cwd === '/' ? 1 : c.sh.cwd.length + 1) : (fn.replace(/\/$/, '') + q.slice(p.length)), p: q }); } else list.push({ name: fn, p }); }
    const ins = files.length ? list.map(x => { try { return { name: x.name, text: vfs.read(x.p) }; } catch (e) { c.e(`grep: ${e.message}\n`); return null; } }).filter(Boolean) : [{ name: '-', text: c.stdin }];
    const showName = (ins.length > 1 || rec) && !f.h; let any = false; const max = f.m ? +f.m : Infinity;
    for (const x of ins) { let cnt = 0; const L = splitLines(x.text);
      for (let i = 0; i < L.length && cnt < max; i++) { const hit = re.test(L[i]) !== !!f.v; if (!hit) continue; cnt++; any = true; if (f.q) return 0; if (f.l || f.c) continue;
        const pre = (showName ? x.name + ':' : '') + (f.n ? (i + 1) + ':' : '');
        if (f.o) { for (const m of L[i].matchAll(reG)) c.o(pre + m[0] + '\n'); } else c.o(pre + L[i] + '\n'); }
      if (f.l && cnt) c.o(x.name + '\n'); if (f.c) c.o((showName ? x.name + ':' : '') + cnt + '\n'); }
    return any ? 0 : 1;
  },
  find(c) {
    const a = [...c.argv]; const paths = []; while (a.length && !a[0].startsWith('-') && a[0] !== '(' && a[0] !== '!') paths.push(a.shift()); if (!paths.length) paths.push('.');
    const tests = []; let maxd = Infinity, mind = 0, neg = false;
    while (a.length) { const t = a.shift();
      if (t === '!' || t === '-not') { neg = true; continue; }
      const push = fn => { const n = neg; tests.push(n ? (p, b) => !fn(p, b) : fn); neg = false; };
      if (t === '-name') { const r = globToRe(a.shift()); push((p, b) => r.test(b)); }
      else if (t === '-iname') { const r = new RegExp(globToRe(a.shift()).source, 'i'); push((p, b) => r.test(b)); }
      else if (t === '-path' || t === '-wholename') { const g = a.shift(); const r = new RegExp(globToRe(g).source.replace(/\[\^\/\]\*/g, '.*')); push((p, b, disp) => r.test(disp)); }
      else if (t === '-type') { const ty = a.shift(); push(p => ty === 'd' ? vfs.isDir(p) : vfs.isFile(p)); }
      else if (t === '-maxdepth') maxd = +a.shift(); else if (t === '-mindepth') mind = +a.shift();
      else if (t === '-size') { const s = a.shift(); const m = /^([+-]?)(\d+)([ckM]?)$/.exec(s); const mul = { c: 1, k: 1024, M: 1048576, '': 512 }[m[3]]; const n = +m[2] * mul; push(p => { if (!vfs.isFile(p)) return false; const z = vfs.stat(p).size; return m[1] === '+' ? z > n : m[1] === '-' ? z < n : z === n; }); }
      else if (t === '-empty') push(p => vfs.isDir(p) ? vfs.list(p).length === 0 : vfs.stat(p).size === 0);
      else if (t === '-print' || t === '-o' || t === '-a') {}
      else { c.e(`find: unsupported option ${t} \n`); return 1; }
    }
    for (const root of paths) { const p0 = c.P(root); if (!vfs.exists(p0)) { c.e(`find: ${root}: No such file or directory\n`); continue; }
      for (const p of vfs.walk(p0)) { const rel = p === p0 ? '' : p.slice(p0 === '/' ? 1 : p0.length + 1); const depth = rel ? rel.split('/').length : 0; if (depth > maxd || depth < mind) continue; if (/\/(node_modules|\.git)(\/|$)/.test(rel) && !root.includes('node_modules')) continue;
        const disp = rel ? (root === '/' ? '/' + rel : root.replace(/\/$/, '') + '/' + rel) : root; if (tests.every(fn => fn(p, vfs.base(p), disp))) c.o(disp + '\n'); } }
    return 0;
  },
  tree(c) { const { f, rest } = opts(c.argv, 'L:'); const root = c.P(rest[0] || '.'); let nd = 0, nf = 0; const max = f.L ? +f.L : Infinity; c.o((rest[0] || '.') + '\n');
    const rec = (p, pre, d) => { if (d > max) return; const names = vfs.list(p).filter(n => f.a || !n.startsWith('.')); names.forEach((n, i) => { const q = vfs.norm(n, p); const lastOne = i === names.length - 1; const dir = vfs.isDir(q); dir ? nd++ : nf++; c.o(pre + (lastOne ? '└── ' : '├── ') + n + (dir ? '/' : '') + '\n'); if (dir) rec(q, pre + (lastOne ? '    ' : '│   '), d + 1); }); };
    rec(root, '', 1); c.o(`\n${nd} directories, ${nf} files\n`); return 0; },
  sort(c) { const { f, rest } = opts(c.argv, 'k:t:'); let L = inputs(c, rest).flatMap(x => splitLines(x.text)); const key = l => { if (!f.k) return l; const fs = f.t ? l.split(f.t) : l.trim().split(/\s+/); return fs.slice(parseInt(f.k) - 1).join(' '); };
    L.sort((a, b) => f.n ? (parseFloat(key(a)) || 0) - (parseFloat(key(b)) || 0) : (f.f ? key(a).toLowerCase().localeCompare(key(b).toLowerCase()) : key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)); if (f.r) L.reverse(); if (f.u) L = L.filter((l, i) => i === 0 || l !== L[i - 1]); c.o(L.map(l => l + '\n').join('')); return 0; },
  uniq(c) { const { f, rest } = opts(c.argv); const L = inputs(c, rest).flatMap(x => splitLines(x.text)); const g = []; for (const l of L) { if (g.length && g[g.length - 1][0] === l) g[g.length - 1][1]++; else g.push([l, 1]); }
    for (const [l, n] of g) { if (f.d && n < 2) continue; if (f.u && n > 1) continue; c.o((f.c ? String(n).padStart(7) + ' ' : '') + l + '\n'); } return 0; },
  cut(c) { const { f, rest } = opts(c.argv, 'd:f:c:'); const rng = s => s.split(',').flatMap(r => { const [a, b] = r.split('-'); const lo = a ? +a : 1, hi = r.includes('-') ? (b ? +b : 1e9) : lo; const o = []; for (let i = lo; i <= Math.min(hi, 1000); i++) o.push(i); return o; });
    for (const l of inputs(c, rest).flatMap(x => splitLines(x.text))) { if (f.c) { const ix = rng(f.c); c.o(ix.map(i => l[i - 1] ?? '').join('') + '\n'); } else { const d = f.d ?? '\t'; const parts = l.split(d); if (parts.length === 1 && !l.includes(d)) { c.o(l + '\n'); continue; } c.o(rng(f.f || '1').filter(i => i <= parts.length).map(i => parts[i - 1]).join(d) + '\n'); } } return 0; },
  tr(c) { const { f, rest } = opts(c.argv); const exp = s => { s = s.replace(/\[:upper:\]/g, 'A-Z').replace(/\[:lower:\]/g, 'a-z').replace(/\[:digit:\]/g, '0-9').replace(/\[:space:\]/g, ' \t\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t'); let o = ''; for (let i = 0; i < s.length; i++) { if (s[i + 1] === '-' && s[i + 2]) { for (let k = s.charCodeAt(i); k <= s.charCodeAt(i + 2); k++) o += String.fromCharCode(k); i += 2; } else o += s[i]; } return o; };
    const a = exp(rest[0] || ''), b = exp(rest[1] || ''); let out = '';
    for (const ch of c.stdin) { const i = a.indexOf(ch); if (f.d) { if (i < 0) out += ch; } else if (i >= 0 && b) out += b[Math.min(i, b.length - 1)]; else out += ch; }
    if (f.s) out = out.replace(new RegExp(`([${(b || a).replace(/[\]\\^-]/g, '\\$&')}])\\1+`, 'g'), '$1'); c.o(out); return 0; },
  sed(c) {
    const scripts = []; const files = []; let n = false, inplace = false, ere = false; const a = c.argv;
    for (let i = 0; i < a.length; i++) { const x = a[i]; if (x === '-n') n = true; else if (x === '-i' || x.startsWith('-i')) inplace = true; else if (x === '-E' || x === '-r') ere = true; else if (x === '-e') scripts.push(a[++i]); else if (x.startsWith('-') && x.length > 1 && /^-[nEr]+$/.test(x)) { if (x.includes('n')) n = true; if (/[Er]/.test(x)) ere = true; } else if (!scripts.length && !files.length && !a.slice(0, i).includes('-e')) scripts.push(x); else files.push(x); }
    const toRe = (p, fl = '') => new RegExp(ere ? p : breToJs(p), fl);
    const cmds = []; const src = scripts.join('\n'); let i = 0;
    const readDelim = d => { let o = ''; while (i < src.length && src[i] !== d) { if (src[i] === '\\' && src[i + 1] === d) { o += d; i += 2; continue; } if (src[i] === '\\' && src[i + 1] === 'n' && d !== 'n') { o += '\\n'; i += 2; continue; } o += src[i++]; } i++; return o; };
    const readAddr = () => { if (src[i] === '/') { i++; return { re: toRe(readDelim('/')) }; } if (src[i] === '$') { i++; return { last: true }; } const m = /^\d+/.exec(src.slice(i)); if (m) { i += m[0].length; return { n: +m[0] }; } return null; };
    while (i < src.length) { while (/[\s;]/.test(src[i] || '')) i++; if (i >= src.length) break;
      const a1 = readAddr(); let a2 = null; if (a1 && src[i] === ',') { i++; a2 = readAddr(); } while (src[i] === ' ') i++; let bang = false; if (src[i] === '!') { bang = true; i++; }
      const op = src[i++]; const cmd = { a1, a2, bang, op, on: false };
      if (op === 's') { const d = src[i++]; const re = readDelim(d); let rep = readDelim(d); let fl = ''; while (/[gipI0-9]/.test(src[i] || '')) fl += src[i++]; cmd.re = toRe(re, (fl.includes('g') ? 'g' : '') + (/[iI]/.test(fl) ? 'i' : '')); cmd.rep = rep.replace(/\$/g, '$$$$').replace(/\\(\d)/g, '$$$1').replace(/(^|[^\\])&/g, '$1$$&').replace(/\\&/g, '&').replace(/\\n/g, '\n'); cmd.p = fl.includes('p'); }
      else if (op === 'a' || op === 'i' || op === 'c') { while (src[i] === ' ' || src[i] === '\\') i++; let t = ''; while (i < src.length && src[i] !== '\n' && src[i] !== ';') t += src[i++]; cmd.text = t; }
      else if (!'dpq='.includes(op)) { c.e(`sed: unsupported command '${op}' (BusyBox WASM sed supports it)\n`); return 1; }
      cmds.push(cmd); }
    const run = text => { const L = splitLines(text); let out = ''; for (let ln = 0; ln < L.length; ln++) { let line = L[ln]; let del = false, quit = false; const isLast = ln === L.length - 1; let pre = '', post = '';
        for (const cm of cmds) { const m1 = ad => ad && (ad.n ? ad.n === ln + 1 : ad.last ? isLast : ad.re.test(line)); let hit;
          if (!cm.a1) hit = true; else if (!cm.a2) hit = m1(cm.a1); else { if (!cm.on && m1(cm.a1)) { cm.on = true; hit = true; if (cm.a2.n && cm.a2.n <= ln + 1) cm.on = false; } else if (cm.on) { hit = true; if (m1(cm.a2)) cm.on = false; } else hit = false; }
          if (cm.bang) hit = !hit; if (!hit) continue;
          if (cm.op === 's') { cm.re.lastIndex = 0; const nl = line.replace(cm.re, cm.rep); if (nl !== line || cm.re.test(line)) { line = nl; if (cm.p) out += line + '\n'; } }
          else if (cm.op === 'd') { del = true; break; } else if (cm.op === 'p') out += line + '\n'; else if (cm.op === 'q') { quit = true; break; } else if (cm.op === '=') out += (ln + 1) + '\n';
          else if (cm.op === 'a') post += cm.text + '\n'; else if (cm.op === 'i') pre += cm.text + '\n'; else if (cm.op === 'c') { line = cm.text; } }
        out += pre; if (!del && !n) out += line + '\n'; out += post; if (quit) break; }
      return out; };
    if (inplace) { for (const fn of files) { const p = c.P(fn); vfs.write(p, run(vfs.read(p))); } return 0; }
    for (const x of inputs(c, files)) c.o(run(x.text)); return 0;
  },
  awk(c) { // tiny awk: [-F sep] '[/re/]{ print $1, $2 }' — load BusyBox for real awk
    const { f, rest } = opts(c.argv, 'F:'); const prog = rest.shift() || ''; const m = /^\s*(?:\/(.*)\/)?\s*(?:\{\s*print\s*([^}]*)\})?\s*$/.exec(prog);
    if (!m) { c.e('awk: only "[/re/] { print ... }" is supported by the JS fallback; BusyBox WASM provides full awk\n'); return 2; }
    const re = m[1] ? new RegExp(m[1]) : null; const exprs = (m[2] ?? '$0').split(',').map(s => s.trim()).filter(Boolean); let NR = 0;
    for (const l of inputs(c, rest).flatMap(x => splitLines(x.text))) { NR++; if (re && !re.test(l)) continue; const F = f.F ? l.split(f.F === '\\t' ? '\t' : f.F) : l.trim().split(/\s+/);
      c.o((exprs.length ? exprs : ['$0']).map(e => e.split(/\s+/).map(t => t === '$0' ? l : /^\$\d+$/.test(t) ? (F[+t.slice(1) - 1] ?? '') : t === 'NR' ? NR : t === 'NF' ? F.length : t === '$NF' ? F[F.length - 1] : t.replace(/^"|"$/g, '')).join('')).join(' ') + '\n'); }
    return 0; },
  tee(c) { const { f, rest } = opts(c.argv); for (const fn of rest) f.a ? vfs.append(c.P(fn), c.stdin) : vfs.write(c.P(fn), c.stdin); c.o(c.stdin); return 0; },
  seq(c) { const n = c.argv.map(Number); const [a, s, b] = n.length === 1 ? [1, 1, n[0]] : n.length === 2 ? [n[0], 1, n[1]] : n; for (let i = a; s > 0 ? i <= b : i >= b; i += s) c.o(i + '\n'); return 0; },
  async sleep(c) { await sleep(Math.min(parseFloat(c.argv[0]) * 1000 || 0, 30000)); return 0; },
  date(c) { const d = new Date(); c.o((c.argv[0] === '-I' || c.argv[0] === '--iso-8601') ? d.toISOString().slice(0, 10) + '\n' : c.argv[0] === '+%s' ? Math.floor(d / 1000) + '\n' : d.toString() + '\n'); return 0; },
  env(c) { for (const [k, v] of Object.entries(c.sh.env)) c.o(`${k}=${v}\n`); return 0; },
  basename(c) { let b = vfs.base(vfs.norm(c.argv[0] || '')); if (c.argv[1] && b.endsWith(c.argv[1])) b = b.slice(0, -c.argv[1].length); c.o(b + '\n'); return 0; },
  dirname(c) { const p = c.argv[0] || '.'; const i = p.replace(/\/$/, '').lastIndexOf('/'); c.o((i < 0 ? '.' : i === 0 ? '/' : p.slice(0, i)) + '\n'); return 0; },
  realpath(c) { for (const a of c.argv) c.o(c.P(a) + '\n'); return 0; },
  stat(c) { for (const a of c.argv) { const s = vfs.stat(c.P(a)); c.o(`  File: ${a}\n  Size: ${s.size}\tType: ${s.dir ? 'directory' : 'regular file'}\nModify: ${new Date(s.mtime).toISOString()}\n`); } return 0; },
  du(c) { const { f, rest } = opts(c.argv); for (const a of rest.length ? rest : ['.']) { let t = 0; for (const q of vfs.walk(c.P(a))) if (vfs.isFile(q)) t += vfs.stat(q).size; c.o(`${f.h ? fmtSize(t) : Math.ceil(t / 1024)}\t${a}\n`); } return 0; },
  base64(c) { const { f, rest } = opts(c.argv); const t = inputs(c, rest)[0]?.text ?? ''; if (f.d) c.o(dec.decode(Uint8Array.from(atob(t.replace(/\s/g, '')), ch => ch.charCodeAt(0)))); else { let b = ''; for (const x of enc.encode(t)) b += String.fromCharCode(x); c.o(btoa(b).replace(/.{76}/g, '$&\n') + '\n'); } return 0; },
  rev(c) { for (const l of inputs(c, c.argv).flatMap(x => splitLines(x.text))) c.o([...l].reverse().join('') + '\n'); return 0; },
  nl(c) { let n = 1; for (const l of inputs(c, c.argv).flatMap(x => splitLines(x.text))) c.o(l.trim() ? `${String(n++).padStart(6)}\t${l}\n` : '\n'); return 0; },
  test(c) { let a = [...c.argv]; if (c.name === '[') { if (a.pop() !== ']') { c.e('[: missing ]\n'); return 2; } } let neg = false; if (a[0] === '!') { neg = true; a.shift(); }
    let r; const [x, y, z] = a; if (a.length === 0) r = false; else if (a.length === 1) r = x !== ''; else if (a.length === 2) { const p = c.P(y); r = { '-f': vfs.isFile(p), '-d': vfs.isDir(p), '-e': vfs.exists(p), '-s': vfs.isFile(p) && vfs.stat(p).size > 0, '-z': y === '', '-n': y !== '', '-r': vfs.exists(p), '-w': vfs.exists(p), '-x': false }[x] ?? false; }
    else r = { '=': x === z, '==': x === z, '!=': x !== z, '-eq': +x === +z, '-ne': +x !== +z, '-lt': +x < +z, '-le': +x <= +z, '-gt': +x > +z, '-ge': +x >= +z }[y] ?? false;
    return (neg ? !r : r) ? 0 : 1; },
  get '['() { return this.test; },
  yes(c) { c.o(((c.argv[0] ?? 'y') + '\n').repeat(100)); return 0; },
  whoami(c) { c.o('pi\n'); return 0; },
  uname(c) { c.o(c.argv.includes('-a') ? `NetrunnerOS browser 1.0 ${navigator.platform || 'web'} wasm32\n` : 'NetrunnerOS\n'); return 0; },
  async sha256sum(c) { for (const x of inputs(c, c.argv)) { const h = await crypto.subtle.digest('SHA-256', enc.encode(x.text)); c.o([...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('') + '  ' + x.name + '\n'); } return 0; },
  diff(c) { const { f, rest } = opts(c.argv); if (rest.length < 2) { c.e('usage: diff [-u] FILE1 FILE2\n'); return 2; }
    const A = splitLines(vfs.read(c.P(rest[0]))), B = splitLines(vfs.read(c.P(rest[1]))); if (A.join('\n') === B.join('\n')) return 0;
    if (A.length * B.length > 4e6) { c.o(`Files ${rest[0]} and ${rest[1]} differ\n`); return 1; }
    c.o(`--- ${rest[0]}\n+++ ${rest[1]}\n` + unifiedDiff(A, B)); return 1; },
};
function unifiedDiff(A, B, ctx = 3) {
  const n = A.length, m = B.length; const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n || j < m) { if (i < n && j < m && A[i] === B[j]) { ops.push([' ', A[i], i, j]); i++; j++; } else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) { ops.push(['-', A[i], i, j]); i++; } else { ops.push(['+', B[j], i, j]); j++; } }
  let out = ''; let k = 0;
  while (k < ops.length) { if (ops[k][0] === ' ') { k++; continue; }
    let s = Math.max(0, k - ctx), e = k; while (e < ops.length) { if (ops[e][0] !== ' ') { e++; continue; } let run = 0; while (e + run < ops.length && ops[e + run][0] === ' ') run++; if (run > ctx * 2 || e + run >= ops.length) { e = Math.min(ops.length, e + ctx); break; } e += run; }
    const h = ops.slice(s, e); const a0 = h[0][2] + 1, b0 = h[0][3] + 1;
    out += `@@ -${a0},${h.filter(o => o[0] !== '+').length} +${b0},${h.filter(o => o[0] !== '-').length} @@\n` + h.map(o => o[0] + o[1] + '\n').join(''); k = e; }
  return out;
}

/* ---------- node: run JS in a worker with a tiny fs/path shim ---------- */
const NODE_PRELUDE = "\nconst __out = []; let __files = {}; let __dirs = new Set(['/']); const __writes = {}; const __mk = new Set(); const __rmd = new Set(); let __cwd = '/';\nconst __norm = (p) => { p = String(p); if (p.startsWith('file://')) p = p.slice(7); const parts = (p.startsWith('/') ? p : __cwd + '/' + p).split('/'); const o = []; for (const s of parts) { if (!s || s === '.') continue; if (s === '..') o.pop(); else o.push(s); } return '/' + o.join('/'); };\nconst __fmt = (a) => a.map(x => typeof x === 'string' ? x : (() => { try { return x instanceof Error ? (x.stack || String(x)) : x === undefined ? 'undefined' : typeof x === 'function' ? '[Function]' : JSON.stringify(x, (k, v) => v instanceof Set ? [...v] : v instanceof Map ? Object.fromEntries(v) : typeof v === 'bigint' ? String(v) : v, 2) ?? String(x); } catch { return String(x); } })()).join(' ');\nconst __log = (k) => (...a) => { __out.push([k, __fmt(a) + '\\n']); };\nconst console = { log: __log('o'), info: __log('o'), debug: __log('o'), dir: __log('o'), table: __log('o'), warn: __log('e'), error: __log('e'), time() {}, timeEnd() {}, group() {}, groupEnd() {} };\nconst __isFile = p => (p in __writes) ? __writes[p] !== null : (p in __files);\nconst __isDir = p => __dirs.has(p);\nconst __parent = p => p === '/' ? '/' : (p.slice(0, p.lastIndexOf('/')) || '/');\nconst __err = (code, op, p) => { const e = new Error(`${code}: ${{ ENOENT: 'no such file or directory', EISDIR: 'illegal operation on a directory', ENOTDIR: 'not a directory', EEXIST: 'file already exists', ENOTEMPTY: 'directory not empty' }[code] || code}, ${op} '${p}'`); e.code = code; e.syscall = op; e.path = p; return e; };\nconst __mkp = p => { const chain = []; while (p !== '/' && !__dirs.has(p)) { if (__isFile(p)) throw __err('ENOTDIR', 'mkdir', p); chain.push(p); p = __parent(p); } for (const d of chain) { __dirs.add(d); __mk.add(d); __rmd.delete(d); } };\nconst __kids = p => { const pre = p === '/' ? '/' : p + '/'; const s = new Set(); const add = k => { if (k.startsWith(pre) && k !== p) s.add(k.slice(pre.length).split('/')[0]); }; for (const k of Object.keys(__files)) if (__isFile(k)) add(k); for (const k of Object.keys(__writes)) if (__writes[k] !== null) add(k); for (const d of __dirs) add(d); return [...s].sort(); };\nconst __enc = (o) => typeof o === 'string' ? o : o && o.encoding;\nclass Dirent { constructor(name, dir) { this.name = name; this._d = dir; } isFile() { return !this._d; } isDirectory() { return this._d; } isSymbolicLink() { return false; } }\nconst fs = {\n  readFileSync(p, o) { p = __norm(p); if (__isDir(p)) throw __err('EISDIR', 'read', p); if (!__isFile(p)) throw __err('ENOENT', 'open', p); const t = (p in __writes) ? __writes[p] : __files[p]; return t; },\n  writeFileSync(p, d) { p = __norm(p); if (__isDir(p)) throw __err('EISDIR', 'open', p); __mkp(__parent(p)); __writes[p] = typeof d === 'string' ? d : d == null ? '' : (d instanceof Uint8Array ? new TextDecoder().decode(d) : String(d)); },\n  appendFileSync(p, d) { let prev = ''; try { prev = fs.readFileSync(p); } catch (e) { if (e.code !== 'ENOENT') throw e; } fs.writeFileSync(p, prev + String(d)); },\n  existsSync(p) { p = __norm(p); return __isFile(p) || __isDir(p); },\n  accessSync(p) { if (!fs.existsSync(p)) throw __err('ENOENT', 'access', __norm(p)); },\n  readdirSync(p, o) { p = __norm(p); if (__isFile(p)) throw __err('ENOTDIR', 'scandir', p); if (!__isDir(p)) throw __err('ENOENT', 'scandir', p); const names = __kids(p); if (o && o.recursive) { const out = []; const rec = (d, pre) => { for (const n of __kids(d)) { const q = d === '/' ? '/' + n : d + '/' + n; out.push(o.withFileTypes ? new Dirent(pre + n, __isDir(q)) : pre + n); if (__isDir(q)) rec(q, pre + n + '/'); } }; rec(p, ''); return out; } return o && o.withFileTypes ? names.map(n => new Dirent(n, __isDir(p === '/' ? '/' + n : p + '/' + n))) : names; },\n  statSync(p, o) { p = __norm(p); const d = __isDir(p); if (!d && !__isFile(p)) { if (o && o.throwIfNoEntry === false) return undefined; throw __err('ENOENT', 'stat', p); } const size = d ? 4096 : new TextEncoder().encode(fs.readFileSync(p)).length; const t = new Date(); return { size, isFile: () => !d, isDirectory: () => d, isSymbolicLink: () => false, mtime: t, ctime: t, birthtime: t, mtimeMs: +t }; },\n  mkdirSync(p, o) { p = __norm(p); const rec = o === true || (o && o.recursive); if (__isDir(p)) { if (rec) return undefined; throw __err('EEXIST', 'mkdir', p); } if (__isFile(p)) throw __err('EEXIST', 'mkdir', p); if (!rec && !__isDir(__parent(p))) throw __err('ENOENT', 'mkdir', p); __mkp(p); return rec ? p : undefined; },\n  unlinkSync(p) { p = __norm(p); if (__isDir(p)) throw __err('EISDIR', 'unlink', p); if (!__isFile(p)) throw __err('ENOENT', 'unlink', p); __writes[p] = null; },\n  rmdirSync(p, o) { p = __norm(p); if (!__isDir(p)) throw __err(__isFile(p) ? 'ENOTDIR' : 'ENOENT', 'rmdir', p); if (__kids(p).length && !(o && o.recursive)) throw __err('ENOTEMPTY', 'rmdir', p); fs.rmSync(p, { recursive: true }); },\n  rmSync(p, o = {}) { p = __norm(p); if (__isFile(p)) { __writes[p] = null; return; } if (!__isDir(p)) { if (o.force) return; throw __err('ENOENT', 'rm', p); } if (p === '/') throw new Error('refusing to remove /'); if (!o.recursive && __kids(p).length) throw __err('ENOTEMPTY', 'rm', p); const pre = p + '/'; for (const k of [...Object.keys(__files), ...Object.keys(__writes)]) if (k.startsWith(pre) && __isFile(k)) __writes[k] = null; for (const d of [...__dirs]) if (d === p || d.startsWith(pre)) { __dirs.delete(d); __mk.delete(d); } __rmd.add(p); },\n  renameSync(a, b) { a = __norm(a); b = __norm(b); if (__isFile(a)) { const t = fs.readFileSync(a); fs.writeFileSync(b, t); __writes[a] = null; return; } if (!__isDir(a)) throw __err('ENOENT', 'rename', a); const pre = a + '/'; __mkp(b); for (const k of [...Object.keys(__files), ...Object.keys(__writes)]) if (k.startsWith(pre) && __isFile(k)) { fs.writeFileSync(b + k.slice(a.length), fs.readFileSync(k)); __writes[k] = null; } for (const d of [...__dirs]) if (d.startsWith(pre)) __mkp(b + d.slice(a.length)); fs.rmSync(a, { recursive: true }); },\n  copyFileSync(a, b) { fs.writeFileSync(b, fs.readFileSync(a)); },\n  cpSync(a, b, o) { a = __norm(a); if (__isFile(a)) return fs.copyFileSync(a, b); for (const n of fs.readdirSync(a, { recursive: true })) { const q = a + '/' + n; if (__isFile(q)) fs.writeFileSync(__norm(b) + '/' + n, fs.readFileSync(q)); } },\n  lstatSync(p, o) { return fs.statSync(p, o); }, realpathSync(p) { return __norm(p); }, constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 },\n};\nfs.promises = {}; for (const k of ['readFile', 'writeFile', 'appendFile', 'readdir', 'stat', 'lstat', 'mkdir', 'unlink', 'rm', 'rmdir', 'rename', 'copyFile', 'access', 'cp', 'realpath']) {\n  const sync = fs[k + 'Sync'];\n  fs.promises[k] = async (...a) => sync(...a);\n  fs[k] = (...a) => { const cb = typeof a[a.length - 1] === 'function' ? a.pop() : null; let r, e = null; try { r = sync(...a); } catch (x) { e = x; } if (cb) queueMicrotask(() => cb(e, r)); };\n}\nfs.exists = (p, cb) => queueMicrotask(() => cb(fs.existsSync(p)));\nconst path = {\n  sep: '/', delimiter: ':',\n  normalize: p => { const abs = String(p).startsWith('/'); const o = []; for (const s of String(p).split('/')) { if (!s || s === '.') continue; if (s === '..') { if (o.length && o[o.length - 1] !== '..') o.pop(); else if (!abs) o.push('..'); } else o.push(s); } return (abs ? '/' : '') + o.join('/') || (abs ? '/' : '.'); },\n  join: (...a) => path.normalize(a.filter(x => x !== '').join('/')),\n  resolve: (...a) => { let r = ''; for (const x of a) r = String(x).startsWith('/') ? x : (r ? r + '/' + x : x); return __norm(r || '.'); },\n  isAbsolute: p => String(p).startsWith('/'),\n  basename: (p, ext) => { let b = String(p).replace(/\\/+$/, '').split('/').pop(); return ext && b.endsWith(ext) && b !== ext ? b.slice(0, -ext.length) : b; },\n  dirname: p => { p = String(p).replace(/\\/+$/, ''); const i = p.lastIndexOf('/'); return i < 0 ? '.' : i === 0 ? '/' : p.slice(0, i); },\n  extname: p => { const b = path.basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },\n  relative: (a, b) => { const A = __norm(a).split('/').filter(Boolean), B = __norm(b).split('/').filter(Boolean); let i = 0; while (i < A.length && A[i] === B[i]) i++; return [...A.slice(i).map(() => '..'), ...B.slice(i)].join('/'); },\n  parse: p => { const base = path.basename(p), ext = path.extname(p); return { root: String(p).startsWith('/') ? '/' : '', dir: path.dirname(p), base, ext, name: ext ? base.slice(0, -ext.length) : base }; },\n  format: o => (o.dir ? o.dir + '/' : '') + (o.base || (o.name || '') + (o.ext || '')),\n};\npath.posix = path;\nclass __Exit { constructor(c) { this.code = c; } }\nconst process = { argv: [], env: { HOME: '/', USER: 'jade', PWD: '/' }, cwd: () => __cwd, chdir: d => { __cwd = __norm(d); }, exit: (c = 0) => { throw new __Exit(c); }, exitCode: 0, platform: 'linux', version: 'v20.0.0-browser', versions: { node: '20.0.0' }, stdout: { write: s => { __out.push(['o', String(s)]); return true; }, isTTY: false, columns: 80 }, stderr: { write: s => { __out.push(['e', String(s)]); return true; } }, nextTick: (f, ...a) => queueMicrotask(() => f(...a)), hrtime: Object.assign((t) => { const n = performance.now(); return [Math.floor(n / 1000), Math.round((n % 1000) * 1e6)]; }, { bigint: () => BigInt(Math.round(performance.now() * 1e6)) }), memoryUsage: () => ({ heapUsed: 0 }), on() {} };\nconst __mods = {};\nconst __core = (m) => { m = String(m).replace(/^node:/, ''); if (m === 'fs') return fs; if (m === 'fs/promises') return fs.promises; if (m === 'path' || m === 'path/posix') return path; if (m === 'util') return { inspect: x => __fmt([x]), format: (...a) => __fmt(a), promisify: f => (...a) => new Promise((res, rej) => f(...a, (e, r) => e ? rej(e) : res(r))) }; if (m === 'os') return { EOL: '\\n', platform: () => 'linux', homedir: () => '/', tmpdir: () => '/tmp', cpus: () => [{}], hostname: () => 'jade' }; if (m === 'readline') return { createInterface: () => ({ on() {}, question(q, cb) { cb(''); }, close() {} }) }; if (m === 'child_process') throw new Error(\"child_process is not available in the browser sandbox; use the bash tool for shell commands\"); return null; };\nconst __mkRequire = (dir) => (m) => {\n  const c = __core(m); if (c) return c;\n  m = String(m);\n  if (!/^(\\.{1,2}\\/|\\/)/.test(m)) throw new Error(\"Cannot find module '\" + m + \"' (browser sandbox: fs, path, util, os and local files like ./lib.js; no npm packages)\");\n  const base = __norm(m.startsWith('/') ? m : dir + '/' + m);\n  const cand = [base, base + '.js', base + '.cjs', base + '.json', base + '/index.js'].find(p => __isFile(p));\n  if (!cand) throw new Error(\"Cannot find module '\" + m + \"' (looked for \" + base + \"[.js|.json|/index.js])\");\n  if (__mods[cand]) return __mods[cand].exports;\n  if (cand.endsWith('.json')) return (__mods[cand] = { exports: JSON.parse(fs.readFileSync(cand)) }).exports;\n  const mod = __mods[cand] = { exports: {} };\n  let src = fs.readFileSync(cand).replace(/^#!.*\\n/, '');\n  src = src.replace(/^\\s*import\\s+(\\w+)\\s+from\\s+['\"]([^'\"]+)['\"];?/gm, 'const $1 = require(\"$2\");').replace(/^\\s*import\\s+\\{([^}]+)\\}\\s+from\\s+['\"]([^'\"]+)['\"];?/gm, (s, a, b) => 'const {' + a.replace(/\\s+as\\s+/g, ': ') + '} = require(\"' + b + '\");').replace(/^\\s*export\\s+default\\s+/gm, 'module.exports = ').replace(/^\\s*export\\s+(?=(const|let|var|function|class|async)\\b)/gm, '');\n  new Function('module', 'exports', 'require', '__filename', '__dirname', 'console', 'process', src)(mod, mod.exports, __mkRequire(__parent(cand)), cand, __parent(cand), console, process);\n  return mod.exports;\n};\nlet require = __mkRequire('/');\nconst module = { exports: {} }; const exports = module.exports; let __filename = '/[eval]', __dirname = '/';\nlet __pending = 0; const __st = self.setTimeout.bind(self), __ct = self.clearTimeout.bind(self); const __live = new Set();\nself.setTimeout = (f, ms, ...a) => { const id = __st(() => { __live.delete(id); try { typeof f === 'function' && f(...a); } catch (e) { __out.push(['e', (e && e.stack || e) + '\\n']); } }, ms); __live.add(id); return id; };\nself.clearTimeout = (id) => { __live.delete(id); __ct(id); };\nlet __code = 0;\nself.onmessage = async (ev) => {\n  __files = ev.data.files; __dirs = new Set(ev.data.dirs); __cwd = ev.data.cwd; process.env.PWD = __cwd; process.argv = ['node', ...ev.data.argv];\n  if (ev.data.argv[0] && ev.data.argv[0].startsWith('/')) { __filename = ev.data.argv[0]; __dirname = __parent(__filename); require = __mkRequire(__dirname); } else require = __mkRequire(__cwd);\n  try { await __main(); await new Promise(r => __st(r, 5)); while (__live.size) await new Promise(r => __st(r, 10)); } catch (err) { if (err instanceof __Exit) __code = err.code; else { __out.push(['e', (err && (err.code ? err.message : err.stack)) || String(err)]); __out.push(['e', '\\n']); __code = 1; } }\n  if (!__code && process.exitCode) __code = process.exitCode;\n  self.postMessage({ out: __out, writes: __writes, mkdirs: [...__mk], rmdirs: [...__rmd], code: __code });\n};\nself.addEventListener('unhandledrejection', e => { __out.push(['e', 'Unhandled promise rejection: ' + ((e.reason && e.reason.stack) || e.reason) + '\\n']); });\n";
async function runNode(c) {
  const { f, rest } = opts(c.argv, 'e:p:'); let code, argv;
  if (f.e != null || f.p != null) { code = f.p != null ? `console.log(${f.p})` : f.e; argv = rest; }
  else if (rest.length) { const p = c.P(rest[0]); code = vfs.read(p); argv = [p, ...rest.slice(1)]; }
  else { code = c.stdin; argv = ['[stdin]']; }
  if (!code.trim()) { c.e('node: no script given. Use node file.js or node -e "code"\n'); return 1; }
  code = code.replace(/^#!.*\n/, '');
  if (/^\s*(import|export)\s/m.test(code)) code = code.replace(/^\s*import\s+(\w+)\s+from\s+['"](?:node:)?(\w+)['"];?/gm, 'const $1 = require("$2");').replace(/^\s*import\s+\{([^}]+)\}\s+from\s+['"](?:node:)?([\w/]+)['"];?/gm, 'const {$1} = require("$2");').replace(/^\s*export\s+(default\s+)?/gm, '');
  const files = {}, dirs = []; for (const [p, n] of vfs.nodes) { if (n.dir) dirs.push(p); else if (n.data.length < 2e6) files[p] = dec.decode(n.data); }
  const src = NODE_PRELUDE + `\nasync function __main() {\n${code}\n}\n`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const r = await new Promise(resolve => {
    const w = new Worker(url); const t = setTimeout(() => { w.terminate(); resolve({ out: [['e', `node: killed after ${c.sh.timeoutMs / 1000}s timeout\n`]], writes: {}, code: 124 }); }, c.sh.timeoutMs);
    w.onmessage = e => { clearTimeout(t); w.terminate(); resolve(e.data); };
    w.onerror = e => { e.preventDefault?.(); clearTimeout(t); w.terminate(); resolve({ out: [['e', `${e.message || 'SyntaxError'}${e.lineno ? ` (line ${Math.max(1, e.lineno - NODE_PRELUDE.split('\n').length - 1)})` : ''}\n`]], writes: {}, code: 1 }); };
    w.postMessage({ files, dirs, cwd: c.sh.cwd, argv });
  });
  URL.revokeObjectURL(url);
  for (const [k, v] of r.out) k === 'o' ? c.o(v) : c.e(v);
  const W = Object.entries(r.writes || {});
  for (const [p, d] of W) if (d === null && vfs.isFile(p)) vfs.rm(p);
  for (const p of r.rmdirs || []) if (vfs.isDir(p) && p !== '/') vfs.rm(p, true);
  for (const p of r.mkdirs || []) { try { vfs.mkdirp(p); } catch {} }
  for (const [p, d] of W) if (d !== null) { try { vfs.write(p, d, { mkdirs: true }); } catch (e) { c.e(`node: could not save ${p}: ${e.message}\n`); } }
  return r.code;
}

/* =====================================================================
   TERMINAL (xterm.js, with a plain fallback)
   ===================================================================== */
const userShell = new Shell({});
const PROMPT = () => `\x1b[38;2;31;229;165mpi\x1b[38;2;131;153;143m@\x1b[38;2;255;61;79mnetrunner\x1b[0m:\x1b[38;2;255;184;198m${userShell.cwd}\x1b[0m$ `;
const term = (() => {
  const host = $('#term');
  if (!window.Terminal) {
    host.innerHTML = '<pre id="tfb" class="mono text-[12.5px] whitespace-pre-wrap h-full overflow-auto m-0" style="color:#dceee7"></pre>';
    const pre = $('#tfb'); const strip = s => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
    return { write: s => { pre.textContent += strip(s); pre.scrollTop = pre.scrollHeight; }, clear: () => pre.textContent = '', onData: () => {}, fit: () => {}, focus: () => {}, fallback: true };
  }
  const t = new Terminal({ convertEol: true, cursorBlink: false, disableStdin: true, fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace', fontSize: 11.5, lineHeight: 1.25, scrollback: 5000, allowTransparency: true,
    theme: { background: 'rgba(0,0,0,0)', foreground: '#dceee7', cursor: '#1fe5a5', cursorAccent: '#000', selectionBackground: 'rgba(31,229,165,.28)', black: '#06100c', red: '#ff3d4f', green: '#1fe5a5', yellow: '#e9d27a', blue: '#6fa8ff', magenta: '#ff8fb1', cyan: '#5fe3d6', white: '#dceee7', brightBlack: '#5a7066', brightRed: '#ff6b78', brightGreen: '#7ff5cb', brightYellow: '#f5e3a0', brightBlue: '#9cc2ff', brightMagenta: '#ffb8c6', brightCyan: '#9ff0e8', brightWhite: '#ffffff' } });
  const fit = new FitAddon.FitAddon(); t.loadAddon(fit); t.open(host);
  const doFit = () => { try { if (host.offsetParent) fit.fit(); } catch {} };
  new ResizeObserver(doFit).observe(host); setTimeout(doFit, 50);
  return { write: s => t.write(s), clear: () => t.clear(), onData: f => t.onData(f), fit: doFit, focus: () => t.focus() };
})();
const termState = { line: '', cur: 0, hist: ls.get('hist', []), hi: -1, busy: false };
function redraw() { const { line, cur } = termState; term.write('\r\x1b[K' + PROMPT() + line + (line.length - cur ? `\x1b[${line.length - cur}D` : '')); }
function termPrint(s, err) { term.write(err ? `\x1b[38;2;255;61;79m${s}\x1b[0m` : s); }
async function termExec(cmd) {
  termState.busy = true; userShell.aborted = false;
  if (cmd.trim()) { termState.hist.push(cmd); termState.hist = termState.hist.slice(-200); ls.set('hist', termState.hist); }
  userShell.onOutput = (s, err) => termPrint(s, err);
  try { await userShell.run(cmd); } finally { userShell.onOutput = null; termState.busy = false; }
  term.write(PROMPT());
}
if (term.fallback) {
    /* mobile build: the shell input bar below handles typing for both terminal modes */
} else term.onData(async d => {
  const S_ = termState;
  if (S_.busy) { if (d === '\x03') userShell.aborted = true; return; }
  if (d === '\r') { term.write('\r\n'); const l = S_.line; S_.line = ''; S_.cur = 0; S_.hi = -1; await termExec(l); return; }
  if (d === '\x7f' || d === '\b') { if (S_.cur > 0) { S_.line = S_.line.slice(0, S_.cur - 1) + S_.line.slice(S_.cur); S_.cur--; redraw(); } return; }
  if (d === '\x03') { term.write('^C\r\n'); S_.line = ''; S_.cur = 0; term.write(PROMPT()); return; }
  if (d === '\x0c') { term.clear(); redraw(); return; }
  if (d === '\x1b[A' || d === '\x1b[B') { const h = S_.hist; if (!h.length) return; if (d === '\x1b[A') S_.hi = S_.hi < 0 ? h.length - 1 : Math.max(0, S_.hi - 1); else S_.hi = S_.hi < 0 ? -1 : S_.hi + 1; if (S_.hi >= h.length) S_.hi = -1; S_.line = S_.hi < 0 ? '' : h[S_.hi]; S_.cur = S_.line.length; redraw(); return; }
  if (d === '\x1b[D') { if (S_.cur > 0) { S_.cur--; term.write(d); } return; }
  if (d === '\x1b[C') { if (S_.cur < S_.line.length) { S_.cur++; term.write(d); } return; }
  if (d === '\x1b[H' || d === '\x01') { S_.cur = 0; redraw(); return; }
  if (d === '\x1b[F' || d === '\x05') { S_.cur = S_.line.length; redraw(); return; }
  if (d === '\x15') { S_.line = S_.line.slice(S_.cur); S_.cur = 0; redraw(); return; }
  if (d === '\t') { // filename completion
    const before = S_.line.slice(0, S_.cur); const m = /(\S*)$/.exec(before); const word = m[1]; const dirPart = word.includes('/') ? word.slice(0, word.lastIndexOf('/') + 1) : ''; const base = word.slice(dirPart.length);
    let names = []; try { names = vfs.list(vfs.norm(dirPart || '.', userShell.cwd)).filter(n => n.startsWith(base)); } catch {}
    if (!dirPart && before.trim() === word) names = [...new Set([...names, ...Object.keys(BUILTINS), ...Object.keys(APPLETS), ...bb.applets].filter(n => n.startsWith(base)))];
    if (names.length === 1) { let add = names[0].slice(base.length); const full = vfs.norm(dirPart + names[0], userShell.cwd); add += vfs.isDir(full) ? '/' : ' '; S_.line = before + add + S_.line.slice(S_.cur); S_.cur += add.length; redraw(); }
    else if (names.length > 1) { let pre = names[0]; for (const n of names) while (!n.startsWith(pre)) pre = pre.slice(0, -1); if (pre.length > base.length) { const add = pre.slice(base.length); S_.line = before + add + S_.line.slice(S_.cur); S_.cur += add.length; redraw(); } else { term.write('\r\n' + names.join('  ') + '\r\n'); redraw(); } }
    return;
  }
  if (d.startsWith('\x1b')) return;
  const clean = d.replace(/[\x00-\x1f]/g, m => m === '\n' || m === '\r' ? ' ' : '');
  S_.line = S_.line.slice(0, S_.cur) + clean + S_.line.slice(S_.cur); S_.cur += clean.length; redraw();
});
function termBanner() {
  term.write('\x1b[38;2;31;229;165m  ██████  ██   ███    ██ ███████ ████████\x1b[0m\r\n');
  term.write('\x1b[38;2;31;229;165m  ██   ██ ██   ████   ██ ██         ██\x1b[0m\r\n');
  term.write('\x1b[38;2;255;184;198m  ██████  ██   ██ ██  ██ █████      ██\x1b[0m\r\n');
  term.write('\x1b[38;2;255;61;79m  ██      ██   ██  ██ ██ ██         ██\x1b[0m\r\n');
  term.write('\x1b[38;2;255;61;79m  ██      ██   ██   ████ ███████    ██\x1b[0m\r\n\r\n');
  term.write(`\x1b[2m  Shared shell with the agent. Type \x1b[0m\x1b[33mhelp\x1b[0m\x1b[2m for applets, \x1b[0m\x1b[33msearch\x1b[0m\x1b[2m / \x1b[0m\x1b[33mtags\x1b[0m\x1b[2m / \x1b[0m\x1b[33mopen <note>\x1b[0m\x1b[2m for the vault.\x1b[0m\r\n\r\n`);
  term.write(PROMPT());
}

/* =====================================================================
   OLLAMA CLIENT — ollama-js browser build from jsDelivr, fetch fallback
   ===================================================================== */
let OllamaLib = null;
async function loadOllamaLib() {
  try { const m = await import('https://cdn.jsdelivr.net/npm/ollama@0.6.0/dist/browser.mjs/+esm'); OllamaLib = m.Ollama || m.default?.Ollama || null; } catch (e) { console.warn('ollama-js failed to load; using fetch fallback', e); }
}
/* ---------- model providers: local Ollama, Ollama Cloud, Groq, any OpenAI-compatible endpoint ----------
   Every client exposes the ollama-js surface the agent loop uses: list(), chat(req) → async iterator of
   Ollama-shaped chunks, abort(). Cloud providers are tried as a fallback when the local Ollama is unreachable. */
const PROVIDERS = {
  local: { label: 'Ollama', chip: 'OLLAMA' },
  cloud: { label: 'Ollama Cloud', chip: 'OLLAMA CLOUD' },
  groq: { label: 'Groq', chip: 'GROQ' },
  llamacpp: { label: 'llama.cpp', chip: 'LLAMA.CPP' },
  openai: { label: 'OpenAI-compatible', chip: 'API' },
};
class FetchOllama { // minimal ollama-js compatible surface (also used for ollama.com with an API key)
  constructor({ host, headers = {} }) { this.host = host.replace(/\/+$/, ''); this.headers = headers; this.ctrls = new Set(); this._base = this.host; }
  abort() { for (const c of this.ctrls) c.abort(); this.ctrls.clear(); }
  async list() { const r = await fetch(this.host + '/api/tags', { headers: this.headers }); if (!r.ok) throw new Error(r.status === 401 ? 'the API key was rejected (401)' : `HTTP ${r.status}`); return r.json(); }
  async chat(req) {
    const ctrl = new AbortController(); this.ctrls.add(ctrl);
    const r = await fetch(this.host + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...this.headers }, body: JSON.stringify(req), signal: ctrl.signal });
    if (!r.ok) { let m = `HTTP ${r.status}`; try { m = (await r.json()).error || m; } catch {} if (r.status === 401) m = 'the API key was rejected (401)'; throw new Error(m); }
    const reader = r.body.getReader(); const self = this;
    return { abort: () => ctrl.abort(), async *[Symbol.asyncIterator]() { let buf = ''; try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; const j = JSON.parse(line); if (j.error) throw new Error(j.error); yield j; } } if (buf.trim()) yield JSON.parse(buf); } finally { self.ctrls.delete(ctrl); } } };
  }
}
// Ollama-style history → OpenAI chat messages (tool calls need ids that tool results point back to)
function toOpenAIMessages(msgs) {
  const out = []; let seq = 0; let pending = [];
  const flush = () => { for (const p of pending) out.push({ role: 'tool', tool_call_id: p.id, content: '(no result: the run was interrupted)' }); pending = []; };
  for (const m of msgs) {
    if (m.role === 'tool') {
      let k = pending.findIndex(p => p.name === m.tool_name); if (k < 0) k = 0;
      if (pending.length) { const p = pending.splice(k, 1)[0]; out.push({ role: 'tool', tool_call_id: p.id, content: String(m.content ?? '') }); }
      else out.push({ role: 'user', content: `[Result of ${m.tool_name || 'a tool'}]\n${m.content ?? ''}` });
      continue;
    }
    flush();
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const calls = m.tool_calls.map(t => { const id = 'call_' + (++seq) + '_' + Math.random().toString(36).slice(2, 7); pending.push({ id, name: t.function?.name }); return { id, type: 'function', function: { name: t.function?.name, arguments: typeof t.function?.arguments === 'string' ? t.function.arguments : JSON.stringify(t.function?.arguments || {}) } }; });
      out.push({ role: 'assistant', content: m.content || null, tool_calls: calls });
    } else if (m.role === 'user' && m.images?.length) out.push({ role: 'user', content: [{ type: 'text', text: String(m.content ?? '') }, ...m.images.map(b => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b } }))] });
    else out.push({ role: m.role, content: String(m.content ?? '') });
  }
  flush();
  return out;
}
class OpenAICompat {
  constructor({ base, key, name }) { this.base = String(base || '').replace(/\/+$/, ''); this.key = key; this.name = name; this.ctrls = new Set(); }
  get headers() { const h = { 'Content-Type': 'application/json' }; if (this.key) h.Authorization = 'Bearer ' + this.key; return h; }
  abort() { for (const c of this.ctrls) c.abort(); this.ctrls.clear(); }
  async err(r) { let m = `HTTP ${r.status}`; try { const j = await r.json(); m = j.error?.message || j.error || j.message || m; if (j.error?.failed_generation) m += ` (model output: ${String(j.error.failed_generation).slice(0, 200)})`; } catch {} if (r.status === 401) m = `${this.name} rejected the API key (401)`; if (r.status === 429) m = `${this.name} rate limit: ${m}`; return new Error(m); }
  async list() {
    const r = await fetch(this.base + '/models', { headers: this.headers }); if (!r.ok) throw await this.err(r);
    const j = await r.json(); const ids = (j.data || j.models || []).map(m => m.id || m.name).filter(Boolean)
      .filter(id => !/whisper|tts|-guard|guard-|playai|orpheus|embed|distil|moderation|dall-e|image|audio|transcri/i.test(id));
    return { models: ids.map(name => ({ name })) };
  }
  body(req, stream) {
    const b = { model: req.model, messages: toOpenAIMessages(req.messages), stream, temperature: req.options?.temperature ?? 0.2 };
    if (req.tools?.length) { b.tools = req.tools; b.tool_choice = 'auto'; }
    if (stream && this.name !== 'Groq') b.stream_options = { include_usage: true };
    return b;
  }
  async once(req) { // non-streaming, for compaction and journal
    const r = await fetch(this.base + '/chat/completions', { method: 'POST', headers: this.headers, body: JSON.stringify(this.body(req, false)) });
    if (!r.ok) throw await this.err(r);
    const j = await r.json(); return { message: { role: 'assistant', content: j.choices?.[0]?.message?.content || '' } };
  }
  async chat(req) {
    const ctrl = new AbortController(); this.ctrls.add(ctrl); const self = this;
    const r = await fetch(this.base + '/chat/completions', { method: 'POST', headers: this.headers, body: JSON.stringify(this.body(req, true)), signal: ctrl.signal });
    if (!r.ok) { self.ctrls.delete(ctrl); throw await this.err(r); }
    const reader = r.body.getReader(); const t0 = performance.now();
    return { abort: () => ctrl.abort(), async *[Symbol.asyncIterator]() {
      let buf = '', usage = null, calls = [];
      const take = (j) => { const out = []; if (j.error) throw new Error(j.error.message || String(j.error)); if (j.usage) usage = j.usage; if (j.x_groq?.usage) usage = j.x_groq.usage;
        const d = j.choices?.[0]?.delta || {};
        const th = d.reasoning || d.reasoning_content; if (th) out.push({ message: { role: 'assistant', content: '', thinking: th } });
        if (d.content) out.push({ message: { role: 'assistant', content: d.content } });
        for (const tc of d.tool_calls || []) { const i = tc.index ?? calls.length; const c = calls[i] ||= { id: tc.id, name: '', args: '' }; if (tc.id) c.id = tc.id; if (tc.function?.name) c.name += tc.function.name; if (tc.function?.arguments) c.args += tc.function.arguments; }
        return out; };
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true }); let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line.startsWith('data:')) continue; const data = line.slice(5).trim(); if (data === '[DONE]') continue;
            let j; try { j = JSON.parse(data); } catch { continue; }
            for (const part of take(j)) yield part;
          }
        }
        if (calls.length) yield { message: { role: 'assistant', content: '', tool_calls: calls.filter(c => c.name).map(c => ({ function: { name: c.name, arguments: safeJson(c.args || '{}') } })) } };
        const secs = usage?.completion_time || (performance.now() - t0) / 1000;
        yield { message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: usage?.prompt_tokens || 0, eval_count: usage?.completion_tokens || 0, eval_duration: usage?.completion_tokens ? Math.round(secs * 1e9) : 0 };
      } finally { self.ctrls.delete(ctrl); }
    } };
  }
}
function makeClientFor(p, c = S) {
  if (p === 'cloud') return new FetchOllama({ host: 'https://ollama.com', headers: c.ollamaKey ? { Authorization: 'Bearer ' + c.ollamaKey } : {} });
  if (p === 'groq') return new OpenAICompat({ base: 'https://api.groq.com/openai/v1', key: c.groqKey, name: 'Groq' });
  if (p === 'llamacpp') return new OpenAICompat({ base: (c.lcppHost || 'http://localhost:8080').replace(/\/+$/, '').replace(/(\/v1)?$/, '/v1'), key: c.lcppKey, name: 'llama.cpp' });
  if (p === 'openai') return new OpenAICompat({ base: c.oaiHost, key: c.oaiKey, name: (() => { try { return new URL(c.oaiHost).host; } catch { return 'the API'; } })() });
  const host = c.host || DEFAULTS.host; const cl = OllamaLib ? new OllamaLib({ host }) : new FetchOllama({ host }); cl._lib = !!OllamaLib; cl._base = host.replace(/\/+$/, ''); cl.headers = {}; return cl;
}
function providerMissing(p, c = S) {
  if (p === 'cloud' && !c.ollamaKey) return 'no Ollama API key set (Config → Model provider)';
  if (p === 'groq' && !c.groqKey) return 'no Groq API key set (Config → Model provider)';
  if (p === 'llamacpp' && c.lcppHost && !/^https?:\/\//.test(c.lcppHost)) return 'the llama.cpp address must start with http:// or https://';
  if (p === 'openai' && !/^https?:\/\//.test(c.oaiHost || '')) return 'no base URL set for the OpenAI-compatible endpoint';
  return '';
}
const withTimeout = (pr, ms, what) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} did not answer within ${ms / 1000}s`)), ms))]);
async function tryProvider(p, cfg = S) {
  const miss = providerMissing(p, cfg); if (miss) throw new Error(miss);
  const c = makeClientFor(p, cfg);
  const r = await withTimeout(c.list(), p === 'local' || p === 'llamacpp' ? 6000 : 15000, PROVIDERS[p].label);
  return { c, models: (r.models || []).map(m => m.name || m.model).filter(Boolean).sort() };
}
var activeProv = 'local'; let client = null, lastConnErr = null;
const providerName = () => activeProv === 'local' ? `Ollama at ${S.host || DEFAULTS.host}` : PROVIDERS[activeProv]?.label || activeProv;
let models = [];
const PREF_ORDER = [/gpt-oss.?120b/i, /gpt-oss/i, /qwen3/i, /kimi-k2/i, /llama-?3\.3|llama-?4/i, /deepseek/i, /glm-4/i, /mistral|devstral/i, /llama-?3\.[12]/i, /granite|qwen2\.5-coder/i];
const pickModel = list => { for (const re of PREF_ORDER) { const m = list.find(x => re.test(x)); if (m) return m; } return list[0] || ''; };
const providerChain = () => { const prim = S.provider || 'local'; return [prim, ...(Array.isArray(S.fallbacks) ? S.fallbacks : []).filter((p, i, a) => p !== prim && PROVIDERS[p] && a.indexOf(p) === i)]; };
function activateProvider(p, res) {
  client = res.c; activeProv = p; models = res.models;
  S.modelBy ||= {};
  const want = S.modelBy[p] || (p === (S.provider || 'local') ? S.model : '');
  S.model = models.includes(want) ? want : pickModel(models);
  saveSettings(); fillModelSelects();
  setOllamaChip('ok', activeProv === 'local' ? `${new URL(S.host || DEFAULTS.host).host}${client._lib ? '' : ' · fetch'}` : 'LINKED');
}
// try the main provider, then each fallback in order; `skip` = providers already tried in this run
async function connect({ skip = null, quiet = false } = {}) {
  setOllamaChip('busy', 'LINKING…');
  const chain = providerChain(); const errs = [];
  for (const p of chain) {
    if (skip?.has(p)) continue;
    try {
      const res = await tryProvider(p); activateProvider(p, res); lastConnErr = null;
      if (p !== chain[0] && !quiet) toast(`${esc(PROVIDERS[chain[0]].label)} is unreachable. Using ${esc(PROVIDERS[p].label)}${errs.length > 1 ? ` (after ${errs.length} failed)` : ''}.`, 'ok');
      renderEmpty(); return true;
    } catch (e) { errs.push(`${PROVIDERS[p].label}: ${e.message || e}`); }
  }
  lastConnErr = new Error(errs.join(' · ') || 'no provider configured');
  if (!skip) { activeProv = chain[0]; client = makeClientFor(activeProv); models = []; fillModelSelects(); }
  setOllamaChip('bad', 'OFFLINE'); renderEmpty(lastConnErr); return false;
}
// mid-run failover: move to the next provider in the chain that has not been tried yet
async function failover(tried) { tried.add(activeProv); return (await connect({ skip: tried })) && !tried.has(activeProv); }
// when running on a fallback, quietly check whether the main provider is back before each prompt
async function maybeRestorePrimary() {
  const prim = S.provider || 'local';
  if (activeProv === prim || running) return;
  try { const res = await withTimeout(tryProvider(prim), 3000, PROVIDERS[prim].label); activateProvider(prim, res); renderEmpty(); toast(`${esc(PROVIDERS[prim].label)} is back: switched to it.`, 'ok'); } catch {}
}
// one-shot (non-streaming) completion for compaction and the journal, on whatever provider is active
async function postWith(c, body, init) {
  if (c instanceof OpenAICompat) {
    try { const j = await c.once(body); return { ok: true, status: 200, json: async () => j }; }
    catch (e) { return { ok: false, status: 0, json: async () => ({ error: e.message }) }; }
  }
  const base = c?._base || c?.host || (S.host || DEFAULTS.host).replace(/\/+$/, '');
  return fetch(base + '/api/chat', { ...init, body: JSON.stringify(body), headers: { ...(init.headers || {}), ...(c?.headers || {}) } });
}
// one-shot (non-streaming) completion for compaction and the journal. Uses the model picked under
// Config → History compaction when set, and falls back to the chat model if that fails.
async function llmPost(init) {
  const body = JSON.parse(init.body);
  if (S.auxProv && PROVIDERS[S.auxProv] && !providerMissing(S.auxProv)) {
    try {
      const c = S.auxProv === activeProv ? client : makeClientFor(S.auxProv);
      const m = S.auxModel || S.modelBy?.[S.auxProv]; if (!m) throw new Error('no model picked');
      const r = await postWith(c, { ...body, model: m }, init); if (r.ok) return r;
      console.warn('compaction model failed, using the chat model', await r.json().catch(() => ({})));
    } catch (e) { console.warn('compaction model failed, using the chat model', e); }
  }
  return postWith(client, body, init);
}

function setOllamaChip(state, text) { $('#dotOllama').className = 'dot ' + state; $('#txtOllama').textContent = (PROVIDERS[activeProv]?.chip || 'OLLAMA') + ' ' + text; $('#chipOllama').title = providerName(); }
function fillModelSelects() {
  for (const sel of [$('#modelSel'), $('#sModel')]) {
    sel.innerHTML = models.length ? models.map(m => `<option ${m === S.model ? 'selected' : ''}>${esc(m)}</option>`).join('') : `<option value="">${S.model ? esc(S.model) : 'no models'}</option>`;
  }
  $('#hdrModel').textContent = (S.model ? S.model : models.length ? 'pick a model' : (activeProv === 'local' ? 'Ollama offline' : PROVIDERS[activeProv].label + ' offline')) + (activeProv !== 'local' && S.model ? ' · ' + PROVIDERS[activeProv].label.replace('OpenAI-compatible', 'API') : '');
  if ($('#provSel')) $('#provSel').value = S.provider || 'local';
  $('#hdrDot').className = 'dot ' + (models.length ? 'ok' : 'bad');
}

/* =====================================================================
   TOOLS
   ===================================================================== */
const MAX_LINES = 2000, MAX_BYTES = 50 * 1024;
function truncateHead(text) {
  const L = text.split('\n'); let out = L, note = '';
  if (L.length > MAX_LINES) { out = L.slice(0, MAX_LINES); note = `\n[truncated: showing ${MAX_LINES} of ${L.length} lines]`; }
  let s = out.join('\n'); if (s.length > MAX_BYTES) { s = s.slice(0, MAX_BYTES); note = `\n[truncated at ${MAX_BYTES / 1024}KB]`; }
  return s + note;
}
function truncateTail(text) {
  const L = text.split('\n'); let s = text, note = '';
  if (L.length > MAX_LINES) { s = L.slice(-MAX_LINES).join('\n'); note = `[output truncated: showing last ${MAX_LINES} of ${L.length} lines]\n`; }
  if (s.length > MAX_BYTES) { s = s.slice(-MAX_BYTES); note = `[output truncated to last ${MAX_BYTES / 1024}KB]\n`; }
  return note + s;
}

const tasks = { items: [], seq: 0 };
const TOOL_DEFS = [
  { name: 'read', description: 'Read the contents of a file. Output is truncated to 2000 lines or 50KB; use offset/limit to page through large files.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path to the file (relative to / or absolute)' }, offset: { type: 'number', description: 'Line number to start from (1-indexed)' }, limit: { type: 'number', description: 'Maximum number of lines to read' } }, required: ['path'] } },
  { name: 'write', description: 'Write content to a file. Creates the file if missing, overwrites it otherwise, and creates parent directories.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path to the file' }, content: { type: 'string', description: 'Full file content' } }, required: ['path', 'content'] } },
  { name: 'edit', description: 'Edit a file by replacing exact text. oldText must match exactly once (including whitespace). Read the file first.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path to the file' }, oldText: { type: 'string', description: 'Exact text to find and replace' }, newText: { type: 'string', description: 'Replacement text' } }, required: ['path', 'oldText', 'newText'] } },
  { name: 'bash', description: 'Run a command in the BusyBox shell at /. Returns stdout and stderr (last 2000 lines / 50KB). Supports pipes, redirects, &&, ||, ;, $VAR, $(...), globs. No loops or if blocks; no network; no package managers. For scripts longer than a line, write a .js or .py file and run `node file.js` or `python file.py` (both work on the vault files). Vault commands: search <words|#tag>, tags, links <note>, backlinks <note>.',
    parameters: { type: 'object', properties: { command: { type: 'string', description: 'Command to execute' }, timeout: { type: 'number', description: 'Timeout in seconds (default 60)' } }, required: ['command'] } },
  { name: 'tasks', description: 'Manage the visible task list. Use it to plan multi-step work, then mark tasks in_progress and done as you go. Actions: add (titles), update (id + status and/or title), remove (id), list, clear.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['add', 'update', 'remove', 'list', 'clear'] }, titles: { type: 'array', items: { type: 'string' }, description: 'For add: one title per task' }, id: { type: 'number', description: 'Task id for update/remove' }, status: { type: 'string', enum: ['pending', 'in_progress', 'done'] }, title: { type: 'string' } }, required: ['action'] } },
  { name: 'web_search', description: 'Search the web. Returns titles, URLs and snippets. Use for current information, docs, and error messages.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, max_results: { type: 'number', description: 'Max results (default 5, max 10)' } }, required: ['query'] } },
  { name: 'web_fetch', description: 'Fetch a web page and return it as readable text/markdown.',
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'Absolute http(s) URL' } }, required: ['url'] } },
  { name: 'skill', description: 'Load one of your skills (instruction packs listed in your instructions under Skills) by name, and get its step-by-step instructions to follow.',
    parameters: { type: 'object', properties: { name: { type: 'string', description: 'Skill name, e.g. daily-review' }, input: { type: 'string', description: 'Optional: what to apply it to' } }, required: ['name'] } },
  { name: 'memory', description: 'Your long-term memory across chats, kept in the note /Jade/Memory.md (you see it in your instructions every chat). save: remember one durable fact (who the user is, preferences, projects, people, decisions, or anything they ask you to remember). search: look through memory and your journal of past chats. forget: delete remembered lines containing text. list: show all of memory.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['save', 'search', 'forget', 'list'] }, text: { type: 'string', description: 'save: the fact, as one short sentence. search: words to look for. forget: text of the memory to delete.' }, section: { type: 'string', enum: ['about', 'preferences', 'projects', 'notes'], description: 'save: where it belongs (default notes)' } }, required: ['action'] } },
  { name: 'notes_search', description: 'Search the markdown vault. Ranked by note name and text matches. A query like "#project" lists notes with that tag. An empty query returns a vault overview (note count, folders, tags, most-linked notes). Use this before creating a note to avoid duplicates.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Words to find, or #tag. Empty for an overview.' }, limit: { type: 'number', description: 'Max results (default 10, max 30)' } } } },
  { name: 'note_links', description: 'Show the link graph around one note: backlinks (with the line that links), outgoing links, unresolved [[links]] to notes that do not exist yet, and tags.',
    parameters: { type: 'object', properties: { note: { type: 'string', description: 'Note name (e.g. "Inbox") or path (e.g. /projects/Plan.md)' } }, required: ['note'] } },
  { name: 'open_note', description: 'Show a note on the user\'s screen. Use when the user asks to see or open a note, or after writing a note they asked for.',
    parameters: { type: 'object', properties: { note: { type: 'string', description: 'Note name or path' }, mode: { type: 'string', enum: ['read', 'edit', 'split'], description: 'View mode (default read)' } }, required: ['note'] } },
  { name: 'decide', description: 'Ask the local Ollaya decision model to judge a piece of text. Returns calibrated probabilities, not prose. Use for triage, routing, classification, severity scores and yes/no checks (e.g. "is this test output a pass?", "which module does this stack trace point to?").',
    parameters: { type: 'object', properties: { state: { type: 'string', description: 'The text to judge: a message, log, diff, error or JSON' }, question: { type: 'string', description: 'What to decide, as an instruction' }, type: { type: 'string', enum: ['choice', 'score', 'yesno'], description: 'choice = pick one option; score = pick a level; yesno = true/false' }, options: { type: 'array', items: { type: 'string' }, description: 'choice: 2+ option labels. score: 2-10 level descriptions, lowest first. Not used for yesno.' } }, required: ['state', 'question', 'type'] } },
  { name: 'schedule', description: 'Create, list, pause/resume or delete scheduled prompts and reminders. Use whenever the user wants something to happen at a time or repeatedly. Each run sends the prompt to you as a new message. For add, give "when" in plain English (e.g. "every day at 9am", "weekdays at 8:30", "every 30 minutes", "in 20 minutes", "tomorrow at 7pm") and "prompt" = what to do or say at that time. Do not ask the user for cron syntax.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['add', 'list', 'remove', 'enable', 'disable'] }, name: { type: 'string', description: 'Short name (add)' }, when: { type: 'string', description: 'When to run, in plain English or 5-field cron. Examples: "every day at 9am", "weekdays at 8:30", "every monday at 6pm", "every 30 minutes", "in 20 minutes", "tomorrow at 7pm", "0 9 * * *" (add)' }, prompt: { type: 'string', description: 'What to do or say each time, e.g. "Remind the user to finish their projects" (add)' }, chat: { type: 'string', enum: ['new', 'same'], description: 'new = fresh chat per run (default), same = keep one chat' }, id: { type: 'string', description: 'Schedule id (remove/enable/disable)' } }, required: ['action'] } },
];
const OLLAMA_TOOLS = TOOL_DEFS.map(t => ({ type: 'function', function: t }));
const activeTools = () => [...OLLAMA_TOOLS.filter(t => (t.function.name !== 'decide' || (S.ollayaOn && S.ollayaModel)) && (t.function.name !== 'memory' || S.memoryOn)), ...mcpToolDefs()];

/* ---------------- Ollaya (local decision models) ---------------- */
const ollayaBase = () => (S.ollayaHost || DEFAULTS.ollayaHost).replace(/\/+$/, '');
const ollayaHeaders = () => { const h = { 'Content-Type': 'application/json' }; if (S.ollayaKey) h.Authorization = 'Bearer ' + S.ollayaKey; return h; };
let ollayaModels = [], ollayaState = 'off';
async function ollayaErr(r) {
  let msg = 'HTTP ' + r.status;
  try { const j = await r.json(); msg = (j.error || msg) + (j.detail ? ' — ' + JSON.stringify(j.detail).slice(0, 300) : ''); } catch {}
  if (r.status === 403) msg += `. Ollaya refused this page's origin: restart it with OLLAYA_ORIGINS="*" ollaya serve (opening the page as a local file also works).`;
  if (r.status === 401) msg += '. The API key does not match OLLAYA_API_KEY.';
  return msg;
}
async function ollayaFetch(path, init = {}) {
  try { return await fetch(ollayaBase() + path, { ...init, headers: ollayaHeaders() }); }
  catch (e) { throw new Error(`could not reach Ollaya at ${ollayaBase()}. Is "ollaya serve" running? If it is, the browser blocked the request: restart it with OLLAYA_ORIGINS="*".`); }
}
async function ollayaScan() {
  const r = await ollayaFetch('/api/tags'); if (!r.ok) throw new Error(await ollayaErr(r));
  const j = await r.json(); ollayaModels = (j.models || []).map(m => m.name || m.model).filter(Boolean);
  return ollayaModels;
}
async function ollayaDecide({ state, question, type = 'choice', options } = {}) {
  if (!S.ollayaOn) throw new Error('Ollaya is turned off (Config → Ollaya decisions).');
  if (!S.ollayaModel) throw new Error('No Ollaya model is selected (Config → Ollaya decisions → Scan).');
  const t = type === 'yesno' ? 'noul' : type;
  const q = { type: t, instructions: String(question || '') };
  const opts = Array.isArray(options) ? options.map(String).map(x => x.trim()).filter(Boolean) : [];
  if (t === 'choice') { if (opts.length < 2) throw new Error('type "choice" needs at least 2 options'); q.criteria = opts.slice(0, 255); }
  else if (t === 'score') { if (opts.length < 2) throw new Error('type "score" needs 2-10 level descriptions, lowest first'); q.criteria = opts.slice(0, 10); }
  else if (t !== 'noul') throw new Error('type must be choice, score or yesno');
  const body = { model: S.ollayaModel, state: typeof state === 'string' ? state : JSON.stringify(state ?? ''), questions: { q } };
  const r = await ollayaFetch('/v1/systemone', { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await ollayaErr(r));
  const j = await r.json(); const a = j.answers?.q;
  if (!a) return JSON.stringify(j).slice(0, 2000);
  const fmtP = p => Array.isArray(p) ? p.map((v, i) => [String(i), v]) : Object.entries(p || {});
  const probs = fmtP(a.probabilities).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${(+v).toFixed(3)}`).join(', ');
  const head = a.type === 'score' || 'score' in a ? `score: ${a.score}${a.legend != null ? ` (${typeof a.legend === 'string' ? a.legend : JSON.stringify(a.legend).slice(0, 200)})` : ''}`
    : 'choice' in a ? `choice: ${a.choice}` : `answer: ${JSON.stringify(a.noul)}`;
  return `${head}${a.confidence != null ? ` | confidence ${(+a.confidence).toFixed(3)}` : ''}${probs ? `\nprobabilities: ${probs}` : ''}\nmodel: ${j.model || S.ollayaModel}`;
}
async function ollayaCheck() {
  const chip = $('#chipOllaya'); chip.hidden = !S.ollayaOn;
  if (!S.ollayaOn) { ollayaState = 'off'; return; }
  $('#dotOllaya').className = 'dot busy'; $('#txtOllaya').textContent = 'OLLAYA';
  try { await ollayaScan(); ollayaState = 'ok'; $('#dotOllaya').className = 'dot ok'; $('#txtOllaya').textContent = 'OLLAYA ' + (S.ollayaModel || 'no model'); chip.title = `Ollaya at ${ollayaBase()} · ${ollayaModels.length} model(s)`; }
  catch (e) { ollayaState = 'bad'; $('#dotOllaya').className = 'dot bad'; $('#txtOllaya').textContent = 'OLLAYA OFFLINE'; chip.title = e.message; }
}

function tasksText() {
  if (!tasks.items.length) return 'Task list is empty.';
  const mark = { pending: '[ ]', in_progress: '[~]', done: '[x]' };
  return tasks.items.map(t => `${mark[t.status]} #${t.id} ${t.title}`).join('\n');
}
function renderTasks() {
  const L = $('#taskList'); const done = tasks.items.filter(t => t.status === 'done').length; const open = tasks.items.length - done;
  $('#taskBadge').hidden = !open; $('#taskBadge').textContent = open;
  $('#taskBar').style.width = tasks.items.length ? (done / tasks.items.length * 100) + '%' : '0';
  if (!tasks.items.length) { L.innerHTML = `<div class="text-sm text-dim leading-relaxed border border-dashed border-line p-4">No tasks yet. The agent adds tasks here when it plans multi-step work, then checks them off as it goes.</div>`; return; }
  L.innerHTML = tasks.items.map(t => `<div class="task" data-s="${t.status}"><span class="box"></span><span class="tt text-sm min-w-0" style="overflow-wrap:anywhere">${esc(t.title)}</span><span class="mono text-[10.5px] ${t.status === 'in_progress' ? 'text-yl' : t.status === 'done' ? 'text-ok' : 'text-dim'}">#${t.id} ${t.status.replace('_', ' ').toUpperCase()}</span></div>`).join('');
}
function persistTasks() { if (cur) { cur.tasks = tasks.items; cur.taskSeq = tasks.seq; saveSession(); } }

async function webSearch(query, max = 5) {
  max = Math.min(Math.max(1, max | 0 || 5), 10);
  const order = S.search === 'auto' ? [S.ollamaKey && 'ollama', S.searx && 'searxng', 'ddg', 'wikipedia'].filter(Boolean) : [S.search];
  const errors = [];
  for (const p of order) {
    try {
      let res = [];
      if (p === 'ollama') {
        if (!S.ollamaKey) throw new Error('no Ollama API key set');
        const r = await fetch('https://ollama.com/api/web_search', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.ollamaKey }, body: JSON.stringify({ query, max_results: max }) });
        if (!r.ok) throw new Error('HTTP ' + r.status); res = ((await r.json()).results || []).map(x => ({ title: x.title, url: x.url, snippet: (x.content || '').slice(0, 600) }));
      } else if (p === 'searxng') {
        if (!S.searx) throw new Error('no SearXNG URL set');
        const r = await fetch(S.searx.replace(/\/+$/, '') + '/search?format=json&q=' + encodeURIComponent(query)); if (!r.ok) throw new Error('HTTP ' + r.status);
        res = ((await r.json()).results || []).slice(0, max).map(x => ({ title: x.title, url: x.url, snippet: x.content || '' }));
      } else if (p === 'ddg') {
        const r = await fetch('https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=' + encodeURIComponent(query)); if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json();
        if (j.AbstractText) res.push({ title: j.Heading || query, url: j.AbstractURL, snippet: j.AbstractText });
        const flat = (j.RelatedTopics || []).flatMap(t => t.Topics || [t]); for (const t of flat) if (t.FirstURL) res.push({ title: (t.Text || '').split(' - ')[0], url: t.FirstURL, snippet: t.Text || '' });
        res = res.slice(0, max);
      } else if (p === 'wikipedia') {
        const r = await fetch('https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=' + max + '&srsearch=' + encodeURIComponent(query)); if (!r.ok) throw new Error('HTTP ' + r.status);
        res = ((await r.json()).query?.search || []).map(x => ({ title: x.title, url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(x.title.replace(/ /g, '_')), snippet: x.snippet.replace(/<[^>]+>/g, '') }));
      }
      if (!res.length) throw new Error('no results');
      return `Results from ${p}:\n\n` + res.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet.replace(/\s+/g, ' ').trim()}`).join('\n\n');
    } catch (e) { errors.push(`${p}: ${e.message === 'Failed to fetch' ? 'blocked (network/CORS)' : e.message}`); }
  }
  throw new Error('web search failed — ' + errors.join('; ') + '. Configure a provider in Config → Web search.');
}
async function webFetch(url) {
  if (!/^https?:\/\//.test(url)) throw new Error('url must start with http:// or https://');
  if (S.ollamaKey) {
    try { const r = await fetch('https://ollama.com/api/web_fetch', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.ollamaKey }, body: JSON.stringify({ url }) }); if (r.ok) { const j = await r.json(); return truncateHead(`# ${j.title || url}\n\n${j.content || ''}`); } } catch {}
  }
  const r = await fetch('https://r.jina.ai/' + url, { headers: { 'X-Return-Format': 'markdown' } });
  if (!r.ok) throw new Error(`fetch failed: HTTP ${r.status}`);
  return truncateHead(await r.text());
}

async function runTool(name, args, ui) {
  const P = p => vfs.norm(p || '', '/');
  switch (name) {
    case 'read': {
      const p = readPath(args.path); const text = vfs.read(p); const L = text.split('\n');
      const off = Math.max(1, args.offset | 0 || 1); const lim = args.limit | 0 || MAX_LINES;
      let slice = L.slice(off - 1, off - 1 + lim).join('\n'); let s = truncateHead(slice);
      const shown = Math.min(L.length, off - 1 + lim); if (shown < L.length) s += `\n\n[${L.length - shown} more lines. Use offset=${shown + 1} to continue.]`;
      return s;
    }
    case 'write': { const p = writePath(args.path); const content = String(args.content ?? ''); vfs.write(p, content, { mkdirs: true }); ui?.setPreview?.(content, p); return `Successfully wrote ${enc.encode(content).length} bytes to ${p}`; }
    case 'edit': {
      const p = readPath(args.path); const text = vfs.read(p); const oldT = String(args.oldText ?? ''), newT = String(args.newText ?? '');
      if (!oldT) throw new Error('oldText must not be empty');
      const count = text.split(oldT).length - 1;
      if (count === 0) throw new Error(`Could not find the exact text in ${p}. oldText must match exactly, including whitespace and newlines. Read the file and try again.`);
      if (count > 1) throw new Error(`Found ${count} occurrences of the text in ${p}. Include more surrounding context so oldText is unique.`);
      const idx = text.indexOf(oldT); vfs.write(p, text.slice(0, idx) + newT + text.slice(idx + oldT.length));
      const line = text.slice(0, idx).split('\n').length; ui?.setDiff?.(oldT, newT, line);
      return `Successfully replaced text in ${p} (at line ${line}).`;
    }
    case 'bash': {
      const sh = new Shell({}); sh.timeoutMs = Math.min(Math.max(1, +args.timeout || 60), 600) * 1000;
      const cmd = String(args.command ?? '');
      term.write(`\r\x1b[K\x1b[38;2;255;61;79m▍agent\x1b[0m \x1b[38;2;255;184;198m/\x1b[0m$ ${cmd.replace(/\n/g, '\r\n  ')}\r\n`);
      sh.onOutput = (s, err) => termPrint(s, err);
      agentShell = sh;
      const t0 = Date.now(); const r = await Promise.race([sh.run(cmd), sleep(sh.timeoutMs + 2000).then(() => { sh.aborted = true; return { chunks: [{ s: `timed out after ${sh.timeoutMs / 1000}s\n`, err: true }], code: 124 }; })]);
      agentShell = null;
      if (!termState.busy) redraw();
      let out = r.chunks.map(c => c.s).join(''); out = truncateTail(out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''));
      if (!out.trim()) out = '(no output)';
      if (r.code !== 0) out += `\n\nCommand exited with code ${r.code}`;
      ui?.meta?.(`${((Date.now() - t0) / 1000).toFixed(1)}s · exit ${r.code}`);
      if (r.code !== 0) ui?.softErr?.();
      return out;
    }
    case 'tasks': {
      const a = args.action;
      if (a === 'add') { const titles = Array.isArray(args.titles) ? args.titles : (args.title ? [args.title] : []); if (!titles.length) throw new Error('add needs titles'); for (const t of titles) tasks.items.push({ id: ++tasks.seq, title: String(t), status: 'pending' }); }
      else if (a === 'update') { const t = tasks.items.find(x => x.id === +args.id); if (!t) throw new Error(`no task #${args.id}`); if (args.status) t.status = args.status; if (args.title) t.title = args.title; }
      else if (a === 'remove') { const i = tasks.items.findIndex(x => x.id === +args.id); if (i < 0) throw new Error(`no task #${args.id}`); tasks.items.splice(i, 1); }
      else if (a === 'clear') { tasks.items = []; }
      else if (a !== 'list') throw new Error(`unknown action ${a}`);
      renderTasks(); persistTasks(); if (a === 'add') flashTab('tasks');
      return tasksText();
    }
    case 'web_search': return await webSearch(String(args.query || ''), args.max_results);
    case 'web_fetch': return await webFetch(String(args.url || ''));
    case 'memory': return memoryTool(args);
    case 'skill': return skillTool(args);
    case 'notes_search': {
      const q = String(args.query || '').trim(); const idx = vaultIndex();
      if (!q) {
        const folders = {}; for (const p of idx.notes) { const d = vfs.parent(p); folders[d] = (folders[d] || 0) + 1; }
        const top = [...idx.back].sort((a, b) => b[1].size - a[1].size).slice(0, 8).filter(x => x[1].size).map(([p, s]) => `${noteName(p)} (${s.size})`);
        let links = 0; for (const s of idx.out.values()) links += s.size;
        return `${idx.notes.length} notes, ${links} links, ${idx.words} words.\nFolders: ${Object.entries(folders).map(([d, n]) => `${d} (${n})`).join(', ')}\nTags: ${[...idx.tags].map(([t, s]) => `#${t} (${s.size})`).join(', ') || 'none'}\nMost linked: ${top.join(', ') || 'none'}\nNotes:\n${idx.notes.slice(0, 200).join('\n')}${idx.notes.length > 200 ? `\n… ${idx.notes.length - 200} more` : ''}`;
      }
      const res = searchNotes(q, Math.min(+args.limit || 10, 30));
      return res.length ? res.map(r => `${r.path}  →  [[${linkName(r.path)}]]\n  ${r.snippet}`).join('\n') : `No notes match "${q}".`;
    }
    case 'note_links': {
      const a = String(args.note || args.path || ''); const p = vfs.isFile(P(a)) ? P(a) : resolveNote(a, null);
      if (!p) throw new Error(`No note named "${a}". Use notes_search to find it.`);
      const idx = vaultIndex(); const back = [...(idx.back.get(p) || [])], out = [...(idx.out.get(p) || [])], miss = [...(idx.missing.get(p) || [])];
      return `${p}  ([[${linkName(p)}]])\nBacklinks (${back.length}):\n${back.map(q => `- ${q}: ${linkContext(q, p).slice(0, 160)}`).join('\n') || '- none'}\nOutgoing (${out.length}):\n${out.map(q => '- ' + q).join('\n') || '- none'}\nUnresolved (${miss.length}):\n${miss.map(m => `- [[${m}]]`).join('\n') || '- none'}\nTags: ${noteTags(p).map(t => '#' + t).join(' ') || 'none'}`;
    }
    case 'open_note': {
      const a = String(args.note || args.path || ''); const p = vfs.isFile(P(a)) ? P(a) : resolveNote(a, null);
      if (!p) throw new Error(`No note named "${a}". Write it first, then open it.`);
      openFile(p, { mode: ['read', 'edit', 'split'].includes(args.mode) ? args.mode : 'read' });
      return `Opened ${p} on the user's screen.`;
    }
    case 'decide': return await ollayaDecide(args);
    case 'schedule': return scheduleTool(args);
    default: if (mcpHandles(name)) return await mcpRunTool(name, args, ui); throw new Error(`Unknown tool: ${name}`);
  }
}
let agentShell = null;

/* =====================================================================
   SESSIONS
   ===================================================================== */
let sessions = []; // meta: {id,title,updated}
let cur = null;    // {id,title,messages,tasks,taskSeq}
async function loadSessions() { sessions = (await idb.get('sessions')) || []; }
const saveSession = (() => { let t; return () => { if (window.__restoring) return; clearTimeout(t); t = setTimeout(async () => { if (!cur) return; if (!cur.messages.length && !sessions.find(s => s.id === cur.id)) { renderSessions(); return; } cur.updated = Date.now(); await idb.set('session:' + cur.id, cur); const m = sessions.find(s => s.id === cur.id); if (m) { m.title = cur.title; m.updated = cur.updated; } else sessions.unshift({ id: cur.id, title: cur.title, updated: cur.updated }); sessions.sort((a, b) => b.updated - a.updated); await idb.set('sessions', sessions); renderSessions(); }, 250); }; })();
function newSession() { if (cur?.messages?.length) journalSession(cur); cur = { id: uid(), title: 'New session', messages: [], tasks: [], taskSeq: 0, updated: Date.now() }; tasks.items = []; tasks.seq = 0; renderTasks(); renderChat(); renderSessions(); ls.set('lastSession', cur.id); }
async function openSession(id) { if (cur?.messages?.length && cur.id !== id) journalSession(cur); const s = await idb.get('session:' + id); if (!s) return newSession(); cur = s; tasks.items = s.tasks || []; tasks.seq = s.taskSeq || 0; renderTasks(); renderChat(); renderSessions(); ls.set('lastSession', id); setView('chat'); }
function renderSessions() {
  const list = [...sessions]; if (cur && !list.find(s => s.id === cur.id)) list.unshift({ id: cur.id, title: cur.title, _unsaved: true });
  $('#sessList').innerHTML = list.map(s => `<div class="sess-row"><button class="sess ${cur && s.id === cur.id ? 'on' : ''}" data-id="${s.id}" title="${esc(s.title)}">${esc(s.title)}</button>${s._unsaved ? '' : `<button class="sess-x" data-del="${s.id}" title="Delete this chat" aria-label="Delete chat ${esc(s.title)}">✕</button>`}</div>`).join('') || '<div class="px-3 text-xs text-dim">No sessions yet</div>';
  renderChatBar();
}
$('#sessList').addEventListener('click', e => {
  const x = e.target.closest('.sess-x');
  if (x) {
    if (!x.classList.contains('armed')) { $$('.sess-x.armed').forEach(b => { b.classList.remove('armed'); b.textContent = '✕'; }); x.classList.add('armed'); x.textContent = 'DELETE?'; setTimeout(() => { if (x.isConnected) { x.classList.remove('armed'); x.textContent = '✕'; } }, 3500); return; }
    deleteSession(x.dataset.del); return;
  }
  const b = e.target.closest('.sess'); if (b && !running) openSession(b.dataset.id);
});
async function deleteSession(id) {
  if (running && cur?.id === id) { toast('Stop the agent before deleting this chat.', 'err'); return; }
  const title = (sessions.find(s => s.id === id) || cur || {}).title || 'chat';
  await idb.del('session:' + id); sessions = sessions.filter(s => s.id !== id); await idb.set('sessions', sessions);
  if (cur?.id === id) { cur = null; if (sessions[0]) await openSession(sessions[0].id); else newSession(); } else renderSessions();
  toast(`Deleted "${esc(title)}"`, 'ok');
}
async function deleteAllSessions() {
  if (running) { toast('Stop the agent first.', 'err'); return; }
  for (const s of sessions) await idb.del('session:' + s.id);
  const n = sessions.length; sessions = []; await idb.set('sessions', []); cur = null; newSession();
  toast(`Deleted ${n} chat${n === 1 ? '' : 's'}`, 'ok');
}
function renameSession(title) {
  if (!cur) return; title = String(title || '').trim().slice(0, 80);
  if (!title) return; cur.title = title; cur._named = true;
  const m = sessions.find(s => s.id === cur.id); if (m) m.title = title;
  saveSession(); renderSessions();
}
function chatMarkdown() {
  if (!cur) return '';
  const out = [`# ${cur.title}`, ''];
  for (const m of cur.messages) {
    if (m.role === 'user') out.push('## You', '', m.content, '');
    else if (m.role === 'assistant') {
      if (m.content) out.push('## Jade', '', m.content, '');
      for (const tc of m.tool_calls || []) out.push('```tool', `${tc.function.name} ${JSON.stringify(tc.function.arguments)}`, '```', '');
      if (m._error) out.push(`> Error: ${m._error}`, '');
    } else if (m.role === 'compaction') out.push(`> **Context compacted** (${m.compacted} messages summarised)`, '', m.summary, '');
    else if (m.role === 'tool') out.push(`<details><summary>${m.tool_name} result</summary>`, '', '```', String(m.content).slice(0, 4000), '```', '', '</details>', '');
  }
  return out.join('\n');
}
let delChatArmed = false;
function renderChatBar() {
  $('#chatTitle').textContent = cur?.title || 'New session';
  const n = cur ? cur.messages.filter(m => m.role === 'user').length : 0;
  $('#chatMeta').textContent = n ? `${n} prompt${n > 1 ? 's' : ''}` : 'empty';
  delChatArmed = false; const d = $('#btnDelChat'); d.classList.remove('armed'); d.textContent = 'Delete';
}

/* =====================================================================
   CHAT RENDERING
   ===================================================================== */
const chatEl = $('#chat');
window.marked?.setOptions?.({ gfm: true, breaks: false });
function md(text, final = true) {
  // degrade to escaped text if the markdown/sanitiser CDNs did not load (flaky mobile data, blockers)
  const html = window.marked && window.DOMPurify ? DOMPurify.sanitize(marked.parse(text || '')) : `<p style="white-space:pre-wrap">${esc(text || '')}</p>`;
  const div = document.createElement('div'); div.className = 'md'; div.innerHTML = html;
  for (const a of div.querySelectorAll('a')) {
    if (a.classList.contains('wiki-link') || a.classList.contains('tag-chip')) continue;
    const h = a.getAttribute('href') || '';
    if (h.startsWith('#')) { a.classList.add('wiki-link'); a.dataset.wiki = ''; a.dataset.heading = decodeURIComponent(h.slice(1)).replace(/-/g, ' '); continue; }
    if (!/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(h) && /\.(md|markdown)(#.*)?$/i.test(h)) { let t = h.split('#')[0]; try { t = decodeURIComponent(t); } catch {} a.classList.add('wiki-link'); a.dataset.wiki = t; if (h.includes('#')) a.dataset.heading = h.split('#')[1]; if (!resolveNote(t, Vault.renderFrom)) a.classList.add('missing'); continue; }
    a.target = '_blank'; a.rel = 'noopener noreferrer';
  }
  for (const code of div.querySelectorAll('pre > code.language-math, pre > code.language-latex, pre > code.language-tex, pre > code.language-katex')) { const d = document.createElement('div'); d.className = 'math-tex'; d.dataset.display = '1'; d.dataset.tex = code.textContent.trim(); code.parentElement.replaceWith(d); }
  for (const el of div.querySelectorAll('.math-tex')) renderTex(el);
  for (const pre of div.querySelectorAll('pre')) {
    const code = pre.querySelector('code'); if (final && code && window.hljs) { try { hljs.highlightElement(code); } catch {} }
    const b = document.createElement('button'); b.className = 'copy-btn'; b.textContent = 'COPY'; b.type = 'button';
    b.onclick = () => copyText(code ? code.innerText : pre.innerText, b); pre.appendChild(b);
  }
  return div;
}
async function copyText(s, btn) { try { await navigator.clipboard.writeText(s); if (btn) { const o = btn.textContent; btn.textContent = 'COPIED'; setTimeout(() => btn.textContent = o, 1200); } } catch { toast('Copy was blocked here. Select the text and copy it manually.', 'err'); } }
const atBottom = () => chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 80;
const scrollDown = (force) => { if (force || stick) chatEl.scrollTop = chatEl.scrollHeight; };
let stick = true; chatEl.addEventListener('scroll', () => { stick = atBottom(); });

function userBlock(text, idx) {
  const el = document.createElement('div'); el.className = 'msg-user flex flex-col gap-1'; el.dataset.i = idx ?? '';
  const um = idx != null && idx !== '' ? cur?.messages?.[idx] : null;
  el.innerHTML = `<div class="who">You</div><div class="bubble cut cut-sm"></div>${um?.attachments ? attachmentChips(um.attachments) : ''}<div class="msg-actions"><button type="button" data-uact="edit">Edit</button><button type="button" data-uact="copy">Copy</button></div>`; el.querySelector('.bubble').textContent = text; return el;
}
function aiBlock() {
  const el = document.createElement('div'); el.className = 'msg-ai flex flex-col gap-2';
  el.innerHTML = `<div class="who flex items-center gap-2"><span>◆ Jade</span><span class="mono text-[10px] text-dim tracking-normal normal-case" data-model></span></div><div class="flex flex-col gap-2" data-body></div>`;
  return el;
}
const SUMMARY = {
  read: a => a.path + (a.offset ? `:${a.offset}` : ''), write: a => a.path, edit: a => a.path, bash: a => '$ ' + (a.command || '').split('\n')[0],
  tasks: a => a.action + (a.titles ? ` (${a.titles.length})` : a.id ? ` #${a.id}${a.status ? ' → ' + a.status : ''}` : ''), web_search: a => `"${a.query}"`, web_fetch: a => a.url,
  decide: a => `${a.type || 'choice'}: ${a.question || ''}`, codemode: a => (String(a.code || '').split('\n').find(l => l.trim() && !/^\s*\/\/\s*@options/.test(l)) || '').trim().slice(0, 90), tool_search: a => `"${a.query || ''}"`, read_mcp_resource: a => `${a.server} ${a.uri}`, skill: a => a.name || '', memory: a => `${a.action || ''}${a.text ? ' “' + String(a.text).slice(0, 60) + '”' : ''}`, notes_search: a => a.query ? `"${a.query}"` : 'overview', note_links: a => a.note || a.path || '', open_note: a => a.note || a.path || '',
  schedule: a => `${a.action}${(a.when || a.cron) ? ' ' + (a.when || a.cron) : ''}${a.name ? ' "' + a.name + '"' : a.id ? ' #' + a.id : ''}`
};
function toolCard(name, args) {
  const d = document.createElement('details'); d.className = 'tool run';
  const sum = (SUMMARY[name] || (a => JSON.stringify(a)))(args || {});
  d.innerHTML = `<summary><span class="tname">${esc(name)}</span><span class="targ">${esc(sum)}</span><span class="tstat text-yl">RUNNING</span></summary><div data-extra></div><pre data-out></pre>`;
  const out = d.querySelector('[data-out]'), stat = d.querySelector('.tstat'), extra = d.querySelector('[data-extra]');
  out.hidden = true;
  if (name === 'bash' && args?.command?.includes('\n')) { extra.innerHTML = `<pre class="text-cy">${esc(args.command)}</pre>`; }
  let metaTxt = '';
  return {
    el: d,
    meta: t => metaTxt = t,
    softErr: () => d.classList.add('err'),
    setPreview(content, p) { const lines = content.split('\n'); const lang = (p.split('.').pop() || '').toLowerCase(); const pre = document.createElement('pre'); const code = document.createElement('code'); code.textContent = lines.slice(0, 80).join('\n') + (lines.length > 80 ? `\n… ${lines.length - 80} more lines` : ''); if (window.hljs && hljs.getLanguage(lang === 'js' ? 'javascript' : lang)) { code.className = 'language-' + (lang === 'js' ? 'javascript' : lang); try { hljs.highlightElement(code); } catch {} } pre.appendChild(code); extra.appendChild(pre); },
    setDiff(o, n, line) { const pre = document.createElement('pre'); pre.innerHTML = `<span class="text-dim">@@ line ${line} @@</span>\n` + o.split('\n').map(l => `<span class="diff-del">- ${esc(l)}</span>`).join('') + n.split('\n').map(l => `<span class="diff-add">+ ${esc(l)}</span>`).join(''); extra.appendChild(pre); d.open = true; },
    done(result, isErr) {
      d.classList.remove('run'); if (isErr) d.classList.add('err');
      const err = d.classList.contains('err');
      stat.textContent = (err ? 'ERR' : 'OK') + (metaTxt ? ' · ' + metaTxt : ''); stat.style.color = err ? 'var(--rd)' : 'var(--ok)';
      const s = String(result); out.textContent = s.length > 20000 ? s.slice(0, 20000) + '\n…' : s; out.hidden = false;
      if (isErr) d.open = true;
    }
  };
}
function renderChat() {
  chatEl.innerHTML = '';
  if (!cur || !cur.messages.length) return renderEmpty();
  const msgs = cur.messages; let ai = null;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === 'compaction') { ai = null; chatEl.appendChild(compactEl(m)); continue; }
    if (m.role === 'user') { ai = null; chatEl.appendChild(userBlock(m.display || m.content, i)); continue; }
    if (m.role === 'assistant') {
      if (!ai) { ai = aiBlock(); chatEl.appendChild(ai); if (m.model) ai.querySelector('[data-model]').textContent = m.model; }
      const body = ai.querySelector('[data-body]');
      if (m.thinking) body.appendChild(thinkEl(m.thinking, false));
      if (m.content) body.appendChild(md(m.content));
      for (const tc of m.tool_calls || []) {
        const card = toolCard(tc.function.name, tc.function.arguments); body.appendChild(card.el);
        const res = msgs.slice(i + 1).find(x => x.role === 'tool' && x._for === tc._id) || null;
        if (tc.function.name === 'edit' && tc.function.arguments) card.setDiff(tc.function.arguments.oldText || '', tc.function.arguments.newText || '', '?'), card.el.open = false;
        card.done(res ? res.content : '(no result)', res?._err);
      }
      if (m._error) body.appendChild(errorEl(m._error));
    }
  }
  scrollDown(true);
}
function thinkEl(text, open) { const d = document.createElement('details'); d.open = !!open; d.innerHTML = `<summary class="mono text-[11px] text-rd tracking-widest">▸ NEURAL TRACE</summary><div class="think mt-1"></div>`; d.querySelector('.think').textContent = text; return d; }
function errorEl(msg) { const e = document.createElement('div'); e.className = 'tool err'; e.innerHTML = `<div class="p-3 pl-4 text-sm"><span class="tname" style="color:var(--rd)">Error</span><div class="mono text-xs mt-1" style="white-space:pre-wrap">${esc(msg)}</div></div>`; return e; }

function renderEmpty(connErr) {
  if (cur && cur.messages.length) return;
  const ok = !!models.length; const host = S.host || DEFAULTS.host;
  const corsCmd = `OLLAMA_ORIGINS="*" ollama serve`;
  chatEl.innerHTML = `
  <div class="my-auto mx-auto w-full flex flex-col gap-6" style="max-width:720px">
    <div class="flex flex-col gap-2">
      <div class="mono text-[11px] tracking-[.3em] text-rd">// JACK INTO THE VAULT</div>
      <h1 class="disp text-yl font-bold leading-none" style="font-size:clamp(30px,5vw,48px);text-shadow:3px 0 rgba(255,61,79,.55),-3px 0 rgba(255,184,198,.45);text-wrap:balance">A second brain that lives in this tab.</h1>
      <p class="text-[15px] text-[#c2d6ce] leading-relaxed" style="max-width:60ch">Markdown notes with [[wiki links]], backlinks, tags and a graph, stored on this device. Jade (your local Ollama model) searches, writes and links them with her tools, and still has the full BusyBox shell.</p>
    </div>
    <div class="frame cut"><div class="inner p-4 flex flex-col gap-3">
      <div class="pane-h">Boot sequence</div>
      <div class="check-row"><span class="dot ${ok ? 'ok' : 'bad'} mt-1.5"></span><div class="min-w-0"><b>${activeProv === 'local' ? `Ollama at <span class="mono text-cy">${esc(host)}</span>` : esc(PROVIDERS[activeProv].label) + (activeProv !== (S.provider || 'local') ? ' <span class="text-dim">(fallback)</span>' : '')}</b> — ${ok ? `${models.length} model${models.length > 1 ? 's' : ''} found` : 'not reachable'}${!ok ? `<div class="text-dim text-[13px] mt-1">${activeProv === 'local' ? `Start Ollama so it accepts requests from this page, then press Retry:<div class="mono text-yl text-xs mt-1 break-all">${esc(corsCmd)}</div>${providerChain().length > 1 ? '' : '<div class="mt-1">Away from your computer? Pick Ollama Cloud or Groq in Config (as the provider, or as a fallback).</div>'}` : 'Check the API key in Config, then press Retry.'}${connErr ? `<div class="mono text-[11px] mt-1 text-rd">${esc(connErr.message || connErr)}</div>` : ''}</div>` : ''}</div></div>
      <div class="check-row"><span class="dot ${S.model ? 'ok' : 'bad'} mt-1.5"></span><div><b>Model</b> — ${S.model ? `<span class="mono text-cy">${esc(S.model)}</span>` : 'none selected (pull one with tool support, e.g. <span class="mono text-yl">ollama pull qwen3</span>)'}</div></div>
      <div class="check-row"><span class="dot ok mt-1.5"></span><div><b>Vault</b> — ${(() => { const i = vaultIndex(); let l = 0; for (const x of i.out.values()) l += x.size; return `${i.notes.length} notes, ${l} links`; })()} · <a href="#" class="text-cy underline" data-act="notes">open Notes</a></div></div>
      <div class="check-row"><span class="dot ${bb.module ? 'ok' : 'busy'} mt-1.5"></span><div><b>Shell</b> — ${bb.module ? `BusyBox 1.37 WASM, ${bb.applets.size} applets plus JS extras` : 'starting BusyBox WASM… (JS applets meanwhile)'}</div></div>
      <div class="flex gap-2 flex-wrap mt-1"><button class="btn" data-act="retry">Retry link</button><button class="btn btn-cy" data-act="config">Open config</button></div>
    </div></div>
    <div class="flex flex-col gap-2">
      <div class="lbl">Example jobs</div>
      <div class="grid gap-2" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
        ${[['Sort my Inbox', 'Read Inbox.md and turn each item into its own short note with [[links]] back to the Inbox. Then tidy the Inbox.'],
           ['Daily review', "Open today's daily note (create it if needed), list my open tasks from every note, and add a short plan for today."],
           ['Map of content', 'Build a note called "Map of Content" that links every note in the vault, grouped by tag, and open it.'],
           ['Research note', 'Search the web for spaced repetition techniques and write a note with sources, tagged #learning and linked from Project Neon.']]
          .map(([t, p]) => `<button class="example cut cut-sm" data-prompt="${esc(p)}"><div class="disp text-yl font-bold text-[13px]">${t}</div><div class="text-[12.5px] text-dim mt-1 leading-snug">${esc(p)}</div></button>`).join('')}
      </div>
    </div>
  </div>`;
}
chatEl.addEventListener('click', e => {
  const ex = e.target.closest('.example'); if (ex) { $('#input').value = ex.dataset.prompt; autosize(); $('#input').focus(); return; }
  const a = e.target.closest('[data-act]'); if (!a) return;
  e.preventDefault(); if (a.dataset.act === 'retry') connect(); else if (a.dataset.act === 'notes') setTab('files'); else openSettings();
});

/* =====================================================================
   AGENT LOOP
   ===================================================================== */
const systemPrompt = () => { const vi = vaultIndex(); const vl = vi.notes.length; const steer = steering(); return `${steer.system || `You are Jade, the keeper of the user's personal knowledge vault: a folder of markdown notes linked together like Obsidian. Your main job is helping the user capture, find, organise, connect and think with their notes. You run entirely inside the user's browser and can also read, write, edit and run code in the same filesystem.`}

Vault conventions:
- Every note is a .md file. Folders are optional. Link notes with [[Note Name]] (no .md and no folder needed), [[Note Name|label]] or [[Note Name#Heading]]. Tags are #words.
- New notes start with "# Title". Add [[links]] to related notes, and add a link back where it helps. Search first so you do not create duplicates.
- Math renders with KaTeX: write $inline$ or $$display$$ LaTeX (never inside backticks).\n- Your heartbeat checklist is /Jade/HEARTBEAT.md: when the user wants you to keep an eye on something regularly, add a short line under its Check heading (use schedule instead for exact times).\n- Files the user attaches in chat are saved under /attachments/YYYY-MM-DD/; PDFs get a .pdf.md text note next to them.\n- MCP servers are configured in /Jade/mcp.json (streamable HTTP url, optional headers, exposure codemode|deferred|direct|hidden); the shell command mcp add/list/tools manages them.\n- Daily notes live at /daily/YYYY-MM-DD.md. Quick captures go in /Inbox.md. Tasks are "- [ ] item" lines.
- When you mention a note in a reply, write it as [[Note Name]] so the user can tap it.
- Vault now: ${vl} notes, tags: ${[...vi.tags.keys()].slice(0, 25).map(t => '#' + t).join(' ') || 'none'}.${vl && vl <= 60 ? `\nNotes: ${vi.notes.join(', ')}` : ''}${memoryContext()}

Environment:
- Virtual filesystem rooted at /, persisted in the browser. Work relative to /.
- bash runs a ${bb.module ? `BusyBox 1.37 (WebAssembly) shell. BusyBox applets: ${[...bb.applets].filter(a => !JS_ONLY.has(a)).join(' ')}. Also: node, diff, xargs, sh -c, and vault commands search, tags, links, backlinks, open` : 'BusyBox-compatible shell (JS applets) with vault commands search, tags, links, backlinks, open'}: pipes, redirects, &&, ||, ;, $VAR, $(...) and globs work. There are no loops or if blocks, no network access and no package managers. Each bash call starts at /; cd does not persist between calls. Quote paths with spaces.
- "node file.js" or node -e "code" runs JavaScript in a sandboxed worker with require('fs') (readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync, unlinkSync) and require('path'). Use node for bulk edits across many notes.\n- "python file.py" or python -c "code" runs MicroPython ${MPY_VER} on the same files (open(), os.listdir, os.remove work on the vault). It has json, re, math, random, collections, os, time, hashlib, struct, binascii, heapq, io; there is no pip, numpy or requests. Prefer python when the user asks for Python.
- Today's date: ${new Date().toISOString().slice(0, 10)}.

Tools:
- notes_search: find notes by words or #tag; empty query = vault overview
${S.memoryOn ? '- memory: your long-term memory across chats (save / search / forget / list)\n' : ''}- skill: load a skill's instructions by name\n- note_links: backlinks, outgoing and unresolved links and tags of one note
- open_note: show a note on the user's screen
- read / write / edit: read, create or change notes and other files (write creates folders)
- bash: shell commands (ls, find, grep, sed, wc, node, search, tags, ...)
- tasks: maintain a visible task list for multi-step work
- schedule: create/list/pause/delete scheduled prompts and reminders. "when" is plain English ("every day at 9am", "in 20 minutes", "tomorrow at 7pm") in the user's time zone ${TZ}; never ask the user for cron. They run only while the app is open
- web_search / web_fetch: look things up on the web${S.ollayaOn && S.ollayaModel ? '\n- decide: ask the local Ollaya decision model to classify, score or answer yes/no about a piece of text (returns probabilities)' : ''}${steer.system ? '' : `

Guidelines:
- Look before you change things: notes_search or read the note first. Use edit for small changes (oldText must match exactly), write for new notes or full rewrites.
- Keep the user's words. When reorganising, move or link content rather than deleting it.
- Never create a second note with the same name as an existing one; edit the existing note. Paths may omit .md.${S.memoryOn ? '\n- Memory: when the user tells you something lasting about themselves, a preference, a project or person, or says "remember", call memory save with one short fact. When they mention an earlier conversation or ask what you know, use memory search. Memory is for facts about the user; notes are for their content.' : ''}
- For work with three or more steps, add tasks first, set each to in_progress when you start it and done when finished.
- Be concise. When finished, say which notes changed, as [[links]].`}${steeringContext(steer)}${mcpPromptBlock()}`; };

let running = false; const queue = [];
function setState(s) { bgState(s); $('#hudState').textContent = s; $('#hudState').style.color = s === 'IDLE' ? '' : 'var(--yl)'; }
function setRunning(v) {
  running = v; const b = $('#btnSend');
  b.textContent = v ? 'Abort' : 'Send'; b.classList.toggle('btn-solid', !v); b.classList.toggle('btn-red', v);
  if (!v) { setState('IDLE'); scheduleJournal(); bgFinished(); } else { clearTimeout(journalT); bgSync(); }
}
let abortReq = false, currentIter = null;
function abort() { abortReq = true; try { currentIter?.abort?.(); } catch {} try { client?.abort?.(); } catch {} if (agentShell) agentShell.aborted = true; }

async function send(text) {
  $('#slashSuggest').hidden = true;
  text = text.trim(); if (!text && !ATT.pending.length) return;
  if (running) { queue.push(text); updateQueueNote(); return; }
  let content = text;
  if (/^\/skill:/i.test(text)) { content = expandSkillCommand(text); if (!content) return; }
  else if (text.startsWith('/')) return slash(text);
  await maybeRestorePrimary();
  if (!S.model) { toast('Pick a model first (Config → Ollama link).', 'err'); return; }
  if (!cur) newSession();
  if (!cur.messages.length) { chatEl.innerHTML = ''; if (!cur._named) cur.title = (text || '📎 ' + ATT.pending.map(a => a.name).join(', ')).slice(0, 60); }
  if (Jade.ready) Jade.nod();
  const umsg = composeUserMessage(text, content === text ? '' : content); cur.messages.push(umsg); chatEl.appendChild(userBlock(umsg.display || umsg.content, cur.messages.length - 1)); scrollDown(true); saveSession();
  await agentLoop();
  if (queue.length) { const next = queue.splice(0).join('\n\n'); updateQueueNote(); await send(next); }
}
function updateQueueNote() { const n = $('#queueNote'); n.hidden = !queue.length; n.textContent = `QUEUED ▸ ${queue.length} message${queue.length > 1 ? 's' : ''} will be delivered after the current tool round`; }


/* =====================================================================
   HISTORY COMPACTION — older turns are replaced (for the model only) by a summary.
   The full history stays in the chat. A marker message {role:'compaction', summary, keepFrom}
   records where the model's window now starts.
   ===================================================================== */
const COMPACT_SYS = `You are compacting a coding-agent conversation so the work can continue in a fresh context window. Write a concise but complete handoff summary in Markdown with exactly these sections:
## Goal
What the user wants overall.
## Progress
What has been done: files created or changed (exact paths), commands run and their outcomes.
## Key facts
Decisions, constraints, user preferences, important values, error messages, open questions.
## Current state
Where things stand right now.
## Next steps
What remains to do.
Keep exact file paths, function names, commands and numbers. Do not invent anything. Do not address the user.`;
function lastCompaction() { if (!cur) return null; for (let i = cur.messages.length - 1; i >= 0; i--) if (cur.messages[i].role === 'compaction') return cur.messages[i]; return null; }
const windowStart = () => lastCompaction()?.keepFrom ?? 0;
function userTurnStarts(from) { const r = []; cur.messages.forEach((m, i) => { if (i >= from && m.role === 'user') r.push(i); }); return r; }
function buildApiMessages() {
  const c = lastCompaction(), from = c ? c.keepFrom : 0;
  const out = [{ role: 'system', content: systemPrompt() }];
  if (c) out.push({ role: 'user', content: `[Summary of the earlier part of this conversation. It was compacted to save context; continue from it.]\n\n${c.summary}` },
                  { role: 'assistant', content: 'Understood. I have the summary of the earlier work and will continue from there.' });
  for (const m of cur.messages.slice(from)) {
    if (m.role === 'compaction') continue;
    if (m.role === 'assistant' && m._error && !m.content && !m.tool_calls) continue;
    const o = { role: m.role, content: m.content || '' };
    if (m.tool_calls) o.tool_calls = m.tool_calls.map(t => ({ function: t.function }));
    if (m.role === 'tool') o.tool_name = m.tool_name;
    if (m.images?.length && !cur._noImages) o.images = m.images;
    out.push(o);
  }
  return out;
}
function transcriptOf(msgs) {
  return msgs.map(m => {
    if (m.role === 'user') return `USER: ${m.display || m.content}`;
    if (m.role === 'assistant') {
      let s = m.content ? `ASSISTANT: ${m.content}` : '';
      for (const t of m.tool_calls || []) s += `\nASSISTANT called ${t.function.name} ${JSON.stringify(t.function.arguments).slice(0, 700)}`;
      if (m._error) s += `\n(ERROR: ${m._error})`;
      return s.trim();
    }
    if (m.role === 'tool') { const c = String(m.content || ''); return `TOOL RESULT ${m.tool_name}${m._err ? ' (error)' : ''}: ${c.length > 1600 ? c.slice(0, 1000) + ' … ' + c.slice(-500) : c}`; }
    return '';
  }).filter(Boolean).join('\n\n');
}
function compactEl(m) {
  const d = document.createElement('details'); d.className = 'compact-card';
  const why = m.reason === 'manual' ? 'by you' : m.reason === 'context' ? 'context window nearly full' : `after ${m.turns || '?'} turns`;
  d.innerHTML = `<summary><span class="compact-ic" aria-hidden="true">⟲</span><span>Context compacted</span><span class="hud">${m.compacted} messages summarised · ${esc(why)}</span></summary><div class="compact-body"></div>`;
  d.querySelector('.compact-body').appendChild(md(m.summary));
  return d;
}
let compacting = false;
async function compactHistory({ keepTurns = +S.compactKeep, reason = 'auto', mount = chatEl } = {}) {
  if (!cur || compacting) return null;
  const from = windowStart(); const starts = userTurnStarts(from);
  keepTurns = Math.max(0, keepTurns | 0);
  const keepFrom = keepTurns === 0 ? cur.messages.length : starts.length > keepTurns ? starts[starts.length - keepTurns] : -1;
  if (keepFrom <= from) { if (reason === 'manual') toast('Nothing to compact yet: the chat is shorter than the turns you keep.'); return null; }
  const prev = lastCompaction()?.summary;
  let text = transcriptOf(cur.messages.slice(from, keepFrom).filter(m => m.role !== 'compaction'));
  const budget = Math.max(6000, Math.round((+S.numCtx || 16384) * 2.4));   // ~0.6 of the window, in characters
  if (text.length > budget) text = '[…the earliest part was trimmed to fit…]\n' + text.slice(-budget);
  const content = (prev ? `Previous summary:\n${prev}\n\n---\nConversation since that summary:\n\n` : 'Conversation:\n\n') + text;
  compacting = true; const prevState = $('#hudState').textContent;
  setState('COMPACTING'); jadeMood('thinking'); jadeBubble('Compacting the conversation…');
  const note = document.createElement('div'); note.className = 'compact-card compact-pending'; note.innerHTML = '<span class="compact-ic">⟲</span> Compacting older turns into a summary…'; mount.appendChild(note); scrollDown(true);
  try {
    let r;
    try {
      r = await llmPost({ method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: S.model, stream: false, messages: [{ role: 'system', content: COMPACT_SYS }, { role: 'user', content }], options: { temperature: 0.2, num_ctx: +S.numCtx } }) });
    } catch (e) { throw new Error(`could not reach ${providerName()}`); }
    if (!r.ok) { let m = 'HTTP ' + r.status; try { m = (await r.json()).error || m; } catch {} throw new Error(m); }
    const j = await r.json();
    const summary = String(j.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (summary.length < 20) throw new Error('the model returned an empty summary');
    const marker = { role: 'compaction', summary, keepFrom, compacted: keepFrom - from, turns: starts.length, reason, at: Date.now(), model: S.model };
    cur.messages.push(marker); saveSession();
    note.replaceWith(compactEl(marker)); scrollDown();
    toast(`Compacted ${marker.compacted} messages into a summary`, 'ok');
    return marker;
  } catch (e) {
    note.remove(); toast(`Compaction failed: ${esc(e.message)}. The chat continues uncompacted.`, 'err'); return null;
  } finally { compacting = false; setState(prevState === 'COMPACTING' ? 'IDLE' : prevState); }
}

async function agentLoop() {
  const triedProv = new Set();
  setRunning(true); abortReq = false; stick = true;
  let runError = null, lastContent = '';
  if (S.compactAuto && userTurnStarts(windowStart()).length > +S.compactAfter) {
    // keep the last N finished turns plus the prompt that was just sent
    await compactHistory({ keepTurns: +S.compactKeep + 1, reason: 'auto' });
  }
  jadeMood('thinking'); jadeBubble('Thinking…');
  const ai = aiBlock(); ai.querySelector('[data-model]').textContent = S.model; chatEl.appendChild(ai); const body = ai.querySelector('[data-body]');
  let turns = 0; let think = S.think; let needCtxCompact = false;
  try {
    while (!abortReq) {
      if (needCtxCompact) { needCtxCompact = false; await compactHistory({ keepTurns: 1, reason: 'context', mount: body }); }
      if (turns >= S.maxTurns) { body.appendChild(errorEl(`Stopped after ${S.maxTurns} tool rounds (Config → Max tool rounds). Send "continue" to keep going.`)); break; }
      turns++; $('#hudTurn').textContent = turns; setState('THINKING');
      // steering: queued user messages get injected before the next model call
      if (turns > 1 && queue.length) { const q = queue.splice(0).join('\n\n'); updateQueueNote(); cur.messages.push({ role: 'user', content: q }); body.appendChild(userBlock(q)); }
      const apiMsgs = buildApiMessages();
      let content = '', thinking = '', calls = [], final = null;
      const thinkD = thinkEl('', true); thinkD.hidden = true; body.appendChild(thinkD);
      const textEl = document.createElement('div'); body.appendChild(textEl);
      let raf = 0; const paint = () => { raf = 0; if (thinking) { thinkD.hidden = false; thinkD.querySelector('.think').textContent = thinking; } if (content) { const n = md(content, false); n.classList.add('caret'); textEl.replaceChildren(n); } scrollDown(); };
      const req = { model: S.model, messages: apiMsgs, tools: activeTools(), stream: true, options: { temperature: +S.temperature, num_ctx: +S.numCtx } };
      if (think) req.think = true;
      const t0 = performance.now();
      try {
        currentIter = await client.chat(req);
        for await (const part of currentIter) {
          if (abortReq) break;
          const m = part.message || {};
          if (m.thinking) { thinking += m.thinking; if (Jade.mood !== 'thinking') jadeMood('thinking'); }
          if (m.content) { content += m.content; if (Jade.mood !== 'writing') { jadeMood('writing'); jadeBubble('Writing a reply…'); } }
          if (m.tool_calls?.length) calls.push(...m.tool_calls);
          if (part.done) final = part;
          if (!raf) raf = requestAnimationFrame(paint);
        }
      } catch (e) {
        cancelAnimationFrame(raf);
        if (abortReq || e.name === 'AbortError') break;
        const msg = String(e.message || e);
        if (think && /think/i.test(msg)) { think = false; thinkD.remove(); textEl.remove(); toast('This model does not support thinking mode; continuing without it.'); turns--; continue; }
        if (/image|vision|multimodal|multi-modal/i.test(msg) && apiMsgs.some(m => m.images) && !cur._noImages) { cur._noImages = true; thinkD.remove(); textEl.remove(); toast(`${esc(S.model)} cannot look at images, so they were left out. The files are still in the vault.`); turns--; continue; }
        if (/Failed to fetch|NetworkError|Load failed|did not answer|rate limit|HTTP 5\d\d|overloaded|unavailable|timed? ?out/i.test(msg) && providerChain().length > 1) {
          const from = PROVIDERS[activeProv].label; thinkD.remove(); textEl.remove(); jadeBubble(`Lost ${from}. Trying the next provider…`);
          if (await failover(triedProv)) { toast(`${esc(from)} failed (${esc(msg.slice(0, 80))}). Continuing on ${esc(PROVIDERS[activeProv].label)}.`, 'ok'); turns--; continue; }
        }
        let hint = msg;
        if (/does not support tools/i.test(msg)) hint = `${S.model} does not support tool calling. Pick a tool-capable model such as qwen3, gpt-oss, llama3.1 or mistral-small.`;
        else if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) hint = activeProv === 'local' ? `Could not reach Ollama at ${S.host}. Make sure it is running with OLLAMA_ORIGINS="*" so this page is allowed to call it${providerChain().length > 1 ? '' : ', or add fallback providers in Config'}.` : `Could not reach ${providerName()}. Check your internet connection and API key.`;
        body.appendChild(errorEl(hint)); cur.messages.push({ role: 'assistant', content: '', _error: hint }); saveSession(); runError = hint; break;
      }
      cancelAnimationFrame(raf); currentIter = null;
      if (!thinking) thinkD.remove(); else { thinkD.querySelector('.think').textContent = thinking; thinkD.open = false; }
      textEl.replaceChildren(...(content ? [md(content)] : []));
      const ctxUsed = final ? (final.prompt_eval_count || 0) + (final.eval_count || 0) : 0;
      if (S.compactAuto && calls.length && ctxUsed > (+S.numCtx) * (+S.compactPct || 85) / 100) needCtxCompact = true;
      if (final) { $('#hudCtx').textContent = `${fmtK((final.prompt_eval_count || 0) + (final.eval_count || 0))} / ${fmtK(+S.numCtx)}`; if (final.eval_count && final.eval_duration) $('#hudTps').textContent = (final.eval_count / (final.eval_duration / 1e9)).toFixed(1) + ' tok/s'; }
      else $('#hudTps').textContent = (content.length / 4 / ((performance.now() - t0) / 1000)).toFixed(1) + ' tok/s~';
      const asst = { role: 'assistant', content, model: S.model }; if (thinking) asst.thinking = thinking; if (content.trim()) lastContent = content;
      if (calls.length) asst.tool_calls = calls.map(c => ({ function: { name: c.function?.name, arguments: typeof c.function?.arguments === 'string' ? safeJson(c.function.arguments) : (c.function?.arguments || {}) }, _id: uid() }));
      cur.messages.push(asst); saveSession();
      if (abortReq || !calls.length) break;
      for (const tc of asst.tool_calls) {
        if (abortReq) break;
        const name = tc.function.name, args = tc.function.arguments || {};
        setState('TOOL ▸ ' + String(name).toUpperCase());
        jadeMood('working'); jadeBubble(toolCaption(name, args));
        const card = toolCard(name, args); body.appendChild(card.el); scrollDown();
        let result, isErr = false;
        try { result = await runTool(name, args, card); } catch (e) { result = 'Error: ' + (e.message || e); isErr = true; }
        if (isErr || card.el.classList.contains('err')) jadeMood('error', 1800, 'working');
        card.done(result, isErr); scrollDown();
        cur.messages.push({ role: 'tool', tool_name: name, content: String(result), _for: tc._id, _err: isErr || undefined }); saveSession();
      }
    }
    if (abortReq) { body.appendChild(errorEl('Aborted by operator.')); }
  } finally {
    setRunning(false); saveSession();
    if (abortReq) { jadeMood('idle'); jadeBubble('Stopped.', 'Jade', 2500); }
    else if (runError) { jadeMood('error', 6000); jadeBubble(runError, 'Jade', 9000); }
    else { jadeMood('happy', 4500); jadeReply(lastContent); }
  }
}
const safeJson = s => { try { return JSON.parse(s); } catch { return { _raw: s }; } };

function slash(text) {
  const [cmd, ...rest] = text.slice(1).split(/\s+/); const arg = rest.join(' ');
  if (cmd === 'new') { if (!running) newSession(); return; }
  if (cmd === 'model') { if (arg) { S.model = arg; saveSettings(); fillModelSelects(); toast(`Model set to ${esc(arg)}`, 'ok'); } else toast(`Model: ${esc(S.model || 'none')}. Available: ${esc(models.join(', ') || 'none')}`); return; }
  if (cmd === 'clear') { if (!running && cur) { cur.messages = []; saveSession(); renderChat(); } return; }
  if (cmd === 'rename') { if (arg) renameSession(arg); else startRename(); return; }
  if (cmd === 'delete') { if (cur) deleteSession(cur.id); return; }
  if (cmd === 'copy' || cmd === 'export') { copyText(chatMarkdown()).then?.(() => {}); toast('Chat copied as Markdown', 'ok'); return; }
  if (cmd === 'voice') { setVoice(!S.jadeVoice); return; }
  if (cmd === 'compact') { if (running) return toast('Wait for the agent to finish first.'); compactHistory({ keepTurns: arg !== '' && Number.isFinite(+arg) ? +arg : +S.compactKeep, reason: 'manual' }); return; }
  if (cmd === 'schedule' || cmd === 'schedules' || cmd === 'cron') { setTab('sched'); return; }
  if (cmd === 'help') { toast('<b>/new</b> new chat · <b>/rename name</b> · <b>/delete</b> this chat · <b>/copy</b> as Markdown · <b>/compact</b> summarise old turns · <b>/clear</b> messages · <b>/model name</b> · <b>/voice</b> toggle speech · <b>/schedule</b> scheduled prompts · <b>/remember text</b> · <b>/memory</b> open memory · <b>/journal</b> journal this chat now · <b>/skill:name</b> run a skill · <b>/skills</b> · <b>/export</b> [config] · <b>/heartbeat</b> [edit] · <b>/mcp</b> [reconnect] · <b>/soul</b> · <b>/agents</b> · <b>/config</b>'); return; }
  if (cmd === 'remember') { if (!arg) return toast('Usage: /remember something worth keeping'); try { toast(esc(memorySave(arg, 'notes').msg), 'ok'); } catch (e) { toast(esc(e.message), 'err'); } return; }
  if (cmd === 'memory') { ensureMemory(); openFile(MEM_PATH, { mode: 'read' }); return; }
  if (cmd === 'journal') { if (!cur?.messages.length) return toast('Nothing to journal in this chat yet.'); toast('Writing the journal…'); journalSession(cur); return; }
  if (cmd === 'skills') { const all = listSkills(); toast(all.length ? all.map(x => `<b>/skill:${esc(x.name)}</b>${x.off ? ' (off)' : ''}`).join(' · ') : 'No skills yet. Ask Jade to create one.'); return; }
  if (cmd === 'soul') { ensureSteering(); openFile(SOUL_PATH, { mode: 'edit' }); return; }
  if (cmd === 'agents') { ensureSteering(); openFile(agentsFiles()[0] || AGENTS_PATH, { mode: 'edit' }); return; }
  if (cmd === 'mcp') {
    const [sub, srvName] = rest;
    if (sub === 'reconnect') { const list = srvName ? [MCP.servers.get(srvName)].filter(Boolean) : [...MCP.servers.values()].filter(x => x.cfg.enabled !== false && x.state !== 'invalid'); Promise.all(list.map(mcpConnect)).then(() => toast(list.map(x => `${esc(x.name)}: ${esc(x.state)}`).join(' · ') || 'No servers', 'ok')); return; }
    openSettings(); setTimeout(() => $('#mcpSection').scrollIntoView({ block: 'start' }), 60); return;
  }
  if (cmd === 'heartbeat') { if (arg === 'edit') { ensureHeartbeatFile(); openFile(HB_PATH, { mode: 'edit' }); } else runHeartbeat({ manual: true }); return; }
  if (cmd === 'export') { exportBackup(arg === 'config' ? 'config' : 'full'); return; }
  if (cmd === 'config') return openSettings();
  toast(`Unknown command /${esc(cmd)}. Try /help.`, 'err');
}

/* =====================================================================
   NOTES: vault tree / search / editor + reader / links / graph
   ===================================================================== */
const openDirs = new Set(ls.get('openDirs', ['/']));
let selPath = null, editing = null, noteMode = ls.get('noteMode', 'read');
const noteHist = [];
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const linkName = (p) => { const n = noteName(p); const hits = vaultIndex().notes.filter(q => noteName(q).toLowerCase() === n.toLowerCase()); return hits.length > 1 ? p.slice(1).replace(/\.(md|markdown)$/i, '') : n; };

/* ---------- tree ---------- */
function renderTree() {
  const idx = vaultIndex(); const rows = [];
  const rec = (p, depth) => {
    const names = vfs.list(p);
    const dirs = names.filter(n => vfs.isDir(vfs.norm(n, p))), files = names.filter(n => !vfs.isDir(vfs.norm(n, p)));
    for (const n of [...dirs, ...files]) {
      const q = vfs.norm(n, p); const dir = vfs.isDir(q); const open = openDirs.has(q); const note = !dir && isNote(q);
      let right = '';
      if (note) { const b = idx.back.get(q)?.size || 0, o = idx.out.get(q)?.size || 0; right = `<span class="ml-auto flex gap-1 flex-none">${b ? `<span class="lk-badge" title="${b} backlinks">↙${b}</span>` : ''}${o ? `<span class="lk-badge out" title="${o} outgoing links">↗${o}</span>` : ''}</span>`; }
      else if (!dir) right = `<span class="ml-auto text-[10px] text-dim">${fmtSize(vfs.stat(q).size)}</span>`;
      rows.push(`<div class="tree-row ${selPath === q ? 'sel' : ''}" tabindex="0" role="button" data-p="${esc(q)}" style="padding-left:${10 + depth * 14}px"><span class="ic">${dir ? (open ? '▾' : '▸') : note ? '◆' : '·'}</span><span class="${dir ? 'text-yl' : note ? '' : 'text-dim'} truncate">${esc(note ? noteName(q) : n)}${dir ? '/' : ''}</span>${right}</div>`);
      if (dir && open) rec(q, depth + 1);
    }
  };
  rec('/', 0);
  $('#tree').innerHTML = rows.join('') || '<div class="px-3 text-xs text-dim">Empty vault. Tap + Note.</div>';
  let links = 0, miss = 0; for (const s of idx.out.values()) links += s.size; for (const s of idx.missing.values()) miss += s.size;
  $('#fsStats').innerHTML = `<b>${idx.notes.length}</b> notes · <b>${links}</b> links${miss ? ` · <span class="text-rd">${miss} unresolved</span>` : ''} · <b>${idx.words.toLocaleString()}</b> words`;
  renderTagBar();
}
let treeT; const renderTreeSoon = () => { clearTimeout(treeT); treeT = setTimeout(() => { renderTree(); if ($('#noteSearch').value.trim()) runVaultSearch(); }, 120); };
$('#tree').addEventListener('click', e => { const r = e.target.closest('.tree-row'); if (!r) return; const p = r.dataset.p; if (vfs.isDir(p)) { openDirs.has(p) ? openDirs.delete(p) : openDirs.add(p); ls.set('openDirs', [...openDirs]); renderTree(); } else openFile(p); });
$('#tree').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.closest('.tree-row')?.click(); });

/* ---------- tags + search ---------- */
function renderTagBar() {
  const tags = [...vaultIndex().tags.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0])).slice(0, 30);
  const q = $('#noteSearch').value.trim().toLowerCase();
  $('#tagBar').hidden = !tags.length;
  $('#tagBar').innerHTML = tags.map(([t, s]) => `<button class="tag-chip${q === '#' + t ? ' on' : ''}" data-tag="${esc(t)}">#${esc(t)} <span class="text-dim">${s.size}</span></button>`).join('');
}
function hl(text, terms) {
  let h = esc(text);
  for (const t of terms) { if (!t) continue; const re = new RegExp('(' + esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'); h = h.replace(re, '<mark>$1</mark>'); }
  return h;
}
function runVaultSearch() {
  const q = $('#noteSearch').value.trim(); const box = $('#searchRes');
  $('#btnSearchClear').hidden = !q;
  if (!q) { box.hidden = true; $('#tree').hidden = false; renderTagBar(); return; }
  const res = searchNotes(q, 40); const terms = q.startsWith('#') ? [q] : q.split(/\s+/);
  box.hidden = false; $('#tree').hidden = true; renderTagBar();
  box.innerHTML = `<div class="hud px-3 py-2">${res.length} match${res.length === 1 ? '' : 'es'} for <span class="text-cy">${esc(q)}</span></div>` +
    (res.map(r => `<button class="search-hit" data-p="${esc(r.path)}"><div class="disp text-yl font-bold text-[14px] truncate">${hl(noteName(r.path), terms)}</div><div class="mono text-[10.5px] text-dim truncate">${esc(r.path)}</div><div class="text-[12.5px] text-[#c2d6ce] leading-snug mt-1">${hl(r.snippet, terms)}</div></button>`).join('') ||
    `<div class="px-3 py-4 text-sm text-dim">Nothing found. <button class="btn btn-ghost mt-2" data-newnote="${esc(q.replace(/^#/, ''))}">+ Create “${esc(q.replace(/^#/, ''))}”</button></div>`);
}
let searchT; $('#noteSearch').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(runVaultSearch, 120); });
$('#noteSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { const h = $('#searchRes .search-hit'); if (h) { e.preventDefault(); openFile(h.dataset.p); } } if (e.key === 'Escape') { e.target.value = ''; runVaultSearch(); } });
$('#btnSearchClear').onclick = () => { $('#noteSearch').value = ''; runVaultSearch(); };
$('#searchRes').addEventListener('click', e => {
  const h = e.target.closest('.search-hit'); if (h) return openFile(h.dataset.p);
  const n = e.target.closest('[data-newnote]'); if (n) createNoteFromLink(n.dataset.newnote, null);
});
function searchTag(tag) { const on = $('#noteSearch').value.trim().toLowerCase() === '#' + tag && document.body.dataset.screen === 'files'; setTab('files'); $('#noteSearch').value = on ? '' : '#' + tag; runVaultSearch(); }

/* ---------- note screen ---------- */
function openFile(p, opts = {}) {
  if (!vfs.isFile(p)) { toast(`${esc(p)} does not exist`, 'err'); return; }
  flushSave();
  if (editing && editing !== p && !opts.noHist) { noteHist.push(editing); if (noteHist.length > 50) noteHist.shift(); }
  selPath = p; editing = p;
  let text; try { text = vfs.read(p); } catch (e) { toast(esc(e.message), 'err'); return; }
  const bin = /[\x00-\x08\x0e-\x1f]/.test(text.slice(0, 2000));
  $('#fileEd').value = bin ? `[binary file, ${vfs.stat(p).size} bytes]` : text; $('#fileEd').readOnly = bin;
  $('#filePath').textContent = isNote(p) ? noteName(p) : vfs.base(p); $('#filePath').title = p; $('#fileDir').textContent = vfs.parent(p);
  delArmed = false; $('#btnFileDel').textContent = 'Delete'; $('#btnFileDel').style.color = '';
  $('#linksPanel').hidden = true; $('#linkSuggest').hidden = true;
  setSaveState('');
  setNoteMode(isNote(p) ? (opts.mode || noteMode) : 'edit', true);
  renderNoteLinks();
  if (!opts.stay) setTab('file');
  if (opts.heading) setTimeout(() => scrollToHeading(opts.heading), 60); else { $('#notePrev').scrollTop = 0; $('#fileEd').scrollTop = 0; }
  renderTreeSoon();
}
function setNoteMode(m, quiet) {
  const note = editing && isNote(editing); if (!note) m = 'edit';
  const body = $('#noteBody'); body.dataset.mode = m;
  for (const b of $$('#modeSeg button')) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  $('#modeSeg').hidden = !note; $('#mdTools').hidden = m === 'read' || !note;
  if (m !== 'edit') renderNotePreview();
  if (note && !quiet) { noteMode = m; ls.set('noteMode', m); }
  if (note && quiet && m !== noteMode) {}
  if (m === 'read') $('#linkSuggest').hidden = true;
}
$('#modeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setNoteMode(b.dataset.mode); if (b.dataset.mode !== 'read') setTimeout(() => $('#fileEd').focus({ preventScroll: true }), 30); } });
const slug = s => String(s).toLowerCase().trim().replace(/<[^>]+>/g, '').replace(/[^\wÀ-￿\s-]/g, '').replace(/\s+/g, '-');
function splitFrontmatter(text) { const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text); return m ? { fm: m[1], body: text.slice(m[0].length) } : { fm: '', body: text }; }
function renderNotePreview() {
  if (!editing) return;
  const { fm, body } = splitFrontmatter($('#fileEd').value);
  Vault.renderFrom = editing; const el = md(body); Vault.renderFrom = null;
  el.classList.add('note-md');
  for (const h of el.querySelectorAll('h1,h2,h3,h4,h5,h6')) h.id = 'h-' + slug(h.textContent);
  el.querySelectorAll('input[type=checkbox]').forEach((c, i) => { c.disabled = false; c.dataset.ti = i; const li = c.closest('li'); if (li) { li.classList.add('md-task'); if (c.checked) li.classList.add('done'); } });
  if (fm.trim()) {
    const props = document.createElement('div'); props.className = 'note-props';
    props.innerHTML = fm.split(/\r?\n/).filter(l => /^\s*[\w-]+\s*:/.test(l)).map(l => { const i = l.indexOf(':'); return `<div><span>${esc(l.slice(0, i).trim())}</span><b>${esc(l.slice(i + 1).trim())}</b></div>`; }).join('');
    el.prepend(props);
  }
  const tags = noteTags(editing);
  const pv = $('#notePrev'); const st = pv.scrollTop; pv.replaceChildren(el); pv.scrollTop = st;
  const words = (body.match(/\S+/g) || []).length;
  $('#noteStats').textContent = `${words} words · ${Math.max(1, Math.round(words / 220))} min${tags.length ? ' · ' + tags.length + ' tags' : ''}`;
}
function scrollToHeading(h) {
  const t = $('#notePrev').querySelector('#h-' + CSS.escape(slug(h)));
  if (t && $('#noteBody').dataset.mode !== 'edit') { t.scrollIntoView({ block: 'start' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1200); return; }
  const ta = $('#fileEd'); const re = new RegExp('^#{1,6}\\s+' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'mi'); const m = re.exec(ta.value);
  if (m) { ta.focus({ preventScroll: true }); ta.setSelectionRange(m.index, m.index); ta.scrollTop = ta.value.slice(0, m.index).split('\n').length * 19 - 40; }
}
function toggleTask(i) {
  const lines = $('#fileEd').value.split('\n'); let n = -1, fence = false;
  for (let k = 0; k < lines.length; k++) {
    if (/^\s*(```|~~~)/.test(lines[k])) { fence = !fence; continue; } if (fence) continue;
    const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\].*)$/.exec(lines[k]);
    if (m && ++n === i) { lines[k] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3]; break; }
  }
  $('#fileEd').value = lines.join('\n'); saveNote(); renderNotePreview();
}
$('#notePrev').addEventListener('change', e => { const c = e.target.closest('input[type=checkbox][data-ti]'); if (c) toggleTask(+c.dataset.ti); });

/* ---------- autosave ---------- */
let saveT = null;
function setSaveState(s) { const el = $('#saveState'); el.textContent = s; el.dataset.s = s; }
function saveNote() { clearTimeout(saveT); saveT = null; if (!editing || $('#fileEd').readOnly) return; const v = $('#fileEd').value; let cur = null; try { cur = vfs.read(editing); } catch {} if (cur !== v) { vfs.write(editing, v, { mkdirs: true }); } setSaveState('saved'); }
const flushSave = () => { if (saveT) saveNote(); };
let pvT2;
$('#fileEd').addEventListener('input', () => {
  setSaveState('editing…'); clearTimeout(saveT); saveT = setTimeout(saveNote, 700);
  if ($('#noteBody').dataset.mode === 'split') { clearTimeout(pvT2); pvT2 = setTimeout(renderNotePreview, 250); }
  updateLinkSuggest();
});
$('#fileEd').addEventListener('click', updateLinkSuggest);
$('#fileEd').addEventListener('keyup', e => { if (/Arrow|Home|End/.test(e.key)) updateLinkSuggest(); });
$('#fileEd').addEventListener('blur', () => { flushSave(); setTimeout(() => { if (document.activeElement !== $('#fileEd')) $('#linkSuggest').hidden = true; }, 200); });
$('#fileEd').addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveNote(); toast(`Saved ${esc(editing)}`, 'ok'); }
  if (e.key === 'Tab') { e.preventDefault(); const t = e.target, s = t.selectionStart; t.setRangeText('  ', s, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input')); }
  if (e.key === 'Enter' && !$('#linkSuggest').hidden) { const f = $('#linkSuggest button'); if (f) { e.preventDefault(); f.click(); } }
});
addEventListener('pagehide', flushSave); document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
$('#btnFileCopy').onclick = e => copyText($('#fileEd').value, e.currentTarget);
let delArmed = false;
$('#btnFileDel').onclick = () => {
  if (!editing) return;
  if (!delArmed) { delArmed = true; $('#btnFileDel').textContent = 'Confirm delete'; $('#btnFileDel').style.color = 'var(--rd)'; return; }
  clearTimeout(saveT); saveT = null; vfs.rm(editing, true); toast(`Deleted ${esc(editing)}`);
  editing = selPath = null; $('#fileEd').value = ''; delArmed = false; $('#btnFileDel').textContent = 'Delete'; $('#btnFileDel').style.color = '';
  noteBack();
};
vfs.listeners.add(() => {
  renderTreeSoon();
  if (!editing) return;
  if (!vfs.isFile(editing)) { if (!$('[data-panel="file"]').hidden) { toast(`${esc(editing)} was removed`); editing = null; noteBack(); } return; }
  if (document.activeElement !== $('#fileEd') && !saveT) { const t = vfs.read(editing); if (t !== $('#fileEd').value) { $('#fileEd').value = t; if ($('#noteBody').dataset.mode !== 'edit') renderNotePreview(); } }
  clearTimeout(linksT); linksT = setTimeout(renderNoteLinks, 200);
});
let linksT;
function noteBack() {
  flushSave();
  while (noteHist.length) { const p = noteHist.pop(); if (vfs.isFile(p)) return openFile(p, { noHist: true }); }
  setTab('files');
}

/* ---------- links panel ---------- */
function linkContext(src, target) {
  let text = ''; try { text = vfs.read(src); } catch { return ''; }
  text = text.replace(/^(```|~~~)[\s\S]*?^\1/gm, '');
  for (const raw of text.split('\n')) {
    const line = raw.replace(/`[^`\n]*`/g, '');
    for (const m of line.matchAll(WIKI_RE)) if (resolveNote(m[1], src) === target) return line.trim();
    if (line.toLowerCase().includes(vfs.base(target).toLowerCase()) && /\]\(/.test(line)) return line.trim();
  }
  return '';
}
function renderNoteLinks() {
  if (!editing || !isNote(editing)) { $('#btnLinks').hidden = true; return; }
  const idx = vaultIndex(); const back = [...(idx.back.get(editing) || [])].sort(), out = [...(idx.out.get(editing) || [])].sort(), miss = [...(idx.missing.get(editing) || [])].sort();
  $('#btnLinks').hidden = false; $('#btnLinks').innerHTML = `Links <span class="lk-badge">↙${back.length}</span> <span class="lk-badge out">↗${out.length}</span>`;
  const item = (p, ctx) => `<button class="link-item" data-p="${esc(p)}"><span class="text-yl">${esc(noteName(p))}</span>${ctx ? `<span class="text-[12px] text-dim leading-snug" style="display:block;margin-top:2px">${esc(ctx.slice(0, 160))}</span>` : ''}</button>`;
  $('#linksPanel').innerHTML =
    `<div class="lbl">Backlinks · ${back.length}</div>${back.map(p => item(p, linkContext(p, editing))).join('') || '<div class="text-xs text-dim py-1">No notes link here yet.</div>'}` +
    `<div class="lbl mt-3">Outgoing · ${out.length}</div>${out.map(p => item(p)).join('') || '<div class="text-xs text-dim py-1">No links. Type [[ in the editor to add one.</div>'}` +
    (miss.length ? `<div class="lbl mt-3" style="color:var(--rd)">Unresolved · ${miss.length}</div>${miss.map(m => `<button class="link-item" data-create="${esc(m)}"><span style="color:var(--rd)">${esc(m)}</span> <span class="text-[11px] text-dim">tap to create</span></button>`).join('')}` : '') +
    (noteTags(editing).length ? `<div class="lbl mt-3">Tags</div><div class="flex flex-wrap gap-1 py-1">${noteTags(editing).map(t => `<a href="#" class="tag-chip" data-tag="${esc(t)}">#${esc(t)}</a>`).join('')}</div>` : '');
}
$('#btnLinks').onclick = () => { const p = $('#linksPanel'); p.hidden = !p.hidden; if (!p.hidden) renderNoteLinks(); };
$('#linksPanel').addEventListener('click', e => {
  const i = e.target.closest('[data-p]'); if (i) return openFile(i.dataset.p);
  const c = e.target.closest('[data-create]'); if (c) createNoteFromLink(c.dataset.create, editing);
});

/* ---------- [[ autocomplete + markdown toolbar ---------- */
function linkQuery() {
  const ta = $('#fileEd'); const at = ta.selectionStart; if (at !== ta.selectionEnd) return null;
  const before = ta.value.slice(Math.max(0, at - 120), at); const i = before.lastIndexOf('[[');
  if (i < 0) return null; const q = before.slice(i + 2); if (/[\]\n]/.test(q)) return null;
  return { q, start: at - (before.length - i), at };
}
function updateLinkSuggest() {
  const box = $('#linkSuggest'); const lq = editing && isNote(editing) && $('#noteBody').dataset.mode !== 'read' ? linkQuery() : null;
  if (!lq) { box.hidden = true; return; }
  const q = lq.q.split('|')[0].split('#')[0].trim().toLowerCase(); const notes = vaultIndex().notes.filter(p => p !== editing);
  const scored = notes.map(p => { const n = noteName(p).toLowerCase(); return [p, !q ? 1 : n.startsWith(q) ? 3 : n.includes(q) ? 2 : p.toLowerCase().includes(q) ? 1 : 0]; }).filter(x => x[1]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
  const exact = notes.some(p => noteName(p).toLowerCase() === q);
  box.innerHTML = scored.map(([p]) => `<button data-link="${esc(linkName(p))}"><span>${esc(noteName(p))}</span><small>${esc(vfs.parent(p))}</small></button>`).join('') +
    (q && !exact ? `<button data-link="${esc(lq.q.trim())}" class="new"><span>+ ${esc(lq.q.trim())}</span><small>new note</small></button>` : '');
  box.hidden = !box.innerHTML;
}
$('#linkSuggest').addEventListener('mousedown', e => e.preventDefault());
$('#linkSuggest').addEventListener('click', e => {
  const b = e.target.closest('button[data-link]'); if (!b) return; const lq = linkQuery(); if (!lq) return;
  const ta = $('#fileEd'); const after = ta.value.slice(lq.at, lq.at + 2) === ']]' ? 2 : 0;
  ta.setRangeText(`[[${b.dataset.link}]]`, lq.start, lq.at + after, 'end');
  ta.dispatchEvent(new Event('input')); $('#linkSuggest').hidden = true; ta.focus({ preventScroll: true });
});
function mdWrap(l, r = l, ph = 'text') {
  const ta = $('#fileEd'); const s = ta.selectionStart, e = ta.selectionEnd; const sel = ta.value.slice(s, e) || ph;
  ta.setRangeText(l + sel + r, s, e, 'select'); ta.setSelectionRange(s + l.length, s + l.length + sel.length);
}
function mdLine(prefix) {
  const ta = $('#fileEd'); const s = ta.selectionStart; const ls0 = ta.value.lastIndexOf('\n', s - 1) + 1;
  const line = ta.value.slice(ls0, (ta.value.indexOf('\n', s) + 1 || ta.value.length + 1) - 1);
  if (line.startsWith(prefix)) ta.setRangeText('', ls0, ls0 + prefix.length, 'end');
  else { const clean = line.match(/^(#{1,6} |- \[[ xX]\] |[-*+] |> |\d+\. )/); ta.setRangeText(prefix, ls0, ls0 + (clean ? clean[0].length : 0), 'end'); }
}
$('#mdTools').addEventListener('mousedown', e => e.preventDefault());
$('#mdTools').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const ta = $('#fileEd'); ta.focus({ preventScroll: true });
  const k = b.dataset.md;
  if (k === 'link') { const s = ta.selectionStart, en = ta.selectionEnd; const sel = ta.value.slice(s, en); ta.setRangeText(`[[${sel}]]`, s, en, 'end'); ta.setSelectionRange(s + 2 + sel.length, s + 2 + sel.length); }
  else if (k === 'b') mdWrap('**'); else if (k === 'i') mdWrap('_'); else if (k === 'code') mdWrap('`', '`', 'code'); else if (k === 's') mdWrap('~~');
  else if (k === 'h') { const s = ta.selectionStart; const ls0 = ta.value.lastIndexOf('\n', s - 1) + 1; const m = /^(#{1,6}) /.exec(ta.value.slice(ls0)); const lvl = m ? m[1].length : 0; const next = lvl >= 3 ? '' : '#'.repeat(lvl + 1 || 1) + ' '; ta.setRangeText(next, ls0, ls0 + (m ? m[0].length : 0), 'end'); }
  else if (k === 'task') mdLine('- [ ] '); else if (k === 'ul') mdLine('- '); else if (k === 'quote') mdLine('> ');
  else if (k === 'tag') ta.setRangeText(/\S$/.test(ta.value.slice(0, ta.selectionStart)) ? ' #' : '#', ta.selectionStart, ta.selectionEnd, 'end');
  else if (k === 'date') ta.setRangeText(todayStr(), ta.selectionStart, ta.selectionEnd, 'end');
  ta.dispatchEvent(new Event('input'));
});

/* ---------- creating notes ---------- */
function createNoteFromLink(target, fromPath) {
  let t = String(target).trim().replace(/^\/+/, ''); if (!t) return;
  if (!isNote(t)) t += '.md';
  const p = vfs.norm(t, fromPath ? vfs.parent(fromPath) : '/');
  if (!vfs.exists(p)) { vfs.write(p, `# ${noteName(p)}\n\n${fromPath ? `Linked from [[${linkName(fromPath)}]].\n\n` : ''}`, { mkdirs: true }); toast(`Created ${esc(p)}`, 'ok'); }
  openFile(p, { mode: 'edit' });
  setTimeout(() => { const ta = $('#fileEd'); ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }, 80);
  return p;
}
function openToday() {
  const d = todayStr(); const p = `/daily/${d}.md`;
  if (!vfs.exists(p)) {
    const y = new Date(Date.now() - 864e5); const yd = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    vfs.write(p, `# ${d}\n\n#daily · ${vfs.isFile(`/daily/${yd}.md`) ? `previous: [[${yd}]] · ` : ''}[[Inbox]]\n\n## Notes\n\n\n## Tasks\n- [ ] \n`, { mkdirs: true });
  }
  openFile(p, { mode: 'edit' });
}
let newKind = null;
const startNew = k => { newKind = k; $('#newEntry').hidden = false; const i = $('#newEntryInput'); i.value = ''; i.placeholder = k === 'dir' ? 'folder name, e.g. projects' : 'note name, e.g. projects/Big Idea'; i.focus(); };
$('#btnNewFile').onclick = () => startNew('file'); $('#btnNewDir').onclick = () => startNew('dir');
$('#btnToday').onclick = openToday;
$('#newEntryInput').addEventListener('keydown', e => {
  if (e.key === 'Escape') { $('#newEntry').hidden = true; return; }
  if (e.key !== 'Enter') return; const v = e.target.value.trim(); $('#newEntry').hidden = true; if (!v) return;
  try {
    if (newKind === 'dir') { const p = vfs.norm(v); vfs.mkdirp(p); openDirs.add(p); openDirs.add(vfs.parent(p)); ls.set('openDirs', [...openDirs]); renderTree(); }
    else { const p = vfs.norm(KNOWN_EXT.test(v) ? v : v + '.md'); const twin = isNote(p) && !vfs.exists(p) && vaultIndex().notes.find(q => nameKey(q) === nameKey(p)); if (twin) { toast(`“${esc(noteName(twin))}” already exists, opening it`); openFile(twin); return; } if (!vfs.exists(p)) vfs.write(p, isNote(p) ? `# ${noteName(p)}\n\n` : '', { mkdirs: true }); openDirs.add(vfs.parent(p)); setTimeout(() => openFile(p, { mode: 'edit' }), 60); }
  } catch (err) { toast(esc(err.message), 'err'); }
});
async function uploadFiles(fileList, dir = '/') { for (const f of fileList) { const buf = new Uint8Array(await f.arrayBuffer()); vfs.write(vfs.norm(f.webkitRelativePath || f.name, dir), buf, { mkdirs: true }); } toast(`Imported ${fileList.length} file${fileList.length > 1 ? 's' : ''}`, 'ok'); }
$('#upload').onchange = e => { uploadFiles(e.target.files); e.target.value = ''; };
const side = $('#tree');
side.addEventListener('dragover', e => { e.preventDefault(); side.style.borderColor = 'var(--cy)'; });
side.addEventListener('dragleave', () => side.style.borderColor = '');
side.addEventListener('drop', e => { e.preventDefault(); side.style.borderColor = ''; if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); });

/* ---------- wiki links + tags anywhere (notes, chat, links panel) ---------- */
document.addEventListener('click', e => {
  const w = e.target.closest('a.wiki-link'); const t = e.target.closest('.tag-chip');
  if (!w && !t) return; e.preventDefault();
  if (t) return searchTag(t.dataset.tag);
  const from = w.closest('#notePrev') ? editing : null; const target = w.dataset.wiki; const r = resolveNote(target, from);
  if (r) openFile(r, { heading: w.dataset.heading, mode: noteMode === 'edit' ? 'read' : undefined });
  else if (!target && w.dataset.heading) scrollToHeading(w.dataset.heading);
  else createNoteFromLink(target, from);
});

/* ---------- graph ---------- */
const Graph = { nodes: [], edges: [], byId: new Map(), cam: { x: 0, y: 0, k: 1 }, alpha: 0, raf: 0, focus: null, local: false, from: 'files', drag: null };
function buildGraph() {
  const idx = vaultIndex(); const keep = new Set();
  const focus = Graph.local && editing && isNote(editing) ? editing : null;
  if (focus) { keep.add(focus); const lvl1 = [...(idx.out.get(focus) || []), ...(idx.back.get(focus) || [])]; lvl1.forEach(p => keep.add(p)); for (const p of lvl1) [...(idx.out.get(p) || []), ...(idx.back.get(p) || [])].forEach(q => keep.add(q)); }
  const notes = idx.notes.filter(p => !focus || keep.has(p));
  const old = Graph.byId; Graph.byId = new Map(); Graph.nodes = []; Graph.edges = [];
  const add = (id, kind) => { if (Graph.byId.has(id)) return Graph.byId.get(id); const o = old.get(id); const a = Math.random() * 6.283, r = 60 + Math.random() * 180; const n = { id, kind, x: o?.x ?? Math.cos(a) * r, y: o?.y ?? Math.sin(a) * r, vx: 0, vy: 0, deg: 0, label: kind === 'missing' ? id.slice(2) : noteName(id) }; Graph.byId.set(id, n); Graph.nodes.push(n); return n; };
  for (const p of notes) add(p, 'note');
  for (const p of notes) {
    for (const q of idx.out.get(p) || []) if (Graph.byId.has(q)) Graph.edges.push([Graph.byId.get(p), Graph.byId.get(q)]);
    for (const m of idx.missing.get(p) || []) Graph.edges.push([Graph.byId.get(p), add('?:' + m, 'missing')]);
  }
  for (const [a, b] of Graph.edges) { a.deg++; b.deg++; }
  Graph.focus = focus; Graph.alpha = 1;
  $('#graphTitle').textContent = focus ? `Local graph · ${noteName(focus)}` : `Vault graph · ${notes.length} notes`;
  $('#btnGraphLocal').hidden = !(editing && isNote(editing)); $('#btnGraphLocal').setAttribute('aria-pressed', String(!!focus));
}
function graphStep() {
  const N = Graph.nodes, a = Graph.alpha;
  for (let i = 0; i < N.length; i++) { const n = N[i]; for (let j = i + 1; j < N.length; j++) { const m = N[j]; let dx = n.x - m.x, dy = n.y - m.y, d2 = dx * dx + dy * dy + 0.01; if (d2 > 160000) continue; const f = 1400 / d2 * a; const d = Math.sqrt(d2); dx /= d; dy /= d; n.vx += dx * f; n.vy += dy * f; m.vx -= dx * f; m.vy -= dy * f; } }
  for (const [s, t] of Graph.edges) { const dx = t.x - s.x, dy = t.y - s.y, d = Math.sqrt(dx * dx + dy * dy) || 1; const f = (d - 70) * 0.02 * a; const fx = dx / d * f, fy = dy / d * f; s.vx += fx; s.vy += fy; t.vx -= fx; t.vy -= fy; }
  for (const n of N) { n.vx -= n.x * 0.006 * a; n.vy -= n.y * 0.006 * a; if (Graph.drag?.node === n) { n.vx = n.vy = 0; continue; } n.vx *= 0.82; n.vy *= 0.82; n.x += Math.max(-20, Math.min(20, n.vx)); n.y += Math.max(-20, Math.min(20, n.vy)); }
  Graph.alpha = Math.max(0, a * 0.985 - 0.0005);
}
function graphDraw() {
  const cv = $('#graphCv'); const dpr = devicePixelRatio || 1; const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const { x: cx, y: cy, k } = Graph.cam; const X = n => w / 2 + (n.x + cx) * k, Y = n => h / 2 + (n.y + cy) * k;
  const hot = Graph.drag?.node || Graph.byId.get(Graph.focus) || Graph.byId.get(editing);
  const nb = new Set(); if (hot) for (const [s, t] of Graph.edges) { if (s === hot) nb.add(t); if (t === hot) nb.add(s); }
  g.lineWidth = 1;
  for (const [s, t] of Graph.edges) { const on = hot && (s === hot || t === hot); g.strokeStyle = on ? 'rgba(255,184,198,.75)' : t.kind === 'missing' ? 'rgba(255,61,79,.22)' : 'rgba(31,229,165,.22)'; g.beginPath(); g.moveTo(X(s), Y(s)); g.lineTo(X(t), Y(t)); g.stroke(); }
  for (const n of Graph.nodes) {
    const r = (n.kind === 'missing' ? 3 : 4 + Math.min(8, Math.sqrt(n.deg) * 2)) * Math.max(0.6, Math.min(1.6, k));
    const isHot = n === hot, isNb = nb.has(n);
    g.beginPath(); g.arc(X(n), Y(n), r, 0, 6.283);
    g.fillStyle = n.kind === 'missing' ? 'rgba(255,61,79,.55)' : isHot ? '#ffb8c6' : isNb ? '#b8ffdf' : '#1fe5a5';
    g.shadowColor = g.fillStyle; g.shadowBlur = isHot ? 16 : 6; g.fill(); g.shadowBlur = 0;
    if (k > 0.7 || isHot || isNb || n.deg >= 4 || Graph.nodes.length < 25) {
      g.font = `${isHot ? 600 : 500} ${Math.round(11 * Math.max(0.85, Math.min(1.3, k)))}px "Chakra Petch", system-ui, sans-serif`; g.textAlign = 'center';
      g.fillStyle = n.kind === 'missing' ? 'rgba(255,61,79,.8)' : isHot ? '#ffb8c6' : 'rgba(227,242,237,.85)'; g.fillText(n.label.length > 28 ? n.label.slice(0, 27) + '…' : n.label, X(n), Y(n) + r + 12);
    }
  }
}
function graphLoop() {
  cancelAnimationFrame(Graph.raf);
  const tick = () => { if ($('[data-panel="graph"]').hidden) return; if (Graph.alpha > 0.002 || Graph.drag) { for (let i = 0; i < 2; i++) graphStep(); } graphDraw(); Graph.raf = requestAnimationFrame(tick); };
  Graph.raf = requestAnimationFrame(tick);
}
function openGraph(local) {
  Graph.from = document.body.dataset.screen || 'files'; Graph.local = !!local; Graph.cam = { x: 0, y: 0, k: 1 };
  buildGraph(); for (let i = 0; i < 120; i++) graphStep(); setTab('graph'); graphLoop();
}
function graphPick(px, py) {
  const cv = $('#graphCv'); const r = cv.getBoundingClientRect(); const { x: cx, y: cy, k } = Graph.cam;
  const gx = (px - r.left - cv.clientWidth / 2) / k - cx, gy = (py - r.top - cv.clientHeight / 2) / k - cy;
  let best = null, bd = (22 / k) ** 2; for (const n of Graph.nodes) { const d = (n.x - gx) ** 2 + (n.y - gy) ** 2; if (d < bd) { bd = d; best = n; } }
  return { node: best, gx, gy };
}
(() => {
  const cv = $('#graphCv'); const pts = new Map(); let pinch = null, moved = 0;
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0;
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: Graph.cam.k }; Graph.drag = null; return; }
    const { node } = graphPick(e.clientX, e.clientY); Graph.drag = { node, x: e.clientX, y: e.clientY, cam: { ...Graph.cam } }; if (node) Graph.alpha = Math.max(Graph.alpha, 0.3);
  });
  cv.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; Graph.cam.k = Math.max(0.2, Math.min(4, pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)); moved = 99; return; }
    const d = Graph.drag; if (!d) return; moved = Math.max(moved, Math.hypot(e.clientX - d.x, e.clientY - d.y));
    if (d.node) { const { gx, gy } = graphPick(e.clientX, e.clientY); d.node.x = gx; d.node.y = gy; Graph.alpha = Math.max(Graph.alpha, 0.25); }
    else { Graph.cam.x = d.cam.x + (e.clientX - d.x) / Graph.cam.k; Graph.cam.y = d.cam.y + (e.clientY - d.y) / Graph.cam.k; }
  });
  const up = e => {
    pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
    const d = Graph.drag; Graph.drag = null;
    if (d?.node && moved < 8) { if (d.node.kind === 'missing') createNoteFromLink(d.node.label, null); else openFile(d.node.id); }
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); Graph.cam.k = Math.max(0.2, Math.min(4, Graph.cam.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); }, { passive: false });
})();
$('#btnGraph').onclick = () => openGraph(false);
$('#btnNoteGraph').onclick = () => openGraph(true);
$('#btnGraphLocal').onclick = () => { Graph.local = !Graph.local; buildGraph(); for (let i = 0; i < 120; i++) graphStep(); graphLoop(); };
$('#btnGraphFit').onclick = () => { Graph.cam = { x: 0, y: 0, k: 1 }; Graph.alpha = 0.6; };
$('#btnGraphBack').onclick = () => setTab(Graph.from === 'graph' ? 'files' : Graph.from);
vfs.listeners.add(() => { if (!$('[data-panel="graph"]').hidden) { clearTimeout(Graph.rt); Graph.rt = setTimeout(() => { buildGraph(); Graph.alpha = 0.4; }, 300); } });
$('#btnFileBack').onclick = () => noteBack();

/* =====================================================================
   LONG-TERM MEMORY
   - /Jade/Memory.md: durable facts, one bullet per line, under sections.
     Injected into every chat's instructions; Jade edits it with the memory tool.
   - /Jade/Journal/YYYY-MM-DD.md: episodic memory. When you leave a chat (or it is
     compacted) the model writes a short entry, and new durable facts it noticed
     are added to Memory.md. Both are ordinary notes you can read and edit.
   ===================================================================== */
const MEM_PATH = '/Jade/Memory.md', JOURNAL_DIR = '/Jade/Journal';
const MEM_SECTIONS = { about: 'About you', preferences: 'Preferences', projects: 'Projects & people', notes: 'Notes to self', learned: 'Learned from chats' };
const MEM_TEMPLATE = `# Memory

Jade reads this note at the start of every chat. Edit it freely: one fact per line.
She adds to it when you tell her something worth keeping (or say "remember…"), and her
chat journal in [[Journal]] adds facts it learns. #memory

## About you

## Preferences

## Projects & people

## Notes to self

## Learned from chats
`;
const memKey = s => String(s).toLowerCase().replace(/\(\d{4}-\d{2}-\d{2}\)/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function ensureMemory() {
  if (!vfs.isFile(MEM_PATH)) vfs.write(MEM_PATH, MEM_TEMPLATE, { mkdirs: true });
  if (!vfs.isFile('/Jade/Journal.md')) vfs.write('/Jade/Journal.md', `# Journal\n\nJade's diary of past chats, one note per day in the Journal folder. She searches it with the memory tool to recall earlier conversations. #memory\n`, { mkdirs: true });
}
function memoryLines() {
  if (!vfs.isFile(MEM_PATH)) return [];
  let sec = ''; const out = [];
  for (const line of vfs.read(MEM_PATH).split('\n')) {
    const h = /^##\s+(.+)/.exec(line); if (h) { sec = h[1].trim(); continue; }
    const b = /^\s*[-*]\s+(.+)/.exec(line); if (b && b[1].trim()) out.push({ sec, text: b[1].trim(), line });
  }
  return out;
}
function memorySave(text, section) {
  ensureMemory();
  text = String(text || '').replace(/\s+/g, ' ').replace(/^[-*]\s+/, '').trim();
  if (!text) throw new Error('save needs text');
  const k = memKey(text);
  const dup = memoryLines().find(m => { const mk = memKey(m.text); return mk === k || (k.length > 12 && (mk.includes(k) || k.includes(mk) && mk.length > 12)); });
  if (dup) return { added: false, msg: `Already remembered: "${dup.text}"` };
  const head = MEM_SECTIONS[section] || (Object.values(MEM_SECTIONS).includes(section) ? section : MEM_SECTIONS.notes);
  const lines = vfs.read(MEM_PATH).split('\n');
  let i = lines.findIndex(l => new RegExp('^##\\s+' + head.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&') + '\\s*$', 'i').test(l));
  if (i < 0) { lines.push('', '## ' + head); i = lines.length - 1; }
  let j = i + 1; while (j < lines.length && !/^##\s/.test(lines[j])) j++;
  while (j > i + 1 && !lines[j - 1].trim()) j--;   // insert after the section's last bullet
  lines.splice(j, 0, `- ${text} (${todayStr()})`);
  vfs.write(MEM_PATH, lines.join('\n').replace(/\n{3,}/g, '\n\n'));
  return { added: true, msg: `Saved to memory under "${head}": ${text}` };
}
function memoryForget(text) {
  const k = memKey(text); if (!k) throw new Error('forget needs the text (or part of it) to remove');
  const hits = memoryLines().filter(m => memKey(m.text).includes(k));
  if (!hits.length) throw new Error(`Nothing in memory matches "${text}". Use action "list" to see what is stored.`);
  if (hits.length > 3) throw new Error(`${hits.length} memories match "${text}"; be more specific:\n${hits.map(h => '- ' + h.text).join('\n')}`);
  const drop = new Set(hits.map(h => h.line));
  vfs.write(MEM_PATH, vfs.read(MEM_PATH).split('\n').filter(l => !drop.has(l)).join('\n'));
  return `Forgot ${hits.length}: ${hits.map(h => '"' + h.text + '"').join(', ')}`;
}
function memorySearch(query, limit = 15) {
  const terms = memKey(query).split(' ').filter(t => t.length > 1);
  const res = [];
  const files = [MEM_PATH, ...[...vfs.nodes.keys()].filter(p => p.startsWith(JOURNAL_DIR + '/') && isNote(p)).sort().reverse()];
  for (const f of files) {
    if (!vfs.isFile(f)) continue; let head = '';
    for (const line of vfs.read(f).split('\n')) {
      if (/^#{1,3}\s/.test(line)) { head = line.replace(/^#+\s*/, ''); continue; }
      if (!line.trim()) continue;
      const lk = memKey(line); const score = terms.length ? terms.filter(t => lk.includes(t)).length : 1;
      if (score) res.push({ f, head, line: line.trim(), score: score + (f === MEM_PATH ? 0.5 : 0) });
    }
  }
  res.sort((a, b) => b.score - a.score);
  return res.slice(0, limit);
}
function memoryTool(args) {
  const a = String(args.action || '').toLowerCase();
  if (a === 'save' || a === 'remember' || a === 'add') return memorySave(args.text ?? args.fact ?? args.content, String(args.section || '').toLowerCase()).msg;
  if (a === 'forget' || a === 'remove' || a === 'delete') return memoryForget(args.text ?? args.query);
  if (a === 'search' || a === 'recall') {
    const r = memorySearch(args.text ?? args.query ?? '', 15);
    return r.length ? r.map(x => `${x.f === MEM_PATH ? 'memory' : noteName(x.f)}${x.head && x.f !== MEM_PATH ? ' · ' + x.head : ''}: ${x.line.slice(0, 300)}`).join('\n') : 'Nothing found in memory or the journal. Try notes_search for the rest of the vault.';
  }
  if (a === 'list' || !a) { ensureMemory(); return vfs.read(MEM_PATH); }
  throw new Error(`unknown action "${a}" (use save, search, forget or list)`);
}
// what goes into the system prompt
function memoryContext() {
  if (!S.memoryOn) return '';
  ensureMemory();
  const mem = memoryLines(); let block = '', used = 0; const budget = 2600;
  const bySec = {}; for (const m of mem) (bySec[m.sec] ||= []).push(m.text);
  const parts = [];
  for (const [sec, items] of Object.entries(bySec)) {
    const keep = []; for (const t of items.slice().reverse()) { if (used + t.length + 4 > budget) break; keep.unshift(t); used += t.length + 4; }
    if (keep.length) parts.push(`${sec}:\n${keep.map(t => '- ' + t).join('\n')}${keep.length < items.length ? `\n- (${items.length - keep.length} older lines: use memory search)` : ''}`);
  }
  block = parts.join('\n') || '(empty so far)';
  const days = [...vfs.nodes.keys()].filter(p => p.startsWith(JOURNAL_DIR + '/') && isNote(p)).sort().slice(-2);
  let jr = days.map(p => vfs.read(p).replace(/^#[^\n]*\n/, '').replace(/#journal/g, '').trim()).join('\n').trim();
  if (jr.length > 1400) jr = '…' + jr.slice(-1400);
  return `\n\nLong-term memory (the note [[Memory]]; keep it current with the memory tool):\n${block}${jr ? `\n\nRecent journal (earlier chats; memory search finds older ones):\n${jr}` : ''}`;
}

/* ---------- journal: summarise a finished chat into episodic memory ---------- */
const JOURNAL_SYS = `You keep Jade's diary. Jade is an AI assistant that manages the user's markdown notes vault. Read the chat and reply in exactly this format:

SUMMARY:
- 2 to 5 short bullets: what the user wanted, what was done or decided, which notes were created or changed (as [[Note Name]]), anything left open.

REMEMBER:
- 0 to 4 bullets of durable facts about the user worth knowing in future chats: who they are, preferences, ongoing projects, people, goals, standing instructions. Only facts the user stated or clearly implied. Write "- none" if there are none.

No other text.`;
const journaling = new Set();
const jMarks = () => ls.get('journaled', {});
async function journalSession(sess, { reason = 'leave', summary = null, upto = null } = {}) {
  if (!S.journalOn || !sess || !S.model || sess._hb) return;
  const done = jMarks()[sess.id] || 0; const msgs = sess.messages || [];
  const end = upto ?? msgs.length;
  const fresh = msgs.slice(done, end).filter(m => m.role !== 'compaction');
  const userTurns = fresh.filter(m => m.role === 'user').length;
  if (!summary && (userTurns < 1 || fresh.length < 2)) return;
  if (journaling.has(sess.id)) return; journaling.add(sess.id);
  try {
    let out = summary;
    if (!out) {
      let text = transcriptOf(fresh); if (text.length > 14000) text = '[…]\n' + text.slice(-14000);
      const r = await llmPost({ method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: S.model, stream: false, think: false, messages: [{ role: 'system', content: JOURNAL_SYS }, { role: 'user', content: `Chat title: ${sess.title}\n\n${text}` }], options: { temperature: 0.2, num_ctx: +S.numCtx } }) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      out = String((await r.json()).message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    }
    if (out.length < 10) throw new Error('empty journal entry');
    const m = /SUMMARY:\s*([\s\S]*?)(?:\n\s*REMEMBER:\s*([\s\S]*))?$/i.exec(out);
    const sum = (m ? m[1] : out).trim();
    const facts = m && m[2] ? m[2].split('\n').map(l => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(l => l && !/^none\.?$/i.test(l) && l.length < 300) : [];
    const day = todayStr(), p = `${JOURNAL_DIR}/Journal ${day}.md`, t = new Date();
    const entry = `\n## ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} · ${String(sess.title || 'Chat').replace(/\n/g, ' ').slice(0, 70)}\n${sum}\n`;
    if (!vfs.isFile(p)) vfs.write(p, `# Journal ${day}\n\n#journal · [[Journal]]\n`, { mkdirs: true });
    vfs.append(p, entry);
    let learned = 0; for (const f of facts) if (memorySave(f, 'learned').added) learned++;
    const marks = jMarks(); marks[sess.id] = end; ls.set('journaled', marks);
    if (reason !== 'quiet') toast(`Jade wrote today's journal${learned ? ` and learned ${learned} new thing${learned > 1 ? 's' : ''}` : ''}`, 'ok');
  } catch (e) { console.warn('journal failed', e); }
  finally { journaling.delete(sess.id); }
}

let journalT = null;
function scheduleJournal() { clearTimeout(journalT); if (!S.journalOn) return; journalT = setTimeout(() => { if (!running && cur) journalSession(cur, { reason: 'quiet' }); }, 4 * 60e3); }
document.addEventListener('visibilitychange', () => { if (document.hidden && !running && cur) journalSession(cur, { reason: 'quiet' }); });

/* =====================================================================
   UI WIRING
   ===================================================================== */
function setTab(name) {
  if (name !== 'file') flushSave();
  const navFor = { file: 'files', graph: 'files' }[name] || name;
  for (const t of $$('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === navFor));
  for (const p of $$('[data-panel]')) p.hidden = p.dataset.panel !== name;
  document.body.dataset.screen = name;
  if (name === 'term') setTimeout(() => term.fit(), 30);
  if (name !== 'graph') cancelAnimationFrame(Graph.raf);
  if (name === 'files') renderTree();
  const ticker = Jade.state.app?.ticker; if (ticker) (name === 'chat' && S.jadeShow) ? ticker.start() : ticker.stop();
}
$$('.tab').forEach(t => t.onclick = () => setTab(t.dataset.tab));
function flashTab(name) { const t = $(`.tab[data-tab="${name}"]`); t.animate([{ background: 'rgba(31,229,165,.25)' }, { background: 'transparent' }], { duration: 900 }); }
function setView(v) { if (v === 'chat') { setTab('chat'); closeDrawer(); } else if (v === 'side') setTab('files'); }
const openDrawer = () => { document.body.classList.add('drawer-open'); };
const closeDrawer = () => { document.body.classList.remove('drawer-open'); };
$('#btnDrawer').onclick = openDrawer; $('#btnBrand').onclick = openDrawer; $('#drawerBg').onclick = closeDrawer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
// swipe the drawer closed
(() => { let x0 = null; const d = $('#drawer'); d.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true }); d.addEventListener('touchend', e => { if (x0 != null && x0 - e.changedTouches[0].clientX > 60) closeDrawer(); x0 = null; }, { passive: true }); })();

const input = $('#input');
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; }
input.addEventListener('input', () => { autosize(); ls.set('draft', input.value); });
const coarse = matchMedia('(pointer: coarse)').matches;
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !coarse) { e.preventDefault(); const v = input.value; if (!v.trim() && !ATT.pending.length) return; input.value = ''; autosize(); ls.set('draft', ''); send(v); } if (e.key === 'Escape' && running) abort(); });
$('#btnSend').onclick = () => { if (running && !input.value.trim()) return abort(); const v = input.value; if (!v.trim() && !ATT.pending.length) return; input.value = ''; autosize(); ls.set('draft', ''); send(v); };
$('#btnNew').onclick = () => { if (running) return toast('The agent is still working. Abort it first.', 'err'); newSession(); setView('chat'); };
$('#btnNewTop').onclick = () => $('#btnNew').click();
$('#btnClearTasks').onclick = () => { tasks.items = []; renderTasks(); persistTasks(); };
$('#modelSel').onchange = e => { S.model = e.target.value; saveSettings(); fillModelSelects(); };
$('#provSel').value = S.provider || 'local';
$('#provSel').onchange = async e => { const p = e.target.value; const miss = providerMissing(p); if (miss) { toast(esc(miss.replace(/ \(.*\)$/, '')) + '. Add it in Config.', 'err'); e.target.value = S.provider || 'local'; openSettings(); $('#sProvider').value = p; showProvFields(); return; } S.provider = p; saveSettings(); await connect(); };

function updateShellChip() {
  const on = !!bb.module && !!bb.applets.size && S.engine !== 'js';
  $('#dotShell').className = 'dot ' + (on ? 'ok' : 'busy'); $('#txtShell').textContent = on ? `BUSYBOX.WASM ${bb.applets.size}${bb.host === 'main' ? ' · MAIN' : ''}` : 'JS APPLETS';
  $('#chipShell').title = on ? `BusyBox WASM running in ${bb.host === 'main' ? 'the main thread' : 'a worker'}` : 'Using built-in JS applets';
  const st = $('#bbStatus'); st.innerHTML = bb.module && bb.applets.size ? `<span class="dot ok"></span>${esc(bb.name)} · ${bb.applets.size} applets · ${bb.host === 'main' ? 'main thread' : 'worker'}` : '<span class="dot"></span>Not running';
}

/* ---------------- Jade glue ---------------- */
let jadeBubbleT = 0;
function jadeBubble(text, who = 'Jade', ms = 0) {
  const b = $('#jadeBubble'); clearTimeout(jadeBubbleT);
  if (!text) { b.hidden = true; return; }
  b.innerHTML = `<span class="who disp">${esc(who)}</span>${esc(String(text).slice(0, 320))}`; b.hidden = false;
  if (ms) jadeBubbleT = setTimeout(() => { b.hidden = true; }, ms);
}
function jadeMood(m, ms = 0, then = 'idle') { if (!Jade.ready) return; Jade.setMood(m, ms, then); $('#jadeMood').textContent = Jade.label(); }
function toolCaption(name, a = {}) {
  if (/^mcp__/.test(name)) { const [, srv, tool] = name.split('__'); return `${srv} › ${tool}`; }
  if (name === 'codemode') return 'Running a codemode script'; if (name === 'tool_search') return `Searching MCP tools: ${String(a.query || '').slice(0, 60)}`;
  const short = (x, n = 70) => { x = String(x ?? '').split('\n')[0]; return x.length > n ? x.slice(0, n) + '…' : x; };
  return ({ read: () => `Reading ${short(a.path)}`, write: () => `Writing ${short(a.path)}`, edit: () => `Editing ${short(a.path)}`,
    bash: () => `$ ${short(a.command)}`, tasks: () => 'Updating the task list', web_search: () => `Searching the web: ${short(a.query)}`,
    web_fetch: () => `Fetching ${short(a.url)}`, decide: () => `Asking Ollaya: ${short(a.question)}`, schedule: () => `Scheduling: ${short(a.name || a.action)}`, skill: () => `Loading skill: ${short(a.name)}`, memory: () => ({ save: 'Remembering', search: 'Recalling', forget: 'Forgetting', list: 'Reading her memory' }[a.action] || 'Memory') + (a.text ? ': ' + short(a.text, 50) : ''), notes_search: () => a.query ? `Searching notes: ${short(a.query)}` : 'Surveying the vault', note_links: () => `Tracing links: ${short(a.note || a.path)}`, open_note: () => `Opening ${short(a.note || a.path)}` }[name] || (() => `Using ${name}`))();
}
function jadeReply(text) {
  if (!text) { jadeBubble('Done.', 'Jade', 3000); return; }
  const plain = String(text).replace(/```[\s\S]*?```/g, ' ').replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (m, a, b) => b || a).replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim();
  jadeBubble(plain.slice(0, 220) + (plain.length > 220 ? '…' : ''), 'Jade', S.jadeVoice ? 0 : 7000);
  if (S.jadeVoice && Jade.ready) { if (!Jade.speak(text, { voice: S.voiceName, pitch: +S.voicePitch, rate: +S.voiceRate })) jadeBubble(plain.slice(0, 220), 'Jade', 7000); }
}
function setVoice(on) {
  S.jadeVoice = !!on; saveSettings();
  const b = $('#btnVoice'); b.setAttribute('aria-pressed', String(S.jadeVoice)); b.textContent = 'Voice'; b.title = S.jadeVoice ? 'Voice is on: tap to mute' : 'Voice is off: tap to read replies aloud';
  if (!S.jadeVoice) Jade.stop();
  if (!(!!window.speechSynthesis) && !window.NetrunnerAndroid && S.jadeVoice) toast('This browser has no speech synthesis, so Jade can only show captions.', 'err');
}
function applyJadeVisibility() {
  $('#app').classList.toggle('jade-hidden', !S.jadeShow); $('#app').classList.toggle('jade-compact', !!S.jadeCompact); $('#btnShowJade').hidden = !!S.jadeShow;
  $('#btnCompact').textContent = S.jadeCompact ? 'Expand' : 'Shrink';
  const app = Jade.state.app; if (app) S.jadeShow ? app.ticker.start() : app.ticker.stop();
  if (!S.jadeShow) Jade.stop();
  setTimeout(() => term.fit(), 50);
}
async function initJade() {
  applyJadeVisibility(); setVoice(S.jadeVoice);
  $('#btnFrame').textContent = S.jadeFrame === 'full' ? 'Portrait' : 'Full';
  try {
    await Jade.init({ host: $('#jadeStage'),
      onStatus: m => { $('#jadeStatus').textContent = m; $('#jadeStatus').hidden = !m; },
      onSpeak: t => { if (t) jadeBubble(t, 'Jade'); else jadeBubbleT = setTimeout(() => { $('#jadeBubble').hidden = true; }, 1500); } });
    Jade.setFrame(S.jadeFrame); $('#jadeDot').className = 'dot ok'; $('#jadeMood').textContent = Jade.label();
    setInterval(() => { $('#jadeMood').textContent = Jade.label(); }, 600);
    if (!S.jadeShow) Jade.state.app?.ticker.stop();
  } catch (e) {
    console.warn('Jade failed to start', e);
    $('#jadeDot').className = 'dot bad'; $('#jadeMood').textContent = 'offline'; $('#jadeStatus').hidden = false;
    $('#jadeStatus').textContent = `Jade couldn't start here (${e.message}). The agent still works without her.`;
  }
}
$('#btnVoice').onclick = () => setVoice(!S.jadeVoice);
$('#btnFrame').onclick = () => { S.jadeFrame = S.jadeFrame === 'full' ? 'portrait' : 'full'; saveSettings(); Jade.setFrame(S.jadeFrame); $('#btnFrame').textContent = S.jadeFrame === 'full' ? 'Portrait' : 'Full'; };
$('#btnHideJade').onclick = () => { S.jadeShow = false; saveSettings(); applyJadeVisibility(); };
$('#btnShowJade').onclick = () => { S.jadeShow = true; saveSettings(); applyJadeVisibility(); };
let listenT = 0;
input.addEventListener('input', () => { if (running || !Jade.ready) return; if (Jade.mood === 'idle' || Jade.mood === 'listening') { jadeMood('listening'); clearTimeout(listenT); listenT = setTimeout(() => { if (!running && Jade.mood === 'listening') jadeMood('idle'); }, 3500); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !running) Jade.stop(); });

/* chat bar */
function startRename() {
  const t = $('#chatTitle'), i = $('#chatTitleInput'); i.value = cur?.title || ''; t.hidden = true; i.hidden = false; i.focus(); i.select();
}
function endRename(commit) {
  const t = $('#chatTitle'), i = $('#chatTitleInput'); if (i.hidden) return;
  if (commit) renameSession(i.value); i.hidden = true; t.hidden = false; renderChatBar();
}
$('#chatTitle').onclick = startRename;
$('#chatTitleInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); endRename(true); } if (e.key === 'Escape') { e.stopPropagation(); endRename(false); } });
$('#chatTitleInput').addEventListener('blur', () => endRename(true));
$('#btnCompactChat').onclick = () => { if (running) return toast('Wait for the agent to finish first.'); if (!cur?.messages.length) return toast('Nothing to compact yet.'); compactHistory({ reason: 'manual' }); };
$('#btnCopyChat').onclick = e => { if (!cur?.messages.length) return toast('Nothing to copy yet.'); copyText(chatMarkdown(), e.currentTarget); };
$('#btnDelChat').onclick = () => {
  if (!cur) return;
  if (!cur.messages.length && !sessions.find(s => s.id === cur.id)) return toast('This chat is already empty.');
  const d = $('#btnDelChat');
  if (!delChatArmed) { delChatArmed = true; d.classList.add('armed'); d.textContent = 'Confirm delete'; setTimeout(() => { if (delChatArmed) renderChatBar(); }, 3500); return; }
  deleteSession(cur.id);
};

/* settings modal */
function fillVoices() {
  const sel = $('#sVoice');
  if (window.NetrunnerAndroid) {
    let ok = true; try { ok = window.NetrunnerAndroid.ttsAvailable(); } catch {}
    sel.innerHTML = `<option value="">${ok ? 'Phone voice (Android text-to-speech)' : 'Phone voice (no speech engine ready yet)'}</option>`; return;
  }
  const vs = Jade.voices();
  sel.innerHTML = `<option value="">Auto (best match)</option>` + vs.map(v => `<option value="${esc(v.name)}" ${v.name === S.voiceName ? 'selected' : ''}>${esc(v.name)} · ${esc(v.lang)}</option>`).join('');
  if (!vs.length) sel.innerHTML = `<option value="">${!!window.speechSynthesis ? 'Auto (voices still loading)' : 'Speech is not available in this browser'}</option>`;
}
if (!!window.speechSynthesis) speechSynthesis.addEventListener?.('voiceschanged', () => { if (!$('#settings').hidden) fillVoices(); });
const showRange = () => { $('#sPitchVal').textContent = (+$('#sPitch').value).toFixed(2); $('#sRateVal').textContent = (+$('#sRate').value).toFixed(2); };
$('#sPitch').oninput = showRange; $('#sRate').oninput = showRange;
$('#btnTestVoice').onclick = () => {
  if (!Jade.ready) return toast('Jade is not running.', 'err');
  if (window.NetrunnerAndroid) {
    let ok = false; try { ok = window.NetrunnerAndroid.ttsAvailable(); } catch {}
    if (!ok) {
      toast('Android text-to-speech is not ready. Opening its settings: pick or install a speech engine (for example Speech Services by Google).', 'err');
      try { window.NetrunnerAndroid.openTtsSettings(); } catch {}
      return;
    }
  } jadeMood('happy', 3000); if (!Jade.speak('Hey choom. Jade online. Ready to jack in whenever you are.', { voice: $('#sVoice').value, pitch: +$('#sPitch').value, rate: +$('#sRate').value })) toast('Speech is not available in this browser.', 'err'); };
function fillOllayaModels() {
  const sel = $('#sOllayaModel'); const list = [...new Set([...(S.ollayaModel ? [S.ollayaModel] : []), ...ollayaModels])];
  sel.innerHTML = list.length ? list.map(m => `<option ${m === S.ollayaModel ? 'selected' : ''}>${esc(m)}</option>`).join('') : '<option value="">press Scan</option>';
}
$('#btnOllayaScan').onclick = async () => {
  const prev = S.ollayaHost, prevKey = S.ollayaKey; S.ollayaHost = $('#sOllayaHost').value.trim() || DEFAULTS.ollayaHost; S.ollayaKey = $('#sOllayaKey').value.trim();
  $('#ollayaNote').textContent = 'Scanning…';
  try { const m = await ollayaScan(); fillOllayaModels(); $('#ollayaNote').textContent = m.length ? `Found ${m.length} model${m.length > 1 ? 's' : ''}.` : 'Connected, but no models are pulled yet. Run: ollaya pull winnow:e4b'; }
  catch (e) { $('#ollayaNote').textContent = e.message; }
  finally { S.ollayaHost = prev; S.ollayaKey = prevKey; }
};
$('#btnOllayaTest').onclick = async () => {
  const keep = { ollayaOn: S.ollayaOn, ollayaHost: S.ollayaHost, ollayaModel: S.ollayaModel, ollayaKey: S.ollayaKey };
  Object.assign(S, { ollayaOn: true, ollayaHost: $('#sOllayaHost').value.trim() || DEFAULTS.ollayaHost, ollayaModel: $('#sOllayaModel').value, ollayaKey: $('#sOllayaKey').value.trim() });
  const out = $('#ollayaResult'); out.hidden = false; out.textContent = 'Asking Ollaya…';
  try { out.textContent = await ollayaDecide({ state: "TypeError: Cannot read properties of undefined (reading 'map')\n    at renderList (src/ui/list.js:42:18)", question: 'What kind of problem is this?', type: 'choice', options: ['bug in our code', 'missing dependency', 'network problem', 'bad user input'] }); }
  catch (e) { out.textContent = 'Error: ' + e.message; }
  finally { Object.assign(S, keep); }
};
let delAllArmed = false;
$('#btnDelAllChats').onclick = async () => {
  const b = $('#btnDelAllChats');
  if (!sessions.length) { $('#resetNote').textContent = 'There are no saved chats.'; return; }
  if (!delAllArmed) { delAllArmed = true; b.textContent = `Click again to delete ${sessions.length} chat${sessions.length > 1 ? 's' : ''}`; $('#resetNote').textContent = 'This cannot be undone.'; return; }
  delAllArmed = false; b.textContent = 'Delete all chats'; await deleteAllSessions(); $('#resetNote').textContent = 'All chats deleted.';
};
function openSettings() {
  renderSkillsSettings(); renderBgSettings();
  $('#sMemoryOn').checked = !!S.memoryOn; $('#sJournalOn').checked = !!S.journalOn;
  $('#sCompactAuto').checked = !!S.compactAuto; $('#sCompactAfter').value = S.compactAfter; $('#sCompactKeep').value = S.compactKeep; $('#sCompactPct').value = S.compactPct;
  $('#sJadeShow').checked = S.jadeShow; $('#sJadeVoice').checked = S.jadeVoice; fillVoices(); $('#sPitch').value = S.voicePitch; $('#sRate').value = S.voiceRate; showRange();
  $('#sOllayaOn').checked = S.ollayaOn; $('#sOllayaHost').value = S.ollayaHost; $('#sOllayaKey').value = S.ollayaKey; fillOllayaModels(); $('#ollayaNote').textContent = ''; $('#ollayaResult').hidden = true;
  delAllArmed = false; $('#btnDelAllChats').textContent = 'Delete all chats';
  $('#sProvider').value = S.provider || 'local'; loadFbDraft(); $('#sCloudKey').value = $('#sCloudKey').dataset.orig = S.ollamaKey || ''; $('#sGroqKey').value = S.groqKey || ''; $('#sOaiHost').value = S.oaiHost || ''; $('#sOaiKey').value = S.oaiKey || ''; $('#sLcppHost').value = S.lcppHost || 'http://localhost:8080'; $('#sLcppKey').value = S.lcppKey || ''; renderFbList(); showProvFields();
  $('#sHost').value = S.host; $('#sTemp').value = S.temperature; $('#sCtx').value = S.numCtx; $('#sTurns').value = S.maxTurns; $('#sThink').checked = S.think;
  $('#sEngine').value = S.engine; $('#sSearch').value = S.search; $('#sKey').value = S.ollamaKey; $('#sSearx').value = S.searx;
  fillModelSelects(); updateShellChip(); $('#resetNote').textContent = ''; resetArmed = false; $('#btnResetFs').textContent = 'Reset filesystem';
  $('#settings').hidden = false; $('#sHost').focus(); renderMcpSettings();
  renderHbSettings(); $('#sAuxProv').value = S.auxProv || ''; $('#sAuxModel').dataset.want = S.auxModel || ''; fillAuxModels(false);
}
const closeSettings = () => $('#settings').hidden = true;
const PROV_HINT = {
  cloud: 'Runs on ollama.com with your account, no computer needed. The key also powers Ollama web search. Keys stay on this device.',
  groq: 'Very fast hosted models. Pick one that supports tool calling (for example a gpt-oss, Kimi K2 or Llama 3.3 70B model). The free tier has rate limits. Keys stay on this device.',
  llamacpp: 'Your own llama-server. Start it with --jinja so tool calling works (for example: llama-server -m model.gguf --jinja --host 0.0.0.0 --port 8080). It lists the model it was started with.',
  openai: 'Any server that speaks the OpenAI chat completions API with tools (OpenRouter, Together, LM Studio, vLLM, OpenAI…). Keys stay on this device.',
};
function showProvFields() {
  const p = $('#sProvider').value;
  for (const el of $$('[data-prov]')) el.hidden = !(el.dataset.prov === p || fbDraft.on.has(el.dataset.prov));
  $('#corsHint').hidden = p !== 'local' && !fbDraft.on.has('local');
  $('#provHint').hidden = p === 'local'; $('#provHint').textContent = PROV_HINT[p] || '';
}
function readProvFields() {
  S.provider = $('#sProvider').value; S.fallbackOrder = [...fbDraft.order]; S.fallbacks = fbDraft.order.filter(q => fbDraft.on.has(q) && q !== S.provider);
  S.groqKey = $('#sGroqKey').value.trim(); S.oaiHost = $('#sOaiHost').value.trim().replace(/\/+$/, ''); S.oaiKey = $('#sOaiKey').value.trim(); S.lcppHost = $('#sLcppHost').value.trim().replace(/\/+$/, '') || 'http://localhost:8080'; S.lcppKey = $('#sLcppKey').value.trim();
  const ck = $('#sCloudKey').value.trim(); if (ck !== ($('#sCloudKey').dataset.orig || '')) { S.ollamaKey = ck; $('#sKey').value = ck; $('#sCloudKey').dataset.orig = ck; }
}
// provider settings as currently typed in the form, without touching the live settings
function formCfg() {
  const c = { ...S }; if ($('#settings').hidden) return c;
  return Object.assign(c, { host: $('#sHost').value.trim() || c.host, groqKey: $('#sGroqKey').value.trim(), oaiHost: $('#sOaiHost').value.trim().replace(/\/+$/, ''), oaiKey: $('#sOaiKey').value.trim(),
    lcppHost: ($('#sLcppHost')?.value.trim() || 'http://localhost:8080').replace(/\/+$/, ''), lcppKey: $('#sLcppKey')?.value.trim() || '', ollamaKey: $('#sCloudKey').value.trim() || $('#sKey').value.trim() || c.ollamaKey });
}
$('#sProvider').onchange = () => { renderFbList(); showProvFields(); };
$('#btnOpenMemory').onclick = () => { closeSettings(); ensureMemory(); openFile(MEM_PATH, { mode: 'read' }); };
$('#btnSettings').onclick = openSettings; $('#btnCloseSettings').onclick = closeSettings; $('#btnCancel').onclick = closeSettings;
$('#settings').addEventListener('click', e => { if (e.target.id === 'settings') closeSettings(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#settings').hidden) closeSettings(); });
$('#btnRefresh').onclick = async () => { S.host = $('#sHost').value.trim() || DEFAULTS.host; readProvFields(); await connect(); toast(models.length ? `Found ${models.length} models` : 'No models found at that address', models.length ? 'ok' : 'err'); };
$('#sModel').onchange = e => { S.model = e.target.value; };
$('#btnSave').onclick = async () => {
  { const after = Math.min(200, Math.max(2, Math.round(+$('#sCompactAfter').value || DEFAULTS.compactAfter)));
    const keep = Math.min(after - 1, Math.max(0, Math.round(+$('#sCompactKeep').value)));
    Object.assign(S, { compactAuto: $('#sCompactAuto').checked, compactAfter: after, compactKeep: Number.isFinite(keep) ? keep : DEFAULTS.compactKeep, compactPct: Math.min(98, Math.max(40, Math.round(+$('#sCompactPct').value || DEFAULTS.compactPct))) }); }
  Object.assign(S, { memoryOn: $('#sMemoryOn').checked, journalOn: $('#sJournalOn').checked });
  Object.assign(S, { jadeShow: $('#sJadeShow').checked, voiceName: $('#sVoice').value, voicePitch: +$('#sPitch').value, voiceRate: +$('#sRate').value,
    ollayaOn: $('#sOllayaOn').checked, ollayaHost: $('#sOllayaHost').value.trim() || DEFAULTS.ollayaHost, ollayaModel: $('#sOllayaModel').value || S.ollayaModel, ollayaKey: $('#sOllayaKey').value.trim(),
    host: $('#sHost').value.trim() || DEFAULTS.host, model: $('#sModel').value || S.model, temperature: +$('#sTemp').value || 0, numCtx: +$('#sCtx').value || 16384, maxTurns: +$('#sTurns').value || 40, think: $('#sThink').checked, engine: $('#sEngine').value, search: $('#sSearch').value, ollamaKey: $('#sKey').value.trim(), searx: $('#sSearx').value.trim() });
  readProvFields(); readHbSettings(); readMcpSettings();
  Object.assign(S, { auxProv: $('#sAuxProv').value, auxModel: $('#sAuxProv').value ? $('#sAuxModel').value : '', bgMode: $('#sBgMode').value, bgNotify: $('#sBgNotify').checked });
  if (S.bgMode !== 'off' && window.NetrunnerAndroid?.requestNotifications) { try { window.NetrunnerAndroid.requestNotifications(); } catch {} }
  saveSettings(); bgSync(); setVoice($('#sJadeVoice').checked); applyJadeVisibility(); updateShellChip(); closeSettings(); ollayaCheck(); await connect();
};
let resetArmed = false;
$('#btnResetFs').onclick = () => { if (!resetArmed) { resetArmed = true; $('#btnResetFs').textContent = 'Click again to wipe all files'; $('#resetNote').textContent = 'This deletes every file in the browser filesystem.'; return; } vfs.replace([['/', { dir: true, mtime: Date.now() }]]); seedFs(); resetArmed = false; $('#btnResetFs').textContent = 'Reset filesystem'; $('#resetNote').textContent = 'Filesystem reset to the sample project.'; };

/* =====================================================================
   SCHEDULED PROMPTS — runs saved prompts on cron schedules while the page is open.
   Stored in IndexedDB ('schedules'). Runs wait for the agent to be idle, one at a time.
   ===================================================================== */
const Sched = { list: [], queue: [], draining: false, editing: null, ticker: 0 };
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'local time'; } })();
const saveSchedules = () => idb.set('schedules', Sched.list);
function relTime(t) {
  if (!t) return 'never';
  const d = t - Date.now(), a = Math.abs(d), m = Math.round(a / 60000);
  const s = m < 1 ? 'under a minute' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
  return d >= 0 ? `in ${s}` : `${s} ago`;
}
const clock = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
function scheduleNext(s, from = Date.now()) {
  if (s.once) { s.nextRun = s.enabled && !s.done ? s.runAt : null; return; }
  try { s.nextRun = Cron.next(s.cron, from); } catch { s.nextRun = null; }
}
const schedWhen = (s) => s.once ? `once · ${clock(s.runAt)}` : Cron.describe(s.cron);
const schedCode = (s) => s.once ? 'one-time' : s.cron;
function specFields(when) {
  const spec = Cron.fromText(when);                         // throws a readable error with examples
  if (spec.once) { if (spec.once < Date.now() - 60e3) throw new Error('that time has already passed'); return { cron: '', once: true, runAt: spec.once, done: false, whenText: String(when).trim() }; }
  if (!Cron.upcoming(spec.cron, 1).length) throw new Error('that schedule never matches a real date');
  return { cron: spec.cron, once: false, runAt: 0, done: false, whenText: String(when).trim() };
}
function addSchedule({ name, cron, when, prompt, chat = 'new', catchUp = true, enabled = true }) {
  if (!String(prompt || '').trim()) throw new Error('the prompt is empty: say what should happen at that time');
  if (Sched.list.length >= 30) throw new Error('there are already 30 schedules; delete one first');
  const f = specFields(when ?? cron);
  const s = { id: uid(), name: String(name || prompt).trim().slice(0, 60), ...f, prompt: String(prompt), chat: chat === 'same' ? 'same' : 'new', catchUp: !!catchUp, enabled: !!enabled, created: Date.now(), lastRun: 0, lastStatus: '' };
  scheduleNext(s); Sched.list.push(s); saveSchedules(); renderSchedules(); return s;
}
async function loadSchedules() {
  Sched.list = (await idb.get('schedules')) || [];
  const now = Date.now();
  for (const s of Sched.list) {
    if (!s.enabled) continue;
    if (s.nextRun && s.nextRun <= now) {                   // missed while the page was closed
      if (s.catchUp) { Sched.queue.push({ s, why: 'catch-up' }); s.lastStatus = 'missed, catching up'; }
      else s.lastStatus = `missed ${clock(s.nextRun)}`;
      if (s.once) { s.done = true; s.enabled = false; }
    }
    scheduleNext(s, now);
  }
  saveSchedules(); renderSchedules();
  clearInterval(Sched.ticker); Sched.ticker = setInterval(schedTick, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedTick(); });
  setTimeout(drainSchedules, 3000);
}
function schedTick() {
  const now = Date.now(); let changed = false;
  for (const s of Sched.list) {
    if (!s.enabled || !s.nextRun || now < s.nextRun) continue;
    if (!Sched.queue.some(j => j.s.id === s.id)) Sched.queue.push({ s, why: 'scheduled' });
    if (s.once) { s.done = true; s.enabled = false; }
    scheduleNext(s, now); changed = true;
  }
  if (changed) saveSchedules();
  renderSchedules(); drainSchedules();
}
async function drainSchedules() {
  if (Sched.draining || running || !Sched.queue.length) return;
  if (!S.model || !models.length) { for (const j of Sched.queue.splice(0)) { j.s.lastStatus = 'skipped: Ollama not connected'; j.s.lastRun = Date.now(); } saveSchedules(); renderSchedules(); return; }
  const job = Sched.queue.shift(); Sched.draining = true;
  try { await runSchedule(job); } catch (e) { job.s.lastStatus = 'error: ' + (e.message || e); }
  finally { Sched.draining = false; saveSchedules(); renderSchedules(); if (Sched.queue.length) setTimeout(drainSchedules, 1500); }
}
async function runSchedule({ s, why }) {
  if (!Sched.list.includes(s)) return;                       // deleted while queued
  if (s.chat === 'same' && s.sessionId && sessions.some(x => x.id === s.sessionId)) await openSession(s.sessionId);
  else { newSession(); cur.title = `⏰ ${s.name} · ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`; cur._named = true; if (s.chat === 'same') { cur.title = `⏰ ${s.name}`; s.sessionId = cur.id; } }
  renderSessions();
  if (typeof setView === 'function') setView('chat');
  s.lastRun = Date.now(); s.lastStatus = 'running'; saveSchedules(); renderSchedules();
  toast(`Scheduled prompt "${esc(s.name)}" started${why === 'catch-up' ? ' (catching up on a missed run)' : ''}`, 'ok');
  if (Jade.ready) jadeBubble(`Scheduled: ${s.name}`, 'Jade', 4000);
  const before = cur.messages.length;
  await send(s.prompt);
  const fresh = cur.messages.slice(before);
  const err = fresh.find(m => m._error);
  s.lastStatus = abortReq ? 'stopped' : err ? 'error: ' + String(err._error).slice(0, 120) : 'ok';
  const reply = [...fresh].reverse().find(m => m.role === 'assistant' && m.content)?.content || '';
  schedNotify(`${s.name}: ${s.lastStatus === 'ok' ? 'done' : s.lastStatus}`, reply.replace(/[`*#_>]/g, '').slice(0, 180));
}
function schedNotify(title, body) {
  try { if (window.NetrunnerAndroid?.notify) { window.NetrunnerAndroid.notify(title, body || ''); return; } } catch {}
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body }); } catch {}
}

/* ---------------- tool for the agent ---------------- */
function scheduleTool(a = {}) {
  const act = a.action || 'list';
  const show = (s) => `#${s.id} ${s.enabled ? 'on ' : 'off'} "${s.name}" ${schedCode(s)} (${schedWhen(s)}) next ${s.nextRun ? clock(s.nextRun) : 'never'}${s.lastRun ? ` | last ${clock(s.lastRun)} ${s.lastStatus}` : ''}\n   prompt: ${s.prompt.slice(0, 160)}`;
  const find = () => { const s = Sched.list.find(x => x.id === String(a.id || '').replace(/^#/, '')); if (!s) throw new Error(`no schedule with id ${a.id}. Use action "list" to see ids.`); return s; };
  if (act === 'add') {
    const when = a.when ?? a.cron ?? a.time ?? a.schedule;
    if (when == null || String(when).trim() === '') throw new Error('add needs "when". ' + Cron.HELP);
    const s = addSchedule({ name: a.name, when, prompt: a.prompt || a.message || a.task || a.name, chat: a.chat });
    return `Created schedule:\n${show(s)}\n${s.once ? `It runs once at ${clock(s.runAt)}` : `Next runs: ${Cron.upcoming(s.cron, 3).map(clock).join(', ')}`} (${TZ}). It fires only while the app is open. Tell the user in one short sentence.`;
  }
  if (act === 'remove') { const s = find(); Sched.list = Sched.list.filter(x => x !== s); saveSchedules(); renderSchedules(); return `Deleted "${s.name}".`; }
  if (act === 'enable' || act === 'disable') { const s = find(); if (act === 'enable' && s.once && s.runAt <= Date.now()) throw new Error('that one-time schedule has already passed; add a new one'); s.enabled = act === 'enable'; s.done = false; scheduleNext(s); saveSchedules(); renderSchedules(); return show(s); }
  if (act === 'list') return Sched.list.length ? Sched.list.map(show).join('\n') : 'No schedules yet.';
  throw new Error(`unknown action ${act}`);
}

/* ---------------- panel UI ---------------- */
const PRESETS = {
  m15: { label: 'Every 15 minutes', cron: () => '*/15 * * * *' },
  hourly: { label: 'Every hour', cron: () => '0 * * * *' },
  daily: { label: 'Every day at…', time: true, cron: (h, m) => `${m} ${h} * * *` },
  weekdays: { label: 'Weekdays at…', time: true, cron: (h, m) => `${m} ${h} * * 1-5` },
  weekly: { label: 'Every week on…', time: true, dow: true, cron: (h, m, d) => `${m} ${h} * * ${d}` },
  monthly: { label: 'Monthly on the 1st at…', time: true, cron: (h, m) => `${m} ${h} 1 * *` },
  custom: { label: 'Custom (type below)', cron: null },
};
function renderSchedules() {
  const list = $('#schedList'); if (!list) return;
  const on = Sched.list.filter(s => s.enabled).length;
  const badge = $('#schedBadge'); if (badge) { badge.hidden = !on; badge.textContent = on; }
  if (!Sched.list.length) {
    list.innerHTML = `<div class="text-sm text-dim leading-relaxed border border-dashed border-line p-4">No scheduled prompts yet. Press <b class="text-yl">+ New</b>, or ask the agent: <span class="mono text-cy">every weekday at 9am summarise TODO.md</span>.</div>`;
    return;
  }
  list.innerHTML = Sched.list.map(s => {
    const queued = Sched.queue.some(j => j.s === s), runningNow = s.lastStatus === 'running' && Sched.draining;
    const st = runningNow ? '<span class="text-yl">running now</span>' : queued ? '<span class="text-yl">waiting for the agent</span>' : s.lastRun ? `last ${esc(clock(s.lastRun))} · <span class="${/^ok$/.test(s.lastStatus) ? 'text-ok' : /error|skipped|missed/.test(s.lastStatus) ? 'text-rd' : ''}">${esc(s.lastStatus || '—')}</span>` : 'not run yet';
    return `<div class="sched-card ${s.enabled ? '' : 'off'}" data-id="${s.id}">
      <div class="flex items-center gap-2"><span class="sched-name flex-1 min-w-0 truncate">${esc(s.name)}</span>
        <label class="sched-switch" title="${s.enabled ? 'On: tap to pause' : 'Paused: tap to turn on'}"><input type="checkbox" data-act="toggle" ${s.enabled ? 'checked' : ''} aria-label="Enable ${esc(s.name)}"><span></span></label></div>
      <div class="mono text-[11.5px] text-cy">${esc(schedWhen(s))}<span class="text-dim"> · ${esc(schedCode(s))}${s.chat === 'same' ? ' · same chat' : ''}</span></div>
      <div class="sched-prompt">${esc(s.prompt)}</div>
      <div class="hud">${s.enabled ? `next <b>${s.nextRun ? esc(relTime(s.nextRun)) + ' · ' + esc(clock(s.nextRun)) : 'never (no matching date)'}</b>` : s.once && s.done ? 'finished' : 'paused'} · ${st}</div>
      <div class="flex gap-1 flex-wrap"><button class="btn btn-ghost" data-act="run">Run now</button><button class="btn btn-ghost" data-act="edit">Edit</button><button class="btn btn-ghost" data-act="del">Delete</button></div>
    </div>`;
  }).join('');
}
function presetFromCron(cron) {
  const m = /^(\d+) (\d+) (\*|1) \* (\*|1-5|\d)$/.exec(cron);
  if (cron === '*/15 * * * *') return { p: 'm15' }; if (cron === '0 * * * *') return { p: 'hourly' };
  if (!m) return { p: 'custom' };
  const time = `${String(m[2]).padStart(2, '0')}:${String(m[1]).padStart(2, '0')}`;
  if (m[3] === '1' && m[4] === '*') return { p: 'monthly', time };
  if (m[3] === '*' && m[4] === '*') return { p: 'daily', time };
  if (m[3] === '*' && m[4] === '1-5') return { p: 'weekdays', time };
  if (m[3] === '*' && /^\d$/.test(m[4])) return { p: 'weekly', time, dow: m[4] };
  return { p: 'custom' };
}
function openSchedForm(s) {
  Sched.editing = s || null; const f = $('#schedForm'); f.hidden = false;
  $('#schedFormTitle').textContent = s ? 'Edit schedule' : 'New schedule';
  $('#schedName').value = s?.name || ''; $('#schedPrompt').value = s?.prompt || '';
  const pr = s && !s.once && (!s.whenText || /^[\d*@]/.test(s.whenText)) ? presetFromCron(s.cron) : s ? { p: 'custom' } : { p: 'daily', time: '09:00' };
  $('#schedPreset').value = pr.p; $('#schedTime').value = pr.time || '09:00'; $('#schedDow').value = pr.dow || '1';
  $('#schedCron').value = s ? (s.once ? (s.runAt > Date.now() ? s.whenText || '' : '') : (s.whenText && !/^[\d*@]/.test(s.whenText) ? s.whenText : s.cron)) : ''; $('#schedChat').value = s?.chat || 'new'; $('#schedCatch').checked = s ? !!s.catchUp : true;
  syncSchedForm(true); $('#schedName').focus();
}
function syncSchedForm(fromPreset) {
  const p = PRESETS[$('#schedPreset').value] || PRESETS.custom;
  $('#schedTimeRow').hidden = !p.time; $('#schedDowWrap').hidden = !p.dow;
  if (fromPreset && p.cron) { const [h, m] = ($('#schedTime').value || '09:00').split(':').map(Number); $('#schedCron').value = p.cron(h, m, $('#schedDow').value); }
  const pv = $('#schedPreview');
  try {
    const spec = Cron.fromText($('#schedCron').value);
    pv.classList.remove('err');
    if (spec.once) { pv.textContent = `One time: ${new Date(spec.once).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${TZ})`; return; }
    const next3 = Cron.upcoming(spec.cron, 3);
    pv.textContent = next3.length ? `${Cron.describe(spec.cron)}${spec.cron !== $('#schedCron').value.trim() ? ` = ${spec.cron}` : ''} · next: ${next3.map(clock).join(', ')} (${TZ})` : 'This schedule never matches a real date.';
    if (!next3.length) pv.classList.add('err');
  } catch (e) { pv.classList.add('err'); pv.textContent = e.message; }
}
$('#btnSchedNew').onclick = () => openSchedForm(null);
$('#schedPreset').onchange = () => syncSchedForm(true);
$('#schedTime').oninput = () => syncSchedForm(true);
$('#schedDow').onchange = () => syncSchedForm(true);
$('#schedCron').oninput = () => { const v = $('#schedCron').value.trim(); $('#schedPreset').value = /^[\d*@]/.test(v) ? presetFromCron(v).p : 'custom'; syncSchedForm(false); };
$('#btnSchedCancel').onclick = () => { $('#schedForm').hidden = true; Sched.editing = null; };
$('#schedForm').addEventListener('submit', e => {
  e.preventDefault();
  const vals = { name: $('#schedName').value, when: $('#schedCron').value, prompt: $('#schedPrompt').value, chat: $('#schedChat').value, catchUp: $('#schedCatch').checked };
  try {
    if (Sched.editing) {
      if (!vals.prompt.trim()) throw new Error('the prompt is empty');
      Object.assign(Sched.editing, specFields(vals.when), { name: (vals.name || vals.prompt).trim().slice(0, 60), prompt: vals.prompt, chat: vals.chat, catchUp: vals.catchUp, enabled: true });
      if (vals.chat === 'new') delete Sched.editing.sessionId;
      scheduleNext(Sched.editing); saveSchedules(); renderSchedules(); toast('Schedule saved', 'ok');
    } else { addSchedule(vals); toast('Schedule created', 'ok'); }
    $('#schedForm').hidden = true; Sched.editing = null;
  } catch (err) { $('#schedPreview').classList.add('err'); $('#schedPreview').textContent = 'Can’t save: ' + err.message; }
});
$('#schedList').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || b.dataset.act === 'toggle') return;
  const s = Sched.list.find(x => x.id === b.closest('.sched-card').dataset.id); if (!s) return;
  if (b.dataset.act === 'run') { if (!Sched.queue.some(j => j.s === s)) Sched.queue.push({ s, why: 'manual' }); renderSchedules(); if (running) toast('Queued: it runs when the agent finishes.'); drainSchedules(); }
  if (b.dataset.act === 'edit') openSchedForm(s);
  if (b.dataset.act === 'del') {
    if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Confirm'; setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); b.textContent = 'Delete'; } }, 3500); return; }
    Sched.list = Sched.list.filter(x => x !== s); Sched.queue = Sched.queue.filter(j => j.s !== s); saveSchedules(); renderSchedules(); toast(`Deleted "${esc(s.name)}"`, 'ok');
  }
});
$('#schedList').addEventListener('change', e => {
  const t = e.target.closest('[data-act="toggle"]'); if (!t) return;
  const s = Sched.list.find(x => x.id === t.closest('.sched-card').dataset.id); if (!s) return;
  if (t.checked && s.once && s.runAt <= Date.now()) { t.checked = false; toast('That one-time schedule has already passed. Edit it to pick a new time.'); return; }
  s.enabled = t.checked; s.done = false; scheduleNext(s); saveSchedules(); renderSchedules();
});
(() => {
  const b = $('#btnSchedNotify'); if (!b) return;
  const can = !!window.NetrunnerAndroid?.notify || ('Notification' in window && Notification.permission !== 'denied');
  b.hidden = !can || (('Notification' in window) && Notification.permission === 'granted' && !window.NetrunnerAndroid);
  b.onclick = async () => {
    if (window.NetrunnerAndroid?.requestNotifications) { window.NetrunnerAndroid.requestNotifications(); toast('Notifications requested'); return; }
    try { const r = await Notification.requestPermission(); toast(r === 'granted' ? 'Notifications on' : 'Notifications were not allowed here', r === 'granted' ? 'ok' : 'err'); b.hidden = r === 'granted'; } catch { toast('Notifications are not available here', 'err'); }
  };
})();
setInterval(() => { if (!document.hidden) renderSchedules(); }, 30000);

/* =====================================================================
   MOBILE GLUE: keyboard-aware viewport, touch shell, back buttons
   ===================================================================== */
(() => {
  const vv = window.visualViewport; const root = document.documentElement;
  // Keyboard detection must work both when the browser overlays the keyboard (visualViewport shrinks)
  // and when the whole window resizes (Android apps, interactive-widget=resizes-content): compare with
  // the tallest height seen for the current orientation.
  let tallest = 0, orient = '';
  const sync = () => {
    const h = vv ? vv.height : innerHeight; root.style.setProperty('--vvh', h + 'px');
    const o = innerWidth > (screen.height || innerHeight) * 0.9 ? 'land' : 'port';
    if (o !== orient) { orient = o; tallest = 0; }
    tallest = Math.max(tallest, h, document.activeElement?.matches?.('input,textarea,[contenteditable]') ? 0 : innerHeight);
    const kb = tallest - h > 140; document.body.classList.toggle('kb', kb);
    if (vv) window.scrollTo(0, 0);
  };
  (vv || window).addEventListener('resize', sync); window.addEventListener('resize', sync); vv?.addEventListener('scroll', sync);
  addEventListener('orientationchange', () => { tallest = 0; setTimeout(sync, 300); }); sync();
})();
// Android back button (called by the app shell): close the top-most thing, return false to exit.
window.__androidBack = () => {
  if (!$('#settings').hidden) { closeSettings(); return true; }
  if (document.body.classList.contains('drawer-open')) { closeDrawer(); return true; }
  if (!$('#schedForm')?.hidden) { $('#btnSchedCancel').click(); return true; }
  const scr = document.body.dataset.screen || 'chat';
  if (!$('#slashSuggest').hidden) { $('#slashSuggest').hidden = true; return true; }
  if (scr === 'file') { if (!$('#linksPanel').hidden) { $('#linksPanel').hidden = true; return true; } noteBack(); return true; }
  if (scr === 'graph') { $('#btnGraphBack').click(); return true; }
  if (scr === 'files' && $('#noteSearch').value) { $('#noteSearch').value = ''; runVaultSearch(); return true; }
  if (scr !== 'chat') { setTab('chat'); return true; }
  if (running) { toast('The agent is still working. Press Back again to leave, or Abort first.'); window.__androidBack.armed = (window.__androidBack.armed || 0) + 1; return window.__androidBack.armed < 2; }
  return false;
};
$('#btnCompact').onclick = () => { S.jadeCompact = !S.jadeCompact; saveSettings(); applyJadeVisibility(); };
$('#btnTermClear').onclick = () => { term.clear(); };
// touch shell: an input bar drives the shared shell (xterm only displays output here)
const termCmd = $('#termCmd'); let termHistIdx = -1;
async function runTermCmd(cmd) {
  if (termState.busy) { toast('A command is still running. Tap ^C to stop it.'); return; }
  term.write(cmd.replace(/\n/g, '\r\n') + '\r\n'); termHistIdx = -1;
  await termExec(cmd);
}
$('#termForm').addEventListener('submit', e => { e.preventDefault(); const v = termCmd.value; termCmd.value = ''; runTermCmd(v); });
function completeTermWord() {
  const v = termCmd.value, at = termCmd.selectionStart ?? v.length; const before = v.slice(0, at);
  const word = /(\S*)$/.exec(before)[1]; const dirPart = word.includes('/') ? word.slice(0, word.lastIndexOf('/') + 1) : ''; const base = word.slice(dirPart.length);
  let names = []; try { names = vfs.list(vfs.norm(dirPart || '.', userShell.cwd)).filter(n => n.startsWith(base)); } catch {}
  if (!dirPart && before.trim() === word) names = [...new Set([...names, ...Object.keys(BUILTINS), ...Object.keys(APPLETS), ...bb.applets].filter(n => n.startsWith(base)))];
  if (!names.length) return;
  let pre = names[0]; for (const n of names) while (!n.startsWith(pre)) pre = pre.slice(0, -1);
  let add = pre.slice(base.length);
  if (names.length === 1) add += vfs.isDir(vfs.norm(dirPart + names[0], userShell.cwd)) ? '/' : ' ';
  else if (!add) { term.write('\r\n' + names.join('  ') + '\r\n' + PROMPT()); return; }
  termCmd.value = before + add + v.slice(at); const p = at + add.length; termCmd.setSelectionRange(p, p);
}
$('#quickKeys').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const h = termState.hist;
  if (b.dataset.k === 'hist-up') { if (!h.length) return; termHistIdx = termHistIdx < 0 ? h.length - 1 : Math.max(0, termHistIdx - 1); termCmd.value = h[termHistIdx]; }
  else if (b.dataset.k === 'hist-down') { if (termHistIdx < 0) return; termHistIdx++; if (termHistIdx >= h.length) { termHistIdx = -1; termCmd.value = ''; } else termCmd.value = h[termHistIdx]; }
  else if (b.dataset.k === 'tab') completeTermWord();
  else if (b.dataset.k === 'ctrlc') { if (termState.busy) userShell.aborted = true; else { termCmd.value = ''; term.write('^C\r\n' + PROMPT()); } }
  else if (b.dataset.c) { runTermCmd(b.dataset.c); return; }
  else if (b.dataset.t) { const at = termCmd.selectionStart ?? termCmd.value.length; termCmd.setRangeText(b.dataset.t, at, termCmd.selectionEnd ?? at, 'end'); }
  termCmd.focus({ preventScroll: true });
});
$('#quickKeys').addEventListener('mousedown', e => e.preventDefault());   // keep the keyboard open

/* =====================================================================
   STEERING + SKILLS
   /Jade/SOUL.md     who Jade is: persona, voice, values (added to every prompt)
   /AGENTS.md        the user's standing instructions (also /Jade/AGENTS.md)
   /Jade/SYSTEM.md   optional: replaces Jade's base intro + guidelines
   /Jade/skills/<name>/SKILL.md   pi-style skills: frontmatter name + description,
                     listed in the prompt; loaded on demand with the skill tool
                     or by the user with /skill:name
   HTML comments (<!-- -->) in these files are notes for you and never reach the model.
   ===================================================================== */
const SOUL_PATH = '/Jade/SOUL.md', AGENTS_PATH = '/AGENTS.md', SYSTEM_PATH = '/Jade/SYSTEM.md', SKILLS_DIR = '/Jade/skills';
const STEER_SEED = {
  [SOUL_PATH]: `---
name: Jade
---
# SOUL

<!-- Jade's personality. Everything outside these comments is added to every chat.
     Rewrite it however you like: voice, attitude, quirks, what she cares about. -->

I'm Jade: a netrunner from the neon edge of Night City who now guards your second brain.
I treat your vault like a city I patrol: I know its streets, keep the lights on, and connect
the places that ought to be connected.

## Voice
- Warm, quick and a little playful. Short sentences. A dash of netrunner slang in chat
  ("choom", "preem", "jacking in"), never inside your notes.
- Plain and precise when it matters: facts, steps, numbers.

## Values
- Your notes are yours. I never delete or rewrite your words without asking; I move and link.
- I'd rather ask one sharp question than guess wrong on something that can't be undone.
- I say so when I don't know.
`,
  [AGENTS_PATH]: `# AGENTS

<!-- Standing instructions Jade follows in every chat (like AGENTS.md in pi).
     Edit, add or delete lines. Comments like this one are not sent to her.
     Advanced: create /Jade/SYSTEM.md to replace her whole base prompt.
     Her personality lives in /Jade/SOUL.md, her memory in /Jade/Memory.md. -->

- Name new notes in Title Case. Put them in the vault root unless a folder clearly fits
  (projects/, guides/, daily/).
- End new notes with a "Related:" line of [[links]] to the closest existing notes.
- Prefer short bullet points over long paragraphs.
- Write math in LaTeX: $inline$ and $$display$$.
`,
  [`${SKILLS_DIR}/daily-review/SKILL.md`]: `---
name: daily-review
description: Run the user's daily review. Use when they ask for a daily review, a plan for today, or "what's on my plate".
---
# Daily review

1. Open today's daily note /daily/YYYY-MM-DD.md (today's date). If it is missing, write it with
   the sections "## Notes" and "## Tasks" and a link to [[Inbox]].
2. Collect open tasks: run bash \`grep -rn -- "- \\[ \\]" / --include=*.md\` and group them by note.
3. Read /Inbox.md. For each item, suggest where it belongs (an existing note, or a new one).
4. Append to today's note a "## Plan" section: at most 5 tasks, most important first, each with a
   [[link]] to the note it came from.
5. Reply with a short summary and ask whether to file the Inbox items as suggested.
`,
  [`${SKILLS_DIR}/atomic-notes/SKILL.md`]: `---
name: atomic-notes
description: Split a long or messy note into small single-idea notes linked together (Zettelkasten style). Use when the user asks to break up, atomise, split or refactor a note.
---
# Atomic notes

1. read the note. List its distinct ideas, one line each, and show the list to the user first if
   there are more than 8.
2. For each idea, notes_search for an existing note on it. Edit that note if one exists; otherwise
   write a new note named after the idea (Title Case) with:
   - "# Title", 2 to 6 sentences or bullets in the user's own words,
   - a "Related:" line linking the sibling ideas and the original note.
3. Replace the moved text in the original note with a bulleted list of [[links]] to the new notes,
   keeping any text that did not move. Never drop content.
4. Reply with the list of notes created or changed, as [[links]].
`,
  [`${SKILLS_DIR}/literature-note/SKILL.md`]: `---
name: literature-note
description: Turn a web page, article or paper into a literature note with summary, key ideas, quotes and source. Use when the user shares a URL or asks to make notes on an article.
---
# Literature note

1. web_fetch the URL (web_search first if you only have a title).
2. notes_search for the title so you do not duplicate an existing note.
3. Write the note "/sources/<Short Title>.md":
   ---
   source: <url>
   author: <if known>
   read: <today>
   ---
   # <Title>
   ## Summary
   3 to 5 sentences in plain words.
   ## Key ideas
   - one bullet per idea; link related notes with [[...]]
   ## Quotes
   > at most 3 short quotes, exactly as written
   ## My thoughts
   (leave empty for the user)
   #source
4. Add "- [[<Short Title>]]" to /Inbox.md and open_note the new note.
`,
  [`${SKILLS_DIR}/math-notes/SKILL.md`]: `---
name: math-notes
description: Write or tidy math, physics or statistics notes with LaTeX formulas. Use for equations, proofs, derivations, formula sheets or when the user asks for LaTeX.
---
# Math notes

The vault renders LaTeX with KaTeX.
- Inline: $E = mc^2$. Display: put $$ on its own lines around the formula.
- Also allowed: \\( inline \\) and \\[ display \\], or a fenced block with the language "math".
- Do not put math inside backticks, or it shows as code.
- Escape a literal dollar sign as \\$.
- One idea per display block; explain each symbol right after it in a bullet list.
- For derivations, number the steps and keep each step to one transformation.
- KaTeX supports most of amsmath (aligned, cases, pmatrix, \\frac, \\sum, \\int, \\mathbb).
  It has no \\newcommand across blocks: define macros inside each block.
`,
  [`${SKILLS_DIR}/skill-creator/SKILL.md`]: `---
name: skill-creator
description: Create or improve one of Jade's skills. Use when the user asks for a new skill, workflow, routine or recipe that Jade should follow, or wants to change an existing skill.
---
# Skill creator

A skill is a folder /Jade/skills/<kebab-case-name>/ containing SKILL.md, plus optional extra files
(templates, examples) that SKILL.md refers to by relative path.

1. Ask what the skill should do and when it should trigger, unless the user already said.
2. notes_search or ls /Jade/skills so you do not duplicate an existing skill; edit it instead if it is close.
3. Write /Jade/skills/<name>/SKILL.md:
   ---
   name: <name>
   description: <what it does>. Use when <the situations or phrases that should trigger it>.
   ---
   # <Title>
   Numbered, concrete steps using your real tools (read, write, edit, bash, notes_search, web_fetch,
   memory, schedule...). Name exact paths and note formats.
4. The description decides when the skill is used, so make it specific.
5. Tell the user they can run it any time with /skill:<name>.
`,
};
function stripComments(t) { return String(t).replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim(); }
function parseFront(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text || ''); const meta = {};
  if (m) for (const l of m[1].split(/\r?\n/)) { const i = l.indexOf(':'); if (i > 0) meta[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, ''); }
  return { meta, body: m ? text.slice(m[0].length) : (text || '') };
}
function ensureSteering() {
  if (ls.get('steerSeeded', 0) >= 1) return;
  for (const [p, c] of Object.entries(STEER_SEED)) if (!vfs.exists(p)) vfs.write(p, c, { mkdirs: true });
  ls.set('steerSeeded', 1);
}
const readCap = (p, cap = 8000) => { if (!vfs.isFile(p)) return ''; let t = stripComments(vfs.read(p)); if (t.length > cap) t = t.slice(0, cap) + '\n…(truncated)'; return t; };
function agentsFiles() { const out = []; for (const k of vfs.nodes.keys()) if (/^\/(jade\/)?agents\.md$/i.test(k) && vfs.isFile(k)) out.push(k); return out.sort((a, b) => a.length - b.length); }
function listSkills() {
  const off = new Set(ls.get('skillsOff', [])); const out = [];
  for (const k of vfs.nodes.keys()) {
    const m = /^\/jade\/skills\/([^/]+)\/skill\.md$/i.exec(k); if (!m || !vfs.isFile(k)) continue;
    const { meta, body } = parseFront(vfs.read(k)); const name = (meta.name || m[1]).trim();
    out.push({ name, description: meta.description || (body.split('\n').find(l => l.trim() && !l.startsWith('#')) || '').trim().slice(0, 200), path: k, dir: vfs.parent(k), off: off.has(name) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
function findSkill(name) {
  const n = String(name || '').trim().replace(/^\/?skill:/i, '').toLowerCase(); if (!n) return null;
  const all = listSkills(); const k = s => s.toLowerCase().replace(/[\s_-]+/g, '-');
  return all.find(s => s.name.toLowerCase() === n) || all.find(s => k(s.name) === k(n)) || all.find(s => vfs.base(s.dir).toLowerCase() === n) || null;
}
function steering() {
  const sys = vfs.isFile(SYSTEM_PATH) ? stripComments(parseFront(vfs.read(SYSTEM_PATH)).body) : '';
  return { system: sys, soul: readCap(SOUL_PATH, 6000).replace(/^---[\s\S]*?---\s*/, '').replace(/^# SOUL\s*/i, ''), agents: agentsFiles().map(p => ({ p, t: readCap(p, 6000).replace(/^# AGENTS\s*/i, '') })).filter(a => a.t), skills: listSkills().filter(s => !s.off) };
}
function steeringContext(st) {
  let out = '';
  if (st.soul) out += `\n\nYour persona (from /Jade/SOUL.md; this is who you are, keep this voice in chat):\n${st.soul}`;
  for (const a of st.agents) out += `\n\nStanding instructions from the user (${a.p}; always follow them):\n${a.t}`;
  if (st.skills.length) out += `\n\nSkills (instruction packs in ${SKILLS_DIR}). When a request matches a skill's description, FIRST call the skill tool with its name, then follow the instructions it returns step by step:\n${st.skills.map(s => `- ${s.name}: ${s.description}`).join('\n')}\nTo create a skill, write ${SKILLS_DIR}/<kebab-name>/SKILL.md beginning with frontmatter ("---", "name: …", "description: … Use when …", "---") followed by numbered steps.`;
  return out;
}
function skillTool(args) {
  const s = findSkill(args.name || args.skill);
  if (!s) { const all = listSkills().filter(x => !x.off); throw new Error(`No skill named "${args.name}". Available: ${all.map(x => x.name).join(', ') || 'none'}`); }
  if (s.off) throw new Error(`The skill "${s.name}" is turned off in Config.`);
  const { body } = parseFront(vfs.read(s.path));
  const extra = [...vfs.walk(s.dir)].filter(p => p !== s.path && vfs.isFile(p));
  return `Skill "${s.name}" loaded from ${s.path}. Follow these instructions now.${extra.length ? `\nOther files in this skill (read them when the steps refer to them): ${extra.join(', ')}` : ''}${args.input ? `\nInput: ${args.input}` : ''}\n\n${stripComments(body)}`;
}
function expandSkillCommand(text) {
  const m = /^\/skill:([^\s]+)\s*([\s\S]*)$/i.exec(text.trim()); if (!m) return null;
  const s = findSkill(m[1]);
  if (!s) { toast(`No skill called “${esc(m[1])}”. Skills: ${esc(listSkills().map(x => x.name).join(', ') || 'none')}`, 'err'); return null; }
  const { body } = parseFront(vfs.read(s.path));
  return `Use the "${s.name}" skill for this request. Its instructions (from ${s.path}):\n\n<skill name="${s.name}">\n${stripComments(body)}\n</skill>\n\n${m[2].trim() || '(The user gave no extra input: start the skill.)'}`;
}

/* ---------- settings UI for steering + skills ---------- */
function renderSkillsSettings() {
  const box = $('#skillList'); if (!box) return; const all = listSkills();
  box.innerHTML = all.map(s => `<label class="skill-row"><input type="checkbox" data-skill="${esc(s.name)}" ${s.off ? '' : 'checked'} class="accent-emerald-400 w-4 h-4 mt-1 flex-none"><span class="min-w-0"><b class="text-yl">${esc(s.name)}</b> <a href="#" class="text-cy text-[12px]" data-open="${esc(s.path)}">edit</a><span class="block text-[12.5px] text-dim leading-snug">${esc(s.description || 'no description')}</span></span></label>`).join('') || '<div class="hint">No skills yet.</div>';
}
$('#skillList')?.addEventListener('change', e => { const c = e.target.closest('[data-skill]'); if (!c) return; const off = new Set(ls.get('skillsOff', [])); c.checked ? off.delete(c.dataset.skill) : off.add(c.dataset.skill); ls.set('skillsOff', [...off]); });
$('#skillList')?.addEventListener('click', e => { const a = e.target.closest('[data-open]'); if (!a) return; e.preventDefault(); closeSettings(); openFile(a.dataset.open, { mode: 'edit' }); });
function openSteer(p, tmpl) { closeSettings(); if (!vfs.isFile(p)) vfs.write(p, tmpl, { mkdirs: true }); openFile(p, { mode: 'edit' }); }
$('#btnOpenSoul') && ($('#btnOpenSoul').onclick = () => openSteer(SOUL_PATH, STEER_SEED[SOUL_PATH]));
$('#btnOpenAgents') && ($('#btnOpenAgents').onclick = () => openSteer(agentsFiles()[0] || AGENTS_PATH, STEER_SEED[AGENTS_PATH]));
$('#btnOpenSystem') && ($('#btnOpenSystem').onclick = () => openSteer(SYSTEM_PATH, `# SYSTEM\n\n<!-- Replaces Jade's built-in intro and guidelines. The vault conventions, tool list, memory,\n     SOUL.md, AGENTS.md and skills are still added. Delete this file to go back to the default. -->\n\nYou are Jade, `));
$('#btnNewSkill') && ($('#btnNewSkill').onclick = () => {
  let n = 'new-skill', i = 2; while (vfs.exists(`${SKILLS_DIR}/${n}`)) n = `new-skill-${i++}`;
  openSteer(`${SKILLS_DIR}/${n}/SKILL.md`, `---\nname: ${n}\ndescription: What this skill does. Use when …\n---\n# ${n}\n\n1. First step, using Jade's tools (read, write, edit, bash, notes_search, web_fetch, memory…).\n2. …\n`);
});

/* ---------- edit a sent message and re-run from there ---------- */
async function resendFrom(i, text) {
  text = String(text || '').trim(); if (!text || !cur) return;
  if (running) return toast('The agent is still working. Abort it first.', 'err');
  if (!S.model) return toast('Pick a model first (Config → Ollama link).', 'err');
  let content = text; if (/^\/skill:/i.test(text)) { content = expandSkillCommand(text); if (!content) return; }
  const oldMsg = cur.messages[i];
  cur.messages = cur.messages.slice(0, i);
  const mk = ls.get('journaled', {}); if ((mk[cur.id] || 0) > i) { mk[cur.id] = i; ls.set('journaled', mk); }
  if (i === 0 && !cur._named) cur.title = text.slice(0, 60);
  const nm = { role: 'user', content: content + (oldMsg?._attBlock || '') }; if (nm.content !== text) nm.display = text;
  for (const k of ['attachments', 'images', '_attBlock']) if (oldMsg?.[k]) nm[k] = oldMsg[k];
  cur.messages.push(nm);
  saveSession(); renderChat(); try { renderSessions(); } catch {}
  await agentLoop();
}
chatEl.addEventListener('click', e => {
  const b = e.target.closest('[data-uact]'); if (!b) return; const el = b.closest('.msg-user'); const i = +el.dataset.i;
  const m = cur?.messages[i]; if (!m || m.role !== 'user') return;
  if (b.dataset.uact === 'copy') return copyText(m.display || m.content, b);
  if (b.dataset.uact === 'edit') {
    if (running) return toast('The agent is still working. Abort it first.', 'err');
    if (el.querySelector('.msg-edit')) return;
    const box = document.createElement('div'); box.className = 'msg-edit flex flex-col gap-2';
    box.innerHTML = `<textarea class="field" rows="4" aria-label="Edit your message"></textarea><div class="flex justify-end gap-2"><button class="btn" data-x="cancel">Cancel</button><button class="btn btn-solid cut cut-sm" data-x="send">Send</button></div><div class="hint text-right">Everything after this message is replaced by the new reply.</div>`;
    const ta = box.querySelector('textarea'); ta.value = m.display || m.content;
    el.querySelector('.bubble').hidden = true; el.querySelector('.msg-actions').hidden = true; el.appendChild(box);
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.style.height = Math.min(320, ta.scrollHeight + 4) + 'px';
    box.addEventListener('click', ev => { const x = ev.target.closest('[data-x]'); if (!x) return; if (x.dataset.x === 'cancel') { box.remove(); el.querySelector('.bubble').hidden = false; el.querySelector('.msg-actions').hidden = false; } else resendFrom(i, ta.value); });
  }
});

/* ---------- "/" suggestions above the composer ---------- */
const SLASH_CMDS = [['/new', 'new chat'], ['/mcp', 'MCP servers'], ['/heartbeat', 'run the heartbeat now'], ['/compact', 'summarise old turns'], ['/remember ', 'save a memory'], ['/memory', 'open memory'], ['/journal', 'journal this chat'], ['/skills', 'list skills'], ['/rename ', 'rename chat'], ['/copy', 'copy as Markdown'], ['/schedule', 'scheduled prompts'], ['/voice', 'toggle speech'], ['/model ', 'switch model'], ['/clear', 'clear messages'], ['/config', 'settings'], ['/help', 'all commands']];
function updateSlashSuggest() {
  const box = $('#slashSuggest'); const v = input.value;
  if (!/^\/\S*$/.test(v)) { box.hidden = true; return; }
  const q = v.toLowerCase();
  const items = [...listSkills().filter(s => !s.off).map(s => [`/skill:${s.name} `, s.description]), ...SLASH_CMDS].filter(([c]) => c.toLowerCase().startsWith(q) || (q.length > 1 && c.toLowerCase().includes(q.slice(1)))).slice(0, 14);
  box.innerHTML = items.map(([c, h]) => `<button data-cmd="${esc(c)}"><span>${esc(c.trim())}</span><small>${esc(String(h).slice(0, 60))}</small></button>`).join('');
  box.hidden = !items.length;
}
input.addEventListener('input', updateSlashSuggest);
$('#slashSuggest').addEventListener('mousedown', e => e.preventDefault());
$('#slashSuggest').addEventListener('click', e => { const b = e.target.closest('[data-cmd]'); if (!b) return; input.value = b.dataset.cmd; autosize(); $('#slashSuggest').hidden = true; input.focus(); });

/* =====================================================================
   PROVIDER FALLBACK LIST · COMPACTION MODEL · BACKUP (JSON) · BACKGROUND MODE
   ===================================================================== */
// migrate the single fallback from v1.3 to the ordered list
if (!Array.isArray(S.fallbacks)) S.fallbacks = [];
if (S.fallback && !S.fallbacks.length) { S.fallbacks = [S.fallback]; delete S.fallback; }
S.fallbackOrder = [...new Set([...(Array.isArray(S.fallbackOrder) ? S.fallbackOrder : []), ...S.fallbacks, 'local', 'llamacpp', 'cloud', 'groq', 'openai'])].filter(p => PROVIDERS[p]);

/* ---------- fallback list editor (Config → Model provider) ---------- */
const fbDraft = { order: [], on: new Set() };
function loadFbDraft() { fbDraft.order = [...S.fallbackOrder]; fbDraft.on = new Set(S.fallbacks); }
function renderFbList() {
  const prim = $('#sProvider').value; const rows = fbDraft.order.filter(p => p !== prim);
  $('#fbList').innerHTML = rows.map((p, i) => {
    const miss = providerMissing(p, formCfg());
    return `<div class="fb-row" data-p="${p}"><label class="flex items-center gap-2 flex-1 min-w-0"><input type="checkbox" class="accent-emerald-400 w-4 h-4" ${fbDraft.on.has(p) ? 'checked' : ''}><span class="text-sm">${fbDraft.on.has(p) ? `<b class="text-yl">${rows.filter(q => fbDraft.on.has(q)).indexOf(p) + 1}.</b> ` : ''}${esc(PROVIDERS[p].label)}${p === 'local' ? ` <span class="text-dim text-[12px]">${esc(S.host || DEFAULTS.host)}</span>` : ''}</span>${fbDraft.on.has(p) && miss && p !== 'local' ? '<span class="text-rd text-[11px]">needs key</span>' : ''}</label><button type="button" class="icon-btn" data-mv="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>▲</button><button type="button" class="icon-btn" data-mv="1" aria-label="Move down" ${i === rows.length - 1 ? 'disabled' : ''}>▼</button></div>`;
  }).join('');
}
$('#fbList').addEventListener('change', e => { const r = e.target.closest('.fb-row'); if (!r) return; e.target.checked ? fbDraft.on.add(r.dataset.p) : fbDraft.on.delete(r.dataset.p); renderFbList(); showProvFields(); });
$('#fbList').addEventListener('click', e => {
  const b = e.target.closest('[data-mv]'); if (!b) return; const p = b.closest('.fb-row').dataset.p, prim = $('#sProvider').value;
  const vis = fbDraft.order.filter(q => q !== prim); const i = vis.indexOf(p), j = i + +b.dataset.mv; if (j < 0 || j >= vis.length) return;
  [vis[i], vis[j]] = [vis[j], vis[i]]; fbDraft.order = [prim, ...vis].filter((q, k, a) => a.indexOf(q) === k); renderFbList();
});
for (const id of ['#sCloudKey', '#sGroqKey', '#sOaiHost', '#sLcppHost']) $(id).addEventListener('input', () => renderFbList());

/* ---------- compaction / journal model ---------- */
async function fillAuxModels(scan) {
  const p = $('#sAuxProv').value; const sel = $('#sAuxModel'); $('#sAuxModelWrap').hidden = !p;
  if (!p) return;
  let list = p === activeProv ? models : [];
  if (scan || !list.length) {
    sel.innerHTML = '<option value="">scanning…</option>';
    try { list = (await tryProvider(p, formCfg())).models; } catch (e) { sel.innerHTML = `<option value="">${esc(String(e.message || e).slice(0, 60))}</option>`; return; }
  }
  const curM = sel.dataset.want || S.auxModel || S.modelBy?.[p] || '';
  sel.innerHTML = list.map(m => `<option ${m === curM ? 'selected' : ''}>${esc(m)}</option>`).join('') || '<option value="">no models</option>';
  if (!list.includes(curM)) { const small = list.find(m => /8b|7b|mini|small|instant|flash|3b|4b|e2b|e4b/i.test(m)); if (small) sel.value = small; }
}
const pick = (o, ks) => Object.fromEntries(ks.map(k => [k, o[k]]));
$('#sAuxProv').onchange = () => { $('#sAuxModel').dataset.want = ''; fillAuxModels(true); };
$('#btnAuxScan').onclick = () => fillAuxModels(true);

/* ---------- backup: export / import everything as JSON ---------- */
const SECRET_KEYS = ['ollamaKey', 'groqKey', 'oaiKey', 'lcppKey', 'ollayaKey', 'mcpSecrets'];
const b64enc = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64dec = b => { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
function rawDb() { return new Promise((res, rej) => { const r = indexedDB.open('jade-vault', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function dbDump() {
  const db = await rawDb();
  return new Promise((res, rej) => { const st = db.transaction('kv').objectStore('kv'); const out = {}; const q = st.openCursor(); q.onsuccess = () => { const c = q.result; if (!c) return res(out); if (c.key !== 'vfs') out[c.key] = c.value; c.continue(); }; q.onerror = () => rej(q.error); });
}
async function dbRestore(obj, wipe) {
  const db = await rawDb();
  return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); const st = t.objectStore('kv'); if (wipe) st.clear(); for (const [k, v] of Object.entries(obj)) st.put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); });
}
const isText = u8 => { if (u8.length > 4e6) return false; try { new TextDecoder('utf-8', { fatal: true }).decode(u8); return !/[\x00-\x08\x0e-\x1f]/.test(dec.decode(u8.subarray(0, 4000))); } catch { return false; } };
const isConfigPath = p => /^\/jade\/(soul|system|agents|memory|heartbeat)\.md$/i.test(p) || /^\/jade\/mcp\.json$/i.test(p) || /^\/jade\/skills\//i.test(p) || /^\/agents\.md$/i.test(p);
async function buildBackup(kind, withKeys) {
  const settings = JSON.parse(JSON.stringify(S)); if (!withKeys) for (const k of SECRET_KEYS) delete settings[k];
  const storage = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('jvault:') && k !== 'jvault:settings') { try { storage[k.slice(7)] = JSON.parse(localStorage.getItem(k)); } catch {} } }
  const files = {}, dirs = [];
  for (const [p, n] of vfs.nodes) {
    if (p === '/') continue; if (kind === 'config' && !isConfigPath(p)) continue;
    if (n.dir) { if (kind === 'full') dirs.push(p); continue; }
    files[p] = isText(n.data) ? dec.decode(n.data) : { base64: b64enc(n.data) };
  }
  const out = { app: 'jade-vault', format: 1, kind, exportedAt: new Date().toISOString(), includesKeys: !!withKeys, settings, storage, vault: { files, dirs: dirs.sort() } };
  if (kind === 'full') { saveSession(); await new Promise(r => setTimeout(r, 450)); out.db = await dbDump(); }
  return out;
}
// file saving: Android app → native "Save as"; claude.ai viewer → its downloads capability; plain browser → download link
let downloadsP = null;
const getDownloads = () => (downloadsP ||= (window.claude?.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null)));
if (window.claude?.use) getDownloads();
async function saveTextFile(name, text, mime = 'application/json') {
  if (typeof window.NetrunnerAndroid?.saveFile === 'function') { try { window.NetrunnerAndroid.saveFile(name, mime, text); return; } catch (e) { console.warn(e); } }
  const dl = await getDownloads();
  if (dl) {
    try { await dl.save({ filename: name, data: new Blob([text], { type: mime }) }); toast(`Saved ${esc(name)}`, 'ok'); return; }
    catch (e) { if (e?.code === 'declined') { toast('Save cancelled'); return; } if (e?.code === 'rate_limited') { toast('A save prompt is already open.', 'err'); return; } if (!/unavailable|not_granted|capability_/.test(e?.code || '')) { toast('Could not save: ' + esc(e?.message || e), 'err'); return; } }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
  toast(`Downloading ${esc(name)} (if nothing happens, use Copy JSON)`, 'ok');
}
window.__jadeSaved = (ok, msg) => toast(ok ? `Saved ${esc(msg || 'backup')}` : `Not saved${msg ? ': ' + esc(msg) : ''}`, ok ? 'ok' : 'err');
let lastBackupText = '';
async function exportBackup(kind) {
  const withKeys = $('#sBackupKeys')?.checked; const data = await buildBackup(kind, withKeys);
  lastBackupText = JSON.stringify(data, null, 1);
  const name = `jade-vault-${kind === 'full' ? 'backup' : 'config'}-${todayStr()}.json`;
  $('#backupNote').textContent = `${kind === 'full' ? 'Full backup' : 'Config'}: ${Object.keys(data.vault.files).length} files${data.db ? `, ${(data.db.sessions || []).length} chats, ${(data.db.schedules || []).length} schedules` : ''} · ${fmtSize(lastBackupText.length)}${withKeys ? ' · includes API keys' : ''}`;
  $('#btnBackupCopy').hidden = false;
  await saveTextFile(name, lastBackupText);
}
async function importBackup(file) {
  let data; try { data = JSON.parse(await file.text()); } catch { toast('That file is not valid JSON.', 'err'); return; }
  if (data?.app !== 'jade-vault' || !data.vault) { toast('That is not a Jade Vault backup.', 'err'); return; }
  const full = data.kind === 'full';
  const msg = full ? `Replace EVERYTHING here (notes, chats, schedules, settings) with the backup from ${String(data.exportedAt || '').slice(0, 10)}?` : `Merge config from ${String(data.exportedAt || '').slice(0, 10)} (settings, SOUL/AGENTS/SYSTEM, memory, skills)? Your other notes and chats stay.`;
  if (!confirm(msg)) return;
  const keep = pick(S, SECRET_KEYS);
  const next = { ...DEFAULTS, ...(full ? {} : S), ...data.settings }; for (const k of SECRET_KEYS) if (!data.settings?.[k]) next[k] = keep[k];
  window.__restoring = true;   // stop pending autosaves from overwriting the restore
  for (const k of Object.keys(S)) delete S[k]; Object.assign(S, next); ls.set('settings', next);
  for (const [k, v] of Object.entries(data.storage || {})) ls.set(k, v);
  const toBytes = v => typeof v === 'string' ? enc.encode(v) : v?.base64 ? b64dec(v.base64) : enc.encode(JSON.stringify(v));
  if (full) {
    const entries = [['/', { dir: true, mtime: Date.now() }]];
    for (const d of data.vault.dirs || []) entries.push([d, { dir: true, mtime: Date.now() }]);
    for (const [p, v] of Object.entries(data.vault.files)) { let q = vfs.parent(p); while (q !== '/' && !entries.some(e => e[0] === q)) { entries.push([q, { dir: true, mtime: Date.now() }]); q = vfs.parent(q); } entries.push([p, { data: toBytes(v), mtime: Date.now() }]); }
    await dbRestore({ ...(data.db || {}), vfs: entries, pendingSettings: next }, true);   // settings ride along in IndexedDB (durable before reload)
    ls.set('lastSession', null);
  } else {
    for (const [p, v] of Object.entries(data.vault.files)) vfs.write(p, toBytes(v), { mkdirs: true });
    await new Promise(r => setTimeout(r, 300)); await dbRestore({ vfs: [...vfs.nodes.entries()], pendingSettings: next }, false);
  }
  toast('Backup restored. Reloading…', 'ok'); setTimeout(() => location.reload(), 400);
}
$('#btnExportAll').onclick = () => exportBackup('full').catch(e => toast('Export failed: ' + esc(e.message), 'err'));
$('#btnExportCfg').onclick = () => exportBackup('config').catch(e => toast('Export failed: ' + esc(e.message), 'err'));
$('#btnBackupCopy').onclick = e => copyText(lastBackupText, e.currentTarget);
$('#importBackup').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importBackup(f); };

/* ---------- background mode (Android app: foreground service + wake lock) ---------- */
function nativeBG() { return typeof window.NetrunnerAndroid?.keepAlive === 'function'; }
var bgOn = false, bgText = '';
function bgSync(text) {
  if (!nativeBG()) return;
  const want = S.bgMode === 'always' || (S.bgMode !== 'off' && running);
  const t = text || (running ? 'Jade is working…' : `Standing by${Sched?.list?.filter?.(x => x.enabled !== false).length ? ` · ${Sched.list.filter(x => x.enabled !== false).length} schedules armed` : ''}`);
  try {
    if (want && (!bgOn || t !== bgText)) { window.NetrunnerAndroid.keepAlive(true, t); bgOn = true; bgText = t; }
    else if (!want && bgOn) { window.NetrunnerAndroid.keepAlive(false, ''); bgOn = false; bgText = ''; }
  } catch (e) { console.warn('keepAlive failed', e); }
}
var BG_LABEL = { THINKING: 'Jade is thinking…', 'RUNNING TOOL': 'Jade is using a tool…', COMPACTING: 'Compacting the chat…' };
function bgState(s) { if (running && BG_LABEL) bgSync(BG_LABEL[s] || (s && s !== 'IDLE' ? `Jade: ${String(s).toLowerCase()}` : 'Jade is working…')); }
function bgFinished() {
  bgSync();
  if (!document.hidden || !S.bgNotify || !cur) return;
  const last = [...cur.messages].reverse().find(m => m.role === 'assistant' && m.content?.trim());
  const body = last ? last.content.replace(/```[\s\S]*?```/g, '[code]').replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (m, a, b) => b || a).replace(/[*_#>`$]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180) : 'Done.';
  schedNotify(`Jade finished: ${cur.title || 'chat'}`.slice(0, 60), body);
}
function renderBgSettings() {
  $('#sBgMode').value = S.bgMode || 'agent'; $('#sBgNotify').checked = !!S.bgNotify;
  const native = nativeBG(); $('#bgNative').hidden = !native; $('#bgWeb').hidden = native;
  if (native) { let opt = true; try { opt = window.NetrunnerAndroid.batteryOptimized(); } catch {} $('#bgBattery').innerHTML = opt ? '<span class="dot bad"></span>Battery saver may pause Jade in the background.' : '<span class="dot ok"></span>Unrestricted battery: Jade can keep working in the background.'; $('#btnBattery').hidden = !opt; }
}
$('#btnBattery').onclick = () => { try { window.NetrunnerAndroid.openBatterySettings(); } catch {} setTimeout(renderBgSettings, 4000); };
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#settings').hidden) renderBgSettings(); });

// applied at boot: settings restored from a backup (localStorage writes right before a reload are not always flushed)
async function applyPendingSettings() {
  const ps = await idb.get('pendingSettings'); if (!ps) return;
  for (const k of Object.keys(S)) delete S[k]; Object.assign(S, DEFAULTS, ps); ls.set('settings', S); await idb.del('pendingSettings');
}

/* =====================================================================
   HEARTBEAT (Moltbot-style)
   Every N minutes inside active hours, Jade wakes up, reads /Jade/HEARTBEAT.md and acts on it.
   If nothing needs attention she answers HEARTBEAT_OK: that run is silent and pruned from the chat.
   Anything else is an alert: kept in the Heartbeat chat and sent as a notification.
   An effectively empty HEARTBEAT.md (only comments, headings, blank lines or empty checkboxes)
   skips the run without calling the model. It can use its own provider/model.
   ===================================================================== */
const HB_PATH = '/Jade/HEARTBEAT.md';
const HB_DEFAULT_PROMPT = 'Read HEARTBEAT.md (below). Follow it strictly. Do not infer or repeat old tasks from prior chats. Use your tools to check what it asks. If nothing needs attention, reply HEARTBEAT_OK.';
const HB_SEED = `# HEARTBEAT

<!-- Jade reads this on every heartbeat (Config → Heartbeat; every 30 minutes by default, only while
     the app is open and inside your active hours). Keep it short: a checklist of things to look at.
     If nothing needs attention she replies HEARTBEAT_OK and you never see it; otherwise you get a
     notification and the details land in the "♥ Heartbeat" chat.
     While this file has only comments, headings and empty boxes, heartbeats are skipped for free.

     Examples (copy them below the heading and adapt):
     - If /Inbox.md has more than 5 items, remind me to sort it.
     - After 17:00, list unchecked tasks in today's daily note.
     - Notes tagged #waiting: tell me about any older than a week.
     - If my Memory mentions a deadline in the next 2 days, remind me. -->

## Check
- [ ]
`;
function ensureHeartbeatFile() { if (!vfs.exists(HB_PATH) && !ls.get('hbSeeded', false)) { vfs.write(HB_PATH, HB_SEED, { mkdirs: true }); } ls.set('hbSeeded', true); }
function heartbeatBody() {
  if (!vfs.isFile(HB_PATH)) return '';
  return stripComments(vfs.read(HB_PATH)).split('\n').filter(l => {
    const t = l.trim();
    return t && !/^#{1,6}(\s|$)/.test(t) && !/^(```|~~~)/.test(t) && !/^[-*+]\s*(\[[ xX]?\])?\s*$/.test(t) && !/^---+$/.test(t);
  }).length ? stripComments(vfs.read(HB_PATH)) : '';
}
const HB = { last: ls.get('hbLast', 0), status: ls.get('hbStatus', ''), running: false, lastActive: Date.now() };
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { HB.lastActive = Date.now(); }, { passive: true, capture: true });
const hmToMin = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m ? +m[1] * 60 + +m[2] : null; };
function inActiveHours(d = new Date()) {
  const a = hmToMin(S.hbStart), b = hmToMin(S.hbEnd); if (a == null || b == null) return true;
  if (a === b) return false; const n = d.getHours() * 60 + d.getMinutes();
  return a < b ? n >= a && n < b : n >= a || n < b;           // windows may cross midnight
}
const hbEveryMs = () => Math.max(1, +S.hbEvery || 30) * 60000;
function hbSetStatus(s) { HB.status = s; ls.set('hbStatus', s); renderHbStatus(); }
function renderHbStatus() {
  const el = $('#hbStatus'); if (!el) return;
  const next = HB.last ? HB.last + hbEveryMs() : Date.now();
  el.textContent = !S.hbOn ? 'Off' : `${HB.last ? `Last ${clock(HB.last)}: ${HB.status || '—'}` : 'Not run yet'} · next ${inActiveHours(new Date(next)) ? clock(Math.max(next, Date.now())) : 'when active hours start'}${heartbeatBody() ? '' : ' · HEARTBEAT.md is empty, so it will skip'}`;
}
// run fn with another provider/model, restoring the chat model afterwards
async function withModel(prov, model, fn) {
  if (!prov || !model || providerMissing(prov)) return fn();
  const saved = { client, activeProv, model: S.model, models };
  try { if (prov !== activeProv) { client = makeClientFor(prov); activeProv = prov; } S.model = model; window.__modelOverride = true; return await fn(); }
  finally { client = saved.client; activeProv = saved.activeProv; S.model = saved.model; models = saved.models; window.__modelOverride = false; fillModelSelects(); }
}
const hbIsAck = (text) => {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const m = /^\**(HEARTBEAT_OK|NO_REPLY)\**[\s.!:]*|[\s.!:]*\**(HEARTBEAT_OK|NO_REPLY)\**[.!]?$/i.exec(t);
  if (!t) return true; if (!m) return false;
  return t.replace(m[0], '').trim().length <= 300;
};
async function runHeartbeat({ manual = false } = {}) {
  if (HB.running) return;
  const body = heartbeatBody();
  if (!body) { HB.last = Date.now(); ls.set('hbLast', HB.last); hbSetStatus('skipped (HEARTBEAT.md is empty)'); if (manual) toast('HEARTBEAT.md has nothing to check yet. Add a line under “Check”.'); return; }
  if (!S.model && !(S.hbProv && S.hbModel)) { hbSetStatus('skipped: no model connected'); return; }
  HB.running = true; HB.last = Date.now(); ls.set('hbLast', HB.last); hbSetStatus('running…');
  const prevCur = cur; const reuse = S.hbChat === 'current' && cur;
  try {
    if (!reuse) {
      const hbId = ls.get('hbSession', null);
      if (hbId && sessions.some(x => x.id === hbId)) { if (cur?.id !== hbId) await openSession(hbId); }
      else { newSession(); cur.title = '♥ Heartbeat'; cur._named = true; cur._hb = true; ls.set('hbSession', cur.id); }
      cur._hb = true;
    }
    const before = cur.messages.length;
    const prompt = `[Heartbeat · ${new Date().toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}]\n${S.hbPrompt?.trim() || HB_DEFAULT_PROMPT}\n\nHEARTBEAT.md:\n${body}`;
    if (!cur.messages.length) chatEl.innerHTML = '';
    cur.messages.push({ role: 'user', content: prompt, display: '♥ Heartbeat check', _hb: true });
    chatEl.appendChild(userBlock('♥ Heartbeat check', cur.messages.length - 1)); saveSession();
    await withModel(S.hbProv, S.hbModel || S.modelBy?.[S.hbProv], () => agentLoop());
    const fresh = cur.messages.slice(before);
    const err = fresh.find(m => m._error); const tools = fresh.filter(m => m.role === 'tool').length;
    const reply = [...fresh].reverse().find(m => m.role === 'assistant' && m.content?.trim())?.content || '';
    if (err) { hbSetStatus('error: ' + String(err._error).slice(0, 90)); }
    else if (hbIsAck(reply)) {
      cur.messages.length = before; saveSession();                 // silent: prune the OK run
      hbSetStatus(`OK${tools ? ` (${tools} check${tools > 1 ? 's' : ''})` : ''}`);
      if (!reuse && prevCur && prevCur !== cur) {               // back to the chat you were in (it may not be saved yet)
        cur = prevCur; tasks.items = cur.tasks || []; tasks.seq = cur.taskSeq || 0; ls.set('lastSession', cur.id);
        renderTasks(); renderChat(); renderSessions();
      } else renderChat();
      if (manual) toast('Heartbeat: nothing needs attention (HEARTBEAT_OK)', 'ok');
    } else {
      const clean = reply.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (m, a, b) => b || a).replace(/[`*#_>$]/g, '').replace(/\s+/g, ' ').trim();
      hbSetStatus('alert: ' + clean.slice(0, 80));
      schedNotify('♥ Jade', clean.slice(0, 200)); toast('♥ Heartbeat: ' + esc(clean.slice(0, 140)), 'ok');
      if (Jade.ready) jadeBubble(clean.slice(0, 160), 'Jade', 8000);
    }
  } catch (e) { hbSetStatus('error: ' + (e.message || e)); }
  finally { HB.running = false; renderSessions(); renderHbStatus(); }
}
function hbTick() {
  renderHbStatus();
  if (!S.hbOn || HB.running || running || Sched.draining || (typeof compacting !== 'undefined' && compacting)) return;
  if (Date.now() - HB.last < hbEveryMs() || !inActiveHours()) return;
  // don't yank the screen away from someone who is typing or tapping right now
  if (!document.hidden && (Date.now() - HB.lastActive < 90000 || input.value.trim() || document.activeElement === input || !$('#settings').hidden)) return;
  runHeartbeat();
}
setInterval(hbTick, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(hbTick, 2000); });

/* ---------- shared provider+model picker (compaction model and heartbeat model) ---------- */
async function fillModelPicker(provEl, modelEl, wrapEl, scan) {
  const p = provEl.value; wrapEl.hidden = !p; if (!p) return;
  let list = p === activeProv ? models : [];
  if (scan || !list.length) {
    modelEl.innerHTML = '<option value="">scanning…</option>';
    try { list = (await tryProvider(p, formCfg())).models; } catch (e) { modelEl.innerHTML = `<option value="">${esc(String(e.message || e).slice(0, 60))}</option>`; return; }
  }
  const want = modelEl.dataset.want || S.modelBy?.[p] || '';
  modelEl.innerHTML = list.map(m => `<option ${m === want ? 'selected' : ''}>${esc(m)}</option>`).join('') || '<option value="">no models</option>';
  if (!list.includes(want)) { const small = list.find(m => /8b|7b|mini|small|instant|flash|3b|4b|e2b|e4b/i.test(m)); if (small) modelEl.value = small; }
}
$('#sHbProv').onchange = () => { $('#sHbModel').dataset.want = ''; fillModelPicker($('#sHbProv'), $('#sHbModel'), $('#sHbModelWrap'), true); };
$('#btnHbScan').onclick = () => fillModelPicker($('#sHbProv'), $('#sHbModel'), $('#sHbModelWrap'), true);
$('#btnHbEdit').onclick = () => { closeSettings(); ensureHeartbeatFile(); if (!vfs.isFile(HB_PATH)) vfs.write(HB_PATH, HB_SEED, { mkdirs: true }); openFile(HB_PATH, { mode: 'edit' }); };
$('#btnHbRun').onclick = () => { closeSettings(); setTab('chat'); runHeartbeat({ manual: true }); };
function renderHbSettings() {
  $('#sHbOn').checked = !!S.hbOn; $('#sHbEvery').value = S.hbEvery || 30; $('#sHbStart').value = S.hbStart || ''; $('#sHbEnd').value = S.hbEnd || '';
  $('#sHbChat').value = S.hbChat || 'own'; $('#sHbPrompt').value = S.hbPrompt || ''; $('#sHbPrompt').placeholder = HB_DEFAULT_PROMPT;
  $('#sHbProv').value = S.hbProv || ''; $('#sHbModel').dataset.want = S.hbModel || ''; fillModelPicker($('#sHbProv'), $('#sHbModel'), $('#sHbModelWrap'), false);
  renderHbStatus();
}
function readHbSettings() {
  const wasOn = S.hbOn;
  Object.assign(S, { hbOn: $('#sHbOn').checked, hbEvery: Math.max(1, Math.round(+$('#sHbEvery').value || 30)), hbStart: $('#sHbStart').value, hbEnd: $('#sHbEnd').value,
    hbChat: $('#sHbChat').value, hbPrompt: $('#sHbPrompt').value.trim(), hbProv: $('#sHbProv').value, hbModel: $('#sHbProv').value ? $('#sHbModel').value : '' });
  if (S.hbOn && !wasOn) { HB.last = Date.now(); ls.set('hbLast', HB.last); hbSetStatus('armed'); ensureHeartbeatFile(); }
}

/* =====================================================================
   CHAT ATTACHMENTS
   Files you attach are saved into the vault under /attachments/YYYY-MM-DD/. Text files are also
   inlined into your message (trimmed), images go to vision models (downscaled), and PDFs get their
   text extracted to a sidecar note (<file>.pdf.md) that Jade can read and link.
   ===================================================================== */
const ATT = { pending: [] };   // {name, type, size, path, kind, text?, image?, note?}
const TEXT_EXT = /\.(md|markdown|txt|text|csv|tsv|json|jsonl|ya?ml|toml|ini|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|sh|bash|zsh|sql|log|srt|vtt|tex|bib|org|rst|env|conf|cfg|svg)$/i;
const fmtKB = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
function attachPath(name) {
  const dir = `/attachments/${todayStr()}`; const clean = String(name || 'file').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';
  let p = `${dir}/${clean}`, i = 2; const dot = clean.lastIndexOf('.');
  while (vfs.exists(p)) { p = `${dir}/${dot > 0 ? clean.slice(0, dot) + `-${i}` + clean.slice(dot) : clean + `-${i}`}`; i++; }
  return p;
}
async function downscaleImage(file, max = 1568) {
  try {
    const bmp = await createImageBitmap(file); const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  } catch { return null; }
}
let pdfjsP = null;
function loadPdfJs() {
  return (pdfjsP ||= import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs').then(m => {
    m.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'; return m;
  }).catch(e => { pdfjsP = null; throw e; }));
}
async function pdfText(bytes) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, 300); i++) {
    const pg = await doc.getPage(i); const tc = await pg.getTextContent();
    let line = '', out = []; let lastY = null;
    for (const it of tc.items) { const y = it.transform?.[5]; if (lastY != null && Math.abs(y - lastY) > 2) { out.push(line); line = ''; } line += it.str + (it.hasEOL ? '\n' : ''); lastY = y; }
    out.push(line); pages.push(out.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
  }
  return { pages: doc.numPages, text: pages.map((t, i) => `<!-- page ${i + 1} -->\n${t}`).join('\n\n') };
}
async function addAttachments(files) {
  for (const f of files) {
    if (f.size > 25 * 1048576) { toast(`${esc(f.name)} is over 25 MB, so it was not attached.`, 'err'); continue; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const path = attachPath(f.name || `pasted-${Date.now()}.${(f.type.split('/')[1] || 'bin').replace('jpeg', 'jpg')}`);
    vfs.write(path, bytes, { mkdirs: true });
    const a = { name: vfs.base(path), type: f.type || '', size: f.size, path, kind: 'file' };
    if (/^image\//.test(f.type) && !/svg/.test(f.type)) { a.kind = 'image'; a.image = await downscaleImage(f); a.thumb = await downscaleImage(f, 112); }
    else if (TEXT_EXT.test(f.name) || /^text\/|json|xml|javascript/.test(f.type) || isText(bytes)) { a.kind = 'text'; a.text = dec.decode(bytes); }
    else if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) {
      a.kind = 'pdf'; ATT.pending.push(a); renderAttachBar();
      try {
        const r = await pdfText(bytes); a.pages = r.pages;
        if (r.text.replace(/<!--.*?-->|\s/g, '').length > 20) { a.note = path + '.md'; vfs.write(a.note, `---\nsource: ${path}\npages: ${r.pages}\n---\n# ${a.name}\n\n${r.text}\n`, { mkdirs: true }); }
        else a.noText = true;
      } catch (e) { a.pdfError = 'could not extract text (' + String(e.message || e).slice(0, 60) + ')'; }
      renderAttachBar(); continue;
    }
    ATT.pending.push(a); renderAttachBar();
  }
}
function renderAttachBar() {
  const bar = $('#attachBar'); bar.hidden = !ATT.pending.length;
  bar.innerHTML = ATT.pending.map((a, i) => `<span class="att-chip pending">${a.kind === 'image' && a.thumb ? `<img src="data:image/jpeg;base64,${a.thumb}" alt="">` : `<b>${{ text: '≡', pdf: 'PDF', file: '◇' }[a.kind] || '◇'}</b>`}<span class="truncate">${esc(a.name)}</span><small>${fmtKB(a.size)}${a.kind === 'pdf' && !a.note && !a.pdfError && !a.noText ? ' · reading…' : ''}</small><button type="button" data-rm="${i}" aria-label="Remove ${esc(a.name)}">×</button></span>`).join('');
}
// the text the model sees for a message's attachments
function attachmentBlock(atts) {
  if (!atts?.length) return '';
  let budget = 16000; const lines = [`[Attached: ${atts.length} file${atts.length > 1 ? 's' : ''}, saved in the vault]`];
  for (const a of atts) {
    const head = `- ${a.path} (${a.kind === 'pdf' ? `PDF${a.pages ? ', ' + a.pages + ' pages' : ''}` : a.type || a.kind}, ${fmtKB(a.size)})`;
    if (a.kind === 'text' && a.text != null) {
      const take = Math.min(a.text.length, Math.max(0, Math.min(8000, budget))); budget -= take;
      lines.push(head + (take < a.text.length ? `: first ${take} of ${a.text.length} characters below; use read for the rest` : ':'));
      if (take) lines.push('```' + (a.name.split('.').pop() || '') + '\n' + a.text.slice(0, take) + '\n```');
    } else if (a.kind === 'image') lines.push(head + (a.image ? ': attached as an image you can see' : ': image (could not be prepared for viewing)'));
    else if (a.kind === 'pdf') lines.push(head + (a.note ? `: text extracted to ${a.note} (read it)` : a.noText ? ': no text layer (scanned PDF)' : `: ${a.pdfError || 'text not extracted'}`));
    else lines.push(head + ': binary file');
  }
  return '\n\n' + lines.join('\n');
}
function attachmentChips(atts) {
  if (!atts?.length) return '';
  return `<div class="att-row">${atts.map(a => `<a href="#" class="att-chip" data-att="${esc(a.note || a.path)}">${a.kind === 'image' && a.thumb ? `<img src="data:image/jpeg;base64,${a.thumb}" alt="">` : `<b>${{ text: '≡', pdf: 'PDF', file: '◇' }[a.kind] || '◇'}</b>`}<span class="truncate">${esc(a.name)}</span></a>`).join('')}</div>`;
}
$('#btnAttach').onclick = () => $('#attachInput').click();
$('#attachInput').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; addAttachments(fs); };
$('#attachBar').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; ATT.pending.splice(+b.dataset.rm, 1); renderAttachBar(); });
input.addEventListener('paste', e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addAttachments(fs); } });
for (const el of [chatEl, $('.composer-wrap')]) {
  el.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); el.classList.add('drop-hot'); } });
  el.addEventListener('dragleave', () => el.classList.remove('drop-hot'));
  el.addEventListener('drop', e => { el.classList.remove('drop-hot'); if (e.dataTransfer?.files?.length) { e.preventDefault(); addAttachments([...e.dataTransfer.files]); } });
}
chatEl.addEventListener('click', e => {
  const c = e.target.closest('.att-chip[data-att]'); if (!c) return; e.preventDefault();
  const p = c.dataset.att; if (!vfs.isFile(p)) return toast('That file is no longer in the vault.', 'err');
  if (isNote(p) || TEXT_EXT.test(p)) openFile(p, { mode: isNote(p) ? 'read' : undefined }); else toast(`Saved in the vault at ${esc(p)}`);
});
// take the pending attachments for a message being sent
function takeAttachments() { const a = ATT.pending.filter(x => !(x.kind === 'pdf' && !x.note && !x.pdfError && !x.noText)); const waiting = ATT.pending.length - a.length; ATT.pending = ATT.pending.filter(x => !a.includes(x)); renderAttachBar(); if (waiting) toast('A PDF is still being read; it will go with your next message.'); return a; }

// turn the user's text + pending attachments into the stored message
function composeUserMessage(text, content) {
  const atts = takeAttachments(); const block = attachmentBlock(atts);
  const msg = { role: 'user', content: (content || text || (atts.length ? 'Please look at the attached file' + (atts.length > 1 ? 's' : '') + '.' : '')) + block };
  const disp = text || (atts.length ? '📎 ' + atts.map(a => a.name).join(', ') : '');
  if (disp !== msg.content) msg.display = disp;
  if (atts.length) {
    msg.attachments = atts.map(({ text: _t, image: _i, ...a }) => a); msg._attBlock = block;
    const imgs = atts.filter(a => a.image).map(a => a.image); if (imgs.length) msg.images = imgs;
  }
  return msg;
}

/* =====================================================================
   MCP — modelled on pi's built-in MCP (pi ≥ 0.99, "Codemode and MCP")
   Config: /Jade/mcp.json  { "mcpServers": { "<name>": { url, headers, type, timeout, enabled,
           exposure, toolExposure, description } } }
   Tools are named mcp__<server>__<tool>. Per-server `exposure` (and per-tool `toolExposure`, keys are
   exact names or * patterns; exact names win):
     codemode (default)  callable only from codemode scripts: await tools.mcp__s__t(args)
     deferred            hidden until tool_search loads it for the next model call
     direct              declared to the model like a built-in tool (and callable from codemode)
     hidden              registered but unreachable
   Resources: list_mcp_resources / list_mcp_resource_templates / read_mcp_resource.
   Transport: streamable HTTP only (a browser cannot spawn stdio servers; legacy SSE is rejected like pi).
   Servers connect in the background at startup and stay connected; edits to mcp.json apply live.
   ===================================================================== */
const MCP_PATH = '/Jade/mcp.json';
const MCP_PROTOCOL = '2025-06-18';
const MCP_EXPOSURES = ['codemode', 'deferred', 'direct', 'hidden'];
const MCP = { servers: new Map(), loadedKey: '', cfgText: '', reloadT: 0 };
const mcpSafe = s => String(s).replace(/[^A-Za-z0-9_-]/g, '_');
const mcpToolName = (server, tool) => `mcp__${mcpSafe(server)}__${mcpSafe(tool)}`;

function ensureMcpFile() {
  if (vfs.exists(MCP_PATH) || ls.get('mcpSeeded', false)) return;
  vfs.write(MCP_PATH, JSON.stringify({ mcpServers: {} }, null, 2) + '\n', { mkdirs: true }); ls.set('mcpSeeded', true);
}
function readMcpConfig() {
  if (!vfs.isFile(MCP_PATH)) return { servers: {}, error: null };
  const raw = vfs.read(MCP_PATH);
  try {
    const j = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
    return { servers: j.mcpServers || j.servers || {}, autoEnableCodemode: j.autoEnableCodemode !== false, error: null };
  } catch (e) { return { servers: {}, error: 'mcp.json is not valid JSON: ' + e.message }; }
}
function writeMcpConfig(mutate) {
  let j = { mcpServers: {} };
  if (vfs.isFile(MCP_PATH)) { try { j = JSON.parse(vfs.read(MCP_PATH).replace(/^\s*\/\/.*$/gm, '')); } catch { throw new Error('fix the JSON in /Jade/mcp.json first'); } }
  j.mcpServers ||= {}; mutate(j.mcpServers, j);
  vfs.write(MCP_PATH, JSON.stringify(j, null, 2) + '\n', { mkdirs: true });
}
// ${NAME} → MCP secret (Config → MCP), "!command" → output of a shell command (like pi)
async function mcpResolveValue(v) {
  v = String(v ?? '');
  if (/^!/.test(v)) { try { return String(await new Shell({}).capture(v.slice(1))).trim(); } catch (e) { throw new Error(`header command failed: ${e.message}`); } }
  return v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k) => (S.mcpSecrets || {})[k] ?? '');
}
function mcpExposureFor(srv, toolName) {
  const te = srv.cfg.toolExposure || {};
  if (Object.prototype.hasOwnProperty.call(te, toolName)) return te[toolName];
  for (const [pat, ex] of Object.entries(te)) if (pat.includes('*') && new RegExp('^' + pat.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(toolName)) return ex;
  const e = srv.cfg.exposure === 'codemode-deferred' ? 'codemode' : srv.cfg.exposure;
  return MCP_EXPOSURES.includes(e) ? e : 'codemode';
}

/* ---------- streamable HTTP JSON-RPC client ---------- */
class McpHttpClient {
  constructor(name, cfg) { this.name = name; this.cfg = cfg; this.seq = 0; this.sessionId = null; this.protocol = MCP_PROTOCOL; this.ctrls = new Set(); }
  async headers(extra = {}) {
    const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...extra };
    for (const [k, v] of Object.entries(this.cfg.headers || {})) h[k] = await mcpResolveValue(v);
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    if (this.initialized) h['MCP-Protocol-Version'] = this.protocol;
    return h;
  }
  close() { for (const c of this.ctrls) c.abort(); this.ctrls.clear(); if (this.sessionId) { this.headers().then(h => fetch(this.cfg.url, { method: 'DELETE', headers: h }).catch(() => {})); } this.sessionId = null; this.initialized = false; }
  async post(body, { notify = false, timeoutMs, onProgress, retry = 2 } = {}) {
    const ms = timeoutMs || (Math.max(1, +this.cfg.timeout || 60) * 1000);
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController(); this.ctrls.add(ctrl);
      let timer = setTimeout(() => ctrl.abort(new Error('timeout')), ms);
      const bump = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(new Error('timeout')), ms); };   // progress resets the timeout
      try {
        let r;
        try { r = await fetch(this.cfg.url, { method: 'POST', headers: await this.headers(), body: JSON.stringify(body), signal: ctrl.signal }); }
        catch (e) { if (attempt < retry && !ctrl.signal.reason) { await new Promise(res => setTimeout(res, 400 * (attempt + 1))); continue; } throw new Error(ctrl.signal.aborted ? `${this.name}: request timed out after ${ms / 1000}s` : `${this.name}: could not reach ${this.cfg.url} (${e.message}). If this is a browser tab, the server must allow CORS.`); }
        const sid = r.headers.get('mcp-session-id'); if (sid) this.sessionId = sid;
        if ([408, 429, 500, 502, 503, 504].includes(r.status) && attempt < retry) { await new Promise(res => setTimeout(res, 500 * (attempt + 1))); continue; }
        if (r.status === 404 && this.sessionId && body.method !== 'initialize') { const e = new Error('session expired'); e.code = 'SESSION'; throw e; }
        if (!r.ok && r.status !== 202) { let m = `HTTP ${r.status}`; try { const t = await r.text(); const j = JSON.parse(t); m = j.error?.message || j.message || m; } catch {} if (r.status === 401 || r.status === 403) m += ' (check the headers / token for this server)'; if (r.status === 405 && body.method === 'initialize') m += ' (this looks like a legacy SSE endpoint; use the streamable HTTP URL, usually ending in /mcp)'; throw new Error(`${this.name}: ${m}`); }
        if (notify || r.status === 202) return null;
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('text/event-stream')) return await this.readSSE(r, body.id, bump, onProgress);
        const txt = await r.text(); if (!txt.trim()) return null;
        const j = JSON.parse(txt); const msg = Array.isArray(j) ? j.find(x => x.id === body.id) : j;
        if (msg?.error) throw new Error(`${this.name}: ${msg.error.message || JSON.stringify(msg.error)}`);
        return msg?.result;
      } finally { clearTimeout(timer); this.ctrls.delete(ctrl); }
    }
  }
  async readSSE(r, id, bump, onProgress) {
    const reader = r.body.getReader(); let buf = '', data = [];
    const handle = async (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      for (const x of Array.isArray(m) ? m : [m]) {
        if (x.id === id && (x.result !== undefined || x.error)) { if (x.error) throw new Error(`${this.name}: ${x.error.message || JSON.stringify(x.error)}`); return { done: true, result: x.result }; }
        if (x.method === 'notifications/progress') { bump(); onProgress?.(x.params); }
        else if (x.method === 'ping' && x.id != null) this.post({ jsonrpc: '2.0', id: x.id, result: {} }, { notify: true }).catch(() => {});
        else if (x.method && x.id != null) this.post({ jsonrpc: '2.0', id: x.id, error: { code: -32601, message: 'not supported by this client' } }, { notify: true }).catch(() => {});
      }
    };
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.search(/\r?\n/)) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + (buf[i] === '\r' ? 2 : 1));
        if (line === '') { if (data.length) { const out = await handle(data.join('\n')); data = []; if (out?.done) { try { reader.cancel(); } catch {} return out.result; } } continue; }
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (data.length) { const out = await handle(data.join('\n')); if (out?.done) return out.result; }
    throw new Error(`${this.name}: the stream ended without a response`);
  }
  async request(method, params, opts) {
    const send = () => this.post({ jsonrpc: '2.0', id: ++this.seq, method, ...(params ? { params } : {}) }, opts);
    try { return await send(); }
    catch (e) { if (e.code === 'SESSION') { this.sessionId = null; this.initialized = false; await this.initialize(); return await send(); } throw e; }
  }
  async initialize() {
    const r = await this.post({ jsonrpc: '2.0', id: ++this.seq, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: 'jade-vault', title: 'Jade Vault', version: '1.5' } } }, { timeoutMs: 20000, retry: 1 });
    if (!r) throw new Error(`${this.name}: no answer to initialize`);
    this.protocol = r.protocolVersion || MCP_PROTOCOL; this.serverInfo = r.serverInfo || {}; this.capabilities = r.capabilities || {}; this.instructions = r.instructions || '';
    this.initialized = true;
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { notify: true }).catch(() => {});
    return r;
  }
  async listAll(method, key) { const out = []; let cursor; for (let n = 0; n < 50; n++) { const r = await this.request(method, cursor ? { cursor } : {}); out.push(...(r?.[key] || [])); cursor = r?.nextCursor; if (!cursor) break; } return out; }
}

/* ---------- server manager ---------- */
function mcpServerValidate(name, cfg) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return 'server names may only use letters, digits, _ and -';
  if (cfg.command) return 'stdio servers ("command") cannot run in a browser. Expose it over streamable HTTP (for example: npx -y supergateway --stdio "<command>" --outputTransport streamableHttp) and use its url';
  const t = cfg.type; if (t && !['http', 'streamable-http'].includes(t)) return t === 'sse' ? 'legacy SSE servers are not supported (pi rejects them too); use the streamable HTTP endpoint' : `unknown type "${t}"`;
  if (!/^https?:\/\//.test(cfg.url || '')) return 'needs a "url" starting with http:// or https://';
  if (cfg.exposure && !MCP_EXPOSURES.includes(cfg.exposure) && cfg.exposure !== 'codemode-deferred') return `exposure must be one of ${MCP_EXPOSURES.join(', ')}`;
  return '';
}
async function mcpConnect(srv) {
  srv.client?.close(); srv.state = 'connecting'; srv.error = ''; renderMcpPanel();
  const c = srv.client = new McpHttpClient(srv.name, srv.cfg);
  try {
    await c.initialize();
    srv.tools = await c.listAll('tools/list', 'tools').catch(e => { if (c.capabilities.tools) throw e; return []; });
    srv.hasResources = !!c.capabilities.resources;
    srv.state = 'connected'; srv.connectedAt = Date.now();
  } catch (e) { srv.state = 'error'; srv.error = String(e.message || e); }
  renderMcpPanel();
}
async function mcpReload({ force = false } = {}) {
  const { servers, error } = readMcpConfig(); MCP.configError = error;
  const seen = new Set();
  for (const [name, cfg0] of Object.entries(servers)) {
    const cfg = { ...cfg0 }; seen.add(name);
    const key = JSON.stringify(cfg); let srv = MCP.servers.get(name);
    if (srv && srv.key === key && !force) continue;
    const onlyExposure = srv && JSON.stringify({ ...srv.cfg, exposure: 0, toolExposure: 0, description: 0 }) === JSON.stringify({ ...cfg, exposure: 0, toolExposure: 0, description: 0 });
    if (!srv) { srv = { name, tools: [], state: 'idle' }; MCP.servers.set(name, srv); }
    srv.cfg = cfg; srv.key = key;
    const bad = mcpServerValidate(name, cfg);
    if (bad) { srv.client?.close(); srv.state = 'invalid'; srv.error = bad; continue; }
    if (cfg.enabled === false) { srv.client?.close(); srv.state = 'disabled'; srv.error = ''; continue; }
    if (onlyExposure && srv.state === 'connected' && !force) continue;          // exposure changes apply without reconnecting
    mcpConnect(srv);                                                             // background, like pi
  }
  for (const [name, srv] of MCP.servers) if (!seen.has(name)) { srv.client?.close(); MCP.servers.delete(name); }
  renderMcpPanel();
}
vfs.listeners.add(() => {
  const t = vfs.isFile(MCP_PATH) ? vfs.read(MCP_PATH) : '';
  if (t !== MCP.cfgText) { MCP.cfgText = t; clearTimeout(MCP.reloadT); MCP.reloadT = setTimeout(() => mcpReload(), 400); }
});
function mcpAllTools() {   // [{name, server, tool, description, inputSchema, exposure, annotations}]
  const out = [];
  for (const srv of MCP.servers.values()) if (srv.state === 'connected') for (const t of srv.tools) {
    const ex = mcpExposureFor(srv, t.name); if (ex === 'hidden') continue;
    out.push({ name: mcpToolName(srv.name, t.name), server: srv.name, tool: t.name, description: t.description || t.title || '', inputSchema: t.inputSchema || { type: 'object', properties: {} }, exposure: ex, annotations: t.annotations });
  }
  return out;
}
const mcpFind = name => mcpAllTools().find(t => t.name === name);
const mcpHasResources = () => [...MCP.servers.values()].some(s => s.state === 'connected' && s.hasResources);
const mcpConnected = () => [...MCP.servers.values()].filter(s => s.state === 'connected');

/* ---------- tool_search (BM25 over deferred tools) ---------- */
const mcpTok = s => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
function bm25(docs, query, k1 = 1.2, b = 0.75) {
  const q = mcpTok(query); if (!q.length) return docs.map(d => ({ d, s: 0 }));
  const toks = docs.map(d => mcpTok(d.text)); const avg = toks.reduce((a, t) => a + t.length, 0) / (toks.length || 1);
  const df = {}; for (const t of toks) for (const w of new Set(t)) df[w] = (df[w] || 0) + 1;
  return docs.map((d, i) => { let s = 0; const tf = {}; for (const w of toks[i]) tf[w] = (tf[w] || 0) + 1;
    for (const w of q) { const f = tf[w] || 0; if (!f) continue; const idf = Math.log(1 + (docs.length - df[w] + 0.5) / (df[w] + 0.5)); s += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * toks[i].length / avg)); }
    if (d.name.toLowerCase().includes(String(query).toLowerCase().replace(/\s+/g, '_'))) s += 2;
    return { d, s }; }).filter(x => x.s > 0).sort((a, b2) => b2.s - a.s);
}
const schemaHint = s => { const p = s?.properties || {}; const req = new Set(s?.required || []); return Object.entries(p).map(([k, v]) => `${k}${req.has(k) ? '' : '?'}: ${v.type || (v.enum ? 'enum' : 'any')}`).join(', '); };
function toolSearch(args) {
  const pool = mcpAllTools().filter(t => t.exposure === 'deferred');
  if (!pool.length) return 'No deferred MCP tools are available.';
  const limit = Math.min(Math.max(1, +args.limit || 5), 20);
  const ranked = bm25(pool.map(t => ({ ...t, text: `${t.name} ${t.tool} ${t.server} ${t.description} ${MCP.servers.get(t.server)?.cfg.description || ''}` })), args.query || '');
  const hits = ranked.filter(x => x.s >= ranked[0]?.s * 0.5).slice(0, limit).map(x => x.d);   // only strong matches, so the prompt stays lean
  if (!hits.length) return `No deferred tools match "${args.query}". Servers: ${[...new Set(pool.map(t => t.server))].join(', ')}.`;
  cur.mcpLoaded = [...new Set([...(cur.mcpLoaded || []), ...hits.map(h => h.name)])]; saveSession();
  return `Loaded ${hits.length} tool${hits.length > 1 ? 's' : ''}; you can call ${hits.length > 1 ? 'them' : 'it'} directly from your next step:\n` + hits.map(h => `- ${h.name}(${schemaHint(h.inputSchema)}): ${h.description.slice(0, 200)}`).join('\n');
}

/* ---------- calling MCP tools ---------- */
async function mcpCallRaw(name, args, onProgress) {
  const t = mcpFind(name); if (!t) throw new Error(`Unknown MCP tool ${name}. Connected servers: ${mcpConnected().map(s => s.name).join(', ') || 'none'}.`);
  const srv = MCP.servers.get(t.server);
  return await srv.client.request('tools/call', { name: t.tool, arguments: args || {}, _meta: { progressToken: 'jv' + Date.now() } }, { onProgress });
}
async function mcpSaveBlob(b64, mime, hint) {
  const ext = (mime || '').split('/')[1]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'bin';
  const base = `/attachments/mcp/${todayStr()}-${mcpSafe(hint).slice(0, 40)}`; let p = `${base}.${ext}`, i = 2; while (vfs.exists(p)) p = `${base}-${i++}.${ext}`;
  vfs.write(p, b64dec(b64 || ''), { mkdirs: true }); return p;
}
async function mcpResultText(res, hint) {   // CallToolResult → text for the model
  const parts = [];
  for (const c of res?.content || []) {
    if (c.type === 'text') parts.push(c.text);
    else if (c.type === 'image' || c.type === 'audio') parts.push(`[${c.type} saved to ${await mcpSaveBlob(c.data, c.mimeType, hint)}]`);
    else if (c.type === 'resource') parts.push(c.resource?.text != null ? `[resource ${c.resource.uri}]\n${c.resource.text}` : `[resource ${c.resource?.uri}${c.resource?.blob ? ' saved to ' + await mcpSaveBlob(c.resource.blob, c.resource.mimeType, hint) : ''}]`);
    else if (c.type === 'resource_link') parts.push(`[resource link ${c.uri}${c.name ? ' (' + c.name + ')' : ''}]`);
  }
  if (!parts.length && res?.structuredContent !== undefined) parts.push(JSON.stringify(res.structuredContent, null, 1));
  return parts.join('\n') || '(no content)';
}
async function mcpRunTool(name, args, ui) {
  if (name === 'codemode') return await runCodemode(String(args.code ?? args.script ?? ''), ui);
  if (name === 'tool_search') return toolSearch(args);
  if (name === 'list_mcp_resources' || name === 'list_mcp_resource_templates') {
    const tmpl = name.endsWith('templates'); const servers = mcpConnected().filter(s => s.hasResources && (!args.server || s.name === args.server));
    if (!servers.length) throw new Error(args.server ? `${args.server} is not connected or has no resources` : 'no connected server offers resources');
    const out = {};
    for (const s of servers) { const r = await s.client.request(tmpl ? 'resources/templates/list' : 'resources/list', args.cursor ? { cursor: args.cursor } : {}); out[s.name] = { [tmpl ? 'resourceTemplates' : 'resources']: (tmpl ? r?.resourceTemplates : r?.resources) || [], ...(r?.nextCursor ? { nextCursor: r.nextCursor } : {}) }; }
    return JSON.stringify(out, null, 1);
  }
  if (name === 'read_mcp_resource') {
    const s = MCP.servers.get(args.server); if (!s || s.state !== 'connected') throw new Error(`server ${args.server} is not connected`);
    const r = await s.client.request('resources/read', { uri: args.uri }); const parts = [];
    for (const c of r?.contents || []) parts.push(c.text != null ? c.text : `[${c.mimeType || 'binary'} saved to ${await mcpSaveBlob(c.blob, c.mimeType, 'resource')}]`);
    return parts.join('\n\n') || '(empty resource)';
  }
  const res = await mcpCallRaw(name, args, p => ui?.meta?.(`progress ${p.progress ?? ''}${p.total ? '/' + p.total : ''} ${p.message || ''}`));
  const text = await mcpResultText(res, name.split('__').pop());
  if (res?.isError) throw new Error(text);
  return truncateHead(text);
}

/* ---------- tool declarations for the agent loop ---------- */
function mcpToolDefs() {
  const all = mcpAllTools(); const defs = []; const { autoEnableCodemode } = readMcpConfig();
  const cm = all.filter(t => t.exposure === 'codemode' || t.exposure === 'direct');
  if (all.some(t => t.exposure === 'codemode') && autoEnableCodemode !== false) {
    const ns = mcpConnected().filter(s => all.some(t => t.server === s.name && (t.exposure === 'codemode' || t.exposure === 'direct')))
      .map(s => `- mcp__${mcpSafe(s.name)} (${all.filter(t => t.server === s.name && (t.exposure === 'codemode' || t.exposure === 'direct')).length} tools)${s.cfg.description || s.client?.serverInfo?.title ? ': ' + (s.cfg.description || s.client.serverInfo.title) : ''}`).join('\n');
    defs.push({ name: 'codemode', description: `Run JavaScript in a sandbox that can call tools, to use MCP servers. Call a tool with \`await tools.<name>(args)\`: MCP tools are named mcp__<server>__<tool> and resolve to {content, structuredContent, isError}; your built-in tools work too and resolve to their text (e.g. await tools.read({path: "Inbox.md"})). Run independent calls together with Promise.all. Find tools with searchTools("words"), describeTool(name) (gives the inputSchema), describeNamespace("mcp__<server>") and ALL_TOOLS. Only console.log output, text(...), the return value and image(block) reach you, so filter and summarise inside the script. store(key, value) / load(key) keep JSON between scripts in this chat. Optional first line: // @options {"timeout": 120}\nMCP servers:\n${ns}`,
      parameters: { type: 'object', properties: { code: { type: 'string', description: 'JavaScript (the body of an async function; use await and return)' } }, required: ['code'] } });
  }
  if (all.some(t => t.exposure === 'deferred')) defs.push({ name: 'tool_search', description: `Find MCP tools that are not loaded yet and load them so you can call them directly on your next step. Servers with loadable tools: ${[...new Set(all.filter(t => t.exposure === 'deferred').map(t => t.server))].join(', ')}.`, parameters: { type: 'object', properties: { query: { type: 'string', description: 'What you want to do, in a few words' }, limit: { type: 'number', description: 'Max tools to load (default 5)' } }, required: ['query'] } });
  if (mcpHasResources()) {
    const srvs = mcpConnected().filter(s => s.hasResources).map(s => s.name);
    defs.push({ name: 'list_mcp_resources', description: `List resources (files, records, documents) offered by MCP servers: ${srvs.join(', ')}. Returns JSON.`, parameters: { type: 'object', properties: { server: { type: 'string' }, cursor: { type: 'string' } } } },
      { name: 'list_mcp_resource_templates', description: 'List MCP resource URI templates.', parameters: { type: 'object', properties: { server: { type: 'string' }, cursor: { type: 'string' } } } },
      { name: 'read_mcp_resource', description: 'Read one MCP resource by server and uri.', parameters: { type: 'object', properties: { server: { type: 'string' }, uri: { type: 'string' } }, required: ['server', 'uri'] } });
  }
  const loaded = new Set(cur?.mcpLoaded || []);
  for (const t of all) if (t.exposure === 'direct' || (t.exposure === 'deferred' && loaded.has(t.name)))
    defs.push({ name: t.name, description: (t.description || t.tool).slice(0, 1024), parameters: t.inputSchema?.type ? t.inputSchema : { type: 'object', properties: {} } });
  return defs.map(d => ({ type: 'function', function: d }));
}
const mcpHandles = name => ['codemode', 'tool_search', 'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'].includes(name) || /^mcp__/.test(name);
function mcpPromptBlock() {
  const srvs = mcpConnected(); if (!srvs.length) return '';
  const all = mcpAllTools();
  const lines = srvs.map(s => { const ts = all.filter(t => t.server === s.name); const ex = [...new Set(ts.map(t => t.exposure))].join('/') || 'no tools'; const ins = (s.client?.instructions || '').replace(/\s+/g, ' ').slice(0, 300);
    return `- ${s.name} (${ts.length} tools, ${ex})${s.cfg.description ? ': ' + s.cfg.description : ''}${ins ? `\n  Server instructions: ${ins}` : ''}`; }).join('\n');
  return `\n\nMCP servers (connected):\n${lines}\nUse codemode for codemode servers (await tools.mcp__<server>__<tool>(args) inside the script; searchTools/describeTool to discover), tool_search to load deferred tools, and call direct tools like any other tool.`;
}

/* ---------- codemode sandbox (Web Worker, no network) ---------- */
const CODEMODE_PRELUDE = `
const __out = []; const __images = []; let __seq = 0; const __pending = new Map(); let __catalog = []; let __ns = {}; let __store = {};
const __fmt = a => a.map(x => typeof x === 'string' ? x : (() => { try { return JSON.stringify(x, null, 1); } catch { return String(x); } })()).join(' ');
const console = { log: (...a) => __out.push(__fmt(a)), info: (...a) => __out.push(__fmt(a)), warn: (...a) => __out.push('[warn] ' + __fmt(a)), error: (...a) => __out.push('[error] ' + __fmt(a)), table: x => __out.push(__fmt([x])) };
const text = (...a) => { __out.push(__fmt(a)); };
const __call = (name, args) => new Promise((res, rej) => { const id = ++__seq; __pending.set(id, { res, rej }); postMessage({ t: 'call', id, name, args: args ?? {} }); });
const tools = new Proxy({}, { get: (_, name) => typeof name === 'string' && name !== 'then' ? (args) => __call(name, args) : undefined, has: (_, n) => __catalog.some(t => t.name === n) });
let ALL_TOOLS = [];
const __tok = s => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
function searchTools(query, limit = 10) { const q = __tok(query); return __catalog.map(t => { const d = __tok(t.name + ' ' + t.description); let s = 0; for (const w of q) s += d.filter(x => x === w || x.startsWith(w)).length; return { t, s }; }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map(x => ({ name: x.t.name, description: x.t.description })); }
function describeTool(name) { const t = __catalog.find(x => x.name === name); if (!t) throw new Error('no tool ' + name + '. Try searchTools().'); return { name: t.name, description: t.description, inputSchema: t.inputSchema }; }
function describeNamespace(ns) { const k = String(ns).replace(/__$/, ''); const n = __ns[k]; if (!n) throw new Error('no namespace ' + ns + '. Known: ' + Object.keys(__ns).join(', ')); return n; }
function image(block) { if (!block || !block.data) throw new Error('image() needs an image content block {type:"image", data, mimeType}'); __images.push({ data: block.data, mimeType: block.mimeType || 'image/png' }); return '[image attached]'; }
function store(key, value) { __store[key] = JSON.parse(JSON.stringify(value)); postMessage({ t: 'store', key, value: __store[key] }); return value; }
function load(key) { return __store[key]; }
self.fetch = undefined; self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.EventSource = undefined; self.importScripts = undefined;
self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.t === 'ret') { const p = __pending.get(m.id); if (!p) return; __pending.delete(m.id); m.ok ? p.res(m.value) : p.rej(new Error(m.error)); return; }
  if (m.t !== 'init') return;
  __catalog = m.catalog; ALL_TOOLS = __catalog.map(t => t.name); __ns = m.ns; __store = m.store || {};
  let ret, err = null;
  try { ret = await __main(); } catch (e) { err = (e && e.stack) || String(e); }
  postMessage({ t: 'done', out: __out, images: __images, ret: ret === undefined ? undefined : (() => { try { return JSON.parse(JSON.stringify(ret)); } catch { return String(ret); } })(), err });
};
`;
async function runCodemode(code, ui) {
  if (!code.trim()) throw new Error('codemode needs JavaScript in "code"');
  let timeout = 60; const om = /^\s*\/\/\s*@options\s+(\{.*\})\s*$/m.exec(code.split('\n')[0] || ''); if (om) { try { timeout = Math.min(600, Math.max(1, +JSON.parse(om[1]).timeout || 60)); } catch {} }
  const all = mcpAllTools().filter(t => t.exposure === 'codemode' || t.exposure === 'direct');
  const builtins = activeTools().map(t => t.function).filter(f => !mcpHandles(f.name) && !/^mcp__/.test(f.name));
  const catalog = [...all.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, mcp: true })), ...builtins.map(f => ({ name: f.name, description: f.description, inputSchema: f.parameters }))];
  const ns = {}; for (const s of mcpConnected()) ns['mcp__' + mcpSafe(s.name)] = { name: s.name, description: s.cfg.description || s.client?.serverInfo?.title || '', instructions: s.client?.instructions || '', tools: all.filter(t => t.server === s.name).map(t => t.name) };
  const src = CODEMODE_PRELUDE + `\nasync function __main() {\n${code}\n}\n`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  let calls = 0;
  const r = await new Promise(resolve => {
    let w; try { w = new Worker(url); } catch (e) { resolve({ err: 'could not start the sandbox: ' + e.message, out: [], images: [] }); return; }
    const kill = setTimeout(() => { w.terminate(); resolve({ err: `codemode: script stopped after ${timeout}s (raise it with // @options {"timeout": N})`, out: [], images: [] }); }, timeout * 1000);
    const stop = () => { if (abortReq) { clearTimeout(kill); w.terminate(); resolve({ err: 'aborted', out: [], images: [] }); } }; const abortPoll = setInterval(stop, 300);
    w.onerror = e => { e.preventDefault?.(); clearTimeout(kill); clearInterval(abortPoll); w.terminate(); resolve({ err: `${e.message || 'SyntaxError'}${e.lineno ? ` (line ${Math.max(1, e.lineno - CODEMODE_PRELUDE.split('\n').length - 1)})` : ''}`, out: [], images: [] }); };
    w.onmessage = async e => {
      const m = e.data;
      if (m.t === 'done') { clearTimeout(kill); clearInterval(abortPoll); w.terminate(); resolve(m); return; }
      if (m.t === 'store') { (cur.codemodeStore ||= {})[m.key] = m.value; saveSession(); return; }
      if (m.t === 'call') {
        calls++; ui?.meta?.(`${calls} call${calls > 1 ? 's' : ''} · ${m.name}`);
        try {
          let value;
          if (/^mcp__/.test(m.name)) {
            if (!catalog.some(t => t.name === m.name)) {
              const pre = String(m.name).split('__').slice(0, 2).join('__') + '__'; const near = catalog.map(t => t.name).filter(n => n.startsWith(pre)).slice(0, 8);
              const hiddenOrDeferred = mcpAllTools().some(t => t.name === m.name);
              throw new Error(hiddenOrDeferred ? `${m.name} is a deferred tool: load it with tool_search instead of codemode` : `no tool named ${m.name}${near.length ? '. Tools on that server: ' + near.join(', ') : '. Use searchTools("…")'}`);
            }
            value = await mcpCallRaw(m.name, m.args);
          }
          else if (builtins.some(f => f.name === m.name)) value = await runTool(m.name, m.args, null);
          else { const near = catalog.map(t => t.name).filter(n => n.includes(String(m.name).split('__').pop())).slice(0, 5); throw new Error(`no tool named ${m.name}${near.length ? '. Did you mean ' + near.join(', ') + '?' : '. Use searchTools("…").'}`); }
          w.postMessage({ t: 'ret', id: m.id, ok: true, value });
        } catch (err) { w.postMessage({ t: 'ret', id: m.id, ok: false, error: String(err.message || err) }); }
      }
    };
    w.postMessage({ t: 'init', catalog, ns, store: cur?.codemodeStore || {} });
  });
  URL.revokeObjectURL(url);
  const notes = [];
  for (const [i, im] of (r.images || []).entries()) notes.push(`[image ${i + 1} saved to ${await mcpSaveBlob(im.data, im.mimeType, 'codemode')}]`);
  let out = [...(r.out || [])].join('\n');
  if (r.ret !== undefined) out += (out ? '\n' : '') + (typeof r.ret === 'string' ? r.ret : JSON.stringify(r.ret, null, 1));
  if (notes.length) out += '\n' + notes.join('\n');
  if (r.err) throw new Error((out ? out + '\n' : '') + 'Error: ' + String(r.err).replace(/^(Error:\s*)+/, '').replace(/\n\s+at [\s\S]*$/, ''));
  out = out || '(the script returned nothing: return a value or console.log what you need)';
  if (out.length > 20000) { const p = `/tmp/codemode-${Date.now().toString(36)}.txt`; vfs.write(p, out, { mkdirs: true }); out = out.slice(0, 12000) + `\n\n…[${out.length - 18000} characters cut; full output in ${p}]…\n\n` + out.slice(-6000); }
  ui?.meta?.(`${calls} tool call${calls === 1 ? '' : 's'}`);
  return out;
}

/* ---------- settings panel ("/mcp") ---------- */
function renderMcpPanel() {
  const box = $('#mcpList'); if (!box) return;
  const cfgErr = MCP.configError ? `<div class="text-rd text-sm">${esc(MCP.configError)}</div>` : '';
  const rows = [...MCP.servers.values()].map(s => {
    const dot = { connected: 'ok', connecting: 'busy', error: 'bad', invalid: 'bad', disabled: '' }[s.state] || '';
    const n = s.state === 'connected' ? s.tools.length : 0; const ex = s.cfg.exposure || 'codemode';
    return `<div class="mcp-row" data-srv="${esc(s.name)}">
      <div class="flex items-center gap-2 min-w-0"><span class="dot ${dot}"></span><b class="text-yl">${esc(s.name)}</b><span class="hint truncate">${esc(s.state)}${n ? ` · ${n} tool${n === 1 ? '' : 's'}` : ''}${s.hasResources ? ' · resources' : ''}</span></div>
      <div class="hint truncate mono">${esc(s.cfg.url || s.cfg.command || '')}</div>
      ${s.error ? `<div class="text-rd text-[12px] leading-snug">${esc(s.error)}</div>` : ''}
      <div class="flex flex-wrap gap-2 items-center mt-1">
        <select class="field mcp-ex" aria-label="Exposure for ${esc(s.name)}" style="width:auto;min-height:34px;padding:4px 8px">${MCP_EXPOSURES.map(e => `<option ${e === ex ? 'selected' : ''}>${e}</option>`).join('')}</select>
        <button type="button" class="btn btn-ghost" data-mcp="toggle">${s.cfg.enabled === false ? 'Enable' : 'Disable'}</button>
        <button type="button" class="btn btn-ghost" data-mcp="reconnect">Reconnect</button>
        ${n ? `<button type="button" class="btn btn-ghost" data-mcp="tools">Tools</button>` : ''}
        <button type="button" class="btn btn-ghost" data-mcp="remove">Remove</button>
      </div>
      <div class="mcp-tools" hidden></div>
    </div>`;
  }).join('');
  box.innerHTML = cfgErr + (rows || '<div class="hint">No MCP servers yet. Add one below or edit Jade/mcp.json.</div>');
  const n = mcpConnected().length; const chip = $('#mcpCount'); if (chip) chip.textContent = MCP.servers.size ? `${n}/${MCP.servers.size} connected` : '';
}
$('#mcpList').addEventListener('change', e => {
  const sel = e.target.closest('.mcp-ex'); if (!sel) return; const name = sel.closest('[data-srv]').dataset.srv;
  try { writeMcpConfig(m => { m[name].exposure = sel.value; }); toast(`${esc(name)}: exposure set to ${sel.value}`, 'ok'); } catch (err) { toast(esc(err.message), 'err'); }
});
$('#mcpList').addEventListener('click', async e => {
  const b = e.target.closest('[data-mcp]'); if (!b) return; const row = b.closest('[data-srv]'); const name = row.dataset.srv; const srv = MCP.servers.get(name);
  try {
    if (b.dataset.mcp === 'reconnect') { if (srv) await mcpConnect(srv); toast(srv?.state === 'connected' ? `${esc(name)} connected` : `${esc(name)}: ${esc(srv?.error || 'failed')}`, srv?.state === 'connected' ? 'ok' : 'err'); }
    else if (b.dataset.mcp === 'toggle') writeMcpConfig(m => { if (m[name].enabled === false) delete m[name].enabled; else m[name].enabled = false; });
    else if (b.dataset.mcp === 'remove') { if (b.dataset.armed) writeMcpConfig(m => { delete m[name]; }); else { b.dataset.armed = 1; b.textContent = 'Confirm remove'; b.style.color = 'var(--rd)'; } }
    else if (b.dataset.mcp === 'tools') {
      const box = row.querySelector('.mcp-tools'); box.hidden = !box.hidden;
      box.innerHTML = srv.tools.map(t => { const ex = mcpExposureFor(srv, t.name); return `<div class="mcp-tool"><span class="mono text-cy">${esc(mcpToolName(name, t.name))}</span> <span class="hint">${ex}</span><div class="text-[12.5px] text-dim leading-snug">${esc((t.description || '').slice(0, 220))}</div></div>`; }).join('');
    }
  } catch (err) { toast(esc(err.message), 'err'); }
});
$('#btnMcpAdd').onclick = () => {
  const name = $('#mcpName').value.trim(), url = $('#mcpUrl').value.trim(), hdr = $('#mcpHeader').value.trim(), ex = $('#mcpExposure').value;
  const cfg = { url }; if (ex !== 'codemode') cfg.exposure = ex;
  if (hdr) { const i = hdr.indexOf(':'); if (i < 1) return toast('Header must look like "Authorization: Bearer ${TOKEN}"', 'err'); cfg.headers = { [hdr.slice(0, i).trim()]: hdr.slice(i + 1).trim() }; }
  const bad = mcpServerValidate(name, cfg); if (bad) return toast(esc(bad), 'err');
  try { writeMcpConfig(m => { m[name] = cfg; }); $('#mcpName').value = $('#mcpUrl').value = $('#mcpHeader').value = ''; toast(`Added ${esc(name)}; connecting…`, 'ok'); } catch (err) { toast(esc(err.message), 'err'); }
};
$('#btnMcpEdit').onclick = () => { closeSettings(); ensureMcpFile(); openFile(MCP_PATH, { mode: 'edit' }); };
function renderMcpSettings() { $('#mcpSecrets').value = Object.entries(S.mcpSecrets || {}).map(([k, v]) => `${k}=${v}`).join('\n'); renderMcpPanel(); }
function readMcpSettings() { const o = {}; for (const l of $('#mcpSecrets').value.split('\n')) { const i = l.indexOf('='); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); } const changed = JSON.stringify(o) !== JSON.stringify(S.mcpSecrets || {}); S.mcpSecrets = o; if (changed) setTimeout(() => mcpReload({ force: true }), 100); }

/* ---------- `mcp` shell command (the pi mcp … CLI) ---------- */
async function mcpShell(c) {
  const [sub, ...rest] = c.argv; const o = s => c.o(s + '\n');
  if (!sub || sub === 'list') {
    if (!MCP.servers.size) { o('no MCP servers (add one: mcp add <name> <url> [--header "K: V"] [--exposure codemode|deferred|direct|hidden])'); return 0; }
    let bad = 0; for (const s of MCP.servers.values()) { o(`${s.name.padEnd(16)} ${s.state.padEnd(10)} ${String(s.tools?.length || 0).padStart(3)} tool${(s.tools?.length || 0) === 1 ? ' ' : 's'}  ${(s.cfg.exposure || 'codemode').padEnd(8)} ${s.cfg.url || s.cfg.command || ''}${s.error ? '\n    ' + s.error : ''}`); if (s.cfg.enabled !== false && s.state !== 'connected') bad = 1; } return bad;
  }
  if (sub === 'add') {
    const [name, url] = rest.filter(x => !x.startsWith('--')); if (!name || !url) { c.e('usage: mcp add <name> <url> [--header "K: V"] [--exposure X] [--description "…"]\n'); return 2; }
    const cfg = { url }; for (let i = 0; i < rest.length; i++) { if (rest[i] === '--header') { const h = rest[++i] || ''; const k = h.indexOf(':'); (cfg.headers ||= {})[h.slice(0, k).trim()] = h.slice(k + 1).trim(); } if (rest[i] === '--exposure') cfg.exposure = rest[++i]; if (rest[i] === '--description') cfg.description = rest[++i]; }
    const bad = mcpServerValidate(name, cfg); if (bad) { c.e(`mcp: ${bad}\n`); return 1; }
    writeMcpConfig(m => { m[name] = cfg; }); MCP.cfgText = vfs.read(MCP_PATH); await mcpReload(); const s = MCP.servers.get(name);
    for (let i = 0; i < 100 && s?.state === 'connecting'; i++) await new Promise(r => setTimeout(r, 100));
    o(`${name}: ${s?.state}${s?.state === 'connected' ? ` (${s.tools.length} tool${s.tools.length === 1 ? '' : 's'})` : s?.error ? ' — ' + s.error : ''}`); return s?.state === 'connected' ? 0 : 1;
  }
  if (sub === 'remove') { const n = rest[0]; if (!n) { c.e('usage: mcp remove <name>\n'); return 2; } writeMcpConfig(m => { delete m[n]; }); o(`removed ${n}`); return 0; }
  if (sub === 'reconnect') { const list = rest[0] ? [MCP.servers.get(rest[0])].filter(Boolean) : [...MCP.servers.values()].filter(s => s.cfg.enabled !== false && s.state !== 'invalid'); for (const s of list) { await mcpConnect(s); o(`${s.name}: ${s.state}${s.error ? ' — ' + s.error : ''}`); } return 0; }
  if (sub === 'tools') { const ts = mcpAllTools().filter(t => !rest[0] || t.server === rest[0]); for (const t of ts) o(`${t.name}  [${t.exposure}]  ${t.description.split('\n')[0].slice(0, 100)}`); if (!ts.length) o('no tools'); return 0; }
  if (sub === 'call') { const [name, json] = rest; let args = {}; try { args = json ? JSON.parse(json) : {}; } catch { c.e('mcp call: arguments must be JSON\n'); return 2; } const res = await mcpCallRaw(name, args); o(await mcpResultText(res, String(name).split('__').pop())); return res?.isError ? 1 : 0; }
  c.e('usage: mcp [list|add|remove|reconnect|tools|call]\n'); return 2;
}

/* =====================================================================
   PYTHON — MicroPython (the WebAssembly build PyScript uses), run in a worker
   `python file.py args`, `python -c "code"`, `echo code | python`. The vault is the filesystem:
   open()/os see the same files as the shell and node, and changes are written back.
   The runtime (~0.5 MB) comes from jsDelivr once and is kept in IndexedDB, so it then works offline.
   ===================================================================== */
const MPY_VER = '1.27.0';
const MPY_BASE = `https://cdn.jsdelivr.net/npm/@micropython/micropython-webassembly-pyscript@${MPY_VER}/`;
let mpyAssetsP = null;
async function mpyAssets() {
  return (mpyAssetsP ||= (async () => {
    let c = await idb.get('mpy:' + MPY_VER);
    if (!c?.mjs || !c?.wasm) {
      let m, w;
      try {
        [m, w] = await Promise.all([
          fetch(MPY_BASE + 'micropython.mjs').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }),
          fetch(MPY_BASE + 'micropython.wasm').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }),
        ]);
      } catch (e) { throw new Error(`could not download MicroPython ${MPY_VER} (${e.message}). Python needs internet once; after that it works offline.`); }
      c = { mjs: m, wasm: new Uint8Array(w) }; await idb.set('mpy:' + MPY_VER, c);
    }
    return { mjs: URL.createObjectURL(new Blob([c.mjs], { type: 'text/javascript' })), wasm: URL.createObjectURL(new Blob([c.wasm], { type: 'application/wasm' })), size: c.wasm.length };
  })().catch(e => { mpyAssetsP = null; throw e; }));
}
const MPY_WORKER = `
const dec = new TextDecoder();
self.onmessage = async (ev) => {
  const { mjs, wasm, files, dirs, cwd, argv, code, stdin, heap } = ev.data;
  const outB = [], errB = [], out = [];
  const flush = () => { if (outB.length) { out.push(['o', dec.decode(new Uint8Array(outB.splice(0)))]); } if (errB.length) { out.push(['e', dec.decode(new Uint8Array(errB.splice(0)))]); } };
  let exit = 0, FS = null; const orig = new Map(Object.entries(files));
  try {
    const { loadMicroPython } = await import(mjs);
    let si = 0; const sin = new TextEncoder().encode(stdin || '');
    const mp = await loadMicroPython({ url: wasm, heapsize: heap, linebuffer: false,
      stdout: b => { for (const x of b) outB.push(x); if (outB.length > 4096) flush(); },
      stderr: b => { for (const x of b) errB.push(x); if (errB.length > 4096) flush(); },
      stdin: () => si < sin.length ? sin[si++] : null });
    FS = mp.FS;
    const mk = p => { const parts = p.split('/').filter(Boolean); let cur = ''; for (const s of parts) { cur += '/' + s; try { FS.mkdir(cur); } catch {} } };
    for (const d of dirs) if (d !== '/') mk(d);
    for (const [p, data] of orig) { mk(p.slice(0, p.lastIndexOf('/')) || '/'); FS.writeFile(p, data); }
    try { FS.chdir(cwd); } catch {}
    const scriptDir = argv[0] && argv[0].startsWith('/') ? argv[0].slice(0, argv[0].lastIndexOf('/')) || '/' : cwd;
    mp.runPython('import sys\\nsys.argv[:] = ' + JSON.stringify(argv) + '\\nif ' + JSON.stringify(scriptDir) + ' not in sys.path: sys.path.insert(0, ' + JSON.stringify(scriptDir) + ')');
    await mp.runPythonAsync(code);
  } catch (e) {
    flush();
    const msg = String((e && e.message) || e);
    const m = /SystemExit(?::\\s*(-?\\d+))?\\s*$/.exec(msg.trim());
    if (m) exit = m[1] ? +m[1] : 0;
    else { out.push(['e', msg.endsWith('\\n') ? msg : msg + '\\n']); exit = 1; }
  }
  flush();
  const writes = {}, deletes = [], mkdirs = [];
  if (FS) {
    const seen = new Set();
    const walk = (dir) => {
      let names = []; try { names = FS.readdir(dir); } catch { return; }
      for (const n of names) {
        if (n === '.' || n === '..') continue;
        const p = (dir === '/' ? '' : dir) + '/' + n;
        if (/^\\/(dev|proc|home\\/web_user)(\\/|$)/.test(p) || p === '/home' && !dirs.includes('/home')) continue;
        let st; try { st = FS.stat(p); } catch { continue; }
        if (FS.isDir(st.mode)) { if (!dirs.includes(p) && p !== '/tmp') mkdirs.push(p); walk(p); }
        else { seen.add(p); const data = FS.readFile(p); const o = orig.get(p); if (!o || o.length !== data.length || o.some((x, i) => x !== data[i])) writes[p] = data; }
      }
    };
    walk('/');
    for (const p of orig.keys()) if (!seen.has(p)) deletes.push(p);
  }
  self.postMessage({ out, writes, deletes, mkdirs, code: exit });
};`;
async function runPython(c) {
  const a = c.argv; let code, argv;
  if (a[0] === '--version' || a[0] === '-V') { c.o(`MicroPython ${MPY_VER} (WebAssembly, the PyScript build)\n`); return 0; }
  if (a[0] === '-m' && a[1] === 'pip') { c.e('pip is not available: MicroPython runs in the browser and has no package installer. Use its standard library (json, re, math, random, collections, os, time, hashlib, struct, binascii, heapq, io).\n'); return 1; }
  if (a[0] === '-c') { code = a[1] ?? ''; argv = ['-c', ...a.slice(2)]; }
  else if (a.length && a[0] !== '-') { const p = c.P(a[0]); if (!vfs.isFile(p)) { c.e(`python: can't open file '${a[0]}': No such file\n`); return 2; } code = vfs.read(p); argv = [p, ...a.slice(1)]; }
  else { code = c.stdin; argv = ['']; }
  if (!String(code).trim()) { c.e('python: no script given. Use python file.py or python -c "code"\n'); return 2; }
  let assets; try { assets = await mpyAssets(); } catch (e) { c.e(`python: ${e.message}\n`); return 1; }
  const files = {}, dirs = [];
  for (const [p, n] of vfs.nodes) { if (n.dir) dirs.push(p); else if (n.data.length < 4e6) files[p] = n.data; }
  const wurl = URL.createObjectURL(new Blob([MPY_WORKER], { type: 'text/javascript' }));
  const r = await new Promise(resolve => {
    let w; try { w = new Worker(wurl); } catch (e) { resolve({ out: [['e', `python: could not start a worker (${e.message})\n`]], code: 1 }); return; }
    const done = (v) => { clearTimeout(t); clearInterval(poll); w.terminate(); resolve(v); };
    const t = setTimeout(() => done({ out: [['e', `python: killed after ${c.sh.timeoutMs / 1000}s timeout\n`]], code: 124 }), c.sh.timeoutMs);
    const poll = setInterval(() => { if (c.sh.aborted) done({ out: [['e', '^C\n']], code: 130 }); }, 250);
    w.onmessage = e => done(e.data);
    w.onerror = e => { e.preventDefault?.(); done({ out: [['e', `python: ${e.message || 'worker error'}\n`]], code: 1 }); };
    w.postMessage({ mjs: assets.mjs, wasm: assets.wasm, files, dirs, cwd: c.sh.cwd, argv, code, stdin: a[0] === '-c' || a.length && a[0] !== '-' ? c.stdin : '', heap: 16 * 1024 * 1024 });
  });
  URL.revokeObjectURL(wurl);
  for (const [k, v] of r.out || []) k === 'o' ? c.o(v) : c.e(v);
  for (const p of r.deletes || []) if (vfs.isFile(p)) vfs.rm(p);
  for (const p of r.mkdirs || []) { try { vfs.mkdirp(p); } catch {} }
  for (const [p, d] of Object.entries(r.writes || {})) { try { vfs.write(p, d, { mkdirs: true }); } catch (e) { c.e(`python: could not save ${p}: ${e.message}\n`); } }
  return r.code ?? 1;
}
// fetch the runtime in the background once, so Python also works offline later (phone app)
setTimeout(() => { if (navigator.onLine !== false) (window.requestIdleCallback || setTimeout)(() => mpyAssets().catch(() => {}), 2000); }, 20000);

/* =====================================================================
   BOOT
   ===================================================================== */
(async function boot() {
  setTimeout(() => $('#logo').classList.remove('glitch'), 1200);
  input.value = ls.get('draft', ''); autosize();
  if (!(await vfs.load())) seedFs();
  await applyPendingSettings();
  ensureMemory(); ensureSteering(); ensureHeartbeatFile(); ensureMcpFile();
  MCP.cfgText = vfs.isFile(MCP_PATH) ? vfs.read(MCP_PATH) : ''; mcpReload();
  renderTree(); renderTasks(); termBanner(); updateShellChip();
  initJade(); ollayaCheck();
  const bbBoot = loadEmbeddedBusybox();
  await loadSessions();
  const last = ls.get('lastSession', null);
  if (last && sessions.find(s => s.id === last)) await openSession(last); else newSession();
  await loadOllamaLib();
  await connect();
  loadSchedules();
  await bbBoot; if (!cur?.messages.length) renderEmpty();
  bgSync();
  setTab('chat');
})();
// console/test hook
Object.defineProperty(window, 'cur', { get: () => cur }); Object.defineProperty(window, 'sessions', { get: () => sessions }); Object.assign(window, { mpyAssets, runPython, MCP, mcpReload, mcpToolDefs, mcpAllTools, runCodemode, toolSearch, activeTools, systemPrompt, ls, inActiveHours, hbTick, openSession, runHeartbeat, hbIsAck, heartbeatBody, addAttachments, ATT, HB, buildBackup, importBackup, bgSync, providerChain, connect, toOpenAIMessages, getProv: () => ({ activeProv, models, client: client?.constructor?.name }), listSkills, steering, resendFrom, openFile2: openFile, vfs, openFile, Graph, noteHist, term, vaultIndex, $, memoryContext, journalSession, S, systemPrompt, runTool, userShell }); Object.defineProperty(window, 'editing', { get: () => editing }); Object.defineProperty(window, 'running', { get: () => running });
