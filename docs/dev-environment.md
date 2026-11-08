# Dev environment

How the development servers and the desktop dev app find their ports
and data, how several checkouts share one machine, and how to measure
on a release build on a physical Android device. The E2E suite
is not covered here: it binds dynamic ports and seeds its own temp
`userData` (see [testing.md](./testing.md#launch-modes)), so it needs
none of this.

## Dev slots

Every dev tool used to bind fixed ports, and the desktop dev app always
opened `~/.config/aventuras-dev`. That is fine for one checkout and
breaks for two: the second Metro fails to bind, and the second dev app
hits the single-instance lock or opens a DB whose migrations belong to
another branch. A **dev slot** is a numbered set of ports plus a
`userData` dir, one per checkout, so parallel worktrees (agent workers)
each get their own.

Slots are **off unless a machine opts in** through
`AVENTURAS_DEV_SLOT`:

| Value      | Effect                                                                                |
| ---------- | ------------------------------------------------------------------------------------- |
| unset / "" | Slot 0: the ports and `userData` the tooling always used.                             |
| `auto`     | A worktree claims a slot from 1 to 9 and keeps it; the main checkout stays on slot 0. |
| `0`-`9`    | That slot, with no claim. For manual use.                                             |

Leaving it unset keeps a developer machine unchanged: every worktree
shares slot 0 and the one dev DB, as before.

### What a slot owns

| Resource          | Slot 0                    | Slot N                                                |
| ----------------- | ------------------------- | ----------------------------------------------------- |
| Metro             | 8081                      | 8081 + N                                              |
| Electron DevTools | 9222                      | 9230 + N                                              |
| Storybook         | 6006                      | 6006 + N                                              |
| Mock LLM          | 4319                      | 4319 + N                                              |
| `userData`        | `~/.config/aventuras-dev` | `~/.config/aventuras-dev-slotN`                       |
| Android           | the attached device       | AVD `Aventuras_Slot_N`, serial `emulator-<5552 + 2N>` |

The `userData` paths are Linux's. `~/.config` stands for Electron's
app data directory, which is `$XDG_CONFIG_HOME` when that is set,
`~/Library/Application Support` on macOS and `%APPDATA%` on Windows.
Slot 0 lands where Electron puts the dev app by itself, so
`pnpm db:seed` and `pnpm db:studio:desktop` open the same database the
app does.

Metro's transform cache is not split: every checkout shares
`os.tmpdir()/metro-cache`. That is harmless for a worktree with its own
`node_modules`, and suspected of serving a stale route tree to one that
symlinks it; see
[a worktree with symlinked `node_modules` needs its own Metro cache](./implementation/lessons-learned/metro-cache-shared-across-worktrees.md).
Such a worktree also fails pnpm's dependency check on every `pnpm run`
or `pnpm exec`; see
[pnpm and patches](./code-conventions.md#pnpm-and-patches).

The DevTools port is what the `electron-app` MCP server attaches to:
`.mcp.json` points it at `AVENTURAS_DEVTOOLS_PORT`, defaulting to 9222,
so each worker's agent drives its own app. A tool that discovers apps
by scanning ports instead cannot do that — `electron-mcp-server`, which
this replaced, drove the first app it found, so a worker would have
clicked through another worker's app.

### Claiming

Under `auto`, a worktree claims the lowest free slot the first time
any slot-aware command runs, and records it in
`<git-common-dir>/aventuras-dev-slots/`, shared by every worktree of
the clone. The claim is keyed on the worktree path, so it survives
restarts. The main checkout never claims and stays on slot 0: it is
the machine's own working copy rather than a worker, and it is never
removed, so a claim would hold its slot for good. A slot whose
worktree has been removed, or deleted without git, is free again, and
handing it over **wipes its `userData`**: the last branch's DB may
carry migrations the next one does not know. Slot data is disposable;
`pnpm db:seed` refills it.

`pnpm dev:slot` claims and prints the slot (`--json` for a machine
reading). It also writes `.env.dev-slot.local` in the worktree
(gitignored), which exports `AVENTURAS_DEVTOOLS_PORT`,
`AVENTURAS_STORYBOOK_PORT` and, for worker slots, `ANDROID_SERIAL`.
A pinned slot writes the file too, replacing one an earlier claim
left. The repo's own scripts never read that file — they resolve the
slot from the worktree path — it exists for tools that only read the
environment: the MCP servers in `.mcp.json`, and `adb`.

### Slot-aware commands

- **`pnpm desktop`** — Expo web on the slot's Metro port and Electron
  loading it. A worker slot also passes its DevTools port and
  `userData`, and skips the detached DevTools window.
- **`pnpm start` / `pnpm web`** — Metro on the slot's port.
- **`pnpm dev:android`** — Metro on the slot's port, reusing one that
  `pnpm desktop` already runs there, so one debug APK serves every
  slot. Slot 0 reverses `8081` to the attached device (or
  `ANDROID_SERIAL` when several are attached), as before, and clears
  a worker slot's address left in the app by an earlier run on that
  device: that slot's reverse outlives its run, so the app would
  quietly load the worker's bundle. An address set by hand stays. A
  worker slot boots its own AVD headless (software rendering) when it
  is not running, reverses its Metro port, and stops the app to point
  it there through React Native's `debug_http_host` dev setting. The
  reverse alone is not enough on an emulator: the debug build asks
  `10.0.2.2:8081`, the host's loopback, which `adb reverse` never
  sees. The APK must already be installed.
- **`pnpm storybook`** — the slot's Storybook port.
- **`pnpm mock`** — the slot's mock LLM port, unless `--port` or
  `MOCK_LLM_PORT` says otherwise.
- **`pnpm db:seed`** — seeds the slot's DB, and in a worker slot points
  the seeded provider at the slot's mock LLM. An explicit path or
  `AVENTURAS_DB_PATH` bypasses the slot, which is how the E2E harness
  calls it. `pnpm db:seed:long` and `pnpm db:seed:dataset` seed the
  same way, and `pnpm dataset:export-seed` reads that same DB by default
  ([the dataset seed](./testing.md#the-dataset-seed)). Every seeded
  story declares the local embedder, and a fresh slot's userData holds
  no model, so a turn fails before its narrative call until one is
  there: install it from Settings → Embedding models, or copy
  `~/.cache/aventuras-e2e/embedders/<model>` (filled by an E2E run) into
  the slot's `userData/embedders/`.

### Setting up a worker machine

1. Set `AVENTURAS_DEV_SLOT=auto` in the environment agents run
   under, such as the service that hosts them.
2. Run `pnpm dev:slot` in the worktree setup hook, after
   `pnpm install`, so the env file exists before the agent starts.
3. Load `.env.dev-slot.local` into the agent's environment as the
   agent starts inside a worktree with `AVENTURAS_DEV_SLOT` set, for
   instance from a wrapper around the agent command; the agent hands
   it on to its MCP servers and shell commands. Reading it when the
   shell starts is not enough: a host can start the agent's shell
   before setup writes the file and launch the agent in it afterwards,
   as Orca does. A process without `AVENTURAS_DEV_SLOT`, such as an
   SSH login shell, runs the scripts on slot 0, and the file would
   point its tools at the worktree's claimed slot instead. Slots being
   off in one process says nothing about the worktree, so nothing
   deletes the file: the agent working there still needs it.
4. Create one AVD per slot you expect to use, named
   `Aventuras_Slot_N`.

## Measuring on a release build

A number that counts comes off a release APK on a physical device.
The AVDs here render in software, and a debug build carries Metro and
its dev checks. A release build refuses `run-as`, so the data goes in
through a debug install, and the release APK goes over it with
`adb install -r`, which keeps the app's files. Both APKs are built in
one checkout, so they share `android/app/debug.keystore`. On a personal
device this replaces whatever the app holds, so back its data up
first.

Set up the shell first. In a worker slot `.env.dev-slot.local` exports
`ANDROID_SERIAL` for the slot's AVD, and on slot 0 with an AVD running a
plain `adb` refuses with more than one device, so export the phone's
serial over it: every `adb` call below and `pnpm device:push-db` then
reach the phone.

```sh
export ANDROID_SERIAL=<phone serial>
export PATH="$HOME/Android/Sdk/platform-tools:$PATH" ANDROID_HOME="$HOME/Android/Sdk"
```

`android/` is git-ignored, so the cleartext edit stays local; release
needs it to reach the mock over `adb reverse`. The check prints `1`.
Without the edit a turn fails with `CLEARTEXT communication not
permitted` in logcat. The release APK embeds the JS, so any change to
temporary marks means rebuilding it.

```sh
pnpm expo prebuild --platform android --no-install
sed -i 's/<application android:name=".MainApplication"/<application android:usesCleartextTraffic="true" android:name=".MainApplication"/' android/app/src/main/AndroidManifest.xml
grep -c 'usesCleartextTraffic="true"' android/app/src/main/AndroidManifest.xml
(cd android && ./gradlew assembleDebug assembleRelease -PreactNativeArchitectures=arm64-v8a)
```

Write the fixture with `pnpm db:seed:long <file>`. A turn also needs
the story's local embedder model: without it the turn fails before the
narrative call, and the mock serves no embeddings. The fixture writes
its chapters with no vectors, marked stale, so the first turn after a
push embeds every chapter before its narrative call; time a turn after
that one. Fill the model cache
in `~/.cache/aventuras-e2e/embedders` from a file outside the worktree,
since `tsx -e` can't reach the export and stray files in the worktree
break the gates. It prints
`{"modelId":"Xenova/all-MiniLM-L6-v2","dim":384}`.

```sh
mkdir -p ~/.cache/aventuras-measure
cat > ~/.cache/aventuras-measure/ensure-model.ts <<EOF
import { ensureEmbedderModel } from '$PWD/e2e/harness/embedder'
void ensureEmbedderModel().then((model) => console.log(JSON.stringify(model)))
EOF
pnpm exec tsx ~/.cache/aventuras-measure/ensure-model.ts
```

Then install the debug APK and start it once, since
`pnpm device:push-db` expects an install that has run. With no Metro
running the debug app shows an error screen; nothing here needs its
JS. `run-as` can't traverse `/data/local/tmp`, so each model file is
pushed there and piped in. `pnpm device:push-db` replaces the app's
database and refuses to run without `ANDROID_SERIAL`.

```sh
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.aventuras.app/.MainActivity
sleep 5
adb shell am force-stop com.aventuras.app
adb shell run-as com.aventuras.app mkdir -p files/SQLite files/embedders/xenova--all-minilm-l6-v2
for f in model.onnx config.json tokenizer.json tokenizer_config.json meta.json; do
  adb push ~/.cache/aventuras-e2e/embedders/xenova--all-minilm-l6-v2/$f /data/local/tmp/$f
  adb shell "cat /data/local/tmp/$f | run-as com.aventuras.app sh -c 'cat > files/embedders/xenova--all-minilm-l6-v2/$f'"
  adb shell rm /data/local/tmp/$f
done
pnpm device:push-db <file>
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell run-as com.aventuras.app true
```

The last line should fail with `package not debuggable`, which shows
the measured build is the release one. `pnpm device:push-db` needs a
debuggable install, so redoing the fixture means reinstalling debug
first.

Point the app at the mock. A positional seed path keeps the provider
at 4319 on any slot, so force the port, and run the mock in its own
terminal. The reply and its stream rate are set per lane through the
mock's panel or control API
([mock-llm README](../scripts/mock-llm/README.md#lanes)).

```sh
MOCK_LLM_PORT=4319 pnpm mock
adb reverse tcp:4319 tcp:4319
```

Time inside the document, as
[the lesson on timing a WebView](./implementation/lessons-learned/webview-timing-needs-the-document.md)
explains. The host never waits for the WebView, since
each emission is a fire-and-forget `injectJavaScript`, so a host-side
time measures the mock. WebView console messages are dropped in
non-debug builds, so buffer marks in the document, stamp them with
`Date.now()`, and send them through a temporary callback once per run:
after a reply's final paint, and after each landing. The host logs them
in pieces of 3,000 characters to logcat as `ReactNativeJS`, because
Android cuts a long line. Clear the log with `adb logcat -c` before each
run, and read it with `adb logcat -d -s ReactNativeJS:V -v raw`. Don't
take a `uiautomator` dump during a timed run: it walks the whole window.
