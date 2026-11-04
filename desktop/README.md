# DWIM TV for Windows, Mac and Linux

A desktop app (Electron) that opens **DWIM TV** in its own window with a menu for Live TV, TV Guide, On Demand and Songs & Playlists. Built by **Ntandomods**, Zimbabwe.

| System | Download |
|---|---|
| Windows 10/11 | [DWIM-TV-Setup.exe](https://github.com/xofcntando/dwim-tv/releases/download/desktop-latest/DWIM-TV-Setup.exe) |
| Mac (Intel and Apple Silicon) | [DWIM-TV.dmg](https://github.com/xofcntando/dwim-tv/releases/download/desktop-latest/DWIM-TV.dmg) |
| Linux | [DWIM-TV.AppImage](https://github.com/xofcntando/dwim-tv/releases/download/desktop-latest/DWIM-TV.AppImage) |

## Install

- **Windows:** run the installer. If Windows SmartScreen warns about an unknown publisher, click **More info**, then **Run anyway** (the app is not code-signed yet). A DWIM TV icon appears on the desktop.
- **Mac:** open the DMG and drag DWIM TV to Applications. The first time, right-click the app, choose **Open**, then **Open** again (the app is not notarized yet).
- **Linux:** make the file executable (`chmod +x DWIM-TV.AppImage`) and double-click it.

## How it works

- It loads `https://dwim-tv.onrender.com`, so new videos, playlists and films appear at once. Nothing needs reinstalling for new content.
- Press **F11** for full screen. Press **Ctrl+R** to reload. Links to other websites open in your normal browser.
- If the internet is down it shows a "Try again" page.

## Build it yourself

The GitHub Action **Build desktop apps** builds all three installers and publishes them to the `desktop-latest` release. Run it from **Actions > Build desktop apps > Run workflow**. Locally: `cd desktop && npm install && npm start`.

## Code signing (optional)

Without signing, Windows and Mac show a warning on first run. To remove it, buy a code-signing certificate (Windows) and an Apple Developer account (Mac), and add them to the workflow as GitHub secrets.
