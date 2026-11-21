# ---------- Send and Abort side by side, each doing one thing ----------
# Exec'd by build.py last. While a turn ran, the one button turned red and said "Abort" whatever was in the message box:
# with text it queued the message, with the box empty it stopped the turn. Taking a queued message back to fix it left
# that red "Abort" beside the box, reading like "cancel this edit", and pressed with the box empty it stopped her
# mid-run. Now there are two buttons, side by side:
# - Abort (red) appears next to Send only while a turn runs, and only ever stops the turn;
# - Send only ever sends. During a turn it says "Queue" (she reads the message before her next step); with nothing in
#   the box it does nothing.
rep('            <button class="btn btn-solid cut cut-sm" id="btnSend">Send</button>',
    '            <button type="button" class="btn btn-red cut cut-sm" id="btnAbort" hidden title="Stop the current turn" aria-label="Abort: stop the current turn">Abort</button>\n'
    '            <button class="btn btn-solid cut cut-sm" id="btnSend">Send</button>')
rep("#btnSend{min-height:42px;min-width:64px}", "#btnSend{min-height:42px;min-width:64px}\n#btnAbort{min-height:42px;min-width:64px;margin-right:6px}")
rep("  b.textContent = v ? 'Abort' : 'Send'; b.classList.toggle('btn-solid', !v); b.classList.toggle('btn-red', v);",
    "  sendLabel(); const ab = document.getElementById('btnAbort'); if (ab) ab.hidden = !v;")
rep("$('#btnSend').onclick = () => { if (running && !input.value.trim()) return abort(); ",
    "$('#btnAbort').onclick = () => { if (running) abort(); };\n$('#btnSend').onclick = () => { ")
rep("function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; }",
    "function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; sendLabel(); }")
rep("function setRunning(v) {", """// Send says Queue while a turn runs; it never stops anything (that's the Abort button beside it)
function sendLabel() {
  const b = document.getElementById('btnSend'); if (!b) return;
  b.textContent = running ? 'Queue' : 'Send';
  b.title = running ? 'Queue this message: she reads it before her next step' : 'Send';
}
function setRunning(v) {""")
