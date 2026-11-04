# DWIM TV for Android TV (and phones/tablets)

A small native Android app (Java, no extra libraries) that opens **DWIM TV** full screen in TV mode with remote-control support. It shows up in the Android TV launcher with the DWIM TV banner. Built by **Ntandomods**, Zimbabwe.

- Loads `https://dwim-tv.onrender.com/?tv=1`, so every update to the website appears in the app at once. No new APK is needed for new videos, playlists or films.
- D-pad / remote: arrows, OK and Back go straight to the web app.
- Live TV starts by itself (no tap needed), the screen stays awake, offline screen with a Try again button.
- Package id: `tv.dwim.app`. To point the app at another address, change `HOST` in `app/src/main/java/tv/dwim/app/MainActivity.java`.

**[⬇ Download DWIM-TV.apk](https://github.com/xofcntando/dwim-tv/releases/download/android-tv-latest/DWIM-TV.apk)**

## Get the APK (no Android Studio needed)

1. On GitHub open the repo, **Actions**, **Build Android TV app**, **Run workflow**. (It also runs when anything in `android-tv/` changes.)
2. After about 5 minutes the file `DWIM-TV.apk` is under **Releases** (`android-tv-latest`) and in the run's **Artifacts**.

## Install on an Android TV / Google TV / Fire TV

1. Put `DWIM-TV.apk` on a USB stick, or use the free **Downloader** app on the TV and type the release link.
2. Allow "Install unknown apps" for that app when the TV asks.
3. Open the APK and install. DWIM TV appears in your apps row.

## Google Play Store (optional)

The workflow signs with the debug key, which is fine for sideloading. For Play you need a Google Play developer account, your own release keystore (store it as GitHub secrets and add a `signingConfigs.release` block in `app/build.gradle`), an app bundle (`bundleRelease`) and screenshots. Increase `versionCode` for every upload.

## Apple TV

tvOS has no web view, so a web wrapper is not possible. Apple TV owners can use **AirPlay** from the DWIM TV website (Safari on iPhone or Mac) or the Smart TV browser. A native tvOS app would be a separate Swift project that plays HLS or YouTube streams.
