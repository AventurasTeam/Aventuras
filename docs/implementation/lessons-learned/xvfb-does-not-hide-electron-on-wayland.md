# Xvfb does not hide Electron on a Wayland session

Running the E2E suite under `xvfb-run` is the standard way to keep
Electron windows off the developer's screen, and it is what CI does.
On a Wayland desktop it silently does nothing: the app window and the
detached DevTools window still open, still take focus, and still make
the machine unusable for the length of the run.

## Why

`xvfb-run` communicates exactly one thing to its child: `DISPLAY`.
That is sufficient for an X11 client, but Electron on a Wayland
session selects the Wayland ozone backend and connects to the
compositor, at which point `DISPLAY` is irrelevant. Xvfb starts,
accepts the connection that never comes, and sits empty while the
window opens on the real screen.

Two plausible-looking env-var fixes do not work:

- **`ELECTRON_OZONE_PLATFORM_HINT=x11`** has no effect here. The
  backend must be pinned from the command line.
- **Clearing `WAYLAND_DISPLAY`** does not help either — Wayland
  clients fall back to the default `wayland-0` socket in
  `XDG_RUNTIME_DIR` when the variable is unset.

The fix is the switch, passed at `electron.launch`:

```ts
const ozoneArgs = process.env.E2E_VIRTUAL_DISPLAY === '1' ? ['--ozone-platform=x11'] : []
```

`scripts/e2e.ts` supplies the virtual display and sets the variable;
`e2e/harness/launch.ts` adds the switch. Both halves are load-bearing
— neither hides anything on its own.

Note that `--ozone-platform=headless` is not an alternative: it
segfaults in the GLX stack on Electron 41, with or without
`--disable-gpu`. A real X server is the only option on Linux.

## The verification trap

This bug is easy to declare fixed while it is fully present, because
the obvious check passes. `pgrep Xvfb` shows the virtual server
running with the requested screen args, and the suite goes green —
neither fact says anything about where the window rendered.

The checks that actually discriminate:

- **Display fingerprint.** `screen.getPrimaryDisplay().size` inside
  the app reports the developer's real monitor geometry when the bug
  is present, and the Xvfb screen size when it is not. Pick a virtual
  screen size that differs from the real monitors so the two can never
  be confused.
- **Enumerate windows on the virtual display.** During a run,
  `DISPLAY=:99 xdotool search --name '.*'` should list the 1280x800
  `Aventuras` window and the 800x600 `Developer Tools` window. Only
  the 1920x1080 root window means nothing is rendering there.

Note that `xdotool` on the session's Xwayland display will **not**
find the leaked window either — it is a native Wayland surface, so it
is invisible to X tooling on both displays while being plainly visible
to the human. "Not found on either display" is a positive result for
the bug, not evidence against it.

## How to apply

When a fix's purpose is to change _where_ something renders, verify
the destination, not the mechanism. That a redirector is running is a
statement about the redirector; the claim under test is about the
thing being redirected, and on Wayland those two come apart
completely. The same shape applies to any sandbox, container, or
proxy layer that a client can decline to use — ask what the client
would do if it ignored the layer entirely, then check that it didn't.
