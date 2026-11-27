#!/usr/bin/env node
// Start Pandora Dee's home host. See host/README.md.
//   node host/main.cjs --root <home folder> [--state <folder>] [--port 8741] [--lan | --listen <address>]
//                      [--page dist/pandora-dee.html] [--shell <program>]
// Typed into the host's window while it runs:  pin (a new PIN) · devices · revoke <name or id> · quit
'use strict';
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const { createHomeHost } = require('./home_host.cjs');

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
  log: (m) => console.log(m),
});

host.server.listen(port, listen, () => {
  console.log(`Pandora Dee's home host ${host.VERSION}`);
  console.log(`  home:   ${host.root}`);
  console.log(`  shell:  ${host.shell}`);
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
  else if (cmd === 'quit' || cmd === 'exit') host.close().then(() => process.exit(0));
  else if (cmd) console.log('pin · devices · revoke <name or id> · quit');
});
for (const s of ['SIGINT', 'SIGTERM']) process.once(s, () => host.close().then(() => process.exit(130)));
