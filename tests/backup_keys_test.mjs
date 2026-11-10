// Backups and keys (the built page, dist/pandora-dee.html). No browser needed: every setting that holds a key, token,
// password or secret must be in SECRET_KEYS, so a backup made without "Include API keys" leaves it out and a restore
// keeps this device's own. A new key-like setting that isn't listed fails here until it is listed, or named below as
// not a secret.
import fs from 'node:fs'; import { fileURLToPath } from 'node:url'; import assert from 'node:assert';
const html = fs.readFileSync(fileURLToPath(new URL('../dist/pandora-dee.html', import.meta.url)), 'utf8');

const list = html.match(/const SECRET_KEYS = \[([^\]]*)\]/);
assert.ok(list, 'SECRET_KEYS is in the built page');
const secretKeys = new Set([...list[1].matchAll(/'([^']+)'/g)].map(m => m[1]));

// settings the page reads (S.name) and the ones it starts with (DEFAULTS)
const names = new Set([...html.matchAll(/\bS\.([A-Za-z0-9_]+)/g)].map(m => m[1]));
const defaults = html.match(/const DEFAULTS = \{[\s\S]*?\n\};/);
assert.ok(defaults, 'DEFAULTS is in the built page');
for (const m of defaults[0].matchAll(/\b([A-Za-z0-9_]+)\s*:/g)) names.add(m[1]);

const KEY_LIKE = /key|token|pass(word)?$|secret|nsec|cred|bearer|pair/i;
// key-like by name, but not secrets: switches and host lists
const NOT_SECRET = new Set(['abKeys', 'secretHosts', 'passive', 'httpLocalHosts']);
const missing = [...names].filter(n => KEY_LIKE.test(n) && !NOT_SECRET.has(n) && !secretKeys.has(n)).sort();
assert.deepEqual(missing, [], `key-like settings a backup would carry without "Include API keys": ${missing.join(', ')}`);

// the ones this test was written for
for (const k of ['apiToken', 'dcToken', 'vecToken', 'aicKey', 'embedKey', 'abToken', 'abPass', 'secrets', 'mcpSecrets']) assert.ok(secretKeys.has(k), `${k} is left out of backups`);

// and the backup builder uses the list
assert.match(html, /if \(!withKeys\) for \(const k of SECRET_KEYS\) delete settings\[k\]/);
console.log(`backup_keys_test: ok (${secretKeys.size} settings kept out of backups without keys)`);
