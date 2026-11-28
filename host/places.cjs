// Where a request comes from: this machine, the house's own network (LAN), the tailnet, or elsewhere. Settings can
// only be changed from the first three (the person's decision, 2026-11-27); from elsewhere the host can still be
// read by a paired device, but nothing about her settings changes.
//
// Only the connection's own address counts, never what a request says about itself, with one exception: a proxy on
// this same machine (Tailscale Serve, a reverse proxy) makes every request look like it comes from here. So when a
// request reaches us from this machine carrying forwarding headers:
//   - Tailscale Serve, on the tailnet, adds Tailscale-User-Login, and strips that header from anything a client sends,
//     so it can't be faked; Tailscale Funnel (the public internet) never carries it. With it: tailnet.
//   - otherwise the forwarded address decides, and only a LAN address counts (100.64.0.0/10 is left out here: Funnel's
//     relays come from that range).
// A proxy that forwards without saying so can't be told apart from this machine: don't put one in front of the host
// for the public internet (host/README.md).

'use strict';
const net = require('node:net');

function v4(a) { const p = a.split('.').map(Number); return p.length === 4 && p.every((n) => n >= 0 && n < 256) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null; }
function inV4(a, cidr) { const [base, bits] = cidr.split('/'); const x = v4(a), b = v4(base); if (x == null || b == null) return false; const m = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0; return ((x & m) >>> 0) === ((b & m) >>> 0); }
function v6words(a) {
  let s = a.toLowerCase().split('%')[0];
  if (s.includes('.')) { const i = s.lastIndexOf(':'); const n = v4(s.slice(i + 1)); if (n == null) return null; s = s.slice(0, i + 1) + (n >>> 16).toString(16) + ':' + (n & 0xffff).toString(16); }
  const [h, t] = s.split('::'); const hw = h ? h.split(':') : []; const tw = t !== undefined ? (t ? t.split(':') : []) : null;
  const w = tw ? [...hw, ...Array(8 - hw.length - tw.length).fill('0'), ...tw] : hw;
  return w.length === 8 ? w.map((x) => parseInt(x || '0', 16)) : null;
}
function inV6(a, cidr) {
  const [base, bits] = cidr.split('/'); const x = v6words(a), b = v6words(base); if (!x || !b) return false;
  let left = Number(bits);
  for (let i = 0; i < 8 && left > 0; i++, left -= 16) { const m = left >= 16 ? 0xffff : (0xffff << (16 - left)) & 0xffff; if ((x[i] & m) !== (b[i] & m)) return false; }
  return true;
}
const LAN4 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16'];
const LAN6 = ['fc00::/7', 'fe80::/10'];
const TAILNET4 = ['100.64.0.0/10'];
const TAILNET6 = ['fd7a:115c:a1e0::/48'];

/** → 'this machine' | 'lan' | 'tailnet' | 'elsewhere' for a bare address. extra: more ranges the person counts as home. */
function placeOf(addr, extra = []) {
  let a = String(addr || '').trim();
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(a)) a = a.slice(7);
  const is4 = net.isIPv4(a), is6 = net.isIPv6(a);
  if (!is4 && !is6) return 'elsewhere';
  const any = (list) => list.some((c) => (c.includes(':') ? is6 && inV6(a, c) : is4 && inV4(a, c)));
  if (is4 ? inV4(a, '127.0.0.0/8') : inV6(a, '::1/128')) return 'this machine';
  if (any(is4 ? TAILNET4 : TAILNET6)) return 'tailnet';
  if (any(is4 ? LAN4 : LAN6)) return 'lan';
  if (any(extra)) return 'lan';
  return 'elsewhere';
}

const FORWARDED = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip', 'tailscale-user-login', 'tailscale-ingress-target'];

/** Where this request comes from, with a reason fit for the host's own log (no addresses). */
function requestPlace(req, extra = []) {
  const sock = placeOf(req.socket && req.socket.remoteAddress, extra);
  if (sock !== 'this machine') return { place: sock, via: 'direct' };
  const h = req.headers || {};
  if (!FORWARDED.some((k) => k in h)) return { place: 'this machine', via: 'direct' };
  if (h['tailscale-user-login']) return { place: 'tailnet', via: 'tailscale serve' };
  const fwd = String(h['x-forwarded-for'] || h['x-real-ip'] || h['cf-connecting-ip'] || h['true-client-ip'] || (/for="?\[?([^\]";,]+)/i.exec(String(h.forwarded || '')) || [])[1] || '');
  const last = fwd.split(',').map((s) => s.trim()).filter(Boolean).pop() || '';
  const p = placeOf(last, extra);
  return { place: p === 'lan' || p === 'this machine' ? p : 'elsewhere', via: 'a proxy on this machine' };
}

const HOME = new Set(['this machine', 'lan', 'tailnet']);
const mayChange = (where) => HOME.has(where.place);

module.exports = { placeOf, requestPlace, mayChange };
