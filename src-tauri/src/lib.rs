use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

mod migration_patch;
mod sync;

use sync::commands::{
    clear_received_stories, get_received_stories, start_sync_server, stop_sync_server,
    sync_connect, sync_pull_story, sync_push_story,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: include_str!("../migrations/001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_chapters_checkpoints_mode",
            sql: include_str!("../migrations/002_chapters_checkpoints.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_entries_lorebook",
            sql: include_str!("../migrations/003_entries.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_entry_lore_blacklist",
            sql: include_str!("../migrations/004_entry_lore_blacklist.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_story_beats_resolved_at",
            sql: include_str!("../migrations/005_story_beats_resolved_at.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add_story_retry_state",
            sql: include_str!("../migrations/006_story_retry_state.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add_story_style_review_state",
            sql: include_str!("../migrations/007_story_style_review_state.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add_story_time_tracker",
            sql: include_str!("../migrations/008_story_time_tracker.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add_checkpoint_time_tracker",
            sql: include_str!("../migrations/009_checkpoint_time_tracker.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "add_chapter_time_fields",
            sql: include_str!("../migrations/010_chapter_time_fields.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "add_image_generation",
            sql: include_str!("../migrations/011_image_generation.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "add_character_portraits",
            sql: include_str!("../migrations/012_character_portraits.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "add_branches",
            sql: include_str!("../migrations/013_branches.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "fix_branch_fk",
            sql: include_str!("../migrations/014_fix_branch_fk.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "branch_world_state",
            sql: include_str!("../migrations/015_branch_world_state.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "character_vault",
            sql: include_str!("../migrations/016_character_vault.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "lorebook_vault",
            sql: include_str!("../migrations/017_lorebook_vault.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "scenario_vault",
            sql: include_str!("../migrations/018_scenario_vault.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "entry_reasoning",
            sql: include_str!("../migrations/019_entry_reasoning.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "migrate_legacy_prompts",
            sql: include_str!("../migrations/020_migrate_legacy_prompts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "translation",
            sql: include_str!("../migrations/021_translation.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "vault_tags",
            sql: include_str!("../migrations/022_vault_tags.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "simplify_character_vault",
            sql: include_str!("../migrations/023_simplify_character_vault.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "story_bg_image",
            sql: include_str!("../migrations/024_background_images.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 25,
            description: "world_state_deltas",
            sql: include_str!("../migrations/025_world_state_deltas.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 26,
            description: "cow_branches",
            sql: include_str!("../migrations/026_cow_branches.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 27,
            description: "entry_suggested_actions",
            sql: include_str!("../migrations/027_entry_suggested_actions.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 28,
            description: "cow_tombstones",
            sql: include_str!("../migrations/028_cow_tombstones.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 29,
            description: "branch_entity_snapshots",
            sql: include_str!("../migrations/029_branch_entity_snapshots.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 30,
            description: "preset_packs",
            sql: include_str!("../migrations/030_preset_packs.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 31,
            description: "pack_variable_extensions",
            sql: include_str!("../migrations/031_pack_variable_extensions.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 32,
            description: "runtime_variables",
            sql: include_str!("../migrations/032_runtime_variables.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 33,
            description: "vault_assistant_conversations",
            sql: include_str!("../migrations/033_vault_assistant_conversations.sql"),
            kind: MigrationKind::Up,
        }
    ];

    let mut builder = tauri::Builder::default();

    #[cfg(all(debug_assertions, feature = "devtools"))]
    // only enable instrumentation in development builds
    {
        builder = builder.plugin(tauri_plugin_devtools::init());
    }

    builder
        .manage(sync::SyncState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:aventura.db", migrations)
                .build(),
        )
        .setup(|app| {
            let db_path = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir")
                .join("aventura.db");

            if db_path.try_exists().expect("failed to check db path") {
                tauri::async_runtime::block_on(migration_patch::apply_checksum_patch(&db_path));
            }

            Ok(())
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            start_sync_server,
            stop_sync_server,
            get_received_stories,
            clear_received_stories,
            sync_connect,
            sync_pull_story,
            sync_push_story,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
