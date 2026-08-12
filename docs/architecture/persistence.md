# Persistence

The database, the native layer that moves bytes around it, and the settings blob.

## Database and Migrations

- **Engine**: SQLite, accessed from the frontend via `@tauri-apps/plugin-sql` and from the Rust side via
  `sqlx` (see `tauri-plugin-sql` / `sqlx` in `src-tauri/Cargo.toml`).
- **Location**: `tauri-plugin-sql` resolves `sqlite:aventura.db` against Tauri's **app config dir**
  (`~/.config/<bundle-id>` on Linux), not the app data dir. Rust code that opens the same file
  directly — `backup.rs`, `avt_import.rs`, and the migration checksum patch in `lib.rs` — must use
  `app_config_dir()` for the same reason, or it silently operates on a database that does not exist.
- **Migrations**: Sequentially numbered SQL files in `src-tauri/migrations/` (e.g. `001_initial.sql`,
  `002_chapters_checkpoints.sql`, ...), applied in order at startup.
- **Line endings matter**: `sqlx` checksums each migration file to detect drift, so migrations must use LF
  line endings on every platform. This is enforced by `.gitattributes` (forces `eol=lf` for
  `src-tauri/migrations/*.sql`) and by the `check_migrations` pre-commit hook below.

## The Native (Rust) Layer

Most of the app is TypeScript; Rust owns the jobs that would otherwise blow up the WebView heap —
which on Android is a hard cap, not a soft one. The rule throughout is **JS owns the structure,
Rust owns the bytes**: only small parameters (paths, ids) cross the IPC bridge.

- **`backup.rs`** — database backup/restore and image export. Payloads are streamed file-to-file or
  DB-to-file and never enter the JS heap.
- **`avt_import.rs`** — `.avt` story import in two streaming passes. `avt_read_light` returns the
  JSON with every `imageData` stripped, JS parses that and runs the normal import (id remapping,
  ordering and foreign keys stay in TypeScript where they are tested), then `avt_import_images`
  re-reads the file and streams each base64 payload straight into SQLite. Peak memory is one image
  regardless of file size.
- **`migration_patch.rs`** — patches `sqlx`'s stored migration checksums (see
  [Database and Migrations](#database-and-migrations)).
- **`sync/`** — the LAN sync server (`start_sync_server`, `sync_connect`, `sync_pull_story`,
  `sync_push_story`, …), paired via QR code.

`backup.rs`, `avt_import.rs` and `migration_patch.rs` (via the `lib.rs` setup hook) open
`sqlite:aventura.db` under Tauri's **app config dir** — see the migrations section for why that is
not the app data dir. `sync/` never touches the database directly; it moves stories over the
`tauri-plugin-sql` connection on the JS side.

## Settings Migrations

Settings are persisted as one JSON blob, and nothing removes legacy keys from it. Reshaping runs on
the way from disk into the store, in `src/lib/stores/settingsMigrations.ts` — kept out of the rune
store precisely so it can be tested. A rename goes through here too: `recentEntriesForRetrieval`
became `recentEntriesForSuggestions`, because it named the one thing it does not drive — neither
retrieval service ever read it, `SuggestionsService` is its only consumer, and the slider was
already labelled "Plot Suggestions". Two properties every migration there must hold:

- **Idempotent**, because it runs on every load, not just the first after an upgrade. A migration
  that keeps firing silently reverts whatever the user changed in between.
- **Silent about untouched values**, because a stored value equal to the old default was never a
  choice, and carrying it across pins everyone who never opened the panel to a stale number.
