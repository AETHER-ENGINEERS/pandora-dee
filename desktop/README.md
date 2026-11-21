# Pandora Dee for the desktop

The Atelier in its own window, with her vault as a real folder on the computer instead of the browser's database.
Every note and file is an ordinary file in that folder, so bash (BusyBox, inside the app), a file manager, MCP file
tools and any other program all see the same files. `/Pandora/SOUL.md` in the vault is `<folder>/Pandora/SOUL.md`
on disk.

The page is the same one the browser opens (`dist/pandora-dee.html`). The browser keeps working as before, with its
vault in IndexedDB.

## Run it

```sh
npm run build          # in the repo root: dist/pandora-dee.html
cd desktop
npm install
npm run page           # copies ../dist/pandora-dee.html into desktop/app/
npm start
```

The first run asks for the vault's folder. A new, empty folder is fine: she starts with the sample vault there, or
with whatever you copy into it first. The choice is kept in the app's settings (`atelier.json` in Electron's
userData folder). **Vault → Use another folder…** changes it, and so does Config → App → Vault storage.

- `PANDORA_VAULT=<folder>` uses that folder without asking.
- `PANDORA_PAGE=<file.html>` opens another built page.

## Bringing her browser vault in

1. In the browser: Config → Backup → **Export everything**.
2. In the app: Config → Backup → import that file.
   - If the folder already has files, you're asked first. **OK** keeps them and adds the backup's files. Where a file
     is in both, the folder's version stays and the backup's is saved beside it, marked "from the browser".
     **Cancel** replaces them; the folder's files go to the trash folder.
   - Chats, schedules and settings come along. API keys come along only if the backup includes them.
3. The backup file stays where you saved it. The browser keeps its own copy too.

## How it works

`app/modules/vfs_disk.js` already runs the vault on a folder when the page has a disk bridge (the Android app gives
it one). Its calls are synchronous, because the vault reads a file the moment something asks for it. Here
`preload.cjs` offers the same bridge as `window.PandoraDesk`, and Electron's synchronous IPC answers each call from
`disk_host.cjs` in the main process. The page code runs unchanged, and nothing goes over the network.

`disk_host.cjs`:

- keeps every path inside the folder, and won't follow a link that leads out of it;
- writes each file atomically: a temporary file, renamed into place when its last piece arrives;
- moves anything deleted, and anything a full restore replaces, into a dated trash folder *beside* the vault
  (`<folder> (trash)`), so it doesn't show up in the vault and nothing is lost.

Tests: `tests/desktop_test.mjs`, in the repo's test run.
