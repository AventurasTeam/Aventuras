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
- **Never `BEGIN` from the frontend**: `tauri-plugin-sql` runs every `execute()` on an arbitrary
  connection from an `sqlx` pool, and exposes no way to pin one (`Pool::connect` in the plugin's
  `wrapper.rs` takes no options). A `BEGIN` therefore opens a transaction that the following statements
  never join and the `COMMIT` never finds, while the connection that opened it keeps a write lock that
  turns every later write into `database is locked`. Prefer one statement that is atomic by itself — a
  multi-row `INSERT`, an `UPDATE ... WHERE`. When several statements must land together, send them as a
  batch to **`database.transaction()`**, which hands them to the `db_transaction` Rust command
  (`src-tauri/src/db_tx.rs`): one connection, a real transaction, rollback on the first error, and the
  rows affected by each statement back. Values travel as bound parameters — never interpolate into the
  SQL. Keep the SQL in `database.ts` rather than in components, as
  `deleteRuntimeVariableEverywhere` and its neighbours do.
- **Entity writes exist as statements too.** Each write method for characters, locations, items,
  story beats and lorebook entries has a `…Statement` builder beside it, so a write and the State
  Tracking record describing it can share one `database.transaction()`; `world_state_changes` takes
  its `seq` from a subquery in the same insert. See [state-tracking.md](state-tracking.md).
- **A read the batch depends on belongs inside it**, as a subquery. The runtime-variable writes reach
  their rows through `SELECT id FROM stories WHERE pack_id = ?` rather than resolving the ids first:
  the batch is atomic, the round trip that fed it was not, and a story assigned to the pack in
  between kept a variable the pack no longer had. `deleteBranch` does the same for the checkpoints
  the branch owns, and its subquery reads `story_entries`, which a later statement in the same batch
  deletes — so that statement's position in the list is load-bearing, not cosmetic.
- **Trait lists are normalized by `termKey`** (`uniqueTerms`) on write and on load: the `characters` and
  `character_vault` writers in `database.ts` dedupe, and the row mappers dedupe legacy rows.
  A stored or imported value that is not an array reads as `[]`, except `translated_traits`,
  which reads as `null` so the panel falls back to `traits`.
- **Lorebook aliases and keywords are normalized by `termKey`** (`utils/lorebookTerms.ts`) on write
  and on load: the `entries` and `lorebook_vault` writers in `database.ts` dedupe an entry's
  `aliases` and `injection.keywords` (the vault entry's `aliases` and `keywords`), and `mapEntry`,
  `getEntryPreviews` and `mapVaultLorebook` dedupe legacy rows. The story and vault stores run the
  same pass on what they keep in memory, including the vault's three import paths, and the lorebook
  file import returns the rows it stored with the pass applied, so the list on screen is the list
  that was stored. It is per list: a keyword that repeats the entry's name or an
  alias is the cleaner's and the merge's to drop, not the writers'. A stored `injection` that is not
  an object reads as the default, and vault `entries` that are not a list read as `[]`.
- **`stories.retry_state` is a JSON blob**, so fields are added inside it rather than by migration —
  `embeddedImageIds`, `characterSnapshots`, `timeTracker` and now `branchId` all arrived that way.
  `branchId` names the branch the snapshot was taken on, and a restore onto any other branch is
  refused. State written before it was recorded cannot be attributed to a branch, and is **discarded
  on load** rather than assumed to belong to main: the readers most likely to hold such state are
  precisely those whose last generation was on a branch, and restoring one branch's snapshot onto
  another deletes rows there. The cost is one lost cross-session retry per story; the next
  generation records an attributable snapshot and the ability returns.

## The Native (Rust) Layer

Most of the app is TypeScript; Rust owns the jobs that would otherwise blow up the WebView heap —
which on Android is a hard cap, not a soft one. The rule throughout is **JS owns the structure,
Rust owns the bytes**: only small parameters (paths, ids) cross the IPC bridge.

- **`backup.rs`** — database backup/restore and image export. Payloads are streamed file-to-file or
  DB-to-file and never enter the JS heap. Restore takes the open dialog's raw result: a path
  (desktop) is read directly, a `file://` URL (iOS) is opened with security-scoped access that is
  released afterwards, and a `content://` URI (Android) is copied to a temp file first because its
  descriptor is not reliably seekable. Restores are serialized.
- **`avt_import.rs`** — `.avt` story import in two streaming passes. `avt_read_light` returns the
  JSON with every `imageData` stripped, JS parses that and runs the normal import (id remapping,
  ordering and foreign keys stay in TypeScript where they are tested), then `avt_import_images`
  re-reads the file and streams each base64 payload straight into SQLite. Peak memory is one image
  regardless of file size.
- **`db.rs`** — where the live database is and how to open a writable pool to it. The one place
  that knows the filename and the busy_timeout; close what it hands back.
- **`db_tx.rs`** — the `db_transaction` command: a batch of statements on one connection, which is
  the only place a frontend transaction can come from (see the bullet above).
- **`migration_patch.rs`** — patches `sqlx`'s stored migration checksums (see
  [Database and Migrations](#database-and-migrations)).
- **`sync/`** — the LAN sync server (`start_sync_server`, `sync_connect`, `sync_pull_story`,
  `sync_push_story`, …), paired via QR code.

`db.rs` (for `avt_import.rs`, `db_tx.rs` and `backup.rs`) and `migration_patch.rs` (via the
`lib.rs` setup hook) open `sqlite:aventura.db` under Tauri's **app config dir** — see the
migrations section for why that is not the app data dir. `sync/` never touches the database directly; it moves stories over the
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

## Story Settings

A story's settings are a JSON column, read through `mapStory`, which passes them through
`readStorySettings` in `src/lib/utils/storySettings.ts`. An image mode that is not a current value
(older versions saved `'auto'`) is dropped there, so the story reads as having no mode chosen: it
generates as Text Only, and Story Settings selects nothing and says so until a mode is picked.
Nothing is written back, so an older export or sync payload is handled the same way whenever it
arrives.
