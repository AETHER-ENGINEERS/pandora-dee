#!/usr/bin/env node
// Start Pandora Dee's home host. See host/README.md.
//   node host/main.cjs --root <home folder> [--state <folder>] [--port 8741] [--lan | --listen <address>]
//                      [--page dist/pandora-dee.html] [--shell <program>] [--nap-grace <seconds, default 60>]
//                      [--brain client|host (default: the settings page's choice)] [--trust <range>,<range>…]
// Typed into the host's window while it runs:  pin (a new PIN) · devices · revoke <name or id> · quit
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
  state: opt('state'),
  page: opt('page') || path.join(__dirname, '..', 'dist', 'pandora-dee.html'),
  shell: opt('shell'),
  napGraceMs: opt('nap-grace') !== undefined ? Number(opt('nap-grace')) * 1000 : undefined,
  // more ranges counted as the house's own network, for settings changes (only here, never from the settings page)
  trustNets: (opt('trust') || '').split(',').map((s) => s.trim()).filter(Boolean),
  log: (m) => console.log(m),
});

// her bridges to Vector and Discord: the host runs them (settings → bridges), and her Atelier reaches them through it
const links = host.bridgeConfigs().filter((c) => c.url).map((c) => createBridgeLink(c, { log: host.event }).start());
// where her loop gets its model: the connected Atelier (its own models), or the host's (settings → Her models)
const brain = ['client', 'host'].includes(opt('brain')) ? opt('brain') : host.models.state().brain;
host.startRuntime({ brain, bridges: links });

host.server.listen(port, listen, () => {
  console.log(`Pandora Dee's home host ${host.VERSION}`);
  console.log(`  home:   ${host.root}`);
  console.log(`  shell:  ${host.shell}`);
  console.log(`  her loop: ${brain === 'host' ? 'on the host, with the models set up on its settings page' : 'in the connected Atelier, with its own models'}`);
  console.log('  settings change only from this machine, the LAN or the tailnet');
  console.log(`  naps:   when no client has been connected for ${host.nap.graceMs / 1000} s: her switches turn off`);
  console.log(`  bridges: ${links.length ? links.map((l) => l.name).join(', ') : 'none set up yet'}   settings: http://${listen === '0.0.0.0' ? '127.0.0.1' : listen}:${port}/host/`);
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
  else if (cmd === 'quit' || cmd === 'exit') { for (const l of links) l.stop(); host.close().then(() => process.exit(0)); }
  else if (cmd) console.log('pin · devices · revoke <name or id> · quit');
});
for (const s of ['SIGINT', 'SIGTERM']) process.once(s, () => { for (const l of links) l.stop(); host.close().then(() => process.exit(130)); });
