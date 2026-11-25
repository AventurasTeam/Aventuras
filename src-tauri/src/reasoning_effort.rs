//! Migration 043 rewrites the stored reasoning levels in place: `'off'` becomes `'none'`, and the
//! legacy `enable_thinking` flag is folded into `main_reasoning_effort`.
//! The application reads them through the SQL plugin, so the rules are checked here.

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::{Row, SqlitePool};

    /// Runs the migration over a `settings` table holding `rows`, as one script, the way the
    /// plugin runs it.
    async fn migrate(rows: &[(&str, &str)]) -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();

        sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        for (key, value) in rows {
            sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?)")
                .bind(key)
                .bind(value)
                .execute(&pool)
                .await
                .unwrap();
        }

        sqlx::raw_sql(include_str!("../migrations/043_reasoning_effort.sql"))
            .execute(&pool)
            .await
            .unwrap();

        pool
    }

    async fn raw(pool: &SqlitePool, key: &str) -> Option<String> {
        sqlx::query("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(pool)
            .await
            .unwrap()
            .map(|row| row.get::<String, _>("value"))
    }

    async fn json_setting(pool: &SqlitePool, key: &str) -> Value {
        serde_json::from_str(&raw(pool, key).await.unwrap()).unwrap()
    }

    #[tokio::test]
    async fn stored_off_becomes_none() {
        let pool = migrate(&[("main_reasoning_effort", "off")]).await;

        assert_eq!(raw(&pool, "main_reasoning_effort").await.unwrap(), "none");
    }

    #[tokio::test]
    async fn current_levels_are_left_alone() {
        for level in ["none", "minimal", "low", "medium", "high", "xhigh", "max"] {
            let pool = migrate(&[("main_reasoning_effort", level)]).await;

            assert_eq!(raw(&pool, "main_reasoning_effort").await.unwrap(), level);
        }
    }

    #[tokio::test]
    async fn off_is_rewritten_inside_each_blob() {
        let blob = json!({
            "narrative": { "reasoningEffort": "off", "model": "a", "stream": true, "maxTokens": 8192 },
            "classifier": { "reasoningEffort": "high", "model": "b" },
        })
        .to_string();
        let presets = json!([
            { "id": "p1", "reasoningEffort": "off" },
            { "id": "p2", "reasoningEffort": "low" },
        ])
        .to_string();
        let pool = migrate(&[
            ("wizard_settings", &blob),
            ("system_services_settings", &blob),
            ("generation_presets", &presets),
        ])
        .await;

        for key in ["wizard_settings", "system_services_settings"] {
            let settings = json_setting(&pool, key).await;
            assert_eq!(settings["narrative"]["reasoningEffort"], "none", "{key}");
            assert_eq!(settings["narrative"]["stream"], true, "{key}");
            assert_eq!(settings["narrative"]["maxTokens"], 8192, "{key}");
            assert_eq!(settings["classifier"]["reasoningEffort"], "high", "{key}");
        }
        let presets = json_setting(&pool, "generation_presets").await;
        assert_eq!(presets[0]["reasoningEffort"], "none");
        assert_eq!(presets[1]["reasoningEffort"], "low");
    }

    #[tokio::test]
    async fn text_that_only_quotes_the_pair_is_left_alone() {
        let manual_body = r#"{"reasoningEffort":"off"}"#;
        let blob = json!({ "narrative": { "reasoningEffort": "off", "manualBody": manual_body } })
            .to_string();
        let pool = migrate(&[("wizard_settings", &blob)]).await;

        let settings = json_setting(&pool, "wizard_settings").await;
        assert_eq!(settings["narrative"]["reasoningEffort"], "none");
        assert_eq!(settings["narrative"]["manualBody"], manual_body);
    }

    #[tokio::test]
    async fn other_keys_are_untouched() {
        let blob = json!({ "reasoningEffort": "off" }).to_string();
        let pool = migrate(&[("something_else", &blob)]).await;

        assert_eq!(raw(&pool, "something_else").await.unwrap(), blob);
    }

    #[tokio::test]
    async fn enable_thinking_without_a_level_becomes_high() {
        let pool = migrate(&[("enable_thinking", "true")]).await;

        assert_eq!(raw(&pool, "main_reasoning_effort").await.unwrap(), "high");
    }

    #[tokio::test]
    async fn enable_thinking_replaces_an_unreadable_level() {
        for stored in ["", "nonsense"] {
            let pool = migrate(&[
                ("enable_thinking", "true"),
                ("main_reasoning_effort", stored),
            ])
            .await;

            assert_eq!(
                raw(&pool, "main_reasoning_effort").await.unwrap(),
                "high",
                "{stored:?}"
            );
        }
    }

    #[tokio::test]
    async fn enable_thinking_yields_to_a_readable_level() {
        for (stored, expected) in [
            ("low", "low"),
            ("max", "max"),
            ("off", "none"),
            ("none", "none"),
        ] {
            let pool = migrate(&[
                ("enable_thinking", "true"),
                ("main_reasoning_effort", stored),
            ])
            .await;

            assert_eq!(
                raw(&pool, "main_reasoning_effort").await.unwrap(),
                expected,
                "{stored:?}"
            );
        }
    }

    #[tokio::test]
    async fn enable_thinking_false_creates_no_level() {
        let pool = migrate(&[("enable_thinking", "false")]).await;

        assert_eq!(raw(&pool, "main_reasoning_effort").await, None);
    }

    #[tokio::test]
    async fn enable_thinking_is_removed() {
        for flag in ["true", "false"] {
            let pool = migrate(&[("enable_thinking", flag)]).await;

            assert_eq!(raw(&pool, "enable_thinking").await, None, "{flag}");
        }
    }
}
