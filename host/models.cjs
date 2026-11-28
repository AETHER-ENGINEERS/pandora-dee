// Her models, as the host reaches them: at least everything the browser Atelier can set (Config → Model provider),
// and more (the person's decision, 2026-11-27: "as configurable as the current browser Atelier, or more so").
//
//   The Atelier                                   The host
//   six fixed providers (Ollama, Ollama Cloud,    the same six to start with, and any number more: each its own
//     Groq, llama.cpp, one OpenAI-compatible,       address, kind (ollama, openai-compatible, aicord), label, timeout
//     AICord)                                       and on/off, so the Mac's Ollama, a second OpenAI-compatible
//                                                   endpoint or a box down the hall are each just another provider
//   one main provider + a fallback list           the same, per job: her chat turns, heartbeat, schedules, sparks,
//   a model per provider                            compaction and vision each have a provider, a model, their own
//   heartbeat and compaction provider/model         fallbacks (provider + model, in order) and their own options
//   temperature, context size, thinking           temperature, context size, thinking, per job
//   a provider that hits its quota rests 30 min   the same, with the rest time a setting
//   keys in the browser's settings                keys write-only on the host (model-secrets.json, owner-only),
//                                                   never shown, never in the settings, never in the log
//
// What a provider says when it fails stays on the host: in the trace (for the person) and in the error the runtime
// classifies (usage limit, refused key, unreachable). It never reaches a channel or a DM (host/runtime.cjs).

'use strict';
const fs = require('node:fs');
const { classifyModelError } = require('./errors.cjs');

const KINDS = ['ollama', 'openai', 'aicord'];
const ROLES = ['chat', 'heartbeat', 'schedules', 'sparks', 'compaction', 'vision'];
const ROLE_NAMES = { chat: 'Her turns (chat and bridges)', heartbeat: 'Heartbeat', schedules: 'Schedules', sparks: 'Curiosity sparks', compaction: 'Compaction and journal', vision: 'Vision' };
const PROVIDERS = {
  local: { kind: 'ollama', label: 'Ollama', base: 'http://localhost:11434', enabled: true, timeoutSec: 300 },
  cloud: { kind: 'openai', label: 'Ollama Cloud', base: 'https://ollama.com/v1', enabled: true, timeoutSec: 300 },
  groq: { kind: 'openai', label: 'Groq', base: 'https://api.groq.com/openai/v1', enabled: true, timeoutSec: 120 },
  llamacpp: { kind: 'openai', label: 'llama.cpp', base: 'http://localhost:8080/v1', enabled: true, timeoutSec: 300 },
  openai: { kind: 'openai', label: 'OpenAI-compatible', base: '', enabled: true, timeoutSec: 300 },
  aicord: { kind: 'aicord', label: 'AICord', base: 'https://aicordapp.com/api/v1', enabled: true, timeoutSec: 120 },
};
const ROLE = { provider: '', model: '', fallbacks: [], temperature: null, numCtx: null, think: null };
const DEFAULTS = {
  brain: 'client',      // where her loop runs: 'client' (the connected Atelier, with its own models) or 'host' (these)
  providers: PROVIDERS,
  roles: { ...Object.fromEntries(ROLES.map((r) => [r, { ...ROLE }])), chat: { ...ROLE, provider: 'local' } },
  options: { temperature: 0.2, numCtx: 16384, think: false },  // for any job that doesn't set its own
  restMin: 30,
};
// the Atelier's own preference when no model is picked yet (app/modules/providers.js)
const PREF_ORDER = [/gpt-oss.?120b/i, /gpt-oss/i, /qwen3/i, /kimi-k2/i, /llama-?3\.3|llama-?4/i, /deepseek/i, /glm-4/i, /mistral|devstral/i, /llama-?3\.[12]/i, /granite|qwen2\.5-coder/i];
const pickModel = (list) => { for (const re of PREF_ORDER) { const m = list.find((x) => re.test(x)); if (m) return m; } return list[0] || ''; };

const clone = (x) => JSON.parse(JSON.stringify(x));
const ID = /^[a-z0-9_-]{1,32}$/;

/** Fill in what's missing and drop what can't be used. Unknown keys inside a provider or job are kept. */
function normalize(m) {
  const out = clone(DEFAULTS);
  m = m && typeof m === 'object' ? m : {};
  if (['client', 'host'].includes(m.brain)) out.brain = m.brain;
  // once saved, the list is the person's: a provider they removed stays removed, even one of the six to start with
  if (m.providers && typeof m.providers === 'object') {
    out.providers = {};
    for (const [id, p] of Object.entries(m.providers)) {
      if (!ID.test(id) || p === null) continue;
      const base = { ...(PROVIDERS[id] || { kind: 'openai', label: id, base: '', enabled: true, timeoutSec: 300 }), ...(p || {}) };
      if (!KINDS.includes(base.kind)) continue;
      base.base = String(base.base || '').trim().replace(/\/+$/, '');
      if (base.base && !/^https?:\/\/[^\s]+$/i.test(base.base)) continue;
      base.label = String(base.label || id).slice(0, 60);
      base.enabled = base.enabled !== false;
      base.timeoutSec = Math.min(3600, Math.max(5, Number(base.timeoutSec) || 300));
      out.providers[id] = base;
    }
  }
  if (m.roles && typeof m.roles === 'object') {
    for (const r of ROLES) {
      const v = m.roles[r]; if (!v || typeof v !== 'object') continue;
      const j = { ...out.roles[r], ...v };
      j.provider = ID.test(String(j.provider || '')) ? String(j.provider) : '';
      j.model = String(j.model || '').slice(0, 200);
      j.fallbacks = (Array.isArray(j.fallbacks) ? j.fallbacks : []).map((f) => (typeof f === 'string' ? { provider: f.split('/')[0], model: f.split('/').slice(1).join('/') } : f))
        .filter((f) => f && ID.test(String(f.provider || ''))).map((f) => ({ provider: String(f.provider), model: String(f.model || '').slice(0, 200) })).slice(0, 12);
      j.temperature = j.temperature === null || j.temperature === '' || j.temperature === undefined ? null : Math.min(2, Math.max(0, Number(j.temperature) || 0));
      j.numCtx = j.numCtx === null || j.numCtx === '' || j.numCtx === undefined ? null : Math.min(2097152, Math.max(512, Math.round(Number(j.numCtx) || 16384)));
      j.think = j.think === null || j.think === '' || j.think === undefined ? null : !!j.think;
      out.roles[r] = j;
    }
  }
  if (m.options && typeof m.options === 'object') {
    const o = m.options;
    if (o.temperature !== undefined) out.options.temperature = Math.min(2, Math.max(0, Number(o.temperature) || 0));
    if (o.numCtx !== undefined) out.options.numCtx = Math.min(2097152, Math.max(512, Math.round(Number(o.numCtx) || 16384)));
    if (o.think !== undefined) out.options.think = !!o.think;
  }
  if (m.restMin !== undefined) out.restMin = Math.min(1440, Math.max(0, Number(m.restMin) || 0));
  return out;
}

function createModels({ settings, secretsFile, log = () => {}, fetchImpl = fetch }) {
  const cfg = () => normalize(settings.get().models);
  const readKeys = () => { try { return JSON.parse(fs.readFileSync(secretsFile, 'utf8')); } catch { return {}; } };
  const resting = {};   // provider → until (ms)
  const aicordIds = {}; // provider → { name: uuid }

  function setKey(id, key) {
    if (!ID.test(String(id))) return { error: 'Which provider?' };
    const k = readKeys(); if (key) k[id] = String(key); else delete k[id];
    fs.writeFileSync(secretsFile + '.tmp', JSON.stringify(k), { mode: 0o600 }); fs.renameSync(secretsFile + '.tmp', secretsFile);
    log('model.key.set', { provider: id, set: !!key });
    return { ok: true, set: !!key };
  }

  /** The job's chain: its own provider and model, then its fallbacks; a job with no provider of its own uses her
   *  turns' chain. Each link: { provider, model, ...options }. */
  function chain(role = 'chat') {
    const c = cfg();
    const j = c.roles[role] || c.roles.chat;
    const src = j.provider ? j : c.roles.chat;
    const opt = (k) => (j[k] !== null && j[k] !== undefined ? j[k] : src[k] !== null && src[k] !== undefined ? src[k] : c.options[k]);
    const links = [{ provider: src.provider, model: src.model }, ...src.fallbacks];
    const seen = new Set();
    return links.filter((l) => { const k = l.provider + '/' + l.model; if (seen.has(k) || !c.providers[l.provider]) return false; seen.add(k); return true; })
      .map((l) => ({ ...l, temperature: opt('temperature'), numCtx: opt('numCtx'), think: opt('think') }));
  }

  async function req(p, key, pathPart, { method = 'GET', body, timeoutSec } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = p.kind === 'aicord' ? key : 'Bearer ' + key;
    let r;
    try { r = await fetchImpl(p.base + pathPart, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout((timeoutSec || p.timeoutSec || 300) * 1000) }); }
    catch (e) { throw Object.assign(new Error(`${p.label}: ${e && e.name === 'TimeoutError' ? 'timed out' : 'could not reach it'} (${(e && e.cause && e.cause.code) || (e && e.message) || e})`), { provider: p.label }); }
    const text = await r.text();
    if (!r.ok) {
      let m = text.slice(0, 1000); try { const j = JSON.parse(text); m = (j.error && (j.error.message || j.error)) || j.message || m; } catch { /* as it came */ }
      throw Object.assign(new Error(`${p.label}: HTTP ${r.status}: ${typeof m === 'string' ? m : JSON.stringify(m)}`), { status: r.status, provider: p.label });
    }
    try { return JSON.parse(text); } catch { throw new Error(`${p.label}: not JSON`); }
  }

  /** The models a provider offers (the GUI's pick list). */
  async function list(id) {
    const c = cfg(); const p = c.providers[id];
    if (!p) throw new Error('No such provider.');
    if (!p.base) throw new Error(`${p.label}: no address set`);
    const key = readKeys()[id] || '';
    if (p.kind === 'ollama') { const j = await req(p, key, '/api/tags', { timeoutSec: 15 }); return (j.models || []).map((m) => m.name || m.model).filter(Boolean).sort(); }
    if (p.kind === 'aicord') {
      const j = await req(p, key, '/characters', { timeoutSec: 15 }); const map = {};
      for (const ch of Array.isArray(j) ? j : []) if (ch && ch.id) map[String(ch.name || ch.id)] = ch.id;
      aicordIds[id] = map; return Object.keys(map).sort();
    }
    const j = await req(p, key, '/models', { timeoutSec: 15 });
    return (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean)
      .filter((x) => !/whisper|tts|-guard|guard-|playai|orpheus|embed|distil|moderation|dall-e|image|audio|transcri/i.test(x)).sort();
  }

  async function once(link, { messages, tools, maxTokens }) {
    const c = cfg(); const p = c.providers[link.provider];
    const key = readKeys()[link.provider] || '';
    let model = link.model;
    if (!model) model = pickModel(await list(link.provider));
    if (!model) throw new Error(`${p.label}: no model picked and none offered`);
    if (p.kind === 'ollama') {
      const j = await req(p, key, '/api/chat', { method: 'POST', body: { model, messages, stream: false, ...(tools && tools.length ? { tools } : {}), ...(link.think ? { think: true } : {}), options: { temperature: link.temperature, num_ctx: link.numCtx, ...(maxTokens ? { num_predict: maxTokens } : {}) } } });
      return { content: String((j.message && j.message.content) || ''), tool_calls: (j.message && j.message.tool_calls) || [], provider: link.provider, model };
    }
    if (p.kind === 'aicord') {
      let id = (aicordIds[link.provider] || {})[model];
      if (!id && !/^[0-9a-f-]{36}$/i.test(model)) { await list(link.provider); id = (aicordIds[link.provider] || {})[model]; }
      const out = []; let sys = '';
      for (const m of messages) {
        const t = String(m.content ?? '');
        if (m.role === 'system') { sys += (sys ? '\n\n' : '') + t; continue; }
        const role = m.role === 'assistant' ? 'character' : 'user';
        const last = out[out.length - 1];
        if (last && last.role === role) last.content.push({ type: 'text', text: t }); else out.push({ role, content: [{ type: 'text', text: t }] });
      }
      if (sys) { const first = out.find((x) => x.role === 'user'); if (first) first.content[0].text = `[Context]\n${sys}\n\n[Message]\n` + first.content[0].text; else out.unshift({ role: 'user', content: [{ type: 'text', text: sys }] }); }
      const j = await req(p, key, '/chat', { method: 'POST', body: { character: id || model, messages: out } });
      return { content: String(j.text || ''), tool_calls: [], provider: link.provider, model };
    }
    const j = await req(p, key, '/chat/completions', { method: 'POST', body: { model, messages, stream: false, temperature: link.temperature, ...(tools && tools.length ? { tools, tool_choice: 'auto' } : {}), ...(maxTokens ? { max_tokens: maxTokens } : {}) } });
    const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
    return { content: String(msg.content || ''), tool_calls: msg.tool_calls || [], provider: link.provider, model };
  }

  /** One reply for a job, along its chain: a provider that fails is passed over for the next; one that hit its quota
   *  rests (restMin). When every one fails, the error carries what each said (for the trace and the classifier). */
  async function chat(role, request) {
    const c = cfg();
    const links = chain(role).filter((l) => c.providers[l.provider].enabled !== false && c.providers[l.provider].base);
    if (!links.length) throw Object.assign(new Error('No model is set up on the host for this.'), { code: 'NONE' });
    const awake = links.filter((l) => !(resting[l.provider] > Date.now()));
    const errs = []; const kinds = [];
    for (const l of awake.length ? awake : links) {
      try {
        const r = await once(l, request || {});
        if (errs.length) log('model.failover', { role, to: l.provider, after: errs.length });
        return r;
      } catch (e) {
        const kind = classifyModelError(e); kinds.push(kind);
        errs.push(String(e && e.message || e));
        if (kind === 'usage-limit' && c.restMin > 0) { resting[l.provider] = Date.now() + c.restMin * 60000; log('model.resting', { provider: l.provider, minutes: c.restMin }); }
      }
    }
    // the most telling cause first, so the classifier sees it: a usage limit, then a refused key, then unreachable
    const order = ['usage-limit', 'auth', 'unreachable'];
    const top = order.find((k) => kinds.includes(k)) || null;
    const e = new Error(errs.join(' · ')); e.cause = top; e.all = errs;
    throw e;
  }

  /** "Try the model again": a tiny real request along her turns' chain. → true, or throws what went wrong. */
  async function check(role = 'chat') {
    for (const p of Object.keys(resting)) delete resting[p]; // asked by hand: try even a resting one
    await chat(role, { messages: [{ role: 'user', content: 'Reply with the word OK.' }], maxTokens: 8 });
    return true;
  }

  function set(patch, by = 'someone') {
    const cur = cfg(); const p = patch && typeof patch === 'object' ? clone(patch) : {};
    const next = {
      ...cur, ...p,
      providers: (() => { const o = { ...cur.providers }; for (const [id, v] of Object.entries(p.providers || {})) { if (v === null) delete o[id]; else o[id] = { ...(o[id] || {}), ...v }; } return o; })(),
      roles: Object.fromEntries(ROLES.map((r) => [r, { ...cur.roles[r], ...((p.roles || {})[r] || {}) }])),
      options: { ...cur.options, ...(p.options || {}) },
    };
    const n = normalize(next);
    for (const [id, v] of Object.entries(p.providers || {})) if (v === null) setKey(id, '');
    settings.setModels(n, by);
    return state();
  }

  function state() {
    const c = cfg(); const keys = readKeys(); const t = Date.now();
    return {
      ...c,
      providers: Object.fromEntries(Object.entries(c.providers).map(([id, p]) => [id, { ...p, keySet: !!keys[id], restingFor: resting[id] > t ? Math.round((resting[id] - t) / 1000) : 0 }])),
      roleNames: ROLE_NAMES, kinds: KINDS,
    };
  }

  /** For the runtime (brain 'host'): her turns, heartbeat, schedules and sparks each on their own job. */
  const runtimeModel = async ({ messages, why }) => {
    const kind = String(why || '').split(':')[0];
    const role = kind === 'turn' ? 'chat' : ROLES.includes(kind) ? kind : 'chat';
    return (await chat(role, { messages })).content;
  };

  return { chain, list, chat, check, set, setKey, state, runtimeModel, ROLES };
}

module.exports = { createModels, normalize, DEFAULTS: DEFAULTS, ROLES, KINDS };
