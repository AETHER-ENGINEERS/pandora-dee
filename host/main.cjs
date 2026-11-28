#!/usr/bin/env node
// Start Pandora Dee's home host. See host/README.md.
//   node host/main.cjs --root <home folder> [--state <folder>] [--port 8741] [--lan | --listen <address>]
//                      [--page dist/pandora-dee.html] [--shell <program>] [--nap-grace <seconds, default 60>]
//                      [--brain client|host (default: the settings page's choice)] [--trust <range>,<range>…]
//                      [--id <her id, default home>] [--name <her name>] [--homes <folder for new residents>]
//                      [--run inside|process|service (where new residents run; default inside)]
//                      [--access person|doorstep (a service resident's home: hers and yours, or hers and a doorstep)]
// Typed into the host's window while it runs:  pin (a new PIN) · devices · revoke <name or id> · residents ·
//   new <id> [name] (an empty home in --homes) · add <id> <folder> [name] (an existing home, with host_shell) ·
//   shell <id> on|off (host_shell for a resident beyond the first) · run <id> inside|process|service (move her) ·
//   service <id> (her service's install and remove steps, again) · access <id> person|doorstep · waiting · approve <id> · decline <id> · quit
// Every resident has her own port, after --port: the first one's is --port itself.
'use strict';
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const { createHomeHost } = require('./home_host.cjs');
const { createBridgeLink } = require('./bridges.cjs');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name) => args.includes('--' + name);
const root = opt('root') || process.env.PANDORA_HOME;
if (!root) { console.error('Say which folder is her home: --root <folder> (or PANDORA_HOME).'); process.exit(2); }
const port = Number(opt('port') || 8741);
const listen = opt('listen') || (flag('lan') ? '0.0.0.0' : '127.0.0.1');

const host = createHomeHost({
  root,
  id: opt('id'),
  name: opt('name'),
  homes: opt('homes'),
  run: opt('run'),
  access: opt('access'),
  listen,
  brain: opt('brain'),
  port,
  state: opt('state'),
  page: opt('page') || path.join(__dirname, '..', 'dist', 'pandora-dee.html'),
  shell: opt('shell'),
  napGraceMs: opt('nap-grace') !== undefined ? Number(opt('nap-grace')) * 1000 : undefined,
  // more ranges counted as the house's own network, for settings changes (only here, never from the settings page)
  trustNets: (opt('trust') || '').split(',').map((s) => s.trim()).filter(Boolean),
  log: (m) => console.log(m),
});

// each resident's bridges to Vector and Discord: the host runs them (her settings → bridges), and her Atelier reaches
// them through it; and where her loop gets its model: the connected Atelier (its own models), or the host's
const links = [];
function wake(r) {
  const own = r.bridgeConfigs().filter((c) => c.url).map((c) => createBridgeLink(c, { log: r.event }).start());
  links.push(...own);
  const brain = ['client', 'host'].includes(opt('brain')) ? opt('brain') : r.models.state().brain;
  r.startRuntime({ brain, bridges: own });
  return { brain, own };
}
const firstRun = wake(host.resident(host.id));
const brain = firstRun.brain;
// the further residents, each at her own port (a browser keeps each one's key and storage apart that way)
function open(r) {
  if (r.remote) return; // her own process opens her own address
  const entry = host.residents().find((x) => x.id === r.id);
  if (!entry.port) return;
  host.serverFor(r.id).listen(entry.port, listen, () => console.log(`  ${r.name} (${r.id}): http://${listen === '0.0.0.0' ? '127.0.0.1' : listen}:${entry.port}/   (or /r/${r.id}/ on any port)`));
}
const hostAt = listen === '0.0.0.0' ? '127.0.0.1' : listen;
function tellService(r) {
  const e = host.residents().find((x) => x.id === r.id);
  let p; try { p = host.servicePlan(r.id); } catch (err) { return console.log(err.message); }
  console.log(`  ${r.name} (${r.id}) will run as her own service, ${p.identity}, at port ${e.port}.`);
  console.log(e.access === 'doorstep' ? `  Her home will be hers alone; the two of you leave things for each other in "${r.root} (doorstep)".` : '  Her home will be hers and yours (no other resident gets in); her records, hers alone.');
  if (!p.written) return console.log('  ' + p.why);
  console.log(`  Her steps are in ${p.dir}: read them, then ${p.how} (and ${p.remove} undoes it).`);
}
for (const r of host.residents().filter((x) => !x.first)) {
  const res = host.resident(r.id);
  if (res.remote) { console.log(`  ${res.name} (${res.id}): in her own ${res.run === 'service' ? 'service' : 'process'}, http://${hostAt}:${r.port}/`); continue; }
  wake(res); open(res);
}
host.onResident((r, entry, what) => {
  if (!r.remote) { wake(r); open(r); return; }
  if (r.run === 'service') tellService(r);
  else console.log(`  ${r.name} (${r.id}): in her own process, http://${hostAt}:${entry.port}/`);
});

host.server.listen(port, listen, () => {
  console.log(`Pandora Dee's home host ${host.VERSION}`);
  console.log(`  home:   ${host.root}`);
  console.log(`  shell:  ${host.shell}`);
  console.log(`  her loop: ${brain === 'host' ? 'on the host, with the models set up on its settings page' : 'in the connected Atelier, with its own models'}`);
  console.log('  settings change only from this machine, the LAN or the tailnet');
  console.log(`  naps:   when no client has been connected for ${host.nap.graceMs / 1000} s: her switches turn off`);
  if (host.residents().length > 1) console.log(`  residents: ${host.residents().map((r) => `${r.name} (${r.id})`).join(', ')}`);
  console.log(`  bridges: ${firstRun.own.length ? firstRun.own.map((l) => l.name).join(', ') : 'none set up yet'}   settings: http://${listen === '0.0.0.0' ? '127.0.0.1' : listen}:${port}/host/`);
  const where = listen === '0.0.0.0'
    ? Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4').map((i) => `http://${i.address}:${port}/`)
    : [`http://${listen}:${port}/`];
  console.log('  open:   ' + where.join('  '));
  if (listen !== '127.0.0.1') console.log('  (plain HTTP on the network: for the tailnet, Tailscale\'s own HTTPS is better: tailscale serve)');
  console.log(`\nPIN for pairing a device: ${host.newPin()}   (works once, for ten minutes; type "pin" for another)`);
});

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (cmd === 'pin') console.log(`PIN: ${host.newPin()}`);
  else if (cmd === 'devices') console.table(host.devices());
  else if (cmd === 'revoke') console.log(host.revoke(rest.join(' ')) ? 'Removed.' : 'No such device.');
  else if (cmd === 'residents') console.table(host.residents());
  else if (cmd === 'shell') {
    host.setHostShell(rest[0], rest[1] === 'on').then((r) => console.log(`host_shell for ${r.name}: ${r.hostShell ? 'on' : 'off'}.`), (e) => console.log(e.message));
  }
  else if (cmd === 'run') host.setRun(rest[0], rest[1]).then((r) => console.log(`${r.name} now runs ${r.remote ? (r.run === 'service' ? 'as her own service (once it is installed)' : 'in her own process') : "in the host's own process"}.`), (e) => console.log(e.message));
  else if (cmd === 'access') host.setAccess(rest[0], rest[1]).then((p) => console.log(`${rest[1] === 'doorstep' ? 'Her home will be hers alone, with a doorstep beside it for the two of you' : 'Her home will be hers and yours'}: her steps in ${p.dir} are written again.`), (e) => console.log(e.message));
  else if (cmd === 'service') { const r = host.resident(rest[0]); if (r) tellService(r); else console.log(`No resident ${rest[0]}.`); }
  else if (cmd === 'waiting') { const w = host.waiting(); if (w.length) console.table(w); else console.log('No one is waiting.'); }
  else if (cmd === 'approve') { try { host.approve(rest[0]); } catch (e) { console.log(e.message); } }
  else if (cmd === 'decline') { try { host.decline(rest[0]); console.log('Declined.'); } catch (e) { console.log(e.message); } }
  else if (cmd === 'new' || cmd === 'add') {
    try {
      const r = cmd === 'new' ? host.addResident({ id: rest[0], name: rest.slice(1).join(' ') }, 'the host window')
        : host.addResident({ id: rest[0], root: rest[1], name: rest.slice(2).join(' '), local: true }, 'the host window');
      console.log(`Made: ${r.name} (${r.id}), home ${r.root}${r.hostShell ? ', with host_shell' : ''}.`);
    } catch (e) { console.log(e.message); }
  }
  else if (cmd === 'quit' || cmd === 'exit') { for (const l of links) l.stop(); host.close().then(() => process.exit(0)); }
  else if (cmd) console.log('pin · devices · revoke <name or id> · residents · new <id> [name] · add <id> <folder> [name] · shell <id> on|off · run <id> inside|process|service · service <id> · access <id> person|doorstep · waiting · approve <id> · decline <id> · quit');
});
for (const s of ['SIGINT', 'SIGTERM']) process.once(s, () => { for (const l of links) l.stop(); host.close().then(() => process.exit(130)); });
