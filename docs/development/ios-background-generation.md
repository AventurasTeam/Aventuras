# iOS background generation

A generation the user started keeps running when they switch apps or lock the phone, the way
Android's `GenerationForegroundService` does. It needs iOS 26 or later and a real device: the
simulator has no `BGTaskScheduler`.

Verified on an iPhone 16 Pro Max running iOS 27, with a development-signed build. iOS 26 itself was
not tested.

## 1. Why a native task is not enough

The whole narrator pipeline runs in the WebView's JavaScript: the LLM stream goes through
`@tauri-apps/plugin-http`, the SQLite writes are issued from JS, and each phase starts when the
previous one's response reaches the page. Android only has to keep the process and the WebView
alive (`GenerationForegroundService`, `RENDERER_PRIORITY_IMPORTANT`).

On iOS those are two different things. The app process and the WebKit content process that runs the
JS are separate, and iOS suspends the content process as soon as the page is hidden, whatever the
app process is allowed to do. Two pieces are therefore needed:

- **A `BGContinuedProcessingTask`** keeps the app process, and so the Rust side and the network,
  running, and shows the task in the Dynamic Island. By itself it does not keep the page running:
  without the audio loop below the page's timers stopped for 191 seconds after an app switch and
  resumed only on return.
- **An inaudible `<audio>` loop** gives WebKit a reason to keep the content process running. The
  `audio` background mode is what lets it play while the app is hidden.

## 2. Design

```
ActionInput.svelte ──▶ holdBackgroundKeepAlive()          utils/backgroundKeepAlive.ts
                          ├─ Android: AndroidBridge.startGenerationService()
                          └─ iOS: startSilentAudio()        utils/silentAudio.ts
                                  invoke('plugin:generation|start')
                                    └─ Swift: audio session, BGContinuedProcessingTaskRequest
   phase events ──────▶ setKeepAliveStage()  → Island text and progress
   last release ──────▶ idle callbacks (completion notification), then
                        invoke('plugin:generation|stop', { outcome }) → final Island message
   task expiration ───▶ native "interrupted" notification, then JS aborts the generation
```

### Native plugin

`src-tauri/plugins/generation` is a Tauri mobile plugin with three commands: `start`, `update` and
`stop`. It is registered on every platform and only does work on iOS.

- **Async commands.** The plugin waits for Swift's reply while Swift hops to the main thread, so a
  synchronous Rust command, which runs on the main thread, deadlocks the app.
- **One identifier per run.** `start` registers `<bundle id>.generation.<uuid>` and submits it with
  the `.fail` strategy. The plist lists `$(PRODUCT_BUNDLE_IDENTIFIER).generation.*`, and the
  identifier is built from the live bundle id, so it holds when a sideloader rewrites the id.
  Registering the wildcard itself fails.
- **Progress.** A continued-processing task has to report progress and may be expired if it
  stalls. Progress follows the pipeline's stages: 0 to 10% preparing, 10 to 70% writing, 70 to 90%
  updating the world, 90 to 99% finishing, and 100% only on success. Within a stage it creeps
  toward the ceiling so it never looks stuck. It cannot be exact, since generation time is not
  predictable.
- **Island text.** The subtitle follows the stage. When the task ends its title becomes "Story
  ready", "Generation failed", "Generation stopped" or "Generation interrupted", from the
  `outcome` that `stop` receives.
- **Audio session.** A playback session with `mixWithOthers`, re-activated after an interruption.
  The page's own audio plays in WebKit's separate session, so this one is not what keeps the page
  alive.
- **Expiry.** The expiration handler posts an "interrupted" notification itself, because the page
  may be suspended before JS can react, then tells JS to abort. It skips the notification while the
  app is active: `tauri-plugin-notification`'s `willPresent` force-unwraps its own lookup and
  crashes on a notification it did not create.

### Page side

- **Reference-counted keep-alive.** The turn holds the keep-alive; translation and the post-turn
  tasks (`runBackgroundTasks`) retain it, since they are started un-awaited and outlive the turn.
  The task stops when the last holder releases. A release from before an expiry cannot end the next
  run.
- **Outcome.** Each release can report `failed` or `stopped`; the worst one is the Island's final
  message.
- **Completion notification.** It is sent through `afterBackgroundKeepAlive`, once nothing holds
  the keep-alive and before the task stops, so it arrives with the Island's "Story ready". It is
  skipped when the OS ended the keep-alive (the Island's Stop button): the native side has already
  posted "interrupted", and the generation may still run to its end.
- **Audio loop.** `silentAudio.ts` plays one second of 16-bit audio at ±1 LSB, looped. An
  `<audio>` element is required: a Web Audio context is interrupted when the app is hidden. The
  element must stay unmuted at full volume, or WebKit does not count the page as playing audio. A
  `pause` listener restarts it, which is what survives another app (YouTube) taking the audio.
  The loop starts before the native call, so it is playing before the app can be hidden.
- **Expiry.** The page aborts through the existing `AbortController`; the turn ends through the
  same path as a lost connection.
- **Settings.** The background-generation section is shown on iOS and Android; the text differs.

### Configuration

- `tauri.ios.conf.json`: `minimumSystemVersion` is `26.0`. The shared web floor in
  [platform-support.md](platform-support.md) is unchanged, since Android and the desktop targets
  still set it.
- `Info.ios.plist`: `BGTaskSchedulerPermittedIdentifiers`, and `UIBackgroundModes` with
  `processing` and `audio`.

## 3. Build and test

- A Mac with Xcode, the iOS runtime, and the Rust targets `aarch64-apple-ios` and
  `aarch64-apple-ios-sim`. `tauri ios init` needs CocoaPods (`brew install cocoapods`).
- **Simulator.** Plugin registration, the settings UI and the flow up to the task. `start` fails
  there and the generation runs without a keep-alive.
- **Device.** Everything that depends on suspension. An Xcode-signed build installs with
  `xcrun devicectl device install app`; set `APPLE_DEVELOPMENT_TEAM` to the team id and pass
  `--export-method debugging`. Run `xcodegen generate` in `gen/apple` first if the project was last
  generated by `scripts/build-ios-unsigned.sh`, which leaves signing disabled in the generated
  project.
- **A second copy beside an installed one.** The data directory follows the bundle id, so a build
  with a different `identifier` (set through a `--config` file kept outside the repository) installs
  next to the existing app and starts with no data.
- **Logs from a sideloaded device.** `devicectl --console` and the unified log did not show the
  app's output. Writing to a file in `Documents` and copying it out worked:
  `xcrun devicectl device copy from --domain-type appDataContainer --domain-identifier <bundle id>
--source Documents/<file> --destination <path>`.

## 4. What the device showed

- **Task.** It registers, starts, shows in the Dynamic Island, and runs as long as the generation
  does, locked or not (ticks every 5 seconds for 8 minutes, no expiry). The permitted-identifier
  entry survives a sideloader appending the team id to the bundle id.
- **Switching apps, with the loop.** The page kept running at the throttled timer rate (heartbeats
  every 3 to 6 seconds) and the whole pipeline finished while hidden.
- **Another app's audio.** With YouTube playing, WebKit paused the element, the `pause` handler
  restarted it within 60 ms, and the generation completed.
- **Locking, with the loop.** The page kept running and the pipeline finished while locked, in
  three runs of 108 to 171 seconds. An earlier build that started the loop after the native call
  stalled on lock; the order is the only difference known, and it was not isolated.
- **Web Audio.** The context went `interrupted` 1.3 seconds after the app was hidden and the page
  was suspended.

Tried and not needed once the loop worked, all of which left the page suspended on their own:
turning off `WKPreferences` page-visibility process suppression and hidden-timer throttling at
runtime, silencing WebKit's `_applicationDidEnterBackground:` handler, and setting
`_alwaysRunsAtForegroundPriority` through a patched wry. Moving the post-narration steps into Rust
would also work, but the pipeline is about 5,000 lines on top of the AI layer, prompts, database and
stores, so it was not attempted.

## 5. Limits and unverified

- The loop is a workaround: it depends on WebKit keeping a page that plays audio alive. It costs
  some battery, which the settings text says.
- Timers in the hidden page run every 3 to 6 seconds, so anything short-timer driven is slower.
- iOS 26 behaviour, and Low Power Mode, were not tested.
- Whether `UIBackgroundModes: processing` is needed was never tested; it is set.
- The native "interrupted" notification was never triggered on a device.
- Work that starts after the keep-alive is released must retain it, as translation and the
  post-turn tasks do.
