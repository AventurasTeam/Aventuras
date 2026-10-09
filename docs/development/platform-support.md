# Platform support

The minimum each platform needs, and the rule for keeping new code inside it.

**Every number here is derived from documentation and source. None of it has been tested on a
device at the floor version.** Nothing in the build or at runtime enforces it yet — see
[Known gaps](#known-gaps).

The floor is the WebView the app runs in: **Chrome 111 / Safari 16.4**, both released March 2023
([Tailwind compatibility](https://tailwindcss.com/docs/compatibility)).

## What sets the floor

- **Tailwind CSS v4** (installed 4.3.3) depends on Chrome 111 and Safari 16.4
  ([compatibility](https://tailwindcss.com/docs/compatibility)). The page states the list for v4.0
  and gives none for later 4.x releases.
- **Vite 8.2** lowers syntax to its default `build.target`, `baseline-widely-available`. Vite 8.2.0
  resolves that to `chrome111`, `edge111`, `firefox114`, `safari16.4` and `ios16.4`
  ([build options](https://vite.dev/config/build-options)). Neither `vite.config.js` nor SvelteKit
  overrides it for the client bundle (SvelteKit sets a target only for SSR).
- **Vite adds no polyfills.** "By default, Vite only handles syntax transforms and does not cover
  polyfills" ([building for production](https://vite.dev/guide/build)). A newer API than the floor
  works on a current dev machine and throws on a device at the floor.
- **TypeScript will not catch it.** The generated `.svelte-kit/tsconfig.json` sets `target` and
  `lib` to `esnext` (plus `DOM`), so `check` accepts any API the installed TypeScript knows.

**Rule.** Before using a JS, CSS or Web API, confirm on MDN that it works in Chrome 111 and Safari
16.4 or earlier. `Array.prototype.toReversed` passes: Chrome 110, Safari 16
([MDN compat data](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/Array.json)).

## Per platform

| Platform | Engine                        | Minimum                                                        |
| -------- | ----------------------------- | -------------------------------------------------------------- |
| Windows  | WebView2 (evergreen)          | Runtime 111 or later; Windows 10 or later                      |
| macOS    | system WKWebView              | Safari 16.4's WebKit; macOS 13.3 or later                      |
| Linux    | WebKitGTK `webkit2gtk-4.1`    | 2.40 or later (`.deb`/`.rpm`); the AppImage carries its own    |
| Android  | System WebView (Chromium)     | WebView 111 or later; `minSdk` 26 (Android 8)                  |
| iOS      | system WKWebView              | iOS 16.4 or later                                              |

### Windows

WebView2 111 or later, which means Windows 10 or later. Windows 7, 8 and 8.1 stopped at WebView2 109
([Microsoft, Dec 2022](https://blogs.windows.com/msedgedev/2022/12/09/microsoft-edge-and-webview2-ending-support-for-windows-7-and-windows-8-8-1/)).
The Tauri installer makes sure WebView2 is present, and the runtime updates itself
([Tauri webview versions](https://v2.tauri.app/reference/webview-versions/)). A machine that
cannot update its runtime can still sit below 111.

### macOS

The system WKWebView must carry Safari 16.4's WebKit. Tauri's table pairs macOS 13.3 with Safari
16.4 ([Tauri webview versions](https://v2.tauri.app/reference/webview-versions/)), and Safari 16.4
was released for macOS Ventura, Monterey and Big Sur
([WebKit blog](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)).

- **macOS 13.3 or later** is the clean floor.
- **Big Sur and Monterey** should qualify once Safari 16.4 or later is installed. That is an
  inference: it assumes the Safari update also updates the WebKit other apps use, which was not
  checked.
- **Catalina (10.15) and older** are not offered Safari 16.4, so they cannot reach the floor.
  "Unsupported macOS versions do not receive WebKit updates" (Tauri page above).

### Linux

The `.deb` and `.rpm` use the system's `webkit2gtk-4.1` and declare no minimum version
([Tauri Debian docs](https://v2.tauri.app/distribute/debian/)). The floor is **WebKitGTK 2.40**.

- webkitgtk.org publishes no WebKitGTK-to-Safari mapping, so this comes from the WebKit source. The
  `webkitgtk-2.38.x` tags are cut from WebKit 615.1.1
  ([`webkitgtk-2.38.6`](https://github.com/WebKit/WebKit/blob/webkitgtk-2.38.6/Source/WebKit/Configurations/Version.xcconfig)).
  `webkitgtk-2.40.0` is cut from 616.1.2
  ([`webkitgtk-2.40.0`](https://github.com/WebKit/WebKit/blob/webkitgtk-2.40.0/Configurations/Version.xcconfig)).
  Safari 16.4 is 615.1.26 (macOS 13.3 row of [Tauri's table](https://v2.tauri.app/reference/webview-versions/)).
  So 2.40 is the first series at or past Safari 16.4's engine. That compares version numbers; it is
  not a feature audit.
- **Do not use [Tauri's Linux table](https://v2.tauri.app/reference/webview-versions/).** It lists
  2.36 for Ubuntu 22.04, which now gets 2.50.x through
  `jammy-security` ([Ubuntu changes](https://lists.ubuntu.com/archives/jammy-changes/2025-November/043026.html),
  [Launchpad](https://launchpad.net/ubuntu/jammy/+source/webkit2gtk)).
- **The AppImage bundles its own WebKitGTK.** Listing the
  [v0.7.11 AppImage](https://github.com/AventurasTeam/Aventuras/releases/tag/v0.7.11) shows
  `libwebkit2gtk-4.1.so.0` (about 90 MB) and `libjavascriptcoregtk-4.1.so.0` inside it. It is built
  in the `ubuntu:22.04` container, so its engine is whatever `jammy-security` carried on the build
  date and does not depend on the user's distro. It still needs the host's glibc 2.35
  ([release.md](release.md#runner-pinning)).

### Android

Android System WebView 111 or later. `minSdk` is 26
(`src-tauri/gen/android/app/build.gradle.kts`), which is Android 8.0
([API levels](https://developer.android.com/tools/releases/platforms)).

The floor depends on the WebView version, not the Android version: Tauri uses the device's WebView
provider and bundles none ([Tauri webview versions](https://v2.tauri.app/reference/webview-versions/)).
Devices that update WebView through Play are fine. Devices without Play, or with an outdated
provider, fall below the floor, and nothing checks for this at runtime.

### iOS

iOS 16.4 or later. WKWebView is tied to the OS, and Safari 16.4's WebKit shipped in iOS 16.4
([WebKit blog](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)); Vite's default
target names `ios16.4` too. The `.ipa` is unsigned and built best-effort
([release.md](release.md), [ios-build-target.md](ios-build-target.md)).

## Known gaps

Enforcing the floor is a separate change.

- `tauri.conf.json` sets no minimum OS versions, so Tauri's defaults apply. macOS defaults to 10.13
  ([config reference](https://v2.tauri.app/reference/config/)), and the release workflow pins its
  macOS runner to keep it ([release.md](release.md#runner-pinning)).
- iOS has no committed scaffold, and CI runs `tauri ios init` on every build
  ([ios-build-target.md](ios-build-target.md)), so the deployment target is Tauri's default. The
  installed CLI (2.11.4) schema, `node_modules/@tauri-apps/cli/config.schema.json`, gives a default
  of `14.0` but describes it as `13.0`; the [docs](https://v2.tauri.app/reference/config/) for a
  newer release say `15.0`. Every one of them is below 16.4.
- There is no `minimumWebview2Version` (it defaults to `null`) and no Android WebView check.

So a device below the floor installs the app and shows broken styling.
