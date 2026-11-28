// A resident as her own service, under her own identity on the computer: so her shell, her files and her process are
// walled off from the other residents', without anyone having to make or manage an account for her.
//
//   Windows  her own Windows service (pdee-<id>), whose identity Windows gives it (NT SERVICE\pdee-<id>): no
//            password, no login, not on the sign-in screen. Windows 7 and later. Started by a small service program
//            the install step compiles from service/pdee-service.cs with the .NET compiler Windows already has.
//   Linux    her own system user (pdee-<id>, no login, no home) and a systemd unit; without systemd, an init.d
//            script with start-stop-daemon.
//   macOS    her own hidden service user (_pdee_<id>, like _www) and a LaunchDaemon.
//
// Her home and her state folder become hers alone (and the computer's administrators'). The steps are written as
// plain files in the front's state folder (services/<id>/): the person reads them and runs install as admin, and
// remove puts everything back (her folders return to whoever ran it; her things are never deleted).
// Nothing here runs them: installing a service is the person's own step.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const CODE_DIRS = [__dirname, path.join(__dirname, '..', 'desktop'), path.join(__dirname, '..', 'app', 'modules')].map((d) => path.resolve(d)); // (her playbook and ritual engines are read from app/modules)
const MAIN = path.join(__dirname, 'resident_main.cjs');

/** Her service's name, and her identity's (Linux and macOS names stay within 32 characters). */
function serviceName(id) {
  const n = 'pdee-' + id;
  return n.length <= 32 ? n : `pdee-${id.slice(0, 20)}-${crypto.createHash('sha256').update(id).digest('hex').slice(0, 6)}`;
}
const macUser = (id) => '_' + serviceName(id).replace(/-/g, '_');
const label = (id) => 'org.aether-engineers.pdee.' + id;
/** The doorstep: a folder beside her home that she and the person both write (access: 'doorstep'). */
const doorOf = (root, P = path) => P.resolve(root) + ' (doorstep)';
/** The person: whoever runs the host (and so writes these steps), as this computer names their account. */
function personHere(platform = process.platform) {
  let u = ''; try { u = os.userInfo().username; } catch { u = process.env.USERNAME || process.env.USER || ''; }
  if (platform === 'win32') { const d = process.env.USERDOMAIN || process.env.COMPUTERNAME || ''; return d && u ? `${d}\\${u}` : u; }
  return u;
}
const ACCESS = ['person', 'doorstep'];

// ---- quoting ----
const cmdq = (s) => String(s).replace(/%/g, '%%'); // inside "…" in a .cmd file
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clean = (s) => String(s).replace(/[\x00-\x1f"%<>|&^]/g, '').slice(0, 60);

function windows({ entry, configFile, page, node, dir, person, access }) {
  const svc = serviceName(entry.id), who = `NT SERVICE\\${svc}`;
  const SYS = '*S-1-5-18', ADM = '*S-1-5-32-544', USERS = '*S-1-5-32-545';
  const readable = [...CODE_DIRS, path.win32.dirname(node), ...(page ? [path.win32.dirname(page)] : [])].filter((d, i, a) => a.indexOf(d) === i);
  const exe = path.win32.join(dir, 'pdee-service.exe');
  const you = person ? ` "${cmdq(person)}:(OI)(CI)F"` : '';
  const door = doorOf(entry.root, path.win32);
  const own = (d, withYou = false) => [
    `icacls "${cmdq(d)}" /setowner ${ADM} /T /C /Q >nul`,
    `icacls "${cmdq(d)}" /inheritance:r /grant:r "${who}:(OI)(CI)F"${withYou ? you : ''} ${SYS}:(OI)(CI)F ${ADM}:(OI)(CI)F /Q || goto :failed`,
    `icacls "${cmdq(d)}\\*" /reset /T /C /Q >nul 2>&1`,
  ];
  const give = (d) => [
    `icacls "${cmdq(d)}" /setowner "%USERDOMAIN%\\%USERNAME%" /T /C /Q >nul`,
    `icacls "${cmdq(d)}" /reset /T /C /Q >nul`,
  ];
  const admin = 'net session >nul 2>&1 || (echo Run this as administrator: right-click it, "Run as administrator". & exit /b 1)';
  const install = [
    '@echo off', 'setlocal',
    `rem Pandora Dee's home host: ${clean(entry.name)} (${entry.id}) as her own Windows service, under her own identity`,
    `rem (${who}): no password, no login. Run as administrator. remove.cmd, beside this, puts everything back.`,
    admin,
    'set "CSC="',
    'for %%f in (Framework64 Framework) do for %%v in (v4.0.30319 v3.5 v2.0.50727) do if not defined CSC if exist "%WINDIR%\\Microsoft.NET\\%%f\\%%v\\csc.exe" set "CSC=%WINDIR%\\Microsoft.NET\\%%f\\%%v\\csc.exe"',
    `if not defined CSC (echo This Windows has no .NET compiler, so her service can't be built here. On the host, "run ${entry.id} process" runs her in her own process instead. & exit /b 1)`,
    `"%CSC%" /nologo /target:exe /out:"${cmdq(exe)}" /r:System.ServiceProcess.dll "${cmdq(path.win32.join(dir, 'pdee-service.cs'))}" || goto :failed`,
    `sc.exe create "${svc}" binPath= "\\"${cmdq(exe)}\\" ${svc} \\"${cmdq(node)}\\" \\"${cmdq(MAIN)}\\" \\"${cmdq(configFile)}\\"" start= auto obj= "${who}" DisplayName= "Pandora Dee host: ${clean(entry.name)}" || goto :failed`,
    `sc.exe description "${svc}" "${clean(entry.name)}'s home on Pandora Dee's home host, under her own identity." >nul`,
    `sc.exe failure "${svc}" reset= 86400 actions= restart/5000/restart/30000/restart/60000 >nul`,
    access === 'doorstep'
      ? 'rem her home and her records: hers alone (and the computer\'s SYSTEM and administrators). The doorstep: hers and yours'
      : 'rem her home: hers and yours. Her records (her key is there): hers alone. No other resident gets into either',
    ...own(entry.root, access !== 'doorstep'), ...own(entry.state),
    ...(access === 'doorstep' ? [`if not exist "${cmdq(door)}" mkdir "${cmdq(door)}"`, ...own(door, true)] : []),
    'rem what she runs: readable by her',
    ...readable.map((d) => `icacls "${cmdq(d)}" /grant "${who}:(OI)(CI)RX" /Q >nul || goto :failed`),
    'rem these steps and her service program: changed only by administrators',
    `icacls "${cmdq(dir)}" /inheritance:r /grant:r ${SYS}:(OI)(CI)F ${ADM}:(OI)(CI)F ${USERS}:(OI)(CI)RX "${who}:(OI)(CI)RX" /Q >nul`,
    `sc.exe start "${svc}" >nul || goto :failed`,
    `echo ${clean(entry.name)} runs as her own service now (${svc}).`,
    'exit /b 0',
    ':failed', `echo Something didn't work. remove.cmd undoes what was done.`, 'exit /b 1', '',
  ].join('\r\n');
  const remove = [
    '@echo off', 'setlocal',
    `rem Takes ${clean(entry.name)}'s service away and gives her folders back to whoever runs this. Her things stay. Run as administrator.`,
    admin,
    `sc.exe stop "${svc}" >nul 2>&1`,
    `for /l %%i in (1,1,20) do (sc.exe query "${svc}" | find "RUNNING" >nul || goto :stopped & ping -n 2 127.0.0.1 >nul)`,
    ':stopped',
    ...readable.map((d) => `icacls "${cmdq(d)}" /remove "${who}" /Q >nul 2>&1`),
    ...give(entry.root), ...give(entry.state), ...give(dir),
    ...(access === 'doorstep' ? [`if exist "${cmdq(door)}" (`, ...give(door).map((l) => '  ' + l), ')'] : []),
    `sc.exe delete "${svc}" >nul 2>&1`,
    `echo ${clean(entry.name)}'s service is gone; her folders are yours again. On the host: run ${entry.id} inside (or process).`, '',
  ].join('\r\n');
  return {
    platform: 'win32', name: svc, identity: who,
    files: { 'install.cmd': install, 'remove.cmd': remove, 'pdee-service.cs': fs.readFileSync(path.join(__dirname, 'service', 'pdee-service.cs'), 'utf8') },
    install: 'install.cmd', remove: 'remove.cmd', how: 'right-click install.cmd, "Run as administrator"',
  };
}

function linux({ entry, configFile, node, person, access }) {
  const door = doorOf(entry.root, path.posix), withDoor = access === 'doorstep' ? ' ' + shq(door) : '';
  const svc = serviceName(entry.id), user = svc;
  const unit = [
    '[Unit]', `Description=Pandora Dee host: ${clean(entry.name)} (${entry.id})`, 'After=network.target', '',
    '[Service]', `User=${user}`, `Group=${user}`,
    `ExecStart="${node}" "${MAIN}" --config "${configFile}"`,
    'Restart=on-failure', 'RestartSec=5', 'UMask=0077', 'NoNewPrivileges=yes', 'PrivateTmp=yes', 'ProtectSystem=full', '',
    '[Install]', 'WantedBy=multi-user.target', '',
  ].join('\n');
  const init = [
    '#!/bin/sh', '### BEGIN INIT INFO', `# Provides: ${svc}`, '# Required-Start: $network', '# Required-Stop: $network',
    '# Default-Start: 2 3 4 5', '# Default-Stop: 0 1 6', `# Short-Description: Pandora Dee host: ${clean(entry.name)}`, '### END INIT INFO',
    `P=/var/run/${svc}.pid`,
    'case "$1" in',
    `  start) start-stop-daemon --start --background --make-pidfile --pidfile "$P" --chuid ${user} --exec ${shq(node)} -- ${shq(MAIN)} --config ${shq(configFile)} ;;`,
    '  stop) start-stop-daemon --stop --pidfile "$P" --retry 10; rm -f "$P" ;;',
    '  restart) "$0" stop; "$0" start ;;',
    '  *) echo "start | stop | restart"; exit 1 ;;', 'esac', '',
  ].join('\n');
  const root = '[ "$(id -u)" = 0 ] || { echo "Run this as root: sudo sh $0"; exit 1; }';
  const install = [
    '#!/bin/sh', `# Pandora Dee's home host: ${clean(entry.name)} (${entry.id}) as her own service, under her own system user`,
    `# (${user}): no password, no login, no home of its own. Run as root. remove.sh, beside this, puts everything back.`,
    'set -e', root, `U=${shq(user)}`,
    'if ! id "$U" >/dev/null 2>&1; then',
    '  if command -v useradd >/dev/null 2>&1; then useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --user-group "$U"',
    '  else adduser --system --no-create-home --disabled-login --group "$U"; fi',
    'fi',
    ...(access === 'doorstep' ? [`mkdir -p ${shq(door)}`] : []),
    `chown -R "$U:$(id -gn "$U")" ${shq(entry.root)} ${shq(entry.state)}${withDoor}`,
    `chmod -R go-rwx ${shq(entry.root)} ${shq(entry.state)}${withDoor}`,
    ...(person ? linuxYou(person, access === 'doorstep' ? door : entry.root) : []),
    'if [ -d /run/systemd/system ]; then',
    `  cat > /etc/systemd/system/${svc}.service <<'UNIT'`, unit + 'UNIT',
    `  systemctl daemon-reload && systemctl enable --now ${svc}`,
    'else',
    `  cat > /etc/init.d/${svc} <<'INIT'`, init + 'INIT',
    `  chmod 755 /etc/init.d/${svc}`,
    `  (update-rc.d ${svc} defaults || chkconfig --add ${svc}) >/dev/null 2>&1 || true`,
    `  /etc/init.d/${svc} start`,
    'fi',
    `echo "${clean(entry.name)} runs as her own service now (${svc})."`, '',
  ].join('\n');
  const remove = [
    '#!/bin/sh', `# Takes ${clean(entry.name)}'s service away and gives her folders back to whoever ran sudo. Her things stay. Run as root.`,
    root, `U=${shq(user)}`,
    `if [ -f /etc/systemd/system/${svc}.service ]; then systemctl disable --now ${svc}; rm -f /etc/systemd/system/${svc}.service; systemctl daemon-reload; fi`,
    `if [ -f /etc/init.d/${svc} ]; then /etc/init.d/${svc} stop || true; (update-rc.d -f ${svc} remove || chkconfig --del ${svc}) >/dev/null 2>&1 || true; rm -f /etc/init.d/${svc}; fi`,
    `command -v setfacl >/dev/null 2>&1 && setfacl -R -b ${shq(entry.root)}${withDoor} 2>/dev/null || true`,
    `if [ -n "$SUDO_USER" ]; then chown -R "$SUDO_USER:$(id -gn "$SUDO_USER")" ${shq(entry.root)} ${shq(entry.state)}${withDoor}; else echo "Give her folders back to whoever should have them (chown -R)."; fi`,
    'id "$U" >/dev/null 2>&1 && userdel "$U" 2>/dev/null || true',
    `echo "${clean(entry.name)}'s service is gone. On the host: run ${entry.id} inside (or process)."`, '',
  ].join('\n');
  return { platform: 'linux', name: svc, identity: user, files: { 'install.sh': install, 'remove.sh': remove }, install: 'install.sh', remove: 'remove.sh', how: 'sudo sh install.sh' };
}

/** The person, in a folder that's hers: an ACL entry where the system has them, or else her group with them in it. */
function linuxYou(person, d) {
  return [
    `P=${shq(person)}`,
    'if command -v setfacl >/dev/null 2>&1; then',
    `  setfacl -R -m "u:$P:rwX" -m "d:u:$P:rwX" ${shq(d)}`,
    'else',
    `  usermod -a -G "$(id -gn "$U")" "$P" && chmod -R g+rwX ${shq(d)} && find ${shq(d)} -type d -exec chmod g+s {} +`,
    'fi',
  ];
}

function mac({ entry, configFile, node, dir, person, access }) {
  const door = doorOf(entry.root, path.posix), withDoor = access === 'doorstep' ? ' ' + shq(door) : '';
  const user = macUser(entry.id), lab = label(entry.id);
  const plist = `/Library/LaunchDaemons/${lab}.plist`;
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    `<key>Label</key><string>${xml(lab)}</string>`,
    `<key>UserName</key><string>${xml(user)}</string>`,
    '<key>ProgramArguments</key><array>', ...[node, MAIN, '--config', configFile].map((a) => `<string>${xml(a)}</string>`), '</array>',
    '<key>RunAtLoad</key><true/>', '<key>KeepAlive</key><true/>', '<key>Umask</key><integer>63</integer>',
    `<key>StandardErrorPath</key><string>${xml(path.posix.join(entry.state, 'service.log'))}</string>`,
    '</dict></plist>', '',
  ].join('\n');
  const root = '[ "$(id -u)" = 0 ] || { echo "Run this as root: sudo sh $0"; exit 1; }';
  const install = [
    '#!/bin/sh', `# Pandora Dee's home host: ${clean(entry.name)} (${entry.id}) as her own service, under her own hidden service user`,
    `# (${user}, like _www): no password, no login. Run as root. remove.sh, beside this, puts everything back.`,
    'set -e', root, `U=${shq(user)}`,
    'if ! dscl . -read "/Users/$U" >/dev/null 2>&1; then',
    '  n=400',
    '  while dscl . -list /Users UniqueID | awk \'{print $2}\' | grep -qx "$n" || dscl . -list /Groups PrimaryGroupID | awk \'{print $2}\' | grep -qx "$n"; do n=$((n+1)); done',
    '  dscl . -create "/Groups/$U"; dscl . -create "/Groups/$U" PrimaryGroupID "$n"; dscl . -create "/Groups/$U" Password \'*\'',
    '  dscl . -create "/Users/$U"; dscl . -create "/Users/$U" UniqueID "$n"; dscl . -create "/Users/$U" PrimaryGroupID "$n"',
    '  dscl . -create "/Users/$U" UserShell /usr/bin/false; dscl . -create "/Users/$U" NFSHomeDirectory /var/empty',
    `  dscl . -create "/Users/$U" RealName ${shq('Pandora Dee host: ' + clean(entry.name))}; dscl . -create "/Users/$U" IsHidden 1; dscl . -create "/Users/$U" Password '*'`,
    'fi',
    ...(access === 'doorstep' ? [`mkdir -p ${shq(door)}`] : []),
    `chown -R "$U:$U" ${shq(entry.root)} ${shq(entry.state)}${withDoor}`,
    `chmod -R go-rwx ${shq(entry.root)} ${shq(entry.state)}${withDoor}`,
    ...(person ? [`chmod -R +a ${shq(person + ' allow list,add_file,search,delete,add_subdirectory,delete_child,readattr,writeattr,readextattr,writeextattr,readsecurity,read,write,append,execute,file_inherit,directory_inherit')} ${shq(access === 'doorstep' ? door : entry.root)}`] : []),
    `cp ${shq(path.posix.join(dir, lab + '.plist'))} ${shq(plist)}; chown root:wheel ${shq(plist)}; chmod 644 ${shq(plist)}`,
    `launchctl bootstrap system ${shq(plist)} 2>/dev/null || launchctl load -w ${shq(plist)}`,
    `echo "${clean(entry.name)} runs as her own service now (${lab})."`, '',
  ].join('\n');
  const remove = [
    '#!/bin/sh', `# Takes ${clean(entry.name)}'s service away and gives her folders back to whoever ran sudo. Her things stay. Run as root.`,
    root, `U=${shq(user)}`,
    `launchctl bootout system/${lab} 2>/dev/null || launchctl unload -w ${shq(plist)} 2>/dev/null || true`,
    `rm -f ${shq(plist)}`,
    `chmod -R -N ${shq(entry.root)}${withDoor} 2>/dev/null || true`,
    `if [ -n "$SUDO_USER" ]; then chown -R "$SUDO_USER" ${shq(entry.root)} ${shq(entry.state)}${withDoor}; else echo "Give her folders back to whoever should have them (chown -R)."; fi`,
    'dscl . -delete "/Users/$U" 2>/dev/null || true; dscl . -delete "/Groups/$U" 2>/dev/null || true',
    `echo "${clean(entry.name)}'s service is gone. On the host: run ${entry.id} inside (or process)."`, '',
  ].join('\n');
  return { platform: 'darwin', name: lab, identity: user, files: { 'install.sh': install, 'remove.sh': remove, [lab + '.plist']: body }, install: 'install.sh', remove: 'remove.sh', how: 'sudo sh install.sh' };
}

/**
 * Her service's install and remove steps for this computer (or another platform's, for the person to take there).
 * { entry: { id, name, root, state }, configFile, page?, platform?, node?, dir? }
 */
function plan({ entry, configFile, page = null, platform = process.platform, node = process.execPath, dir = '', person, access }) {
  // the program itself, not a link to it (a version manager's link would be what got her permission, not node)
  if (node === process.execPath) { try { node = fs.realpathSync(node); } catch { /* as given */ } }
  // access 'person' (the default): her home is hers and the person's, walled off from the other residents.
  // 'doorstep': her home is hers alone, and a folder beside it is where the two of them leave things for each other
  access = ACCESS.includes(access) ? access : ACCESS.includes(entry.access) ? entry.access : 'person';
  if (person === undefined) person = personHere(platform);
  const o = { entry, configFile, page, node, dir, person: person ? String(person).replace(/[\x00-\x1f"%<>|&^]/g, '') : '', access };
  if (platform === 'win32') return windows(o);
  if (platform === 'darwin') return mac(o);
  return linux(o);
}

/** Write the steps where the person can read and run them. After an install, the folder is the administrators'. */
function writePlan(dir, p) {
  fs.mkdirSync(dir, { recursive: true });
  const files = p.files;
  try {
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body, { mode: name.endsWith('.sh') ? 0o755 : 0o644 });
  } catch (e) {
    if (e.code === 'EACCES' || e.code === 'EPERM') return { ...p, dir, written: false, why: 'Her service is installed, so its steps are the administrators\' now: they stay as they were. Run remove first to change them.' };
    throw e;
  }
  return { ...p, dir, written: true, installFile: path.join(dir, p.install), removeFile: path.join(dir, p.remove) };
}

module.exports = { plan, writePlan, serviceName, macUser, label, doorOf, personHere, ACCESS, MAIN, CODE_DIRS };
