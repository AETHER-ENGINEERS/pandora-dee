/* =====================================================================
   ENHANCED — the switches for what this build adds from Jade Vault 2.18.2. Every one starts off; nothing new
   runs, shows a tab or reaches the model until it is turned on in Config. Each tool has its own switch here
   (in Jade Vault the senses switch also took the phone, SSH, think … tools with it).
   ===================================================================== */
function enhToolOn(n) {
  switch (n) {
    case 'senses': return !!S.sensesOn;
    case 'look': case 'litert': return !!S.lookOn;
    case 'browser': return !!S.browserOn;
    case 'screen': return !!S.screenOn;
    case 'phone': return !!S.phoneOn;
    case 'sentry': return !!S.sentryOn;
    case 'ssh': return !!S.sshOn;
    case 'think': return !!S.thinkOn;
    case 'find_skill': return skillRouted();
    case 'delegate': return !!S.delegateOn;
    case 'chat_history': return !!S.chatHistoryOn && S.memoryOn !== false;
    case 'curiosity': return !!S.curiosityOn;
    case 'backup': return !!S.abOn;
    case 'playbook': return !!S.playbookOn;
    default: return false;
  }
}
/** what is visible follows the switches: the Playbooks tab, the playbook schedule kind, the Talk button */
function enhApply() {
  document.body.classList.toggle('pb-on', !!S.playbookOn);
  const opt = document.querySelector('#schedKind option[value="playbook"]'); if (opt) { opt.hidden = opt.disabled = !S.playbookOn; }
  const talk = document.getElementById('btnTalk'); if (talk) talk.hidden = !S.sensesOn;
  if (!S.playbookOn && document.body.dataset.screen === 'playbooks' && typeof setTab === 'function') setTab('chat');
}
function enhFillSettings() {
  for (const [id, k] of [['sLookOn', 'lookOn'], ['sPlaybookOn', 'playbookOn'], ['sChatHistoryOn', 'chatHistoryOn'], ['sSkillRouterOn', 'skillRouterOn']]) { const e = document.getElementById(id); if (e) e.checked = !!S[k]; }
  const tr = document.getElementById('sToolRouter'); if (tr) tr.value = ['auto', 'on'].includes(S.toolRouter) ? S.toolRouter : 'off';
}
function enhReadSettings() {
  const ck = id => !!document.getElementById(id)?.checked, tr = document.getElementById('sToolRouter')?.value;
  return { lookOn: ck('sLookOn'), playbookOn: ck('sPlaybookOn'), chatHistoryOn: ck('sChatHistoryOn'), skillRouterOn: ck('sSkillRouterOn'), toolRouter: ['auto', 'on'].includes(tr) ? tr : 'off' };
}
enhApply();
Object.assign(window, { enhToolOn, enhApply, enhFillSettings, enhReadSettings });
