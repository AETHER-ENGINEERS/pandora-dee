// The host's settings and switches: one source of truth, kept in the host's state folder, read and changed by the
// host's own settings page and (as the Atelier moves onto the host) by the Atelier's settings, so the two can't
// disagree. Every change is logged and announced to whoever is listening (the settings page, connected clients).
//
// The switches are what nap mode and a missing model actually turn off: the agent loop, the heartbeat, schedules,
// curiosity sparks and the bridges. Each switch is on only when the person wants it on AND nothing holds it off. What
// can hold a switch off, each with its reason shown wherever the switch is:
//   - "napping": no client is connected (host/nap.cjs);
//   - "after a nap": a client is back, but the person chose to turn things on themselves after a nap;
//   - "no model": her model went away (a usage limit, a refused key, unreachable);
//   - "off": the person turned it off.

'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SWITCHES = ['loop', 'heartbeat', 'schedules', 'sparks', 'bridges'];
const NAMES = { loop: 'Agent loop', heartbeat: 'Heartbeat', schedules: 'Schedules', sparks: 'Curiosity sparks', bridges: 'Vector and Discord' };
// what a missing model turns off (the loop too: a turn without a model can only fail)
const MODEL_HOLDS = new Set(SWITCHES);

// The Atelier's colours. The accent is the new brand colour (#BD72F3: hue 183, sat 202, lum 168 on Windows' 0–240
// scale); the rest are the Atelier's current defaults. All can be changed, here or in the Atelier.
const COLORS = { accent: '#BD72F3', background: '#0b0912', panel: '#15111f', text: '#eeeeee', muted: '#a59fb5', border: '#3a3350', ok: '#7ee2a8', warn: '#ffcf8a', bad: '#ff8a8a' };

const DEFAULTS = {
  switches: Object.fromEntries(SWITCHES.map((s) => [s, true])), // what the person wants
  afterNap: 'auto',          // 'auto': switches come back when a client connects; 'ask': the person turns them on
  afterModel: 'ask',         // 'ask': back on only when the person says the model is back; 'auto': when a check succeeds
  bridgesOff: 'quiet',       // 'quiet': bots stay signed in, nothing goes out, messages wait; 'offline': (not built yet)
  offNotice: '',             // a fixed line the person writes, sent once per chat while she can't answer; '' = silence
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
  let data = DEFAULTS;
  try { data = merge(DEFAULTS, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { data = merge(DEFAULTS, {}); }
  const save = () => { const t = file + '.tmp'; fs.writeFileSync(t, JSON.stringify(data, null, 1)); fs.renameSync(t, file); };
  const listeners = new Set();
  const changed = (what) => { for (const f of listeners) { try { f(what); } catch { /* one listener never stops the rest */ } } };

  // what holds switches off right now (not saved: it's the host's live state)
  let napping = true, heldAfterNap = false;
  let model = { attached: true, kind: null, since: null, detail: '' };

  function holds(sw) {
    const why = [];
    if (!data.switches[sw]) why.push('off');
    if (napping) why.push('napping');
    else if (heldAfterNap) why.push('after a nap');
    if (!model.attached && MODEL_HOLDS.has(sw)) why.push('no model');
    return why;
  }
  const on = (sw) => holds(sw).length === 0;

  return {
    SWITCHES, NAMES,
    get: () => JSON.parse(JSON.stringify(data)),
    on,
    holds,
    /** The person changes settings (from either surface). Unknown switches are refused; everything else is kept. */
    set(patch, by = 'someone') {
      const p = { ...(patch || {}) };
      if (p.switches) { for (const k of Object.keys(p.switches)) if (!SWITCHES.includes(k)) delete p.switches[k]; for (const k of Object.keys(p.switches)) p.switches[k] = !!p.switches[k]; }
      if ('afterNap' in p && !['auto', 'ask'].includes(p.afterNap)) delete p.afterNap;
      if ('afterModel' in p && !['auto', 'ask'].includes(p.afterModel)) delete p.afterModel;
      if ('bridgesOff' in p && !['quiet'].includes(p.bridgesOff)) delete p.bridgesOff;
      if ('redactWords' in p) p.redactWords = (Array.isArray(p.redactWords) ? p.redactWords : String(p.redactWords).split(/[\n,]/)).map((s) => String(s).trim()).filter(Boolean);
      if ('colors' in p) p.colors = Object.fromEntries(Object.entries(p.colors || {}).filter(([, v]) => /^#[0-9a-f]{6}$/i.test(String(v))));
      data = merge(data, p);
      save();
      log('settings.changed', { by, keys: Object.keys(p) });
      changed('settings');
      return this.state();
    },
    /** After a nap with afterNap 'ask': the person turns things back on. */
    resume(by = 'someone') { heldAfterNap = false; log('switches.resumed', { by }); changed('switches'); return this.state(); },
    setNapping(n) {
      if (n === napping) return;
      napping = n;
      if (n) heldAfterNap = data.afterNap === 'ask';
      log(n ? 'switches.off' : (heldAfterNap ? 'switches.held' : 'switches.on'), { why: n ? 'napping' : (heldAfterNap ? 'after a nap: waiting for the person' : 'a client connected') });
      changed('switches');
    },
    /** Her model went away (kind: usage-limit, auth, unreachable). Everything that needs it goes off, with why. */
    modelLost(kind, detail = '') {
      const first = model.attached;
      model = { attached: false, kind, since: first ? Date.now() : model.since, detail: String(detail).slice(0, 2000) };
      if (first) { log('model.lost', { cause: kind }); changed('model'); }
    },
    /** A model is attached again: by the person's word, or (afterModel 'auto') a check that succeeded. */
    modelBack(by = 'someone') { if (model.attached) return; model = { attached: true, kind: null, since: Date.now(), detail: '' }; log('model.back', { by }); changed('model'); },
    model: () => ({ ...model }),
    state() {
      return {
        napping, heldAfterNap, model: { ...model },
        switches: Object.fromEntries(SWITCHES.map((s) => [s, { name: NAMES[s], wanted: data.switches[s], on: on(s), why: holds(s) }])),
        settings: JSON.parse(JSON.stringify(data)),
      };
    },
    onChange: (f) => (listeners.add(f), () => listeners.delete(f)),
  };
}

module.exports = { createSettings, SWITCHES, DEFAULTS, COLORS };
