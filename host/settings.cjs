// The host's settings and switches: one source of truth, kept in the host's state folder, read and changed by the
// host's own settings page, by her (through her tools) and, as the Atelier moves onto the host, by the Atelier's
// settings, so none of them can disagree. Every change is logged and announced to whoever is listening.
//
// Her switches: the agent loop, the heartbeat, schedules, curiosity sparks, and the bridges, which are two switches,
// receiving (messages keep landing in the waiting queue) and sending (anything goes out to people).
//
// What turns them off, and what brings them back (Mrrowr-murrr's decisions, 2026-11-27):
//   - A nap (no client connected) turns the loop, heartbeat, schedules, sparks and sending OFF, and they stay off
//     after a client reconnects, until the person turns each back on: reconnecting may follow a planned model switch,
//     and the heartbeat is often best left off while conversations are busy. ("Come back by themselves" is a setting,
//     off by default, for when a local model can carry her.)
//   - Her model going away turns the heartbeat, schedules, sparks and sending OFF, and they stay off when a model is
//     attached again, until the person turns them on. The loop itself only waits for a model.
//   - Receiving stays on through naps and outages: messages keep landing in the queue for her.
// A switch the host turned off says so ("off since the nap", "off since the model outage"); one the person turned off
// says that. While napping or without a model, the switches that need a client or a model are held off as well.

'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SWITCHES = ['loop', 'heartbeat', 'schedules', 'sparks', 'receive', 'send'];
const NAMES = { loop: 'Agent loop', heartbeat: 'Heartbeat', schedules: 'Schedules', sparks: 'Curiosity sparks', receive: 'Bridges: receiving', send: 'Bridges: sending' };
const NAP_HOLDS = new Set(['loop', 'heartbeat', 'schedules', 'sparks', 'send']);    // need a client there
const MODEL_HOLDS = new Set(['loop', 'heartbeat', 'schedules', 'sparks', 'send']);  // need a model
const NAP_TURNS_OFF = ['loop', 'heartbeat', 'schedules', 'sparks', 'send'];
const OUTAGE_TURNS_OFF = ['heartbeat', 'schedules', 'sparks', 'send'];

// The Atelier's colours. The accent is the new brand colour (#BD72F3: hue 183, sat 202, lum 168 on Windows' 0–240
// scale); the rest are the Atelier's current defaults. All can be changed, here or in the Atelier.
const COLORS = { accent: '#BD72F3', background: '#0b0912', panel: '#15111f', text: '#eeeeee', muted: '#a59fb5', border: '#3a3350', ok: '#7ee2a8', warn: '#ffcf8a', bad: '#ff8a8a' };

// Her notice while she can't answer: plain text she (or the person) writes, never made by a model. One per bridge,
// with her own wording per person or per chat if she likes. Empty means silence for that one.
const NOTICE = "Fae is napping, she'll respond to your messages as soon as she's able!";

const DEFAULTS = {
  switches: Object.fromEntries(SWITCHES.map((s) => [s, true])), // what's wanted
  offBy: {},                 // switch → 'nap' | 'outage': the host turned it off; cleared when it's turned back on
  afterNap: 'ask',           // 'ask' (default): switches stay off after a nap until the person turns them on; 'auto'
  afterModel: 'ask',         // 'ask': the model counts as back when the person says so or presses "check"; 'auto': a
                             //   regular check marks it back by itself. Either way, sending and the rest stay off.
  notices: { discord: { default: NOTICE, people: {}, chats: {} }, vector: { default: NOTICE, people: {}, chats: {} } },
  redactWords: [],           // account names and the like, hidden from anything leaving through a bridge
  napGraceSec: 60,
  queueWarnAt: 1000,
  colors: COLORS,
};

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (!(k in base)) { out[k] = v; continue; }                // unknown keys are kept, never dropped
    out[k] = base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && v && typeof v === 'object' && !Array.isArray(v) ? { ...base[k], ...v } : v;
  }
  return out;
}

function createSettings(stateDir, { log = () => {} } = {}) {
  const file = path.join(stateDir, 'settings.json');
  let data;
  try { data = merge(DEFAULTS, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { data = merge(DEFAULTS, {}); }
  data.switches = { ...DEFAULTS.switches, ...Object.fromEntries(Object.entries(data.switches || {}).filter(([k]) => SWITCHES.includes(k))) };
  const save = () => { const t = file + '.tmp'; fs.writeFileSync(t, JSON.stringify(data, null, 1)); fs.renameSync(t, file); };
  const listeners = new Set();
  const changed = (what) => { for (const f of listeners) { try { f(what); } catch { /* one listener never stops the rest */ } } };

  // the host's live state (not saved)
  let napping = true;
  let model = { attached: true, kind: null, since: null, detail: '', checked: null };

  function holds(sw) {
    const why = [];
    if (!data.switches[sw]) why.push(data.offBy[sw] === 'nap' ? 'off since the nap' : data.offBy[sw] === 'outage' ? 'off since the model outage' : 'off');
    if (napping && NAP_HOLDS.has(sw)) why.push('napping');
    if (!model.attached && MODEL_HOLDS.has(sw)) why.push('no model');
    return why;
  }
  const on = (sw) => holds(sw).length === 0;
  /** The host turns switches off (a nap, an outage): they stay off until someone turns them back on. */
  function turnOff(list, by) {
    const did = [];
    for (const s of list) if (data.switches[s]) { data.switches[s] = false; data.offBy[s] = by; did.push(s); }
    if (did.length) { save(); log('switches.turned-off', { by, switches: did }); }
  }

  return {
    SWITCHES, NAMES,
    get: () => JSON.parse(JSON.stringify(data)),
    on,
    holds,
    /** Someone changes settings (the person on either surface, or she through her tools). */
    set(patch, by = 'someone') {
      const p = JSON.parse(JSON.stringify(patch || {}));
      if (p.switches) {
        for (const k of Object.keys(p.switches)) if (!SWITCHES.includes(k)) delete p.switches[k];
        for (const k of Object.keys(p.switches)) { p.switches[k] = !!p.switches[k]; if (p.switches[k]) delete data.offBy[k]; }
      }
      delete p.offBy;
      if ('afterNap' in p && !['auto', 'ask'].includes(p.afterNap)) delete p.afterNap;
      if ('afterModel' in p && !['auto', 'ask'].includes(p.afterModel)) delete p.afterModel;
      if ('redactWords' in p) p.redactWords = (Array.isArray(p.redactWords) ? p.redactWords : String(p.redactWords).split(/[\n,]/)).map((s) => String(s).trim()).filter(Boolean);
      if ('colors' in p) p.colors = Object.fromEntries(Object.entries(p.colors || {}).filter(([, v]) => /^#[0-9a-f]{6}$/i.test(String(v))));
      if ('notices' in p) delete p.notices; // notices change through setNotice, which checks them
      data = merge(data, p);
      save();
      log('settings.changed', { by, keys: Object.keys(p) });
      changed('settings');
      return this.state();
    },
    /** Turn every switch the host turned off back on (a convenience; each can also be turned on by itself). */
    resume(by = 'someone') {
      const back = Object.keys(data.offBy);
      for (const s of back) data.switches[s] = true;
      data.offBy = {}; save();
      log('switches.resumed', { by, switches: back });
      changed('switches');
      return this.state();
    },
    setNapping(n) {
      if (n === napping) return;
      napping = n;
      if (n && data.afterNap === 'ask') turnOff(NAP_TURNS_OFF, 'nap');
      log(n ? 'napping' : 'awake', {});
      changed('switches');
    },
    /** Her model went away (kind: usage-limit, auth, unreachable). */
    modelLost(kind, detail = '') {
      const first = model.attached;
      model = { attached: false, kind, since: first ? Date.now() : model.since, detail: String(detail).slice(0, 2000), checked: null };
      if (first) { turnOff(OUTAGE_TURNS_OFF, 'outage'); log('model.lost', { cause: kind }); changed('model'); }
    },
    /** A model is attached again (the person's word, or a check that worked). Nothing the outage turned off comes back
     *  with it: sending, heartbeat, schedules and sparks wait for the person. */
    modelBack(by = 'someone') {
      if (model.attached) return;
      model = { attached: true, kind: null, since: Date.now(), detail: '', checked: by };
      log('model.back', { by }); changed('model');
    },
    model: () => ({ ...model }),
    // ---- her notice while she can't answer ----
    noticeFor(bridge, chat, fromId, fromName) {
      const n = (data.notices || {})[bridge] || {};
      for (const k of [fromId, fromName]) if (k != null && n.people && Object.prototype.hasOwnProperty.call(n.people, String(k))) return String(n.people[String(k)]);
      if (chat != null && n.chats && Object.prototype.hasOwnProperty.call(n.chats, String(chat))) return String(n.chats[String(chat)]);
      return String(n.default ?? '');
    },
    /** Change a notice. scope: 'default' | 'person' | 'chat'; text '' is silence; remove: true takes an override away.
     *  check(text) → an error message when the text can't be used (provider details, too long). */
    setNotice({ bridge, scope = 'default', key, text = '', remove = false }, by = 'someone', check = () => null) {
      if (!/^[a-z0-9_-]+$/.test(String(bridge || ''))) return { error: 'Which bridge? (discord, vector…)' };
      if (!['default', 'person', 'chat'].includes(scope)) return { error: 'scope is default, person or chat' };
      if (scope !== 'default' && !String(key ?? '').trim()) return { error: `Which ${scope}? (key)` };
      const t = String(text ?? '');
      if (!remove) { const bad = check(t); if (bad) return { error: bad }; }
      const ns = data.notices || (data.notices = {});
      const n = ns[bridge] || (ns[bridge] = { default: NOTICE, people: {}, chats: {} });
      n.people ||= {}; n.chats ||= {};
      if (scope === 'default') n.default = remove ? NOTICE : t;
      else { const m = scope === 'person' ? n.people : n.chats; if (remove) delete m[String(key)]; else m[String(key)] = t; }
      save();
      log('notice.changed', { by, bridge, scope, key: scope === 'default' ? null : String(key), removed: !!remove, silent: !remove && !t });
      changed('settings');
      return { ok: true, notices: JSON.parse(JSON.stringify(n)) };
    },
    state() {
      return {
        napping, model: { ...model },
        switches: Object.fromEntries(SWITCHES.map((s) => [s, { name: NAMES[s], wanted: data.switches[s], offBy: data.offBy[s] || null, on: on(s), why: holds(s) }])),
        settings: JSON.parse(JSON.stringify(data)),
      };
    },
    onChange: (f) => (listeners.add(f), () => listeners.delete(f)),
  };
}

module.exports = { createSettings, SWITCHES, DEFAULTS, COLORS, NOTICE };
