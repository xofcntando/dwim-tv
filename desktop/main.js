/* DWIM TV desktop app (Windows, Mac, Linux).
   Opens https://dwim-tv.onrender.com in its own window, so every new video, playlist
   and film appears at once without reinstalling.
   Designed and built in Zimbabwe by Ntandomods. */
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');

const HOST = 'dwim-tv.onrender.com';
const URL_HOME = `https://${HOST}/`;

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;

// YouTube players behave best with a normal Chrome identity (no "Electron" in the user agent)
function cleanUA() {
  return app.userAgentFallback.replace(/\s?Electron\/[\d.]+/, '').replace(new RegExp(`\\s?${app.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/[\\d.]+`), '');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 420, minHeight: 600,
    backgroundColor: '#070b18',
    title: 'DWIM TV',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: 'no-user-gesture-required', spellcheck: false }
  });
  win.webContents.setUserAgent(cleanUA());
  win.loadURL(URL_HOME);

  // links to other websites open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    try { if (new URL(url).hostname === HOST) return { action: 'allow' }; } catch (e) { /* ignore */ }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    try { if (new URL(url).hostname !== HOST && !url.startsWith('file://')) { e.preventDefault(); shell.openExternal(url); } } catch (err) { /* ignore */ }
  });
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'));
  });
  win.on('closed', () => { win = null; });
}

function about() {
  dialog.showMessageBox(win, {
    type: 'info', title: 'About DWIM TV', message: 'DWIM TV',
    detail: `Destiny Word International Ministries\nDistance is not a barrier.\n\nVersion ${app.getVersion()}\nDesigned and built in Zimbabwe by Ntandomods.`
  });
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'DWIM TV', submenu: [
      { label: 'Home', accelerator: 'CmdOrCtrl+H', click: () => win && win.loadURL(URL_HOME) },
      { label: 'Live TV', click: () => win && win.loadURL(URL_HOME + '#/live') },
      { label: 'TV Guide', click: () => win && win.loadURL(URL_HOME + '#/guide') },
      { label: 'On Demand', click: () => win && win.loadURL(URL_HOME + '#/ondemand') },
      { label: 'Songs & Playlists', click: () => win && win.loadURL(URL_HOME + '#/songs') },
      { type: 'separator' },
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win && win.webContents.reload() },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      { label: 'About DWIM TV', click: about },
      { role: 'quit' }
    ] },
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ]));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  buildMenu(); createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
