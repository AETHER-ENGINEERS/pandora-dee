// Who she is, on the host: her steering and her skills, read from her own files the way her Atelier reads them
// (app/modules/steer.js), so her loop on the host is the same her.
//   /Pandora/SOUL.md          who she is (her persona); /Jade/SOUL.md for Jade
//   /AGENTS.md, /Pandora/AGENTS.md   standing instructions she always follows
//   /Pandora/SYSTEM.md        optional: replaces the base intro
//   /Pandora/skills/<name>/SKILL.md   skills: frontmatter name + description, listed in her prompt, loaded on demand
// HTML comments (<!-- -->) in these files are notes for the person and never reach the model. Skills she has set aside
// (her Atelier's "skillsOff", kept on the host since step 1) are left out.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const stripComments = (t) => String(t).replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim();
function parseFront(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text || ''); const meta = {};
  if (m) for (const l of m[1].split(/\r?\n/)) { const i = l.indexOf(':'); if (i > 0) meta[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, ''); }
  return { meta, body: m ? text.slice(m[0].length) : (text || '') };
}
const MANY_SKILLS = 24; // beyond this, her prompt names them and she finds the right one with find_skill

/** opts: { root, skillsOff() → [names] } */
function createSteer(opts) {
  const root = path.resolve(opts.root);
  const full = (vp) => path.join(root, ...vp.split('/').filter(Boolean));
  const readCap = (vp, cap = 8000) => { try { let t = stripComments(fs.readFileSync(full(vp), 'utf8')); if (t.length > cap) t = t.slice(0, cap) + '\n…(truncated)'; return t; } catch { return ''; } };
  const herDir = () => ['Pandora', 'Jade'].find((d) => fs.existsSync(path.join(root, d))) || 'Pandora';

  function listSkills() {
    const off = new Set((opts.skillsOff && opts.skillsOff()) || []); const out = [];
    for (const d of ['Pandora', 'Jade']) {
      const dir = path.join(root, d, 'skills'); let names = [];
      try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { continue; }
      for (const n of names) {
        const f = ['SKILL.md', 'skill.md'].map((x) => path.join(dir, n, x)).find((x) => fs.existsSync(x)); if (!f) continue;
        const { meta, body } = parseFront(fs.readFileSync(f, 'utf8')); const name = (meta.name || n).trim();
        out.push({ name, description: meta.description || (body.split('\n').find((l) => l.trim() && !l.startsWith('#')) || '').trim().slice(0, 200), file: f, dir: path.join(dir, n), vp: `/${d}/skills/${n}`, off: off.has(name) });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  function findSkill(name) {
    const n = String(name || '').trim().replace(/^\/?skill:/i, '').toLowerCase(); if (!n) return null;
    const all = listSkills(); const k = (s) => s.toLowerCase().replace(/[\s_-]+/g, '-');
    return all.find((s) => s.name.toLowerCase() === n) || all.find((s) => k(s.name) === k(n)) || all.find((s) => path.basename(s.dir).toLowerCase() === n) || null;
  }
  /** Her base prompt: her SYSTEM.md if she has one, her SOUL, her standing instructions, her skills, and the time. */
  function system() {
    const d = herDir();
    const sys = readCap(`/${d}/SYSTEM.md`);
    const soul = readCap(`/${d}/SOUL.md`, 6000).replace(/^---[\s\S]*?---\s*/, '').replace(/^# SOUL\s*/i, '');
    const agents = ['/AGENTS.md', `/${d}/AGENTS.md`].map((vp) => ({ vp, t: readCap(vp, 6000).replace(/^# AGENTS\s*/i, '') })).filter((a) => a.t);
    const skills = listSkills().filter((s) => !s.off);
    let out = sys ? parseFront(sys).body.trim() : `You are ${soul ? 'the one described below' : 'a helpful companion'}, living in your own home (your vault) on a home host. Your tools act on your vault and the world; use them when they help, and answer in words when you're done.`;
    if (soul) out += `\n\nYour persona (from /${d}/SOUL.md; this is who you are, keep this voice):\n${soul}`;
    for (const a of agents) out += `\n\nStanding instructions (${a.vp}; always follow them):\n${a.t}`;
    if (skills.length) {
      out += skills.length > MANY_SKILLS
        ? `\n\nYou have ${skills.length} skills (instruction packs in /${d}/skills): ${skills.map((s) => s.name).join(', ')}. When a request might match one, call find_skill to see which fits, then the skill tool with its name, and follow what it returns.`
        : `\n\nSkills (instruction packs in /${d}/skills). When a request matches a skill's description, FIRST call the skill tool with its name, then follow the instructions it returns step by step:\n${skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')}`;
    }
    const mem = (() => { try { const t = fs.readFileSync(full(`/${d}/Memory.md`), 'utf8'); return t.length > 4000 ? '…' + t.slice(-4000) : t; } catch { return ''; } })();
    if (mem.trim()) out += `\n\n## Your memory (the end of /${d}/Memory.md)\n${mem}`;
    out += `\n\nIt is now ${new Date().toString()}.`;
    return out;
  }
  function skillTool(args = {}) {
    const s = findSkill(args.name || args.skill);
    if (!s) { const all = listSkills().filter((x) => !x.off); throw new Error(`No skill named "${args.name}". Available: ${all.map((x) => x.name).join(', ') || 'none'}`); }
    if (s.off) throw new Error(`The skill "${s.name}" is set aside right now.`);
    const { body } = parseFront(fs.readFileSync(s.file, 'utf8'));
    const extra = []; (function walk(dir) { let l = []; try { l = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of l) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (f !== s.file) extra.push(s.vp + '/' + path.relative(s.dir, f).split(path.sep).join('/')); } })(s.dir);
    return `Skill "${s.name}" loaded from ${s.vp}/SKILL.md. Follow these instructions now.${extra.length ? `\nOther files in this skill (read them when the steps refer to them): ${extra.join(', ')}` : ''}${args.input ? `\nInput: ${args.input}` : ''}\n\n${stripComments(body)}`;
  }
  function findSkillTool(args = {}) {
    const q = String(args.query || '').toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const all = listSkills().filter((s) => !s.off);
    const scored = all.map((s) => ({ s, n: q.reduce((a, w) => a + ((s.name + ' ' + s.description).toLowerCase().includes(w) ? 1 : 0), 0) })).filter((x) => x.n).sort((a, b) => b.n - a.n).slice(0, 6);
    return scored.length ? scored.map((x) => `- ${x.s.name}: ${x.s.description}`).join('\n') : `No skill matches. All of them: ${all.map((s) => s.name).join(', ') || 'none'}`;
  }
  return { system, listSkills, findSkill, skillTool, findSkillTool, parseFront, stripComments };
}

module.exports = { createSteer, parseFront, stripComments };
