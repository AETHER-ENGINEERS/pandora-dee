// Compiles android/src/.../ApiServer.java and its test with the plain JDK and runs it (no Android SDK needed).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-api-'));
const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000 }); return (r.stdout || '') + (r.stderr || ''); };
const c = run('javac', ['-nowarn', '--release', '8', '-d', out, path.join(ROOT, 'android/src/app/netrunner/jade/ApiServer.java'), path.join(ROOT, 'android/test/ApiServerTest.java')]);
const o = run('java', ['-cp', out, 'ApiServerTest']);
console.log((c + o).split('\n').filter(l => l && !/Picked up JAVA_TOOL_OPTIONS/.test(l)).join('\n'));
fs.rmSync(out, { recursive: true, force: true });
