// Her schedules' times, read the same way her Atelier reads them: an exact copy of the page's Cron (app/base, as built
// into dist/pandora-dee.html), so a schedule means the same thing wherever it runs. The host's own clock and time zone.
'use strict';
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
module.exports = { Cron };
