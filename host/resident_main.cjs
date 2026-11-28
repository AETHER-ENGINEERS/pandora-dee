#!/usr/bin/env node
// One resident in her own process: started by the host (run: 'process') or by the computer as her own service
// (run: 'service', under her own identity; see host/services.cjs). Everything at her port is hers; the PIN and the
// list of residents stay with the host (the front), which she asks over this machine only, with her key.
//   node host/resident_main.cjs --config "<her state folder>/resident.json" [--stdin-stop]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHomeHost } = require('./home_host.cjs');
const { createBridgeLink } = require('./bridges.cjs');
const { readKey } = require('./separate.cjs');

const args = process.argv.slice(2);
const at = args.indexOf('--config');
if (at < 0 || !args[at + 1]) { console.error('Say where her resident.json is: --config <file>.'); process.exit(2); }
const cfg = JSON.parse(fs.readFileSync(args[at + 1], 'utf8'));
const key = readKey(path.join(cfg.state, 'front.key'));
if (!key) { console.error('Her front.key is missing, so the host could not reach her. Make her again from the host.'); process.exit(2); }

const host = createHomeHost({
  root: cfg.root, state: cfg.state, id: cfg.id, name: cfg.name, page: cfg.page, shell: cfg.shell,
  hostShell: cfg.hostShell, napGraceMs: cfg.napGraceMs, writerMs: cfg.writerMs, trustNets: cfg.trustNets || [],
  front: { port: cfg.frontPort, key },
  log: (m) => console.log(`[${cfg.name || cfg.id}] ${m}`),
});
const r = host.resident(host.id);
const links = r.bridgeConfigs().filter((c) => c.url).map((c) => createBridgeLink(c, { log: r.event }).start());
const brain = ['client', 'host'].includes(cfg.brain) ? cfg.brain : r.models.state().brain;
r.startRuntime({ brain, bridges: links });
host.server.listen(cfg.port, cfg.listen || '127.0.0.1', () => { r.event('resident.process.up', { run: cfg.run }); console.log(`[${cfg.name || cfg.id}] up at her own port, ${cfg.run === 'service' ? 'as her own service' : 'in her own process'}.`); });

let stopping = false;
const stop = () => { if (stopping) return; stopping = true; for (const l of links) l.stop(); host.close().then(() => process.exit(0)); };
// the host (or the service wrapper on Windows) asks her to stop by closing her input: she finishes writing first
if (args.includes('--stdin-stop')) { process.stdin.on('end', stop); process.stdin.on('error', stop); process.stdin.resume(); }
for (const s of ['SIGINT', 'SIGTERM']) process.once(s, stop);
