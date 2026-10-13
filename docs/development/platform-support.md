# Platform support

The app runs in each platform's WebView, and the oldest WebView it supports sets what new code may
use: **Chrome 111 / Safari 16.4**.

These numbers are derived from documentation and source, not tested on a device at the floor. The
sources for each one are in [platform-support-evidence.md](platform-support-evidence.md).

## The rule

Before using a JS, CSS or Web API, confirm on MDN that it works in Chrome 111 and Safari 16.4 or
earlier. `Array.prototype.toReversed` passes: Chrome 110, Safari 16.

Nothing else catches it. Vite lowers syntax to the floor but adds no polyfills, and `check`
accepts any API the installed TypeScript knows, so a newer API works on a current dev machine and
throws on a device at the floor.

Current but not usable yet, per MDN: the `popover` attribute, `text-wrap: balance`, subgrid,
`@starting-style`, `Object.groupBy`, `Promise.withResolvers`, and the `Set` composition methods
(`union`, `intersection`, …).

## What sets the floor

Tailwind CSS v4 needs Chrome 111 and Safari 16.4, and Vite's default `build.target` resolves to the
same versions. When upgrading either, check whether its target moved.

## Per platform

| Platform | Engine                     | Minimum                                                     |
| -------- | -------------------------- | ----------------------------------------------------------- |
| Windows  | WebView2 (evergreen)       | Runtime 111 or later; Windows 10 or later                   |
| macOS    | system WKWebView           | Safari 16.4's WebKit; macOS 13.3 or later                   |
| Linux    | WebKitGTK `webkit2gtk-4.1` | 2.40 or later (`.deb`/`.rpm`); the AppImage carries its own |
| Android  | System WebView (Chromium)  | WebView 111 or later; `minSdk` 26 (Android 8)               |
| iOS      | system WKWebView           | iOS 16.4 or later                                           |

The install table in the [repository README](../../README.md) repeats these minimums; change both
together.

- **Windows**: the WebView2 runtime updates itself, but a machine that cannot update it can still
  sit below 111.
- **macOS**: 13.3 is the clean floor. Big Sur and Monterey should qualify once Safari 16.4 or later
  is installed; Catalina and older cannot reach the floor.
- **Linux**: the `.deb` and `.rpm` use the system's WebKitGTK and declare no minimum. Do not read
  distro versions off Tauri's Linux table; it is stale. The AppImage bundles its own WebKitGTK and
  needs the host's glibc 2.35 ([release.md](release.md#runner-pinning)).
- **Android**: the floor is the WebView version, not the Android version. Devices that update
  WebView through Play are fine; devices without Play, or with an outdated provider, fall below it.
- **iOS**: `src-tauri/tauri.ios.conf.json` sets `bundle.iOS.minimumSystemVersion` to 16.4. The
  `.ipa` is unsigned and built best-effort ([release.md](release.md#building-ios)).

## Not enforced yet

Enforcing the floor is a separate change.

- `tauri.conf.json` sets no minimum macOS version, so Tauri's default (10.13) applies, and the
  release workflow pins its macOS runner to keep it ([release.md](release.md#runner-pinning)).
- There is no `minimumWebview2Version` (it defaults to `null`) and no Android WebView check.

So a device below the floor installs the app and shows broken styling.
