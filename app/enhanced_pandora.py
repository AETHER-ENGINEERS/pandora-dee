# Pandora Dee enhanced: run by build.py (exec, so rep/rd/s are build.py's) after every other step.
# Jade Vault 2.18.2's features are merged in above; this gives them Pandora Dee's words and puts each behind its own
# switch, all off by default. Pandora Dee's own behaviour does not change until one is turned on.

# ---------- her words where people read them ----------
for old, new, *n in [
    ('Kiosk mode: Jade is the home screen', 'Kiosk mode: Pandora is the home screen'),
    ('only runs Jade. She starts when it boots', 'only runs Pandora. She starts when it boots'),
    ('On: the screen is pinned to Jade.', 'On: the screen is pinned to Pandora.'),
    ('Press Home and pick Jade, then', 'Press Home and pick Pandora, then'),
    (">Jade's memory search uses <b>hybrid search</b>", ">Pandora's memory search uses <b>hybrid search</b>"),
    ('for her own collections and your notes. The index is the file <span class="text-yl">Jade/.index/vectors.db</span>', 'for her own collections and your leaves. The index is the file <span class="text-yl">Pandora/.index/vectors.db</span>'),
    ('Also index all my notes (so the embeddings tool can search the whole vault by meaning)', 'Also index all my leaves (so the embeddings tool can search the whole Atelier by meaning)'),
    ('>Talk to Jade without touching the screen', '>Talk to Pandora without touching the screen'),
    ('> Let Jade use the camera, microphone, location, sensors and the phone itself (alarms, sounds, calls, texts)</label>', '> Let Pandora use the camera, microphone, location and sensors (the senses tool and the Talk button)</label>'),
    ('With a transcription model, Jade records each phrase', 'With a transcription model, Pandora records each phrase'),
    ('> Let Jade use her own web browser', '> Let Pandora use her own web browser'),
    ('> Let Jade drive other apps on the phone', '> Let Pandora drive other apps on the phone'),
    ('> Let Jade control the phone', '> Let Pandora control the phone'),
    ('<b>Curiosity wake-ups</b>: Jade wakes at random times', '<b>Curiosity wake-ups</b>: Pandora wakes at random times'),
    ('> Let Jade hand side jobs to a sub-agent', '> Let Pandora hand side jobs to a sub-agent'),
    ('> Let Jade search several lines of reasoning', '> Let Pandora search several lines of reasoning'),
    ('> Let Jade set up Sentry rules', '> Let Pandora set up Sentry rules'),
    ('Each switch above removes that whole set of tools from what Jade is told', 'Each switch above removes that whole set of tools from what Pandora is told'),
    ('/Jade/Config/Sentry.json', '/Pandora/Config/Sentry.json', 2),
    ('. Jade cannot edit the numbers above.', '. Pandora cannot edit the numbers above.'),
    ('SSH hosts: machines Jade can work on', 'SSH hosts: machines Pandora can work on'),
    ('> Let Jade open SSH sessions', '> Let Pandora open SSH sessions'),
    ('">Jade asks for a machine by name.', '">Pandora asks for a machine by name.'),
    ('> Ask me before Jade places a call', '> Ask me before Pandora places a call'),
    ('stops listening while Jade is talking', 'stops listening while Pandora is talking'),
    ('can open and edit them. Jade only keeps the list', 'can open and edit them. Pandora only keeps the list'),
    ('show up when you come back to Jade, or when you tap Rescan', 'show up when you come back to Pandora, or when you tap Rescan'),
    ('Python or scripts, but Jade can still open, move and delete them', 'Python or scripts, but Pandora can still open, move and delete them'),
    ('hand it over, so Jade knows the frame format', 'hand it over, so Pandora knows the frame format'),
    ('placeholder="hey jade, hey choom"', 'placeholder="hey pandora"'),
]:
    rep(old, new, *n)

# ---------- one switch per tool (Jade Vault's senses switch took most of the others with it) ----------
rep_between("WORLD_TOOL_DEFS.filter(t => (S.sensesOn !== false", ".map(f => ({ type: 'function', function: f })), ...mcpToolDefs()]));", "WORLD_TOOL_DEFS.filter(t => enhToolOn(t.name))")
rep("const skillRouted = () => skillActive().length > SKILL_ALL_MAX;", "const skillRouted = () => !!S.skillRouterOn && skillActive().length > SKILL_ALL_MAX;")
rep("  const mode = S.toolRouter || 'auto';", "  const mode = S.toolRouter || 'off';")
# 2.22: USB devices (the usb tool) start off here, with their own switch (Jade Vault has them on, with no box)
rep("...USB_TOOL_DEFS.filter(() => S.usbOn !== false)", "...USB_TOOL_DEFS.filter(() => !!S.usbOn)")

# ---------- the switches Jade Vault has no box for ----------
rep("""        <p class="hint leading-relaxed">Each switch above removes that whole set of tools from what Pandora is told""", """        <label class="flex items-center gap-2 text-sm" for="sLookOn"><input type="checkbox" id="sLookOn" class="accent-emerald-400 w-4 h-4"> Let Pandora look at images and videos in the Atelier (look) and run models on this device: .tflite (litert) and .onnx (onnx)</label>
        <label class="flex items-center gap-2 text-sm" for="sUsbOn"><input type="checkbox" id="sUsbOn" class="accent-emerald-400 w-4 h-4"> Let Pandora use USB devices you plug in and allow, one at a time (usb)</label>
        <label class="flex items-center gap-2 text-sm" for="sChatHistoryOn"><input type="checkbox" id="sChatHistoryOn" class="accent-emerald-400 w-4 h-4"> Let Pandora search and read your past chats (chat_history; needs memory on)</label>
        <label class="flex items-center gap-2 text-sm" for="sPlaybookOn"><input type="checkbox" id="sPlaybookOn" class="accent-emerald-400 w-4 h-4"> Playbooks: saved automations you approve, run without the model (adds the Playbooks tab, the playbook tool and playbook schedules)</label>
        <label class="flex items-center gap-2 text-sm" for="sSkillRouterOn"><input type="checkbox" id="sSkillRouterOn" class="accent-emerald-400 w-4 h-4"> Skill router: with many skills, put only the ones that match the message in the prompt (find_skill for the rest)</label>
        <div><label class="lbl" for="sToolRouter">Tool router</label><select id="sToolRouter" class="field mt-1"><option value="off">Off: every tool that is on goes to the model</option><option value="auto">Auto: only when it saves a lot of context</option><option value="on">On: send the tools that match the message, more_tools for the rest</option></select></div>
        <p class="hint leading-relaxed">Each switch above removes that whole set of tools from what Pandora is told""")
s = s.replace('/* =====================================================================\n   BOOT', rd('enhanced.js') + '\n/* =====================================================================\n   BOOT', 1)
rep("  $('#sCompactAuto').checked = !!S.compactAuto;", "  enhFillSettings();\n  $('#sCompactAuto').checked = !!S.compactAuto;")
rep("  Object.assign(S, { jadeShow: $('#sJadeShow').checked,", "  Object.assign(S, enhReadSettings());\n  Object.assign(S, { jadeShow: $('#sJadeShow').checked,")
rep("saveSettings(); apiApply(); bgSync();", "saveSettings(); enhApply(); apiApply(); bgSync();")
# the Playbooks tab shows only while playbooks are on; the bar keeps its seven columns until then
rep('[hidden]{display:none!important}\n', '[hidden]{display:none!important}\n' + """body:not(.pb-on) .m-nav [data-tab="playbooks"]{display:none}
body:not(.pb-on) .m-nav{grid-template-columns:repeat(7,1fr)}
body:not(.pb-on) .m-nav .tab{font-size:8.8px;letter-spacing:.04em}
""")
