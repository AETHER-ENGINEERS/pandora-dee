# ---------- web_search says why it failed (filed by Pandora Dee Fae from 2.9.9.2) ----------
# Exec'd by build.py after chat_peek.py. Only Chrome's "Failed to fetch" was read as blocked; Firefox says
# "NetworkError when attempting to fetch resource." and Safari "Load failed", so those came through raw. And from a
# page opened on its own, Ollama's web search and most SearXNG instances refuse pages outright (CORS), so with
# nothing else answering it said only "configure a provider". Now it says what was blocked, and the way through:
# pair with PDA SEASIDE, or open the Atelier inside it, and those requests go through the desktop.
rep("    } catch (e) { errors.push(`${p}: ${e.message === 'Failed to fetch' ? 'blocked (network/CORS)' : e.message}`); }",
    "    } catch (e) { const blocked = /^(Failed to fetch|NetworkError|Load failed)/i.test(e.message || ''); if (blocked) errors.blocked = (errors.blocked || 0) + 1; errors.push(`${p}: ${blocked ? 'blocked (network/CORS)' : e.message}`); }")
rep("  throw new Error('web search failed — ' + errors.join('; ') + '. Configure a provider in Config → Web search.');",
    "  const how = errors.blocked === errors.length ? ' Nothing could be reached: check the connection first. If it is up, these servers refuse pages opened on their own (CORS); pair with PDA SEASIDE (Config → Connect), or open the Atelier inside it, and the searches go through the desktop.'\n"
    "    : errors.blocked ? ' Some were refused (CORS); pairing with PDA SEASIDE (Config → Connect) sends those through the desktop.' : '';\n"
    "  throw new Error('web search failed — ' + errors.join('; ') + '.' + how + ' Providers: Config → Web search.');")
rep("/* =====================================================================\n   BOOT", "Object.assign(window, { webSearch });   // for tests/search_hint_test.mjs\n/* =====================================================================\n   BOOT")
