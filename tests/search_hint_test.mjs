// web_search says why it failed (app/search_hint.py): Firefox's and Safari's wording counts as blocked too, and
// when nothing answers it says to check the connection and that pairing with PDA SEASIDE gets past CORS.
import { start } from './_harness.mjs';
const { page, ok, done } = await start();
const E = (fn, arg) => page.evaluate(fn, arg);
const fail = async (msg) => E(async (msg) => {
  const f0 = window.fetch; window.fetch = async () => { throw new TypeError(msg); };
  try { await webSearch('tide charts'); return 'no error'; } catch (e) { return e.message; } finally { window.fetch = f0; }
}, msg);
for (const m of ['NetworkError when attempting to fetch resource.', 'Failed to fetch', 'Load failed']) {
  const e = await fail(m);
  ok(/ddg: blocked \(network\/CORS\)/.test(e) && /wikipedia: blocked/.test(e), `"${m}" reads as blocked: ${e.slice(0, 120)}`);
  ok(/Nothing could be reached: check the connection first/.test(e) && /pair with PDA SEASIDE \(Config → Connect\)/.test(e), `and says the way through (${m})`);
}
// one refused, one with nothing to say: only the CORS hint for the one refused
const mixed = await E(async () => {
  const f0 = window.fetch;
  window.fetch = async (u) => { if (/duckduckgo/.test(String(u))) throw new TypeError('NetworkError when attempting to fetch resource.'); return new Response(JSON.stringify({ query: { search: [] } }), { headers: { 'Content-Type': 'application/json' } }); };
  try { await webSearch('tide charts'); return 'no error'; } catch (e) { return e.message; } finally { window.fetch = f0; }
});
ok(/Some were refused \(CORS\)/.test(mixed) && !/Nothing could be reached/.test(mixed) && /wikipedia: no results/.test(mixed), 'a mix says which were refused: ' + mixed.slice(0, 160));
await done('search_hint_test');
