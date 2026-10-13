# Platform support: evidence

The sources behind the floor and the per-platform minimums in
[platform-support.md](platform-support.md). Every number here is derived from documentation and
source. None of it has been tested on a device at the floor version.

## What sets the floor

- **Tailwind CSS v4** (installed 4.3.3) depends on Chrome 111 and Safari 16.4
  ([compatibility](https://tailwindcss.com/docs/compatibility)). The page states the list for v4.0
  and gives none for later 4.x releases.
- **Vite 8.2** lowers syntax to its default `build.target`, `baseline-widely-available`. Vite 8.2.0
  resolves that to `chrome111`, `edge111`, `firefox114`, `safari16.4` and `ios16.4`
  ([build options](https://vite.dev/config/build-options)). Neither `vite.config.js` nor SvelteKit
  overrides it for the client bundle (SvelteKit sets a target only for SSR).
- **Vite adds no polyfills.** "By default, Vite only handles syntax transforms and does not cover
  polyfills" ([building for production](https://vite.dev/guide/build)).
- **TypeScript will not catch it.** The generated `$app/tsconfig` that `tsconfig.json` extends
  sets `target` and `lib` to `esnext` (plus `DOM`), so `check` accepts any API the installed
  TypeScript knows.

Both Chrome 111 and Safari 16.4 were released in March 2023. The example in the rule,
`Array.prototype.toReversed` (Chrome 110, Safari 16), is from
[MDN compat data](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/Array.json).

## Windows

Windows 7, 8 and 8.1 stopped at WebView2 109
([Microsoft, Dec 2022](https://blogs.windows.com/msedgedev/2022/12/09/microsoft-edge-and-webview2-ending-support-for-windows-7-and-windows-8-8-1/)).
The Tauri installer makes sure WebView2 is present, and the runtime updates itself
([Tauri webview versions](https://v2.tauri.app/reference/webview-versions/)).

## macOS

Tauri's table pairs macOS 13.3 with Safari 16.4
([Tauri webview versions](https://v2.tauri.app/reference/webview-versions/)), and Safari 16.4 was
released for macOS Ventura, Monterey and Big Sur
([WebKit blog](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)).

- That Big Sur and Monterey qualify with Safari 16.4 installed is an inference: it assumes the
  Safari update also updates the WebKit other apps use, which was not checked.
- Catalina (10.15) and older are not offered Safari 16.4. "Unsupported macOS versions do not
  receive WebKit updates" (Tauri page above).
- `tauri.conf.json` sets no minimum macOS version, so Tauri's default of 10.13 applies
  ([config reference](https://v2.tauri.app/reference/config/)).

## Linux

The `.deb` and `.rpm` use the system's `webkit2gtk-4.1` and declare no minimum version
([Tauri Debian docs](https://v2.tauri.app/distribute/debian/)).

- webkitgtk.org publishes no WebKitGTK-to-Safari mapping, so the 2.40 floor comes from the WebKit
  source. The `webkitgtk-2.38.x` tags are cut from WebKit 615.1.1
  ([`webkitgtk-2.38.6`](https://github.com/WebKit/WebKit/blob/webkitgtk-2.38.6/Source/WebKit/Configurations/Version.xcconfig)).
  `webkitgtk-2.40.0` is cut from 616.1.2
  ([`webkitgtk-2.40.0`](https://github.com/WebKit/WebKit/blob/webkitgtk-2.40.0/Configurations/Version.xcconfig)).
  Safari 16.4 is 615.1.26 (macOS 13.3 row of [Tauri's table](https://v2.tauri.app/reference/webview-versions/)).
  So 2.40 is the first series at or past Safari 16.4's engine. That compares version numbers; it is
  not a feature audit.
- [Tauri's Linux table](https://v2.tauri.app/reference/webview-versions/) is stale. It lists 2.36
  for Ubuntu 22.04, which now gets 2.50.x through `jammy-security`
  ([Ubuntu changes](https://lists.ubuntu.com/archives/jammy-changes/2025-November/043026.html),
  [Launchpad](https://launchpad.net/ubuntu/jammy/+source/webkit2gtk)).
- Listing the [v0.7.11 AppImage](https://github.com/AventurasTeam/Aventuras/releases/tag/v0.7.11)
  shows `libwebkit2gtk-4.1.so.0` (about 90 MB) and `libjavascriptcoregtk-4.1.so.0` inside it. It
  is built in the `ubuntu:22.04` container, so its engine is whatever `jammy-security` carried on
  the build date.

## Android

`minSdk` 26 (`src-tauri/gen/android/app/build.gradle.kts`) is Android 8.0
([API levels](https://developer.android.com/tools/releases/platforms)). Tauri uses the device's
WebView provider and bundles none
([Tauri webview versions](https://v2.tauri.app/reference/webview-versions/)).

## iOS

WKWebView is tied to the OS, and Safari 16.4's WebKit shipped in iOS 16.4
([WebKit blog](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)); Vite's default
target names `ios16.4` too.
