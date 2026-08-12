# Aventuras

Interactive fiction with an AI that remembers. Play a text adventure or write collaboratively,
on desktop and Android, with any LLM provider you like — cloud or running on your own machine.

Aventuras keeps the story straight: chapters are summarized as you play, a lorebook feeds the
right entries into the right scene, an agent tidies that lorebook behind you, and the world
state — who is present, where you are, what you carry — is tracked turn by turn.

## Highlights

- **Two modes** — Adventure, with multiple-choice actions and world tracking; Creative Writing,
  freeform with AI suggestions. First/second/third person, past or present tense.
- **Any provider** — OpenRouter, OpenAI, Anthropic, Google, xAI, Groq, DeepSeek, Mistral, Z.AI,
  NanoGPT, Chutes, Pollinations, NVIDIA NIM, plus local llama.cpp, LM Studio and Ollama.
  Streaming, extended thinking, and per-subsystem **Agent Profiles** so retrieval, classification
  and narration can each use a different model.
- **Memory that scales** — automatic chapter summarization, and a retrieval step that goes and
  finds what the current scene needs from everything that came before.
- **Lorebook** — characters, locations, items, factions, concepts and events, with aliases,
  secrets, keyword and relevance-based injection, SillyTavern import, and an autonomous agent
  that consolidates duplicates and fills gaps.
- **The Vault** — a cross-story library of reusable characters, lorebooks and scenarios, with a
  tool-calling assistant that edits them and shows you a diff before anything lands.
- **Every prompt is editable** — they are Liquid templates, all of them, in an in-app editor.
- **Images** — inline `<pic>` illustrations, scene backgrounds and character portraits, across
  nine backends including local ComfyUI and A1111.
- **Writing tools** — local grammar checking (Harper/WASM), style analysis for repetition,
  suggestions that match how you write.
- **Yours to keep** — SQLite on your machine, full backup/restore, `.avt` story export, LAN sync
  between devices over QR pairing, and an optional translation layer over the whole app.
- **26 themes**, adjustable text size, dialogue highlighting.

## Install

Pre-built binaries are on the [Releases](https://github.com/AventurasTeam/Aventuras/releases) page:

| Platform | Download                                  |
| -------- | ----------------------------------------- |
| Windows  | `aventuras_x.x.x_x64-setup.exe`           |
| macOS    | `aventuras_x.x.x_x64.dmg`                 |
| Linux    | `aventuras_x.x.x_amd64.deb` / `.AppImage` |
| Android  | `aventuras-release.apk`                   |

No API keys in config files — providers are set up in the app, under Settings → API Settings.

## Build from source

Requires Node.js 22+, the latest stable Rust, and (for Android) the Android SDK, NDK r27 and
JDK 17–24.

```bash
git clone https://github.com/AventurasTeam/Aventuras.git
cd Aventuras
npm install
npx tauri dev
```

| Script            | Does                            |
| ----------------- | ------------------------------- |
| `npm run dev`     | Vite dev server (frontend only) |
| `npx tauri dev`   | full app, with hot reload       |
| `npm run build`   | production build                |
| `npm run check`   | type checking (`svelte-check`)  |
| `npm test`        | test suite (Vitest)             |
| `npm run lint`    | ESLint — `lint:fix` to fix      |
| `npm run format`  | Prettier                        |
| `npm run release` | version bump, tag and push      |

Desktop builds are `npx tauri build`; Android is documented in
[docs/development/release.md](docs/development/release.md).

## Tech stack

TypeScript (strict) · SvelteKit 2 · Svelte 5 runes · Tauri 2 (Rust) · Tailwind + shadcn-svelte ·
SQLite (`tauri-plugin-sql` / `sqlx`) · Vercel AI SDK · LiquidJS · CodeMirror 6 · Zod ·
Harper.js (WASM) · Vitest

## Contributing

Start with [docs/](docs/README.md) — the architecture is documented per area, and
[CLAUDE.md](CLAUDE.md) has the conventions. CI runs build, lint and type-check on every PR
against `master`, `develop` or `dev`.

## Acknowledgments

[Tauri](https://tauri.app/) · [SvelteKit](https://kit.svelte.dev/) ·
[OpenRouter](https://openrouter.ai/) · [Harper](https://writewithharper.com/) ·
[Lucide](https://lucide.dev/)

## License

AGPL-3.0
